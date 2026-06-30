/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Cpu, ChevronUp, ChevronDown } from "lucide-react";

export function ThinkingBlock({ content }: { content: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className="my-3 border border-emerald-500/20 rounded-lg overflow-hidden bg-emerald-500/5 animate-fadeIn">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono text-emerald-400 hover:bg-emerald-500/10 transition-colors select-none group"
      >
        <div className="flex items-center gap-2">
          <Cpu size={14} className="text-emerald-500 group-hover:animate-pulse" />
          <span className="font-bold uppercase tracking-wider">Thinking Process</span>
        </div>
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {isExpanded && (
        <div className="px-3 py-3 border-t border-emerald-500/20 text-slate-400 text-xs italic leading-relaxed bg-black/20">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
