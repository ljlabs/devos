/**
 * server.ts
 *
 * Thin HTTP router over ACP subprocesses.
 *
 * Responsibilities:
 *   - Express routes
 *   - db.json persistence (raw ACP messages stored as-is)
 *   - Wire ClaudeAgent "message" events → db writes + SSE (if you add it later)
 *
 * NOT the responsibility of this file:
 *   - Any translation of ACP messages
 *   - Any permission logic
 *   - Any interpretation of tool calls / results
 */

import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { ClaudeAgent } from "./claudeAgent";
import { DatabaseSchema, Workspace, Thread, Message } from "./src/types";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const DB_FILE = path.join(process.cwd(), "db.json");
const WORKSPACES_DIR = path.join(process.cwd(), "sandbox_workspaces");

app.use(express.json());

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

const defaultDb: DatabaseSchema = {
  workspaces: [
    { id: "ws-auth", name: "frontend-auth", path: "/Users/developer/projects/frontend-auth" },
    { id: "ws-api",  name: "api-gateway",   path: "/Users/developer/projects/api-gateway" },
    { id: "ws-docs", name: "docs-site",      path: "/Users/developer/projects/docs-site" },
  ],
  threads: [],
  messages: [],
};

function readDb(): DatabaseSchema {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
      return defaultDb;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch {
    return defaultDb;
  }
}

function writeDb(data: DatabaseSchema): void {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function updateDb(fn: (db: DatabaseSchema) => void): void {
  const db = readDb();
  fn(db);
  writeDb(db);
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Workspace scaffolding
// ---------------------------------------------------------------------------

if (!fs.existsSync(WORKSPACES_DIR)) fs.mkdirSync(WORKSPACES_DIR, { recursive: true });

function ensureWorkspace(workspaceId: string, name: string): string {
  const wsPath = path.join(WORKSPACES_DIR, workspaceId);
  if (!fs.existsSync(wsPath)) fs.mkdirSync(wsPath, { recursive: true });

  if (fs.readdirSync(wsPath).length === 0) {
    fs.writeFileSync(path.join(wsPath, "package.json"), JSON.stringify({
      name: name.toLowerCase().replace(/\s+/g, "-"), version: "1.0.0", dependencies: {},
    }, null, 2));
    fs.writeFileSync(path.join(wsPath, "README.md"), `# ${name}\n`);
  }

  return wsPath;
}

// ---------------------------------------------------------------------------
// Wire an agent's raw ACP messages into the DB for a thread
// ---------------------------------------------------------------------------

function wireAgent(agent: ClaudeAgent, threadId: string): void {
  if (agent.listenerCount("message") > 0) return; // already wired

  agent.on("message", (raw: any) => {
    updateDb((db) => {
      // Store the raw ACP message verbatim
      const msg: Message = {
        id: newId("msg"),
        threadId,
        timestamp: new Date().toISOString(),
        raw,
        type: raw.method ?? (raw.result !== undefined ? "response" : "unknown"),
      };
      db.messages.push(msg);

      // Keep thread.sessionId updated if ACP tells us
      const sessionId =
        raw.params?.sessionId ??
        raw.result?.sessionId ??
        raw.params?.update?.sessionId;
      if (sessionId) {
        const t = db.threads.find((t) => t.id === threadId);
        if (t) t.sessionId = sessionId;
      }

      // Track whether the thread is waiting for permission
      const thread = db.threads.find((t) => t.id === threadId);
      if (thread) {
        if (raw.method === "session/request_permission") {
          thread.status = "awaiting_permission";
          // Store the pending permission request id and options so we can respond
          thread.pendingPermissionId = raw.id;
          thread.pendingPermissionOptions = raw.params?.options ?? [];
        } else if (raw.method === "session/update") {
          // Auto-update thread title from session_info_update
          const update = raw.params?.update;
          if (update?.sessionUpdate === "session_info_update" && update?.title) {
            thread.title = update.title;
          }
          // After tool execution completes, permission is no longer pending
          thread.status = "idle";
          thread.pendingPermissionId = undefined;
          thread.pendingPermissionOptions = undefined;
        }
      }
    });
  });

  agent.on("close", () => {
    updateDb((db) => {
      const t = db.threads.find((t) => t.id === threadId);
      if (t) t.status = "idle";
    });
  });
}

// ---------------------------------------------------------------------------
// Routes — Workspaces
// ---------------------------------------------------------------------------

app.get("/api/workspaces", (_req, res) => {
  const db = readDb();
  db.workspaces.forEach((ws) => ensureWorkspace(ws.id, ws.name));
  res.json(db.workspaces);
});

app.post("/api/workspaces", (req, res) => {
  const { name, path: wsPath } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });

  const id = `ws-${Date.now()}`;
  const workspace: Workspace = { id, name, path: wsPath || `/projects/${name}` };
  updateDb((db) => db.workspaces.push(workspace));
  ensureWorkspace(id, name);
  res.status(201).json(workspace);
});

