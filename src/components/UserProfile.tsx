/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { 
  User as UserIcon, 
  Mail, 
  FileText, 
  Plus, 
  Heart, 
  Eye, 
  Edit2, 
  Check, 
  X, 
  Camera, 
  Calendar, 
  ArrowLeft,
  BookOpen,
  Settings,
  HelpCircle,
  UserCheck,
  UserPlus,
  Bookmark
} from "lucide-react";
import { api, setActiveUser } from "../lib/api.js";
import { Article, User } from "../types.js";

interface UserProfileProps {
  activeUser: User;
  viewParams?: any;
  onNavigate: (view: string, params?: any) => void;
  triggerBanner: (type: "success" | "error", message: string) => void;
  onProfileUpdate: (updatedUser: User) => void;
}

const PRESET_AVATARS = [
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150",
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150",
  "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150",
  "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150",
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150",
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150",
];

export default function UserProfile({ activeUser, viewParams, onNavigate, triggerBanner, onProfileUpdate }: UserProfileProps) {
  const targetUserId = viewParams?.userId || activeUser.id;
  const isMe = targetUserId === activeUser.id;

  const [profile, setProfile] = useState<User | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [likedArticles, setLikedArticles] = useState<Article[]>([]);
  const [savedArticles, setSavedArticles] = useState<Article[]>([]);
  const [activeTab, setActiveTab] = useState<"publications" | "saved" | "liked">("publications");
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);

  // Edit Form Fields
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const fetchProfileDataId = useRef(0);

  const fetchProfileData = async () => {
    const callId = ++fetchProfileDataId.current;
    try {
      setLoading(true);
      const [data, bookmarksData] = await Promise.all([
        api.getProfile(targetUserId),
        isMe ? api.getBookmarks() : Promise.resolve([])
      ]);
      if (callId !== fetchProfileDataId.current) return;
      setProfile(data.user);
      setArticles(data.articles || []);
      setLikedArticles(data.likedArticles || []);
      setSavedArticles(bookmarksData || []);
      
      // Initialize edit fields
      setEditName(data.user.name || "");
      setEditBio(data.user.bio || "");
      setEditAvatar(data.user.avatar || "");

      if (isMe) {
        setActiveTab("saved");
      } else if (data.user.role === "Reader") {
        setActiveTab("liked");
      } else {
        setActiveTab("publications");
      }
    } catch (err) {
      if (callId !== fetchProfileDataId.current) return;
      console.error("Failed to load profile", err);
      if (isMe && activeUser) {
        setProfile(activeUser);
        setArticles([]);
        setLikedArticles([]);
        setSavedArticles([]);
        setEditName(activeUser.name || "");
        setEditBio(activeUser.bio || "");
        setEditAvatar(activeUser.avatar || "");
        setActiveTab("saved");
        triggerBanner("success", "Restored local profile session successfully.");
      } else {
        triggerBanner("error", "Failed to retrieve profile data.");
      }
    } finally {
      if (callId === fetchProfileDataId.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchProfileData();
  }, [targetUserId]);

  useEffect(() => {
    if (activeUser.id && profile?.id) {
      const simulatedFollowing = localStorage.getItem(`moxn_following_${activeUser.id}`);
      if (simulatedFollowing) {
        const list = JSON.parse(simulatedFollowing);
        setIsFollowing(list.includes(profile.id));
      }
    }
  }, [activeUser.id, profile?.id]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      triggerBanner("error", "Display name cannot be empty.");
      return;
    }

    setSubmitting(true);
    try {
      const resp = await api.updateProfile({
        name: editName,
        avatar: editAvatar,
        bio: editBio
      });
      setProfile(resp.user);
      setActiveUser(resp.user);
      onProfileUpdate(resp.user);
      setIsEditing(false);
      triggerBanner("success", "Profile updated successfully!");
    } catch (err) {
      console.error(err);
      triggerBanner("error", "Failed to update profile details.");
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: Article["status"]) => {
    switch (status) {
      case "Published":
        return <span className="text-[10px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-100">Live</span>;
      case "In Review":
        return <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-100">Pending Review</span>;
      case "Draft":
        return <span className="text-[10px] font-bold text-gray-700 bg-gray-50 px-2 py-0.5 rounded border border-gray-100">Draft</span>;
      case "Rejected":
        return <span className="text-[10px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-100">Revision Needed</span>;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-xs font-bold text-gray-500 mt-3 font-mono">Synchronizing reporter profile databases...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="py-24 text-center space-y-4">
        <p className="text-sm font-semibold text-gray-500">Could not retrieve profile.</p>
        <button 
          onClick={() => onNavigate("home")} 
          className="px-4 py-2 bg-blue-600 text-white rounded-full text-xs font-bold"
        >
          Return Home
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      
      {/* Back Button */}
      <div className="flex items-center">
        <button
          id="profile-back-button"
          onClick={() => onNavigate("home")}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-800 transition-colors bg-white px-4 py-2 border border-gray-100 rounded-full shadow-xs cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Home</span>
        </button>
      </div>
      
      {/* Header section with profile view and editor */}
      <div className="bg-white border border-gray-100 rounded-3xl p-6 md:p-8 shadow-xs relative overflow-hidden">
        {/* Decorative corner accent */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/40 rounded-bl-full -z-0 pointer-events-none" />
        
        {isEditing ? (
          <form onSubmit={handleUpdateProfile} className="space-y-6 relative z-10">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <h2 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                <Settings className="w-4.5 h-4.5 text-[#1E3A8A]" />
                <span>Configure Profile Details</span>
              </h2>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setEditName(profile.name);
                  setEditBio(profile.bio);
                  setEditAvatar(profile.avatar);
                }}
                className="p-1 rounded-full text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
              
              {/* Avatar Selector Panel */}
              <div className="md:col-span-4 space-y-4 flex flex-col items-center">
                <div className="relative group">
                  <img
                    src={editAvatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150"}
                    alt="Preview avatar"
                    className="w-24 h-24 rounded-full object-cover border-2 border-blue-100"
                  />
                  <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className="w-5 h-5 text-white" />
                  </div>
                </div>
                
                <div className="w-full">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center mb-2">
                    Quick Avatars
                  </label>
                  <div className="grid grid-cols-4 gap-2 justify-center">
                    {PRESET_AVATARS.map((url, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setEditAvatar(url)}
                        className={`w-10 h-10 rounded-full overflow-hidden border-2 transition-all ${
                          editAvatar === url ? "border-blue-600 scale-105 shadow-xs" : "border-transparent hover:border-gray-200"
                        }`}
                      >
                        <img src={url} alt={`Preset ${idx}`} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="w-full space-y-1.5">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Or custom image URL
                  </label>
                  <input
                    type="url"
                    value={editAvatar}
                    onChange={(e) => setEditAvatar(e.target.value)}
                    placeholder="https://example.com/your-dp.jpg"
                    className="w-full text-xs p-2 bg-gray-50 border border-gray-100 rounded-xl focus:outline-hidden focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              {/* Bio & Name details */}
              <div className="md:col-span-8 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Display Name
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full text-xs p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-800 focus:outline-hidden focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Short Biography
                  </label>
                  <textarea
                    rows={4}
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    placeholder="Share a bit about yourself, your interest fields, or journalistic focus..."
                    className="w-full text-xs p-3 bg-gray-50 border border-gray-100 rounded-xl focus:outline-hidden focus:border-blue-500 leading-relaxed"
                  />
                </div>
              </div>

            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 bg-gray-50 border border-gray-200 hover:bg-gray-100 text-gray-600 text-xs font-bold rounded-full transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 bg-[#1E3A8A] hover:bg-[#111827] text-white text-xs font-bold rounded-full transition-colors shadow-md flex items-center gap-1.5"
              >
                {submitting ? "Updating..." : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col md:flex-row items-center md:items-start gap-6 relative z-10">
            {/* Avatar block */}
            <div className="relative shrink-0">
              <img
                src={profile.avatar}
                alt={profile.name}
                className="w-20 h-20 md:w-24 md:h-24 rounded-full object-cover border-4 border-white shadow-md"
                referrerPolicy="no-referrer"
              />
              {isMe && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="absolute -bottom-1 -right-1 p-1.5 bg-white border border-gray-100 rounded-full shadow-md text-gray-500 hover:text-blue-600 transition-colors cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Profile info block */}
            <div className="space-y-4 flex-1 text-center md:text-left">
              <div className="space-y-1">
                <div className="flex flex-col md:flex-row items-center md:items-baseline gap-2">
                  <h1 className="text-xl font-extrabold text-gray-900 font-sans tracking-tight">
                    {profile.name}
                  </h1>
                  <span className="text-[10px] font-bold text-blue-800 bg-blue-50 px-2 py-0.5 rounded uppercase tracking-wider">
                    {profile.role}
                  </span>
                </div>
                <p className="text-xs text-gray-400 font-medium flex items-center justify-center md:justify-start gap-1">
                  <Mail className="w-3 h-3" />
                  <span>{profile.email}</span>
                </p>
              </div>

              <p className="text-xs text-gray-600 leading-relaxed max-w-xl">
                {profile.bio || (isMe ? "No biography provided yet. Click edit to describe your background!" : "No biography provided yet.")}
              </p>

              <div className="flex items-center justify-center md:justify-start gap-6 text-[11px] text-gray-400 font-bold font-mono">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-gray-300" />
                  Joined {new Date(profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
                </span>
                {profile.role !== "Reader" && (
                  <>
                    <span className="h-4 w-px bg-gray-100" />
                    <span>{profile.followersCount.toLocaleString()} Followers</span>
                    <span className="h-4 w-px bg-gray-100" />
                    <span>{profile.followingCount.toLocaleString()} Following</span>
                  </>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="shrink-0 flex flex-row md:flex-col gap-2">
              {isMe ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Edit Profile</span>
                </button>
              ) : (
                profile.role !== "Reader" && activeUser.id && activeUser.id !== "guest" && (
                  <button
                    onClick={async () => {
                      try {
                        const resp = await api.toggleFollow(profile.id);
                        setProfile(prev => prev ? { ...prev, followersCount: resp.followersCount } : null);
                        setIsFollowing(resp.followed);
                        
                        // Sync with localStorage
                        const simulatedFollowing = localStorage.getItem(`moxn_following_${activeUser.id}`);
                        let list = simulatedFollowing ? JSON.parse(simulatedFollowing) : [];
                        if (resp.followed) {
                          if (!list.includes(profile.id)) list.push(profile.id);
                        } else {
                          list = list.filter((id: string) => id !== profile.id);
                        }
                        localStorage.setItem(`moxn_following_${activeUser.id}`, JSON.stringify(list));

                        triggerBanner("success", resp.followed ? "You are now following this contributor's updates." : "Unfollowed contributor.");
                      } catch (err) {
                        console.error(err);
                      }
                    }}
                    className={`px-4 py-2 rounded-full flex items-center gap-1.5 text-xs font-bold transition-colors cursor-pointer ${isFollowing ? "bg-blue-50 text-blue-600 hover:bg-blue-100" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                  >
                    {isFollowing ? <UserCheck className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                    <span>{isFollowing ? "Following" : "Follow"}</span>
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </div>

{/* Tab Switcher / Headers */}
      {profile.role !== "Reader" ? (
        <div className="flex items-center gap-4 overflow-x-auto scrollbar-none border-b border-gray-100 pb-px whitespace-nowrap">
          <button
            onClick={() => setActiveTab("publications")}
            className={`pb-3 text-sm font-extrabold transition-all relative flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap ${
              activeTab === "publications"
                ? "text-[#1E3A8A]"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <BookOpen className="w-4 h-4 shrink-0" />
            <span>{isMe ? "My Publications" : `${profile.name}'s Publications`}</span>
            {activeTab === "publications" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1E3A8A] rounded-t-full" />
            )}
          </button>
          
          {isMe && (
            <button
              onClick={() => setActiveTab("saved")}
              className={`pb-3 text-sm font-extrabold transition-all relative flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap ${
                activeTab === "saved"
                  ? "text-[#1E3A8A]"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <Bookmark className="w-4 h-4 shrink-0" />
              <span>Saved Articles</span>
              {activeTab === "saved" && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1E3A8A] rounded-t-full" />
              )}
            </button>
          )}

          <button
            onClick={() => setActiveTab("liked")}
            className={`pb-3 text-sm font-extrabold transition-all relative flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap ${
              activeTab === "liked"
                ? "text-[#1E3A8A]"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <Heart className="w-4 h-4 shrink-0" />
            <span>{isMe ? "Liked Stories" : `${profile.name}'s Liked Stories`}</span>
            {activeTab === "liked" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1E3A8A] rounded-t-full" />
            )}
          </button>
        </div>
      ) : isMe ? (
        <div className="flex items-center gap-4 overflow-x-auto scrollbar-none border-b border-gray-100 pb-px whitespace-nowrap">
          <button
            onClick={() => setActiveTab("saved")}
            className={`pb-3 text-sm font-extrabold transition-all relative flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap ${
              activeTab === "saved"
                ? "text-[#1E3A8A]"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <Bookmark className="w-4 h-4 shrink-0" />
            <span>Saved Articles</span>
            {activeTab === "saved" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1E3A8A] rounded-t-full" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("liked")}
            className={`pb-3 text-sm font-extrabold transition-all relative flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap ${
              activeTab === "liked"
                ? "text-[#1E3A8A]"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <Heart className="w-4 h-4 shrink-0" />
            <span>Liked Stories</span>
            {activeTab === "liked" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1E3A8A] rounded-t-full" />
            )}
          </button>
        </div>
      ) : (
        <div className="border-b border-gray-100 pb-3">
          <h2 className="text-base font-extrabold text-gray-900 flex items-center gap-1.5 whitespace-nowrap">
            <Heart className="w-5 h-5 text-[#1E3A8A] fill-[#1E3A8A] shrink-0" />
            <span>Stories {profile.name} Liked</span>
          </h2>
          <p className="text-[11px] text-gray-400">Curated collection of saved or liked articles by {profile.name}.</p>
        </div>
      )}

      {/* Tab Content: Publications */}
      {profile.role !== "Reader" && activeTab === "publications" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-1">
            <p className="text-[11px] text-gray-400">{isMe ? "Manage, edit, or publish articles written under your reporter profile." : `Articles written and published by ${profile.name}.`}</p>
            {isMe && (
              <button
                onClick={() => onNavigate("write")}
                className="flex items-center gap-1 px-4 py-2 bg-[#2563EB] hover:bg-[#1E3A8A] text-white text-xs font-bold rounded-full shadow-md transition-all hover:-translate-y-0.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Article</span>
              </button>
            )}
          </div>

          {articles.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-200 rounded-3xl p-12 text-center space-y-4">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto">
                <FileText className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-extrabold text-gray-800">{isMe ? "Your editorial catalog is empty" : `${profile.name} has not published any articles yet`}</h3>
                <p className="text-xs text-gray-400 max-w-sm mx-auto leading-relaxed">
                  {isMe ? "Whether you want to publish a quick community news flash or an in-depth analytical report, make your voice heard!" : "Check back later for new publications from this contributor."}
                </p>
              </div>
              {isMe && (
                <button
                  onClick={() => onNavigate("write")}
                  className="px-5 py-2.5 bg-[#1E3A8A] hover:bg-[#2563EB] text-white text-xs font-extrabold rounded-full transition-all shadow-md inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Write Your First Article</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {articles.map((art) => (
                <div 
                  key={art.id}
                  className="bg-white border border-gray-100 rounded-3xl p-5 shadow-xs hover:border-blue-100 transition-all flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-[#1E3A8A] uppercase tracking-wider bg-blue-50 px-2 py-0.5 rounded">
                        {art.categoryId}
                      </span>
                      {getStatusBadge(art.status)}
                    </div>

                    <div className="space-y-1.5">
                      <h3 className="text-xs font-extrabold text-gray-800 line-clamp-2 leading-snug">
                        {art.title}
                      </h3>
                      <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-2">
                        {art.subtitle || "No summary provided."}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-gray-50 pt-3.5 flex items-center justify-between text-[10px] text-gray-400 font-bold font-mono">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-0.5">
                        <Eye className="w-3.5 h-3.5" />
                        {art.readCount.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Heart className="w-3.5 h-3.5" />
                        {art.likeCount.toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onNavigate("article", { slug: art.slug })}
                        className="px-2.5 py-1 text-gray-500 hover:text-[#1E3A8A] hover:bg-gray-50 rounded transition-colors text-[10px]"
                      >
                        View
                      </button>
                      {isMe && (art.status === "Draft" || art.status === "Rejected") && (
                        <button
                          onClick={() => onNavigate("write", { id: art.id })}
                          className="px-2.5 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded transition-colors text-[10px] flex items-center gap-0.5 cursor-pointer"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {art.status === "Rejected" && art.rejectReason && (
                    <div className="mt-2 text-[10px] text-red-600 bg-red-50 p-2.5 rounded-xl border border-red-100 leading-relaxed">
                      <strong className="font-bold uppercase tracking-wider text-[9px] block mb-0.5">Editorial Feedback:</strong>
                      {art.rejectReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Saved Articles */}
      {activeTab === "saved" && (
        <div className="space-y-4">
          {savedArticles.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-200 rounded-3xl p-12 text-center space-y-4">
              <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center mx-auto">
                <Bookmark className="w-6 h-6 text-blue-600" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-extrabold text-gray-800">No saved articles yet</h3>
                <p className="text-xs text-gray-400 max-w-sm mx-auto leading-relaxed">
                  Bookmark interesting stories from the homepage feed to build your personal reading list!
                </p>
              </div>
              <button
                onClick={() => onNavigate("home")}
                className="px-5 py-2.5 bg-[#1E3A8A] hover:bg-[#2563EB] text-white text-xs font-extrabold rounded-full transition-all shadow-md inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>Explore Feed</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {savedArticles.map((art) => (
                <div 
                  key={art.id}
                  className="bg-white border border-gray-100 rounded-3xl p-5 shadow-xs hover:border-blue-100 transition-all flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-[#1E3A8A] uppercase tracking-wider bg-blue-50 px-2 py-0.5 rounded">
                        {art.categoryId}
                      </span>
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 flex items-center gap-1">
                        <Bookmark className="w-3.5 h-3.5 text-blue-600 fill-blue-600" />
                        <span>Bookmarked</span>
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <h3 className="text-xs font-extrabold text-gray-800 line-clamp-2 leading-snug">
                        {art.title}
                      </h3>
                      <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-2">
                        {art.subtitle || "No summary provided."}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-gray-50 pt-3.5 flex items-center justify-between text-[10px] text-gray-400 font-bold font-mono">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-0.5">
                        <Eye className="w-3.5 h-3.5" />
                        {art.readCount.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Heart className="w-3.5 h-3.5" />
                        {art.likeCount.toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onNavigate("article", { slug: art.slug })}
                        className="px-3 py-1 bg-gray-50 hover:bg-[#1E3A8A] hover:text-white text-gray-600 font-bold rounded-full transition-colors text-[10px] cursor-pointer"
                      >
                        Read Article
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Liked Articles */}
      {activeTab === "liked" && (
        <div className="space-y-4">
          {likedArticles.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-200 rounded-3xl p-12 text-center space-y-4">
              <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto">
                <Heart className="w-6 h-6 fill-red-100" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-extrabold text-gray-800">No liked articles yet</h3>
                <p className="text-xs text-gray-400 max-w-sm mx-auto leading-relaxed">
                  Browse the latest publications on the home feed and hit the like button on stories that interest you!
                </p>
              </div>
              <button
                onClick={() => onNavigate("home")}
                className="px-5 py-2.5 bg-[#1E3A8A] hover:bg-[#2563EB] text-white text-xs font-extrabold rounded-full transition-all shadow-md inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>Browse Latest News</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {likedArticles.map((art) => (
                <div 
                  key={art.id}
                  className="bg-white border border-gray-100 rounded-3xl p-5 shadow-xs hover:border-blue-100 transition-all flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-[#1E3A8A] uppercase tracking-wider bg-blue-50 px-2 py-0.5 rounded">
                        {art.categoryId}
                      </span>
                      <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100 flex items-center gap-1">
                        <Heart className="w-3 h-3 fill-red-600" />
                        <span>Liked</span>
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <h3 className="text-xs font-extrabold text-gray-800 line-clamp-2 leading-snug">
                        {art.title}
                      </h3>
                      <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-2">
                        {art.subtitle || "No summary provided."}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-gray-50 pt-3.5 flex items-center justify-between text-[10px] text-gray-400 font-bold font-mono">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-0.5">
                        <Eye className="w-3.5 h-3.5" />
                        {art.readCount.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-0.5 text-red-600 font-bold">
                        <Heart className="w-3.5 h-3.5 fill-red-500" />
                        {art.likeCount.toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onNavigate("article", { slug: art.slug })}
                        className="px-3 py-1 bg-gray-50 hover:bg-[#1E3A8A] hover:text-white text-gray-600 font-bold rounded-full transition-colors text-[10px] cursor-pointer"
                      >
                        Read Article
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
