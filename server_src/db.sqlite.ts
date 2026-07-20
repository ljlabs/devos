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
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_messages_threadId_type ON messages(threadId, type)");

    // Expression index for chunk accumulation lookups
    // getMessageByThreadAndMessageId uses json_extract(raw,'$.params.update.messageId')
    // to find streaming chunks by messageId. Without this index it's O(n) per thread.
    // SQLite supports expression indexes directly — no generated column needed.
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_messages_threadId_messageId ON messages(threadId, json_extract(raw, \'$.params.update.messageId\'))'
    );
  }

  // =========================================================================
  // Targeted query methods — use these instead of readDb/writeDb/updateDb
  // =========================================================================

  runInTransaction<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  // --- Workspaces ---

  getWorkspaceById(id: string): Workspace | undefined {
    const row = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as Workspace | undefined;
    return row;
  }

  insertWorkspace(ws: Workspace): Workspace {
    this.db.prepare("INSERT INTO workspaces (id, name, path) VALUES (?, ?, ?)").run(ws.id, ws.name, ws.path);
    return ws;
  }

  updateWorkspaceName(id: string, name: string): Workspace | undefined {
    this.db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(name, id);
    return this.getWorkspaceById(id);
  }

  getAllWorkspaces(): Workspace[] {
    return this.db.prepare("SELECT * FROM workspaces").all() as Workspace[];
  }

  // --- Threads ---

  getThreadById(id: string): Thread | undefined {
    const row = this.db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return this.parseThreadRow(row);
  }

  getThreadsByWorkspace(workspaceId: string): Thread[] {
    const rows = this.db.prepare("SELECT * FROM threads WHERE workspaceId = ?").all(workspaceId) as any[];
    return rows.map((row) => this.parseThreadRow(row));
  }

  insertThread(thread: Thread): Thread {
    this.db.prepare(
      "INSERT INTO threads (id, workspaceId, title, sessionId, status, pendingPermissionId, pendingPermissionOptions, lastError) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      thread.id,
      thread.workspaceId,
      thread.title,
      thread.sessionId || null,
      thread.status,
      thread.pendingPermissionId != null ? thread.pendingPermissionId : null,
      thread.pendingPermissionOptions ? JSON.stringify(thread.pendingPermissionOptions) : null,
      thread.lastError || null
    );
    return thread;
  }

  updateThread(id: string, fields: Partial<Thread>): Thread | undefined {
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (key === "id" || key === "workspaceId") continue; // never update these
      setClauses.push(`${key} = ?`);
      if (key === "pendingPermissionOptions") {
        values.push(value ? JSON.stringify(value) : null);
      } else {
        values.push(value === undefined ? null : value);
      }
    }

    if (setClauses.length === 0) return this.getThreadById(id);

    values.push(id);
    this.db.prepare(`UPDATE threads SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
    return this.getThreadById(id);
  }

  updateThreadStatus(id: string, status: Thread["status"]): Thread | undefined {
    this.db.prepare("UPDATE threads SET status = ? WHERE id = ?").run(status, id);
    return this.getThreadById(id);
  }

  // --- Messages ---

  getMessagesByThread(threadId: string): Message[] {
    const rows = this.db.prepare("SELECT * FROM messages WHERE threadId = ? ORDER BY timestamp ASC").all(threadId) as any[];
    return rows.map((row) => ({
      id: row.id,
      threadId: row.threadId,
      timestamp: row.timestamp,
      raw: JSON.parse(row.raw),
      type: row.type || undefined,
    })) as Message[];
  }

  insertMessage(msg: Message): void {
    this.db.prepare("INSERT INTO messages (id, threadId, timestamp, raw, type) VALUES (?, ?, ?, ?, ?)").run(
      msg.id,
      msg.threadId,
      msg.timestamp,
      JSON.stringify(msg.raw),
      msg.type || null
    );
  }

  getMessageByThreadAndMessageId(threadId: string, messageId: string): Message | undefined {
    const row = this.db.prepare(
      "SELECT * FROM messages WHERE threadId = ? AND json_extract(raw, '$.params.update.messageId') = ? ORDER BY timestamp DESC LIMIT 1"
    ).get(threadId, messageId) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      threadId: row.threadId,
      timestamp: row.timestamp,
      raw: JSON.parse(row.raw),
      type: row.type || undefined,
    };
  }

  updateMessageRaw(id: string, raw: any): void {
    this.db.prepare("UPDATE messages SET raw = ? WHERE id = ?").run(JSON.stringify(raw), id);
  }

  // --- AllowedPatterns ---

  getAllowedPatterns(): AllowSimilarPattern[] {
    const rows = this.db.prepare("SELECT * FROM allowedPatterns").all() as any[];
    return rows.map((row) => ({
      variant: row.variant,
      pattern: row.pattern,
      toolName: row.toolName || undefined,
      createdAt: row.createdAt,
    })) as AllowSimilarPattern[];
  }

  insertAllowedPattern(ap: AllowSimilarPattern): AllowSimilarPattern {
    const id = `ap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.db.prepare(
      "INSERT INTO allowedPatterns (id, variant, pattern, toolName, createdAt) VALUES (?, ?, ?, ?, ?)"
    ).run(id, ap.variant, ap.pattern, ap.toolName || null, ap.createdAt);
    return ap;
  }

  deleteAllowedPattern(pattern: string, toolName?: string): boolean {
    let sql = "DELETE FROM allowedPatterns WHERE pattern = ?";
    const params: any[] = [pattern];
    if (toolName !== undefined) {
      sql += " AND toolName = ?";
      params.push(toolName);
    } else {
      sql += " AND toolName IS NULL";
    }
    const result = this.db.prepare(sql).run(...params);
    return result.changes > 0;
  }

  /** Delete every tool-scoped row with this pattern (used by settings UI). */
  deleteAllowedPatternAnyTool(pattern: string): boolean {
    const result = this.db.prepare("DELETE FROM allowedPatterns WHERE pattern = ?").run(pattern);
    return result.changes > 0;
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private parseThreadRow(row: any): Thread {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      title: row.title,
      sessionId: row.sessionId || undefined,
      status: row.status,
      pendingPermissionId: row.pendingPermissionId != null ? row.pendingPermissionId : undefined,
      pendingPermissionOptions: row.pendingPermissionOptions ? JSON.parse(row.pendingPermissionOptions) : undefined,
      lastError: row.lastError || undefined,
    };
  }

  /**
   * Read all data. DEPRECATED: use targeted query methods instead.
   * Kept for backward compatibility with workspace seeding and tests.
   */
  readDb(): DatabaseSchema {
    try {
      const workspaces = this.db.prepare("SELECT * FROM workspaces").all() as Workspace[];
      
      const threadsRaw = this.db.prepare("SELECT * FROM threads").all() as any[];
      const threads = threadsRaw.map((row) => ({
        ...row,
        sessionId: row.sessionId || undefined,
        pendingPermissionId: row.pendingPermissionId != null ? row.pendingPermissionId : undefined,
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
            t.pendingPermissionId != null ? t.pendingPermissionId : null,
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
   * Update with a callback function. DEPRECATED: use targeted insert/update methods instead.
   * Kept for backward compatibility.
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
   * Get paginated messages for a thread (newest first)
   */
  getMessages(threadId: string, offset: number, limit: number): Message[] {
    try {
      const rows = this.db.prepare(
        "SELECT * FROM messages WHERE threadId = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?"
      ).all(threadId, limit, offset) as any[];
      return rows.map((row) => ({
        ...row,
        raw: JSON.parse(row.raw),
      })) as Message[];
    } catch (err: any) {
      console.error("[db] getMessages failed:", err.message);
      return [];
    }
  }

  /**
   * Get total message count for a thread
   */
  getMessageCount(threadId: string): number {
    try {
      const row = this.db.prepare("SELECT COUNT(*) as count FROM messages WHERE threadId = ?").get(threadId) as { count: number };
      return row?.count ?? 0;
    } catch (err: any) {
      console.error("[db] getMessageCount failed:", err.message);
      return 0;
    }
  }

  /**
   * Cursor-based pagination: fetch messages before a cursor (older messages).
   * If cursorId is null, fetches the latest messages.
   * Returns messages in reverse chronological order (newest first).
   */
  getMessagesBefore(threadId: string, cursorId: string | null, limit: number): Message[] {
    try {
      let rows: any[];

      if (cursorId === null) {
        // No cursor: get the latest `limit` messages
        rows = this.db.prepare(
          "SELECT * FROM messages WHERE threadId = ? ORDER BY timestamp DESC LIMIT ?"
        ).all(threadId, limit) as any[];
      } else {
        // With cursor: get messages older than the cursor
        const cursorRow = this.db.prepare(
          "SELECT timestamp FROM messages WHERE id = ? AND threadId = ?"
        ).get(cursorId, threadId) as any;

        if (!cursorRow) return [];

        rows = this.db.prepare(
          "SELECT * FROM messages WHERE threadId = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?"
        ).all(threadId, cursorRow.timestamp, limit) as any[];
      }

      return rows.map((row) => ({
        ...row,
        raw: JSON.parse(row.raw),
      })) as Message[];
    } catch (err: any) {
      console.error("[db] getMessagesBefore failed:", err.message);
      return [];
    }
  }

  /**
   * Check if there are older messages before a given cursor.
   */
  hasMessagesBefore(threadId: string, cursorId: string): boolean {
    try {
      const cursorRow = this.db.prepare(
        "SELECT timestamp FROM messages WHERE id = ? AND threadId = ?"
      ).get(cursorId, threadId) as any;

      if (!cursorRow) return false;

      const row = this.db.prepare(
        "SELECT COUNT(*) as count FROM messages WHERE threadId = ? AND timestamp < ?"
      ).get(threadId, cursorRow.timestamp) as { count: number };

      return (row?.count ?? 0) > 0;
    } catch (err: any) {
      console.error("[db] hasMessagesBefore failed:", err.message);
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
