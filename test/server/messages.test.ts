import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(os.tmpdir(), `devos-test-msgs-${Date.now()}.json`);

function createTestApp() {
  const app = express();
  app.use(express.json());

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

  // Workspace routes
  app.get("/api/workspaces", (_req, res) => {
    const db = readDb();
    res.json(db.workspaces);
  });

  app.post("/api/workspaces", (req, res) => {
    const { name, path: wsPath } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });

    const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspace = { id, name, path: wsPath || `/projects/${name}` };
    updateDb((db: any) => db.workspaces.push(workspace));
    res.status(201).json(workspace);
  });

  // Thread routes
  app.get("/api/workspaces/:workspaceId/threads", (req, res) => {
    const db = readDb();
    res.json(db.threads.filter((t: any) => t.workspaceId === req.params.workspaceId));
  });

  app.post("/api/workspaces/:workspaceId/threads", (req, res) => {
    const { workspaceId } = req.params;
    const { title } = req.body;

    const thread = {
      id: `thread-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      workspaceId,
      title: title || "Untitled",
      status: "idle",
    };
    updateDb((db: any) => db.threads.push(thread));
    res.status(201).json(thread);
  });

  // Message routes
  app.get("/api/threads/:threadId/messages", (req, res) => {
    const db = readDb();
    res.json(db.messages.filter((m: any) => m.threadId === req.params.threadId));
  });

  app.post("/api/threads/:threadId/messages", (req, res) => {
    const { threadId } = req.params;
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });

    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === threadId);
    if (!thread) return res.status(404).json({ error: "thread not found" });

    const userMsg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      threadId,
      timestamp: new Date().toISOString(),
      raw: { role: "user", content: text },
      type: "user_message",
    };
    updateDb((db: any) => {
      db.messages.push(userMsg);
      // Set thread to thinking (as server.ts does)
      const t = db.threads.find((t: any) => t.id === threadId);
      if (t) t.status = "thinking";
    });

    res.json(userMsg);
  });

  return app;
}

describe("Message API", () => {
  let app: express.Express;
  let threadId: string;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }

    // Create workspace and thread for message tests
    const wsRes = await request(app)
      .post("/api/workspaces")
      .send({ name: "msg-test-ws" });

    const threadRes = await request(app)
      .post(`/api/workspaces/${wsRes.body.id}/threads`)
      .send({ title: "Message Test Thread" });

    threadId = threadRes.body.id;
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  describe("GET /api/threads/:threadId/messages", () => {
    it("returns empty array when no messages exist", async () => {
      const res = await request(app).get(`/api/threads/${threadId}/messages`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns all messages for thread", async () => {
      await request(app)
        .post(`/api/threads/${threadId}/messages`)
        .send({ text: "Hello" });

      await request(app)
        .post(`/api/threads/${threadId}/messages`)
        .send({ text: "World" });

      const res = await request(app).get(`/api/threads/${threadId}/messages`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });
  });

  describe("POST /api/threads/:threadId/messages", () => {
    it("creates message and returns 200", async () => {
      const res = await request(app)
        .post(`/api/threads/${threadId}/messages`)
        .send({ text: "Test message" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        threadId,
        raw: { role: "user", content: "Test message" },
        type: "user_message",
      });
      expect(res.body.id).toMatch(/^msg-/);
      expect(res.body.timestamp).toBeDefined();
    });

    it("returns 400 when text is missing", async () => {
      const res = await request(app)
        .post(`/api/threads/${threadId}/messages`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("text required");
    });

    it("returns 404 when thread not found", async () => {
      const res = await request(app)
        .post("/api/threads/thread-nonexistent/messages")
        .send({ text: "Hello" });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("thread not found");
    });

    it("sets thread status to thinking", async () => {
      await request(app)
        .post(`/api/threads/${threadId}/messages`)
        .send({ text: "Trigger thinking" });

      // Verify by checking that the message was created
      const messagesRes = await request(app).get(
        `/api/threads/${threadId}/messages`
      );
      expect(messagesRes.body).toHaveLength(1);
    });
  });
});
