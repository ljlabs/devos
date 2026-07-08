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
import { GripVertical, SplitSquareHorizontal, SplitSquareVertical, X } from "lucide-react";

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

  // Mount (or re-mount) the xterm Terminal into the host div.
  //
  // React reconciliation: when a pane splits, the TerminalPane component moves
  // to a different position in the tree (new parent = ResizableSplit). React
  // unmounts and remounts the component even when the key is the same, because
  // the parent changed. When this happens the Terminal instance is already
  // open (terminal.element is set). Rather than calling open() again (which
  // corrupts the instance), we move the existing DOM element into the new host
  // and re-attach the FitAddon + ResizeObserver.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let fit: FitAddon;

    if (terminal.element && host.contains(terminal.element)) {
      // Already correctly mounted in this host — just make sure we have a fit addon.
      fit = fitRef.current ?? new FitAddon();
      if (!fitRef.current) {
        terminal.loadAddon(fit);
        fitRef.current = fit;
      }
    } else if (terminal.element) {
      // Terminal was opened into a different host (parent changed after split).
      // Move the xterm DOM element and re-use it in the new host.
      host.appendChild(terminal.element);
      fit = new FitAddon();
      terminal.loadAddon(fit);
      fitRef.current = fit;
    } else {
      // First open.
      fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(host);
      fitRef.current = fit;
    }

    openedRef.current = true;

    try {
      fit.fit();
    } catch {
      /* element not yet measurable */
    }

    // Focus so the newly mounted/remounted pane is immediately typeable.
    terminal.focus();

    const ro = new ResizeObserver(() => {
      try {
        fitRef.current?.fit();
        onResize(terminal.cols, terminal.rows);
      } catch {
        /* ignore transient measure failures */
      }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
    };
  }, [terminal, onResize]);

  // Focus the terminal when the pane is clicked anywhere (except the drag handle).
  const handlePaneClick = () => {
    onFocus();
    terminal.focus();
  };

  return (
    <div
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
      className={`flex flex-col w-full h-full bg-[#0B0B0C] min-w-0 min-h-0 outline-none ${
        isDropTarget ? "ring-2 ring-emerald-500/70" : ""
      }`}
    >
      {/* Pane title bar — draggable handle only */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", "drag");
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        className="flex items-center justify-between h-7 px-2 bg-[#111114] border-b border-white/5 text-slate-400 select-none cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <GripVertical size={12} className="shrink-0 opacity-40" />
          <span className="text-[11px] font-mono truncate">{cwd || "~"}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onSplit("horizontal"); }}
            className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
            title="Split right"
          >
            <SplitSquareHorizontal size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSplit("vertical"); }}
            className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
            title="Split down"
          >
            <SplitSquareVertical size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
            title="Close pane"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Terminal host — click anywhere here to focus xterm */}
      <div
        className="relative flex-1 min-h-0 min-w-0 overflow-hidden"
        onClick={handlePaneClick}
      >
        <div ref={hostRef} className="absolute inset-0 p-1" />
      </div>
    </div>
  );
}
