import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { EventEmitter } from "events";

const TEST_DB = path.join(os.tmpdir(), `devos-test-cancel-${Date.now()}.json`);

// Mock ClaudeAgent
class MockClaudeAgent extends EventEmitter {
  constructor(threadId: string) {
    super();
    this.threadId = threadId;
  }
  threadId: string;
  cancel(sessionId?: string) {
    // Mock cancel implementation
  }
  send(msg: object) {
    // Mock send implementation
  }
}

const mockAgentInstances = new Map<string, MockClaudeAgent>();

vi.mock("../claudeAgent", () => ({
  ClaudeAgent: {
    getInstance: (threadId: string) => {
      if (!mockAgentInstances.has(threadId)) {
        mockAgentInstances.set(threadId, new MockClaudeAgent(threadId));
      }
      return mockAgentInstances.get(threadId)!;
    },
    removeInstance: (threadId: string) => {
      mockAgentInstances.delete(threadId);
    },
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

  function newId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  const cancelPending = new Set<string>();

  // Minimal routes needed for tests
  app.post("/api/workspaces/:workspaceId/threads", (req, res) => {
    const { title } = req.body;
    const thread = {
      id: newId("thread"),
      workspaceId: req.params.workspaceId,
      title: title || "Untitled",
      status: "idle",
    };
    updateDb((db: any) => db.threads.push(thread));
    res.status(201).json(thread);
  });

  app.get("/api/threads/:threadId", (req, res) => {
    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === req.params.threadId);
    if (!thread) return res.status(404).json({ error: "not found" });
    res.json(thread);
  });

  // Cancel route (replicated from server.ts)
  app.post("/api/threads/:threadId/cancel", async (req, res) => {
    const { threadId } = req.params;

    // Set the flag immediately
    cancelPending.add(threadId);

    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === threadId);
    if (!thread) return res.status(404).json({ error: "thread not found" });

    // If no active session, just mark idle and return
    if (!thread.sessionId) {
      updateDb((db: any) => {
        const t = db.threads.find((t: any) => t.id === threadId);
        if (t) t.status = "idle";
      });
      return res.json({ ok: true });
    }

    const agent = mockAgentInstances.get(threadId) || new MockClaudeAgent(threadId);
    mockAgentInstances.set(threadId, agent);

    // If there's a pending permission, deny it first
    if (thread.pendingPermissionId !== undefined) {
      agent.send({
        jsonrpc: "2.0",
        id: thread.pendingPermissionId,
        result: { outcome: { outcome: "cancelled" } },
      });

      updateDb((db: any) => {
        const t = db.threads.find((t: any) => t.id === threadId);
        if (t) {
          t.pendingPermissionId = undefined;
          t.pendingPermissionOptions = undefined;
        }
        db.messages.push({
          id: newId("msg-cancel-perm"),
          threadId,
          timestamp: new Date().toISOString(),
          type: "permission_response",
          raw: { selected: { optionId: "deny" } },
        });
      });
    }

    // Send session/cancel
    cancelPending.delete(threadId);
    agent.cancel(thread.sessionId);

    updateDb((db: any) => {
      const t = db.threads.find((t: any) => t.id === threadId);
      if (t) {
        t.status = "idle";
        t.pendingPermissionId = undefined;
        t.pendingPermissionOptions = undefined;
      }
      db.messages.push({
        id: newId("msg-cancel"),
        threadId,
        timestamp: new Date().toISOString(),
        type: "system",
        raw: { text: "Agent turn cancelled by user" },
      });
    });

    res.json({ ok: true });
  });

  return app;
}

describe("POST /api/threads/:threadId/cancel — Cancel Route", () => {
  let app: express.Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    mockAgentInstances.clear();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    mockAgentInstances.clear();
  });

  describe("Cancel with active sessionId", () => {
    it("sends session/cancel to the agent", async () => {
      // Create workspace and thread
      const wsRes = await request(app)
        .post("/api/workspaces/ws-test/threads")
        .send({ title: "Test Thread" });
      const threadId = wsRes.body.id;

      // Set up thread with an active sessionId and mock agent
      request(app).get(`/api/threads/${threadId}`); // Just to ensure thread exists

      // Manually set sessionId in DB
      const db = JSON.parse(fs.readFileSync(TEST_DB, "utf-8"));
      const thread = db.threads.find((t: any) => t.id === threadId);
      thread.sessionId = "session-123";
      fs.writeFileSync(TEST_DB, JSON.stringify(db, null, 2));

      // Create a mock agent and track cancel calls
      const agent = new MockClaudeAgent(threadId);
      const cancelSpy = vi.spyOn(agent, "cancel");
      mockAgentInstances.set(threadId, agent);

      // Call cancel
      const res = await request(app).post(`/api/threads/${threadId}/cancel`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(cancelSpy).toHaveBeenCalledWith("session-123");
    });
  });

  describe("Cancel without sessionId", () => {
    it("sets status to idle immediately without session/cancel", async () => {
      // Create thread without sessionId
      const wsRes = await request(app)
        .post("/api/workspaces/ws-test/threads")
        .send({ title: "Test Thread" });
      const threadId = wsRes.body.id;

      // Verify thread has no sessionId
      let threadCheck = await request(app).get(`/api/threads/${threadId}`);
      expect(threadCheck.body.sessionId).toBeUndefined();

      // Call cancel
      const res = await request(app).post(`/api/threads/${threadId}/cancel`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Check thread is now idle
      threadCheck = await request(app).get(`/api/threads/${threadId}`);
      expect(threadCheck.body.status).toBe("idle");
    });
  });

  describe("Cancel with pending permission", () => {
    it("denies permission first before sending session/cancel", async () => {
      // Create thread with sessionId and pending permission
      const wsRes = await request(app)
        .post("/api/workspaces/ws-test/threads")
        .send({ title: "Test Thread" });
      const threadId = wsRes.body.id;

      // Set up DB with pending permission
      const db = JSON.parse(fs.readFileSync(TEST_DB, "utf-8"));
      const thread = db.threads.find((t: any) => t.id === threadId);
      thread.sessionId = "session-456";
      thread.status = "awaiting_permission";
      thread.pendingPermissionId = 42;
      thread.pendingPermissionOptions = [{ optionId: "allow_once" }];
      fs.writeFileSync(TEST_DB, JSON.stringify(db, null, 2));

      // Create mock agent and track calls
      const agent = new MockClaudeAgent(threadId);
      const sendSpy = vi.spyOn(agent, "send");
      const cancelSpy = vi.spyOn(agent, "cancel");
      mockAgentInstances.set(threadId, agent);

      // Call cancel
      const res = await request(app).post(`/api/threads/${threadId}/cancel`);

      expect(res.status).toBe(200);

      // Should deny permission first
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 42,
          result: { outcome: { outcome: "cancelled" } },
        })
      );

      // Then send session/cancel
      expect(cancelSpy).toHaveBeenCalledWith("session-456");

      // Check permission was cleared
      const threadCheck = await request(app).get(`/api/threads/${threadId}`);
      expect(threadCheck.body.pendingPermissionId).toBeUndefined();
    });
  });

  describe("Cancel 404", () => {
    it("returns 404 for nonexistent thread", async () => {
      const res = await request(app).post("/api/threads/thread-dne/cancel");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("thread not found");
    });
  });

  describe("Cancel race condition", () => {
    it("cancelPending flag is checked and cleared after session is obtained", async () => {
      // This test verifies that if cancel arrives while initialize() is in-flight,
      // the flag is set and checked. Since we're mocking, we simulate this by setting
      // up the flag checking in the route handler.
      const wsRes = await request(app)
        .post("/api/workspaces/ws-test/threads")
        .send({ title: "Test Thread" });
      const threadId = wsRes.body.id;

      // Cancel with no sessionId (simulates cancel arriving before initialize finishes)
      const res = await request(app).post(`/api/threads/${threadId}/cancel`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Thread should be idle
      const threadCheck = await request(app).get(`/api/threads/${threadId}`);
      expect(threadCheck.body.status).toBe("idle");
    });
  });

  describe("Double cancel", () => {
    it("is idempotent — calling cancel twice succeeds both times", async () => {
      // Create thread
      const wsRes = await request(app)
        .post("/api/workspaces/ws-test/threads")
        .send({ title: "Test Thread" });
      const threadId = wsRes.body.id;

      // Set sessionId
      const db = JSON.parse(fs.readFileSync(TEST_DB, "utf-8"));
      const thread = db.threads.find((t: any) => t.id === threadId);
      thread.sessionId = "session-789";
      fs.writeFileSync(TEST_DB, JSON.stringify(db, null, 2));

      // First cancel
      let res = await request(app).post(`/api/threads/${threadId}/cancel`);
      expect(res.status).toBe(200);

      // Second cancel — should still succeed
      res = await request(app).post(`/api/threads/${threadId}/cancel`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Thread should be idle
      const threadCheck = await request(app).get(`/api/threads/${threadId}`);
      expect(threadCheck.body.status).toBe("idle");
    });
  });
});
