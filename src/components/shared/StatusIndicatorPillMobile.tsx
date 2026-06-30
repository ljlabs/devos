/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface StatusIndicatorPillMobileProps {
  status: "thinking" | "running" | "awaiting_permission" | "idle";
}

export function StatusIndicatorPillMobile({ status }: StatusIndicatorPillMobileProps) {
  if (status === "idle") {
    return null;
  }

  return (
    <div className="text-center py-3">
      <div
        className={`inline-flex items-center gap-2 border px-3 py-1.5 rounded-full text-[11px] font-mono ${
          status === "awaiting_permission"
            ? "bg-[#0E0E11] border-amber-500/30 text-amber-400"
            : "bg-[#0E0E11] border-emerald-500/20 text-emerald-400"
        }`}
      >
        <div
          className={`w-1.5 h-1.5 rounded-full animate-pulse ${
            status === "awaiting_permission" ? "bg-amber-500" : "bg-emerald-500"
          }`}
        />
        {status === "thinking"
          ? "Claude is thinking..."
          : status === "running"
            ? "Claude is executing..."
            : "Awaiting approval..."}
      </div>
    </div>
  );
}
