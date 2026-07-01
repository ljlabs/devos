/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useCallback, useState } from "react";
import { Terminal, X } from "lucide-react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TerminalDisplayProps {
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
  { label: "CTRL", sequence: "" },
  { label: "ALT", sequence: "" },
  { label: "SHIFT", sequence: "" },
  { label: "↑", sequence: "\x1b[A" },
  { label: "↓", sequence: "\x1b[B" },
  { label: "←", sequence: "\x1b[D" },
  { label: "→", sequence: "\x1b[C" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TerminalDisplay({
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

  // Debounce duplicate submissions and phantom keystrokes
  const lastSubmitTimeRef = useRef(0);
  const lastDataRef = useRef<string>("");

  // Modifier state (for UI rendering)
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [altArmed, setAltArmed] = useState(false);
  const [shiftArmed, setShiftArmed] = useState(false);

  // Modifier refs (for event handlers to avoid stale closures)
  const ctrlArmedRef = useRef(false);
  const altArmedRef = useRef(false);
  const shiftArmedRef = useRef(false);

  // Safety net: auto-clear modifiers after 5s
  const modifierExpireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const fitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const touchStateRef = useRef({ startY: 0, lastY: 0 });

  // Lock page-level scrolling
  useEffect(() => {
    const { body, documentElement: html } = document;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyWidth = body.style.width;
    const prevBodyTop = body.style.top;
    const scrollY = window.scrollY;

    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.width = "100%";
    body.style.top = `-${scrollY}px`;

    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      body.style.position = prevBodyPosition;
      body.style.width = prevBodyWidth;
      body.style.top = prevBodyTop;
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Monitor virtual keyboard height
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !window.visualViewport) return;

    const updateContainerHeight = () => {
      window.scrollTo(0, 0);
      const vh = window.visualViewport.height;
      const headerHeight = 48;
      const toolbarHeight = 56;
      const availableHeight = vh - headerHeight - toolbarHeight - 24;
      const maxHeight = Math.max(availableHeight, 100);

      container.style.maxHeight = `${maxHeight}px`;
      container.style.height = `${maxHeight}px`;

      if (fitAddonRef.current && termRef.current) {
        try { fitAddonRef.current.fit(); } catch { }
      }
    };

    window.visualViewport.addEventListener("resize", updateContainerHeight);
    window.visualViewport.addEventListener("scroll", updateContainerHeight);
    updateContainerHeight();

    return () => {
      window.visualViewport?.removeEventListener("resize", updateContainerHeight);
      window.visualViewport?.removeEventListener("scroll", updateContainerHeight);
    };
  }, []);

  // Clear all modifiers
  const clearAllModifiers = useCallback(() => {
    if (modifierExpireTimerRef.current) {
      clearTimeout(modifierExpireTimerRef.current);
      modifierExpireTimerRef.current = null;
    }
    ctrlArmedRef.current = false;
    altArmedRef.current = false;
    shiftArmedRef.current = false;
    setCtrlArmed(false);
    setAltArmed(false);
    setShiftArmed(false);
  }, []);

  // Arm modifier expiry timer
  const armModifierExpiry = useCallback(() => {
    if (modifierExpireTimerRef.current) clearTimeout(modifierExpireTimerRef.current);
    modifierExpireTimerRef.current = setTimeout(() => {
      clearAllModifiers();
    }, 5000);
  }, [clearAllModifiers]);

  const sendToShell = useCallback((data: string, source: string) => {
    console.log(`submit data: ${data}, from ${source}`);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "terminal_data",
        terminalId: termIdRef.current,
        data,
      })
    );
  }, []);

  // Initialize xterm + WebSocket
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Create instances locally so cleanup correctly targets them,
    // protecting against React 18 Strict Mode double-invocations.
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

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    term.open(container);

    if (term.textarea) {
      term.textarea.setAttribute('autocorrect', 'off');
      term.textarea.setAttribute('autocapitalize', 'off');
      term.textarea.setAttribute('spellcheck', 'false');
      term.textarea.setAttribute('autocomplete', 'off');
      term.textarea.setAttribute('data-gramm', 'false');
      term.textarea.focus();
    }

    fitTimeoutRef.current = setTimeout(() => {
      try { fitAddon.fit(); } catch (e) { console.warn("Initial fit failed:", e); }
    }, 100);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      try { fitAddon.fit(); } catch { }
      const dims = fitAddon.proposeDimensions();
      const cols = dims?.cols || 80;
      const rows = dims?.rows || 24;

      ws.send(JSON.stringify({
        type: "terminal_create",
        terminalId: termIdRef.current,
        cols,
        rows,
      }));
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
      } catch { }
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[31m[Disconnected]\x1b[0m\r\n");
      setIsConnected(false);
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31m[Connection error]\x1b[0m\r\n");
    };

    // --- CENTRALIZED INPUT HANDLING ---
    // --- 1. NORMAL TYPING HANDLER ---
    const disposable = term.onData((data: string) => {
      const hasModifier = ctrlArmedRef.current || altArmedRef.current || shiftArmedRef.current;
      if (hasModifier) return;

      const now = Date.now();
      
      // 1. Block exact duplicate submissions within 50ms (mobile IME burst fix)
      if (data === lastDataRef.current && now - lastSubmitTimeRef.current < 50) {
        return;
      }

      // 2. Phantom keystroke fix:
      // Some browsers insert the literal key (e.g., "c") into the textarea 
      // after a prevented Ctrl+key (e.g., Ctrl+C) event. This results in 
      // the shell receiving the control character, followed by the literal character.
      const isControlChar = (d: string) => d.length === 1 && d.charCodeAt(0) < 32;
      const isPrintableChar = (d: string) => d.length === 1 && d.charCodeAt(0) >= 32;

      if (isControlChar(lastDataRef.current) && isPrintableChar(data)) {
        if (now - lastSubmitTimeRef.current < 150) {
          console.log(`Dropped phantom keystroke: "${data}" following "${lastDataRef.current}"`);
          lastDataRef.current = data; // Update so we don't drop the NEXT legitimate keystroke
          return;
        }
      }

      lastSubmitTimeRef.current = now;
      lastDataRef.current = data;
      sendToShell(data, "onData");
    });

    // --- 2. VIRTUAL MODIFIER INTERCEPTOR (THE FIX) ---
    const handleBeforeInput = (e: InputEvent) => {
      const hasModifier = ctrlArmedRef.current || altArmedRef.current || shiftArmedRef.current;
      
      if (!hasModifier || !e.data) return;

      e.preventDefault();
      e.stopPropagation();

      const firstChar = e.data[e.data.length-1];
      let mapped = firstChar;

      if (ctrlArmedRef.current) {
        if (/^[a-zA-Z]$/.test(firstChar)) {
          mapped = String.fromCharCode(firstChar.toLowerCase().charCodeAt(0) - 96);
        } else if (firstChar === ' ' || firstChar === '@') { mapped = '\x00'; }
        else if (firstChar === '[') { mapped = '\x1b'; }
        else if (firstChar === '\\') { mapped = '\x1c'; }
        else if (firstChar === ']') { mapped = '\x1d'; }
        else if (firstChar === '^') { mapped = '\x1e'; }
        else if (firstChar === '_') { mapped = '\x1f'; }
      } else if (shiftArmedRef.current) {
        const shiftMap: Record<string, string> = {
          '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
          '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
          '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|',
          ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '`': '~'
        };
        if (/^[a-zA-Z]$/.test(firstChar)) {
          mapped = firstChar.toUpperCase();
        } else if (shiftMap[firstChar]) {
          mapped = shiftMap[firstChar];
        }
      }

      if (altArmedRef.current) {
        mapped = '\x1b' + mapped;
      }

      sendToShell(mapped, "beforeinput (Virtual Modifier)");
      clearAllModifiers();
    };

    container.addEventListener("beforeinput", handleBeforeInput as EventListener, { capture: true });

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "terminal_resize",
              terminalId: termIdRef.current,
              cols: dims.cols,
              rows: dims.rows,
            }));
          }
        } catch { }
      });
    });
    resizeObserver.observe(container);

    const onTouchStart = (e: TouchEvent) => {
      touchStateRef.current.startY = e.touches[0].clientY;
      touchStateRef.current.lastY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0].clientY;
      const deltaY = touchStateRef.current.lastY - currentY;
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

    return () => {
      disposable.dispose();
      resizeObserver.disconnect();
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);

      container.removeEventListener("beforeinput", handleBeforeInput as EventListener, { capture: true });

      if (fitTimeoutRef.current) {
        clearTimeout(fitTimeoutRef.current);
      }

      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.send(JSON.stringify({ type: "terminal_close", terminalId: termIdRef.current }));
          ws.close();
        }
      } catch { }

      term.dispose();

      if (wsRef.current === ws) wsRef.current = null;
      if (termRef.current === term) termRef.current = null;
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
      
      setIsConnected(false);
    };
  }, [sendToShell, clearAllModifiers]);

  // Virtual key handler
  const handleVirtualKey = useCallback((key: VKey) => {
    if (key.label === "CTRL") {
      const next = !ctrlArmedRef.current;
      ctrlArmedRef.current = next;
      setCtrlArmed(next);
      if (next) armModifierExpiry();
      termRef.current?.focus();
      return;
    }
    if (key.label === "ALT") {
      const next = !altArmedRef.current;
      altArmedRef.current = next;
      setAltArmed(next);
      if (next) armModifierExpiry();
      termRef.current?.focus();
      return;
    }
    if (key.label === "SHIFT") {
      const next = !shiftArmedRef.current;
      shiftArmedRef.current = next;
      setShiftArmed(next);
      if (next) armModifierExpiry();
      termRef.current?.focus();
      return;
    }

    sendToShell(key.sequence, "handleVirtualKey");
    clearAllModifiers();
    termRef.current?.focus();
  }, [sendToShell, armModifierExpiry, clearAllModifiers]);

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
        style={{ maxHeight: '100%', height: '100%', overscrollBehavior: 'contain' }}
      />

      {/* Virtual keyboard toolbar (mobile) */}
      <div className="bg-[#16161A] border-t border-white/5 flex items-center gap-1.5 px-2 py-1.5 flex-shrink-0 overflow-x-auto">
        {VIRTUAL_KEYS.map((key) => {
          const isModifier =
            (key.label === "CTRL" && ctrlArmed) ||
            (key.label === "ALT" && altArmed) ||
            (key.label === "SHIFT" && shiftArmed);
          return (
            <button
              key={key.label}
              onPointerDown={(e) => {
                e.preventDefault();
                handleVirtualKey(key);
              }}
              className={`px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-colors touch-manipulation flex-shrink-0 ${isModifier
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