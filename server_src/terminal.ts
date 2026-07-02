/**
 * terminal.ts
 *
 * Platform-aware PTY terminal manager using node-pty.
 *
 * - Windows: PowerShell
 * - Linux/macOS: Try zsh first, fallback to bash
 */

import os from "os";
import pty from "node-pty";

export interface TerminalSession {
  id: string;
  pty: pty.IPty;
  cwd: string;
}

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
}

// Singleton instance
export const terminalManager = new TerminalManager();
