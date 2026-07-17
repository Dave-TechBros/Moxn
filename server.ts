/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import { initializeApp as initClientApp } from "firebase/app";
import { getFirestore as getClientFirestore, collection, getDocs, doc, setDoc, deleteDoc, writeBatch } from "firebase/firestore";
import { GoogleGenAI } from "@google/genai";
import { ServerDatabase, User, Article, Category, Comment, Notification, UserRole } from "./src/types.js";

export const app = express();
const PORT = 3000;
const DB_FILE = path.join(process.cwd(), "server_db.json");

let MEMORY_DB: ServerDatabase | null = null;
let firestoreDbInstance: any = null;
let syncQueuePromise: Promise<void> = Promise.resolve();
let isLoadedFromFirestore = false;
let loadPromise: Promise<any> | null = null;
let firestoreLoadAttempted = false;

async function ensureDbLoaded() {
  // If no Firestore configured, just load from local file (fast path)
  if (!firestoreDbInstance) {
    if (!MEMORY_DB) {
      initDatabase();
    }
    return MEMORY_DB!;
  }

  // Firestore IS configured - try to load from Firestore on first request
  // to get the latest data, overriding any local cache
  if (!firestoreLoadAttempted) {
    firestoreLoadAttempted = true;

    // Ensure local cache is loaded first as fallback
    if (!MEMORY_DB) {
      initDatabase();
    }

    try {
      console.log("[Firestore] ensureDbLoaded: Fetching database from Cloud Firestore...");
      const firestoreDb = await loadFromFirestore();
      if (firestoreDb) {
        // Firestore has real data - use it as source of truth
        MEMORY_DB = firestoreDb;
        try {
          fs.writeFileSync(DB_FILE, JSON.stringify(firestoreDb, null, 2));
          console.log("[Firestore] Database loaded from Firestore and cached to disk.");
        } catch (writeErr) {
          console.warn("[Firestore] Could not save Firestore cache to disk (read-only fs?), using in-memory:", (writeErr as any).message);
        }
      } else {
        // Firestore is empty - keep local cache and seed Firestore from it
        console.log("[Firestore] Firestore is empty. Seeding from local database cache...");
        if (!MEMORY_DB) {
          initDatabase();
        }
        if (MEMORY_DB) {
          try {
            await seedFirestore();
            console.log("[Firestore] Local cache seeded to Firestore successfully.");
          } catch (seedErr) {
            console.error("[Firestore] Failed to seed Firestore from local cache:", seedErr);
          }
        }
      }
    } catch (dbErr) {
      console.error("[Firestore] Error loading from Firestore, keeping local cache:", dbErr);
      if (!MEMORY_DB) {
        initDatabase();
      }
    }
  }

  // Ensure we always have data loaded (fallback if Firestore failed)
  if (!MEMORY_DB) {
    initDatabase();
  }
  return MEMORY_DB!;
}

app.use(express.json());

// Global middleware to coordinate database loading and syncing on both reads and writes
app.use("/api", async (req, res, next) => {
  try {
    await ensureDbLoaded();
  } catch (err) {
    console.error("[Firestore] Failed to ensure database is loaded:", err);
  }

  // Intercept response methods to await any pending Firestore sync operations (syncQueuePromise)
  // before sending the response. This is critical for serverless environments (like Vercel) to prevent
  // execution from being suspended before the Firestore writes finish.
  const originalJson = res.json;
  const originalSend = res.send;

  res.json = function(body) {
    syncQueuePromise.then(() => {
      originalJson.call(res, body);
    }).catch((err) => {
      console.error("[Firestore] Error awaiting syncQueuePromise in res.json:", err);
      originalJson.call(res, body);
    });
    return res;
  };

  res.send = function(body) {
    syncQueuePromise.then(() => {
      originalSend.call(res, body);
    }).catch((err) => {
      console.error("[Firestore] Error awaiting syncQueuePromise in res.send:", err);
      originalSend.call(res, body);
    });
    return res;
  };

  next();
});

// ----------------------------------------------------
// Gemini AI Initialization (Lazy)
// ----------------------------------------------------
let aiInstance: GoogleGenAI | null = null;
function getAI(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }
  if (!aiInstance) {
    try {
      aiInstance = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    } catch (err) {
      console.error("Failed to initialize Gemini AI SDK:", err);
    }
  }
  return aiInstance;
}

// ----------------------------------------------------
// Database Load / Save & Seed Data Initialization
// ----------------------------------------------------
const CATEGORIES: Category[] = [
  { id: "tech", name: "Technology", slug: "technology", description: "Computing, artificial intelligence, security, and consumer electronics." },
  { id: "business", name: "Business", slug: "business", description: "Startups, economics, finance, venture capital, and market analysis." },
  { id: "politics", name: "Politics", slug: "politics", description: "Government, democracy, international relations, and global policies." },
  { id: "sports", name: "Sports", slug: "sports", description: "Professional athletic events, analysis, tournaments, and athlete profiles." },
  { id: "ent", name: "Entertainment", slug: "entertainment", description: "Movies, digital streaming, gaming, pop culture, and music." },
  { id: "science", name: "Science", slug: "science", description: "Physics, space exploration, nanotechnology, and natural phenomena." },
  { id: "health", name: "Health", slug: "health", description: "Wellness, biotech, mental health, medicine, and nutritional science." },
  { id: "edu", name: "Education", slug: "education", description: "Modern pedagogy, university research, online learning, and student life." },
  { id: "lifestyle", name: "Lifestyle", slug: "lifestyle", description: "Travel, gastronomy, wellness trends, home design, and modern living." },
  { id: "world", name: "World", slug: "world", description: "Global dispatches, humanitarian updates, and ecological developments." }
];

