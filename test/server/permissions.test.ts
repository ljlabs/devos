import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(os.tmpdir(), `devos-test-perm-${Date.now()}.json`);

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

  app.get("/api/threads/:threadId", (req, res) => {
    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === req.params.threadId);
    if (!thread) return res.status(404).json({ error: "not found" });
    res.json(thread);
  });

  // Permission response route
  app.post("/api/threads/:threadId/respond", (req, res) => {
    const { threadId } = req.params;
    const { optionId } = req.body;
    if (!optionId) return res.status(400).json({ error: "optionId required" });

    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === threadId);
    if (!thread) return res.status(404).json({ error: "thread not found" });
    if (thread.pendingPermissionId === undefined) {
      return res.status(400).json({ error: "no pending permission" });
    }

    updateDb((db: any) => {
      const t = db.threads.find((t: any) => t.id === threadId);
      if (t) {
        t.status = "thinking";
        t.pendingPermissionId = undefined;
        t.pendingPermissionOptions = undefined;
      }
      db.messages.push({
        id: `msg-perm-${Date.now()}`,
        threadId,
        timestamp: new Date().toISOString(),
        type: "permission_response",
        raw: { selected: { optionId } },
      });
    });

    res.json({ ok: true });
  });

  return app;
}

describe("Permission API", () => {
  let app: express.Express;
  let threadId: string;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }

    // Create workspace and thread
    const wsRes = await request(app)
      .post("/api/workspaces")
      .send({ name: "perm-test-ws" });

    const threadRes = await request(app)
      .post(`/api/workspaces/${wsRes.body.id}/threads`)
      .send({ title: "Permission Test Thread" });

    threadId = threadRes.body.id;
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  describe("POST /api/threads/:threadId/respond", () => {
    it("returns 400 when optionId is missing", async () => {
      const res = await request(app)
        .post(`/api/threads/${threadId}/respond`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("optionId required");
    });

    it("returns 404 for nonexistent thread", async () => {
      const res = await request(app)
        .post("/api/threads/thread-nonexistent/respond")
        .send({ optionId: "allow_once" });

      expect(res.status).toBe(404);
    });

    it("returns 400 when no pending permission", async () => {
      const res = await request(app)
        .post(`/api/threads/${threadId}/respond`)
        .send({ optionId: "allow_once" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("no pending permission");
    });

    it("accepts response when permission is pending", async () => {
      // Simulate a pending permission by directly updating the DB
      const dbPath = path.join(
        os.tmpdir(),
        // Get the test DB path from the app
      );
      // We need to read the actual DB file to set up the pending state
      const dbFiles = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith("devos-test-perm-"));
      const dbFile = dbFiles[dbFiles.length - 1];
      const dbPathFull = path.join(os.tmpdir(), dbFile);

      const db = JSON.parse(fs.readFileSync(dbPathFull, "utf-8"));
      const thread = db.threads.find((t: any) => t.id === threadId);
      thread.status = "awaiting_permission";
      thread.pendingPermissionId = 12345;
      thread.pendingPermissionOptions = [
        { optionId: "allow_once", kind: "allow_once", label: "Allow" },
        { optionId: "deny", kind: "deny", label: "Deny" },
      ];
      fs.writeFileSync(dbPathFull, JSON.stringify(db, null, 2));

      // Now respond
      const res = await request(app)
        .post(`/api/threads/${threadId}/respond`)
        .send({ optionId: "allow_once" });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify thread state is updated
      const threadRes = await request(app).get(`/api/threads/${threadId}`);
      expect(threadRes.body.status).toBe("thinking");
      expect(threadRes.body.pendingPermissionId).toBeUndefined();
    });

    it("records permission response as a message", async () => {
      // Set up pending state
      const dbFiles = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith("devos-test-perm-"));
      const dbFile = dbFiles[dbFiles.length - 1];
      const dbPathFull = path.join(os.tmpdir(), dbFile);

      const db = JSON.parse(fs.readFileSync(dbPathFull, "utf-8"));
      const thread = db.threads.find((t: any) => t.id === threadId);
      thread.status = "awaiting_permission";
      thread.pendingPermissionId = 99999;
      thread.pendingPermissionOptions = [
        { optionId: "allow_once", kind: "allow_once", label: "Allow" },
      ];
      fs.writeFileSync(dbPathFull, JSON.stringify(db, null, 2));

      // Respond
      await request(app)
        .post(`/api/threads/${threadId}/respond`)
        .send({ optionId: "allow_once" });

      // Check that a message was recorded
      const dbAfter = JSON.parse(fs.readFileSync(dbPathFull, "utf-8"));
      const permMsg = dbAfter.messages.find(
        (m: any) => m.type === "permission_response"
      );
      expect(permMsg).toBeDefined();
      expect(permMsg.raw.selected.optionId).toBe("allow_once");
    });
  });
});
