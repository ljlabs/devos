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
import { DatabaseSchema, Workspace, Thread, Message } from "../src/types";
import { logInfo, logError, getLogs } from "../src/logger";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const DB_FILE = process.env.DB_FILE || path.join(process.cwd(), "db.json");
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
  allowedPatterns: [],
};

function readDb(): DatabaseSchema {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
      return defaultDb;
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    // Ensure allowedPatterns exists (for backward compatibility)
    if (!data.allowedPatterns) {
      data.allowedPatterns = [];
    }
    return data;
  } catch {
    return defaultDb;
  }
}

function writeDb(data: DatabaseSchema): boolean {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (err: any) {
    console.error("[db] writeDb failed:", err.message);
    return false;
  }
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

    // -----------------------------------------------------------------------
    // Auto-approve check BEFORE storing the message in DB.
    //
    // Why before? If we store first then send allow, the UI polls and renders
    // a permission bubble for a split-second before the next poll removes it.
    // By handling it here we never write a session/request_permission message
    // to DB — so the UI never sees a prompt at all. Instead we write a small
    // "auto_approved" record so the chat log shows what happened.
    // -----------------------------------------------------------------------
    if (raw.method === "session/request_permission") {
      const rawInput = raw.params?.toolCall?.rawInput ?? {};
      const toolCommand: string = rawInput.command ?? rawInput.file_path ?? rawInput.path ?? "";
      const toolName: string | undefined =
        raw.params?.toolCall?._meta?.claudeCode?.toolName ??
        raw.params?._meta?.claudeCode?.toolName ??
        (typeof raw.params?.toolCall?.title === "string"
          ? raw.params.toolCall.title.split(/\s+/)[0]
          : undefined);
      const patterns = readDb().allowedPatterns || [];

      if (toolCommand && checkAllowedPattern(toolCommand, toolName, patterns)) {
        logInfo("server", `[AUTO-APPROVE] Pattern matched: "${toolCommand}" (tool=${toolName ?? "unknown"})`, threadId);

        // Use the `agent` captured in this closure — it IS the live process.
        // Never call ClaudeAgent.getInstance() here; that may return a stale
        // or newly-constructed instance with no subprocess attached.
        agent.send({
          jsonrpc: "2.0",
          id: raw.id,
          result: { outcome: { outcome: "selected", optionId: "allow" } },
        });

        // Record what happened without triggering a permission bubble in UI
        updateDb((db) => {
          db.messages.push({
            id: newId("msg-auto"),
            threadId,
            timestamp: new Date().toISOString(),
            type: "permission_response",
            raw: { autoApproved: true, command: toolCommand, selected: { optionId: "allow" } },
          });
          const t = db.threads.find((t) => t.id === threadId);
          if (t) t.status = "thinking";
        });

        return; // Do NOT fall through to the normal store-and-process path
      }
    }

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

      // Agent requests permission — no pattern matched, prompt the user
      if (raw.method === "session/request_permission") {
        logInfo("server", `[PERMISSION REQUIRED] No pattern match for tool, awaiting user input`, threadId);
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
  
  // Validate all workspace paths and filter out invalid ones
  const validWorkspaces = db.workspaces.filter((ws) => {
    if (!fs.existsSync(ws.path)) {
      logError("server", `Workspace path does not exist: ${ws.path}`, "global");
      return false;
    }
    return true;
  });

  // If any were removed, update the DB
  if (validWorkspaces.length !== db.workspaces.length) {
    const removedIds = db.workspaces
      .filter((ws) => !validWorkspaces.includes(ws))
      .map((ws) => ws.id);
    
    updateDb((db) => {
      db.workspaces = validWorkspaces;
      // Also clean up threads and messages for removed workspaces
      db.threads = db.threads.filter((t) => !removedIds.includes(t.workspaceId));
      db.messages = db.messages.filter((m) => !removedIds.includes(m.threadId) && 
        !db.threads.some((t) => removedIds.includes(t.workspaceId) && t.id === m.threadId));
    });
  }

  // Ensure sandboxed workspaces exist
  validWorkspaces.forEach((ws) => {
    if (ws.path.includes("sandbox_workspaces")) {
      ensureWorkspace(ws.id, ws.name);
    }
  });

  res.json(validWorkspaces);
});

app.get("/api/allowedPatterns", (_req, res) => {
  const db = readDb();
  res.json(db.allowedPatterns);
});

