/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TerminalPane — renders a pre-created xterm Terminal into a host div.
 *
 * This is a "dumb" presentational component. PTY lifecycle and xterm Terminal
 * creation live in TerminalView so sessions survive tree restructuring (split /
 * close) without being unmounted by React reconciliation.
 */

import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SplitSquareHorizontal, SplitSquareVertical, X } from "lucide-react";

interface TerminalPaneProps {
  /** Pre-created xterm Terminal instance — owned by the parent. */
  terminal: Terminal;
  /** Raw cwd string for the title bar display. */
  cwd?: string;
  /** Resize the PTY when the pane dimensions change. */
  onResize: (cols: number, rows: number) => void;
  onSplit: (direction: "horizontal" | "vertical") => void;
  onClose: () => void;
  onFocus: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}

export default function TerminalPane({
  terminal,
  cwd,
  onResize,
  onSplit,
  onClose,
  onFocus,
  onDragStart,
  onDrop,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const openedRef = useRef(false);
  const [isDropTarget, setIsDropTarget] = useState(false);

  // Mount the xterm Terminal into the host div. The Terminal is created by the
  // parent and persists across re-renders. We only call term.open() once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || openedRef.current) return;
    openedRef.current = true;

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fitRef.current = fit;

    try {
      fit.fit();
    } catch {
      /* element not yet measurable */
    }

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        onResize(terminal.cols, terminal.rows);
      } catch {
        /* ignore transient measure failures */
      }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      fitRef.current = null;
    };
  }, [terminal, onResize]);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", "drag");
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!isDropTarget) setIsDropTarget(true);
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDropTarget(false);
        onDrop();
      }}
      onClick={onFocus}
      className={`flex flex-col w-full h-full bg-[#0B0B0C] min-w-0 min-h-0 outline-none ${
        isDropTarget ? "ring-2 ring-emerald-500/70" : ""
      }`}
    >
      {/* Pane title bar */}
      <div className="flex items-center justify-between h-7 px-2 bg-[#111114] border-b border-white/5 text-slate-400 select-none">
        <span className="text-[11px] font-mono truncate">{cwd || "~"}</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onSplit("horizontal")}
            className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
            title="Split right"
          >
            <SplitSquareHorizontal size={14} />
          </button>
          <button
            onClick={() => onSplit("vertical")}
            className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
            title="Split down"
          >
            <SplitSquareVertical size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
            title="Close pane"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Terminal host */}
      <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
        <div ref={hostRef} className="absolute inset-0 p-1" tabIndex={-1} />
      </div>
    </div>
  );
}
