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

import os from "os";
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

const maxHistoryLines = 100;

export class TerminalManager {
  private sessions: Map<string, TerminalSession> = new Map();

  /**
   * Detect the appropriate shell for the current platform.
   */
  getShell(): { command: string; args: string[] } {
    if (os.platform() === "win32") {
      return { command: "powershell.exe", args: ["-NoLogo"] };
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
   * Create a new terminal session.
   */
  create(id: string, cwd: string, cols: number = 80, rows: number = 24): void {
    // Close existing session with same ID if any
    if (this.sessions.has(id)) {
      this.close(id);
    }

    const { command, args } = this.getShell();

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
}

// Singleton instance
export const terminalManager = new TerminalManager();
