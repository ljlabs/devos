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
import { DatabaseSchema, Workspace, Thread, Message, AllowSimilarPattern } from "../src/types";
import { logInfo, logError, getLogs } from "../src/logger";
import { SqliteDb } from "./db.sqlite";
import * as git from "./git";
import { listDirectory, readFile, writeFile, createEntry, renameEntry, deleteEntry } from "./files";
import { initWebSocket, broadcastToThread, broadcastThreadUpdate, broadcastAck, type WsHandlers } from "./wsServer";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";
const DB_FILE = process.env.DB_FILE || path.join(process.cwd(), "devos.db");
const WORKSPACES_DIR = path.join(process.cwd(), "sandbox_workspaces");

app.use(express.json());

// ---------------------------------------------------------------------------
// SQLite DB instance
// ---------------------------------------------------------------------------

const sqliteDb = new SqliteDb(DB_FILE);

// Initialize with default workspaces if empty
{
  const db = sqliteDb.readDb();
  if (db.workspaces.length === 0) {
    const defaultWorkspaces: Workspace[] = [
      { id: "ws-auth", name: "frontend-auth", path: path.join(WORKSPACES_DIR, "ws-auth") },
      { id: "ws-api",  name: "api-gateway",   path: path.join(WORKSPACES_DIR, "ws-api") },
      { id: "ws-docs", name: "docs-site",      path: path.join(WORKSPACES_DIR, "ws-docs") },
    ];
    db.workspaces = defaultWorkspaces;
    sqliteDb.writeDb(db);
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function readDb(): DatabaseSchema {
  return sqliteDb.readDb();
}

/** @deprecated Use targeted sqliteDb methods instead */
function writeDb(data: DatabaseSchema): boolean {
  return sqliteDb.writeDb(data);
}

/** @deprecated Use targeted sqliteDb methods instead */
function updateDb(fn: (db: DatabaseSchema) => void): void {
  sqliteDb.updateDb(fn);
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Insert a message, update thread fields, and broadcast to WebSocket subscribers.
 * Replaces the common updateDb + readDb + broadcast pattern.
 */
function insertAndBroadcast(threadId: string, msg: Message, threadUpdates: Partial<Thread>): Thread | null {
  return sqliteDb.runInTransaction(() => {
    sqliteDb.insertMessage(msg);
    const thread = sqliteDb.updateThread(threadId, threadUpdates);
    broadcastToThread(threadId, msg);
    if (thread) broadcastThreadUpdate(threadId, thread);
    return thread;
  });
}

/**
 * Insert a message without thread state changes, and broadcast.
 */
function insertMessageAndBroadcast(threadId: string, msg: Message): void {
  sqliteDb.insertMessage(msg);
  broadcastToThread(threadId, msg);
}

/**
 * Get a thread and its messages in one query (for WebSocket subscribe).
 */
function getThreadWithMessages(threadId: string): { thread: Thread | undefined; messages: Message[] } {
  return {
    thread: sqliteDb.getThreadById(threadId),
    messages: sqliteDb.getMessagesByThread(threadId),
  };
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
// Map ACP tool kind to toolName for permission matching
// ---------------------------------------------------------------------------

function toolNameFromKind(kind: string | undefined): string | undefined {
  switch (kind) {
    case "execute": return "Bash";
    case "write":   return "Write";
    case "read":    return "Read";
    case "edit":    return "Edit";
    default:        return undefined;
  }
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
    // ------------------------------------------------------------------
    // During session/load, the ACP subprocess may re-issue a
    // session/request_permission that was pending when the session was
    // saved. This arrives AFTER the session/load RPC response (and thus
    // after suppressEmit is cleared), so it slips through as a live
    // message. We must ignore it — it will be re-issued properly once
    // the new session/prompt is sent.
    // ------------------------------------------------------------------
    if (agent.isLoadingSession && raw.method === "session/request_permission") {
      logInfo("server", `[SKIP] session/request_permission suppressed during session load replay`, threadId);
      return;
    }

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
      
      // Extract toolName from ACP metadata.
      // Priority:
      //   1. _meta.claudeCode.toolName (from session/update events)
      //   2. tool kind mapping (from session/request_permission events)
      // The toolCall kind field unambiguously maps to a tool type:
      //   "execute" → Bash, "write" → Write, "edit" → Edit, "read" → Read
      const toolName: string | undefined =
        raw.params?.toolCall?._meta?.claudeCode?.toolName ??
        raw.params?._meta?.claudeCode?.toolName ??
        toolNameFromKind(raw.params?.toolCall?.kind);
      
      const patterns = sqliteDb.getAllowedPatterns();

      // Diagnostic logging
      logInfo("server", 
        `[PERM-CHECK] toolName="${toolName}" kind="${raw.params?.toolCall?.kind}" ` +
        `command="${toolCommand.substring(0, 100)}..." patternCount=${patterns.length}`,
        threadId
      );

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
        const autoApprovedMsg: Message = {
          id: newId("msg-auto"),
          threadId,
          timestamp: new Date().toISOString(),
          type: "permission_response",
          raw: { autoApproved: true, command: toolCommand, selected: { optionId: "allow" } },
        };
        insertAndBroadcast(threadId, autoApprovedMsg, { status: "thinking" });

        return; // Do NOT fall through to the normal store-and-process path
      }
    }

    // Create the message object
    const msg: Message = {
      id: newId("msg"),
      threadId,
      timestamp: new Date().toISOString(),
      raw,
      type: raw.method ?? (raw.result !== undefined ? "response" : "unknown"),
    };

    // --- Streaming chunk accumulation ---
    // When an agent_message_chunk arrives, append its text to the last
    // message with the same messageId instead of creating a new record.
    const chunkUpdate = raw.params?.update;
    const isChunk = raw.method === "session/update"
      && chunkUpdate?.sessionUpdate === "agent_message_chunk"
      && chunkUpdate?.messageId;

    if (isChunk) {
      const messageId = chunkUpdate.messageId;
      const newText = chunkUpdate.content?.text ?? "";

      const existing = sqliteDb.getMessageByThreadAndMessageId(threadId, messageId);
      if (existing) {
        // Append the new text chunk
        const updatedRaw = JSON.parse(JSON.stringify(existing.raw)); // deep clone
        const existingUpdate = updatedRaw.params?.update;
        if (existingUpdate?.content && typeof existingUpdate.content === "object") {
          existingUpdate.content.text = (existingUpdate.content.text || "") + newText;
        }
        sqliteDb.updateMessageRaw(existing.id, updatedRaw);
        existing.raw = updatedRaw;
        existing.timestamp = msg.timestamp;
        broadcastToThread(threadId, existing);
        return; // Early return — no thread state changes for chunks
      }
      // No existing message with this messageId — fall through to create one
    }

    // Store the raw ACP message verbatim + update thread state
    const threadUpdates: Partial<Thread> = {};

    // Keep thread.sessionId updated if ACP tells us
    const sessionId =
      raw.params?.sessionId ??
      raw.result?.sessionId ??
      raw.params?.update?.sessionId;
    if (sessionId) threadUpdates.sessionId = sessionId;

    // --- State transitions ---
    if ("id" in raw && raw.result?.stopReason) {
      const reason = raw.result.stopReason;
      logInfo("server", `stopReason=${reason} received, setting idle`, threadId);
      threadUpdates.status = "idle";
      threadUpdates.lastError = reason !== "end_turn" ? reason : undefined;
    } else if ("id" in raw && raw.error) {
      logInfo("server", `RPC error received: ${JSON.stringify(raw.error)}, setting idle`, threadId);
      threadUpdates.status = "idle";
      threadUpdates.lastError = raw.error.message ?? "Unknown error";
    } else if (raw.method === "session/request_permission") {
      logInfo("server", `[PERMISSION REQUIRED] No pattern match for tool, awaiting user input`, threadId);
      threadUpdates.status = "awaiting_permission";
      threadUpdates.pendingPermissionId = raw.id;
      threadUpdates.pendingPermissionOptions = raw.params?.options ?? [];
    } else if (raw.method === "session/update") {
      const update = raw.params?.update;
      if (update?.sessionUpdate === "session_info_update" && update?.title) {
        threadUpdates.title = update.title;
      }
    }

    // Atomic insert + update
    sqliteDb.runInTransaction(() => {
      sqliteDb.insertMessage(msg);
      if (Object.keys(threadUpdates).length > 0) {
        sqliteDb.updateThread(threadId, threadUpdates);
      }
    });

    broadcastToThread(threadId, msg);
    const updatedThread = sqliteDb.getThreadById(threadId);
    if (updatedThread) broadcastThreadUpdate(threadId, updatedThread);
  });

  agent.on("close", () => {
    const updatedThread = sqliteDb.updateThread(threadId, {
      status: "idle",
      pendingPermissionId: undefined,
      pendingPermissionOptions: undefined,
    });
    if (updatedThread) broadcastThreadUpdate(threadId, updatedThread);
  });
}