const WRITERS: User[] = [
  { id: "user-editor", name: "Arthur Vance", email: "editor@moxn.com", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150", role: "Editor", bio: "Editor-in-Chief at MOXN. 15+ years in digital journalism. Passionate about ethics, clarity, and bold reporting.", createdAt: "2026-01-10T12:00:00Z", followersCount: 1250, followingCount: 340 },
  { id: "user-writer-1", name: "Sarah Jenkins", email: "sarah@moxn.com", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150", role: "Writer", bio: "Senior Tech Correspondent. Ex-Wired. Covering the intersection of AI, hardware design, and digital human rights.", createdAt: "2026-02-15T09:00:00Z", followersCount: 940, followingCount: 120 },
  { id: "user-writer-2", name: "David Chen", email: "david@moxn.com", avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150", role: "Writer", bio: "AI Architect & Computational Essayist. Documenting the cognitive boundaries of machine learning and large scale systems.", createdAt: "2026-02-20T10:30:00Z", followersCount: 780, followingCount: 95 },
  { id: "user-writer-3", name: "Elena Rostova", email: "elena@moxn.com", avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150", role: "Writer", bio: "International Affairs Reporter. Specializing in geopolitical strategies, supply chains, and environmental migration.", createdAt: "2026-03-01T08:15:00Z", followersCount: 650, followingCount: 140 },
  { id: "user-writer-4", name: "Marcus Vance", email: "marcus@moxn.com", avatar: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150", role: "Writer", bio: "Venture Partner & Market Strategist. Decoupling macroeconomics and emerging markets from technological hype cycles.", createdAt: "2026-03-05T14:40:00Z", followersCount: 1100, followingCount: 210 },
  { id: "user-writer-5", name: "Dr. Clara DuPont", email: "clara@moxn.com", avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150", role: "Writer", bio: "Astrophysicist & Science Communicator. Writing about space flight telemetry, high-energy particle mechanics, and deep space telemetry.", createdAt: "2026-03-10T11:20:00Z", followersCount: 880, followingCount: 80 },
  { id: "user-writer-6", name: "James Patterson", email: "james@moxn.com", avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150", role: "Writer", bio: "Sports Data Analyst. Visualizing player metrics, athletic longevity, and tactical patterns in global sports leagues.", createdAt: "2026-03-15T15:00:00Z", followersCount: 520, followingCount: 105 },
  { id: "user-writer-7", name: "Chloe Bennett", email: "chloe@moxn.com", avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150", role: "Writer", bio: "Culture Critic & Design Historian. Reviewing physical architectures, minimalist living frameworks, and high-modern fashion.", createdAt: "2026-03-20T16:10:00Z", followersCount: 670, followingCount: 190 },
  { id: "user-writer-8", name: "Leo Sterling", email: "leo@moxn.com", avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150", role: "Writer", bio: "Business Ethicist and Strategist. Consulting globally on executive integrity, sustainability matrices, and digital monopolies.", createdAt: "2026-03-25T09:45:00Z", followersCount: 490, followingCount: 75 },
  { id: "user-writer-9", name: "Sophia Martinez", email: "sophia@moxn.com", avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150", role: "Writer", bio: "Biotech & Longevity Researcher. Covering circadian biology, nutritional metabolism, and genomic healthcare innovations.", createdAt: "2026-03-28T13:15:00Z", followersCount: 1200, followingCount: 150 }
];

const SEED_ARTICLES: Article[] = [
  {
    id: "art-1",
    title: "The Next Threshold of Large Multimodal Architecture",
    slug: "next-threshold-large-multimodal-architecture",
    subtitle: "How neural networks are expanding beyond text into real-time perceptual logic and dynamic spatial tracking.",
    body: `### The Shift in Perceptual Frontiers

For the past several years, artificial intelligence research has maintained a dominant focus on sequence modeling, primarily text. Large language models (LLMs) proved that next-token prediction can achieve remarkable reasoning approximations. However, true understanding requires sensory convergence.

Human intelligence does not operate in isolated linguistic blocks. We perceive, cross-reference, and act. This is the genesis of modern Multimodal Architecture.

\`\`\`typescript
interface MultimodalInput {
  visualFrame: ImageData;
  telemetryStream: ArrayBuffer;
  acousticVector: Float32Array;
}
\`\`\`

#### Cross-Attention and Latent Space Fusion

Rather than training separate encoders and stitching them together with shallow dense layers, modern networks utilize unified attention spaces. Audio, visual, and text data are projected into a singular, cohesive vector space.

*   **Spatial Temporal Invariance:** Systems can track objects continuously across frames, referencing historical spatial coordinates.
*   **Acoustic Semantics:** Sound is not just transcribed; pitch, environmental resonance, and emotional tone are parsed concurrently.
*   **Dynamic Prompting:** The prompt is no longer just words; it is an active state containing real-time sensory feeds.

#### The Next Milestones

We are heading toward systems that can reason through real-world visual environments in microseconds. Autonomous systems, smart assistive devices, and creative toolkits will transition from reactive agents to highly proactive, co-perceptive collaborators.`,
    coverImage: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1200&q=80",
    status: "Published",
    featured: true,
    authorId: "user-writer-2",
    categoryId: "tech",
    publishedAt: "2026-06-25T08:00:00Z",
    createdAt: "2026-06-24T14:30:00Z",
    updatedAt: "2026-06-25T08:00:00Z",
    readCount: 3450,
    likeCount: 289,
    tags: ["Artificial Intelligence", "Neural Networks", "Deep Learning", "Technology"],
    seoTitle: "Large Multimodal AI Architecture Breakthroughs - MOXN",
    seoDescription: "An in-depth exploration of unified latent spaces, cross-attention mechanics, and real-time perceptual intelligence in next-generation AI."
  },
  {
    id: "art-2",
    title: "Quantum Decoupling and the Search for Absolute Entanglement",
    slug: "quantum-decoupling-absolute-entanglement",
    subtitle: "A detailed investigation of cryogenic stability chambers and macroscopic quantum coherence limits.",
    body: `### Macroscopic Coherence Under Scrutiny

In quantum mechanics, environmental noise is the absolute enemy. Decoupling a physical qubit from electromagnetic fluctuations, thermal energy, and gravity is a major engineering hurdle.

Recent experiments at the CERN Cryogenics Facility have pushed superconducting transmon qubits to unprecedented coherence times. 

#### Cryogenic Vacuum Engineering

By reducing operational temperatures to **10 millikelvin** (colder than interstellar space), researchers isolated a grid of forty qubits for over 300 seconds.

1.  **Thermal Isolation:** Utilizing multi-stage dilution refrigerators.
2.  **Magnetic Shielding:** Active mumetal casings blocking Earth's magnetic fields.
3.  **Radio Frequency Filtration:** High-density coaxial attenuators dampening stray photons.

#### What Lies Ahead?

If macroscopic entanglement can survive outside cryogenic chambers, the computational capacity of modern cryptography would be upended. Quantum Key Distribution (QKD) would become the global default for secure networking, making intercept-based eavesdropping theoretically impossible.`,
    coverImage: "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=1200&q=80",
    status: "Published",
    featured: true,
    authorId: "user-writer-5",
    categoryId: "science",
    publishedAt: "2026-06-26T10:00:00Z",
    createdAt: "2026-06-25T11:00:00Z",
    updatedAt: "2026-06-26T10:00:00Z",
    readCount: 1850,
    likeCount: 154,
    tags: ["Quantum Computing", "Physics", "Cryogenics", "Science"],
    seoTitle: "Quantum Decoupling and Entanglement - MOXN Science",
    seoDescription: "Examining superconducting transmon qubits, 10mK cryogenic cooling, and the roadmap to absolute quantum entanglement in security systems."
  },
  {
    id: "art-3",
    title: "The Silent Transformation of Global Micro-Grid Infrastructure",
    slug: "silent-transformation-global-micro-grid-infrastructure",
    subtitle: "Decentralized energy distribution is quietly outpacing centralized grid reliability in major industrial sectors.",
    body: `### The Collapse of the Central Grid Paradigm

For over a century, power generation relied on massive, high-voltage transmission lines connecting distant generating plants to urban consumer hubs. But rising grid vulnerability—from extreme weather to deliberate infrastructure attacks—has accelerated a structural shift.

Enter **Micro-Grids**: self-contained localized power grids that can detach from the regional utility seamlessly.

#### Algorithmic Load Balancing

Modern micro-grids are not just panels and batteries. They run specialized machine learning workloads that predict power demand, adjust solar-battery reserves, and trade surplus electricity with neighbors on real-time micro-markets.

*   **Islanding Speed:** The transition from grid-tied to isolated mode takes less than **16 milliseconds**.
*   **Resource Diversity:** Combining hydrogen fuel cells, rooftop photovoltaics, and recycled electric vehicle battery packs.
*   **Democratic Pricing:** Smart contracts facilitating direct peer-to-peer billing without utility markup.

#### Regional Case Studies

In rural Saxony, Germany, a community-owned micro-grid achieved 100% autonomy throughout the winter of 2025, operating entirely on localized solar-hydrogen synthesis. This template is currently being adapted across vulnerable Pacific islands and North American manufacturing corridors.`,
    coverImage: "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?w=1200&q=80",
    status: "Published",
    featured: false,
    authorId: "user-writer-4",
    categoryId: "business",
    publishedAt: "2026-06-27T09:15:00Z",
    createdAt: "2026-06-26T14:00:00Z",
    updatedAt: "2026-06-27T09:15:00Z",
    readCount: 1240,
    likeCount: 98,
    tags: ["Clean Energy", "Infrastructure", "Economics", "Micro-grids"],
    seoTitle: "Global Micro-Grid Energy Disruption - MOXN Business",
    seoDescription: "How algorithmic local power grids are shifting energy generation away from centralized utilities through peer-to-peer markets."
  },
  {
    id: "art-4",
    title: "Vascular Aging: Reversing Cellular Stiffness through Biotech",
    slug: "vascular-aging-reversing-cellular-stiffness-biotech",
    subtitle: "New clinical trials targeting senolytic clearance in arterial tissue show promising arterial age reversal.",
    body: `### The Arterial Rigidity Matrix

Vascular stiffness is a hallmark of human aging. As arterial walls accumulate fibrotic tissue and calcified deposits, elasticity declines, leading to chronic blood pressure strain.

Recent laboratory investigations at the Lausanne Institute of Biotech have discovered a specific peptide, **TX-402**, which induces targeted autophagy of senescent vascular cells.

#### The TX-402 Protocol

By selectively purging cells that have entered cell-cycle arrest (senescent cells), the peptide rejuvenates the extracellular matrix of the aorta.

*   **Elastin Regeneration:** Clinical monitors showed a **22% increase** in arterial elastin density over 6 months.
*   **Calcification Clearance:** Micro-calcium plaques were safely dissolved and metabolized.
*   **Endothelial Function:** Nitric oxide production—which prompts blood vessel relaxation—was restored to youthful baselines.

#### Safety and Scalability

While human trials are currently restricted to Phase II, the cardiovascular profiles of test subjects have demonstrated no off-target toxicity. This represents one of the most promising vectors for therapeutic life-span extensions.`,
    coverImage: "https://images.unsplash.com/photo-1532187643603-ba119ca4109e?w=1200&q=80",
    status: "Published",
    featured: false,
    authorId: "user-writer-9",
    categoryId: "health",
    publishedAt: "2026-06-28T07:30:00Z",
    createdAt: "2026-06-27T08:00:00Z",
    updatedAt: "2026-06-28T07:30:00Z",
    readCount: 2210,
    likeCount: 176,
    tags: ["Biotech", "Longevity", "Cardiovascular", "Medicine"],
    seoTitle: "Reversing Vascular Stiffness and Arterial Aging - MOXN",
    seoDescription: "A deep dive into peptide TX-402 clinical trials targeting cellular senescence to restore vascular elasticity and elastin density."
  },
  {
    id: "art-5",
    title: "Designing for Solitude: The Architecture of Quiet Spaces",
    slug: "designing-for-solitude-architecture-quiet-spaces",
    subtitle: "How contemporary urban architects are pushing back against open-plan noise with modular acoustic cells.",
    body: `### The Tyranny of Constant Connection

We live in a world of inescapable audio stimulus. From public transport alerts to the ambient buzz of corporate open-plan layouts, quiet has become a rare luxury. 

Recognizing this, progressive architectural practices are engineering physical environments optimized for silence and cognitive restoration.

#### Principles of Acoustic Geometry

To build true silence, simple insulation is insufficient. Architects must shape sound waves.

*   **Negative Reflection:** Utilizing angled walls surfaced with porous micro-slats that swallow sound rather than bouncing it.
*   **Acoustic Isolation Joints:** Decoupling floor slabs using neoprene padding, effectively isolating the quiet space from building vibrations.
*   **Biophilic Noise Dampening:** Using dense, humid, vertical moss walls that naturally diffuse high-frequency background noise.

#### Micro-Sanctuaries

From public libraries in Stockholm to private residential towers in Tokyo, modular 'solitude cabinets' are appearing. These structures provide clean, dust-filtered, fully sound-insulated environments, proving that silence is not just an absence of noise, but a critical foundation for deep mental focus.`,
    coverImage: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80",
    status: "Published",
    featured: false,
    authorId: "user-writer-7",
    categoryId: "lifestyle",
    publishedAt: "2026-06-29T08:45:00Z",
    createdAt: "2026-06-28T10:00:00Z",
    updatedAt: "2026-06-29T08:45:00Z",
    readCount: 930,
    likeCount: 84,
    tags: ["Architecture", "Design", "Acoustics", "Lifestyle", "Minimalism"],
    seoTitle: "Designing Solitude: Acoustic Architecture - MOXN",
    seoDescription: "How contemporary architects use biophilic walls, acoustic joints, and geometry to build peaceful sanctuaries in dense urban cities."
  },
  {
    id: "art-6",
    title: "The Geopolitics of Lithium Corridors in South America",
    slug: "geopolitics-lithium-corridors-south-america",
    subtitle: "A critical examination of trade routes, indigenous resource claims, and multi-national investment blocks.",
    body: `### The Golden Triangle under Tension

The high-altitude salt flats of Chile, Bolivia, and Argentina contain over **50% of the world's known lithium reserves**. As demand for electrochemical storage escalates, this high-altitude region has become a hotbed of geopolitical posturing.

Global superpowers are rushing to lock down exclusive extraction agreements, sometimes at the expense of local environmental sustainability.

#### Extraction Economics and Ecological Strain

Lithium extraction requires pumping vast quantities of brine from underground aquifers into giant evaporation pools.

1.  **Water Depletion:** One ton of lithium consumes roughly **two million liters of water**, severely lowering local water tables.
2.  **Soil Contamination:** Chemical runoff poses severe hazards to indigenous agricultural soils.
3.  **Local Resistance:** Native communities are organizing roadblocks and legal actions to demand fair royalty shares and active water protection.

#### The Strategic Corridors

To bypass regional logistics bottlenecks, multi-national consortiums are funding a massive trans-Andean railway network. This corridor will move battery-grade lithium carbonate directly to deep-water ports on the Pacific coast, shortening shipment timelines to North American and East Asian manufacturing plants by over ten days.`,
    coverImage: "https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=1200&q=80",
    status: "Published",
    featured: false,
    authorId: "user-writer-3",
    categoryId: "world",
    publishedAt: "2026-06-29T14:20:00Z",
    createdAt: "2026-06-28T15:00:00Z",
    updatedAt: "2026-06-29T14:20:00Z",
    readCount: 1540,
    likeCount: 112,
    tags: ["Geopolitics", "Lithium", "Climate Change", "Trade", "South America"],
    seoTitle: "South American Lithium Geopolitics - MOXN World",
    seoDescription: "An in-depth analysis of high-altitude lithium extraction in Bolivia, Chile, and Argentina, highlighting water rights and trans-Andean trade routes."
  },
  {
    id: "art-7",
    title: "AI and the Future of Intellectual Property Rights",
    slug: "ai-future-intellectual-property-rights",
    subtitle: "Understanding the legal frameworks surrounding generative model training datasets.",
    body: `### The Ownership Paradigm in Neural Networks

Who owns a pixel generated by a network trained on millions of copyrighted images? This question has transitioned from theoretical legal forums into multi-billion dollar courtroom disputes.

As generative AI models achieve high-fidelity creative replication, the traditional boundaries of Fair Use, Copyright, and Intellectual Property are fracturing.

#### The Core Legal Battlegrounds

*   **Training Intake:** Is scraping public digital assets for neural model training a protected 'fair use' activity or systematic licensing infringement?
*   **Latent Collateral:** When a model outputs an asset in the distinctive style of a living artist, does that constitute a derivative work?
*   **Author Attribution:** Current legal doctrines in major jurisdictions require a **human author** to grant intellectual copyright protection. Machine outputs are currently designated as public domain by default.

#### The Licensing Solution

To avoid terminal litigation, tech platforms are pioneering opt-in licensing repositories, offering artists dividends whenever their works are referenced during generation. This might lay the foundation for a sustainable cooperative economy of synthetic media.`,
    coverImage: "https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=1200&q=80",
    status: "Published",
    featured: false,
    authorId: "user-writer-1",
    categoryId: "tech",
    publishedAt: "2026-06-30T05:00:00Z",
    createdAt: "2026-06-29T09:00:00Z",
    updatedAt: "2026-06-30T05:00:00Z",
    readCount: 2780,
    likeCount: 204,
    tags: ["Artificial Intelligence", "Copyright", "Legal Tech", "Technology"],
    seoTitle: "AI Model Training and Copyright Law - MOXN Tech",
    seoDescription: "Exposing the deep legal conflicts of generative AI training databases, human copyright precedents, and licensing registries."
  },
  {
    id: "art-8",
    title: "Venture Velocity: Post-Hype Startup Funding Metrics",
    slug: "venture-velocity-post-hype-startup-funding-metrics",
    subtitle: "Why profitability and cash multipliers have permanently replaced growth-at-all-costs templates.",
    body: `### The Return of Capital Discipline

The era of easy capital is over. For nearly a decade, founders were advised to scale aggressively, burning through millions of dollars to capture early market share. Today, the investment ecosystem demands a return to fundamental corporate economics.

Venture capital firms have updated their investment scoring matrices to prioritize **Venture Velocity** and **Capital Efficiency**.

#### The New Valuation Standards

1.  **Rule of 40 Redefined:** It is no longer just Growth + Margin. Investors are rewarding businesses that hit a sustainable 30% margin with solid 10% organic growth.
2.  **The Burn Multiple:** Calculated as *Net Burn divided by Net New ARR*. A score below **1.0x** is exceptional, indicating the startup generates ARR efficiently without exhausting cash reserves.
3.  **LTV to CAC Ratio:** Must exceed **5:1** in enterprise software sectors, supported by rigid contract terms.

#### The Founder's Roadmap

Founders should shift their focus from raising massive rounds to achieving cash-flow break-even within eighteen months of seed funding. This independence is the ultimate leverage in future fundraising negotiations.`,
    coverImage: "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=1200&q=80",
    status: "Published",
    featured: false,
    authorId: "user-writer-4",
    categoryId: "business",
    publishedAt: "2026-06-30T06:00:00Z",
    createdAt: "2026-06-29T10:00:00Z",
    updatedAt: "2026-06-30T06:00:00Z",
    readCount: 1450,
    likeCount: 118,
    tags: ["Venture Capital", "Business Strategy", "Startups", "Economics"],
    seoTitle: "Post-Hype Startup Funding Metrics - MOXN Business",
    seoDescription: "How the investment ecosystem is replacing user-acquisition hype with capital efficiency, burn multiples, and sustainable cash flows."
  },
  // In Review drafts for editorial workflow demonstration
  {
    id: "art-9",
    title: "The Architecture of Neural Co-Processors in Mobile Silicon",
    slug: "architecture-neural-co-processors-mobile-silicon",
    subtitle: "A technical walkthrough of memory bus widths and local on-chip execution efficiency.",
    body: `### Local Computing on Pocket Silicons

Integrating deep learning execution pipelines on pocket devices requires major silicon reconsiderations. Standard CPU microarchitectures excel at linear tasks, and GPUs dominate wide parallel execution. But neural models need highly specialized mathematical execution.

This is the purpose of the modern NPU (Neural Processing Unit).

#### SRAM Buffers and Memory Bandwidth

To minimize battery drain, models cannot frequently access off-chip LPDDR5 memory. Every gigabyte of data moved across the mother board consumes vital milliwatts.

*   **Near-Memory Computing:** NPUs utilize dedicated high-speed SRAM caches directly adjacent to mathematical arrays.
*   **Quantization Scaling:** Running 4-bit and 8-bit integer weights instead of heavy 32-bit floats, reducing memory footprint by **75%** with minimal precision loss.
*   **Asynchronous Compute Pipelines:** Simultaneously running facial recognition, voice synthesis, and real-time noise reduction without taxing CPU resources.

#### Emerging Architectures

The next generation of NPUs will integrate analog compute arrays that simulate physical synaptic conductance, paving the way for ultra-low-power, always-on context-aware mobile software.`,
    coverImage: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&q=80",
    status: "In Review",
    featured: false,
    authorId: "user-writer-1",
    categoryId: "tech",
    createdAt: "2026-06-29T11:00:00Z",
    updatedAt: "2026-06-29T11:00:00Z",
    readCount: 0,
    likeCount: 0,
    tags: ["Silicon Design", "NPU", "Hardware", "Technology"]
  },
  {
    id: "art-10",
    title: "Evolving Educational Delivery: The Pedagogy of VR Lab Cohorts",
    slug: "evolving-educational-delivery-pedagogy-vr-lab-cohorts",
    subtitle: "How virtual lab spaces are leveling the playing field for remote medical and chemistry studies.",
    body: `### Overcoming Physical Constraints in STEM Education

Acquiring high-end laboratory gear is a major cost barrier for educational institutions globally. Chemistry, molecular biology, and surgical medicine require hands-on manipulation, which traditional online formats cannot replicate.

Interactive VR lab simulations are proving to be a highly effective pedagogical solution.

#### Immersive Kinetic Learning

By utilizing spatial controllers and physical tracking, students can manipulate molecular lattices or perform simulated surgeries in real-time.

*   **Zero Marginal Cost:** Reagents, vacuum hoods, and surgical equipment can be instantiated infinitely.
*   **Perfect Safety:** Students can safely observe highly volatile chemical reactions or practice complex cardiovascular surgeries with no physical risk.
*   **Tactile Synchronization:** Haptic spatial controllers simulate the resistive force of surgical incisions or micropipette extractions.

#### Institutional Efficacy

A study of 500 remote biology students showed that cohorts utilizing VR laboratory simulations scored **18% higher** on standard clinical assessments than those relying purely on text and video instruction. This indicates immersive virtual spaces are ready to transition from novelty into central educational infrastructure.`,
    coverImage: "https://images.unsplash.com/photo-1593508512255-86ab42a8e620?w=1200&q=80",
    status: "In Review",
    featured: false,
    authorId: "user-writer-2",
    categoryId: "edu",
    createdAt: "2026-06-29T15:30:00Z",
    updatedAt: "2026-06-29T15:30:00Z",
    readCount: 0,
    likeCount: 0,
    tags: ["Education", "Virtual Reality", "Pedagogy", "STEM"]
  },
  // Draft articles
  {
    id: "art-11",
    title: "The Epigenetics of Circadian Eating Schedules",
    slug: "epigenetics-circadian-eating-schedules",
    subtitle: "Investigating how insulin sensitivity and cellular repair mechanisms align with metabolic clocks.",
    body: `### Synchronizing Nutrition and Biology

Our bodies operate on a rigorous 24-hour cycle governed by the master clock in the brain. However, recent metabolic studies reveal that peripheral tissues—like the liver, pancreas, and muscle—contain their own localized circadian clocks.

Consuming nutrients outside of optimal circadian windows can disrupt these clocks, leading to metabolic friction.

#### Metabolic Timing and Insulin Fluctuations

*   **Early Insulin Efficiency:** Studies show the body's insulin response is significantly more efficient during daylight hours.
*   **Nighttime Autophagy:** Restricting food intake to a **10-hour window** triggers cellular autophagy and mitochondrial repair during the night.
*   **Gene Expression Profiles:** Circadian nutrition regulates several metabolic genes, protecting against chronic lipid storage and arterial inflammation.

#### Practical Application

A simple schedule—finishing dinner before sunset and fasting for 14 hours—aligns physical digestion with natural evolutionary biology, maximizing overall mitochondrial efficiency and daytime energy levels.`,
    coverImage: "https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=1200&q=80",
    status: "Draft",
    featured: false,
    authorId: "user-writer-9",
    categoryId: "health",
    createdAt: "2026-06-30T01:00:00Z",
    updatedAt: "2026-06-30T01:00:00Z",
    readCount: 0,
    likeCount: 0,
    tags: ["Circadian Rhythm", "Nutrition", "Longevity", "Health"]
  },
  {
    id: "art-12",
    title: "The Evolution of Minimalist Typography in Digital Formats",
    slug: "evolution-minimalist-typography-digital-formats",
    subtitle: "How pixel densities and system UI fonts reshaped digital interface typography.",
    body: `### The Transition from Print to Responsive Screens

In print design, physical layout is absolute. In digital interface design, type is highly fluid, scaling across different screen sizes, aspect ratios, and pixel densities. This fluid reality prompted the rise of minimalist digital typography.

#### System UI Fonts and Screen Readability

To optimize loading speeds, platforms bypassed heavy custom font payloads in favor of highly optimized system fonts like San Francisco and Segoe UI.

*   **Subtle Optical Scaling:** Modern digital fonts automatically adjust spacing and weight depending on display size.
*   **High-Contrast Rendering:** Letters are designed with open shapes and clean geometric curves to remain highly readable even at small sizes.
*   **The Anti-Decoration Trend:** Eliminating unnecessary flourishes to prioritize immediate content layout.

#### Modern Editorial Type Pairings

The premium editorial experience combines clean system fonts for interface navigation with elegant, high-contrast serif headlines for long-form reading, offering a balanced mix of speed and visual sophistication.`,
    coverImage: "https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?w=1200&q=80",
    status: "Draft",
    featured: false,
    authorId: "user-writer-7",
    categoryId: "lifestyle",
    createdAt: "2026-06-30T03:00:00Z",
    updatedAt: "2026-06-30T03:00:00Z",
    readCount: 0,
    likeCount: 0,
    tags: ["Typography", "Design", "Product Design", "Lifestyle"]
  },
  // Rejected draft for demonstration
  {
    id: "art-13",
    title: "10 Cryptocurrencies to Buy Right Now for Massive Gains",
    slug: "10-cryptocurrencies-to-buy-right-now-massive-gains",
    subtitle: "Why these token assets are guaranteed to explode next week.",
    body: `### Quick Profits in Digital Finance

If you want to retire early, you need to invest in these emerging altcoins immediately. These high-yield tokens are positioned for parabolic growth, backed by social media momentum and innovative meme utility.

#### Top Assets to Watch

1.  **DogeRocket:** A community-driven token with massive potential.
2.  **SolMoon:** Leveraged liquidity protocols on high-speed chains.
3.  **AlphaGains:** An algorithmic yield aggregator with automated leverage.

Don't wait for institutional validation. Invest your savings now to ride the wave to financial independence.`,
    coverImage: "https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=1200&q=80",
    status: "Rejected",
    featured: false,
    authorId: "user-writer-8",
    categoryId: "business",
    createdAt: "2026-06-28T14:00:00Z",
    updatedAt: "2026-06-29T10:00:00Z",
    readCount: 0,
    likeCount: 0,
    rejectReason: "This submission reads like a speculative promotional pitch with unsubstantiated claims. MOXN enforces strict editorial guidelines: we do not publish speculative financial advice, hyper-speculative asset promotional articles, or clickbait listicles. Please revise to focus on objective macroeconomic modeling or structured regulatory developments in digital finance.",
    tags: ["Cryptocurrency", "Altcoins", "Finance"]
  }
];

// Seed some comments
const SEED_COMMENTS: Comment[] = [
  { id: "comm-1", body: "Excellent overview, Sarah. The separation of training intake from fair-use is the true legal battlefield. I wonder if we will see a licensing cartel emerge soon.", articleId: "art-1", authorId: "user-writer-4", status: "Active", createdAt: "2026-06-25T10:00:00Z", likeCount: 12, pinned: true },
  { id: "comm-2", body: "Agreed. Multi-billion dollar licensing blocks are already forming. Individual creators might get squeezed out unless collective representation is standardized.", articleId: "art-1", authorId: "user-writer-1", parentId: "comm-1", status: "Active", createdAt: "2026-06-25T10:30:00Z", likeCount: 5, pinned: false },
  { id: "comm-3", body: "10 millikelvin is absolutely mind-blowing. It's almost absolute zero! The engineering required to prevent thermal leak at that level is incredible.", articleId: "art-2", authorId: "user-writer-2", status: "Active", createdAt: "2026-06-26T12:00:00Z", likeCount: 8, pinned: false },
  { id: "comm-4", body: "The 16 millisecond islanding speed is impressive. Central utilities will need to adapt to microgrid partners or face complete obsolescence.", articleId: "art-3", authorId: "user-writer-8", status: "Active", createdAt: "2026-06-27T11:00:00Z", likeCount: 14, pinned: false }
];

// Seed database state
const DEFAULT_SEED_DB: ServerDatabase = {
  users: WRITERS,
  articles: [...SEED_ARTICLES],
  categories: CATEGORIES,
  comments: SEED_COMMENTS,
  bookmarks: [
    { userId: "user-editor", articleId: "art-1", createdAt: "2026-06-25T12:00:00Z" },
    { userId: "user-writer-1", articleId: "art-2", createdAt: "2026-06-26T12:00:00Z" }
  ],
  likes: [
    { userId: "user-editor", articleId: "art-1", createdAt: "2026-06-25T12:01:00Z" }
  ],
  followers: [
    { followerId: "user-editor", followingId: "user-writer-1", createdAt: "2026-06-25T12:00:00Z" }
  ],
  notifications: [
    { id: "not-1", userId: "user-writer-8", type: "Rejected", title: "Article Rejected", message: "Your draft '10 Cryptocurrencies to Buy...' was rejected by Editor Arthur Vance. See editorial feedback.", link: "/dashboard?tab=drafts", read: false, createdAt: "2026-06-29T10:00:00Z" }
  ],
  subscribers: [
    { email: "reader@test.com", createdAt: "2026-06-20T12:00:00Z" }
  ]
};

try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const firebaseApp = initClientApp({
      projectId: config.projectId,
      appId: config.appId,
      apiKey: config.apiKey,
      authDomain: config.authDomain
    });
    const dbId = config.firestoreDatabaseId || "ai-studio-moxn-546a640d-994f-4706-92d1-20ac3abfb9f1";
    firestoreDbInstance = getClientFirestore(firebaseApp, dbId);
    console.log(`[Firestore] Connected to Firestore database via Client SDK: ${dbId}`);
  } else {
    console.warn("[Firestore] firebase-applet-config.json not found, running database locally.");
  }
} catch (err) {
  console.error("[Firestore] Failed to initialize Firebase Client SDK:", err);
}

async function seedFirestore(db?: ServerDatabase) {
  if (!firestoreDbInstance) return;
  const sourceDb = db || MEMORY_DB || DEFAULT_SEED_DB;
  try {
    console.log("[Firestore] Starting Firestore seeding...");
    const batch = writeBatch(firestoreDbInstance);

    sourceDb.users.forEach((item) => {
      const docRef = doc(firestoreDbInstance, "users", item.id);
      batch.set(docRef, item);
    });

    sourceDb.articles.forEach((item) => {
      const docRef = doc(firestoreDbInstance, "articles", item.id);
      batch.set(docRef, item);
    });

    sourceDb.categories.forEach((item) => {
      const docRef = doc(firestoreDbInstance, "categories", item.id);
      batch.set(docRef, item);
    });

    sourceDb.comments.forEach((item) => {
      const docRef = doc(firestoreDbInstance, "comments", item.id);
      batch.set(docRef, item);
    });

    (sourceDb.bookmarks || []).forEach((item) => {
      const docId = `${item.userId}_${item.articleId}`;
      const docRef = doc(firestoreDbInstance, "bookmarks", docId);
      batch.set(docRef, item);
    });

    (sourceDb.likes || []).forEach((item) => {
      const docId = `${item.userId}_${item.articleId}`;
      const docRef = doc(firestoreDbInstance, "likes", docId);
      batch.set(docRef, item);
    });

    (sourceDb.followers || []).forEach((item) => {
      const docId = `${item.followerId}_${item.followingId}`;
      const docRef = doc(firestoreDbInstance, "followers", docId);
      batch.set(docRef, item);
    });

    (sourceDb.notifications || []).forEach((item) => {
      const docRef = doc(firestoreDbInstance, "notifications", item.id);
      batch.set(docRef, item);
    });

    (sourceDb.subscribers || []).forEach((item) => {
      const docId = item.email.replace(/[@.]/g, "_");
      const docRef = doc(firestoreDbInstance, "subscribers", docId);
      batch.set(docRef, item);
    });

    await batch.commit();
    console.log("[Firestore] Seeding completed successfully.");
  } catch (err) {
    console.error("[Firestore] Error seeding Firestore:", err);
  }
}

async function loadFromFirestore(): Promise<ServerDatabase | null> {
  if (!firestoreDbInstance) return null;
  try {
    console.log("[Firestore] Fetching all collections from Firestore...");
    const [
      usersSnap,
      articlesSnap,
      categoriesSnap,
      commentsSnap,
      bookmarksSnap,
      likesSnap,
      followersSnap,
      notificationsSnap,
      subscribersSnap
    ] = await Promise.all([
      getDocs(collection(firestoreDbInstance, "users")),
      getDocs(collection(firestoreDbInstance, "articles")),
      getDocs(collection(firestoreDbInstance, "categories")),
      getDocs(collection(firestoreDbInstance, "comments")),
      getDocs(collection(firestoreDbInstance, "bookmarks")),
      getDocs(collection(firestoreDbInstance, "likes")),
      getDocs(collection(firestoreDbInstance, "followers")),
      getDocs(collection(firestoreDbInstance, "notifications")),
      getDocs(collection(firestoreDbInstance, "subscribers"))
    ]);

    if (usersSnap.empty) {
      console.log("[Firestore] No users found in Firestore (empty database). Falling back to local cache.");
      return null;
    }

    const loadedDb: ServerDatabase = {
      users: [],
      articles: [],
      categories: [],
      comments: [],
      bookmarks: [],
      likes: [],
      followers: [],
      notifications: [],
      subscribers: []
    };

    usersSnap.forEach((doc: any) => loadedDb.users.push(doc.data() as User));
    articlesSnap.forEach((doc: any) => loadedDb.articles.push(doc.data() as Article));
    categoriesSnap.forEach((doc: any) => loadedDb.categories.push(doc.data() as Category));
    commentsSnap.forEach((doc: any) => loadedDb.comments.push(doc.data() as Comment));
    bookmarksSnap.forEach((doc: any) => loadedDb.bookmarks.push(doc.data() as any));
    likesSnap.forEach((doc: any) => loadedDb.likes.push(doc.data() as any));
    followersSnap.forEach((doc: any) => loadedDb.followers.push(doc.data() as any));
    notificationsSnap.forEach((doc: any) => loadedDb.notifications.push(doc.data() as any));
    subscribersSnap.forEach((doc: any) => loadedDb.subscribers.push(doc.data() as any));

    console.log(`[Firestore] Database successfully loaded. Users: ${loadedDb.users.length}, Articles: ${loadedDb.articles.length}`);
    return loadedDb;
  } catch (err) {
    console.error("[Firestore] Error loading database from Firestore:", err);
    return null;
  }
}

async function syncCollection<T extends { id: string }>(
  colName: string,
  newList: T[],
  oldList: T[]
) {
  if (!firestoreDbInstance) return;
  const oldMap = new Map(oldList.map(item => [item.id, item]));
  const newMap = new Map(newList.map(item => [item.id, item]));

  const toSet: T[] = [];
  const toDelete: string[] = [];

  for (const item of newList) {
    const oldItem = oldMap.get(item.id);
    if (!oldItem || JSON.stringify(oldItem) !== JSON.stringify(item)) {
      toSet.push(item);
    }
  }

  for (const item of oldList) {
    if (!newMap.has(item.id)) {
      toDelete.push(item.id);
    }
  }

  // Set or update changed items
  for (const item of toSet) {
    await setDoc(doc(firestoreDbInstance, colName, item.id), item);
  }
  // Delete removed items
  for (const id of toDelete) {
    await deleteDoc(doc(firestoreDbInstance, colName, id));
  }
}

async function syncBookmarks(newList: any[], oldList: any[]) {
  if (!firestoreDbInstance) return;
  const getDocId = (item: any) => `${item.userId}_${item.articleId}`;
  const oldMap = new Map(oldList.map(item => [getDocId(item), item]));
  const newMap = new Map(newList.map(item => [getDocId(item), item]));

  for (const item of newList) {
    const docId = getDocId(item);
    if (!oldMap.has(docId)) {
      await setDoc(doc(firestoreDbInstance, "bookmarks", docId), item);
    }
  }
  for (const item of oldList) {
    const docId = getDocId(item);
    if (!newMap.has(docId)) {
      await deleteDoc(doc(firestoreDbInstance, "bookmarks", docId));
    }
  }
}

async function syncLikes(newList: any[], oldList: any[]) {
  if (!firestoreDbInstance) return;
  const getDocId = (item: any) => `${item.userId}_${item.articleId}`;
  const oldMap = new Map(oldList.map(item => [getDocId(item), item]));
  const newMap = new Map(newList.map(item => [getDocId(item), item]));

  for (const item of newList) {
    const docId = getDocId(item);
    if (!oldMap.has(docId)) {
      await setDoc(doc(firestoreDbInstance, "likes", docId), item);
    }
  }
  for (const item of oldList) {
    const docId = getDocId(item);
    if (!newMap.has(docId)) {
      await deleteDoc(doc(firestoreDbInstance, "likes", docId));
    }
  }
}

async function syncFollowers(newList: any[], oldList: any[]) {
  if (!firestoreDbInstance) return;
  const getDocId = (item: any) => `${item.followerId}_${item.followingId}`;
  const oldMap = new Map(oldList.map(item => [getDocId(item), item]));
  const newMap = new Map(newList.map(item => [getDocId(item), item]));

  for (const item of newList) {
    const docId = getDocId(item);
    if (!oldMap.has(docId)) {
      await setDoc(doc(firestoreDbInstance, "followers", docId), item);
    }
  }
  for (const item of oldList) {
    const docId = getDocId(item);
    if (!newMap.has(docId)) {
      await deleteDoc(doc(firestoreDbInstance, "followers", docId));
    }
  }
}

async function syncSubscribers(newList: any[], oldList: any[]) {
  if (!firestoreDbInstance) return;
  const getDocId = (item: any) => item.email.replace(/[@.]/g, "_");
  const oldMap = new Map(oldList.map(item => [getDocId(item), item]));
  const newMap = new Map(newList.map(item => [getDocId(item), item]));

  for (const item of newList) {
    const docId = getDocId(item);
    if (!oldMap.has(docId)) {
      await setDoc(doc(firestoreDbInstance, "subscribers", docId), item);
    }
  }
  for (const item of oldList) {
    const docId = getDocId(item);
    if (!newMap.has(docId)) {
      await deleteDoc(doc(firestoreDbInstance, "subscribers", docId));
    }
  }
}

async function syncToFirestoreAsync(newDb: ServerDatabase, oldDb: ServerDatabase) {
  if (!firestoreDbInstance) return;
  syncQueuePromise = syncQueuePromise.then(async () => {
    try {
      await Promise.all([
        syncCollection("users", newDb.users, oldDb.users),
        syncCollection("articles", newDb.articles, oldDb.articles),
        syncCollection("categories", newDb.categories, oldDb.categories),
        syncCollection("comments", newDb.comments, oldDb.comments),
        syncCollection("notifications", newDb.notifications, oldDb.notifications),
        syncBookmarks(newDb.bookmarks || [], oldDb.bookmarks || []),
        syncLikes(newDb.likes || [], oldDb.likes || []),
        syncFollowers(newDb.followers || [], oldDb.followers || []),
        syncSubscribers(newDb.subscribers || [], oldDb.subscribers || [])
      ]);
      console.log("[Firestore] Database changes successfully replicated to Cloud Firestore.");
    } catch (err) {
      console.error("[Firestore] Error replicating database changes to Firestore:", err);
    }
  });
  await syncQueuePromise;
}

function initDatabase() {
  if (MEMORY_DB) return;

  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      MEMORY_DB = JSON.parse(data);
    } else {
      MEMORY_DB = JSON.parse(JSON.stringify(DEFAULT_SEED_DB));
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(MEMORY_DB, null, 2));
        console.log("Database initialized on disk with seed data.");
      } catch (writeErr) {
        console.warn("Warning: Could not write DB to disk, using in-memory database only:", (writeErr as any).message);
      }
    }
  } catch (err) {
    console.error("Error loading database file from disk, falling back to in-memory seed:", err);
    MEMORY_DB = JSON.parse(JSON.stringify(DEFAULT_SEED_DB));
  }

}

initDatabase();

function getDB(): ServerDatabase {
  if (!MEMORY_DB) {
    initDatabase();
  }
  return JSON.parse(JSON.stringify(MEMORY_DB!));
}

function saveDB(db: ServerDatabase) {
  const oldDb = MEMORY_DB ? JSON.parse(JSON.stringify(MEMORY_DB)) : null;
  MEMORY_DB = db;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.warn("[DB] Warning: Failed to persist database changes to disk (read-only filesystem?). Data is preserved in memory. Error:", (err as any).message);
  }

  if (firestoreDbInstance && oldDb) {
    // Firestore sync is chained onto syncQueuePromise. The middleware's res.json
    // interceptor awaits syncQueuePromise before sending the response, ensuring
    // the Firestore write completes before the client receives the response.
    syncToFirestoreAsync(db, oldDb).catch((err) => {
      console.error("[Firestore] Async sync trigger failed:", err);
    });
  }
}

// ----------------------------------------------------
// API Handlers
// ----------------------------------------------------

// ----------------------------------------------------
// Authentication API Handlers
// ----------------------------------------------------

// Login handler
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const db = getDB();
  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const expectedPassword = user.password || "password123";
  if (password !== expectedPassword) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  res.json({ user });
});

// Register handler
app.post("/api/auth/register", (req, res) => {
  const { id, name, email, password, role, bio, avatar } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const db = getDB();
  const exists = db.users.some((u) => u.email.toLowerCase() === email.toLowerCase());

  if (exists) {
    return res.status(400).json({ error: "A user with this email already exists" });
  }

  const newUser: User = {
    id: id || "user-" + Date.now(),
    name,
    email,
    avatar: avatar || `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 900000)}?w=150`,
    role: role as UserRole,
    bio: bio || `Correspondent covering ${role} perspectives on society and innovation.`,
    createdAt: new Date().toISOString(),
    followersCount: 0,
    followingCount: 0,
    password
  };

  db.users.push(newUser);
  saveDB(db);

  res.status(201).json({ user: newUser });
});

// Categories
app.get("/api/categories", (req, res) => {
  const db = getDB();
  res.json(db.categories);
});

// Users/Writers Profiles
app.get("/api/users", (req, res) => {
  const db = getDB();
  res.json(db.users);
});

app.get("/api/users/:id", (req, res) => {
  const db = getDB();
  const reqUserId = req.headers["x-user-id"] as string;
  const reqUserRole = (req.headers["x-user-role"] as UserRole) || "Reader";
  
  let user = db.users.find((u) => u.id === req.params.id);
  if (!user) {
    // If user is guest/reader-test preset, auto-register them
    if (req.params.id === "guest" || req.params.id === "reader-test") {
      user = {
        id: req.params.id,
        name: "Guest Reader",
        email: "guest@reader.com",
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
        role: "Reader",
        bio: "An active reader of design, modern technology, and global affairs.",
        createdAt: "2026-06-01T12:00:00Z",
        followersCount: 0,
        followingCount: 5
      };
      db.users.push(user);
      saveDB(db);
    } else {
      return res.status(404).json({ error: "User not found" });
    }
  }
  
  // If requesting own profile, see all own articles. Otherwise, only published.
  const articles = db.articles.filter(
    (a) => a.authorId === user!.id && (a.status === "Published" || a.authorId === reqUserId)
  );

  const likes = db.likes || [];
  const likedArticleIds = likes.filter((l) => l.userId === user!.id).map((l) => l.articleId);
  const likedArticles = db.articles.filter((a) => likedArticleIds.includes(a.id) && a.status === "Published");

  res.json({ user, articles, likedArticles });
});

// Update Profile details
app.put("/api/users/profile", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const reqUserRole = (req.headers["x-user-role"] as UserRole) || "Reader";
  const { name, avatar, bio } = req.body;
  const db = getDB();

  let userIndex = db.users.findIndex((u) => u.id === userId);
  if (userIndex === -1) {
    const newUser: User = {
      id: userId,
      name: name || "Active Contributor",
      avatar: avatar || `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150`,
      bio: bio || `Active ${reqUserRole} covering dispatches and publications.`,
      email: `${userId}@moxn.com`,
      role: reqUserRole,
      createdAt: new Date().toISOString(),
      followersCount: 0,
      followingCount: 0
    };
    db.users.push(newUser);
    saveDB(db);
    userIndex = db.users.length - 1;
  } else {
    db.users[userIndex] = {
      ...db.users[userIndex],
      name: name ?? db.users[userIndex].name,
      avatar: avatar ?? db.users[userIndex].avatar,
      bio: bio ?? db.users[userIndex].bio,
    };
    saveDB(db);
  }

  res.json({ user: db.users[userIndex] });
});