// ---------------------------------------------------------------------------
// Routes — Threads
// ---------------------------------------------------------------------------

app.get("/api/workspaces/:workspaceId/threads", (req, res) => {
  const db = readDb();
  res.json(db.threads.filter((t) => t.workspaceId === req.params.workspaceId));
});

app.post("/api/workspaces/:workspaceId/threads", (req, res) => {
  const { workspaceId } = req.params;
  const { title } = req.body;
  // title is optional now - will be set from ACP session_info_update

  const thread: Thread = {
    id: `thread-${Date.now()}`,
    workspaceId,
    title: title || "Untitled", // placeholder until ACP sets it
    status: "idle",
  };
  updateDb((db) => db.threads.push(thread));
  res.status(201).json(thread);
});

app.get("/api/threads/:threadId", (req, res) => {
  const db = readDb();
  const thread = db.threads.find((t) => t.id === req.params.threadId);
  if (!thread) return res.status(404).json({ error: "not found" });
  res.json(thread);
});

// ---------------------------------------------------------------------------
// Routes — Messages
// ---------------------------------------------------------------------------

app.get("/api/threads/:threadId/messages", (req, res) => {
  const db = readDb();
  res.json(db.messages.filter((m) => m.threadId === req.params.threadId));
});

/**
 * POST /api/threads/:threadId/messages
 * Body: { text: string }
 *
 * 1. Persist the user prompt.
 * 2. Respond immediately with the message.
 * 3. Async: Initialize/resume the ACP session and fire session/prompt.
 *    All responses will come through the "message" event → db → UI polling.
 */
app.post("/api/threads/:threadId/messages", async (req, res) => {
  const { threadId } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  const db = readDb();
  const thread = db.threads.find((t) => t.id === threadId);
  if (!thread) return res.status(404).json({ error: "thread not found" });

  // Look up the workspace to get its path
  const workspace = db.workspaces.find((ws) => ws.id === thread.workspaceId);
  const wsPath = workspace?.path || thread.workspaceId;

  // Persist user message as raw ACP-style object
  const userMsg: Message = {
    id: newId("msg-user"),
    threadId,
    timestamp: new Date().toISOString(),
    raw: { role: "user", content: text },
    type: "user_message",
  };
  updateDb((db) => {
    db.messages.push(userMsg);
    const t = db.threads.find((t) => t.id === threadId);
    if (t) t.status = "thinking";
  });

  res.json(userMsg);

  // Async: boot/resume agent and send prompt
  (async () => {
    try {
      const agent = ClaudeAgent.getInstance(threadId, wsPath);
      wireAgent(agent, threadId);

      // Try to resume existing session, or create new one
      const sessionId = await agent.initialize(thread.sessionId);
      const isResumingSession = thread.sessionId === sessionId && thread.sessionId !== undefined;

      // Persist sessionId if it's new
      updateDb((db) => {
        const t = db.threads.find((t) => t.id === threadId);
        if (t) {
          if (!t.sessionId) {
            t.sessionId = sessionId;
          }
          // Add debug info
          if (isResumingSession) {
            console.log(`[server] Resumed existing session ${sessionId} for thread ${threadId}`);
          } else {
            console.log(`[server] Created new session ${sessionId} for thread ${threadId}`);
          }
        }
      });

      // Fire session/prompt. ACP will respond with messages via the "message" event.
      agent.send({
        jsonrpc: "2.0",
        id: 1,
        method: "session/prompt",
        params: {
          sessionId,
          prompt: [{ type: "text", text }],
        },
      });
    } catch (err: any) {
      updateDb((db) => {
        db.messages.push({
          id: newId("msg-err"),
          threadId,
          timestamp: new Date().toISOString(),
          raw: { error: err.message },
          type: "error",
        });
        const t = db.threads.find((t) => t.id === threadId);
        if (t) t.status = "idle";
      });
    }
  })();
});

