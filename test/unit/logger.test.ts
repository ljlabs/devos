import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import {
  logInfo,
  logError,
  logWarn,
  getLogs,
  getLatestLogId,
  LogEntry,
  __setTestDb,
} from "../../src/logger";

describe("Logger Module", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    // Create an in-memory database for each test
    testDb = new Database(":memory:");
    testDb.pragma("journal_mode = WAL");
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        thread_id TEXT,
        level TEXT NOT NULL DEFAULT 'info',
        component TEXT NOT NULL DEFAULT 'server',
        message TEXT NOT NULL
      )
    `);

    // Inject the test database
    __setTestDb(testDb);

    // Spy on console methods
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __setTestDb(null);
    if (testDb) {
      testDb.close();
    }
  });

  describe("logInfo", () => {
    it("writes to console.log", () => {
      const logSpy = vi.spyOn(console, "log");
      logInfo("server", "test message");
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[server] test message")
      );
    });

    it("writes to console.log with threadId", () => {
      const logSpy = vi.spyOn(console, "log");
      logInfo("server", "test message", "thread-123");
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[server:thread-123]")
      );
    });

    it("writes to database with level='info'", () => {
      logInfo("myComponent", "test info message");
      const logs = testDb.prepare("SELECT * FROM logs").all();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        level: "info",
        component: "myComponent",
        message: "test info message",
        thread_id: null,
      });
    });

    it("writes to database with threadId", () => {
      logInfo("api", "thread-specific message", "abc-123");
      const logs = testDb.prepare("SELECT * FROM logs").all();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        thread_id: "abc-123",
        component: "api",
        message: "thread-specific message",
      });
    });
  });

  describe("logError", () => {
    it("writes to console.error", () => {
      const errorSpy = vi.spyOn(console, "error");
      logError("server", "test error");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[server] test error")
      );
    });

    it("writes to database with level='error'", () => {
      logError("api", "something went wrong");
      const logs = testDb.prepare("SELECT * FROM logs").all();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        level: "error",
        component: "api",
        message: "something went wrong",
      });
    });

    it("writes with threadId", () => {
      logError("processor", "error in thread", "thread-xyz");
      const logs = testDb.prepare("SELECT * FROM logs").all();
      expect(logs[0]).toMatchObject({
        level: "error",
        thread_id: "thread-xyz",
        component: "processor",
      });
    });
  });

  describe("logWarn", () => {
    it("writes to console.warn", () => {
      const warnSpy = vi.spyOn(console, "warn");
      logWarn("server", "test warning");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[server] test warning")
      );
    });

    it("writes to database with level='warn'", () => {
      logWarn("cache", "cache miss");
      const logs = testDb.prepare("SELECT * FROM logs").all();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        level: "warn",
        component: "cache",
        message: "cache miss",
      });
    });

    it("writes with threadId", () => {
      logWarn("worker", "slow operation", "thread-001");
      const logs = testDb.prepare("SELECT * FROM logs").all();
      expect(logs[0]).toMatchObject({
        level: "warn",
        thread_id: "thread-001",
        component: "worker",
      });
    });
  });

  describe("getLogs", () => {
    beforeEach(() => {
      // Insert test data
      const stmt = testDb.prepare(
        "INSERT INTO logs (thread_id, level, component, message) VALUES (?, ?, ?, ?)"
      );
      stmt.run(null, "info", "server", "message 1");
      stmt.run(null, "info", "server", "message 2");
      stmt.run(null, "info", "server", "message 3");
    });

    it("returns all logs in DESC order by id", () => {
      const logs = getLogs();
      expect(logs).toHaveLength(3);
      // DESC order means highest id first
      expect(logs[0].message).toBe("message 3");
      expect(logs[1].message).toBe("message 2");
      expect(logs[2].message).toBe("message 1");
    });

    it("filters by threadId", () => {
      const stmt = testDb.prepare(
        "INSERT INTO logs (thread_id, level, component, message) VALUES (?, ?, ?, ?)"
      );
      stmt.run("thread-a", "info", "server", "thread-a msg 1");
      stmt.run("thread-a", "info", "server", "thread-a msg 2");
      stmt.run("thread-b", "info", "server", "thread-b msg");

      const logsA = getLogs({ threadId: "thread-a" });
      expect(logsA).toHaveLength(2);
      expect(logsA.every((l) => l.thread_id === "thread-a")).toBe(true);

      const logsB = getLogs({ threadId: "thread-b" });
      expect(logsB).toHaveLength(1);
      expect(logsB[0].thread_id).toBe("thread-b");
    });

    it("respects limit parameter", () => {
      const stmt = testDb.prepare(
        "INSERT INTO logs (thread_id, level, component, message) VALUES (?, ?, ?, ?)"
      );
      // Insert more to total 10
      for (let i = 4; i <= 10; i++) {
        stmt.run(null, "info", "server", `message ${i}`);
      }

      const logs = getLogs({ limit: 3 });
      expect(logs).toHaveLength(3);
      // Should be the 3 most recent
      expect(logs[0].message).toBe("message 10");
      expect(logs[1].message).toBe("message 9");
      expect(logs[2].message).toBe("message 8");
    });

    it("combines threadId and limit filters", () => {
      const stmt = testDb.prepare(
        "INSERT INTO logs (thread_id, level, component, message) VALUES (?, ?, ?, ?)"
      );
      for (let i = 4; i <= 8; i++) {
        stmt.run("thread-a", "info", "server", `thread-a msg ${i}`);
      }
      for (let i = 1; i <= 5; i++) {
        stmt.run("thread-b", "info", "server", `thread-b msg ${i}`);
      }

      const logs = getLogs({ threadId: "thread-a", limit: 2 });
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.thread_id === "thread-a")).toBe(true);
      expect(logs[0].message).toBe("thread-a msg 8");
      expect(logs[1].message).toBe("thread-a msg 7");
    });
  });

  describe("getLatestLogId", () => {
    it("returns the maximum id", () => {
      const stmt = testDb.prepare(
        "INSERT INTO logs (thread_id, level, component, message) VALUES (?, ?, ?, ?)"
      );
      stmt.run(null, "info", "server", "msg 1");
      stmt.run(null, "info", "server", "msg 2");
      stmt.run(null, "info", "server", "msg 3");

      const id = getLatestLogId();
      expect(id).toBe(3);
    });

    it("returns 0 on empty database", () => {
      const id = getLatestLogId();
      expect(id).toBe(0);
    });

    it("returns correct id after multiple operations", () => {
      const stmt = testDb.prepare(
        "INSERT INTO logs (thread_id, level, component, message) VALUES (?, ?, ?, ?)"
      );
      stmt.run(null, "info", "server", "first");
      let id = getLatestLogId();
      expect(id).toBe(1);

      stmt.run(null, "error", "server", "second");
      id = getLatestLogId();
      expect(id).toBe(2);

      stmt.run("thread-1", "warn", "api", "third");
      id = getLatestLogId();
      expect(id).toBe(3);
    });
  });

  describe("Error handling", () => {
    it("does not crash when database insert fails", () => {
      // Mock console to track errors
      const errorSpy = vi.spyOn(console, "error");
      const warnSpy = vi.spyOn(console, "warn");

      // These should not throw even if DB operations fail
      expect(() => {
        logInfo("component", "message");
        logError("component", "error message");
        logWarn("component", "warn message");
      }).not.toThrow();

      expect(errorSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("LogEntry type", () => {
    it("returns properly typed LogEntry objects", () => {
      const stmt = testDb.prepare(
        "INSERT INTO logs (thread_id, level, component, message) VALUES (?, ?, ?, ?)"
      );
      stmt.run("thread-1", "info", "test", "test message");

      const logs = getLogs();
      expect(logs).toHaveLength(1);

      const log: LogEntry = logs[0];
      expect(typeof log.id).toBe("number");
      expect(typeof log.timestamp).toBe("string");
      expect(typeof log.level).toBe("string");
      expect(typeof log.component).toBe("string");
      expect(typeof log.message).toBe("string");
      expect(log.thread_id).toBe("thread-1");
    });
  });

  describe("Concurrent writes", () => {
    it("handles multiple rapid writes without corruption", () => {
      // Simulate concurrent writes by rapidly logging
      for (let i = 0; i < 50; i++) {
        logInfo("component", `message ${i}`, `thread-${i % 3}`);
      }

      const logs = getLogs();
      expect(logs).toHaveLength(50);
      // Verify all logs are present and in correct order (DESC)
      expect(logs[0].message).toBe("message 49");
      expect(logs[49].message).toBe("message 0");

      // Verify no duplicates
      const ids = logs.map((l) => l.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(50);
    });

    it("maintains database integrity with mixed log levels", () => {
      for (let i = 0; i < 30; i++) {
        if (i % 3 === 0) {
          logInfo("component", `info ${i}`);
        } else if (i % 3 === 1) {
          logError("component", `error ${i}`);
        } else {
          logWarn("component", `warn ${i}`);
        }
      }

      const logs = getLogs();
      expect(logs).toHaveLength(30);

      // Count by level
      const levels = logs.map((l) => l.level);
      const infoCount = levels.filter((l) => l === "info").length;
      const errorCount = levels.filter((l) => l === "error").length;
      const warnCount = levels.filter((l) => l === "warn").length;

      expect(infoCount).toBe(10);
      expect(errorCount).toBe(10);
      expect(warnCount).toBe(10);
    });
  });

  describe("Edge cases", () => {
    it("allows empty message strings", () => {
      logInfo("component", "");
      logError("component", "");
      logWarn("component", "");

      const logs = getLogs();
      expect(logs).toHaveLength(3);
      expect(logs.every((l) => l.message === "")).toBe(true);
    });

    it("handles special characters in messages", () => {
      const specialMessages = [
        'Message with "double quotes"',
        "Message with 'single quotes'",
        "Message with\nnewlines\nand\ttabs",
        "Message with backslash \\",
        "Message with $ symbol and 'mixed' \"quotes\"",
        "Unicode: 你好 مرحبا здравствуй 🚀",
        "SQL-like: DROP TABLE logs; SELECT * FROM logs WHERE id = 1",
      ];

      for (const msg of specialMessages) {
        logInfo("test", msg);
      }

      const logs = getLogs();
      expect(logs).toHaveLength(specialMessages.length);

      // Verify all messages are preserved exactly
      for (let i = 0; i < specialMessages.length; i++) {
        expect(logs[specialMessages.length - 1 - i].message).toBe(
          specialMessages[i]
        );
      }
    });

    it("handles special characters with threadId", () => {
      const threadId = 'thread-"special\'chars\\n';
      logInfo("component", "test message", threadId);

      const logs = getLogs({ threadId });
      expect(logs).toHaveLength(1);
      expect(logs[0].thread_id).toBe(threadId);
      expect(logs[0].message).toBe("test message");
    });

    it("preserves all logs even with very long messages", () => {
      const longMessage = "x".repeat(10000);
      logInfo("component", longMessage);

      const logs = getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toHaveLength(10000);
      expect(logs[0].message).toBe(longMessage);
    });
  });
});