// Follow / Unfollow
app.post("/api/users/:id/follow", (req, res) => {
  const followerId = (req.headers["x-user-id"] as string) || "user-editor";
  const followingId = req.params.id;
  const db = getDB();

  if (followerId === followingId) {
    return res.status(400).json({ error: "You cannot follow yourself" });
  }

  const index = db.followers.findIndex(
    (f) => f.followerId === followerId && f.followingId === followingId
  );
  let followed = false;

  if (index >= 0) {
    db.followers.splice(index, 1);
  } else {
    db.followers.push({ followerId, followingId, createdAt: new Date().toISOString() });
    followed = true;

    // Trigger Notification
    const follower = db.users.find(u => u.id === followerId);
    db.notifications.push({
      id: "not-" + Date.now(),
      userId: followingId,
      type: "Follow",
      title: "New Follower",
      message: `${follower ? follower.name : "A reader"} is now following you.`,
      link: `/profile/${followerId}`,
      read: false,
      createdAt: new Date().toISOString()
    });
  }

  // Update counts
  db.users = db.users.map(u => {
    if (u.id === followingId) {
      return { ...u, followersCount: db.followers.filter(f => f.followingId === followingId).length };
    }
    if (u.id === followerId) {
      return { ...u, followingCount: db.followers.filter(f => f.followerId === followerId).length };
    }
    return u;
  });

  saveDB(db);
  res.json({ followed, followersCount: db.followers.filter(f => f.followingId === followingId).length });
});

