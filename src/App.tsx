/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { 
  Clock, 
  Heart, 
  Bookmark, 
  Share2, 
  ArrowLeft, 
  Eye, 
  UserCheck, 
  UserPlus, 
  TrendingUp, 
  Sliders, 
  CheckCircle,
  AlertCircle,
  HelpCircle,
  Mail,
  Award,
  ChevronRight,
  ChevronLeft,
  X,
  Search
} from "lucide-react";
import { api, getActiveUser, getActiveUserRole, setActiveUser as setApiActiveUser } from "./lib/api.js";
import { Article, Category, User } from "./types.js";

// Components
import Navbar from "./components/Navbar.js";
import Footer from "./components/Footer.js";
import CommentSection from "./components/CommentSection.js";
import RichTextEditor from "./components/RichTextEditor.js";
import DashboardWriter from "./components/DashboardWriter.js";
import DashboardEditor from "./components/DashboardEditor.js";
import UserProfile from "./components/UserProfile.js";

interface ArticleViewProps {
  viewParams: any;
  likedIds: string[];
  bookmarkedIds: string[];
  setLikedIds: React.Dispatch<React.SetStateAction<string[]>>;
  setBookmarkedIds: React.Dispatch<React.SetStateAction<string[]>>;
  followingIds: string[];
  activeUser: User;
  writers: User[];
  triggerBanner: (type: "success" | "error", message: string) => void;
  handleNavigate: (view: string, params?: any) => void;
  handleToggleFollow: (id: string) => Promise<void>;
  handleShare: (slug: string, title: string, e?: React.MouseEvent) => void;
  getReadTime: (bodyText: string) => string;
  setArticles: React.Dispatch<React.SetStateAction<Article[]>>;
  handleToggleLike: (id: string, e?: React.MouseEvent) => void;
  handleToggleBookmark: (id: string, e?: React.MouseEvent) => void;
}