// ---------------------------------------------------------------------------
// Routes — Workspaces
// ---------------------------------------------------------------------------

app.get("/api/workspaces", (_req, res) => {
  const allWorkspaces = sqliteDb.getAllWorkspaces();

  // Validate all workspace paths and remove invalid ones
  const invalidIds: string[] = [];
  const validWorkspaces = allWorkspaces.filter((ws) => {
    if (!fs.existsSync(ws.path)) {
      logError("server", `Workspace path does not exist: ${ws.path}`, "global");
      invalidIds.push(ws.id);
      return false;
    }
    return true;
  });

  // Cascade delete invalid workspaces (threads + messages deleted by FK)
  for (const id of invalidIds) {
    sqliteDb.deleteWorkspace(id);
  }

  // Ensure sandboxed workspaces exist
  validWorkspaces.forEach((ws) => {
    if (ws.path.includes("sandbox_workspaces")) {
      ensureWorkspace(ws.id, ws.name);
    }
  });

  res.json(validWorkspaces);
});

app.get("/api/workspaces/:workspaceId", (req, res) => {
  const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: "not found" });
  res.json(ws);
});

app.get("/api/allowedPatterns", (_req, res) => {
  res.json(sqliteDb.getAllowedPatterns());
});

app.post("/api/allowedPatterns", (req, res) => {
  const { pattern, toolName, variant } = req.body;
  if (!pattern || typeof pattern !== "string") {
    return res.status(400).json({ error: "pattern (string) required" });
  }
  // Validate pattern max length (prevent unbounded regex patterns)
  if (pattern.length > 500) {
    return res.status(400).json({ error: "pattern must be 500 characters or less" });
  }
  const existing = sqliteDb.getAllowedPatterns();
  const exists = existing.some(
    (p) => (p.pattern || (p as any)) === pattern && p.toolName === (toolName ?? undefined)
  );
  if (!exists) {
    sqliteDb.insertAllowedPattern({
      pattern,
      variant: variant ?? (pattern.endsWith("*") ? "wildcard" : "exact"),
      toolName: toolName ?? undefined,
      createdAt: new Date().toISOString(),
    });
    logInfo("server", `Pattern saved via API (tool=${toolName ?? "any"}): ${pattern}`, "global");
  }
  res.status(201).json(sqliteDb.getAllowedPatterns());
});