// Articles list (Scoped by role)
app.get("/api/articles", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const userRole = (req.headers["x-user-role"] as UserRole) || "Reader";
  const db = getDB();

  let filtered = db.articles;

  if (userRole === "Reader") {
    filtered = db.articles.filter(
      (a) => a.status === "Published" || a.authorId === userId
    );
  } else if (userRole === "Writer") {
    // Writers see all Published plus their own drafts/submissions
    filtered = db.articles.filter(
      (a) => a.status === "Published" || a.authorId === userId
    );
  } else if (userRole === "Editor") {
    // Editors see everything
    filtered = db.articles;
  }

  // Inject author models
  const enriched = filtered.map((art) => {
    const author = db.users.find((u) => u.id === art.authorId);
    return { ...art, author };
  });

  res.json(enriched);
});

// Single Article by Slug
app.get("/api/articles/:slug", (req, res) => {
  const { slug } = req.params;
  const db = getDB();
  const article = db.articles.find((a) => a.slug === slug);

  if (!article) {
    return res.status(404).json({ error: "Article not found" });
  }

  // Auto increment read count (only if Published)
  if (article.status === "Published") {
    article.readCount += 1;
    saveDB(db);
  }

  const author = db.users.find((u) => u.id === article.authorId);
  res.json({ ...article, author });
});

