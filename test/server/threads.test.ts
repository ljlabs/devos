import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(os.tmpdir(), `devos-test-threads-${Date.now()}.json`);

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

  // Workspace routes (needed to create test workspaces)
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

  app.get("/api/threads/:threadId", (req, res) => {
    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === req.params.threadId);
    if (!thread) return res.status(404).json({ error: "not found" });
    res.json(thread);
  });

  app.patch("/api/threads/:threadId", (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: "title required" });
    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === req.params.threadId);
    if (!thread) return res.status(404).json({ error: "not found" });
    thread.title = title;
    writeDb(db);
    res.json(thread);
  });

  app.delete("/api/threads/:threadId", (req, res) => {
    const { threadId } = req.params;
    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === threadId);
    if (!thread) return res.status(404).json({ error: "not found" });

    db.threads = db.threads.filter((t: any) => t.id !== threadId);
    db.messages = db.messages.filter((m: any) => m.threadId !== threadId);
    writeDb(db);

    res.json({ ok: true });
  });

  // Message routes (needed for cascade tests)
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
    });

    res.json(userMsg);
  });

  return app;
}

describe("Thread API", () => {
  let app: express.Express;
  let wsId: string;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
    // Create a workspace for thread tests
    const res = await request(app)
      .post("/api/workspaces")
      .send({ name: "test-ws" });
    wsId = res.body.id;
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  describe("POST /api/workspaces/:workspaceId/threads", () => {
    it("creates a thread and returns 201", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${wsId}/threads`)
        .send({ title: "My Thread" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        workspaceId: wsId,
        title: "My Thread",
        status: "idle",
      });
      expect(res.body.id).toMatch(/^thread-/);
    });

    it("uses default title when not provided", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${wsId}/threads`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Untitled");
    });
  });

  describe("GET /api/workspaces/:workspaceId/threads", () => {
    it("returns threads for workspace", async () => {
      await request(app)
        .post(`/api/workspaces/${wsId}/threads`)
        .send({ title: "Thread 1" });

      await request(app)
        .post(`/api/workspaces/${wsId}/threads`)
        .send({ title: "Thread 2" });

      const res = await request(app).get(`/api/workspaces/${wsId}/threads`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("returns empty array for workspace with no threads", async () => {
      const res = await request(app).get(`/api/workspaces/${wsId}/threads`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });

  describe("GET /api/threads/:threadId", () => {
    it("returns thread by id", async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${wsId}/threads`)
        .send({ title: "Find Me" });

      const res = await request(app).get(`/api/threads/${createRes.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Find Me");
    });

    it("returns 404 for nonexistent thread", async () => {
      const res = await request(app).get("/api/threads/thread-nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/threads/:threadId", () => {
    it("updates thread title", async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${wsId}/threads`)
        .send({ title: "Old Title" });

      const res = await request(app)
        .patch(`/api/threads/${createRes.body.id}`)
        .send({ title: "New Title" });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("New Title");
    });

    it("returns 400 when title is missing", async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${wsId}/threads`)
        .send({ title: "Test" });

      const res = await request(app)
        .patch(`/api/threads/${createRes.body.id}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("title required");
    });

    it("returns 404 for nonexistent thread", async () => {
      const res = await request(app)
        .patch("/api/threads/thread-nonexistent")
        .send({ title: "Test" });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/threads/:threadId", () => {
    it("deletes thread and returns ok", async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${wsId}/threads`)
        .send({ title: "To Delete" });

      const res = await request(app).delete(
        `/api/threads/${createRes.body.id}`
      );

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify it's gone
      const getRes = await request(app).get(
        `/api/threads/${createRes.body.id}`
      );
      expect(getRes.status).toBe(404);
    });

    it("cascades to messages", async () => {
      const threadRes = await request(app)
        .post(`/api/workspaces/${wsId}/threads`)
        .send({ title: "With Messages" });

      // Create message
      await request(app)
        .post(`/api/threads/${threadRes.body.id}/messages`)
        .send({ text: "Hello" });

      // Delete thread
      await request(app).delete(`/api/threads/${threadRes.body.id}`);

      // Verify messages are gone
      const messagesRes = await request(app).get(
        `/api/threads/${threadRes.body.id}/messages`
      );
      expect(messagesRes.body).toHaveLength(0);
    });

    it("returns 404 for nonexistent thread", async () => {
      const res = await request(app).delete("/api/threads/thread-nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
