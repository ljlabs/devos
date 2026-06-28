/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, Pencil, X } from "lucide-react";
import { Workspace, Thread } from "../types";

interface MobileThreadNavigatorProps {
  workspaces: Workspace[];
  threads: Record<string, Thread[]>; // threads grouped by workspaceId
  activeWorkspaceId: string;
  activeThreadId: string;
  onSelectWorkspace: (id: string) => void;
  onSelectThread: (id: string) => void;
  onOpenNewThread: () => void;
  onRenameThread: (id: string, title: string) => void;
  onDeleteThread: (id: string) => void;
  onClose: () => void;
}

export default function MobileThreadNavigator({
  workspaces,
  threads,
  activeWorkspaceId,
  activeThreadId,
  onSelectWorkspace,
  onSelectThread,
  onOpenNewThread,
  onRenameThread,
  onDeleteThread,
  onClose
}: MobileThreadNavigatorProps) {
  const [expandedWorkspace, setExpandedWorkspace] = useState<string>(activeWorkspaceId);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEditing = (threadId: string, currentTitle: string) => {
    setEditingThreadId(threadId);
    setEditValue(currentTitle);
  };

  const commitRename = (threadId: string) => {
    if (editValue.trim()) {
      onRenameThread(threadId, editValue.trim());
    }
    setEditingThreadId(null);
  };

  const toggleWorkspace = (workspaceId: string) => {
    setExpandedWorkspace(expandedWorkspace === workspaceId ? "" : workspaceId);
  };

  const handleSelectWorkspace = (workspaceId: string) => {
    onSelectWorkspace(workspaceId);
    setExpandedWorkspace(workspaceId);
  };

  const handleSelectThread = (threadId: string) => {
    onSelectThread(threadId);
    onClose();
  };

  return (
    <div className="fixed inset-0 md:hidden z-50 bg-black/60 backdrop-blur-sm">
      <div 
        className="absolute inset-y-0 left-0 w-full max-w-xs bg-[#0E0E11] border-r border-white/5 overflow-y-auto custom-scrollbar shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-white/5 bg-[#111114] flex items-center justify-between shrink-0">
          <h2 className="font-sans font-bold text-base text-white">Threads & Workspaces</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* New Thread Button */}
        <div className="p-3 border-b border-white/5">
          <button
            onClick={onOpenNewThread}
            className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-sans text-xs font-semibold rounded-md transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-emerald-950/20"
          >
            <Plus size={14} />
            <span>New Thread</span>
          </button>
        </div>

        {/* Workspaces & Threads List */}
        <div className="flex-1 overflow-y-auto">
          {workspaces.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-xs">
              No workspaces registered
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {workspaces.map((workspace) => {
                const isExpanded = expandedWorkspace === workspace.id;
                const isActive = activeWorkspaceId === workspace.id;
                const workspaceThreads = threads[workspace.id] || [];

                return (
                  <div key={workspace.id} className="space-y-0">
                    {/* Workspace Item */}
                    <button
                      onClick={() => handleSelectWorkspace(workspace.id)}
                      className={`w-full px-3 py-2 rounded-lg text-sm font-sans font-medium transition-colors flex items-center gap-2 select-none cursor-pointer ${
                        isActive
                          ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300"
                          : "text-slate-300 hover:bg-white/5"
                      }`}
                    >
                      {/* Chevron */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWorkspace(workspace.id);
                        }}
                        className="p-0.5 hover:bg-white/5 rounded transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                      </button>

                      {/* Workspace Name - Truncate long names */}
                      <span className="flex-1 text-left truncate">{workspace.name}</span>
                    </button>

                    {/* Threads - Nested under workspace */}
                    {isExpanded && (
                      <div className="ml-6 space-y-1 py-1">
                        {workspaceThreads.length === 0 ? (
                          <div className="px-3 py-1.5 text-xs text-slate-600 italic font-sans">
                            No threads
                          </div>
                        ) : (
                          workspaceThreads.map((thread) => {
                            const isThreadActive = activeThreadId === thread.id;

                            return (
                              <div key={thread.id} className="group">
                                {editingThreadId === thread.id ? (
                                  <div className="px-2 py-1 flex items-center gap-1">
                                    <input
                                      autoFocus
                                      type="text"
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onBlur={() => commitRename(thread.id)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") commitRename(thread.id);
                                        if (e.key === "Escape") setEditingThreadId(null);
                                      }}
                                      className="flex-1 bg-[#18181B] border border-emerald-500/30 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none"
                                    />
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => handleSelectThread(thread.id)}
                                    className={`w-full px-3 py-2 rounded-lg text-xs font-sans transition-colors flex items-center gap-2 select-none cursor-pointer ${
                                      isThreadActive
                                        ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300"
                                        : "text-slate-400 hover:text-slate-300 hover:bg-white/5"
                                    }`}
                                  >
                                    {/* Thread Status Indicator */}
                                    <div
                                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                        thread.status === "running"
                                          ? "bg-emerald-500 animate-pulse"
                                          : thread.status === "awaiting_permission"
                                            ? "bg-amber-500 animate-pulse"
                                            : thread.status === "thinking"
                                              ? "bg-blue-500 animate-pulse"
                                              : "bg-slate-600"
                                      }`}
                                    />

                                    {/* Thread Title - Truncate */}
                                    <span className="flex-1 text-left truncate">{thread.title}</span>

                                    {/* Edit & Delete Buttons - Show on hover */}
                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          startEditing(thread.id, thread.title);
                                        }}
                                        className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors"
                                        title="Rename thread"
                                      >
                                        <Pencil size={12} />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onDeleteThread(thread.id);
                                        }}
                                        className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                                        title="Delete thread"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </button>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
