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
import { logInfo, logError, getLogs } from "./src/logger";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const DB_FILE = path.join(process.cwd(), "db.json");
const WORKSPACES_DIR = path.join(process.cwd(), "sandbox_workspaces");

app.use(express.json());

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

const defaultDb: DatabaseSchema = {
  workspaces: [
    { id: "ws-auth", name: "frontend-auth", path: path.join(WORKSPACES_DIR, "ws-auth") },
    { id: "ws-api",  name: "api-gateway",   path: path.join(WORKSPACES_DIR, "ws-api") },
    { id: "ws-docs", name: "docs-site",      path: path.join(WORKSPACES_DIR, "ws-docs") },
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
// In-memory cancel flags
//
// The cancel route may arrive while a thread's async handler is still inside
// agent.initialize() (e.g. waiting for session/new). Since there's no session
// yet to cancel, we record the intent here. The async handler checks this flag
// after initialize() returns and aborts before sending session/prompt.
// ---------------------------------------------------------------------------

const cancelPending = new Set<string>(); // threadIds where cancel was requested

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
//
// State tracking:
//   "thinking"              – agent is working (processing a prompt)
//   "awaiting_permission"   – agent asked for permission
//   "idle"                  – agent is not working
//
// The agent is considered "thinking" from when we send session/prompt until
// the rpc() Promise resolves. session/update notifications that arrive while
// the agent works are stored but do NOT mark idle.
// ---------------------------------------------------------------------------

function wireAgent(agent: ClaudeAgent, threadId: string): void {
  if (agent.listenerCount("message") > 0) return; // already wired

  agent.on("message", (raw: any) => {
    logInfo("server", `ACP message received: ${raw.method ?? "response"}`, threadId);
    broadcastGlobalLog({ type: "acp", threadId, raw, timestamp: new Date().toISOString() });

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

      const thread = db.threads.find((t) => t.id === threadId);
      if (!thread) return;

      // Keep thread.sessionId updated if ACP tells us
      const sessionId =
        raw.params?.sessionId ??
        raw.result?.sessionId ??
        raw.params?.update?.sessionId;
      if (sessionId) thread.sessionId = sessionId;

      // --- State transitions ---

      // JSON-RPC response with stopReason → agent turn is done
      if ("id" in raw && raw.result?.stopReason) {
        const reason = raw.result.stopReason;
        logInfo("server", `stopReason=${reason} received, setting idle`, threadId);
        thread.status = "idle";
        // Store error if not end_turn so the UI can surface it
        if (reason !== "end_turn") {
          thread.lastError = reason;
        } else {
          thread.lastError = undefined;
        }
        return;
      }

      // JSON-RPC error response → agent turn failed
      if ("id" in raw && raw.error) {
        logInfo("server", `RPC error received: ${JSON.stringify(raw.error)}, setting idle`, threadId);
        thread.status = "idle";
        thread.lastError = raw.error.message ?? "Unknown error";
        return;
      }

      // Agent requests permission → awaiting_permission
      if (raw.method === "session/request_permission") {
        thread.status = "awaiting_permission";
        thread.pendingPermissionId = raw.id;
        thread.pendingPermissionOptions = raw.params?.options ?? [];
        return;
      }

      // Agent sends a session/update → it's still working, just notify progress.
      if (raw.method === "session/update") {
        const update = raw.params?.update;
        if (update?.sessionUpdate === "session_info_update" && update?.title) {
          thread.title = update.title;
        }
        return;
      }
    });
  });

  agent.on("close", () => {
    updateDb((db) => {
      const t = db.threads.find((t) => t.id === threadId);
      if (t) {
        t.status = "idle";
        t.pendingPermissionId = undefined;
        t.pendingPermissionOptions = undefined;
      }
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

app.patch("/api/workspaces/:workspaceId", (req, res) => {
  const { name, path: wsPath } = req.body;
  if (wsPath !== undefined) {
    return res.status(400).json({ error: "workspace path cannot be changed" });
  }
  const db = readDb();
  const ws = db.workspaces.find((w) => w.id === req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: "not found" });
  if (name) ws.name = name;
  writeDb(db);
  res.json(ws);
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

app.patch("/api/threads/:threadId", (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  const db = readDb();
  const thread = db.threads.find((t) => t.id === req.params.threadId);
  if (!thread) return res.status(404).json({ error: "not found" });
  thread.title = title;
  writeDb(db);
  res.json(thread);
});

app.delete("/api/threads/:threadId", (req, res) => {
  const { threadId } = req.params;
  const db = readDb();
  const thread = db.threads.find((t) => t.id === threadId);
  if (!thread) return res.status(404).json({ error: "not found" });

  db.threads = db.threads.filter((t) => t.id !== threadId);
  db.messages = db.messages.filter((m) => m.threadId !== threadId);
  writeDb(db);

  ClaudeAgent.removeInstance(threadId);
  res.json({ ok: true });
});

app.delete("/api/workspaces/:workspaceId", (req, res) => {
  const { workspaceId } = req.params;
  const db = readDb();
  const wsIndex = db.workspaces.findIndex((w) => w.id === workspaceId);
  if (wsIndex === -1) return res.status(404).json({ error: "not found" });

  const threadIds = db.threads.filter((t) => t.workspaceId === workspaceId).map((t) => t.id);
  threadIds.forEach((id) => ClaudeAgent.removeInstance(id));

  db.threads = db.threads.filter((t) => t.workspaceId !== workspaceId);
  db.messages = db.messages.filter((m) => !threadIds.includes(m.threadId));
  db.workspaces.splice(wsIndex, 1);
  writeDb(db);

  res.json({ ok: true });
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
    if (t) {
      t.status = "thinking";
      t.lastError = undefined;
    }
  });

  res.json(userMsg);

  // Async: boot/resume agent and send prompt
  (async () => {
    logInfo("server", `async handler started, wsPath=${wsPath}`, threadId);
    try {
      const agent = ClaudeAgent.getInstance(threadId, wsPath);
      logInfo("server", "got agent instance, wiring...", threadId);
      wireAgent(agent, threadId);

      logInfo("server", `calling agent.initialize(thread.sessionId=${thread.sessionId})...`, threadId);
      const sessionId = await agent.initialize(thread.sessionId);
      const isResumingSession = thread.sessionId === sessionId && thread.sessionId !== undefined;

      // Persist sessionId if it's new
      updateDb((db) => {
        const t = db.threads.find((t) => t.id === threadId);
        if (t) {
          if (!t.sessionId) {
            t.sessionId = sessionId;
          }
          if (isResumingSession) {
            console.log(`[server] Resumed existing session ${sessionId} for thread ${threadId}`);
          } else {
            console.log(`[server] Created new session ${sessionId} for thread ${threadId}`);
          }
        }
      });

      // Check if cancel arrived while we were inside initialize() (e.g. waiting
      // for session/new to return). The session now exists so we can cancel it
      // properly, and we must not send session/prompt.
      if (cancelPending.has(threadId)) {
        cancelPending.delete(threadId);
        logInfo("server", `cancel was pending after initialize, aborting turn and cancelling sessionId=${sessionId}`, threadId);
        agent.cancel(sessionId);
        updateDb((db) => {
          const t = db.threads.find((t) => t.id === threadId);
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
        return;
      }

      // Fire session/prompt via rpc() so we await the response and know
      // exactly when the agent turn is complete.
      logInfo("server", `sending session/prompt...`, threadId);
      await agent.rpc("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }],
      });
      logInfo("server", `session/prompt completed`, threadId);

      // Agent turn is done → set idle
      updateDb((db) => {
        const t = db.threads.find((t) => t.id === threadId);
        if (t) t.status = "idle";
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

  // Do NOT call agent.initialize() here — the agent process is already alive
  // and mid-turn (that's how it sent the permission request). Calling
  // session/load would replay session history and cause a race condition where
  // the permission response arrives late and gets treated as a refusal.

  // Send exactly what ACP expects: result.outcome structure
  agent.send({
    jsonrpc: "2.0",
    id: thread.pendingPermissionId,
    result: { outcome: { outcome: "selected", optionId } },
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
// Routes — Cancel agent turn
// ---------------------------------------------------------------------------

app.post("/api/threads/:threadId/cancel", async (req, res) => {
  const { threadId } = req.params;
  logInfo("server", "cancel requested", threadId);

  // Set the flag immediately so any in-flight async handler (e.g. still inside
  // initialize()) will see it and abort before sending session/prompt.
  cancelPending.add(threadId);

  const db = readDb();
  const thread = db.threads.find((t) => t.id === threadId);
  if (!thread) return res.status(404).json({ error: "thread not found" });

  // If there's no active session, the async handler will catch cancelPending
  // when initialize() finishes. Mark idle and return — nothing else to do yet.
  if (!thread.sessionId) {
    updateDb((db) => {
      const t = db.threads.find((t) => t.id === threadId);
      if (t) t.status = "idle";
    });
    return res.json({ ok: true });
  }

  const workspace = db.workspaces.find((ws) => ws.id === thread.workspaceId);
  const wsPath = workspace?.path || thread.workspaceId;

  // The agent process is already running (it's mid-turn), so send cancel
  // directly without calling initialize() — we must not create a new session.
  const agent = ClaudeAgent.getInstance(threadId, wsPath);
  wireAgent(agent, threadId);

  // If there's a pending permission, deny it first
  if (thread.pendingPermissionId !== undefined) {
    agent.send({
      jsonrpc: "2.0",
      id: thread.pendingPermissionId,
      result: { outcome: { outcome: "cancelled" } },
    });

    updateDb((db) => {
      const t = db.threads.find((t) => t.id === threadId);
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

  // Send session/cancel — use the thread's known sessionId, never a new one.
  // Also clear the pending flag since we're handling it here directly.
  cancelPending.delete(threadId);
  agent.cancel(thread.sessionId);

  updateDb((db) => {
    const t = db.threads.find((t) => t.id === threadId);
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

// ---------------------------------------------------------------------------
// Routes — Thread Log SSE (per-thread log streaming)
// ---------------------------------------------------------------------------

app.get("/api/threads/:threadId/logs", (req, res) => {
  const { threadId } = req.params;
  logInfo("server", "thread log SSE connected", threadId);

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
    logInfo("server", "thread log SSE disconnected", threadId);
  });
});

// ---------------------------------------------------------------------------
// Routes — Global Activity Log SSE (all threads)
// ---------------------------------------------------------------------------

const globalLogClients = new Set<any>();

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

function broadcastGlobalLog(event: any) {
  const data = JSON.stringify(event);
  for (const client of globalLogClients) {
    client.write(`data: ${data}\n\n`);
  }
}

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