/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { SqliteDb } from "./db.sqlite";
import { DatabaseSchema, Workspace, Thread, Message, AllowSimilarPattern } from "../src/types";

describe("SqliteDb - SQLite Database Layer", () => {
  let testDbPath: string;
  let db: SqliteDb;

  beforeEach(() => {
    // Create a fresh test database for each test
    testDbPath = path.join(os.tmpdir(), `test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new SqliteDb(testDbPath);
  });

  afterEach(() => {
    // Close the database
    db.close();
    
    // Clean up test files
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + "-shm")) fs.unlinkSync(testDbPath + "-shm");
    if (fs.existsSync(testDbPath + "-wal")) fs.unlinkSync(testDbPath + "-wal");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Basic Write/Read Operations
  // ─────────────────────────────────────────────────────────────────────────

  describe("writeDb / readDb", () => {
    it("writes and reads workspaces correctly", () => {
      const workspace: Workspace = {
        id: "ws-test-1",
        name: "Test Workspace",
        path: "/path/to/workspace",
      };

      const data: DatabaseSchema = {
        workspaces: [workspace],
        threads: [],
        messages: [],
        allowedPatterns: [],
      };

      const written = db.writeDb(data);
      expect(written).toBe(true);

      const read = db.readDb();
      expect(read.workspaces).toHaveLength(1);
      expect(read.workspaces[0]).toEqual(workspace);
    });

    it("writes and reads multiple workspaces", () => {
      const workspaces: Workspace[] = [
        { id: "ws-1", name: "Workspace 1", path: "/path1" },
        { id: "ws-2", name: "Workspace 2", path: "/path2" },
        { id: "ws-3", name: "Workspace 3", path: "/path3" },
      ];

      const data: DatabaseSchema = {
        workspaces,
        threads: [],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(data);
      const read = db.readDb();

      expect(read.workspaces).toHaveLength(3);
      expect(read.workspaces.map((w) => w.id)).toEqual(["ws-1", "ws-2", "ws-3"]);
    });

    it("writes and reads threads with all fields", () => {
      const thread: Thread = {
        id: "thread-1",
        workspaceId: "ws-1",
        title: "Test Thread",
        sessionId: "session-123",
        status: "idle",
        pendingPermissionId: 42,
        pendingPermissionOptions: [
          { kind: "action", name: "allow", optionId: "allow-1" },
        ],
        lastError: undefined,
      };

      const data: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [thread],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(data);
      const read = db.readDb();

      expect(read.threads).toHaveLength(1);
      expect(read.threads[0]).toMatchObject({
        id: "thread-1",
        workspaceId: "ws-1",
        title: "Test Thread",
        sessionId: "session-123",
        status: "idle",
        pendingPermissionId: 42,
      });
      expect(read.threads[0].pendingPermissionOptions).toHaveLength(1);
    });

    it("writes and reads messages with raw ACP data", () => {
      const message: Message = {
        id: "msg-1",
        threadId: "thread-1",
        timestamp: "2024-01-01T12:00:00Z",
        raw: {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-123",
            state: { status: "running" },
          },
        },
        type: "session/update",
      };

      const data: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [
          {
            id: "thread-1",
            workspaceId: "ws-1",
            title: "Thread",
            status: "idle",
          },
        ],
        messages: [message],
        allowedPatterns: [],
      };

      db.writeDb(data);
      const read = db.readDb();

      expect(read.messages).toHaveLength(1);
      expect(read.messages[0]).toMatchObject({
        id: "msg-1",
        threadId: "thread-1",
        timestamp: "2024-01-01T12:00:00Z",
        type: "session/update",
      });
      expect(read.messages[0].raw).toEqual(message.raw);
    });

    it("writes and reads allowedPatterns with optional toolName", () => {
      const patterns: AllowSimilarPattern[] = [
        {
          variant: "exact",
          pattern: "/path/to/file.ts",
          toolName: "Edit",
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          variant: "category",
          pattern: "/path/*",
          createdAt: "2024-01-01T00:00:00Z",
          // No toolName - should be undefined
        },
      ];

      const data: DatabaseSchema = {
        workspaces: [],
        threads: [],
        messages: [],
        allowedPatterns: patterns,
      };

      db.writeDb(data);
      const read = db.readDb();

      expect(read.allowedPatterns).toHaveLength(2);
      expect(read.allowedPatterns[0].toolName).toBe("Edit");
      expect(read.allowedPatterns[1].toolName).toBeUndefined();
    });

    it("handles empty database", () => {
      const emptyData: DatabaseSchema = {
        workspaces: [],
        threads: [],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(emptyData);
      const read = db.readDb();

      expect(read.workspaces).toEqual([]);
      expect(read.threads).toEqual([]);
      expect(read.messages).toEqual([]);
      expect(read.allowedPatterns).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // updateDb Method
  // ─────────────────────────────────────────────────────────────────────────

  describe("updateDb", () => {
    it("reads, modifies, and writes in one call", () => {
      const initialData: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "Original", path: "/path" }],
        threads: [],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(initialData);

      // Update via callback
      db.updateDb((data) => {
        data.workspaces[0].name = "Updated";
        data.workspaces.push({ id: "ws-2", name: "New", path: "/path2" });
      });

      const read = db.readDb();
      expect(read.workspaces).toHaveLength(2);
      expect(read.workspaces[0].name).toBe("Updated");
      expect(read.workspaces[1].name).toBe("New");
    });

    it("adds threads via updateDb", () => {
      const initialData: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(initialData);

      db.updateDb((data) => {
        data.threads.push({
          id: "thread-1",
          workspaceId: "ws-1",
          title: "New Thread",
          status: "idle",
        });
      });

      const read = db.readDb();
      expect(read.threads).toHaveLength(1);
      expect(read.threads[0].title).toBe("New Thread");
    });

    it("adds messages via updateDb", () => {
      const initialData: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [
          {
            id: "thread-1",
            workspaceId: "ws-1",
            title: "Thread",
            status: "idle",
          },
        ],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(initialData);

      db.updateDb((data) => {
        data.messages.push({
          id: "msg-1",
          threadId: "thread-1",
          timestamp: new Date().toISOString(),
          raw: { method: "session/update" },
          type: "session/update",
        });
      });

      const read = db.readDb();
      expect(read.messages).toHaveLength(1);
      expect(read.messages[0].raw.method).toBe("session/update");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Cascade Deletion
  // ─────────────────────────────────────────────────────────────────────────

  describe("deleteWorkspace (cascade)", () => {
    it("deletes workspace when it exists", () => {
      const data: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(data);
      const deleted = db.deleteWorkspace("ws-1");

      expect(deleted).toBe(true);
      const read = db.readDb();
      expect(read.workspaces).toHaveLength(0);
    });

    it("returns false when workspace does not exist", () => {
      const data: DatabaseSchema = {
        workspaces: [],
        threads: [],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(data);
      const deleted = db.deleteWorkspace("ws-nonexistent");

      expect(deleted).toBe(false);
    });

    it("cascades delete to threads", () => {
      const data: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [
          {
            id: "thread-1",
            workspaceId: "ws-1",
            title: "Thread",
            status: "idle",
          },
          {
            id: "thread-2",
            workspaceId: "ws-1",
            title: "Thread 2",
            status: "idle",
          },
        ],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(data);
      db.deleteWorkspace("ws-1");

      const read = db.readDb();
      expect(read.workspaces).toHaveLength(0);
      expect(read.threads).toHaveLength(0);
    });

    it("cascades delete to messages in threads", () => {
      const data: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [
          {
            id: "thread-1",
            workspaceId: "ws-1",
            title: "Thread",
            status: "idle",
          },
        ],
        messages: [
          {
            id: "msg-1",
            threadId: "thread-1",
            timestamp: "2024-01-01T12:00:00Z",
            raw: { method: "test" },
            type: "test",
          },
          {
            id: "msg-2",
            threadId: "thread-1",
            timestamp: "2024-01-01T12:00:01Z",
            raw: { method: "test" },
            type: "test",
          },
        ],
        allowedPatterns: [],
      };

      db.writeDb(data);
      db.deleteWorkspace("ws-1");

      const read = db.readDb();
      expect(read.workspaces).toHaveLength(0);
      expect(read.threads).toHaveLength(0);
      expect(read.messages).toHaveLength(0);
    });

    it("only deletes specified workspace and preserves others", () => {
      const data: DatabaseSchema = {
        workspaces: [
          { id: "ws-1", name: "WS1", path: "/path1" },
          { id: "ws-2", name: "WS2", path: "/path2" },
        ],
        threads: [
          {
            id: "thread-1",
            workspaceId: "ws-1",
            title: "T1",
            status: "idle",
          },
          {
            id: "thread-2",
            workspaceId: "ws-2",
            title: "T2",
            status: "idle",
          },
        ],
        messages: [
          {
            id: "msg-1",
            threadId: "thread-1",
            timestamp: "2024-01-01T12:00:00Z",
            raw: { method: "test" },
          },
          {
            id: "msg-2",
            threadId: "thread-2",
            timestamp: "2024-01-01T12:00:00Z",
            raw: { method: "test" },
          },
        ],
        allowedPatterns: [],
      };

      db.writeDb(data);
      db.deleteWorkspace("ws-1");

      const read = db.readDb();
      expect(read.workspaces).toHaveLength(1);
      expect(read.workspaces[0].id).toBe("ws-2");
      expect(read.threads).toHaveLength(1);
      expect(read.threads[0].id).toBe("thread-2");
      expect(read.messages).toHaveLength(1);
      expect(read.messages[0].id).toBe("msg-2");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Delete Thread
  // ─────────────────────────────────────────────────────────────────────────

  describe("deleteThread (cascade)", () => {
    it("deletes thread when it exists", () => {
      const data: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [
          {
            id: "thread-1",
            workspaceId: "ws-1",
            title: "Thread",
            status: "idle",
          },
        ],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(data);
      const deleted = db.deleteThread("thread-1");

      expect(deleted).toBe(true);
      const read = db.readDb();
      expect(read.threads).toHaveLength(0);
    });

    it("returns false when thread does not exist", () => {
      const data: DatabaseSchema = {
        workspaces: [],
        threads: [],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(data);
      const deleted = db.deleteThread("thread-nonexistent");

      expect(deleted).toBe(false);
    });

    it("cascades delete to messages", () => {
      const data: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [
          {
            id: "thread-1",
            workspaceId: "ws-1",
            title: "Thread",
            status: "idle",
          },
        ],
        messages: [
          {
            id: "msg-1",
            threadId: "thread-1",
            timestamp: "2024-01-01T12:00:00Z",
            raw: { method: "test" },
          },
          {
            id: "msg-2",
            threadId: "thread-1",
            timestamp: "2024-01-01T12:00:01Z",
            raw: { method: "test" },
          },
          {
            id: "msg-3",
            threadId: "thread-1",
            timestamp: "2024-01-01T12:00:02Z",
            raw: { method: "test" },
          },
        ],
        allowedPatterns: [],
      };

      db.writeDb(data);
      db.deleteThread("thread-1");

      const read = db.readDb();
      expect(read.threads).toHaveLength(0);
      expect(read.messages).toHaveLength(0);
    });

    it("only deletes specified thread and preserves others", () => {
      const data: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [
          {
            id: "thread-1",
            workspaceId: "ws-1",
            title: "T1",
            status: "idle",
          },
          {
            id: "thread-2",
            workspaceId: "ws-1",
            title: "T2",
            status: "idle",
          },
        ],
        messages: [
          {
            id: "msg-1",
            threadId: "thread-1",
            timestamp: "2024-01-01T12:00:00Z",
            raw: { method: "test" },
          },
          {
            id: "msg-2",
            threadId: "thread-2",
            timestamp: "2024-01-01T12:00:00Z",
            raw: { method: "test" },
          },
        ],
        allowedPatterns: [],
      };

      db.writeDb(data);
      db.deleteThread("thread-1");

      const read = db.readDb();
      expect(read.threads).toHaveLength(1);
      expect(read.threads[0].id).toBe("thread-2");
      expect(read.messages).toHaveLength(1);
      expect(read.messages[0].id).toBe("msg-2");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Data Type Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe("Type Handling", () => {
    it("handles null and undefined properly", () => {
      const thread: Thread = {
        id: "thread-1",
        workspaceId: "ws-1",
        title: "Thread",
        status: "idle",
        sessionId: undefined,
        pendingPermissionId: undefined,
        pendingPermissionOptions: undefined,
        lastError: undefined,
      };

      const data: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [thread],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(data);
      const read = db.readDb();

      expect(read.threads[0].sessionId).toBeUndefined();
      expect(read.threads[0].pendingPermissionId).toBeUndefined();
      expect(read.threads[0].pendingPermissionOptions).toBeUndefined();
      expect(read.threads[0].lastError).toBeUndefined();
    });

    it("preserves complex JSON in messages", () => {
      const complexRaw = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "sess-123",
          state: {
            status: "awaiting_permission",
            permissions: [
              {
                kind: "action",
                name: "allow",
                details: {
                  command: "npm run test",
                  reason: "User requested",
                },
              },
            ],
          },
        },
      };

      const message: Message = {
        id: "msg-1",
        threadId: "thread-1",
        timestamp: "2024-01-01T12:00:00Z",
        raw: complexRaw,
        type: "session/update",
      };

      const data: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [
          {
            id: "thread-1",
            workspaceId: "ws-1",
            title: "Thread",
            status: "idle",
          },
        ],
        messages: [message],
        allowedPatterns: [],
      };

      db.writeDb(data);
      const read = db.readDb();

      expect(read.messages[0].raw).toEqual(complexRaw);
    });

    it("handles special characters in strings", () => {
      const workspace: Workspace = {
        id: "ws-1",
        name: "Workspace with 'quotes' and \"double quotes\" and \\ backslash",
        path: "/path/with/special/chars/äöü/中文",
      };

      const data: DatabaseSchema = {
        workspaces: [workspace],
        threads: [],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(data);
      const read = db.readDb();

      expect(read.workspaces[0].name).toBe(workspace.name);
      expect(read.workspaces[0].path).toBe(workspace.path);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Transaction & Atomicity
  // ─────────────────────────────────────────────────────────────────────────

  describe("Transactions & Atomicity", () => {
    it("replaces entire dataset atomically", () => {
      const data1: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "Old", path: "/path" }],
        threads: [],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(data1);

      const data2: DatabaseSchema = {
        workspaces: [{ id: "ws-2", name: "New", path: "/path2" }],
        threads: [
          {
            id: "thread-1",
            workspaceId: "ws-2",
            title: "Thread",
            status: "idle",
          },
        ],
        messages: [
          {
            id: "msg-1",
            threadId: "thread-1",
            timestamp: "2024-01-01T12:00:00Z",
            raw: { method: "test" },
          },
        ],
        allowedPatterns: [],
      };

      db.writeDb(data2);

      const read = db.readDb();
      expect(read.workspaces).toHaveLength(1);
      expect(read.workspaces[0].id).toBe("ws-2");
      expect(read.threads).toHaveLength(1);
      expect(read.messages).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Large Data Sets
  // ─────────────────────────────────────────────────────────────────────────

  describe("Large Data Sets", () => {
    it("handles many workspaces", () => {
      const workspaces: Workspace[] = Array.from({ length: 100 }, (_, i) => ({
        id: `ws-${i}`,
        name: `Workspace ${i}`,
        path: `/path/to/ws-${i}`,
      }));

      const data: DatabaseSchema = {
        workspaces,
        threads: [],
        messages: [],
        allowedPatterns: [],
      };

      db.writeDb(data);
      const read = db.readDb();

      expect(read.workspaces).toHaveLength(100);
      expect(read.workspaces[50].name).toBe("Workspace 50");
    });

    it("handles many messages in a thread", () => {
      const messages: Message[] = Array.from({ length: 500 }, (_, i) => ({
        id: `msg-${i}`,
        threadId: "thread-1",
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        raw: { method: "session/update", index: i },
        type: "session/update",
      }));

      const data: DatabaseSchema = {
        workspaces: [{ id: "ws-1", name: "WS", path: "/path" }],
        threads: [
          {
            id: "thread-1",
            workspaceId: "ws-1",
            title: "Thread",
            status: "idle",
          },
        ],
        messages,
        allowedPatterns: [],
      };

      db.writeDb(data);
      const read = db.readDb();

      expect(read.messages).toHaveLength(500);
      expect(read.messages[250].raw.index).toBe(250);
    });
  });
});

// ===========================================================================
// Targeted Query Methods — unit tests for every new method
// ===========================================================================

describe("SqliteDb - Targeted Query Methods", () => {
  let testDbPath: string;
  let db: SqliteDb;

  beforeEach(() => {
    testDbPath = path.join(os.tmpdir(), `test-targeted-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new SqliteDb(testDbPath);
  });

  afterEach(() => {
    db.close();
    for (const ext of ["", "-shm", "-wal"]) {
      if (fs.existsSync(testDbPath + ext)) fs.unlinkSync(testDbPath + ext);
    }
  });

  // Helper: seed a workspace + thread for tests that need FK references
  function seedWorkspaceAndThread(): { ws: Workspace; thread: Thread } {
    const ws: Workspace = { id: "ws-seed", name: "Seed WS", path: "/seed" };
    db.insertWorkspace(ws);
    const thread: Thread = {
      id: "thread-seed",
      workspaceId: "ws-seed",
      title: "Seed Thread",
      status: "idle",
    };
    db.insertThread(thread);
    return { ws, thread };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // runInTransaction
  // ─────────────────────────────────────────────────────────────────────────

  describe("runInTransaction", () => {
    it("commits all operations when callback succeeds", () => {
      db.runInTransaction(() => {
        db.insertWorkspace({ id: "ws-t1", name: "T1", path: "/t1" });
        db.insertWorkspace({ id: "ws-t2", name: "T2", path: "/t2" });
      });
      expect(db.getWorkspaceById("ws-t1")).toBeDefined();
      expect(db.getWorkspaceById("ws-t2")).toBeDefined();
    });

    it("rolls back all operations when callback throws", () => {
      expect(() => {
        db.runInTransaction(() => {
          db.insertWorkspace({ id: "ws-t1", name: "T1", path: "/t1" });
          throw new Error("simulated failure");
        });
      }).toThrow("simulated failure");
      expect(db.getWorkspaceById("ws-t1")).toBeUndefined();
    });

    it("returns the value from the callback", () => {
      const result = db.runInTransaction(() => {
        return 42;
      });
      expect(result).toBe(42);
    });

    it("supports nested transaction-style operations", () => {
      const { ws } = seedWorkspaceAndThread();
      db.runInTransaction(() => {
        db.insertMessage({
          id: "msg-atomic-1",
          threadId: "thread-seed",
          timestamp: "2024-01-01T00:00:00.000Z",
          raw: { text: "hello" },
          type: "user_message",
        });
        db.updateThread("thread-seed", { status: "thinking" });
      });
      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs).toHaveLength(1);
      const thread = db.getThreadById("thread-seed");
      expect(thread?.status).toBe("thinking");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Workspaces
  // ─────────────────────────────────────────────────────────────────────────

  describe("getWorkspaceById", () => {
    it("returns a workspace by id", () => {
      const ws: Workspace = { id: "ws-1", name: "Test", path: "/test" };
      db.insertWorkspace(ws);
      const found = db.getWorkspaceById("ws-1");
      expect(found).toEqual(ws);
    });

    it("returns undefined for non-existent id", () => {
      expect(db.getWorkspaceById("ws-nonexistent")).toBeUndefined();
    });
  });

  describe("insertWorkspace", () => {
    it("inserts and retrieves a workspace", () => {
      const ws: Workspace = { id: "ws-ins", name: "Inserted", path: "/ins" };
      const returned = db.insertWorkspace(ws);
      expect(returned).toEqual(ws);
      expect(db.getWorkspaceById("ws-ins")).toEqual(ws);
    });

    it("throws on duplicate id", () => {
      db.insertWorkspace({ id: "ws-dup", name: "First", path: "/a" });
      expect(() => {
        db.insertWorkspace({ id: "ws-dup", name: "Second", path: "/b" });
      }).toThrow();
    });

    it("inserts multiple workspaces", () => {
      db.insertWorkspace({ id: "ws-a", name: "A", path: "/a" });
      db.insertWorkspace({ id: "ws-b", name: "B", path: "/b" });
      const all = db.readDb().workspaces;
      expect(all).toHaveLength(2);
      expect(all.map((w) => w.id).sort()).toEqual(["ws-a", "ws-b"]);
    });
  });

  describe("updateWorkspaceName", () => {
    it("updates the name and returns the workspace", () => {
      db.insertWorkspace({ id: "ws-upd", name: "Old", path: "/upd" });
      const updated = db.updateWorkspaceName("ws-upd", "New");
      expect(updated?.name).toBe("New");
      expect(updated?.path).toBe("/upd");
    });

    it("returns undefined for non-existent workspace", () => {
      expect(db.updateWorkspaceName("ws-ghost", "X")).toBeUndefined();
    });

    it("does not change path or id", () => {
      db.insertWorkspace({ id: "ws-fix", name: "Fix", path: "/fix" });
      const updated = db.updateWorkspaceName("ws-fix", "Fixed");
      expect(updated?.id).toBe("ws-fix");
      expect(updated?.path).toBe("/fix");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Threads
  // ─────────────────────────────────────────────────────────────────────────

  describe("getThreadById", () => {
    it("returns a fully-populated thread", () => {
      const thread: Thread = {
        id: "t-full",
        workspaceId: "ws-seed",
        title: "Full Thread",
        sessionId: "sess-123",
        status: "thinking",
        pendingPermissionId: 42,
        pendingPermissionOptions: [{ kind: "action", name: "Allow", optionId: "allow-1" }],
        lastError: "some error",
      };
      db.insertWorkspace({ id: "ws-seed", name: "S", path: "/s" });
      db.insertThread(thread);

      const found = db.getThreadById("t-full");
      expect(found).toBeDefined();
      expect(found?.id).toBe("t-full");
      expect(found?.sessionId).toBe("sess-123");
      expect(found?.status).toBe("thinking");
      expect(found?.pendingPermissionId).toBe(42);
      expect(found?.pendingPermissionOptions).toEqual([{ kind: "action", name: "Allow", optionId: "allow-1" }]);
      expect(found?.lastError).toBe("some error");
    });

    it("returns undefined for non-existent thread", () => {
      expect(db.getThreadById("t-nonexistent")).toBeUndefined();
    });

    it("returns minimal thread with optional fields as undefined", () => {
      db.insertWorkspace({ id: "ws-seed", name: "S", path: "/s" });
      db.insertThread({
        id: "t-min",
        workspaceId: "ws-seed",
        title: "Minimal",
        status: "idle",
      });
      const found = db.getThreadById("t-min");
      expect(found?.sessionId).toBeUndefined();
      expect(found?.pendingPermissionId).toBeUndefined();
      expect(found?.pendingPermissionOptions).toBeUndefined();
      expect(found?.lastError).toBeUndefined();
    });

    it("handles empty array for pendingPermissionOptions", () => {
      db.insertWorkspace({ id: "ws-seed", name: "S", path: "/s" });
      db.insertThread({
        id: "t-empty-opts",
        workspaceId: "ws-seed",
        title: "Empty Opts",
        status: "idle",
        pendingPermissionOptions: [],
      });
      const found = db.getThreadById("t-empty-opts");
      expect(found?.pendingPermissionOptions).toEqual([]);
    });
  });

  describe("getThreadsByWorkspace", () => {
    beforeEach(() => {
      db.insertWorkspace({ id: "ws-a", name: "A", path: "/a" });
      db.insertWorkspace({ id: "ws-b", name: "B", path: "/b" });
      db.insertThread({ id: "t-a1", workspaceId: "ws-a", title: "A1", status: "idle" });
      db.insertThread({ id: "t-a2", workspaceId: "ws-a", title: "A2", status: "thinking" });
      db.insertThread({ id: "t-b1", workspaceId: "ws-b", title: "B1", status: "idle" });
    });

    it("returns only threads for the specified workspace", () => {
      const threads = db.getThreadsByWorkspace("ws-a");
      expect(threads).toHaveLength(2);
      expect(threads.map((t) => t.id).sort()).toEqual(["t-a1", "t-a2"]);
    });

    it("returns empty array for workspace with no threads", () => {
      expect(db.getThreadsByWorkspace("ws-empty")).toEqual([]);
    });

    it("returns all threads for workspace B", () => {
      const threads = db.getThreadsByWorkspace("ws-b");
      expect(threads).toHaveLength(1);
      expect(threads[0].id).toBe("t-b1");
    });
  });

  describe("insertThread", () => {
    it("inserts a thread with all fields", () => {
      db.insertWorkspace({ id: "ws-ins", name: "I", path: "/i" });
      const thread: Thread = {
        id: "t-ins",
        workspaceId: "ws-ins",
        title: "Inserted",
        sessionId: "sess-ins",
        status: "awaiting_permission",
        pendingPermissionId: 99,
        pendingPermissionOptions: [{ kind: "action", name: "Approve", optionId: "approve-1" }],
        lastError: "timeout",
      };
      db.insertThread(thread);
      const found = db.getThreadById("t-ins");
      expect(found).toEqual(thread);
    });

    it("inserts with all nullable fields as null", () => {
      db.insertWorkspace({ id: "ws-null", name: "N", path: "/n" });
      db.insertThread({
        id: "t-null",
        workspaceId: "ws-null",
        title: "Null Fields",
        status: "idle",
      });
      const found = db.getThreadById("t-null");
      expect(found?.sessionId).toBeUndefined();
      expect(found?.pendingPermissionId).toBeUndefined();
      expect(found?.lastError).toBeUndefined();
    });

    it("throws on duplicate thread id", () => {
      db.insertWorkspace({ id: "ws-dup", name: "D", path: "/d" });
      db.insertThread({ id: "t-dup", workspaceId: "ws-dup", title: "First", status: "idle" });
      expect(() => {
        db.insertThread({ id: "t-dup", workspaceId: "ws-dup", title: "Second", status: "idle" });
      }).toThrow();
    });

    it("throws on foreign key violation (workspace doesn't exist)", () => {
      expect(() => {
        db.insertThread({ id: "t-fk", workspaceId: "ws-nonexistent", title: "FK Fail", status: "idle" });
      }).toThrow();
    });
  });

  describe("updateThread", () => {
    beforeEach(() => {
      seedWorkspaceAndThread();
    });

    it("updates a single field", () => {
      db.updateThread("thread-seed", { title: "Updated Title" });
      expect(db.getThreadById("thread-seed")?.title).toBe("Updated Title");
    });

    it("updates multiple fields at once", () => {
      db.updateThread("thread-seed", {
        title: "Multi",
        status: "thinking",
        sessionId: "new-sess",
      });
      const t = db.getThreadById("thread-seed");
      expect(t?.title).toBe("Multi");
      expect(t?.status).toBe("thinking");
      expect(t?.sessionId).toBe("new-sess");
    });

    it("never updates id or workspaceId", () => {
      db.updateThread("thread-seed", { id: "hacked", workspaceId: "hacked" } as any);
      const t = db.getThreadById("thread-seed");
      expect(t?.id).toBe("thread-seed");
      expect(t?.workspaceId).toBe("ws-seed");
    });

    it("serializes pendingPermissionOptions to JSON and back", () => {
      const options = [
        { kind: "allow_once", name: "Allow", optionId: "allow" },
        { kind: "reject", name: "Reject", optionId: "reject" },
      ];
      db.updateThread("thread-seed", { pendingPermissionOptions: options });
      const t = db.getThreadById("thread-seed");
      expect(t?.pendingPermissionOptions).toEqual(options);
    });

    it("sets pendingPermissionOptions to undefined (null in DB)", () => {
      db.updateThread("thread-seed", { pendingPermissionOptions: [{ kind: "a", name: "b", optionId: "c" }] });
      db.updateThread("thread-seed", { pendingPermissionOptions: undefined });
      const t = db.getThreadById("thread-seed");
      expect(t?.pendingPermissionOptions).toBeUndefined();
    });

    it("converts undefined values to null for nullable fields", () => {
      db.updateThread("thread-seed", { sessionId: "active", lastError: "some error" });
      db.updateThread("thread-seed", { sessionId: undefined, lastError: undefined });
      const t = db.getThreadById("thread-seed");
      expect(t?.sessionId).toBeUndefined();
      expect(t?.lastError).toBeUndefined();
    });

    it("returns undefined for non-existent thread", () => {
      expect(db.updateThread("t-ghost", { title: "Ghost" })).toBeUndefined();
    });

    it("returns the thread unchanged when no fields provided", () => {
      const t = db.updateThread("thread-seed", {});
      expect(t?.id).toBe("thread-seed");
      expect(t?.status).toBe("idle");
    });

    it("updates lastError", () => {
      db.updateThread("thread-seed", { lastError: "error message" });
      expect(db.getThreadById("thread-seed")?.lastError).toBe("error message");
      db.updateThread("thread-seed", { lastError: undefined });
      expect(db.getThreadById("thread-seed")?.lastError).toBeUndefined();
    });
  });

  describe("updateThreadStatus", () => {
    beforeEach(() => {
      seedWorkspaceAndThread();
    });

    it("updates only the status field", () => {
      db.updateThreadStatus("thread-seed", "thinking");
      expect(db.getThreadById("thread-seed")?.status).toBe("thinking");
    });

    it("can transition through all valid statuses", () => {
      db.updateThreadStatus("thread-seed", "thinking");
      expect(db.getThreadById("thread-seed")?.status).toBe("thinking");
      db.updateThreadStatus("thread-seed", "awaiting_permission");
      expect(db.getThreadById("thread-seed")?.status).toBe("awaiting_permission");
      db.updateThreadStatus("thread-seed", "idle");
      expect(db.getThreadById("thread-seed")?.status).toBe("idle");
    });

    it("does not affect other thread fields", () => {
      db.updateThread("thread-seed", { title: "My Title", sessionId: "sess-1" });
      db.updateThreadStatus("thread-seed", "thinking");
      const t = db.getThreadById("thread-seed");
      expect(t?.title).toBe("My Title");
      expect(t?.sessionId).toBe("sess-1");
      expect(t?.status).toBe("thinking");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Messages
  // ─────────────────────────────────────────────────────────────────────────

  describe("getMessagesByThread", () => {
    beforeEach(() => {
      seedWorkspaceAndThread();
    });

    it("returns messages in timestamp ascending order", () => {
      db.insertMessage({ id: "m3", threadId: "thread-seed", timestamp: "2024-01-03T00:00:00Z", raw: { c: 3 }, type: "session/update" });
      db.insertMessage({ id: "m1", threadId: "thread-seed", timestamp: "2024-01-01T00:00:00Z", raw: { c: 1 }, type: "session/update" });
      db.insertMessage({ id: "m2", threadId: "thread-seed", timestamp: "2024-01-02T00:00:00Z", raw: { c: 2 }, type: "session/update" });

      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    });

    it("JSON-parses the raw field", () => {
      const raw = { method: "session/update", params: { update: { text: "hello" } } };
      db.insertMessage({ id: "m-parse", threadId: "thread-seed", timestamp: "2024-01-01T00:00:00Z", raw, type: "session/update" });

      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs[0].raw).toEqual(raw);
      expect(typeof msgs[0].raw).toBe("object");
    });

    it("maps null type to undefined", () => {
      db.insertMessage({ id: "m-notype", threadId: "thread-seed", timestamp: "2024-01-01T00:00:00Z", raw: { x: 1 } });

      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs[0].type).toBeUndefined();
    });

    it("preserves type when set", () => {
      db.insertMessage({ id: "m-type", threadId: "thread-seed", timestamp: "2024-01-01T00:00:00Z", raw: { x: 1 }, type: "user_message" });

      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs[0].type).toBe("user_message");
    });

    it("returns empty array for thread with no messages", () => {
      expect(db.getMessagesByThread("thread-empty")).toEqual([]);
    });

    it("returns only messages for the specified thread", () => {
      db.insertWorkspace({ id: "ws-other", name: "O", path: "/o" });
      db.insertThread({ id: "t-other", workspaceId: "ws-other", title: "Other", status: "idle" });
      db.insertMessage({ id: "m-seed", threadId: "thread-seed", timestamp: "2024-01-01T00:00:00Z", raw: { x: 1 }, type: "user_message" });
      db.insertMessage({ id: "m-other", threadId: "t-other", timestamp: "2024-01-01T00:00:00Z", raw: { x: 2 }, type: "user_message" });

      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].id).toBe("m-seed");
    });

    it("handles complex nested raw objects", () => {
      const complexRaw = {
        jsonrpc: "2.0",
        id: 7,
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tc-123",
            kind: "execute",
            title: "npm test",
            rawInput: { command: "npm test" },
            content: [{ type: "content", content: { type: "text", text: "..." } }],
          },
        },
      };
      db.insertMessage({ id: "m-complex", threadId: "thread-seed", timestamp: "2024-01-01T00:00:00Z", raw: complexRaw, type: "session/update" });
      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs[0].raw).toEqual(complexRaw);
      expect(msgs[0].raw.params.update.toolCallId).toBe("tc-123");
    });
  });

  describe("insertMessage", () => {
    beforeEach(() => {
      seedWorkspaceAndThread();
    });

    it("inserts a message with all fields", () => {
      db.insertMessage({
        id: "m-full",
        threadId: "thread-seed",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { text: "hello" },
        type: "user_message",
      });
      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].id).toBe("m-full");
      expect(msgs[0].raw).toEqual({ text: "hello" });
      expect(msgs[0].type).toBe("user_message");
    });

    it("inserts with type as null (optional field)", () => {
      db.insertMessage({
        id: "m-notype",
        threadId: "thread-seed",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { x: 1 },
      });
      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs[0].type).toBeUndefined();
    });

    it("JSON-stringifies raw for storage and returns parsed", () => {
      const raw = { nested: { deep: [1, 2, 3] } };
      db.insertMessage({ id: "m-json", threadId: "thread-seed", timestamp: "2024-01-01T00:00:00Z", raw });

      // Verify via raw readDb which also parses
      const read = db.readDb();
      const stored = read.messages.find((m) => m.id === "m-json");
      expect(stored?.raw).toEqual(raw);
    });

    it("throws on foreign key violation (thread doesn't exist)", () => {
      expect(() => {
        db.insertMessage({ id: "m-fk", threadId: "t-nonexistent", timestamp: "2024-01-01T00:00:00Z", raw: {} });
      }).toThrow();
    });
  });

  describe("getMessageByThreadAndMessageId", () => {
    beforeEach(() => {
      seedWorkspaceAndThread();
    });

    it("finds a message by json_extract on raw.params.update.messageId", () => {
      db.insertMessage({
        id: "m-chunk-1",
        threadId: "thread-seed",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { params: { update: { sessionUpdate: "agent_message_chunk", messageId: "msg-abc", content: { text: "hello" } } } },
        type: "session/update",
      });

      const found = db.getMessageByThreadAndMessageId("thread-seed", "msg-abc");
      expect(found).toBeDefined();
      expect(found?.id).toBe("m-chunk-1");
      expect(found?.raw.params.update.content.text).toBe("hello");
    });

    it("returns the most recent message (timestamp DESC) when multiple exist", () => {
      db.insertMessage({
        id: "m-old",
        threadId: "thread-seed",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { params: { update: { messageId: "msg-dup", content: { text: "old" } } } },
        type: "session/update",
      });
      db.insertMessage({
        id: "m-new",
        threadId: "thread-seed",
        timestamp: "2024-01-02T00:00:00Z",
        raw: { params: { update: { messageId: "msg-dup", content: { text: "new" } } } },
        type: "session/update",
      });

      const found = db.getMessageByThreadAndMessageId("thread-seed", "msg-dup");
      expect(found?.id).toBe("m-new");
    });

    it("returns undefined when no match exists", () => {
      db.insertMessage({
        id: "m-other",
        threadId: "thread-seed",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { params: { update: { messageId: "msg-xyz" } } },
        type: "session/update",
      });

      expect(db.getMessageByThreadAndMessageId("thread-seed", "msg-nonexistent")).toBeUndefined();
    });

    it("does not match messages without messageId in raw", () => {
      db.insertMessage({
        id: "m-noid",
        threadId: "thread-seed",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { method: "session/update", params: { update: { sessionUpdate: "tool_call" } } },
        type: "session/update",
      });

      expect(db.getMessageByThreadAndMessageId("thread-seed", "any")).toBeUndefined();
    });

    it("scopes to thread (same messageId in different thread not found)", () => {
      db.insertWorkspace({ id: "ws-other", name: "O", path: "/o" });
      db.insertThread({ id: "t-other", workspaceId: "ws-other", title: "Other", status: "idle" });
      db.insertMessage({
        id: "m-other-thread",
        threadId: "t-other",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { params: { update: { messageId: "msg-scoped" } } },
        type: "session/update",
      });

      expect(db.getMessageByThreadAndMessageId("thread-seed", "msg-scoped")).toBeUndefined();
    });
  });

  describe("updateMessageRaw", () => {
    beforeEach(() => {
      seedWorkspaceAndThread();
    });

    it("overwrites the raw field", () => {
      db.insertMessage({
        id: "m-upd",
        threadId: "thread-seed",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { params: { update: { content: { text: "hello" } } } },
        type: "session/update",
      });

      const updatedRaw = { params: { update: { content: { text: "hello world" } } } };
      db.updateMessageRaw("m-upd", updatedRaw);

      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs[0].raw).toEqual(updatedRaw);
    });

    it("round-trips through JSON correctly", () => {
      const complexRaw = {
        jsonrpc: "2.0",
        params: { update: { content: { text: "chunk1" + "chunk2" } } },
        nested: { arr: [1, { a: true }, "str"] },
      };
      db.insertMessage({
        id: "m-rt",
        threadId: "thread-seed",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { params: { update: { content: { text: "chunk1" } } } },
        type: "session/update",
      });

      db.updateMessageRaw("m-rt", complexRaw);

      // Verify via getMessageByThreadAndMessageId (also parses raw)
      const found = db.getMessageByThreadAndMessageId("thread-seed", undefined as any);
      // Or just getMessagesByThread
      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs[0].raw).toEqual(complexRaw);
      expect(msgs[0].raw.nested.arr[1].a).toBe(true);
    });

    it("does not change other message fields", () => {
      db.insertMessage({
        id: "m-meta",
        threadId: "thread-seed",
        timestamp: "2024-06-15T10:00:00Z",
        raw: { old: true },
        type: "session/update",
      });

      db.updateMessageRaw("m-meta", { new: true });

      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs[0].id).toBe("m-meta");
      expect(msgs[0].timestamp).toBe("2024-06-15T10:00:00Z");
      expect(msgs[0].type).toBe("session/update");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AllowedPatterns
  // ─────────────────────────────────────────────────────────────────────────

  describe("getAllowedPatterns", () => {
    it("returns empty array when no patterns exist", () => {
      expect(db.getAllowedPatterns()).toEqual([]);
    });

    it("returns all patterns", () => {
      db.insertAllowedPattern({
        variant: "execute",
        pattern: "npm run *",
        toolName: "Bash",
        createdAt: "2024-01-01T00:00:00Z",
      });
      db.insertAllowedPattern({
        variant: "edit",
        pattern: "src/*",
        toolName: "Edit",
        createdAt: "2024-01-02T00:00:00Z",
      });

      const patterns = db.getAllowedPatterns();
      expect(patterns).toHaveLength(2);
      expect(patterns.map((p) => p.pattern).sort()).toEqual(["npm run *", "src/*"]);
    });

    it("maps null toolName to undefined", () => {
      db.insertAllowedPattern({
        variant: "exact",
        pattern: "test-pattern",
        createdAt: "2024-01-01T00:00:00Z",
      });

      const patterns = db.getAllowedPatterns();
      expect(patterns[0].toolName).toBeUndefined();
    });

    it("preserves toolName when set", () => {
      db.insertAllowedPattern({
        variant: "execute",
        pattern: "npm run *",
        toolName: "Bash",
        createdAt: "2024-01-01T00:00:00Z",
      });

      const patterns = db.getAllowedPatterns();
      expect(patterns[0].toolName).toBe("Bash");
    });

    it("preserves variant correctly", () => {
      const variants = ["exact", "wildcard", "execute", "edit", "write"] as const;
      for (const variant of variants) {
        db.insertAllowedPattern({
          variant,
          pattern: `pattern-${variant}`,
          createdAt: "2024-01-01T00:00:00Z",
        });
      }

      const patterns = db.getAllowedPatterns();
      expect(patterns).toHaveLength(variants.length);
      const storedVariants = patterns.map((p) => p.variant).sort();
      expect(storedVariants).toEqual([...variants].sort());
    });
  });

  describe("insertAllowedPattern", () => {
    it("inserts a pattern and returns it", () => {
      const ap: AllowSimilarPattern = {
        variant: "execute",
        pattern: "npm test *",
        toolName: "Bash",
        createdAt: "2024-01-01T00:00:00Z",
      };

      const returned = db.insertAllowedPattern(ap);
      expect(returned).toEqual(ap);

      const stored = db.getAllowedPatterns();
      expect(stored).toHaveLength(1);
      expect(stored[0].pattern).toBe("npm test *");
    });

    it("inserts with null toolName", () => {
      db.insertAllowedPattern({
        variant: "wildcard",
        pattern: "*",
        createdAt: "2024-01-01T00:00:00Z",
      });

      const stored = db.getAllowedPatterns();
      expect(stored[0].toolName).toBeUndefined();
    });

    it("does not generate duplicate patterns (caller is responsible)", () => {
      const ap = { variant: "execute" as const, pattern: "npm run *", toolName: "Bash", createdAt: "2024-01-01T00:00:00Z" };
      db.insertAllowedPattern(ap);
      db.insertAllowedPattern({ ...ap, createdAt: "2024-01-02T00:00:00Z" });
      // Both inserted — dedup is done by caller (server.ts checks before inserting)
      expect(db.getAllowedPatterns()).toHaveLength(2);
    });
  });

  describe("deleteAllowedPattern", () => {
    beforeEach(() => {
      db.insertAllowedPattern({ variant: "execute", pattern: "npm run *", toolName: "Bash", createdAt: "2024-01-01T00:00:00Z" });
      db.insertAllowedPattern({ variant: "edit", pattern: "src/*", toolName: "Edit", createdAt: "2024-01-02T00:00:00Z" });
      db.insertAllowedPattern({ variant: "wildcard", pattern: "global-pattern", createdAt: "2024-01-03T00:00:00Z" });
    });

    it("deletes a specific pattern by pattern+toolName", () => {
      const deleted = db.deleteAllowedPattern("npm run *", "Bash");
      expect(deleted).toBe(true);
      expect(db.getAllowedPatterns()).toHaveLength(2);
      expect(db.getAllowedPatterns().find((p) => p.pattern === "npm run *")).toBeUndefined();
    });

    it("does not delete pattern with same name but different toolName", () => {
      db.insertAllowedPattern({ variant: "execute", pattern: "npm run *", toolName: "Edit", createdAt: "2024-01-04T00:00:00Z" });
      const deleted = db.deleteAllowedPattern("npm run *", "Bash");
      expect(deleted).toBe(true);
      // The Edit one should remain
      const editPattern = db.getAllowedPatterns().find((p) => p.pattern === "npm run *" && p.toolName === "Edit");
      expect(editPattern).toBeDefined();
    });

    it("deletes pattern with toolName=undefined by matching NULL toolName", () => {
      const deleted = db.deleteAllowedPattern("global-pattern");
      expect(deleted).toBe(true);
      expect(db.getAllowedPatterns()).toHaveLength(2);
    });

    it("does not delete pattern with toolName when called without toolName", () => {
      // "global-pattern" has toolName=NULL. "npm run *" has toolName="Bash".
      // Deleting without toolName should only match NULL toolName entries.
      const deleted = db.deleteAllowedPattern("npm run *");
      expect(deleted).toBe(false);
      // "npm run *" should still exist
      expect(db.getAllowedPatterns().find((p) => p.pattern === "npm run *")).toBeDefined();
    });

    it("returns false for non-existent pattern", () => {
      expect(db.deleteAllowedPattern("nonexistent")).toBe(false);
    });

    it("deletes all matching rows", () => {
      db.insertAllowedPattern({ variant: "execute", pattern: "dup-pattern", toolName: "Bash", createdAt: "2024-01-05T00:00:00Z" });
      db.insertAllowedPattern({ variant: "execute", pattern: "dup-pattern", toolName: "Bash", createdAt: "2024-01-06T00:00:00Z" });
      const deleted = db.deleteAllowedPattern("dup-pattern", "Bash");
      expect(deleted).toBe(true);
      expect(db.getAllowedPatterns().filter((p) => p.pattern === "dup-pattern")).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Cascade deletes
  // ─────────────────────────────────────────────────────────────────────────

  describe("cascade deletes", () => {
    it("deleting a workspace cascades to its threads and messages", () => {
      db.insertWorkspace({ id: "ws-cascade", name: "Cascade", path: "/cascade" });
      db.insertThread({ id: "t-cascade", workspaceId: "ws-cascade", title: "T", status: "idle" });
      db.insertMessage({
        id: "m-cascade",
        threadId: "t-cascade",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { text: "hello" },
        type: "user_message",
      });

      expect(db.getThreadById("t-cascade")).toBeDefined();
      expect(db.getMessagesByThread("t-cascade")).toHaveLength(1);

      const deleted = db.deleteWorkspace("ws-cascade");
      expect(deleted).toBe(true);
      expect(db.getWorkspaceById("ws-cascade")).toBeUndefined();
      expect(db.getThreadById("t-cascade")).toBeUndefined();
      expect(db.getMessagesByThread("t-cascade")).toHaveLength(0);
    });

    it("deleting a thread cascades to its messages", () => {
      db.insertWorkspace({ id: "ws-del", name: "Del", path: "/del" });
      db.insertThread({ id: "t-del", workspaceId: "ws-del", title: "T", status: "idle" });
      db.insertMessage({ id: "m-del-1", threadId: "t-del", timestamp: "2024-01-01T00:00:00Z", raw: { a: 1 }, type: "user_message" });
      db.insertMessage({ id: "m-del-2", threadId: "t-del", timestamp: "2024-01-02T00:00:00Z", raw: { a: 2 }, type: "user_message" });

      expect(db.getMessagesByThread("t-del")).toHaveLength(2);

      const deleted = db.deleteThread("t-del");
      expect(deleted).toBe(true);
      expect(db.getThreadById("t-del")).toBeUndefined();
      expect(db.getMessagesByThread("t-del")).toHaveLength(0);

      // Workspace should still exist
      expect(db.getWorkspaceById("ws-del")).toBeDefined();
    });

    it("deleting workspace does not affect other workspaces", () => {
      db.insertWorkspace({ id: "ws-a", name: "A", path: "/a" });
      db.insertWorkspace({ id: "ws-b", name: "B", path: "/b" });
      db.insertThread({ id: "t-a", workspaceId: "ws-a", title: "A", status: "idle" });
      db.insertThread({ id: "t-b", workspaceId: "ws-b", title: "B", status: "idle" });

      db.deleteWorkspace("ws-a");

      expect(db.getWorkspaceById("ws-a")).toBeUndefined();
      expect(db.getThreadById("t-a")).toBeUndefined();
      expect(db.getWorkspaceById("ws-b")).toBeDefined();
      expect(db.getThreadById("t-b")).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Chunk accumulation end-to-end
  // ─────────────────────────────────────────────────────────────────────────

  describe("chunk accumulation (end-to-end)", () => {
    beforeEach(() => {
      seedWorkspaceAndThread();
    });

    it("finds the first chunk message by messageId for appending", () => {
      // Simulate: first chunk creates a message with raw.params.update.messageId
      const firstChunkRaw = {
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: "msg-stream-123",
            content: { text: "Hello" },
          },
        },
      };
      db.insertMessage({
        id: "m-first-chunk",
        threadId: "thread-seed",
        timestamp: "2024-01-01T00:00:00Z",
        raw: firstChunkRaw,
        type: "session/update",
      });

      // Find it via getMessageByThreadAndMessageId
      const found = db.getMessageByThreadAndMessageId("thread-seed", "msg-stream-123");
      expect(found).toBeDefined();
      expect(found?.id).toBe("m-first-chunk");

      // Simulate chunk accumulation: read → clone → append → update
      const updatedRaw = JSON.parse(JSON.stringify(found!.raw));
      updatedRaw.params.update.content.text += " World";
      db.updateMessageRaw(found!.id, updatedRaw);

      // Verify accumulation
      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].raw.params.update.content.text).toBe("Hello World");
    });

    it("multiple chunks with same messageId accumulate correctly", () => {
      const messageId = "msg-accum";
      const chunks = ["Hello", " World", "!", " How", " are", " you?"];

      for (let i = 0; i < chunks.length; i++) {
        // First chunk: insert. Subsequent chunks: find + update.
        if (i === 0) {
          db.insertMessage({
            id: `m-chunk-${i}`,
            threadId: "thread-seed",
            timestamp: `2024-01-01T00:00:0${i}.000Z`,
            raw: { method: "session/update", params: { update: { messageId, content: { text: chunks[i] } } } },
            type: "session/update",
          });
        } else {
          const found = db.getMessageByThreadAndMessageId("thread-seed", messageId);
          expect(found).toBeDefined();
          const updatedRaw = JSON.parse(JSON.stringify(found!.raw));
          updatedRaw.params.update.content.text += chunks[i];
          db.updateMessageRaw(found!.id, updatedRaw);
        }
      }

      const msgs = db.getMessagesByThread("thread-seed");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].raw.params.update.content.text).toBe("Hello World! How are you?");
    });

    it("different messageIds do not interfere with each other", () => {
      // Two concurrent streams
      db.insertMessage({
        id: "m-stream-a",
        threadId: "thread-seed",
        timestamp: "2024-01-01T00:00:00.000Z",
        raw: { params: { update: { messageId: "stream-a", content: { text: "A" } } } },
        type: "session/update",
      });
      db.insertMessage({
        id: "m-stream-b",
        threadId: "thread-seed",
        timestamp: "2024-01-01T00:00:00.100Z",
        raw: { params: { update: { messageId: "stream-b", content: { text: "B" } } } },
        type: "session/update",
      });

      // Append to stream A
      const foundA = db.getMessageByThreadAndMessageId("thread-seed", "stream-a");
      const rawA = JSON.parse(JSON.stringify(foundA!.raw));
      rawA.params.update.content.text += " appended";
      db.updateMessageRaw(foundA!.id, rawA);

      // Stream B should be unaffected
      const foundB = db.getMessageByThreadAndMessageId("thread-seed", "stream-b");
      expect(foundB?.raw.params.update.content.text).toBe("B");

      // Stream A should be updated
      const msgs = db.getMessagesByThread("thread-seed");
      const msgA = msgs.find((m) => m.id === "m-stream-a");
      expect(msgA?.raw.params.update.content.text).toBe("A appended");
    });
  });
});
