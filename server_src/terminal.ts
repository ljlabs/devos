/**
 * terminal.ts
 *
 * Platform-aware PTY terminal manager using node-pty.
 *
 * - Windows: PowerShell
 * - Linux/macOS: Try zsh first, fallback to bash
 *
 * Also maintains output history (last ~100 lines) per session so that
 * reconnecting clients can restore the buffer.
 */

import fs from "fs";
import os from "os";
import path from "path";
import pty from "node-pty";

export interface TerminalSession {
  id: string;
  pty: pty.IPty;
  cwd: string;
  /** Ring buffer of recent output; stores up to maxHistoryLines. */
  outputHistory: string[];
  /** Current position in the ring buffer (where the next line will be written). */
  historyIndex: number;
}

/**
 * CWD marker emitted by the shell prompt hook for CWD tracking.
 * Uses an OSC 9;9 escape sequence (zero-width, not counted in prompt width),
 * so it doesn't corrupt PSReadLine's cursor position in the terminal.
 * Format: ESC ] 9 ; 9 ; <cwd> BEL
 */
export const CWD_MARKER_PREFIX = "\x1b]9;9;";
export const CWD_MARKER_SUFFIX = "\x07";

/**
 * Matches OSC 9;9 CWD markers (ESC ] 9 ; 9 ; <cwd> BEL) emitted by the
 * shell prompt hook. Zero-width, so they never appear in rendered output.
 */
export const CWD_MARKER_RE = new RegExp(
  CWD_MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    "([^\\n]+?)" +
    CWD_MARKER_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  "g"
);

/**
 * Extract CWD values from any OSC 9;9 markers present in `data`.
 */
export function parseCwdMarkers(data: string): string[] {
  const out: string[] = [];
  for (const m of data.matchAll(CWD_MARKER_RE)) out.push(m[1]);
  return out;
}

/**
 * Remove OSC 9;9 CWD markers from `data` so they are not forwarded to the
 * terminal renderer.
 */
export function stripCwdMarkers(data: string): string {
  return data.replaceAll(CWD_MARKER_RE, "");
}

/**
 * Streaming CWD-marker parser that buffers partial markers across PTY data
 * chunks. PTY output arrives in arbitrary-sized chunks — there is no guarantee
 * that a complete `ESC ] 9 ; 9 ; <cwd> BEL` marker lands in a single chunk.
 * Without buffering, a partial marker at a chunk boundary leaks a raw ESC byte
 * to xterm.js, which interprets it as a control sequence, consuming real output
 * and corrupting the cursor position.
 *
 * One instance per terminal session. Every `data` chunk from the PTY must be
 * pushed through this before being forwarded to the client.
 */
export class CwdMarkerStream {
  private pending = "";
  private readonly maxPendingBytes = 4096;

  /**
   * Feed a raw PTY data chunk. Returns `{ clean, cwds }` where `clean` is
   * safe to forward to xterm (markers stripped, no partial escapes leaked) and
   * `cwds` is any complete CWD values found in this chunk.
   */
  push(chunk: string): { clean: string; cwds: string[] } {
    const data = this.pending + chunk;
    this.pending = "";

    let clean = "";
    const cwds: string[] = [];
    let cursor = 0;

    while (cursor < data.length) {
      const markerStart = data.indexOf(CWD_MARKER_PREFIX, cursor);

      if (markerStart === -1) {
        // Keep a suffix that could be the beginning of a marker. PTY chunks
        // can split after any byte, including in the ESC ] 9 ; 9 ; prefix.
        const remaining = data.slice(cursor);
        let partialLength = 0;
        for (let length = 1; length < CWD_MARKER_PREFIX.length; length += 1) {
          if (
            remaining.endsWith(CWD_MARKER_PREFIX.slice(0, length)) &&
            length > partialLength
          ) {
            partialLength = length;
          }
        }

        if (partialLength > 0) {
          clean += remaining.slice(0, -partialLength);
          this.pending = remaining.slice(-partialLength);
        } else {
          clean += remaining;
        }
        break;
      }

      clean += data.slice(cursor, markerStart);
      const valueStart = markerStart + CWD_MARKER_PREFIX.length;
      const markerEnd = data.indexOf(CWD_MARKER_SUFFIX, valueStart);

      if (markerEnd === -1) {
        // A complete prefix with no terminator yet belongs to the marker and
        // must stay buffered; forwarding its ESC byte corrupts xterm state.
        this.pending = data.slice(markerStart);
        break;
      }

      cwds.push(data.slice(valueStart, markerEnd));
      cursor = markerEnd + CWD_MARKER_SUFFIX.length;
    }

    // Safety cap: if a stray marker never terminates, flush it rather than
    // eating all subsequent real output.
    if (this.pending.length > this.maxPendingBytes) {
      clean += this.pending;
      this.pending = "";
    }

    return { clean, cwds };
  }
}

