/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TerminalPane — a single PTY-backed terminal rendered with xterm.js.
 *
 * Binds to a session id via the shared terminal WebSocket (useTerminalSocket):
 * creates the session on mount, pipes user keystrokes to the backend, writes
 * backend output into the terminal, and reports resize + exit.
 */

import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { SplitSquareHorizontal, SplitSquareVertical, X } from "lucide-react";
import type { TerminalSocketApi } from "../../hooks/useTerminalSocket";

interface TerminalPaneProps {
  sessionId: string;
  cwd?: string;
  socket: TerminalSocketApi;
  onSplit: (direction: "horizontal" | "vertical") => void;
  onClose: () => void;
  onFocus: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}

export default function TerminalPane({
  sessionId,
  cwd,
  socket,
  onSplit,
  onClose,
  onFocus,
  onDragStart,
  onDrop,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState<number | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);

  // Create the PTY session + wire output once per session id.
  useEffect(() => {
    setExited(null);
    socket.createTerminal(sessionId, cwd, 80, 24);
    const unsubscribe = socket.subscribe(
      sessionId,
      (data) => {
        termRef.current?.write(data);
      },
      (code) => {
        setExited(code);
      }
    );
    return () => {
      unsubscribe();
      socket.closeTerminal(sessionId);
    };
  }, [sessionId, cwd, socket]);

  // Initialise xterm once the host element exists.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#0B0B0C",
        foreground: "#E4E4E7",
        cursor: "#10B981",
        selectionBackground: "#10B98144",
        black: "#0B0B0C",
        brightBlack: "#52525B",
      },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    try {
      fit.fit();
    } catch {
      /* element not yet measurable */
    }

    const onData = term.onData((data) => socket.write(sessionId, data));

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        socket.resize(sessionId, term.cols, term.rows);
      } catch {
        /* ignore transient measure failures */
      }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      onData.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, socket]);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", sessionId);
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
        {exited !== null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0B0B0C]/90 text-slate-400 gap-2">
            <span className="text-xs font-mono">Process exited (code {exited})</span>
            <button
              onClick={onClose}
              className="px-3 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-slate-200"
            >
              Close pane
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