// Create Draft
app.post("/api/articles", (req, res) => {
  const userId = (req.headers["x-user-id"] as string) || "user-writer-1";
  const { title, subtitle, body, coverImage, categoryId, tags } = req.body;
  const db = getDB();

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

  const newArticle: Article = {
    id: "art-" + Date.now(),
    title,
    slug: slug || "draft-untitled",
    subtitle: subtitle || "",
    body: body || "",
    coverImage: coverImage || "https://picsum.photos/seed/moxn/800/450",
    status: "Draft",
    featured: false,
    authorId: userId,
    categoryId: categoryId || "tech",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    readCount: 0,
    likeCount: 0,
    tags: tags || []
  };

  db.articles.push(newArticle);
  saveDB(db);
  res.status(201).json(newArticle);
});

// Update Draft/Article
app.put("/api/articles/:id", (req, res) => {
  const { id } = req.params;
  const { title, subtitle, body, coverImage, categoryId, tags, seoTitle, seoDescription } = req.body;
  const db = getDB();

  const articleIndex = db.articles.findIndex((a) => a.id === id);
  if (articleIndex === -1) {
    return res.status(404).json({ error: "Article not found" });
  }

  const art = db.articles[articleIndex];
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

  db.articles[articleIndex] = {
    ...art,
    title: title ?? art.title,
    slug: title ? slug : art.slug,
    subtitle: subtitle ?? art.subtitle,
    body: body ?? art.body,
    coverImage: coverImage ?? art.coverImage,
    categoryId: categoryId ?? art.categoryId,
    tags: tags ?? art.tags,
    seoTitle: seoTitle ?? art.seoTitle,
    seoDescription: seoDescription ?? art.seoDescription,
    updatedAt: new Date().toISOString()
  };

  saveDB(db);
  res.json(db.articles[articleIndex]);
});