const maxHistoryLines = 100;
/** Delay before injecting the prompt hook so the shell has initialized. */
const HOOK_INJECT_DELAY_MS = 200;

export class TerminalManager {
  private sessions: Map<string, TerminalSession> = new Map();
  private cwdPollers: Map<string, ReturnType<typeof setInterval>> = new Map();

  /**
   * Detect the appropriate shell for the current platform.
   *
   * On Windows we write a small .ps1 hook script to the temp dir and pass
   * `-NoExit -Command ". 'hook.ps1'"` so the prompt function is loaded
   * silently at startup — nothing is echoed in the terminal.
   */
  getShell(terminalId?: string): { command: string; args: string[] } {
    if (os.platform() === "win32") {
      // Write a per-terminal prompt-hook script so each terminal tracks its
      // own CWD independently.  The file names include the terminal id so
      // multiple concurrent terminals don't collide.
      const safeId = (terminalId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
      const cwdFile = path.join(os.tmpdir(), `.devos_cwd_${safeId}`).replace(/\\/g, "\\\\");
      const hookScript = path.join(os.tmpdir(), `.devos_prompt_hook_${safeId}.ps1`);
      const psContent = [
        "# Auto-generated by DevOS — do not edit",
        "function prompt {",
        "  [IO.File]::WriteAllText('" + cwdFile + "', $PWD.Path)",
        '  return "PS $($PWD.Path)> "',
        "}",
      ].join("\n");
      fs.writeFileSync(hookScript, psContent, "utf8");

      // -NoExit keeps the session open; -Command runs the dot-source before
      // the user sees any output, so nothing is echoed in the terminal.
      return {
        command: "powershell.exe",
        args: [
          "-NoLogo",
          "-NoExit",
          "-Command",
          `. '${hookScript.replace(/\\/g, "\\\\")}'; Remove-Item '${hookScript.replace(/\\/g, "\\\\")}'`,
        ],
      };
    }

    // Linux/macOS: try zsh, fallback to bash
    const zshPath = "/bin/zsh";
    try {
      if (require("fs").existsSync(zshPath)) {
        return { command: zshPath, args: [] };
      }
    } catch {
      // If require fails, try import
    }

    return { command: "/bin/bash", args: [] };
  }

  /**
   * Shell commands to inject after spawn so the prompt emits CWD markers.
   * Each hook writes a zero-width OSC 9;9 escape (ESC ] 9 ; 9 ; <cwd> BEL)
   * before each prompt, so it does not shift the cursor or corrupt input.
   */
  getPromptHookCommand(): string {
    const { command } = this.getShell();

    if (command === "powershell.exe") {
      // PowerShell hook is loaded at startup via -NoExit -Command; nothing to inject.
      return "";
    }

    if (command === "/bin/zsh") {
      // zsh does not honor PROMPT_COMMAND; use precmd_functions instead.
      return 'precmd() { printf "\x1b]9;9;%s\x07" "$PWD"; }\n';
    }

    // bash: PROMPT_COMMAND runs before each prompt.
    return 'PROMPT_COMMAND=\'printf "\x1b]9;9;%s\x07" "$PWD"\'\n';
  }

  /**
   * Create a new terminal session.
   */
  create(id: string, cwd: string, cols: number = 80, rows: number = 24): void {
    // Close existing session with same ID if any
    if (this.sessions.has(id)) {
      this.close(id);
    }

    const { command, args } = this.getShell(id);

    const term = pty.spawn(command, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: cwd || os.homedir(),
      env: process.env as Record<string, string>,
    });

    this.sessions.set(id, {
      id,
      pty: term,
      cwd: cwd || os.homedir(),
      outputHistory: [],
      historyIndex: 0,
    });

    // Inject prompt hook after a short delay to let the shell initialize.
    // Guard against the session having been closed in the meantime.
    setTimeout(() => {
      if (!this.sessions.has(id)) return;
      term.write(this.getPromptHookCommand());
    }, HOOK_INJECT_DELAY_MS);
  }

