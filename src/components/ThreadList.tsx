/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Plus, Filter } from "lucide-react";
import { Thread } from "../types";

interface ThreadListProps {
  threads: Thread[];
  activeThreadId: string;
  onSelectThread: (id: string) => void;
  onOpenNewThread: () => void;
}

export default function ThreadList({
  threads,
  activeThreadId,
  onSelectThread,
  onOpenNewThread
}: ThreadListProps) {
  return (
    <section className="w-64 bg-[#0E0E11] border-r border-white/5 flex flex-col h-screen select-none">
      {/* Top Emerald button */}
      <div className="p-4 h-14 flex items-center border-b border-white/5 bg-[#0E0E11]">
        <button 
          onClick={onOpenNewThread}
          className="w-full py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-sans text-xs font-semibold rounded-md transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-emerald-950/20"
        >
          <Plus size={14} />
          <span>New Thread</span>
        </button>
      </div>

      {/* Title & Filter */}
      <div className="flex-1 overflow-y-auto py-3 custom-scrollbar">
        <div className="px-4 mb-2 flex items-center justify-between text-[#c6c6cd]/50 uppercase font-mono tracking-widest text-[10px]">
          <span>Active Conversations</span>
          <Filter size={12} className="text-slate-500 cursor-pointer hover:text-slate-300" />
        </div>

        {/* List of threads */}
        <nav className="space-y-1">
          {threads.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500 font-sans">
              No conversation threads. Click + New Thread to start a sub-task.
            </div>
          ) : (
            threads.map((thread) => {
              const isActive = thread.id === activeThreadId;
              
              // Define state color, shadow, label
              let statusColor = "bg-slate-700";
              let statusLabel = "Idle";
              let shadowClass = "";

              if (thread.status === "thinking" || thread.status === "running") {
                statusColor = "bg-emerald-500";
                statusLabel = thread.status === "thinking" ? "Thinking..." : "Running agent session";
                shadowClass = "shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse";
              } else if (thread.status === "awaiting_permission") {
                statusColor = "bg-amber-500";
                statusLabel = "Awaiting permission...";
                shadowClass = "shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse";
              }

              return (
                <div key={thread.id} className="px-2">
                  <div 
                    onClick={() => onSelectThread(thread.id)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-all border relative ${
                      isActive 
                        ? "bg-emerald-500/5 border-emerald-500/20 shadow-lg shadow-black/40" 
                        : "border-transparent hover:bg-white/[0.02]"
                    }`}
                  >
                    {/* Status core bullet */}
                    <div className={`w-2 h-2 rounded-full ${statusColor} ${shadowClass}`} />
                    
                    <div className="flex-1 overflow-hidden">
                      <h4 className={`text-sm truncate font-sans font-medium leading-tight ${
                        isActive ? "text-emerald-50 font-semibold" : "text-slate-400"
                      }`}>
                        {thread.title}
                      </h4>
                      <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                        {statusLabel}
                      </p>
                    </div>

                    {/* Absolute emerald bar indicator on the far-left edge of the active card */}
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2/3 bg-emerald-500 rounded-r-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </nav>
      </div>
    </section>
  );
}