app.post("/api/allowedPatterns", (req, res) => {
  const { pattern, toolName, variant } = req.body;
  if (!pattern || typeof pattern !== "string") {
    return res.status(400).json({ error: "pattern (string) required" });
  }
  let patterns: any[] = [];
  updateDb((db) => {
    db.allowedPatterns = db.allowedPatterns || [];
    const exists = (db.allowedPatterns as any[]).some(
      (p: any) => (p.pattern || p) === pattern && p.toolName === (toolName ?? undefined)
    );
    if (!exists) {
      (db.allowedPatterns as any[]).push({
        pattern,
        variant: variant ?? (pattern.endsWith("*") ? "wildcard" : "exact"),
        toolName: toolName ?? undefined,
        createdAt: new Date().toISOString(),
      });
      logInfo("server", `Pattern saved via API (tool=${toolName ?? "any"}): ${pattern}`, "global");
    }
    patterns = db.allowedPatterns;
  });
  res.status(201).json(patterns);
});

app.delete("/api/allowedPatterns", (req, res) => {
  const { pattern } = req.body;
  if (!pattern) return res.status(400).json({ error: "pattern required" });
  let patterns: any[] = [];
  updateDb((db) => {
    db.allowedPatterns = db.allowedPatterns || [];
    db.allowedPatterns = (db.allowedPatterns as any[]).filter(
      (p: any) => (p.pattern || p) !== pattern
    ) as any;
    patterns = db.allowedPatterns;
  });
  res.json(patterns);
});

app.post("/api/workspaces", (req, res) => {
  const { name, path: wsPath } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "name required" });

  // A path is REQUIRED and MUST point to an existing directory on this machine.
  // We never silently fall back to a generated sandbox path — that hides
  // mistakes (e.g. a macOS path on a Windows box) until the agent fails later.
  if (!wsPath || !wsPath.trim()) {
    return res.status(400).json({
      error: "Workspace path is required",
      details: "Provide an absolute path to an existing directory on this machine.",
    });
  }

  if (!fs.existsSync(wsPath)) {
    return res.status(400).json({
      error: `Workspace path does not exist: ${wsPath}`,
      details: "Provide an absolute path to an existing directory on this machine.",
    });
  }

  // The path must be a directory, not a file.
  if (!fs.statSync(wsPath).isDirectory()) {
    return res.status(400).json({
      error: `Workspace path is not a directory: ${wsPath}`,
      details: "Provide an absolute path to an existing directory on this machine.",
    });
  }

  const id = `ws-${Date.now()}`;
  const workspace: Workspace = { id, name, path: wsPath };

  updateDb((db) => db.workspaces.push(workspace));
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
  if (!text || !text.trim()) return res.status(400).json({ error: "text required" });

  const db = readDb();
  const thread = db.threads.find((t) => t.id === threadId);
  if (!thread) return res.status(404).json({ error: "thread not found" });

  // Look up the workspace to get its path
  const workspace = db.workspaces.find((ws) => ws.id === thread.workspaceId);
  if (!workspace) {
    return res.status(404).json({ error: "workspace not found" });
  }

  const wsPath = workspace.path;

  // Validate that the workspace path exists before proceeding
  if (!fs.existsSync(wsPath)) {
    return res.status(400).json({ 
      error: `Workspace path no longer exists: ${wsPath}`,
      details: "The workspace directory has been deleted or is no longer accessible. Please delete this workspace and create a new one."
    });
  }

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
// Helper: Generate pattern variants for "allow similar" behavior
//
// Given a full tool command, generate variants:
// - "exact": Full command (specific parameters)
// - "tool": Command with parameters wildcard ("python main.py *")
// - "category": Command prefix only ("python.exe *")
// ---------------------------------------------------------------------------

function generatePatternVariants(fullCommand: string): Array<{ variant: string; pattern: string; createdAt: string }> {
  // Extract the base tool path and script name
  // Example: "C:/Users/.../python.exe C:/Users/.../main.py text \"temp\" --max 5"
  // Variants:
  // 1. exact: Full command (rarely reused due to specific parameters)
  // 2. tool: "C:/Users/.../python.exe C:/Users/.../main.py *" (any args to this tool)
  // 3. category: "C:/Users/.../python.exe *" (any python script in that directory)

  const createdAt = new Date().toISOString();

  // Try to identify tool parts
  const parts = fullCommand.split(/\s+/);
  
  const variants: any[] = [];

  // Always add "exact" variant
  variants.push({
    variant: "exact",
    pattern: fullCommand,
    createdAt,
  });

  // If command has multiple parts, add "tool" variant (script + wildcard)
  if (parts.length >= 2) {
    // Assume first two parts are executable and script
    const toolPattern = `${parts[0]} ${parts[1]} *`;
    if (toolPattern !== fullCommand) {
      variants.push({
        variant: "tool",
        pattern: toolPattern,
        createdAt,
      });
    }
  }

  // If command starts with a path (executable), add "category" variant
  if (parts.length >= 1 && (parts[0].includes("/") || parts[0].includes("\\"))) {
    const executablePattern = `${parts[0]} *`;
    if (executablePattern !== fullCommand && !variants.some(v => v.pattern === executablePattern)) {
      variants.push({
        variant: "category",
        pattern: executablePattern,
        createdAt,
      });
    }
  }

  return variants;
}

