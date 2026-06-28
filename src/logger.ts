/**
 * logger.ts
 *
 * Dual-output logger: writes to both terminal (console) and a SQLite database.
 * The SQLite logs can be queried via the API for the Thread Log and Global Activity panels.
 */

import Database from "better-sqlite3";
import path from "path";

const LOG_DB_PATH = path.join(process.cwd(), "logs.db");

let db: Database.Database;
let testDb: Database.Database | null = null;

function getDb(): Database.Database {
  // For testing: allow overriding the database
  if (testDb) {
    return testDb;
  }

  if (!db) {
    db = new Database(LOG_DB_PATH);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        thread_id TEXT,
        level TEXT NOT NULL DEFAULT 'info',
        component TEXT NOT NULL DEFAULT 'server',
        message TEXT NOT NULL
      )
    `);
  }
  return db;
}

/**
 * For testing: override the database instance
 * @internal
 */
export function __setTestDb(database: Database.Database | null): void {
  testDb = database;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  thread_id: string | null;
  level: string;
  component: string;
  message: string;
}

function insertLog(threadId: string | null, level: string, component: string, message: string): void {
  try {
    const d = getDb();
    d.prepare("INSERT INTO logs (thread_id, level, component, message) VALUES (?, ?, ?, ?)")
      .run(threadId, level, component, message);
  } catch {
    // Don't let logging errors crash the app
  }
}

export function logInfo(component: string, message: string, threadId?: string): void {
  const tag = threadId ? `[${component}:${threadId}]` : `[${component}]`;
  console.log(`${tag} ${message}`);
  insertLog(threadId ?? null, "info", component, message);
}

export function logError(component: string, message: string, threadId?: string): void {
  const tag = threadId ? `[${component}:${threadId}]` : `[${component}]`;
  console.error(`${tag} ${message}`);
  insertLog(threadId ?? null, "error", component, message);
}

export function logWarn(component: string, message: string, threadId?: string): void {
  const tag = threadId ? `[${component}:${threadId}]` : `[${component}]`;
  console.warn(`${tag} ${message}`);
  insertLog(threadId ?? null, "warn", component, message);
}

/**
 * Get logs from SQLite, optionally filtered by threadId.
 * Used by the Thread Log and Global Activity SSE endpoints.
 */
export function getLogs(options?: { threadId?: string; limit?: number }): LogEntry[] {
  const d = getDb();
  const limit = options?.limit ?? 200;

  if (options?.threadId) {
    return d.prepare(
      "SELECT * FROM logs WHERE thread_id = ? ORDER BY id DESC LIMIT ?"
    ).all(options.threadId, limit) as LogEntry[];
  }

  return d.prepare(
    "SELECT * FROM logs ORDER BY id DESC LIMIT ?"
  ).all(limit) as LogEntry[];
}

/**
 * Get the latest log id — used for SSE to only send new logs.
 */
export function getLatestLogId(): number {
  const d = getDb();
  const row = d.prepare("SELECT MAX(id) as maxId FROM logs").get() as { maxId: number | null };
  return row.maxId ?? 0;
}
