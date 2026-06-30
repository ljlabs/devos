/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ToolResultBubble: Renders orphaned tool result (when no pending call precedes it).
 * Used by both ChatCanvas (desktop) and MobileChatCanvas (mobile).
 */

import React from "react";
import { CheckCircle2 } from "lucide-react";

interface ToolResultBubbleProps {
  title: string | undefined;
  kind: string | undefined;
  rawOutput: any;
  timestamp: string | number;
  compact?: boolean; // true for mobile, false for desktop
}

export function ToolResultBubble({
  title,
  kind,
  rawOutput,
  timestamp,
  compact = false,
}: ToolResultBubbleProps) {
  if (compact) {
    // Mobile layout
    return (
      <div className="flex justify-start gap-2 min-w-0">
        <div className="w-6 h-6 bg-emerald-500/20 border border-emerald-500/40 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
          <CheckCircle2 size={12} className="text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="border border-emerald-500/20 rounded-lg overflow-hidden bg-emerald-500/5">
            <div className="px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20">
              <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-emerald-400">
                {kind?.toUpperCase() || "TOOL"}: Complete
              </span>
            </div>
            <div className="p-2.5 bg-black/95 max-h-48 overflow-y-auto overflow-x-hidden custom-scrollbar">
              <pre className="font-mono text-[10px] text-slate-300 whitespace-pre-wrap break-words">
                {typeof rawOutput === "string"
                  ? rawOutput
                  : JSON.stringify(rawOutput, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text">
      <div className="w-8 h-8 bg-emerald-500/20 border border-emerald-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)] select-none">
        <CheckCircle2 size={16} className="text-emerald-400" />
      </div>
      <div className="flex-1 max-w-[90%]">
        <div className="border border-emerald-500/20 rounded-lg overflow-hidden bg-emerald-500/5">
          <div className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20 select-none">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400">
              {kind?.toUpperCase() || "TOOL"}: Complete
            </span>
          </div>
          <div className="p-3 bg-black/95 max-h-60 overflow-y-auto custom-scrollbar">
            <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap break-words">
              {typeof rawOutput === "string"
                ? rawOutput
                : JSON.stringify(rawOutput, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
