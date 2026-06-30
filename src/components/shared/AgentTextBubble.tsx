/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AgentTextBubble: Renders agent's text response with markdown support.
 * Used by both ChatCanvas (desktop) and MobileChatCanvas (mobile).
 */

import React from "react";
import { Bot } from "lucide-react";
import CopyButton from "../CopyButton";
import { MarkdownContent } from "./MarkdownContent";

interface AgentTextBubbleProps {
  content: string;
  timestamp: string | number;
  compact?: boolean; // true for mobile, false for desktop
}

export function AgentTextBubble({
  content,
  timestamp,
  compact = false,
}: AgentTextBubbleProps) {
  const ts = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  
  if (compact) {
    // Mobile layout
    return (
      <div className="flex justify-start gap-2 min-w-0">
        <div className="w-6 h-6 bg-emerald-500/20 border border-emerald-500/40 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot size={12} className="text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="bg-[#0E0E11] border border-white/5 p-2.5 rounded-lg rounded-tl-none text-xs overflow-hidden">
            <div className="text-[9px] font-mono text-emerald-400 pb-1.5 mb-1.5 border-b border-white/5 flex justify-between gap-2">
              <span>CLAUDE</span>
              <span className="text-slate-500 flex-shrink-0">
                {ts.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div className="overflow-x-hidden">
              <MarkdownContent content={content} />
            </div>
          </div>
          <div className="mt-1 flex justify-end">
            <CopyButton content={content} />
          </div>
        </div>
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="flex justify-start gap-2 sm:gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text px-2 sm:px-0">
      <div className="w-7 h-7 sm:w-8 sm:h-8 bg-emerald-500/20 border border-emerald-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)] select-none">
        <Bot size={14} className="text-emerald-400" />
      </div>
      <div className="flex-1 max-w-[90%] sm:max-w-[90%]">
        <div className="bg-[#0E0E11] border border-white/5 p-3 sm:p-5 rounded-lg sm:rounded-2xl rounded-tl-none text-xs sm:text-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-2 mb-3 border-b border-white/5 select-none text-[9px] sm:text-[10px] font-mono tracking-widest text-emerald-400 font-bold gap-1 sm:gap-0">
            <span>CLAUDE AI AGENT</span>
            <span className="text-slate-500 font-normal whitespace-nowrap">
              {ts.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <MarkdownContent content={content} />
        </div>
        <div className="mt-1 flex justify-end">
          <CopyButton content={content} />
        </div>
      </div>
    </div>
  );
}
