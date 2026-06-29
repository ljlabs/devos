/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Plus, ArrowLeft, Edit2, Trash2 } from "lucide-react";
import { Thread, Workspace } from "../types";

interface MobileThreadListProps {
  threads: Thread[];
  activeThreadId: string;
  activeWorkspaceId: string;
  workspaces: Workspace[];
  onSelectThread: (id: string) => void;
  onCreateThread: () => void;
  onRenameThread: (id: string, title: string) => void;
  onDeleteThread: (id: string) => void;
  onBack: () => void;
  onEditWorkspace: (id: string) => void;
}

export default function MobileThreadList({
  threads,
  activeThreadId,
  activeWorkspaceId,
  workspaces,
  onSelectThread,
  onCreateThread,
  onRenameThread,
  onDeleteThread,
  onBack,
  onEditWorkspace,
}: MobileThreadListProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);

  const handleStartRename = (id: string, title: string) => {
    setRenamingId(id);
    setRenamingTitle(title);
  };

  const handleSaveRename = (id: string) => {
    if (renamingTitle.trim()) {
      onRenameThread(id, renamingTitle);
    }
    setRenamingId(null);
    setRenamingTitle("");
  };

  return (
    <main className="flex-1 flex flex-col bg-[#0B0B0C] overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-white/5">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={onBack}
            className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-colors"
            title="Back to workspaces"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-white truncate text-base">{activeWorkspace?.name}</h2>
            <p className="text-[11px] text-slate-500 truncate">{activeWorkspace?.path}</p>
          </div>
        </div>
        <button
          onClick={onCreateThread}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-lg text-emerald-400 font-medium text-sm transition-colors"
        >
          <Plus size={16} />
          New Thread
        </button>
      </div>

      {/* Threads list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {threads.length === 0 ? (
          <p className="text-center text-slate-500 py-8 text-sm">No threads in this workspace</p>
        ) : (
          threads.map((thread) => (
            <div
              key={thread.id}
              className={`p-3 rounded-lg border transition-colors ${
                activeThreadId === thread.id
                  ? "bg-emerald-500/10 border-emerald-500/30"
                  : "bg-white/5 border-white/10 hover:border-white/20"
              }`}
              onClick={() => !renamingId && onSelectThread(thread.id)}
            >
              {renamingId === thread.id ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={renamingTitle}
                    onChange={(e) => setRenamingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(thread.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    className="flex-1 bg-black/40 border border-emerald-500/30 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-emerald-500"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSaveRename(thread.id);
                    }}
                    className="px-2 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 rounded text-emerald-400 text-xs font-medium"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate text-sm text-slate-200">{thread.title}</h3>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartRename(thread.id, thread.title);
                        }}
                        className="p-1.5 hover:bg-white/10 rounded text-slate-500 hover:text-white transition-colors"
                        title="Rename thread"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete thread "${thread.title}"?`)) {
                            onDeleteThread(thread.id);
                          }
                        }}
                        className="p-1.5 hover:bg-red-500/10 rounded text-slate-500 hover:text-red-400 transition-colors"
                        title="Delete thread"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className={`text-[11px] ${
                    thread.status === 'idle'
                      ? 'text-slate-600'
                      : 'text-emerald-500'
                  }`}>
                    {thread.status === 'thinking' && '⏳ Thinking...'}
                    {thread.status === 'running' && '▶ Running...'}
                    {thread.status === 'awaiting_permission' && '⏸ Awaiting approval...'}
                    {thread.status === 'idle' && 'Idle'}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </main>
  );
}
