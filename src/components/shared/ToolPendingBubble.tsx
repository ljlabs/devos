/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ToolPendingBubble: Renders tool call pending/in-progress with optional result expansion.
 * Used by both ChatCanvas (desktop) and MobileChatCanvas (mobile).
 */

import React from "react";
import { Zap, Terminal, CheckCircle2, XCircle } from "lucide-react";
import { Message } from "../../types";

interface ToolPendingBubbleProps {
  toolCallId: string;
  title: string | undefined;
  kind: string | undefined;
  status: string | undefined;
  timestamp: string | number;
  resultMsg: Message | undefined;
  resultStatus: string | undefined;
  permissionApproved: boolean | undefined;
  permissionRejected: boolean | undefined;
  hasApproval: boolean;
  isExpanded: boolean;
  onToggleExpand: (toolCallId: string) => void;
  compact?: boolean; // true for mobile, false for desktop
}

export function ToolPendingBubble({
  toolCallId,
  title,
  kind,
  status,
  timestamp,
  resultMsg,
  resultStatus,
  permissionApproved,
  permissionRejected,
  hasApproval,
  isExpanded,
  onToggleExpand,
  compact = false,
}: ToolPendingBubbleProps) {
  const hasResult = !!resultMsg;
  const isFailed = resultStatus === "failed";
  const isCompleted = resultStatus === "completed";

  const iconClass = compact ? "w-6 h-6" : "w-8 h-8";
  const iconSize = compact ? 12 : 16;
  const borderRadiusClass = compact ? "rounded" : "rounded-lg";
  const paddingClass = compact ? "px-3 py-2" : "px-4 py-2";
  const textSizeClass = compact ? "text-[9px]" : "text-[10px]";

  return (
    <div className={compact ? "flex justify-start gap-2 min-w-0" : "flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text"}>
      <div
        className={`${iconClass} ${borderRadiusClass} flex items-center justify-center flex-shrink-0 shadow-[0_0_15px_rgba(100,116,139,0.15)] select-none border ${
          isFailed
            ? "bg-red-500/20 border-red-500/40"
            : hasApproval
              ? permissionApproved
                ? "bg-emerald-500/20 border-emerald-500/40"
                : "bg-red-500/20 border-red-500/40"
              : "bg-slate-500/20 border-slate-500/40"
        } ${!compact && "mt-0.5"}`}
      >
        {isFailed ? (
          <XCircle size={iconSize} className="text-red-400" />
        ) : hasApproval ? (
          permissionApproved ? (
            <CheckCircle2 size={iconSize} className="text-emerald-400" />
          ) : (
            <XCircle size={iconSize} className="text-red-400" />
          )
        ) : isCompleted ? (
          <Terminal size={iconSize} className="text-emerald-400" />
        ) : (
          <Zap size={iconSize} className="text-slate-400 animate-pulse" />
        )}
      </div>
      <div className={compact ? "flex-1 min-w-0" : "flex-1 max-w-[90%]"}>
        <div
          className={`border rounded-lg overflow-hidden bg-black/40 ${
            isFailed ? "border-red-500/30" : "border-slate-500/20"
          }`}
        >
          {/* Tool header / toggle button */}
          <button
            onClick={() => (hasResult ? onToggleExpand(toolCallId) : undefined)}
            className={`w-full flex items-center justify-between ${paddingClass} border-b transition-colors select-none text-left ${
              isFailed
                ? "bg-red-950/40 border-red-500/20 hover:bg-red-950/60 cursor-pointer"
                : hasResult
                  ? "bg-[#0E0E11] border-slate-500/10 hover:bg-slate-900/20 cursor-pointer"
                  : "bg-[#0E0E11] border-slate-500/10"
            }`}
            disabled={!hasResult}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span
                className={`${textSizeClass} font-mono font-bold uppercase tracking-wider break-all ${
                  isFailed ? "text-red-400" : "text-slate-400"
                }`}
              >
                {kind?.toUpperCase() || "TOOL"}: {title || "pending…"}
              </span>
              {isFailed && (
                <span className={`${textSizeClass} font-semibold px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 flex-shrink-0`}>
                  ✗ Failed
                </span>
              )}
              {!isFailed && hasApproval && (
                <span
                  className={`${textSizeClass} font-semibold px-2 py-0.5 rounded flex-shrink-0 ${
                    permissionApproved
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-red-500/20 text-red-300 border border-red-500/30"
                  }`}
                >
                  {permissionApproved ? "✓ Approved" : "✗ Rejected"}
                </span>
              )}
            </div>
            {hasResult && (
              <div className={`text-xs ml-2 ${isFailed ? "text-red-400/70" : "text-slate-500"}`}>
                {isExpanded ? "▼ Hide output" : "▶ Show output"}
              </div>
            )}
          </button>

          {/* Tool output (collapsible, shown if expanded and result exists) */}
          {hasResult && isExpanded && resultMsg && (
            <div
              className={`p-3 max-h-60 overflow-y-auto custom-scrollbar ${
                isFailed ? "bg-red-950/20" : "bg-black/95"
              }`}
            >
              <pre
                className={`font-mono text-xs whitespace-pre-wrap break-words ${
                  isFailed ? "text-red-300" : "text-slate-300"
                }`}
              >
                {typeof resultMsg.raw?.params?.update?.rawOutput === "string"
                  ? resultMsg.raw.params.update.rawOutput
                  : JSON.stringify(resultMsg.raw?.params?.update?.rawOutput, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
