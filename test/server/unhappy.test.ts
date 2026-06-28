import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(os.tmpdir(), `devos-test-unhappy-${Date.now()}.json`);

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: "1mb", strict: false }));

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

  // Workspace routes
  app.get("/api/workspaces", (_req, res) => {
    const db = readDb();
    res.json(db.workspaces);
  });

  app.post("/api/workspaces", (req, res) => {
    const { name, path: wsPath } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "name required" });
    const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspace = { id, name: name.trim(), path: wsPath || `/projects/${name}` };
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
    const db = readDb();
    const wsIndex = db.workspaces.findIndex((w: any) => w.id === req.params.workspaceId);
    if (wsIndex === -1) return res.status(404).json({ error: "not found" });
    const threadIds = db.threads.filter((t: any) => t.workspaceId === req.params.workspaceId).map((t: any) => t.id);
    db.threads = db.threads.filter((t: any) => t.workspaceId !== req.params.workspaceId);
    db.messages = db.messages.filter((m: any) => !threadIds.includes(m.threadId));
    db.workspaces.splice(wsIndex, 1);
    writeDb(db);
    res.json({ ok: true });
  });

  // Thread routes
  app.get("/api/workspaces/:workspaceId/threads", (req, res) => {
    const db = readDb();
    res.json(db.threads.filter((t: any) => t.workspaceId === req.params.workspaceId));
  });

  app.post("/api/workspaces/:workspaceId/threads", (req, res) => {
    const { title } = req.body;
    const thread = {
      id: `thread-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === req.params.threadId);
    if (!thread) return res.status(404).json({ error: "not found" });
    db.threads = db.threads.filter((t: any) => t.id !== req.params.threadId);
    db.messages = db.messages.filter((m: any) => m.threadId !== req.params.threadId);
    writeDb(db);
    res.json({ ok: true });
  });

  // Message routes
  app.get("/api/threads/:threadId/messages", (req, res) => {
    const db = readDb();
    res.json(db.messages.filter((m: any) => m.threadId === req.params.threadId));
  });

  app.post("/api/threads/:threadId/messages", (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "text required" });
    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === req.params.threadId);
    if (!thread) return res.status(404).json({ error: "thread not found" });
    const userMsg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      threadId: req.params.threadId,
      timestamp: new Date().toISOString(),
      raw: { role: "user", content: text },
      type: "user_message",
    };
    updateDb((db: any) => {
      db.messages.push(userMsg);
      const t = db.threads.find((t: any) => t.id === req.params.threadId);
      if (t) t.status = "thinking";
    });
    res.json(userMsg);
  });

  // Permission routes
  app.post("/api/threads/:threadId/respond", (req, res) => {
    const { optionId } = req.body;
    if (!optionId) return res.status(400).json({ error: "optionId required" });
    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === req.params.threadId);
    if (!thread) return res.status(404).json({ error: "thread not found" });
    if (thread.pendingPermissionId === undefined) {
      return res.status(400).json({ error: "no pending permission" });
    }
    updateDb((db: any) => {
      const t = db.threads.find((t: any) => t.id === req.params.threadId);
      if (t) {
        t.status = "thinking";
        t.pendingPermissionId = undefined;
        t.pendingPermissionOptions = undefined;
      }
      db.messages.push({
        id: `msg-perm-${Date.now()}`,
        threadId: req.params.threadId,
        timestamp: new Date().toISOString(),
        type: "permission_response",
        raw: { selected: { optionId } },
      });
    });
    res.json({ ok: true });
  });

  // ACP pass-through route
  app.post("/api/threads/:threadId/acp", (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "valid JSON-RPC body required" });
    }
    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === req.params.threadId);
    if (!thread) return res.status(404).json({ error: "thread not found" });
    res.json({ ok: true });
  });

  return app;
}

describe("Unhappy Path — Server API", () => {
  let app: express.Express;

  beforeAll(() => { app = createTestApp(); });

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  // ── Workspace ──────────────────────────────────────────────────────────

  describe("POST /api/workspaces — input validation", () => {
    it("rejects missing name", async () => {
      const res = await request(app).post("/api/workspaces").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("name required");
    });

    it("rejects empty string name", async () => {
      const res = await request(app).post("/api/workspaces").send({ name: "" });
      expect(res.status).toBe(400);
    });

    it("rejects whitespace-only name", async () => {
      const res = await request(app).post("/api/workspaces").send({ name: "   " });
      expect(res.status).toBe(400);
    });

    it("rejects no body at all", async () => {
      const res = await request(app).post("/api/workspaces");
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/workspaces/:id — edge cases", () => {
    it("rejects path change", async () => {
      const create = await request(app).post("/api/workspaces").send({ name: "ws" });
      const res = await request(app).patch(`/api/workspaces/${create.body.id}`).send({ path: "/hacked" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("path cannot be changed");
    });

    it("404 for nonexistent workspace", async () => {
      const res = await request(app).patch("/api/workspaces/ws-dne").send({ name: "x" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/workspaces/:id — cascading", () => {
    it("cascade deletes threads and messages", async () => {
      const ws = await request(app).post("/api/workspaces").send({ name: "cascade" });
      const t1 = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T1" });
      const t2 = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T2" });
      await request(app).post(`/api/threads/${t1.body.id}/messages`).send({ text: "msg1" });
      await request(app).post(`/api/threads/${t2.body.id}/messages`).send({ text: "msg2" });

      await request(app).delete(`/api/workspaces/${ws.body.id}`);

      const threads = await request(app).get(`/api/workspaces/${ws.body.id}/threads`);
      expect(threads.body).toHaveLength(0);
      const msgs1 = await request(app).get(`/api/threads/${t1.body.id}/messages`);
      expect(msgs1.body).toHaveLength(0);
      const msgs2 = await request(app).get(`/api/threads/${t2.body.id}/messages`);
      expect(msgs2.body).toHaveLength(0);
    });
  });

  // ── Thread ─────────────────────────────────────────────────────────────

  describe("POST /api/workspaces/:id/threads — edge cases", () => {
    it("creates thread in workspace that does not exist yet", async () => {
      const res = await request(app)
        .post("/api/workspaces/ws-nonexistent/threads")
        .send({ title: "Orphan" });
      expect(res.status).toBe(201);
      expect(res.body.workspaceId).toBe("ws-nonexistent");
    });
  });

  describe("PATCH /api/threads/:id — edge cases", () => {
    it("rejects empty title", async () => {
      const ws = await request(app).post("/api/workspaces").send({ name: "ws" });
      const t = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T" });
      const res = await request(app).patch(`/api/threads/${t.body.id}`).send({ title: "" });
      expect(res.status).toBe(400);
    });

    it("404 for nonexistent thread", async () => {
      const res = await request(app).patch("/api/threads/thread-dne").send({ title: "x" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/threads/:id — cascading", () => {
    it("cascade deletes messages", async () => {
      const ws = await request(app).post("/api/workspaces").send({ name: "ws" });
      const t = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T" });
      await request(app).post(`/api/threads/${t.body.id}/messages`).send({ text: "m1" });
      await request(app).post(`/api/threads/${t.body.id}/messages`).send({ text: "m2" });

      await request(app).delete(`/api/threads/${t.body.id}`);

      const msgs = await request(app).get(`/api/threads/${t.body.id}/messages`);
      expect(msgs.body).toHaveLength(0);
    });

    it("404 for nonexistent thread", async () => {
      const res = await request(app).delete("/api/threads/thread-dne");
      expect(res.status).toBe(404);
    });
  });

  // ── Messages ───────────────────────────────────────────────────────────

  describe("POST /api/threads/:id/messages — input validation", () => {
    it("rejects missing text", async () => {
      const ws = await request(app).post("/api/workspaces").send({ name: "ws" });
      const t = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T" });
      const res = await request(app).post(`/api/threads/${t.body.id}/messages`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("text required");
    });

    it("rejects empty string text", async () => {
      const ws = await request(app).post("/api/workspaces").send({ name: "ws" });
      const t = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T" });
      const res = await request(app).post(`/api/threads/${t.body.id}/messages`).send({ text: "" });
      expect(res.status).toBe(400);
    });

    it("rejects whitespace-only text", async () => {
      const ws = await request(app).post("/api/workspaces").send({ name: "ws" });
      const t = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T" });
      const res = await request(app).post(`/api/threads/${t.body.id}/messages`).send({ text: "   " });
      expect(res.status).toBe(400);
    });

    it("404 for nonexistent thread", async () => {
      const res = await request(app).post("/api/threads/thread-dne/messages").send({ text: "hello" });
      expect(res.status).toBe(404);
    });
  });

  // ── Permissions ────────────────────────────────────────────────────────

  describe("POST /api/threads/:id/respond — state guards", () => {
    it("rejects missing optionId", async () => {
      const res = await request(app).post("/api/threads/any/respond").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("optionId required");
    });

    it("rejects when no pending permission", async () => {
      const ws = await request(app).post("/api/workspaces").send({ name: "ws" });
      const t = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T" });
      const res = await request(app).post(`/api/threads/${t.body.id}/respond`).send({ optionId: "allow_once" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("no pending permission");
    });

    it("404 for nonexistent thread", async () => {
      const res = await request(app).post("/api/threads/thread-dne/respond").send({ optionId: "allow_once" });
      expect(res.status).toBe(404);
    });

    it("responding clears pending state and sets status to thinking", async () => {
      const ws = await request(app).post("/api/workspaces").send({ name: "ws" });
      const t = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T" });

      // Simulate pending permission via direct DB manipulation
      const db = JSON.parse(fs.readFileSync(TEST_DB, "utf-8"));
      const thread = db.threads.find((th: any) => th.id === t.body.id);
      thread.status = "awaiting_permission";
      thread.pendingPermissionId = 99;
      thread.pendingPermissionOptions = [{ optionId: "allow_once" }];
      fs.writeFileSync(TEST_DB, JSON.stringify(db, null, 2));

      await request(app).post(`/api/threads/${t.body.id}/respond`).send({ optionId: "allow_once" });

      const updated = await request(app).get(`/api/threads/${t.body.id}`);
      expect(updated.body.status).toBe("thinking");
      expect(updated.body.pendingPermissionId).toBeUndefined();
    });
  });

  // ── ACP pass-through ───────────────────────────────────────────────────

  describe("POST /api/threads/:id/acp — validation", () => {
    it("rejects non-object body (string)", async () => {
      const ws = await request(app).post("/api/workspaces").send({ name: "ws" });
      const t = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T" });
      const res = await request(app)
        .post(`/api/threads/${t.body.id}/acp`)
        .set("Content-Type", "application/json")
        .send(JSON.stringify("just a string"));
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("valid JSON-RPC");
    });

    it("rejects non-object body (array)", async () => {
      const ws = await request(app).post("/api/workspaces").send({ name: "ws" });
      const t = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T" });
      const res = await request(app)
        .post(`/api/threads/${t.body.id}/acp`)
        .send([1, 2, 3]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("valid JSON-RPC body");
    });

    it("rejects non-object body (number)", async () => {
      const ws = await request(app).post("/api/workspaces").send({ name: "ws" });
      const t = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T" });
      const res = await request(app)
        .post(`/api/threads/${t.body.id}/acp`)
        .set("Content-Type", "application/json")
        .send("42");
      expect(res.status).toBe(400);
    });

    it("404 for nonexistent thread", async () => {
      const res = await request(app)
        .post("/api/threads/thread-dne/acp")
        .send({ jsonrpc: "2.0", method: "test" });
      expect(res.status).toBe(404);
    });

    it("accepts valid JSON-RPC body", async () => {
      const ws = await request(app).post("/api/workspaces").send({ name: "ws" });
      const t = await request(app).post(`/api/workspaces/${ws.body.id}/threads`).send({ title: "T" });
      const res = await request(app)
        .post(`/api/threads/${t.body.id}/acp`)
        .send({ jsonrpc: "2.0", method: "custom/test", params: {} });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  // ── Nonexistent endpoints ──────────────────────────────────────────────

  describe("Nonexistent endpoints", () => {
    it("returns 404 for unknown GET route", async () => {
      const res = await request(app).get("/api/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
