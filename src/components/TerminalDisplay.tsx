/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useCallback, useState } from "react";
import { Terminal, Plus, X } from "lucide-react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TerminalDisplayProps {
  logs?: any[];
  threadTitle?: string;
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// xterm theme matching DevOS palette
// ---------------------------------------------------------------------------

const TERMINAL_THEME = {
  background: "#0B0B0C",
  foreground: "#c9d1d9",
  cursor: "#3fb950",
  cursorAccent: "#0B0B0C",
  selectionBackground: "#1f6feb44",
  black: "#0d1117",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#c9d1d9",
  brightBlack: "#484f58",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

// ---------------------------------------------------------------------------
// Virtual keyboard keys
// ---------------------------------------------------------------------------

interface VKey {
  label: string;
  sequence: string;
}

const VIRTUAL_KEYS: VKey[] = [
  { label: "ESC", sequence: "\x1b" },
  { label: "TAB", sequence: "\t" },
  { label: "CTRL", sequence: "" },  // modifier — handled specially
  { label: "ALT", sequence: "" },   // modifier — handled specially
  { label: "↑", sequence: "\x1b[A" },  // Up
  { label: "↓", sequence: "\x1b[B" },  // Down
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TerminalDisplay({
  logs = [],
  threadTitle,
  onClose,
}: TerminalDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termIdRef = useRef<string>(
    `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const ctrlModifierRef = useRef(false);
  const altModifierRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const fitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const touchStateRef = useRef({ startY: 0, lastY: 0 });

  // Cleanup function
  const cleanup = useCallback(() => {
    if (fitTimeoutRef.current) {
      clearTimeout(fitTimeoutRef.current);
      fitTimeoutRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.send(
          JSON.stringify({ type: "terminal_close", terminalId: termIdRef.current })
        );
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }
    fitAddonRef.current = null;
    setIsConnected(false);
  }, []);

  // Initialize xterm + WebSocket on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create xterm instance
    const term = new XTerminal({
      theme: TERMINAL_THEME,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 5000,
    });
    termRef.current = term;

    // Fit addon
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Open terminal in container
    term.open(container);

    // Delay fit to let the container fully render + calculate layout
    // Use setTimeout for more reliable layout calculation than requestAnimationFrame
    fitTimeoutRef.current = setTimeout(() => {
      try {
        fitAddon.fit();
        // Verify dimensions were calculated; fallback if needed
        const dims = fitAddon.proposeDimensions();
        if (!dims || dims.cols < 40 || dims.rows < 10) {
          // Container height still unmeasured; use terminal's current size
          console.warn("FitAddon dimensions too small, using terminal defaults");
        }
      } catch (e) {
        console.warn("Initial fit failed:", e);
      }
    }, 100);

    // WebSocket connection
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Send initial size
      const dims = fitAddon.proposeDimensions();
      const cols = dims?.cols || 80;
      const rows = dims?.rows || 24;

      ws.send(
        JSON.stringify({
          type: "terminal_create",
          terminalId: termIdRef.current,
          cols,
          rows,
        })
      );
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "terminal_output" && msg.data) {
          term.write(msg.data);
        } else if (msg.type === "terminal_exit") {
          term.write("\r\n\x1b[33m[Process exited]\x1b[0m\r\n");
        }
      } catch {}
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[31m[Disconnected]\x1b[0m\r\n");
      setIsConnected(false);
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31m[Connection error]\x1b[0m\r\n");
    };

    // Terminal input → WebSocket
    const disposable = term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "terminal_data",
            terminalId: termIdRef.current,
            data,
          })
        );
      }
    });

    // ResizeObserver for auto-fit
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "terminal_resize",
                terminalId: termIdRef.current,
                cols: dims.cols,
                rows: dims.rows,
              })
            );
          }
        } catch {}
      });
    });
    resizeObserver.observe(container);

    // Manual touch scroll fallback for mobile
    // xterm.js sets touch-action: none on the parent, which blocks native scroll
    // This captures touch drag and converts it to scrollLines() calls
    const onTouchStart = (e: TouchEvent) => {
      touchStateRef.current.startY = e.touches[0].clientY;
      touchStateRef.current.lastY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0].clientY;
      const deltaY = touchStateRef.current.lastY - currentY;
      
      // Line height in pixels (tune this to match your font size + line spacing)
      // fontSize: 13 with default line-height typically gives ~18-20px per row
      const lineHeight = 20;
      
      if (Math.abs(deltaY) >= lineHeight) {
        const lines = Math.trunc(deltaY / lineHeight);
        if (lines !== 0) {
          term.scrollLines(lines);
          touchStateRef.current.lastY = currentY;
        }
      }
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });

    // Cleanup on unmount
    return () => {
      disposable.dispose();
      resizeObserver.disconnect();
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      cleanup();
    };
  }, [cleanup]);

  // Virtual key handler
  const handleVirtualKey = useCallback((key: VKey) => {
    const term = termRef.current;
    if (!term) return;

    // Handle CTRL as modifier
    if (key.label === "CTRL") {
      ctrlModifierRef.current = !ctrlModifierRef.current;
      return;
    }
    if (key.label === "ALT") {
      altModifierRef.current = !altModifierRef.current;
      return;
    }

    // Send with modifier
    if (ctrlModifierRef.current && key.label.length === 1) {
      const code = key.label.toLowerCase().charCodeAt(0) - 96;
      term.write(String.fromCharCode(code));
      ctrlModifierRef.current = false;
      return;
    }

    term.write(key.sequence);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0B0B0C]">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-[#16161A] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal size={16} className={isConnected ? "text-emerald-400" : "text-slate-500"} />
          <span className="text-[10px] font-mono font-bold tracking-widest text-slate-500 uppercase">
            {threadTitle ? `zsh — ${threadTitle}` : "zsh — 80x24"}
          </span>
          {isConnected && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-red-400 transition-colors"
            title="Close terminal"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* xterm container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden p-1"
      />

      {/* Virtual keyboard toolbar (mobile) */}
      <div className="bg-[#16161A] border-t border-white/5 flex items-center justify-around px-2 py-1.5 flex-shrink-0">
        {VIRTUAL_KEYS.map((key) => {
          const isModifier =
            (key.label === "CTRL" && ctrlModifierRef.current) ||
            (key.label === "ALT" && altModifierRef.current);
          return (
            <button
              key={key.label}
              onClick={() => handleVirtualKey(key)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-colors ${
                isModifier
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-white/5 text-slate-400 active:bg-emerald-500/20 active:text-emerald-400"
              }`}
            >
              {key.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}