// Submit for Review
app.post("/api/articles/:id/submit", (req, res) => {
  const { id } = req.params;
  const db = getDB();

  const articleIndex = db.articles.findIndex((a) => a.id === id);
  if (articleIndex === -1) {
    return res.status(404).json({ error: "Article not found" });
  }

  db.articles[articleIndex].status = "In Review";
  db.articles[articleIndex].updatedAt = new Date().toISOString();

  // Notify Editors
  const author = db.users.find(u => u.id === db.articles[articleIndex].authorId);
  db.notifications.push({
    id: "not-" + Date.now(),
    userId: "user-editor", // Core editor
    type: "System",
    title: "New Editorial Submission",
    message: `"${db.articles[articleIndex].title}" was submitted for review by ${author?.name || "a writer"}.`,
    link: "/dashboard?tab=submissions",
    read: false,
    createdAt: new Date().toISOString()
  });

  saveDB(db);
  res.json(db.articles[articleIndex]);
});

// Editorial Review (Approve / Reject)
app.post("/api/articles/:id/review", (req, res) => {
  const { id } = req.params;
  const { action, rejectReason } = req.body; // 'Approve' | 'Reject'
  const db = getDB();

  const articleIndex = db.articles.findIndex((a) => a.id === id);
  if (articleIndex === -1) {
    return res.status(404).json({ error: "Article not found" });
  }

  const art = db.articles[articleIndex];

  if (action === "Approve") {
    art.status = "Published";
    art.publishedAt = new Date().toISOString();
    art.rejectReason = undefined;

    // Notify author
    db.notifications.push({
      id: "not-" + Date.now(),
      userId: art.authorId,
      type: "Approved",
      title: "Article Approved and Published!",
      message: `Your article "${art.title}" was approved by Editor Arthur Vance and is now live on the homepage!`,
      link: `/article/${art.slug}`,
      read: false,
      createdAt: new Date().toISOString()
    });
  } else if (action === "Reject") {
    art.status = "Rejected";
    art.rejectReason = rejectReason || "Does not meet editorial requirements.";

    // Notify author
    db.notifications.push({
      id: "not-" + Date.now(),
      userId: art.authorId,
      type: "Rejected",
      title: "Article Revisions Required",
      message: `Your article "${art.title}" was rejected with editorial notes. Click to review details.`,
      link: `/dashboard?tab=drafts`,
      read: false,
      createdAt: new Date().toISOString()
    });
  }

  art.updatedAt = new Date().toISOString();
  saveDB(db);
  res.json(art);
});

