/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { derivePatternVariants } from "../../utils/patterns";

export const PermissionBubble = React.memo(function PermissionBubble({
  toolCall,
  options,
  onRespond,
  timestamp,
  workspacePath,
}: {
  toolCall: any;
  options: Array<{ optionId: string; name: string; kind: string }>;
  onRespond: (optionId: string, toolCommand?: string, toolName?: string) => void;
  timestamp: string;
  workspacePath?: string;
}) {
  const [showPatternPicker, setShowPatternPicker] = useState(false);
  const [selectedPattern, setSelectedPattern] = useState<string | null>(null);

  const command: string =
    toolCall?.rawInput?.command ??
    toolCall?.rawInput?.file_path ??
    toolCall?.rawInput?.path ??
    "";
  // Prefer the ACP-provided tool name from metadata.
  // For execute-kind tools (shell commands), always use "Bash" — never derive
  // it from the command title, which would produce "cd" for "cd X && cat Y".
  const toolName: string | undefined =
    toolCall?._meta?.claudeCode?.toolName ??
    (toolCall?.kind === "execute" ? "Bash" : undefined) ??
    (typeof toolCall?.title === "string" ? toolCall.title.split(/\s+/)[0] : undefined);
  const patternVariants = derivePatternVariants(command, toolCall?.kind, workspacePath);

  function handleStandardOption(optionId: string) {
    // For allow_always we also pass the command and toolName so the server
    // scopes the pattern to this specific tool (Bash patterns won't match Write, etc.)
    onRespond(optionId, optionId === "allow_always" ? command : undefined, toolName);
  }

  async function handleConfirmSimilar() {
    if (!selectedPattern) return;
    // Save the pattern BEFORE unblocking the agent. The agent may immediately
    // retry the same tool after allow_once — the pattern must already be in
    // the DB when that next session/request_permission arrives, or it won't
    // be auto-approved and the user gets a duplicate prompt.
    try {
      await fetch("/api/allowedPatterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern: selectedPattern,
          toolName,
          variant: toolCall?.kind ?? "wildcard",
        }),
      });
    } catch (err) {
      console.error("Failed to save allow-similar pattern:", err);
      // Still unblock the agent even if the save failed — better to proceed
      // than to leave the agent permanently blocked.
    }
    // Use the allow-once optionId from ACP's actual options list — never hardcode
    const allowOnceOption = options.find((o) => o.kind === "allow_once");
    onRespond(allowOnceOption?.optionId ?? "allow");
    setShowPatternPicker(false);
  }

  return (
    <div className="flex justify-start gap-2 min-w-0 sm:gap-4 sm:max-w-4xl sm:mx-auto sm:w-full group animate-fadeIn">
      <div className="w-6 h-6 sm:w-8 sm:h-8 bg-amber-500/20 border border-amber-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(245,158,11,0.15)] select-none">
        <ShieldAlert size={16} className="text-amber-400 animate-pulse" />
      </div>
      <div className="flex-1 min-w-0 sm:max-w-[90%]">
        <div className="border border-amber-500/30 rounded-xl overflow-hidden bg-amber-500/5">
          {/* Header */}
          <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 select-none">
            <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">Permission Required</p>
            <p className="text-sm text-amber-200 mt-1 font-medium break-all">{toolCall?.title}</p>
            {toolCall?.kind && (
              <p className="text-[10px] text-amber-400/60 mt-0.5 font-mono">kind: {toolCall.kind}</p>
            )}
          </div>

          {/* Standard ACP options + Allow Similar button */}
          {!showPatternPicker && (
            <div className="px-4 py-3 flex flex-wrap gap-2">
              {(options ?? []).map((opt) => {
                let btnClass = "px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer active:scale-95 ";
                if (opt.kind === "allow_always") {
                  btnClass += "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30";
                } else if (opt.kind === "allow_once") {
                  btnClass += "bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30";
                } else {
                  btnClass += "bg-transparent border-white/20 text-slate-300 hover:bg-white/5";
                }
                return (
                  <button key={opt.optionId} className={btnClass} onClick={() => handleStandardOption(opt.optionId)}>
                    {opt.name}
                  </button>
                );
              })}
              {/* Only show "Allow Similar" when there are non-exact variants available */}
              {patternVariants.length > 1 && (
                <button
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer active:scale-95 bg-cyan-500/20 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30"
                  onClick={() => {
                    setSelectedPattern(patternVariants[1]?.pattern ?? null);
                    setShowPatternPicker(true);
                  }}
                >
                  Allow Similar…
                </button>
              )}
            </div>
          )}

          {/* Inline pattern picker — shown when user clicks "Allow Similar…" */}
          {showPatternPicker && (
            <div className="px-4 py-3 space-y-3">
              <p className="text-[11px] text-cyan-300 font-mono font-semibold uppercase tracking-wider">
                Choose which commands to allow automatically:
              </p>
              <div className="space-y-1.5">
                {patternVariants.map((v) => (
                  <label
                    key={v.pattern}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      selectedPattern === v.pattern
                        ? "border-cyan-500/50 bg-cyan-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/20"
                    }`}
                  >
                    <input
                      type="radio"
                      name="pattern"
                      value={v.pattern}
                      checked={selectedPattern === v.pattern}
                      onChange={() => setSelectedPattern(v.pattern)}
                      className="mt-0.5 accent-cyan-400 shrink-0"
                    />
                    <span className="text-xs font-mono text-slate-300 break-all">
                      {toolName ? <span className="text-cyan-400">{toolName}: </span> : null}{v.label}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  disabled={!selectedPattern}
                  onClick={handleConfirmSimilar}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer active:scale-95 bg-cyan-500/20 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Confirm &amp; Allow
                </button>
                <button
                  onClick={() => setShowPatternPicker(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