app.delete("/api/allowedPatterns", (req, res) => {
  const { pattern } = req.body;
  if (!pattern) return res.status(400).json({ error: "pattern required" });
  sqliteDb.deleteAllowedPattern(pattern);
  res.json(sqliteDb.getAllowedPatterns());
});

app.post("/api/workspaces", (req, res) => {
  const { name, path: wsPath } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "name required" });
  // Validate workspace name max length
  if (name.length > 200) {
    return res.status(400).json({ error: "workspace name must be 200 characters or less" });
  }

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

  sqliteDb.insertWorkspace(workspace);
  res.status(201).json(workspace);
});

app.patch("/api/workspaces/:workspaceId", (req, res) => {
  const { name, path: wsPath } = req.body;
  if (wsPath !== undefined) {
    return res.status(400).json({ error: "workspace path cannot be changed" });
  }
  const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: "not found" });
  if (name) {
    const updated = sqliteDb.updateWorkspaceName(ws.id, name);
    res.json(updated);
  } else {
    res.json(ws);
  }
});

// ---------------------------------------------------------------------------
// Routes — File Explorer
// ---------------------------------------------------------------------------

/**
 * List directory contents for a workspace
 * GET /api/workspaces/:workspaceId/files?path=<relative>
 */
app.get("/api/workspaces/:workspaceId/files", (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const relativePath = (req.query.path as string) || undefined;
    const entries = listDirectory(ws.path, relativePath);

    res.json({
      entries,
      currentPath: relativePath ?? "",
    });
  } catch (e: any) {
    if (e.message.includes("traversal")) {
      return res.status(400).json({ error: e.message });
    }
    if (e.message.includes("not found") || e.message.includes("Not a directory")) {
      return res.status(404).json({ error: e.message });
    }
    res.status(500).json({ error: e.message || "Internal server error" });
  }
});

/**
 * Read file content from a workspace
 * GET /api/workspaces/:workspaceId/files/read?path=<relative>
 */
app.get("/api/workspaces/:workspaceId/files/read", (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const relativePath = req.query.path as string;
    if (!relativePath) {
      return res.status(400).json({ error: "path query parameter required" });
    }

    const fileContent = readFile(ws.path, relativePath);
    res.json(fileContent);
  } catch (e: any) {
    if (e.message.includes("traversal")) {
      return res.status(400).json({ error: e.message });
    }
    if (e.message.includes("not found") || e.message.includes("Not a file")) {
      return res.status(404).json({ error: e.message });
    }
    res.status(500).json({ error: e.message || "Internal server error" });
  }
});

/**
 * Write file content to a workspace
 * PUT /api/workspaces/:workspaceId/files/write
 * Body: { path: string, content: string }
 */
app.put("/api/workspaces/:workspaceId/files/write", (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const { path: relativePath, content } = req.body;

    if (!relativePath || typeof relativePath !== "string") {
      return res.status(400).json({ error: "path (string) required" });
    }

    if (content === undefined || content === null || typeof content !== "string") {
      return res.status(400).json({ error: "content (string) required" });
    }

    const result = writeFile(ws.path, relativePath, content);
    logInfo("server", `File written: ${relativePath} (${result.size} bytes, ${result.lines} lines)`, req.params.workspaceId);
    res.json(result);
  } catch (e: any) {
    if (e.message.includes("traversal")) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: e.message || "Internal server error" });
  }
});

/**
 * Create a new file or directory
 * POST /api/workspaces/:workspaceId/files/create
 * Body: { path: string, type: "file" | "directory" }
 */
app.post("/api/workspaces/:workspaceId/files/create", (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const { path: relativePath, type } = req.body;

    if (!relativePath || typeof relativePath !== "string") {
      return res.status(400).json({ error: "path (string) required" });
    }

    if (type !== "file" && type !== "directory") {
      return res.status(400).json({ error: "type must be 'file' or 'directory'" });
    }

    const result = createEntry(ws.path, relativePath, type);
    logInfo("server", `Created ${type}: ${relativePath}`, req.params.workspaceId);
    res.json(result);
  } catch (e: any) {
    if (e.message.includes("traversal")) {
      return res.status(400).json({ error: e.message });
    }
    if (e.message.includes("Already exists")) {
      return res.status(409).json({ error: e.message });
    }
    res.status(500).json({ error: e.message || "Internal server error" });
  }
});

/**
 * Rename a file or directory
 * POST /api/workspaces/:workspaceId/files/rename
 * Body: { oldPath: string, newName: string }
 */
