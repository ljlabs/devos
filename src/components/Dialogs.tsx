/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { FolderPlus, MessageSquarePlus, X } from "lucide-react";

interface NewWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  setName: (v: string) => void;
  path: string;
  setPath: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function NewWorkspaceModal({
  isOpen,
  onClose,
  name,
  setName,
  path,
  setPath,
  onSubmit
}: NewWorkspaceModalProps) {
  if (!isOpen) return null;

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
            <h3 className="text-base font-bold font-sans">Register New Workspace</h3>
          </div>

          <p className="text-xs text-slate-400 font-sans leading-relaxed">
            Specify a workspace directory. DevOS will map code trees in this folder to isolated threads.
          </p>

          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                Workspace Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. backend-services, task-dashboard"
                className="w-full bg-[#18181B] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                Absolute Machine Path (Simulated)
              </label>
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/Users/developer/projects/..."
                className="w-full bg-[#18181B] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
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
              Create Workspace
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface NewThreadModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  setTitle: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function NewThreadModal({
  isOpen,
  onClose,
  title,
  setTitle,
  onSubmit
}: NewThreadModalProps) {
  if (!isOpen) return null;

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
            <MessageSquarePlus size={18} className="text-emerald-400" />
            <h3 className="text-base font-bold font-sans">Initialize Sub-task Thread</h3>
          </div>

          <p className="text-xs text-slate-400 font-sans leading-relaxed">
            Each thread represents an isolated Claude Code sub-task process wrapper. Start a clean conversational context.
          </p>

          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                Thread Subject / Goal
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Refactor Auth Router, Setup unit tests"
                className="w-full bg-[#18181B] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
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
              Start Thread
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