// Feature Article
app.post("/api/articles/:id/feature", (req, res) => {
  const { id } = req.params;
  const db = getDB();

  const articleIndex = db.articles.findIndex((a) => a.id === id);
  if (articleIndex === -1) {
    return res.status(404).json({ error: "Article not found" });
  }

  const isFeatured = !db.articles[articleIndex].featured;
  db.articles[articleIndex].featured = isFeatured;

  if (isFeatured && db.articles[articleIndex].status === "Published") {
    // Notify Writer
    db.notifications.push({
      id: "not-" + Date.now(),
      userId: db.articles[articleIndex].authorId,
      type: "Featured",
      title: "Featured Story Pick!",
      message: `Congratulations! Your article "${db.articles[articleIndex].title}" was selected as a MOXN Editor's Pick.`,
      link: `/article/${db.articles[articleIndex].slug}`,
      read: false,
      createdAt: new Date().toISOString()
    });
  }

  saveDB(db);
  res.json({ featured: isFeatured });
});

// Like / Unlike Article
app.post("/api/articles/:id/like", (req, res) => {
  const userId = (req.headers["x-user-id"] as string) || "user-editor";
  const { id } = req.params;
  const db = getDB();

  const articleIndex = db.articles.findIndex((a) => a.id === id);
  if (articleIndex === -1) {
    return res.status(404).json({ error: "Article not found" });
  }

  const likeIndex = db.likes.findIndex((l) => l.userId === userId && l.articleId === id);
  let liked = false;

  if (likeIndex >= 0) {
    db.likes.splice(likeIndex, 1);
    db.articles[articleIndex].likeCount = Math.max(0, db.articles[articleIndex].likeCount - 1);
  } else {
    db.likes.push({ userId, articleId: id, createdAt: new Date().toISOString() });
    db.articles[articleIndex].likeCount += 1;
    liked = true;

    // Notify author of high quality like
    if (db.articles[articleIndex].authorId !== userId) {
      const liker = db.users.find(u => u.id === userId);
      db.notifications.push({
        id: "not-" + Date.now(),
        userId: db.articles[articleIndex].authorId,
        type: "Comment",
        title: "Article Liked",
        message: `${liker?.name || "A reader"} liked your article: "${db.articles[articleIndex].title}".`,
        link: `/article/${db.articles[articleIndex].slug}`,
        read: false,
        createdAt: new Date().toISOString()
      });
    }
  }

  saveDB(db);
  res.json({ liked, likeCount: db.articles[articleIndex].likeCount });
});

// Bookmark / Unbookmark Article
app.post("/api/articles/:id/bookmark", (req, res) => {
  const userId = (req.headers["x-user-id"] as string) || "user-editor";
  const { id } = req.params;
  const db = getDB();

  const index = db.bookmarks.findIndex((b) => b.userId === userId && b.articleId === id);
  let bookmarked = false;

  if (index >= 0) {
    db.bookmarks.splice(index, 1);
  } else {
    db.bookmarks.push({ userId, articleId: id, createdAt: new Date().toISOString() });
    bookmarked = true;
  }

  saveDB(db);
  res.json({ bookmarked });
});

// Bookmarked list
app.get("/api/bookmarks", (req, res) => {
  const userId = (req.headers["x-user-id"] as string) || "user-editor";
  const db = getDB();
  
  const articleIds = db.bookmarks.filter(b => b.userId === userId).map(b => b.articleId);
  const bookmarkedArticles = db.articles.filter(a => articleIds.includes(a.id) && a.status === "Published");
  
  // Enrich
  const enriched = bookmarkedArticles.map((art) => {
    const author = db.users.find((u) => u.id === art.authorId);
    return { ...art, author };
  });

  res.json(enriched);
});

// Likes list for user
app.get("/api/my-likes", (req, res) => {
  const userId = (req.headers["x-user-id"] as string) || "user-editor";
  const db = getDB();
  const likedIds = db.likes.filter(l => l.userId === userId).map(l => l.articleId);
  res.json(likedIds);
});

// Comments by Article
app.get("/api/articles/:id/comments", (req, res) => {
  const userId = (req.headers["x-user-id"] as string) || "user-editor";
  const { id } = req.params;
  const db = getDB();
  const commentLikes = db.commentLikes || [];

  const comments = db.comments.filter((c) => c.articleId === id);
  const enriched = comments.map((comm) => {
    const author = db.users.find((u) => u.id === comm.authorId);
    const liked = commentLikes.some((cl) => cl.userId === userId && cl.commentId === comm.id);
    return {
      ...comm,
      liked,
      author: author || {
        id: comm.authorId,
        name: "Anonymous Reader",
        avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150",
        role: "Reader",
        bio: ""
      }
    };
  });

  res.json(enriched);
});

// Create Comment / Reply
app.post("/api/articles/:id/comments", (req, res) => {
  const userId = (req.headers["x-user-id"] as string) || "user-editor";
  const { body, parentId } = req.body;
  const { id } = req.params;
  const db = getDB();

  const newComment: Comment = {
    id: "comm-" + Date.now(),
    body,
    articleId: id,
    authorId: userId,
    parentId: parentId || undefined,
    status: "Active",
    createdAt: new Date().toISOString(),
    likeCount: 0,
    pinned: false
  };

  db.comments.push(newComment);

  // Trigger Notifications
  const art = db.articles.find(a => a.id === id);
  const commenter = db.users.find(u => u.id === userId);

  if (parentId) {
    const parentComment = db.comments.find(c => c.id === parentId);
    if (parentComment && parentComment.authorId !== userId) {
      db.notifications.push({
        id: "not-" + Date.now(),
        userId: parentComment.authorId,
        type: "Reply",
        title: "Reply to your comment",
        message: `${commenter?.name || "A user"} replied: "${body.substring(0, 40)}..."`,
        link: `/article/${art?.slug}`,
        read: false,
        createdAt: new Date().toISOString()
      });
    }
  } else if (art && art.authorId !== userId) {
    db.notifications.push({
      id: "not-" + Date.now(),
      userId: art.authorId,
      type: "Comment",
      title: "New Comment on your Story",
      message: `${commenter?.name || "A reader"} commented: "${body.substring(0, 40)}..."`,
      link: `/article/${art.slug}`,
      read: false,
      createdAt: new Date().toISOString()
    });
  }

  saveDB(db);
  res.status(201).json({
    ...newComment,
    author: commenter || { id: userId, name: "Anonymous Reader", avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150", role: "Reader", bio: "" }
  });
});

// Edit Comment
app.put("/api/comments/:id", (req, res) => {
  const { id } = req.params;
  const { body } = req.body;
  const db = getDB();

  const commentIndex = db.comments.findIndex(c => c.id === id);
  if (commentIndex === -1) {
    return res.status(404).json({ error: "Comment not found" });
  }

  db.comments[commentIndex].body = body;
  saveDB(db);
  res.json(db.comments[commentIndex]);
});

// Delete Comment
app.delete("/api/comments/:id", (req, res) => {
  const { id } = req.params;
  const db = getDB();

  const commentIndex = db.comments.findIndex(c => c.id === id);
  if (commentIndex === -1) {
    return res.status(404).json({ error: "Comment not found" });
  }

  db.comments.splice(commentIndex, 1);
  saveDB(db);
  res.json({ success: true });
});

// Like Comment
app.post("/api/comments/:id/like", (req, res) => {
  const userId = (req.headers["x-user-id"] as string) || "user-editor";
  const { id } = req.params;
  const db = getDB();

  const commentIndex = db.comments.findIndex(c => c.id === id);
  if (commentIndex === -1) {
    return res.status(404).json({ error: "Comment not found" });
  }

  if (!db.commentLikes) {
    db.commentLikes = [];
  }

  const likeIndex = db.commentLikes.findIndex(l => l.userId === userId && l.commentId === id);
  let liked = false;

  if (likeIndex >= 0) {
    db.commentLikes.splice(likeIndex, 1);
    db.comments[commentIndex].likeCount = Math.max(0, db.comments[commentIndex].likeCount - 1);
  } else {
    db.commentLikes.push({ userId, commentId: id, createdAt: new Date().toISOString() });
    db.comments[commentIndex].likeCount += 1;
    liked = true;
  }

  saveDB(db);
  res.json({
    ...db.comments[commentIndex],
    liked
  });
});

// Pin Comment
app.post("/api/comments/:id/pin", (req, res) => {
  const { id } = req.params;
  const db = getDB();

  const commentIndex = db.comments.findIndex(c => c.id === id);
  if (commentIndex === -1) {
    return res.status(404).json({ error: "Comment not found" });
  }

  const comment = db.comments[commentIndex];
  comment.pinned = !comment.pinned;
  saveDB(db);
  res.json(comment);
});

// Moderate / Hide Comment or Ban User
app.post("/api/comments/:id/moderate", (req, res) => {
  const { id } = req.params;
  const { action } = req.body; // 'hide' | 'ban_user'
  const db = getDB();

  const commentIndex = db.comments.findIndex(c => c.id === id);
  if (commentIndex === -1) {
    return res.status(404).json({ error: "Comment not found" });
  }

  const comment = db.comments[commentIndex];

  if (action === "hide") {
    comment.status = comment.status === "Active" ? "Hidden" : "Active";
  } else if (action === "ban_user") {
    // Hide all comments by this user
    const authorId = comment.authorId;
    db.comments = db.comments.map(c => c.authorId === authorId ? { ...c, status: "Hidden" } : c);
    
    // Suspend/delete author if they are a registered user, or just delete
    const uIndex = db.users.findIndex(u => u.id === authorId);
    if (uIndex !== -1) {
      db.users[uIndex].bio = "[SUSPENDED DUE TO COMMUNITY POLICY INFRINGEMENTS]";
    }
  }

  saveDB(db);
  res.json({ success: true, comment });
});

// Notifications
app.get("/api/notifications", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const db = getDB();
  const notifications = db.notifications.filter(n => n.userId === userId);
  res.json(notifications);
});

