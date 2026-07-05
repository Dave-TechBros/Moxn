/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  Heart, 
  MessageSquare, 
  Pin, 
  Trash2, 
  Edit, 
  ShieldAlert, 
  CornerDownRight, 
  Lock,
  MoreVertical,
  CheckCircle,
  EyeOff,
  UserX
} from "lucide-react";
import { api, getActiveUser } from "../lib/api.js";
import { Comment, User } from "../types.js";

interface CommentSectionProps {
  articleId: string;
  articleAuthorId: string;
  onNavigate?: (view: string, params?: any) => void;
  triggerBanner?: (type: "success" | "error", message: string) => void;
}

export default function CommentSection({ articleId, articleAuthorId, onNavigate, triggerBanner }: CommentSectionProps) {
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [newCommentBody, setNewCommentBody] = useState("");
  const [activeUser, setActiveUser] = useState<User>(getActiveUser());
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const fetchComments = async () => {
    setLoading(true);
    try {
      const data = await api.getComments(articleId);
      setComments(data);
    } catch (err) {
      console.error("Failed to load comments", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();
    
    const handleAuthChange = () => {
      setActiveUser(getActiveUser());
    };
    window.addEventListener("moxn_auth_changed", handleAuthChange);
    return () => {
      window.removeEventListener("moxn_auth_changed", handleAuthChange);
    };
  }, [articleId]);

  const handleCreateComment = async (e: React.FormEvent, parentId?: string) => {
    e.preventDefault();
    
    // Check if user is authenticated (not guest)
    if (!activeUser.id || activeUser.id === "guest") {
      triggerBanner?.("error", "Please sign in to comment.");
      return;
    }
    
    const bodyText = parentId ? replyBody : newCommentBody;
    if (!bodyText.trim()) return;

    try {
      const newComm = await api.addComment(articleId, bodyText, parentId);
      setComments(prev => [...prev, newComm]);
      if (parentId) {
        setReplyToId(null);
        setReplyBody("");
      } else {
        setNewCommentBody("");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditComment = async (id: string) => {
    if (!editBody.trim()) return;
    try {
      const updated = await api.editComment(id, editBody);
      setComments(prev => prev.map(c => c.id === id ? { ...c, body: updated.body } : c));
      setEditingCommentId(null);
      setEditBody("");
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteComment = async (id: string) => {
    if (!confirm("Are you sure you want to remove this comment?")) return;
    try {
      await api.deleteComment(id);
      setComments(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleLikeComment = async (id: string) => {
    // Check if user is authenticated (not guest)
    if (!activeUser.id || activeUser.id === "guest") {
      triggerBanner?.("error", "Please sign in to like comments.");
      return;
    }
    
    try {
      const updated = await api.likeComment(id);
      setComments(prev => prev.map(c => c.id === id ? { ...c, likeCount: updated.likeCount } : c));
    } catch (err) {
      console.error(err);
    }
  };

  const handlePinComment = async (id: string) => {
    try {
      const updated = await api.pinComment(id);
      setComments(prev => prev.map(c => c.id === id ? { ...c, pinned: updated.pinned } : c));
      setActiveMenuId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleModerateComment = async (id: string, action: "hide" | "ban_user") => {
    try {
      await api.moderateComment(id, action);
      if (action === "hide") {
        setComments(prev => prev.map(c => c.id === id ? { ...c, status: c.status === "Active" ? "Hidden" : "Active" } : c));
      } else {
        // User banned: reload entirely to update states
        fetchComments();
      }
      setActiveMenuId(null);
    } catch (err) {
      console.error(err);
    }
  };

  // Build nested threaded tree
  const rootComments = comments.filter(c => !c.parentId);
  const getRepliesFor = (id: string) => comments.filter(c => c.parentId === id);

  const canModifyComment = (comment: any) => {
    return comment.authorId === activeUser.id || activeUser.role === "Editor";
  };

  const isArticleAuthor = activeUser.id === articleAuthorId;
  const canPin = activeUser.role === "Editor" || isArticleAuthor;

  const renderCommentItem = (comment: any, isReply = false) => {
    const isHidden = comment.status === "Hidden";
    if (isHidden && activeUser.role !== "Editor" && activeUser.role !== "Writer") {
      return null; // Don't show hidden comments to regular readers
    }

    const replies = getRepliesFor(comment.id);

    return (
      <div 
        key={comment.id} 
        className={`p-4 rounded-xl border transition-all ${comment.pinned ? "border-amber-200 bg-amber-50/20" : "border-gray-50 bg-white"} ${isHidden ? "opacity-60 border-red-100 bg-red-50/10" : ""}`}
      >
        <div className="flex items-start justify-between">
          <button 
            onClick={() => onNavigate && onNavigate("profile", { userId: comment.authorId })}
            disabled={!onNavigate}
            className={`flex items-center space-x-3 text-left ${onNavigate ? "hover:opacity-80 cursor-pointer group" : ""}`}
          >
            <img 
              src={comment.author?.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150"} 
              alt={comment.author?.name} 
              className="w-8 h-8 rounded-full object-cover border border-gray-100 group-hover:ring-1 group-hover:ring-blue-500 transition-all"
              referrerPolicy="no-referrer"
            />
            <div>
              <div className="flex items-center space-x-1.5">
                <span className={`text-xs font-bold text-gray-800 ${onNavigate ? "group-hover:text-blue-600" : ""} transition-colors`}>{comment.author?.name}</span>
                {comment.authorId === articleAuthorId && (
                  <span className="bg-blue-100 text-blue-800 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Author</span>
                )}
                {comment.author?.role === "Editor" && (
                  <span className="bg-[#1E3A8A] text-white text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Editor</span>
                )}
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">{new Date(comment.createdAt).toLocaleDateString()}</p>
            </div>
          </button>

          <div className="flex items-center space-x-1.5">
            {comment.pinned && (
              <span className="flex items-center text-amber-600 text-[10px] font-bold uppercase bg-amber-100 px-2 py-0.5 rounded-full">
                <Pin className="w-3 h-3 mr-1 fill-amber-600" /> Pin
              </span>
            )}

            {/* Moderation Dropdown Toggle */}
            {(canModifyComment(comment) || canPin || activeUser.role === "Editor") && (
              <div className="relative">
                <button 
                  onClick={() => setActiveMenuId(activeMenuId === comment.id ? null : comment.id)}
                  className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                {activeMenuId === comment.id && (
                  <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-100 rounded-xl shadow-xl py-1.5 z-40 text-xs">
                    {canPin && (
                      <button 
                        onClick={() => handlePinComment(comment.id)}
                        className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center text-gray-700 font-medium"
                      >
                        <Pin className="w-3.5 h-3.5 mr-2" />
                        {comment.pinned ? "Unpin Comment" : "Pin Comment"}
                      </button>
                    )}
                    {comment.authorId === activeUser.id && (
                      <button 
                        onClick={() => {
                          setEditingCommentId(comment.id);
                          setEditBody(comment.body);
                          setActiveMenuId(null);
                        }}
                        className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center text-gray-700 font-medium"
                      >
                        <Edit className="w-3.5 h-3.5 mr-2" /> Edit Comment
                      </button>
                    )}
                    {(comment.authorId === activeUser.id || activeUser.role === "Editor") && (
                      <button 
                        onClick={() => handleDeleteComment(comment.id)}
                        className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center text-red-600 font-semibold"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                      </button>
                    )}
                    {activeUser.role === "Editor" && (
                      <div className="border-t border-gray-100 mt-1 pt-1">
                        <button 
                          onClick={() => handleModerateComment(comment.id, "hide")}
                          className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center text-amber-700 font-medium"
                        >
                          <EyeOff className="w-3.5 h-3.5 mr-2" /> 
                          {isHidden ? "Unhide" : "Hide comment"}
                        </button>
                        <button 
                          onClick={() => handleModerateComment(comment.id, "ban_user")}
                          className="w-full text-left px-4 py-2 hover:bg-red-50 flex items-center text-red-700 font-bold"
                        >
                          <UserX className="w-3.5 h-3.5 mr-2" /> Ban Commenter
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Comment Body */}
        <div className="mt-2 text-xs text-gray-700 leading-relaxed pl-1">
          {editingCommentId === comment.id ? (
            <div className="space-y-2 mt-1">
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="w-full p-2.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
                rows={2}
              />
              <div className="flex space-x-2">
                <button 
                  onClick={() => handleEditComment(comment.id)}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] rounded-lg"
                >
                  Save
                </button>
                <button 
                  onClick={() => setEditingCommentId(null)}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-[10px] rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p>
              {isHidden && (
                <span className="inline-flex items-center text-[9px] font-bold uppercase text-red-500 mr-2 bg-red-100 px-1.5 py-0.5 rounded">
                  MODERATED / HIDDEN
                </span>
              )}
              {comment.body}
            </p>
          )}
        </div>

        {/* Comment Actions: Like & Reply */}
        {!editingCommentId && (
          <div className="mt-3 flex items-center space-x-4 text-[10px] font-bold text-gray-400">
            <button 
              onClick={() => handleLikeComment(comment.id)}
              className={`flex items-center hover:text-red-500 transition-colors space-x-1 cursor-pointer ${
                comment.liked ? "text-red-500 font-extrabold" : ""
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${comment.liked ? "fill-red-500 text-red-500" : "fill-none stroke-current"}`} />
              <span>{comment.likeCount} Likes</span>
            </button>
            
            {!isReply && (
              <button 
                onClick={() => {
                  if (!activeUser.id || activeUser.id === "guest") {
                    triggerBanner?.("error", "Please sign in to reply to comments.");
                    return;
                  }
                  setReplyToId(replyToId === comment.id ? null : comment.id);
                  setReplyBody("");
                }}
                className="flex items-center hover:text-blue-500 transition-colors space-x-1"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Reply</span>
              </button>
            )}
          </div>
        )}

        {/* Inline Reply Editor */}
        {replyToId === comment.id && (
          <form onSubmit={(e) => handleCreateComment(e, comment.id)} className="mt-3.5 pl-4 border-l-2 border-gray-100 flex space-x-2 items-center">
            <CornerDownRight className="w-4 h-4 text-gray-400 shrink-0" />
            <input 
              type="text" 
              placeholder={`Reply to ${comment.author?.name}...`}
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              className="w-full text-xs p-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-blue-500 transition-all"
            />
            <button 
              type="submit" 
              className="px-3 py-1.5 bg-[#1E3A8A] hover:bg-blue-600 text-white font-bold text-[10px] rounded-lg"
            >
              Post
            </button>
          </form>
        )}

        {/* Render nested replies */}
        {replies.length > 0 && (
          <div className="mt-4 pl-6 border-l border-gray-100 space-y-4">
            {replies.map(reply => renderCommentItem(reply, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mt-12 bg-gray-50/50 rounded-2xl p-6 border border-gray-100">
      <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-6">
        <h3 className="text-sm font-extrabold text-gray-800 flex items-center">
          <MessageSquare className="w-4.5 h-4.5 mr-2 text-[#1E3A8A]" />
          Discussions ({comments.length})
        </h3>
        <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">CIVIC CONVERSATIONS</p>
      </div>

      {/* Main Comment Box */}
      <form onSubmit={(e) => handleCreateComment(e)} className="mb-8">
        <div className="relative">
          <textarea
            placeholder={activeUser.id ? "Add your perspective to this story..." : "Please log in to add perspective..."}
            disabled={!activeUser.id}
            value={newCommentBody}
            onChange={(e) => setNewCommentBody(e.target.value)}
            className="w-full p-4 text-xs border border-gray-200 rounded-2xl bg-white shadow-sm focus:outline-none focus:border-blue-500 transition-all"
            rows={3}
          />
          {activeUser.id ? (
            <div className="absolute bottom-2.5 right-2.5 flex items-center space-x-2">
              <span className="text-[10px] text-gray-400 font-medium mr-1">Posting as <span className="font-bold text-gray-700">{activeUser.name}</span></span>
              <button
                type="submit"
                className="px-4 py-2 bg-[#1E3A8A] hover:bg-[#2563EB] text-white text-xs font-bold rounded-xl shadow-md transition-all duration-150"
              >
                Comment
              </button>
            </div>
          ) : (
            <div className="absolute inset-0 bg-gray-50/70 backdrop-blur-[1px] rounded-2xl flex items-center justify-center">
              <div className="text-center">
                <Lock className="w-5 h-5 text-gray-400 mx-auto" />
                <p className="text-xs font-bold text-gray-600 mt-1">Reader accounts are read-only. Switch role in navbar.</p>
              </div>
            </div>
          )}
        </div>
      </form>

      {/* Threaded Comments List */}
      <div className="space-y-4">
        {loading ? (
          <div className="py-12 text-center text-gray-400 text-xs">Loading dialogue tree...</div>
        ) : rootComments.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-xs">Be the first to open a thread on this story.</div>
        ) : (
          rootComments.map(comment => renderCommentItem(comment))
        )}
      </div>
    </div>
  );
}
