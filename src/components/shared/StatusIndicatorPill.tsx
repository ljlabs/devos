/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface StatusIndicatorPillProps {
  status: "thinking" | "running" | "awaiting_permission" | "idle";
}

export function StatusIndicatorPill({ status }: StatusIndicatorPillProps) {
  if (status === "idle") {
    return null;
  }

  return (
    <div
      className={`absolute bottom-24 left-1/2 -translate-x-1/2 border text-emerald-300 font-mono text-[11px] px-4 py-1.5 rounded-full flex items-center gap-2 shadow-2xl select-none z-10 ${
        status === "awaiting_permission"
          ? "border-amber-500/30"
          : "border-emerald-500/20"
      }`}
       style={{ backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
    >
      <div
        className={`w-2 h-2 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-ping ${
          status === "awaiting_permission"
            ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
            : "bg-emerald-500"
        }`}
      />
      <span>
        {status === "awaiting_permission"
          ? "Awaiting your approval..."
          : status === "running"
            ? "Claude is executing..."
            : "Claude is thinking..."}
      </span>
    </div>
  );
}