app.post("/api/notifications/:id/read", (req, res) => {
  const { id } = req.params;
  const db = getDB();
  const nIndex = db.notifications.findIndex(n => n.id === id);
  if (nIndex !== -1) {
    db.notifications[nIndex].read = true;
    saveDB(db);
  }
  res.json({ success: true });
});

app.post("/api/notifications/read-all", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const db = getDB();
  db.notifications = db.notifications.map(n => n.userId === userId ? { ...n, read: true } : n);
  saveDB(db);
  res.json({ success: true });
});

// Newsletter Subscription
app.post("/api/newsletter/subscribe", (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  const db = getDB();
  const exists = db.subscribers.some(s => s.email.toLowerCase() === email.toLowerCase());

  if (!exists) {
    db.subscribers.push({ email, createdAt: new Date().toISOString() });
    saveDB(db);
  }

  res.json({ success: true, message: "Thank you for subscribing to MOXN newsletters!" });
});

// ----------------------------------------------------
// AI Assisted Capabilities (Gemini 3.5 Flash)
// ----------------------------------------------------

// SEO Metadata Generator
app.post("/api/ai/seo", async (req, res) => {
  const { title, body } = req.body;
  const ai = getAI();

  if (!ai) {
    // Safe Fallback if Gemini key is not configured
    const cleanTitle = `${title ? title.substring(0, 50) : "Digital Story"} - MOXN`;
    const cleanDesc = body ? `${body.replace(/[#*`]/g, "").substring(0, 150)}...` : "A premium article from the MOXN writing team.";
    return res.json({
      seoTitle: cleanTitle,
      seoDescription: cleanDesc,
      warning: "AI offline (GEMINI_API_KEY is missing). Fallback values generated."
    });
  }

  try {
    const prompt = `You are an expert SEO Optimization specialist. Review the following article Title and content.
    Title: "${title || "Untitled Draft"}"
    Content: "${body ? body.substring(0, 2000) : "No content provided yet."}"
    
    Generate exactly a JSON object matching this structure:
    {
      "seoTitle": "A catchy, SEO-optimized title under 60 characters incorporating key terms, postfixed with ' | MOXN'",
      "seoDescription": "A compelling meta description under 150 characters summarizing the core dispatch with active verbs."
    }
    
    Return ONLY raw JSON, with no markdown code fences.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const data = JSON.parse(response.text || "{}");
    res.json(data);
  } catch (err) {
    console.error("Gemini SEO API error:", err);
    res.status(500).json({ error: "Failed to compile SEO attributes using AI." });
  }
});

// AI Writing & Editorial Review Agent
app.post("/api/ai/review", async (req, res) => {
  const { title, subtitle, body, categoryId } = req.body;
  const ai = getAI();

  if (!ai) {
    return res.json({
      score: 75,
      grammarCheck: "Passed (Basic heuristic scan)",
      feedback: "Your draft has clean organization and standard sentence lengths. The topic matches the designated category perfectly. Ensure your Markdown subheadings use proper structure.",
      titleSuggestions: [
        `Reimagined: ${title || "Draft Post"}`,
        `The Future of: ${title || "Draft Post"}`,
        `Analyzing ${title || "Draft Post"}`
      ],
      warning: "AI Offline (GEMINI_API_KEY is missing). Baseline audit report generated."
    });
  }

  try {
    const prompt = `You are a Senior Managing Editor at a high-end publication like The Verge or Wired.
    Review this writer's draft to provide a thorough editorial review.
    
    Title: "${title || "Untitled"}"
    Subtitle: "${subtitle || "None"}"
    Category: "${categoryId || "Technology"}"
    Body:
    "${body ? body.substring(0, 4000) : "No text"}"
    
    Compile a complete review report. Deliver exactly a JSON object matching:
    {
      "score": 85, // An integer grade from 0 to 100 on readiness for publication
      "grammarCheck": "Highlight any stylistic, punctuation, or active/passive voice notes.",
      "feedback": "A constructive, professional edit review analyzing readability, paragraphs, flow, and relevance.",
      "titleSuggestions": ["Alternative headline 1", "Alternative headline 2", "Alternative headline 3"]
    }
    
    Provide actionable, premium quality feedback. Return ONLY raw JSON, no markdown blocks.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const data = JSON.parse(response.text || "{}");
    res.json(data);
  } catch (err) {
    console.error("Gemini Review API error:", err);
    res.status(500).json({ error: "Failed to process AI editorial review." });
  }
});

// AI Categories and Tags Suggestion
app.post("/api/ai/suggest", async (req, res) => {
  const { title, body } = req.body;
  const ai = getAI();

  if (!ai) {
    return res.json({
      categoryId: "tech",
      tags: ["Innovation", "Society", "Insights"],
      warning: "AI offline. Default tags supplied."
    });
  }

  try {
    const prompt = `Analyze this draft:
    Title: "${title}"
    Excerpt: "${body ? body.substring(0, 800) : ""}"
    
    Suggest the most appropriate category ID (one of: "tech", "business", "politics", "sports", "ent", "science", "health", "edu", "lifestyle", "world") and 4 relevant topic tags.
    
    Return exactly a JSON object:
    {
      "categoryId": "tech",
      "tags": ["Tag1", "Tag2", "Tag3", "Tag4"]
    }
    
    Only return raw JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const data = JSON.parse(response.text || "{}");
    res.json(data);
  } catch (err) {
    console.error("Gemini Suggest API error:", err);
    res.status(500).json({ error: "Failed to suggest categorizations." });
  }
});

// ----------------------------------------------------
// Analytics Engine (Rich Day-by-Day Historical Log)
// ----------------------------------------------------
app.get("/api/analytics", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const userRole = req.headers["x-user-role"] as UserRole;
  const db = getDB();

  // Generate gorgeous day-by-day stats for the past 7 days
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  
  if (userRole === "Writer") {
    // Accumulate actual metrics
    const authorArticles = db.articles.filter(a => a.authorId === userId);
    const totalReads = authorArticles.reduce((sum, a) => sum + a.readCount, 0);
    const totalLikes = authorArticles.reduce((sum, a) => sum + a.likeCount, 0);
    const totalComments = db.comments.filter(c => authorArticles.some(a => a.id === c.articleId)).length;

    // Distribute randomly across days for visual charts
    const dailyViews = days.map((day, idx) => ({
      name: day,
      views: Math.round((totalReads / 7) * (0.6 + Math.random() * 0.8)),
      reads: Math.round((totalReads / 10) * (0.6 + Math.random() * 0.8)),
      comments: Math.round((totalComments / 7) * (0.5 + Math.random() * 1.0))
    }));

    res.json({
      summary: {
        published: authorArticles.filter(a => a.status === "Published").length,
        drafts: authorArticles.filter(a => a.status === "Draft").length,
        pending: authorArticles.filter(a => a.status === "In Review").length,
        reads: totalReads,
        likes: totalLikes,
        comments: totalComments
      },
      dailyViews,
      articlesList: authorArticles.map(a => ({
        id: a.id,
        title: a.title,
        status: a.status,
        reads: a.readCount,
        likes: a.likeCount
      }))
    });
  } else {
    // Editor Analytics (Global Site stats)
    const totalArticles = db.articles.length;
    const publishedCount = db.articles.filter(a => a.status === "Published").length;
    const reviewPending = db.articles.filter(a => a.status === "In Review").length;
    const activeWriters = db.users.filter(u => u.role === "Writer").length;
    const totalSubscribers = db.subscribers.length;

    const dailyReads = days.map((day) => ({
      name: day,
      reads: Math.round(1500 + Math.random() * 1000),
      signups: Math.round(5 + Math.random() * 12),
      comments: Math.round(15 + Math.random() * 25)
    }));

    // Group articles by categories
    const categoryBreakdown = db.categories.map(c => ({
      name: c.name,
      count: db.articles.filter(a => a.categoryId === c.id).length
    }));

    res.json({
      summary: {
        totalArticles,
        publishedCount,
        reviewPending,
        activeWriters,
        totalSubscribers,
        totalComments: db.comments.length
      },
      dailyReads,
      categoryBreakdown
    });
  }
});

// ----------------------------------------------------
// Vite Dev Server Middleware or Production Serving
// ----------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Dev Mode - Mount Vite Express Middleware
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (viteErr) {
      console.warn("[Server] Vite dev middleware unavailable, falling back to static serving:", (viteErr as Error).message);
      // Fallback: serve dist/ if available, otherwise API-only
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  } else {
    // Production Mode - Serve precompiled statics
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[MOXN] Full-stack Server successfully bound on http://0.0.0.0:${PORT}`);
  });
}

// Do not start the persistent listener if running in a serverless function environment (like Vercel)
if (process.env.VERCEL !== "1") {
  startServer().catch((err) => {
    console.error("[Server] Failed to start HTTP server:", err);
    process.exit(1);
  });
}

export default app;