function ArticleView({
  viewParams,
  likedIds,
  bookmarkedIds,
  setLikedIds,
  setBookmarkedIds,
  followingIds,
  activeUser,
  writers,
  triggerBanner,
  handleNavigate,
  handleToggleFollow,
  handleShare,
  getReadTime,
  setArticles,
  handleToggleLike,
  handleToggleBookmark
}: ArticleViewProps) {
  const { slug } = viewParams;
  const [article, setArticle] = useState<any | null>(null);
  const [liked, setLiked] = useState<boolean>(false);
  const [bookmarked, setBookmarked] = useState<boolean>(false);
  const [related, setRelated] = useState<Article[]>([]);

  useEffect(() => {
    const fetchArticle = async () => {
      try {
        const data = await api.getArticleBySlug(slug);
        setArticle(data);
        
        // Set related stories (excluding active story)
        const resp = await api.getArticles();
        setRelated(resp.filter((a: any) => a.id !== data.id && a.status === "Published").slice(0, 3));
      } catch (err) {
        console.error(err);
      }
    };
    fetchArticle();
  }, [slug]);

  useEffect(() => {
    if (article) {
      setLiked(likedIds.includes(article.id));
    }
  }, [likedIds, article?.id]);

  useEffect(() => {
    if (article) {
      setBookmarked(bookmarkedIds.includes(article.id));
    }
  }, [bookmarkedIds, article?.id]);

  if (!article) {
    return (
      <div className="py-24 text-center">
        <Clock className="w-8 h-8 text-[#1E3A8A] animate-spin mx-auto" />
        <p className="text-xs font-bold text-gray-500 mt-2">Loading article assets...</p>
      </div>
    );
  }

  const isFollowing = followingIds.includes(article.authorId);

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      
      {/* Back and Action strip */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-4 text-xs font-bold text-gray-500">
        <button 
          onClick={() => handleNavigate("home")}
          className="flex items-center space-x-1.5 hover:text-[#1E3A8A] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Editorial Feed</span>
        </button>

        <div className="flex items-center space-x-4">
          <button 
            onClick={() => handleToggleLike(article.id)}
            className={`flex items-center space-x-1 hover:text-red-500 transition-colors ${liked ? "text-red-500 font-extrabold" : ""}`}
          >
            <Heart className={`w-4 h-4 ${liked ? "fill-red-500 text-red-500" : ""}`} />
            <span>{article.likeCount} Likes</span>
          </button>

          <button 
            onClick={() => handleToggleBookmark(article.id)}
            className={`hover:text-[#1E3A8A] transition-colors ${bookmarked ? "text-blue-600 font-extrabold" : ""}`}
          >
            <Bookmark className={`w-4 h-4 ${bookmarked ? "fill-blue-600 text-blue-600" : ""}`} />
          </button>

          <button 
            onClick={() => handleShare(article.slug, article.title)}
            className="hover:text-gray-800 transition-colors"
          >
            <Share2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Headline block */}
      <div className="space-y-4">
        <span className="text-[10px] font-bold text-[#1E3A8A] bg-blue-50 px-3 py-1 rounded-full uppercase tracking-widest">
          {article.categoryId}
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 leading-tight font-sans tracking-tight">
          {article.title}
        </h1>
        <p className="text-sm text-gray-500 font-medium leading-relaxed italic border-l-2 border-blue-500 pl-4 py-0.5">
          {article.subtitle}
        </p>
      </div>

      {/* Cover Photo */}
      {article.coverImage && (
        <div className="rounded-3xl overflow-hidden aspect-16/9 shadow-sm border border-gray-100 bg-gray-50">
          <img 
            src={article.coverImage} 
            alt={article.title} 
            className="w-full h-full object-cover" 
            referrerPolicy="no-referrer"
          />
        </div>
      )}

      {/* Contributor Header Card */}
      <div className="flex items-center justify-between border-y border-gray-100 py-4">
        <button 
          onClick={() => handleNavigate("profile", { userId: article.authorId })}
          className="flex items-center space-x-3.5 text-left group cursor-pointer"
        >
          <img 
            src={article.author?.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150"} 
            alt={article.author?.name} 
            className="w-10 h-10 rounded-full object-cover border border-gray-100 shadow-xs group-hover:ring-2 group-hover:ring-blue-500 transition-all" 
            referrerPolicy="no-referrer"
          />
          <div>
            <p className="text-xs font-bold text-gray-800 group-hover:text-blue-600 transition-colors">{article.author?.name}</p>
            <p className="text-[10px] text-gray-400">Staff Contributor • {new Date(article.publishedAt || article.createdAt).toLocaleDateString()}</p>
          </div>
        </button>

        <div className="flex items-center space-x-3 text-[10px] font-bold">
          <span className="text-gray-400 bg-gray-50 px-2.5 py-1 rounded font-mono">{getReadTime(article.body)}</span>
          
          {activeUser.id !== article.authorId && (
            <button
              onClick={() => handleToggleFollow(article.authorId)}
              className={`px-3 py-1.5 rounded-full flex items-center space-x-1 ${isFollowing ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            >
              {isFollowing ? <UserCheck className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
              <span>{isFollowing ? "Following" : "Follow"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Longform reading container (Targeting 65-75 chars per line for readability) */}
      <article className="prose prose-sm max-w-none text-xs text-gray-800 leading-relaxed font-sans space-y-5">
        {article.body.split("\n\n").map((para: string, i: number) => {
          if (para.startsWith("### ")) {
            return <h3 key={i} className="text-sm font-extrabold text-[#1E3A8A] pt-4 tracking-tight">{para.replace("### ", "")}</h3>;
          }
          if (para.startsWith("#### ")) {
            return <h4 key={i} className="text-xs font-bold text-gray-800 pt-2">{para.replace("#### ", "")}</h4>;
          }
          if (para.startsWith("* ")) {
            return (
              <ul key={i} className="list-disc pl-5 space-y-1 text-gray-700">
                {para.split("\n").map((li, j) => (
                  <li key={j}>{li.replace("* ", "")}</li>
                ))}
              </ul>
            );
          }
          return <p key={i} className="leading-relaxed">{para}</p>;
        })}
      </article>

      {/* Tags list */}
      {article.tags && article.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-4">
          {article.tags.map((t: string, idx: number) => (
            <span key={idx} className="bg-gray-50 hover:bg-gray-100 text-gray-500 font-bold border border-gray-100 px-3 py-1 rounded-full text-[9px] uppercase tracking-wider">
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* Threaded Discussion board */}
      <CommentSection articleId={article.id} articleAuthorId={article.authorId} onNavigate={handleNavigate} triggerBanner={triggerBanner} />

      {/* Related articles matrix */}
      {related.length > 0 && (
        <div className="border-t border-gray-100 pt-10 space-y-6">
          <h4 className="text-xs font-black text-gray-800 uppercase tracking-widest">You might also read</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {related.map(art => (
              <div 
                key={art.id}
                onClick={() => handleNavigate("article", { slug: art.slug })}
                className="group cursor-pointer space-y-2 text-xs"
              >
                <img 
                  src={art.coverImage} 
                  alt={art.title} 
                  className="aspect-video w-full object-cover rounded-xl border border-gray-50 shadow-xs group-hover:opacity-90"
                  referrerPolicy="no-referrer"
                />
                <div>
                  <span className="text-[9px] font-bold text-[#1E3A8A] uppercase tracking-wider">{art.categoryId}</span>
                  <h5 className="font-bold text-gray-800 leading-snug group-hover:text-[#2563EB] line-clamp-2 mt-0.5">{art.title}</h5>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

interface BookmarksViewProps {
  bookmarkedIds: string[];
  handleNavigate: (view: string, params?: any) => void;
  renderArticleCard: (art: Article) => React.ReactNode;
}

function BookmarksView({
  bookmarkedIds,
  handleNavigate,
  renderArticleCard
}: BookmarksViewProps) {
  const [bookmarkedList, setBookmarkedList] = useState<Article[]>([]);
  const [loadingB, setLoadingB] = useState(false);

  useEffect(() => {
    setLoadingB(true);
    api.getBookmarks().then(res => {
      setBookmarkedList(res);
      setLoadingB(false);
    }).catch(err => console.error(err));
  }, [bookmarkedIds]);

  return (
    <div className="space-y-6">
      
      {/* Back navigation button */}
      <div>
        <button 
          onClick={() => handleNavigate("home")}
          className="inline-flex items-center space-x-1.5 text-xs font-bold text-gray-500 hover:text-[#1E3A8A] transition-colors bg-gray-50 hover:bg-gray-100 rounded-full px-3.5 py-1.5 border border-gray-200"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Editorial Feed</span>
        </button>
      </div>

      <div className="border-b border-gray-100 pb-5">
        <h1 className="text-xl font-extrabold text-gray-900 tracking-tight">Your Reading List</h1>
        <p className="text-xs text-gray-500 mt-0.5">Quickly access articles you bookmarked for later deep reading.</p>
      </div>

      {loadingB ? (
        <div className="text-center py-12 text-gray-400 text-xs">Syncing bookmarks list...</div>
      ) : bookmarkedList.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-3xl p-16 text-center text-gray-400 text-xs">
          <Bookmark className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p>Your bookmark folder is empty.</p>
          <button 
            onClick={() => handleNavigate("home")} 
            className="mt-3.5 bg-[#1E3A8A] text-white px-4 py-1.5 rounded-full font-bold"
          >
            Discover dispatches
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {bookmarkedList.map(art => renderArticleCard(art))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [currentView, setCurrentView] = useState<string>("home");
  const [viewParams, setViewParams] = useState<any>({});
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [writers, setWriters] = useState<User[]>([]);
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>([]);
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [activeUser, setActiveUser] = useState<User>(getActiveUser());
  const [loading, setLoading] = useState<boolean>(true);
  const loadBaseDataId = useRef(0);

  // Message banners
  const [banner, setBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const triggerBanner = (type: "success" | "error", message: string) => {
    setBanner({ type, message });
    setTimeout(() => setBanner(null), 4000);
  };

  const loadBaseData = async () => {
    const callId = ++loadBaseDataId.current;
    setLoading(true);
    try {
      // Self-heal session: check if the logged in active user still exists on the server.
      // If the server restarted and lost the user, re-register them transparently before fetching other endpoints.
      let currentUser = activeUser;
      if (currentUser && currentUser.id) {
        try {
          const profileData = await api.getProfile(currentUser.id);
          if (profileData && profileData.user) {
            currentUser = profileData.user;
            if (callId === loadBaseDataId.current) {
              setApiActiveUser(profileData.user);
              setActiveUser(profileData.user);
            }
          }
        } catch (profileErr: any) {
          if (callId !== loadBaseDataId.current) return;
          if (currentUser.id !== "guest") {
            console.warn("Active user not found on server, attempting transparent session restore:", profileErr);
            const credsStr = localStorage.getItem("moxn_user_credentials");
            if (credsStr) {
              try {
                const creds = JSON.parse(credsStr);
                if (creds && creds.email) {
                  // Re-register with the EXACT same ID on the server
                  const response = await api.register({
                    id: creds.id || currentUser.id,
                    name: creds.name,
                    email: creds.email,
                    password: creds.password,
                    role: creds.role,
                    bio: creds.bio,
                    avatar: creds.avatar
                  });
                  if (callId !== loadBaseDataId.current) return;
                  // Update local storage and reference to match the restored user
                  setApiActiveUser(response.user);
                  setActiveUser(response.user);
                  currentUser = response.user;
                  console.log("Session restore completed successfully.");
                }
              } catch (restoreErr) {
                console.error("Failed to restore session automatically:", restoreErr);
              }
            }
          }
        }
      }

      if (callId !== loadBaseDataId.current) return;

      const [cats, arts, wrts, bkmks, lks] = await Promise.all([
        api.getCategories(),
        api.getArticles(),
        api.getWriters(),
        currentUser.id ? api.getBookmarks() : Promise.resolve([]),
        currentUser.id ? api.getMyLikes() : Promise.resolve([])
      ]);

      if (callId !== loadBaseDataId.current) return;

      setCategories(cats);
      setArticles(arts);
      setWriters(wrts);
      setBookmarkedIds(bkmks.map((b: any) => b.id));
      setLikedIds(lks);

      // Simple local track of followed writers
      const simulatedFollowing = localStorage.getItem(`moxn_following_${currentUser.id}`);
      if (simulatedFollowing) {
        setFollowingIds(JSON.parse(simulatedFollowing));
      } else {
        setFollowingIds(["user-writer-1"]); // Default seed follow Sarah Jenkins
      }
    } catch (err) {
      console.error("Failed to sync client with database API:", err);
    } finally {
      if (callId === loadBaseDataId.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadBaseData();

    const handleAuthChange = () => {
      const updatedUser = getActiveUser();
      setActiveUser(updatedUser);
    };

    window.addEventListener("moxn_auth_changed", handleAuthChange);
    return () => {
      window.removeEventListener("moxn_auth_changed", handleAuthChange);
    };
  }, [activeUser.id, currentView]);

  const handleNavigate = (view: string, params: any = {}) => {
    if ((view === "write" || view === "dashboard") && activeUser.role === "Reader") {
      triggerBanner("error", "Access Denied: Only Writers (Creators) and Editors (Admins) can create, publish, or edit articles.");
      return;
    }
    setCurrentView(view);
    setViewParams(params);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleToggleLike = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    if (!activeUser.id || activeUser.id === "guest") {
      triggerBanner("error", "Please sign in to like articles.");
      return;
    }
    
    try {
      const resp = await api.toggleLike(id);
      setArticles(prev => prev.map(a => a.id === id ? { ...a, likeCount: resp.likeCount } : a));
      
      if (resp.liked) {
        setLikedIds(prev => [...prev, id]);
        triggerBanner("success", "Story added to your liked publications.");
      } else {
        setLikedIds(prev => prev.filter(i => i !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleBookmark = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    if (!activeUser.id || activeUser.id === "guest") {
      triggerBanner("error", "Please sign in to bookmark articles.");
      return;
    }
    
    try {
      const resp = await api.toggleBookmark(id);
      if (resp.bookmarked) {
        setBookmarkedIds(prev => [...prev, id]);
        triggerBanner("success", "Dispatch bookmarked successfully.");
      } else {
        setBookmarkedIds(prev => prev.filter(i => i !== id));
        triggerBanner("success", "Removed from bookmarks.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleFollow = async (id: string) => {
    try {
      const resp = await api.toggleFollow(id);
      setWriters(prev => prev.map(w => w.id === id ? { ...w, followersCount: resp.followersCount } : w));
      
      let newFollowing;
      if (resp.followed) {
        newFollowing = [...followingIds, id];
        triggerBanner("success", "You are now following this contributor's updates.");
      } else {
        newFollowing = followingIds.filter(i => i !== id);
        triggerBanner("success", "Unfollowed contributor.");
      }
      setFollowingIds(newFollowing);
      localStorage.setItem(`moxn_following_${activeUser.id}`, JSON.stringify(newFollowing));
    } catch (err) {
      console.error(err);
    }
  };

  const handleShare = (slug: string, title: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const shareUrl = `${window.location.origin}/article/${slug}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl);
      triggerBanner("success", "Share URL copied to clipboard.");
    } else {
      alert(`Share this dispatch: ${shareUrl}`);
    }
  };

  // Filter Articles based on Category, Search Query and status
  const publishedArticles = articles.filter(a => a.status === "Published");

  const filteredArticles = publishedArticles.filter(art => {
    const matchesCategory = activeCategory ? art.categoryId === activeCategory : true;
    
    const matchesSearch = searchQuery
      ? art.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        art.subtitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
        art.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
        art.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
      : true;

    return matchesCategory && matchesSearch;
  });

  const featuredStory = publishedArticles.find(a => a.featured) || publishedArticles[0];
  const trendingStories = publishedArticles.slice(0, 3);
  const editorPicks = publishedArticles.filter(a => a.featured).slice(0, 4);

  // Helper to calculate reading speed
  const getReadTime = (bodyText: string) => {
    const words = bodyText.split(/\s+/).length;
    const minutes = Math.ceil(words / 200);
    return `${minutes} min read`;
  };

  // Render layouts
  const renderHome = () => {
    return (
      <div className="space-y-12">
        
        {/* Category horizontal bar */}
        <div className="border-y border-gray-100 py-3 flex items-center justify-between overflow-x-auto scrollbar-none text-xs font-bold text-gray-500 whitespace-nowrap">
          <div className="flex items-center space-x-6">
            <button 
              onClick={() => setActiveCategory(null)}
              className={`pb-1 px-1 transition-all ${activeCategory === null ? "text-[#1E3A8A] border-b-2 border-[#1E3A8A] font-extrabold" : "hover:text-gray-800"}`}
            >
              All Despatches
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`pb-1 px-1 transition-all capitalize ${activeCategory === cat.id ? "text-[#1E3A8A] border-b-2 border-[#1E3A8A] font-extrabold" : "hover:text-gray-800"}`}
              >
                {cat.name}
              </button>
            ))}
          </div>
          <div className="hidden lg:flex items-center space-x-1 text-emerald-600 uppercase tracking-widest text-[10px]">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>REAL-TIME EDITORIAL TELEMETRY ACTIVE</span>
          </div>
        </div>

        {/* Home content split */}
        {searchQuery ? (
          /* Search results layout */
          <div className="space-y-6">
            <h2 className="text-sm font-extrabold text-gray-800">
              Search Results for <span className="text-[#2563EB]">"{searchQuery}"</span> ({filteredArticles.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredArticles.map(art => renderArticleCard(art))}
            </div>
          </div>
        ) : activeCategory ? (
          /* Category landing layout */
          <div className="space-y-8">
            <div className="bg-blue-50/50 rounded-3xl p-8 border border-blue-100">
              <span className="text-[10px] font-bold text-[#1E3A8A] uppercase tracking-wider bg-blue-100 px-3 py-1 rounded-full">SECTION</span>
              <h1 className="text-xl sm:text-2xl font-black text-[#1E3A8A] mt-2 capitalize">
                {categories.find(c => c.id === activeCategory)?.name}
              </h1>
              <p className="text-xs text-gray-500 mt-1 max-w-xl">
                {categories.find(c => c.id === activeCategory)?.description}
              </p>
            </div>
            {filteredArticles.length === 0 ? (
              <p className="text-center py-16 text-gray-400 text-xs font-medium">No stories archived in this section yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {filteredArticles.map(art => renderArticleCard(art))}
              </div>
            )}
          </div>
        ) : (
          /* Editorial Master Front Page */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            
            {/* Main column (8 cols) */}
            <div className="lg:col-span-8 space-y-12">
              
              {/* Cover Hero Banner (Featured Story) */}
              {featuredStory && (
                <motion.div 
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  onClick={() => handleNavigate("article", { slug: featuredStory.slug })}
                  className="group cursor-pointer space-y-4"
                >
                  <div className="relative overflow-hidden rounded-3xl aspect-16/9 bg-gray-50 border border-gray-100 shadow-sm">
                    <img 
                      src={featuredStory.coverImage} 
                      alt={featuredStory.title} 
                      className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute top-4 left-4 bg-[#1E3A8A]/90 text-white font-mono text-[9px] font-bold px-3 py-1 rounded-full uppercase tracking-widest shadow-lg flex items-center">
                      <Award className="w-3.5 h-3.5 mr-1 fill-white text-white" /> Curated Pick
                    </div>
                  </div>
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-[#1E3A8A] uppercase tracking-widest">
                      {featuredStory.categoryId}
                    </span>
                    <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight leading-snug group-hover:text-[#2563EB] transition-colors font-sans">
                      {featuredStory.title}
                    </h2>
                    <p className="text-xs text-gray-500 leading-relaxed max-w-2xl line-clamp-2">
                      {featuredStory.subtitle}
                    </p>
                    <div className="flex items-center space-x-3 text-[10px] text-gray-400 font-bold pt-1">
                      <span>By {writers.find(w => w.id === featuredStory.authorId)?.name}</span>
                      <span>•</span>
                      <span>{getReadTime(featuredStory.body)}</span>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Latest Stream Section */}
              <div id="latest-stories-section" className="space-y-8 pt-8 border-t border-gray-100">
                <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest flex items-center">
                  <span className="inline-block w-2.5 h-2.5 bg-blue-600 rounded-full mr-2"></span>
                  Chronological Dispatches
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {publishedArticles.filter(a => a.id !== featuredStory?.id).map(art => renderArticleCard(art))}
                </div>
              </div>

            </div>

            {/* Sidebar (4 cols) */}
            <div className="lg:col-span-4 space-y-12">
              
              {/* Trending stories widget */}
              <div className="bg-gray-50/50 border border-gray-100 p-6 rounded-3xl space-y-4">
                <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest flex items-center">
                  <TrendingUp className="w-4 h-4 mr-1.5 text-[#1E3A8A]" /> Most Read Now
                </h3>
                <div className="space-y-4">
                  {trendingStories.map((art, idx) => (
                    <div 
                      key={art.id} 
                      onClick={() => handleNavigate("article", { slug: art.slug })}
                      className="flex items-start space-x-4 cursor-pointer group"
                    >
                      <span className="font-mono text-xl font-black text-gray-200 group-hover:text-[#1E3A8A] transition-colors">
                        0{idx + 1}
                      </span>
                      <div className="space-y-0.5">
                        <span className="text-[9px] font-bold text-[#1E3A8A] uppercase tracking-wider">{art.categoryId}</span>
                        <h4 className="text-xs font-bold text-gray-800 leading-snug group-hover:text-[#2563EB] transition-colors line-clamp-2">
                          {art.title}
                        </h4>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Popular Contributors widget */}
              <div className="space-y-4">
                <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest">
                  Staff Writers
                </h3>
                <div className="space-y-3.5">
                  {writers.slice(0, 4).map(writer => {
                    const isFollowing = followingIds.includes(writer.id);
                    return (
                      <div key={writer.id} className="flex items-center justify-between">
                        <button 
                          onClick={() => handleNavigate("profile", { userId: writer.id })}
                          className="flex items-center space-x-3 text-left group cursor-pointer"
                        >
                          <img 
                            src={writer.avatar} 
                            alt={writer.name} 
                            className="w-9 h-9 rounded-full object-cover border border-gray-100 shadow-xs group-hover:ring-2 group-hover:ring-blue-500 transition-all shrink-0" 
                            referrerPolicy="no-referrer"
                          />
                          <div>
                            <p className="text-xs font-bold text-gray-800 group-hover:text-blue-600 transition-colors">{writer.name}</p>
                            <p className="text-[10px] text-gray-400 line-clamp-1">{writer.bio}</p>
                          </div>
                        </button>

                        <button
                          onClick={() => handleToggleFollow(writer.id)}
                          className={`p-1.5 rounded-full shrink-0 ${isFollowing ? "bg-blue-50 text-blue-600 hover:bg-blue-100" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                        >
                          {isFollowing ? <UserCheck className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

          </div>
        )}
      </div>
    );
  };

  const renderArticleCard = (art: Article) => {
    const isBookmarked = bookmarkedIds.includes(art.id);
    const isLiked = likedIds.includes(art.id);
    const writer = writers.find(w => w.id === art.authorId);

    return (
      <motion.div 
        key={art.id}
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        onClick={() => handleNavigate("article", { slug: art.slug })}
        className="group cursor-pointer flex flex-col space-y-3"
      >
        <div className="relative overflow-hidden rounded-2xl aspect-4/3 bg-gray-50 border border-gray-100 shadow-xs">
          <img 
            src={art.coverImage} 
            alt={art.title} 
            className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300" 
            referrerPolicy="no-referrer"
          />
          
          <div className="absolute top-2.5 right-2.5 flex space-x-1">
            <button
              onClick={(e) => handleToggleBookmark(art.id, e)}
              className={`p-1.5 rounded-full shadow-md backdrop-blur-xs transition-colors ${isBookmarked ? "bg-blue-600 text-white" : "bg-white/80 text-gray-600 hover:bg-white"}`}
            >
              <Bookmark className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="space-y-1.5 flex-1 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[9px] font-bold text-[#1E3A8A] bg-blue-50 px-2 py-0.5 rounded uppercase tracking-wider">
                {art.categoryId}
              </span>
              <span className="text-[9px] text-gray-400 font-mono">{getReadTime(art.body)}</span>
            </div>
            <h3 className="text-xs font-extrabold text-gray-800 leading-snug group-hover:text-[#2563EB] transition-colors mt-1 font-sans line-clamp-2">
              {art.title}
            </h3>
            <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2 mt-0.5">
              {art.subtitle}
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-gray-50 pt-2.5 mt-2 text-[10px] text-gray-400 font-bold">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handleNavigate("profile", { userId: art.authorId });
              }}
              className="flex items-center space-x-1.5 hover:text-[#2563EB] cursor-pointer transition-colors"
            >
              <img 
                src={writer?.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150"} 
                alt={writer?.name} 
                className="w-4 h-4 rounded-full object-cover" 
                referrerPolicy="no-referrer"
              />
              <span>{writer?.name}</span>
            </button>
            <div className="flex items-center space-x-2">
              <button 
                onClick={(e) => handleToggleLike(art.id, e)}
                className={`flex items-center space-x-0.5 hover:text-red-500 ${isLiked ? "text-red-500" : ""}`}
              >
                <Heart className={`w-3.5 h-3.5 ${isLiked ? "fill-red-500" : ""}`} />
                <span>{art.likeCount}</span>
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  const renderWritersView = () => {
    return (
      <div className="space-y-6">
        
        {/* Back navigation button */}
        <div>
          <button 
            onClick={() => handleNavigate("home")}
            className="inline-flex items-center space-x-1.5 text-xs font-bold text-gray-500 hover:text-[#1E3A8A] transition-colors bg-gray-50 hover:bg-gray-100 rounded-full px-3.5 py-1.5 border border-gray-200"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Editorial Feed</span>
          </button>
        </div>

        <div className="border-b border-gray-100 pb-5">
          <h1 className="text-xl font-extrabold text-gray-900 tracking-tight">Contributing Correspondents</h1>
          <p className="text-xs text-gray-500 mt-0.5">Meet the technical journalists, researchers, and culture critics behind the MOXN editorial desk.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {writers.map(writer => {
            const isFollowing = followingIds.includes(writer.id);
            const isSuspended = writer.bio.includes("[SUSPENDED]");
            return (
              <div 
                key={writer.id} 
                className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-4"
              >
                <button
                  onClick={() => handleNavigate("profile", { userId: writer.id })}
                  className="flex items-start space-x-4 text-left group cursor-pointer w-full"
                >
                  <img 
                    src={writer.avatar} 
                    alt={writer.name} 
                    className="w-12 h-12 rounded-full object-cover border border-gray-200 group-hover:ring-2 group-hover:ring-blue-500 transition-all shrink-0" 
                    referrerPolicy="no-referrer"
                  />
                  <div className="space-y-1">
                    <div className="flex items-center space-x-1.5">
                      <h3 className="text-xs font-bold text-gray-800 group-hover:text-blue-600 transition-colors">{writer.name}</h3>
                      <span className="text-[9px] font-bold text-[#1E3A8A] uppercase tracking-wider bg-blue-50 px-2 py-0.5 rounded">
                        {writer.role}
                      </span>
                    </div>
                    <p className={`text-xs ${isSuspended ? "text-red-500 font-bold" : "text-gray-500"} leading-relaxed line-clamp-3`}>{writer.bio}</p>
                  </div>
                </button>

                <div className="flex items-center justify-between border-t border-gray-50 pt-4 text-[10px] text-gray-400 font-bold">
                  <span>{writer.followersCount.toLocaleString()} Followers</span>
                  
                  {activeUser.id !== writer.id && (
                    <button
                      onClick={() => handleToggleFollow(writer.id)}
                      disabled={isSuspended}
                      className={`px-3 py-1.5 rounded-full flex items-center space-x-1 text-xs ${isFollowing ? "bg-blue-50 text-blue-600 hover:bg-blue-100" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                    >
                      {isFollowing ? <UserCheck className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                      <span>{isFollowing ? "Following" : "Follow"}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWriteView = () => {
    const editId = viewParams?.id;
    const matchedArticle = articles.find(a => a.id === editId) || null;
    
    return (
      <RichTextEditor 
        articleId={editId}
        article={matchedArticle}
        categories={categories}
        onSaveSuccess={() => {
          triggerBanner("success", "Draft successfully synced to publisher servers.");
          // If the active user is a reader, redirect them to their profile, else dashboard
          if (activeUser.role === "Reader") {
            handleNavigate("profile");
          } else {
            handleNavigate("dashboard", { tab: "drafts" });
          }
        }}
        onNavigate={handleNavigate}
      />
    );
  };

  const renderDashboardView = () => {
    const activeRole = getActiveUserRole();
    const targetTab = viewParams?.tab;

    if (activeRole === "Editor") {
      return <DashboardEditor onNavigate={handleNavigate} activeTab={targetTab} triggerBanner={triggerBanner} />;
    } else if (activeRole === "Writer") {
      return <DashboardWriter onNavigate={handleNavigate} activeTab={targetTab} />;
    } else {
      return (
        <div className="bg-white border border-gray-100 rounded-3xl p-12 text-center text-gray-500 space-y-4">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
          <h2 className="text-base font-bold text-gray-800">Authorization Restriction</h2>
          <p className="text-xs max-w-md mx-auto leading-relaxed">
            Guest reader profiles do not contain newsroom clearance. Please Sign In using the top menu with a Staff Writer (Sarah Jenkins) or Editor (Arthur Vance) preset to inspect role-based editorial spaces!
          </p>
        </div>
      );
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      
      {/* Dynamic Status Notifications Bar */}
      {banner && (
        <div className={`fixed bottom-6 right-6 z-50 p-4 rounded-2xl shadow-2xl flex items-center space-x-2.5 text-xs text-white max-w-md animate-in fade-in slide-in-from-bottom-5 duration-200 ${banner.type === "success" ? "bg-gray-900 border border-gray-800" : "bg-red-600"}`}>
          {banner.type === "success" ? <CheckCircle className="w-5 h-5 text-green-400 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
          <p className="font-bold">{banner.message}</p>
        </div>
      )}

      {/* Navigation */}
      <Navbar 
        currentView={currentView}
        onNavigate={handleNavigate}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        triggerBanner={triggerBanner}
      />

      {/* Main Content Pane */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="py-24 text-center">
            <Clock className="w-10 h-10 text-[#1E3A8A] animate-spin mx-auto" />
            <p className="text-xs font-bold text-gray-500 mt-2">Connecting to MOXN secure publication databases...</p>
          </div>
        ) : (
          <motion.div
            key={currentView + (activeCategory || "") + searchQuery}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            {currentView === "home" && renderHome()}
            {currentView === "article" && (
              <ArticleView
                viewParams={viewParams}
                likedIds={likedIds}
                bookmarkedIds={bookmarkedIds}
                setLikedIds={setLikedIds}
                setBookmarkedIds={setBookmarkedIds}
                followingIds={followingIds}
                activeUser={activeUser}
                writers={writers}
                triggerBanner={triggerBanner}
                handleNavigate={handleNavigate}
                handleToggleFollow={handleToggleFollow}
                handleShare={handleShare}
                getReadTime={getReadTime}
                setArticles={setArticles}
                handleToggleLike={handleToggleLike}
                handleToggleBookmark={handleToggleBookmark}
              />
            )}
            {currentView === "write" && renderWriteView()}
            {currentView === "dashboard" && renderDashboardView()}
            {currentView === "writers" && renderWritersView()}
            {currentView === "profile" && (
              <UserProfile
                activeUser={activeUser}
                viewParams={viewParams}
                onNavigate={handleNavigate}
                triggerBanner={triggerBanner}
                onProfileUpdate={(updatedUser) => {
                  setActiveUser(updatedUser);
                  // also update in writers list if they exist there
                  setWriters(prev => prev.map(w => w.id === updatedUser.id ? updatedUser : w));
                }}
              />
            )}
            {currentView === "bookmarks" && (
              <BookmarksView
                bookmarkedIds={bookmarkedIds}
                handleNavigate={handleNavigate}
                renderArticleCard={renderArticleCard}
              />
            )}
          </motion.div>
        )}
      </main>

      {/* Premium Footer */}
      <Footer />
    </div>
  );
}
