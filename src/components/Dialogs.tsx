/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { FolderPlus, X, Settings, Trash2, RefreshCw } from "lucide-react";
import { Workspace } from "../types";

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingWorkspace: Workspace | null;
  name: string;
  setName: (v: string) => void;
  path: string;
  setPath: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  error?: string;
  setError?: (v: string) => void;
}

export function WorkspaceModal({
  isOpen,
  onClose,
  editingWorkspace,
  name,
  setName,
  path,
  setPath,
  onSubmit,
  error = "",
  setError = () => {}
}: WorkspaceModalProps) {
  if (!isOpen) return null;

  const isEditing = !!editingWorkspace;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-[#0E0E11] border border-white/10 rounded-xl w-full max-w-md overflow-hidden shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>

        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-white pb-2 border-b border-white/5 select-none">
            <FolderPlus size={18} className="text-emerald-400" />
            <h3 className="text-base font-bold font-sans">
              {isEditing ? "Edit Workspace" : "Register New Workspace"}
            </h3>
          </div>

          <p className="text-xs text-slate-400 font-sans leading-relaxed">
            {isEditing
              ? "Update the workspace name."
              : "Specify a workspace directory. DevOS will map code trees in this folder to isolated threads."}
          </p>

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2.5">
              <p className="text-xs text-rose-300 font-sans">{error}</p>
            </div>
          )}

          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                Workspace Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError("");
                }}
                placeholder="e.g. backend-services, task-dashboard"
                className="w-full bg-[#18181B] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                Absolute Machine Path
              </label>
              <input
                type="text"
                required
                value={path}
                disabled={isEditing}
                onChange={(e) => {
                  if (!isEditing) {
                    setPath(e.target.value);
                    if (error) setError("");
                  }
                }}
                placeholder="C:/Users/you/projects/my-app"
                className={`w-full bg-[#18181B] rounded-lg px-3 py-2 text-sm font-mono transition-colors ${
                  isEditing
                    ? "border border-white/5 text-slate-500 cursor-not-allowed"
                    : "border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                }`}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4 select-none">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-white/5 hover:bg-white/10 text-slate-400 border border-white/5 py-2 rounded-lg text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black py-2 rounded-lg text-xs font-bold cursor-pointer transition-all active:scale-95 shadow-md shadow-emerald-950/20"
            >
              {isEditing ? "Save Changes" : "Create Workspace"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SettingsModal — global settings (allowed patterns management)
// ---------------------------------------------------------------------------

interface AllowedPattern {
  pattern: string;
  variant: string;
  createdAt: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [patterns, setPatterns] = useState<AllowedPattern[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingPattern, setEditingPattern] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState("");

  const fetchPatterns = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/allowedPatterns");
      if (res.ok) {
        const data = await res.json();
        // normalise: server may return plain strings or objects
        setPatterns(
          (data as any[]).map((p) =>
            typeof p === "string"
              ? { pattern: p, variant: p.endsWith("*") ? "wildcard" : "exact", createdAt: "" }
              : p
          )
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) fetchPatterns();
  }, [isOpen]);

  const handleDelete = async (pattern: string) => {
    try {
      const res = await fetch("/api/allowedPatterns", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern }),
      });
      if (res.ok) {
        const data = await res.json();
        setPatterns(
          (data as any[]).map((p) =>
            typeof p === "string"
              ? { pattern: p, variant: p.endsWith("*") ? "wildcard" : "exact", createdAt: "" }
              : p
          )
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleStartEdit = (pattern: AllowedPattern) => {
    setEditingPattern(pattern.pattern);
    setEditValue(pattern.pattern);
    setEditError("");
  };

  const handleSaveEdit = async (oldPattern: string) => {
    const newPattern = editValue.trim();
    if (!newPattern) {
      setEditError("Pattern cannot be empty.");
      return;
    }
    if (newPattern === oldPattern) {
      setEditingPattern(null);
      return;
    }
    // Delete old, add new
    try {
      await fetch("/api/allowedPatterns", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: oldPattern }),
      });
      const res = await fetch("/api/allowedPatterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: newPattern }),
      });
      if (res.ok) {
        const data = await res.json();
        setPatterns(
          (data as any[]).map((p) =>
            typeof p === "string"
              ? { pattern: p, variant: p.endsWith("*") ? "wildcard" : "exact", createdAt: "" }
              : p
          )
        );
        setEditingPattern(null);
        setEditError("");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCancelEdit = () => {
    setEditingPattern(null);
    setEditError("");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-[#0E0E11] border border-white/10 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl relative flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-emerald-400" />
            <h3 className="text-base font-bold font-sans text-white">Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          {/* Allowed Patterns Section */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div>
                <h4 className="text-sm font-semibold text-white font-sans">Allowed Patterns</h4>
                <p className="text-xs text-slate-500 mt-0.5 font-sans">
                  Commands matching these patterns are auto-approved without a permission prompt.
                </p>
              </div>
              <button
                onClick={fetchPatterns}
                className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                title="Refresh"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {loading && patterns.length === 0 && (
                <p className="text-xs text-slate-500 italic py-4 text-center font-sans">Loading…</p>
              )}
              {!loading && patterns.length === 0 && (
                <p className="text-xs text-slate-500 italic py-4 text-center font-sans">No allowed patterns saved yet.</p>
              )}
              {patterns.map((p) => (
                <div
                  key={p.pattern}
                  className="bg-[#18181B] border border-white/5 rounded-lg px-3 py-2.5 group"
                >
                  {editingPattern === p.pattern ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => { setEditValue(e.target.value); setEditError(""); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit(p.pattern);
                          if (e.key === "Escape") handleCancelEdit();
                        }}
                        autoFocus
                        className="w-full bg-[#0E0E11] border border-emerald-500/50 rounded-md px-2 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-400 transition-colors"
                      />
                      {editError && <p className="text-xs text-rose-400 font-sans">{editError}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveEdit(p.pattern)}
                          className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 cursor-pointer transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-white/10 text-slate-400 hover:text-white cursor-pointer transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-mono text-slate-300 break-all">{p.pattern}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                            p.variant === "wildcard"
                              ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                              : "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                          }`}>
                            {p.variant}
                          </span>
                          {p.createdAt && (
                            <span className="text-[10px] text-slate-600 font-mono">
                              {new Date(p.createdAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => handleStartEdit(p)}
                          className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-white/10 cursor-pointer transition-colors text-[11px] font-semibold"
                          title="Edit pattern"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(p.pattern)}
                          className="p-1.5 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors"
                          title="Delete pattern"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/5 shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
