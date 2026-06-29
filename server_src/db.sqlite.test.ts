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