app.post("/api/workspaces/:workspaceId/files/rename", (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const { oldPath, newName } = req.body;

    if (!oldPath || typeof oldPath !== "string") {
      return res.status(400).json({ error: "oldPath (string) required" });
    }

    if (!newName || typeof newName !== "string") {
      return res.status(400).json({ error: "newName (string) required" });
    }

    const result = renameEntry(ws.path, oldPath, newName);
    logInfo("server", `Renamed ${oldPath} → ${newName}`, req.params.workspaceId);
    res.json(result);
  } catch (e: any) {
    if (e.message.includes("traversal") || e.message.includes("escape")) {
      return res.status(400).json({ error: e.message });
    }
    if (e.message.includes("Not found")) {
      return res.status(404).json({ error: e.message });
    }
    if (e.message.includes("Already exists")) {
      return res.status(409).json({ error: e.message });
    }
    res.status(500).json({ error: e.message || "Internal server error" });
  }
});

/**
 * Delete a file or directory
 * POST /api/workspaces/:workspaceId/files/delete
 * Body: { path: string }
 */
app.post("/api/workspaces/:workspaceId/files/delete", (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const { path: relativePath } = req.body;

    if (!relativePath || typeof relativePath !== "string") {
      return res.status(400).json({ error: "path (string) required" });
    }

    deleteEntry(ws.path, relativePath);
    logInfo("server", `Deleted: ${relativePath}`, req.params.workspaceId);
    res.json({ ok: true });
  } catch (e: any) {
    if (e.message.includes("traversal")) {
      return res.status(400).json({ error: e.message });
    }
    if (e.message.includes("Not found")) {
      return res.status(404).json({ error: e.message });
    }
    res.status(500).json({ error: e.message || "Internal server error" });
  }
});
// ---------------------------------------------------------------------------
// Routes — Git
// ---------------------------------------------------------------------------

/**
 * Get Git information for a workspace
 * GET /api/workspaces/:workspaceId/git/info
 */
app.get("/api/workspaces/:workspaceId/git/info", async (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const gitInfo = await git.getGitInfo(ws.path);
    res.json(gitInfo);
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Git error" });
  }
});

/**
 * List all branches for a workspace
 * GET /api/workspaces/:workspaceId/git/branches
 */
app.get("/api/workspaces/:workspaceId/git/branches", async (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const branches = await git.listBranches(ws.path);
    res.json(branches);
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Git error" });
  }
});

/**
 * Switch to a branch
 * POST /api/workspaces/:workspaceId/git/switch-branch
 * Body: { branchName: string }
 */
app.post("/api/workspaces/:workspaceId/git/switch-branch", async (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const { branchName } = req.body;
    if (!branchName) return res.status(400).json({ error: "branchName required" });

    await git.switchBranch(ws.path, branchName);
    logInfo("server", `switched to branch ${branchName}`, req.params.workspaceId);
    res.json({ success: true, message: `Switched to ${branchName}` });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Git error" });
  }
});

/**
 * Stash changes
 * POST /api/workspaces/:workspaceId/git/stash
 * Body: { message?: string }
 */
app.post("/api/workspaces/:workspaceId/git/stash", async (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const { message } = req.body;
    const result = await git.stashChanges(ws.path, message);
    logInfo("server", `stashed changes with message: ${message || "(no message)"}`, req.params.workspaceId);
    res.json({ success: true, message: result });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Git error" });
  }
});

/**
 * List stashes
 * GET /api/workspaces/:workspaceId/git/stashes
 */
app.get("/api/workspaces/:workspaceId/git/stashes", async (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const stashes = await git.listStashes(ws.path);
    res.json(stashes);
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Git error" });
  }
});

/**
 * Apply a stash
 * POST /api/workspaces/:workspaceId/git/stash/apply
 * Body: { stashId: string }
 */
app.post("/api/workspaces/:workspaceId/git/stash/apply", async (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const { stashId } = req.body;
    if (!stashId) return res.status(400).json({ error: "stashId required" });

    const result = await git.applyStash(ws.path, stashId);
    logInfo("server", `applied stash: ${stashId}`, req.params.workspaceId);
    res.json({ success: true, message: result });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Git error" });
  }
});

/**
 * Pop a stash (apply and remove)
 * POST /api/workspaces/:workspaceId/git/stash/pop
 * Body: { stashId: string }
 */
app.post("/api/workspaces/:workspaceId/git/stash/pop", async (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const { stashId } = req.body;
    if (!stashId) return res.status(400).json({ error: "stashId required" });

    const result = await git.popStash(ws.path, stashId);
    logInfo("server", `popped stash: ${stashId}`, req.params.workspaceId);
    res.json({ success: true, message: result });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Git error" });
  }
});

/**
 * Drop a stash
 * DELETE /api/workspaces/:workspaceId/git/stash/:stashId
 */
