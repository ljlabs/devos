/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { ShieldAlert } from "lucide-react";

type PatternVariant = { label: string; pattern: string };
type AllowSimilarPresentation = {
  toolName?: string;
  allowOptionId: string;
  variants: PatternVariant[];
};

export const PermissionBubble = React.memo(function PermissionBubble({
  toolCall,
  options,
  allowSimilar,
  onRespond,
}: {
  toolCall: any;
  options: Array<{ optionId: string; name: string; kind: string }>;
  allowSimilar?: AllowSimilarPresentation;
  onRespond: (optionId: string, selectedPattern?: string) => void;
  timestamp: string;
}) {
  const [showPatternPicker, setShowPatternPicker] = useState(false);
  const [selectedPattern, setSelectedPattern] = useState<string | null>(null);
  const variants = allowSimilar?.variants ?? [];

  function confirmSimilar() {
    if (!selectedPattern || !allowSimilar) return;
    onRespond(allowSimilar.allowOptionId, selectedPattern);
    setShowPatternPicker(false);
  }

  return (
    <div className="flex justify-start gap-2 min-w-0 sm:gap-4 sm:max-w-4xl sm:mx-auto sm:w-full group animate-fadeIn">
      <div className="w-6 h-6 sm:w-8 sm:h-8 bg-amber-500/20 border border-amber-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(245,158,11,0.15)] select-none">
        <ShieldAlert size={16} className="text-amber-400 animate-pulse" />
      </div>
      <div className="flex-1 min-w-0 sm:max-w-[90%]">
        <div className="border border-amber-500/30 rounded-xl overflow-hidden bg-amber-500/5">
          <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 select-none">
            <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">Permission Required</p>
            <p className="text-sm text-amber-200 mt-1 font-medium break-all">{toolCall?.title}</p>
            {toolCall?.kind && <p className="text-[10px] text-amber-400/60 mt-0.5 font-mono">kind: {toolCall.kind}</p>}
          </div>

          {!showPatternPicker && (
            <div className="px-4 py-3 flex flex-wrap gap-2">
              {options.map((option) => {
                let classes = "px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer active:scale-95 ";
                if (option.kind === "allow_always") classes += "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30";
                else if (option.kind === "allow_once") classes += "bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30";
                else classes += "bg-transparent border-white/20 text-slate-300 hover:bg-white/5";
                return (
                  <button key={option.optionId} className={classes} onClick={() => onRespond(option.optionId)}>
                    {option.name}
                  </button>
                );
              })}
              {variants.length > 1 && (
                <button
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer active:scale-95 bg-cyan-500/20 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30"
                  onClick={() => {
                    setSelectedPattern(variants[1]?.pattern ?? null);
                    setShowPatternPicker(true);
                  }}
                >
                  Allow Similar…
                </button>
              )}
            </div>
          )}

          {showPatternPicker && (
            <div className="px-4 py-3 space-y-3">
              <p className="text-[11px] text-cyan-300 font-mono font-semibold uppercase tracking-wider">
                Choose which commands to allow automatically:
              </p>
              <div className="space-y-1.5">
                {variants.map((variant) => (
                  <label
                    key={variant.pattern}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      selectedPattern === variant.pattern
                        ? "border-cyan-500/50 bg-cyan-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/20"
                    }`}
                  >
                    <input
                      type="radio"
                      name="pattern"
                      value={variant.pattern}
                      checked={selectedPattern === variant.pattern}
                      onChange={() => setSelectedPattern(variant.pattern)}
                      className="mt-0.5 accent-cyan-400 shrink-0"
                    />
                    <span className="text-xs font-mono text-slate-300 break-all">
                      {allowSimilar?.toolName && <span className="text-cyan-400">{allowSimilar.toolName}: </span>}
                      {variant.label}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  disabled={!selectedPattern}
                  onClick={confirmSimilar}
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