/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UserMessageBubble: Renders a user's message in a speech bubble.
 * Used by both ChatCanvas (desktop) and MobileChatCanvas (mobile).
 */

import React from "react";

interface UserMessageBubbleProps {
  content: string;
  timestamp: string | number;
  compact?: boolean; // true for mobile, false for desktop
}

export function UserMessageBubble({
  content,
  timestamp,
  compact = false,
}: UserMessageBubbleProps) {
  const ts = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  
  if (compact) {
    // Mobile layout
    return (
      <div className="flex justify-end min-w-0">
        <div className="max-w-full bg-[#18181B] border border-white/5 p-2.5 rounded-lg rounded-tr-none text-xs overflow-hidden">
          <p className="leading-relaxed text-slate-200 whitespace-pre-wrap break-words">
            {content}
          </p>
          <div className="text-[9px] text-slate-500 font-mono mt-1 text-right">
            {ts.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="flex justify-end max-w-4xl mx-auto w-full group animate-fadeIn select-text px-2 sm:px-0">
      <div className="max-w-[85%] sm:max-w-[80%] bg-[#18181B] border border-white/5 p-3 sm:p-4 rounded-lg sm:rounded-2xl rounded-tr-none text-xs sm:text-sm">
        <p className="leading-relaxed text-slate-200 whitespace-pre-wrap break-words">
          {content}
        </p>
        <div className="text-[9px] sm:text-[10px] text-slate-500 font-mono mt-2 text-right select-none">
          {ts.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