// ---------------------------------------------------------------------------
// Routes — Permission responses
//
// The UI reads thread.pendingPermissionId + thread.pendingPermissionOptions
// and sends the chosen optionId back here. We forward the exact JSON-RPC
// response ACP expects, verbatim.
// ---------------------------------------------------------------------------

app.post("/api/threads/:threadId/respond", async (req, res) => {
  const { threadId } = req.params;
  const { optionId } = req.body;   // exact optionId string from ACP options list
  if (!optionId) return res.status(400).json({ error: "optionId required" });

  const db = readDb();
  const thread = db.threads.find((t) => t.id === threadId);
  if (!thread) return res.status(404).json({ error: "thread not found" });
  if (thread.pendingPermissionId === undefined) {
    return res.status(400).json({ error: "no pending permission" });
  }

  // Look up the workspace to get its path
  const workspace = db.workspaces.find((ws) => ws.id === thread.workspaceId);
  const wsPath = workspace?.path || thread.workspaceId;
  const agent = ClaudeAgent.getInstance(threadId, wsPath);
  wireAgent(agent, threadId);

  // Ensure agent is initialized and session is resumed before sending permission response
  try {
    await agent.initialize(thread.sessionId);
  } catch (err) {
    console.error("[server] Failed to initialize agent for permission response:", err);
    return res.status(500).json({ error: "Failed to initialize agent" });
  }

  // Send exactly what ACP expects: result.selected structure
  agent.send({
    jsonrpc: "2.0",
    id: thread.pendingPermissionId,
    result: { selected: { optionId } },
  });

  updateDb((db) => {
    const t = db.threads.find((t) => t.id === threadId);
    if (t) {
      t.status = "thinking";
      t.pendingPermissionId = undefined;
      t.pendingPermissionOptions = undefined;
    }
    // Record the response as a raw message too
    db.messages.push({
      id: newId("msg-perm"),
      threadId,
      timestamp: new Date().toISOString(),
      type: "permission_response",
      raw: { selected: { optionId } },
    });
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Routes — Raw ACP pass-through (for advanced clients)
//
// POST /api/threads/:threadId/acp
// Body: any valid JSON-RPC message → forwarded verbatim to the subprocess.
// Response: the next inbound message from the subprocess (one-shot).
// ---------------------------------------------------------------------------

app.post("/api/threads/:threadId/acp", async (req, res) => {
  const { threadId } = req.params;
  const db = readDb();
  const thread = db.threads.find((t) => t.id === threadId);
  if (!thread) return res.status(404).json({ error: "thread not found" });

  const agent = ClaudeAgent.getInstance(
    threadId,
    ensureWorkspace(thread.workspaceId, thread.workspaceId)
  );

  agent.send(req.body);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Vite / static
// ---------------------------------------------------------------------------

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`Server on http://localhost:${PORT}`));
}

startServer();