  /**
   * Write data to a terminal session's stdin.
   */
  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.write(data);
    }
  }

  /**
   * Resize a terminal session.
   */
  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.resize(cols, rows);
    }
  }

  /**
   * Close a terminal session.
   */
  close(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.kill();
      this.sessions.delete(id);
    }
  }

  /**
   * Close all terminal sessions.
   */
  closeAll(): void {
    for (const [id] of this.sessions) {
      this.close(id);
    }
  }

  /**
   * Get a terminal session by ID.
   */
  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Check if a session exists.
   */
  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /**
   * Get all active session IDs.
   */
  getIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Record output data in the session's history buffer.
   * Keeps the last ~100 lines; older lines are overwritten (ring buffer).
   */
  recordOutput(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    // Split on newlines but preserve the data for xterm-style line tracking.
    // For simplicity, treat each chunk as a line. In a real impl, could parse ESC codes.
    if (!session.outputHistory) {
      session.outputHistory = [];
      session.historyIndex = 0;
    }

    if (session.outputHistory.length < maxHistoryLines) {
      session.outputHistory.push(data);
    } else {
      session.outputHistory[session.historyIndex] = data;
      session.historyIndex = (session.historyIndex + 1) % maxHistoryLines;
    }
  }

  /**
   * Get the full history for a session in chronological order.
   */
  getHistory(id: string): string[] {
    const session = this.sessions.get(id);
    if (!session || !session.outputHistory || session.outputHistory.length === 0) {
      return [];
    }

    // If buffer is not yet full, return as-is (in insertion order)
    if (session.outputHistory.length < maxHistoryLines) {
      return session.outputHistory.slice();
    }

    // Buffer is full; return in ring order (oldest first)
    const idx = session.historyIndex;
    return [
      ...session.outputHistory.slice(idx),
      ...session.outputHistory.slice(0, idx),
    ];
  }

  /**
   * Start polling a temp file for CWD changes (PowerShell only).
   * The prompt function writes the current directory to this file on each
   * prompt render; this poller detects changes and fires `onCwdChange`.
   */
  startCwdPolling(
    terminalId: string,
    onCwdChange: (cwd: string) => void
  ): void {
    this.stopCwdPolling(terminalId);

    const safeId = terminalId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const cwdFile = path.join(os.tmpdir(), `.devos_cwd_${safeId}`);
    let lastCwd = "";

    const poller = setInterval(() => {
      fs.readFile(cwdFile, "utf-8", (err, data) => {
        if (err) return;
        const cwd = data.trim();
        if (cwd && cwd !== lastCwd) {
          lastCwd = cwd;
          onCwdChange(cwd);
        }
      });
    }, 300);

    this.cwdPollers.set(terminalId, poller);
  }

  stopCwdPolling(terminalId: string): void {
    const poller = this.cwdPollers.get(terminalId);
    if (poller) {
      clearInterval(poller);
      this.cwdPollers.delete(terminalId);
    }
  }
}

// Singleton instance
export const terminalManager = new TerminalManager();
