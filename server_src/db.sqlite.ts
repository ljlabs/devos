/**
 * db.sqlite.ts
 *
 * SQLite-based persistence layer for DevOS using better-sqlite3.
 *
 * Schema:
 *   - workspaces: id, name, path
 *   - threads: id, workspaceId (FK), title, sessionId, status, pendingPermissionId, pendingPermissionOptions, lastError
 *   - messages: id, threadId (FK), timestamp, raw (JSON), type
 *   - allowedPatterns: id, variant, pattern, toolName, createdAt
 *
 * Cascade delete enforced via PRAGMA foreign_keys = ON.
 */

import Database from "better-sqlite3";
import { DatabaseSchema, Workspace, Thread, Message, AllowSimilarPattern } from "../src/types";

export class SqliteDb {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initializeSchema();
  }

  private initializeSchema(): void {
    // Workspaces table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL
      )
    `);

    // Threads table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        title TEXT NOT NULL,
        sessionId TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        pendingPermissionId INTEGER,
        pendingPermissionOptions TEXT,
        lastError TEXT,
        FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE
      )
    `);

    // Messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        threadId TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        raw TEXT NOT NULL,
        type TEXT,
        FOREIGN KEY (threadId) REFERENCES threads(id) ON DELETE CASCADE
      )
    `);

    // Allowed patterns table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS allowedPatterns (
        id TEXT PRIMARY KEY,
        variant TEXT NOT NULL,
        pattern TEXT NOT NULL,
        toolName TEXT,
        createdAt TEXT NOT NULL
      )
    `);

    // Create indexes for common queries
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_threads_workspaceId ON threads(workspaceId)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_messages_threadId ON messages(threadId)");
  }

  /**
   * Read all data (for compatibility with existing code)
   */
  readDb(): DatabaseSchema {
    try {
      const workspaces = this.db.prepare("SELECT * FROM workspaces").all() as Workspace[];
      
      const threadsRaw = this.db.prepare("SELECT * FROM threads").all() as any[];
      const threads = threadsRaw.map((row) => ({
        ...row,
        sessionId: row.sessionId || undefined,
        pendingPermissionId: row.pendingPermissionId || undefined,
        pendingPermissionOptions: row.pendingPermissionOptions ? JSON.parse(row.pendingPermissionOptions) : undefined,
        lastError: row.lastError || undefined,
      })) as Thread[];

      const messagesRaw = this.db.prepare("SELECT * FROM messages").all() as any[];
      const messages = messagesRaw.map((row) => ({
        ...row,
        raw: JSON.parse(row.raw),
      })) as Message[];

      const allowedPatternsRaw = this.db.prepare("SELECT * FROM allowedPatterns").all() as any[];
      const allowedPatterns = allowedPatternsRaw.map((row) => ({
        variant: row.variant,
        pattern: row.pattern,
        toolName: row.toolName || undefined,  // Convert null to undefined
        createdAt: row.createdAt,
      })) as AllowSimilarPattern[];

      return {
        workspaces,
        threads,
        messages,
        allowedPatterns,
      };
    } catch (err: any) {
      console.error("[db] readDb failed:", err.message);
      throw err;
    }
  }

  /**
   * Write all data atomically
   */
  writeDb(data: DatabaseSchema): boolean {
    try {
      const transaction = this.db.transaction(() => {
        // Clear and re-insert workspaces
        this.db.prepare("DELETE FROM workspaces").run();
        const wsStmt = this.db.prepare("INSERT INTO workspaces (id, name, path) VALUES (?, ?, ?)");
        data.workspaces.forEach((ws) => {
          wsStmt.run(ws.id, ws.name, ws.path);
        });

        // Clear and re-insert threads
        this.db.prepare("DELETE FROM threads").run();
        const threadStmt = this.db.prepare(
          "INSERT INTO threads (id, workspaceId, title, sessionId, status, pendingPermissionId, pendingPermissionOptions, lastError) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        data.threads.forEach((t) => {
          threadStmt.run(
            t.id,
            t.workspaceId,
            t.title,
            t.sessionId || null,
            t.status,
            t.pendingPermissionId || null,
            t.pendingPermissionOptions ? JSON.stringify(t.pendingPermissionOptions) : null,
            t.lastError || null
          );
        });

        // Clear and re-insert messages
        this.db.prepare("DELETE FROM messages").run();
        const msgStmt = this.db.prepare("INSERT INTO messages (id, threadId, timestamp, raw, type) VALUES (?, ?, ?, ?, ?)");
        data.messages.forEach((m) => {
          msgStmt.run(m.id, m.threadId, m.timestamp, JSON.stringify(m.raw), m.type);
        });

        // Clear and re-insert allowed patterns
        this.db.prepare("DELETE FROM allowedPatterns").run();
        const apStmt = this.db.prepare(
          "INSERT INTO allowedPatterns (id, variant, pattern, toolName, createdAt) VALUES (?, ?, ?, ?, ?)"
        );
        (data.allowedPatterns || []).forEach((ap, idx) => {
          // Generate a unique ID if not provided
          const id = `ap-${Date.now()}-${idx}`;
          apStmt.run(id, ap.variant, ap.pattern, ap.toolName || null, ap.createdAt);
        });
      });

      transaction();
      return true;
    } catch (err: any) {
      console.error("[db] writeDb failed:", err.message);
      return false;
    }
  }

  /**
   * Update with a callback function (synchronous-style for compatibility)
   */
  updateDb(fn: (db: DatabaseSchema) => void): void {
    const db = this.readDb();
    fn(db);
    this.writeDb(db);
  }

  /**
   * Delete workspace and cascade to threads and messages
   */
  deleteWorkspace(workspaceId: string): boolean {
    try {
      const stmt = this.db.prepare("DELETE FROM workspaces WHERE id = ?");
      const result = stmt.run(workspaceId);
      return result.changes > 0;
    } catch (err: any) {
      console.error("[db] deleteWorkspace failed:", err.message);
      return false;
    }
  }

  /**
   * Delete thread and cascade to messages
   */
  deleteThread(threadId: string): boolean {
    try {
      const stmt = this.db.prepare("DELETE FROM threads WHERE id = ?");
      const result = stmt.run(threadId);
      return result.changes > 0;
    } catch (err: any) {
      console.error("[db] deleteThread failed:", err.message);
      return false;
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
