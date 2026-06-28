import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import express, { Express, Response } from "express";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(os.tmpdir(), `devos-test-sse-${Date.now()}.json`);

// Mock logger module
const mockLogs: any[] = [];
vi.mock("../src/logger", () => ({
  logInfo: (source: string, msg: string, threadId?: string) => {
    mockLogs.push({ level: "info", source, msg, threadId });
  },
  logError: (source: string, msg: string, threadId?: string) => {
    mockLogs.push({ level: "error", source, msg, threadId });
  },
  getLogs: (opts?: any) => {
    // Return mock logs filtered by threadId if provided
    let logs = mockLogs.map((l, idx) => ({ id: idx, ...l }));
    if (opts?.threadId) {
      logs = logs.filter((l) => l.threadId === opts.threadId);
    }
    if (opts?.limit) {
      logs = logs.slice(-opts.limit);
    }
    return logs;
  },
}));

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  function readDb() {
    try {
      if (!fs.existsSync(TEST_DB)) {
        return { workspaces: [], threads: [], messages: [] };
      }
      return JSON.parse(fs.readFileSync(TEST_DB, "utf-8"));
    } catch {
      return { workspaces: [], threads: [], messages: [] };
    }
  }

  function writeDb(data: any) {
    fs.writeFileSync(TEST_DB, JSON.stringify(data, null, 2));
  }

  function updateDb(fn: (db: any) => void) {
    const db = readDb();
    fn(db);
    writeDb(db);
  }

  const globalLogClients = new Set<Response>();

  function broadcastGlobalLog(event: any) {
    const data = JSON.stringify(event);
    for (const client of globalLogClients) {
      client.write(`data: ${data}\n\n`);
    }
  }

  // Mock logger getLogs function that was imported
  const getLogs = (opts?: any): any[] => {
    let logs = mockLogs.map((l, idx) => ({ id: idx, ...l }));
    if (opts?.threadId) {
      logs = logs.filter((l) => l.threadId === opts.threadId);
    }
    if (opts?.limit) {
      logs = logs.slice(-opts.limit);
    }
    return logs;
  };

  // Thread log SSE route (replicated from server.ts)
  app.get("/api/threads/:threadId/logs", (req, res) => {
    const { threadId } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Send all existing logs for this thread
    const existingLogs = getLogs({ threadId, limit: 200 });
    for (const log of existingLogs.reverse()) {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    }

    // Poll for new logs every 500ms
    let lastId = existingLogs.length > 0 ? existingLogs[existingLogs.length - 1].id : 0;
    const interval = setInterval(() => {
      const newLogs = getLogs({ threadId, limit: 50 });
      for (const log of newLogs) {
        if (log.id > lastId) {
          res.write(`data: ${JSON.stringify(log)}\n\n`);
          lastId = log.id;
        }
      }
    }, 500);

    req.on("close", () => {
      clearInterval(interval);
    });
  });

  // Global log SSE route (replicated from server.ts)
  app.get("/api/logs", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Send existing logs
    const existingLogs = getLogs({ limit: 100 });
    for (const log of existingLogs.reverse()) {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    }

    globalLogClients.add(res);
    req.on("close", () => {
      globalLogClients.delete(res);
    });
  });

  // Helper endpoint to trigger logs (for testing)
  app.post("/api/test/log", (req, res) => {
    const { threadId, msg } = req.body;
    mockLogs.push({
      level: "info",
      source: "test",
      msg,
      threadId,
      timestamp: new Date().toISOString(),
    });
    const event = {
      type: "log",
      threadId,
      msg,
      timestamp: new Date().toISOString(),
    };
    const data = JSON.stringify(event);
    for (const client of globalLogClients) {
      client.write(`data: ${data}\n\n`);
    }
    res.json({ ok: true });
  });

  return { app, globalLogClients, broadcastGlobalLog };
}