// ---------------------------------------------------------------------------
// Helper: Check if a command matches any stored pattern
// ---------------------------------------------------------------------------

function checkAllowedPattern(command: string, toolName: string | undefined, patterns: any[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  if (!command || typeof command !== "string") return false;

  // Normalise to forward slashes for consistent matching across platforms
  const normCommand = command.replace(/\\/g, "/");

  for (const pattern of patterns) {
    const pat: string = (pattern.pattern || pattern);

    // If the pattern has a toolName, it must match
    if (pattern.toolName && toolName && pattern.toolName !== toolName) continue;

    const normPat = pat.replace(/\\/g, "/");

    // Simple wildcard matching
    if (normPat === "*") return true;

    // If pattern ends with *, use prefix matching
    if (normPat.endsWith("*")) {
      const prefix = normPat.slice(0, -1); // Remove the *
      if (normCommand.startsWith(prefix)) return true;
    } else {
      // Exact match
      if (normCommand === normPat) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Routes — Permission responses
// ---------------------------------------------------------------------------

app.post("/api/threads/:threadId/respond", async (req, res) => {
  const { threadId } = req.params;
  const { optionId, toolCommand, toolName } = req.body;

  if (!optionId || typeof optionId !== "string") {
    return res.status(400).json({ error: "optionId (string) required" });
  }

  // Do NOT whitelist valid option IDs here. ACP defines the valid options
  // in the session/request_permission message; the UI only shows those exact
  // buttons. Whatever the user clicked is already a valid ACP option.
  // We just must never forward a UI-invented ID like "allow_similar".
  if (optionId === "allow_similar") {
    return res.status(400).json({ error: "allow_similar is a UI concept — save the pattern via POST /api/allowedPatterns, then send the ACP option (allow_once / allow_always)" });
  }

  const db = readDb();
  const thread = db.threads.find((t) => t.id === threadId);
  if (!thread) return res.status(404).json({ error: "thread not found" });
  if (thread.pendingPermissionId === undefined) {
    return res.status(400).json({ error: "no pending permission" });
  }

  // If user selected "allow_always", save the exact tool command as a pattern
  // scoped to the specific tool so Bash patterns don't auto-approve Write ops.
  if (optionId === "allow_always" && toolCommand) {
    updateDb((db) => {
      db.allowedPatterns = db.allowedPatterns || [];
      const exists = (db.allowedPatterns as any[]).some(
        (p: any) => (p.pattern || p) === toolCommand && p.toolName === (toolName ?? undefined)
      );
      if (!exists) {
        // Derive variant from toolName: Write/Edit/Read tools → their kind, Bash → "execute", etc.
        const kind = toolName
          ? (["Write", "Edit", "MultiEdit", "Read"].includes(toolName) ? toolName.toLowerCase() : "execute")
          : "exact";
        (db.allowedPatterns as any[]).push({
          pattern: toolCommand,
          variant: kind,
          toolName: toolName ?? undefined,
          createdAt: new Date().toISOString(),
        });
        logInfo("server", `Pattern saved (exact, tool=${toolName ?? "any"}): ${toolCommand}`, threadId);
      }
    });
  }

  // Look up the workspace to get its path
  const workspace = db.workspaces.find((ws) => ws.id === thread.workspaceId);
  const wsPath = workspace?.path || thread.workspaceId;
  const agent = ClaudeAgent.getInstance(threadId, wsPath);
  wireAgent(agent, threadId);

  // Forward the optionId verbatim — it came from ACP's own options list
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
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ error: "valid JSON-RPC object required" });
  }
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

// Don't auto-start the HTTP server (or boot Vite) when imported by tests.
if (process.env.NODE_ENV !== "test") {
  startServer();
}

export { app };