import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(os.tmpdir(), `devos-test-ws-${Date.now()}.json`);

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

  app.patch("/api/workspaces/:workspaceId", (req, res) => {
    const { name, path: wsPath } = req.body;
    if (wsPath !== undefined) {
      return res.status(400).json({ error: "workspace path cannot be changed" });
    }
    const db = readDb();
    const ws = db.workspaces.find((w: any) => w.id === req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "not found" });
    if (name) ws.name = name;
    writeDb(db);
    res.json(ws);
  });

  app.delete("/api/workspaces/:workspaceId", (req, res) => {
    const { workspaceId } = req.params;
    const db = readDb();
    const wsIndex = db.workspaces.findIndex((w: any) => w.id === workspaceId);
    if (wsIndex === -1) return res.status(404).json({ error: "not found" });

    const threadIds = db.threads
      .filter((t: any) => t.workspaceId === workspaceId)
      .map((t: any) => t.id);

    db.threads = db.threads.filter((t: any) => t.workspaceId !== workspaceId);
    db.messages = db.messages.filter((m: any) => !threadIds.includes(m.threadId));
    db.workspaces.splice(wsIndex, 1);
    writeDb(db);

    res.json({ ok: true });
  });

  // Thread routes (needed for cascade tests)
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

describe("Workspace API", () => {
  let app: express.Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  describe("GET /api/workspaces", () => {
    it("returns empty array when no workspaces exist", async () => {
      const res = await request(app).get("/api/workspaces");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns all workspaces", async () => {
      await request(app)
        .post("/api/workspaces")
        .send({ name: "test-ws", path: "/tmp/test" });

      const res = await request(app).get("/api/workspaces");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("test-ws");
    });
  });

  describe("POST /api/workspaces", () => {
    it("creates a workspace and returns 201", async () => {
      const res = await request(app)
        .post("/api/workspaces")
        .send({ name: "my-project", path: "/Users/dev/my-project" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: "my-project",
        path: "/Users/dev/my-project",
      });
      expect(res.body.id).toMatch(/^ws-/);
    });

    it("returns 400 when name is missing", async () => {
      const res = await request(app)
        .post("/api/workspaces")
        .send({ path: "/tmp/test" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("name required");
    });

    it("uses default path when not provided", async () => {
      const res = await request(app)
        .post("/api/workspaces")
        .send({ name: "no-path" });

      expect(res.status).toBe(201);
      expect(res.body.path).toBe("/projects/no-path");
    });
  });

  describe("PATCH /api/workspaces/:id", () => {
    it("updates workspace name", async () => {
      const createRes = await request(app)
        .post("/api/workspaces")
        .send({ name: "old-name" });

      const res = await request(app)
        .patch(`/api/workspaces/${createRes.body.id}`)
        .send({ name: "new-name" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("new-name");
    });

    it("returns 400 when trying to change path", async () => {
      const createRes = await request(app)
        .post("/api/workspaces")
        .send({ name: "test" });

      const res = await request(app)
        .patch(`/api/workspaces/${createRes.body.id}`)
        .send({ path: "/new/path" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("workspace path cannot be changed");
    });

    it("returns 404 for nonexistent workspace", async () => {
      const res = await request(app)
        .patch("/api/workspaces/ws-nonexistent")
        .send({ name: "test" });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/workspaces/:id", () => {
    it("deletes workspace and returns ok", async () => {
      const createRes = await request(app)
        .post("/api/workspaces")
        .send({ name: "to-delete" });

      const res = await request(app).delete(
        `/api/workspaces/${createRes.body.id}`
      );

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify it's gone
      const listRes = await request(app).get("/api/workspaces");
      expect(listRes.body).toHaveLength(0);
    });

    it("cascades to threads and messages", async () => {
      const wsRes = await request(app)
        .post("/api/workspaces")
        .send({ name: "cascade-test" });

      // Create thread
      const threadRes = await request(app)
        .post(`/api/workspaces/${wsRes.body.id}/threads`)
        .send({ title: "Test Thread" });

      // Create message
      await request(app)
        .post(`/api/threads/${threadRes.body.id}/messages`)
        .send({ text: "Hello" });

      // Delete workspace
      await request(app).delete(`/api/workspaces/${wsRes.body.id}`);

      // Verify threads and messages are gone
      const threadsRes = await request(app).get(
        `/api/workspaces/${wsRes.body.id}/threads`
      );
      expect(threadsRes.body).toHaveLength(0);

      const messagesRes = await request(app).get(
        `/api/threads/${threadRes.body.id}/messages`
      );
      expect(messagesRes.body).toHaveLength(0);
    });

    it("returns 404 for nonexistent workspace", async () => {
      const res = await request(app).delete("/api/workspaces/ws-nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