app.delete("/api/workspaces/:workspaceId/git/stash/:stashId", async (req, res) => {
  try {
    const ws = sqliteDb.getWorkspaceById(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace not found" });

    const { stashId } = req.params;
    const result = await git.dropStash(ws.path, stashId);
    logInfo("server", `dropped stash: ${stashId}`, req.params.workspaceId);
    res.json({ success: true, message: result });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Git error" });
  }
});

// ---------------------------------------------------------------------------
// Routes — Threads
// ---------------------------------------------------------------------------

app.get("/api/workspaces/:workspaceId/threads", (req, res) => {
  res.json(sqliteDb.getThreadsByWorkspace(req.params.workspaceId));
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
  sqliteDb.insertThread(thread);
  res.status(201).json(thread);
});

app.get("/api/threads/:threadId", (req, res) => {
  const thread = sqliteDb.getThreadById(req.params.threadId);
  if (!thread) return res.status(404).json({ error: "not found" });
  res.json(thread);
});

app.patch("/api/threads/:threadId", (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  // Validate thread title max length
  if (title.length > 200) {
    return res.status(400).json({ error: "thread title must be 200 characters or less" });
  }
  const updated = sqliteDb.updateThread(req.params.threadId, { title });
  if (!updated) return res.status(404).json({ error: "not found" });
  res.json(updated);
});

app.delete("/api/threads/:threadId", (req, res) => {
  const { threadId } = req.params;
  const thread = sqliteDb.getThreadById(threadId);
  if (!thread) return res.status(404).json({ error: "not found" });

  ClaudeAgent.removeInstance(threadId);

  // Use cascade delete from SQLiteDb
  const deleted = sqliteDb.deleteThread(threadId);
  if (!deleted) return res.status(500).json({ error: "delete failed" });

  res.json({ ok: true });
});

app.delete("/api/workspaces/:workspaceId", (req, res) => {
  const { workspaceId } = req.params;
  const ws = sqliteDb.getWorkspaceById(workspaceId);
  if (!ws) return res.status(404).json({ error: "not found" });

  const threadIds = sqliteDb.getThreadsByWorkspace(workspaceId).map((t) => t.id);
  threadIds.forEach((id) => ClaudeAgent.removeInstance(id));

  // Use cascade delete from SQLiteDb (deletes workspace + threads + messages)
  const deleted = sqliteDb.deleteWorkspace(workspaceId);
  if (!deleted) return res.status(500).json({ error: "delete failed" });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Routes — Messages
// ---------------------------------------------------------------------------

app.get("/api/threads/:threadId/messages", (req, res) => {
  res.json(sqliteDb.getMessagesByThread(req.params.threadId));
});

/**
 * GET /api/threads/:threadId/messages/paginated
 * Query params: limit (default 10, max 200)
 * Returns the latest `limit` messages, newest first.
 * hasMore is true when there are older messages beyond the window.
 */
app.get("/api/threads/:threadId/messages/paginated", (req, res) => {
  const { threadId } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 200);
  const total = sqliteDb.getMessageCount(threadId);
  const messages = sqliteDb.getMessages(threadId, 0, limit); // newest first
  res.json({
    messages,
    hasMore: total > limit,
    total,
  });
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
  // Validate message text max length (prevent unbounded messages)
  if (text.length > 50000) {
    return res.status(400).json({ error: "message text must be 50000 characters or less" });
  }

  const thread = sqliteDb.getThreadById(threadId);
  if (!thread) return res.status(404).json({ error: "thread not found" });

  // Look up the workspace to get its path
  const workspace = sqliteDb.getWorkspaceById(thread.workspaceId);
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
  insertAndBroadcast(threadId, userMsg, { status: "thinking", lastError: undefined });

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
      if (!thread.sessionId) {
        sqliteDb.updateThread(threadId, { sessionId });
      }
      if (isResumingSession) {
        console.log(`[server] Resumed existing session ${sessionId} for thread ${threadId}`);
      } else {
        console.log(`[server] Created new session ${sessionId} for thread ${threadId}`);
      }

      // Check if cancel arrived while we were inside initialize() (e.g. waiting
      // for session/new to return). The session now exists so we can cancel it
      // properly, and we must not send session/prompt.
      if (cancelPending.has(threadId)) {
        cancelPending.delete(threadId);
        agent.markSessionReady(); // clear replay suppression before cancelling
        logInfo("server", `cancel was pending after initialize, aborting turn and cancelling sessionId=${sessionId}`, threadId);
        agent.cancel(sessionId);
        insertAndBroadcast(threadId, {
          id: newId("msg-cancel"),
          threadId,
          timestamp: new Date().toISOString(),
          type: "system",
          raw: { text: "Agent turn cancelled by user" },
        }, { status: "idle", pendingPermissionId: undefined, pendingPermissionOptions: undefined });
        return;
      }

      // Fire session/prompt via rpc() so we await the response and know
      // exactly when the agent turn is complete.
      // Signal that session load replay is fully over — any messages from
      // this point on are live (not replayed history or re-issued permissions).
      agent.markSessionReady();
      logInfo("server", `sending session/prompt...`, threadId);
      await agent.rpc("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }],
      });
      logInfo("server", `session/prompt completed`, threadId);

      // Agent turn is done → set idle
      sqliteDb.updateThreadStatus(threadId, "idle");
    } catch (err: any) {
      insertAndBroadcast(threadId, {
        id: newId("msg-err"),
        threadId,
        timestamp: new Date().toISOString(),
        raw: { error: err.message },
        type: "error",
      }, { status: "idle" });
    }
  })();
});

// ---------------------------------------------------------------------------
// Helper: Check if a command matches any stored pattern
// ---------------------------------------------------------------------------

/**
 * Check whether a single (non-compound) command matches any stored pattern.
 * Patterns are matched with forward-slash normalisation and simple * wildcards.
 *
 * Tool-scoping rules:
 *   - Pattern has no toolName  → matches any tool (backward-compatible wildcard)
 *   - Pattern has toolName AND incoming toolName matches → allow
 *   - Pattern has toolName AND incoming toolName is DIFFERENT → skip (wrong tool)
 *   - Pattern has toolName AND incoming toolName is UNDEFINED → skip (unknown tool
 *     must not silently inherit a tool-scoped approval; fail safe)
 */