describe("SSE Routes — Event Streaming", () => {
  let app: Express;
  let globalLogClients: Set<Response>;
  let broadcastGlobalLog: (event: any) => void;

  beforeAll(() => {
    const result = createTestApp();
    app = result.app;
    globalLogClients = result.globalLogClients;
    broadcastGlobalLog = result.broadcastGlobalLog;
  });

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    mockLogs.length = 0;
    globalLogClients.clear();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    globalLogClients.clear();
  });

  describe("Thread log SSE — GET /api/threads/:threadId/logs", () => {
    it.skip("connects and sends existing logs for the thread", async () => {
      const threadId = "thread-test-1";

      // Add some logs for this thread
      mockLogs.push(
        { level: "info", source: "acp", msg: "Message 1", threadId },
        { level: "info", source: "acp", msg: "Message 2", threadId }
      );

      let resolved = false;
      const req = request(app)
        .get(`/api/threads/${threadId}/logs`)
        .on("data", (data: Buffer) => {
          const line = data.toString();
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6); // Remove "data: " prefix
            const log = JSON.parse(jsonStr);
            expect(log).toHaveProperty("id");
            expect(log).toHaveProperty("msg");
            expect(log.threadId).toBe(threadId);
          }
        })
        .on("error", () => {
          // Expected when we abort
        });

      // Close after short delay
      await new Promise(resolve => {
        setTimeout(() => {
          req.abort();
          resolve(undefined);
        }, 100);
      });
    });

    it.skip("cleans up interval when client disconnects", async () => {
      const threadId = "thread-test-2";
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      const req = request(app)
        .get(`/api/threads/${threadId}/logs`)
        .on("error", () => {
          // Expected when we abort
        });

      await new Promise(resolve => {
        setTimeout(() => {
          req.abort();
          // Give it a moment for the cleanup to fire
          setTimeout(() => {
            expect(clearIntervalSpy).toHaveBeenCalled();
            clearIntervalSpy.mockRestore();
            resolve(undefined);
          }, 50);
        }, 50);
      });
    });

    it.skip("correctly filters logs by threadId", async () => {
      const threadId1 = "thread-1";
      const threadId2 = "thread-2";

      // Add logs for different threads
      mockLogs.push(
        { level: "info", source: "acp", msg: "Thread 1 Log", threadId: threadId1 },
        { level: "info", source: "acp", msg: "Thread 2 Log", threadId: threadId2 }
      );

      let receivedLogs: any[] = [];

      const req = request(app)
        .get(`/api/threads/${threadId1}/logs`)
        .on("data", (data: Buffer) => {
          const line = data.toString();
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6);
            const log = JSON.parse(jsonStr);
            receivedLogs.push(log);
          }
        })
        .on("error", () => {
          // Expected when we abort
        });

      await new Promise(resolve => {
        setTimeout(() => {
          req.abort();
          // Should only receive logs for threadId1
          const threadsInResponse = receivedLogs.map((l) => l.threadId);
          expect(threadsInResponse.every((tid) => tid === threadId1)).toBe(true);
          resolve(undefined);
        }, 100);
      });
    });
  });

  describe("Global log SSE — GET /api/logs", () => {
    it.skip("connects and sends existing logs", async () => {
      // Add some global logs
      mockLogs.push(
        { level: "info", source: "server", msg: "Global message 1", threadId: "t1" },
        { level: "info", source: "server", msg: "Global message 2", threadId: "t2" }
      );

      let receivedCount = 0;

      const req = request(app)
        .get("/api/logs")
        .on("data", (data: Buffer) => {
          const line = data.toString();
          if (line.startsWith("data: ")) {
            receivedCount++;
          }
        })
        .on("error", () => {
          // Expected when we abort
        });

      await new Promise(resolve => {
        setTimeout(() => {
          req.abort();
          expect(receivedCount).toBeGreaterThan(0);
          resolve(undefined);
        }, 100);
      });
    });

    it.skip("client disconnect removes from globalLogClients Set", async () => {
      const initialSize = globalLogClients.size;

      const req = request(app)
        .get("/api/logs")
        .on("error", () => {
          // Expected when we abort
        });

      await new Promise(resolve => {
        setTimeout(() => {
          req.abort();
          // After disconnect, size should not increase
          setTimeout(() => {
            // The client should have been removed from the set during cleanup
            expect(globalLogClients.size).toBe(initialSize);
            resolve(undefined);
          }, 50);
        }, 50);
      });
    });

    it.skip("adds client to globalLogClients Set when connected", async () => {
      const initialSize = globalLogClients.size;

      const req = request(app).get("/api/logs");

      // Give it a moment to connect and be added to the set
      await new Promise(resolve => {
        setTimeout(() => {
          expect(globalLogClients.size).toBe(initialSize + 1);
          req.abort();
          resolve(undefined);
        }, 50);
      });
    });
  });

  describe("broadcastGlobalLog() delivery", () => {
    it.skip("delivers message to all connected clients", async () => {
      let client1Received = false;
      let client2Received = false;
      const testMessage = "test broadcast message";

      // Connect first client
      const req1 = request(app)
        .get("/api/logs")
        .on("data", (data: Buffer) => {
          const line = data.toString();
          if (line.includes(testMessage)) {
            client1Received = true;
          }
        })
        .on("error", () => {
          // Expected when we abort
        });

      await new Promise(resolve => {
        setTimeout(() => {
          // Connect second client
          const req2 = request(app)
            .get("/api/logs")
            .on("data", (data: Buffer) => {
              const line = data.toString();
              if (line.includes(testMessage)) {
                client2Received = true;
              }
            })
            .on("error", () => {
              // Expected when we abort
            });

          setTimeout(() => {
            // Broadcast a message
            broadcastGlobalLog({
              type: "acp",
              threadId: "test",
              raw: { method: "test" },
              message: testMessage,
            });

            setTimeout(() => {
              req1.abort();
              req2.abort();
              expect(client1Received).toBe(true);
              expect(client2Received).toBe(true);
              resolve(undefined);
            }, 100);
          }, 50);
        }, 50);
      });
    });

    it("does not crash with zero connected clients", () => {
      // Ensure no clients connected
      globalLogClients.clear();

      // This should not throw
      broadcastGlobalLog({
        type: "test",
        message: "no one listening",
      });
    });
  });
});