function matchesSinglePattern(normCommand: string, toolName: string | undefined, patterns: any[]): boolean {
  for (const pattern of patterns) {
    const pat: string = (pattern.pattern || pattern);

    // Tool-scoped pattern: only match when the tool is known and matches
    if (pattern.toolName) {
      // If incoming toolName is unknown or mismatched, do not auto-approve
      if (!toolName || pattern.toolName !== toolName) continue;
    }

    const normPat = pat.replace(/\\/g, "/");

    // "*" matches everything
    if (normPat === "*") return true;

    // Pattern ending with * → prefix match
    if (normPat.endsWith("*")) {
      const prefix = normPat.slice(0, -1);
      if (normCommand.startsWith(prefix)) return true;
    } else {
      // Exact match
      if (normCommand === normPat) return true;
    }
  }

  return false;
}

/**
 * Like matchesSinglePattern but ONLY performs exact (non-wildcard) matching.
 * Used to check a full compound command against stored verbatim patterns before
 * splitting it into sub-commands, so that a pattern like "cmd1 | cmd2" that was
 * saved via "Always Allow" can match itself without being broken by the splitter.
 * Wildcard patterns are intentionally skipped — "cd X *" must not short-circuit
 * the compound split and bypass per-sub-command security checking.
 */
function matchesSinglePatternExact(normCommand: string, toolName: string | undefined, patterns: any[]): boolean {
  for (const pattern of patterns) {
    const pat: string = (pattern.pattern || pattern);

    // Tool-scoped pattern: only match when the tool is known and matches
    if (pattern.toolName) {
      if (!toolName || pattern.toolName !== toolName) continue;
    }

    const normPat = pat.replace(/\\/g, "/");

    // Only exact matches — skip wildcard patterns
    if (normPat === "*" || normPat.endsWith("*")) continue;

    if (normCommand === normPat) return true;
  }

  return false;
}

/**
 * Check if a command (possibly compound) is fully covered by stored allow patterns.
 *
 * For compound commands joined by &&, ||, |, or ;, the command is split into
 * individual sub-commands. ALL sub-commands must independently match a stored
 * pattern for the compound command to be auto-approved.
 *
 * This prevents a pattern like "cd LekkerLoyal *" from silently approving
 * "cd LekkerLoyal && gh issue create ..." because the second part (gh issue
 * create) is never in the allowed list.
 *
 * Operators inside quoted strings ("..." or '...') are ignored so that command
 * arguments containing | or ; (e.g. --body "line1 | line2") are not mistakenly
 * split into sub-commands.
 *
 * Exact-before-split: before splitting, we try a direct exact-match against all
 * stored patterns. This handles the case where a user saved "allow_always" for a
 * compound command verbatim (e.g. "gh issue view 9 | head -50") — the stored
 * pattern IS the full compound string, so it must match itself exactly without
 * being broken into sub-commands first.
 */
function checkAllowedPattern(command: string, toolName: string | undefined, patterns: any[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  if (!command || typeof command !== "string") return false;

  // Normalise path separators once
  const normCommand = command.replace(/\\/g, "/");

  // Detect compound operators OUTSIDE of quoted strings.
  // Walk the string character by character, tracking whether we're inside
  // a single- or double-quoted token.  Only flag the command as compound if
  // we find &&, ||, | or ; while not inside quotes.
  function findUnquotedOperator(s: string): boolean {
    let inDouble = false;
    let inSingle = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
      if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
      if (inDouble || inSingle) continue;
      // Outside quotes — check for operators
      if (c === "&" && s[i + 1] === "&") return true;
      if (c === "|") return true;  // covers both | and ||
      if (c === ";") return true;
    }
    return false;
  }

  if (!findUnquotedOperator(normCommand)) {
    return matchesSinglePattern(normCommand, toolName, patterns);
  }

  // The command contains an unquoted compound operator.
  // FIRST: try an exact full-string match against stored non-wildcard patterns.
  // This handles the case where a user saved "always allow" for a compound command
  // verbatim (e.g. "gh issue view 9 | head -50" via the "Always Allow" ACP button).
  // The stored pattern IS the full compound string, so it must match itself exactly
  // without being broken into sub-commands.
  // We only do exact-match here (not wildcard prefix) — a wildcard like "cd X *"
  // must NOT short-circuit the split and bypass per-sub-command checking.
  if (matchesSinglePatternExact(normCommand, toolName, patterns)) {
    return true;
  }

  // Split on unquoted compound operators.
  // Walk again, emitting sub-command tokens between operators.
  function splitOnUnquotedOperators(s: string): string[] {
    const parts: string[] = [];
    let inDouble = false;
    let inSingle = false;
    let start = 0;
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '"' && !inSingle) { inDouble = !inDouble; i++; continue; }
      if (c === "'" && !inDouble) { inSingle = !inSingle; i++; continue; }
      if (inDouble || inSingle) { i++; continue; }
      // Check for && or ||
      if ((c === "&" && s[i + 1] === "&") || (c === "|" && s[i + 1] === "|")) {
        parts.push(s.slice(start, i).trim());
        i += 2; // skip both chars
        start = i;
        continue;
      }
      // Single | or ;
      if (c === "|" || c === ";") {
        parts.push(s.slice(start, i).trim());
        i++;
        start = i;
        continue;
      }
      i++;
    }
    // Remainder
    const last = s.slice(start).trim();
    if (last) parts.push(last);
    return parts.filter(Boolean);
  }

  const subCommands = splitOnUnquotedOperators(normCommand);

  // Every sub-command must be independently allowed
  return subCommands.every((sub) => matchesSinglePattern(sub, toolName, patterns));
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

  const thread = sqliteDb.getThreadById(threadId);
  if (!thread) return res.status(404).json({ error: "thread not found" });
  if (thread.pendingPermissionId === undefined) {
    return res.status(400).json({ error: "no pending permission" });
  }

  // If user selected "allow_always", save the exact tool command as a pattern
  // scoped to the specific tool so Bash patterns don't auto-approve Write ops.
  if (optionId === "allow_always" && toolCommand) {
    const existing = sqliteDb.getAllowedPatterns();
    const exists = existing.some(
      (p) => (p.pattern || (p as any)) === toolCommand && p.toolName === (toolName ?? undefined)
    );
    if (!exists) {
      const kind = toolName
        ? (["Write", "Edit", "MultiEdit", "Read"].includes(toolName) ? toolName.toLowerCase() : "execute")
        : "exact";
      sqliteDb.insertAllowedPattern({
        pattern: toolCommand,
        variant: kind as AllowSimilarPattern["variant"],
        toolName: toolName ?? undefined,
        createdAt: new Date().toISOString(),
      });
      logInfo("server", `Pattern saved (exact, tool=${toolName ?? "any"}): ${toolCommand}`, threadId);
    }
  }

  // Look up the workspace to get its path
  const workspace = sqliteDb.getWorkspaceById(thread.workspaceId);
  const wsPath = workspace?.path || thread.workspaceId;
  const agent = ClaudeAgent.getInstance(threadId, wsPath);
  wireAgent(agent, threadId);

  // Forward the optionId verbatim — it came from ACP's own options list
  agent.send({
    jsonrpc: "2.0",
    id: thread.pendingPermissionId,
    result: { outcome: { outcome: "selected", optionId } },
  });

  insertAndBroadcast(threadId, {
    id: newId("msg-perm"),
    threadId,
    timestamp: new Date().toISOString(),
    type: "permission_response",
    raw: { selected: { optionId } },
  }, {
    status: "thinking",
    pendingPermissionId: undefined,
    pendingPermissionOptions: undefined,
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
  const thread = sqliteDb.getThreadById(threadId);
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

  const thread = sqliteDb.getThreadById(threadId);
  if (!thread) return res.status(404).json({ error: "thread not found" });

  // If there's no active session, the async handler will catch cancelPending
  // when initialize() finishes. Mark idle and return — nothing else to do yet.
  if (!thread.sessionId) {
    sqliteDb.updateThreadStatus(threadId, "idle");
    return res.json({ ok: true });
  }

  const workspace = sqliteDb.getWorkspaceById(thread.workspaceId);
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

    insertAndBroadcast(threadId, {
      id: newId("msg-cancel-perm"),
      threadId,
      timestamp: new Date().toISOString(),
      type: "permission_response",
      raw: { selected: { optionId: "deny" } },
    }, {
      pendingPermissionId: undefined,
      pendingPermissionOptions: undefined,
    });
  }

  // Send session/cancel — use the thread's known sessionId, never a new one.
  // Also clear the pending flag since we're handling it here directly.
  cancelPending.delete(threadId);
  agent.cancel(thread.sessionId);

  insertAndBroadcast(threadId, {
    id: newId("msg-cancel"),
    threadId,
    timestamp: new Date().toISOString(),
    type: "system",
    raw: { text: "Agent turn cancelled by user" },
  }, {
    status: "idle",
    pendingPermissionId: undefined,
    pendingPermissionOptions: undefined,
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

// ---------------------------------------------------------------------------
// WebSocket handlers — bridge between WS messages and server logic
// ---------------------------------------------------------------------------

const wsHandlers: WsHandlers = {
  sendMessage: (threadId, text, clientMsgId, ws) => {
    const thread = sqliteDb.getThreadById(threadId);
    if (!thread) {
      ws.send(JSON.stringify({ type: "error", message: "thread not found", clientMsgId }));
      return;
    }

    const workspace = sqliteDb.getWorkspaceById(thread.workspaceId);
    if (!workspace) {
      ws.send(JSON.stringify({ type: "error", message: "workspace not found", clientMsgId }));
      return;
    }

    const wsPath = workspace.path;
    if (!fs.existsSync(wsPath)) {
      ws.send(JSON.stringify({ type: "error", message: `Workspace path no longer exists: ${wsPath}`, clientMsgId }));
      return;
    }

    const userMsg: Message = {
      id: newId("msg-user"),
      threadId,
      timestamp: new Date().toISOString(),
      raw: { role: "user", content: text },
      type: "user_message",
    };

    // Insert message + update thread atomically
    sqliteDb.runInTransaction(() => {
      sqliteDb.insertMessage(userMsg);
      sqliteDb.updateThread(threadId, { status: "thinking", lastError: undefined });
    });

    // Ack the client that sent the message, and broadcast to ALL subscribers
    broadcastAck(threadId, clientMsgId, userMsg);
    broadcastToThread(threadId, userMsg);
    broadcastThreadUpdate(threadId, { ...thread, status: "thinking", lastError: undefined });

    // Async: boot/resume agent and send prompt
    (async () => {
      logInfo("server", `WS async handler started, wsPath=${wsPath}`, threadId);
      try {
        const agent = ClaudeAgent.getInstance(threadId, wsPath);
        wireAgent(agent, threadId);

        const sessionId = await agent.initialize(thread.sessionId);
        const isResumingSession = thread.sessionId === sessionId && thread.sessionId !== undefined;

        if (!thread.sessionId) {
          sqliteDb.updateThread(threadId, { sessionId });
        }
        if (isResumingSession) {
          console.log(`[server] Resumed existing session ${sessionId} for thread ${threadId}`);
        } else {
          console.log(`[server] Created new session ${sessionId} for thread ${threadId}`);
        }

        if (cancelPending.has(threadId)) {
          cancelPending.delete(threadId);
          agent.markSessionReady();
          logInfo("server", `cancel was pending after initialize, aborting turn`, threadId);
          agent.cancel(sessionId);
          insertAndBroadcast(threadId, {
            id: newId("msg-cancel"),
            threadId,
            timestamp: new Date().toISOString(),
            type: "system",
            raw: { text: "Agent turn cancelled by user" },
          }, { status: "idle", pendingPermissionId: undefined, pendingPermissionOptions: undefined });
          return;
        }

        agent.markSessionReady();
        logInfo("server", `sending session/prompt...`, threadId);
        await agent.rpc("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text }],
        });
        logInfo("server", `session/prompt completed`, threadId);

        const updatedThread = sqliteDb.updateThreadStatus(threadId, "idle");
        if (updatedThread) broadcastThreadUpdate(threadId, updatedThread);
      } catch (err: any) {
        const updatedThread = insertAndBroadcast(threadId, {
          id: newId("msg-err"),
          threadId,
          timestamp: new Date().toISOString(),
          raw: { error: err.message },
          type: "error",
        }, { status: "idle" });
      }
    })();
  },

  respond: (threadId, optionId, toolCommand, toolName) => {
    if (optionId === "allow_similar") return;

    const thread = sqliteDb.getThreadById(threadId);
    if (!thread || thread.pendingPermissionId === undefined) return;

    if (optionId === "allow_always" && toolCommand) {
      const existing = sqliteDb.getAllowedPatterns();
      const exists = existing.some(
        (p) => (p.pattern || (p as any)) === toolCommand && p.toolName === (toolName ?? undefined)
      );
      if (!exists) {
        const kind = toolName
          ? (["Write", "Edit", "MultiEdit", "Read"].includes(toolName) ? toolName.toLowerCase() : "execute")
          : "exact";
        sqliteDb.insertAllowedPattern({
          pattern: toolCommand,
          variant: kind as AllowSimilarPattern["variant"],
          toolName: toolName ?? undefined,
          createdAt: new Date().toISOString(),
        });
      }
    }

    const workspace = sqliteDb.getWorkspaceById(thread.workspaceId);
    const wsPath = workspace?.path || thread.workspaceId;
    const agent = ClaudeAgent.getInstance(threadId, wsPath);
    wireAgent(agent, threadId);

    agent.send({
      jsonrpc: "2.0",
      id: thread.pendingPermissionId,
      result: { outcome: { outcome: "selected", optionId } },
    });

    insertAndBroadcast(threadId, {
      id: newId("msg-perm"),
      threadId,
      timestamp: new Date().toISOString(),
      type: "permission_response",
      raw: { selected: { optionId } },
    }, {
      status: "thinking",
      pendingPermissionId: undefined,
      pendingPermissionOptions: undefined,
    });
  },

  cancel: (threadId) => {
    logInfo("server", "WS cancel requested", threadId);
    cancelPending.add(threadId);

    const thread = sqliteDb.getThreadById(threadId);
    if (!thread) return;

    if (!thread.sessionId) {
      const updatedThread = sqliteDb.updateThreadStatus(threadId, "idle");
      if (updatedThread) broadcastThreadUpdate(threadId, updatedThread);
      return;
    }

    const workspace = sqliteDb.getWorkspaceById(thread.workspaceId);
    const wsPath = workspace?.path || thread.workspaceId;
    const agent = ClaudeAgent.getInstance(threadId, wsPath);
    wireAgent(agent, threadId);

    if (thread.pendingPermissionId !== undefined) {
      agent.send({
        jsonrpc: "2.0",
        id: thread.pendingPermissionId,
        result: { outcome: { outcome: "cancelled" } },
      });
      insertAndBroadcast(threadId, {
        id: newId("msg-cancel-perm"),
        threadId,
        timestamp: new Date().toISOString(),
        type: "permission_response",
        raw: { selected: { optionId: "deny" } },
      }, {
        pendingPermissionId: undefined,
        pendingPermissionOptions: undefined,
      });
    }

    cancelPending.delete(threadId);
    agent.cancel(thread.sessionId);

    insertAndBroadcast(threadId, {
      id: newId("msg-cancel"),
      threadId,
      timestamp: new Date().toISOString(),
      type: "system",
      raw: { text: "Agent turn cancelled by user" },
    }, {
      status: "idle",
      pendingPermissionId: undefined,
      pendingPermissionOptions: undefined,
    });
  },
};

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

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`Server on http://${HOST}:${PORT}`);
    initWebSocket(httpServer, getThreadWithMessages, newId, wsHandlers);
  });
}

// Don't auto-start the HTTP server (or boot Vite) when imported by tests.
if (process.env.NODE_ENV !== "test") {
  startServer();
}

export { app, sqliteDb, checkAllowedPattern };