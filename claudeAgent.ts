/**
 * claudeAgent.ts
 *
 * Thin wrapper around the ACP subprocess. Speaks raw JSON-RPC 2.0 in both
 * directions — no translation, no state machine, no permission logic.
 *
 * Public API
 * ----------
 * ClaudeAgent.getInstance(threadId, workspacePath)
 * ClaudeAgent.removeInstance(threadId)
 *
 * instance.send(msg)           – fire-and-forget outbound JSON-RPC
 * instance.rpc(method, params) – awaited outbound RPC (gets a response)
 * instance.kill()
 * instance.cancel(sessionId?)  – send session/cancel
 *
 * Events emitted:
 *   "message" (raw: object)  – every inbound JSON-RPC line from the subprocess
 *   "close"                  – subprocess exited
 */

import { spawn, ChildProcess } from "child_process";
import readline from "readline";
import { EventEmitter } from "events";
import fs from "fs";
import { logInfo, logError } from "./src/logger";

export class ClaudeAgent extends EventEmitter {
  // ---------------------------------------------------------------------------
  // Singleton per thread
  // ---------------------------------------------------------------------------

  private static instances = new Map<string, ClaudeAgent>();

  static getInstance(threadId: string, workspacePath: string): ClaudeAgent {
    let inst = this.instances.get(threadId);
    if (!inst) {
      inst = new ClaudeAgent(threadId, workspacePath);
      this.instances.set(threadId, inst);
    }
    return inst;
  }

  static removeInstance(threadId: string): void {
    const inst = this.instances.get(threadId);
    if (inst) {
      inst.kill();
      this.instances.delete(threadId);
    }
  }

  // ---------------------------------------------------------------------------
  // Instance
  // ---------------------------------------------------------------------------

  private proc: ChildProcess | null = null;
  private initialized = false;
  private pendingRpc = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private nextId = 1;
  // True while session/load is in-flight. The ACP subprocess replays the full
  // session history as session/update notifications during the load — suppress
  // them so they don't get re-persisted into the DB as duplicate messages.
  private suppressEmit = false;
  private rpcTimeoutMs = 30_000;

  constructor(
    private readonly threadId: string,
    private readonly workspacePath: string
  ) {
    super();
  }

  setRpcTimeout(ms: number): void {
    this.rpcTimeoutMs = ms;
  }

  // ---------------------------------------------------------------------------
  // Initialization (idempotent)
  //
  // Two distinct paths:
  //   - sessionId provided  → this thread already has a session; always resume
  //                           it via session/load. Never fall through to new.
  //   - no sessionId        → first message on this thread; create a new session.
  // ---------------------------------------------------------------------------

  async initialize(sessionId?: string): Promise<string> {
    logInfo("acp", `initialize() called, sessionId=${sessionId ?? "none"}, proc=${this.proc ? "alive" : "null"}, initialized=${this.initialized}`, this.threadId);
    if (!this.proc) this.spawnProcess();

    if (!this.initialized) {
      logInfo("acp", 'sending "initialize" RPC...', this.threadId);
      await this.rpc("initialize", {
        protocolVersion: 1,
        capabilities: { agent: {}, filesystem: {}, terminal: {} },
      });
      this.initialized = true;
      logInfo("acp", "initialized OK", this.threadId);
    }

    if (sessionId) {
      // Thread already has a session — load it. This must succeed; we never
      // silently replace an existing session with a new one.
      // Suppress message emission during session/load: the ACP subprocess
      // replays the full session history as session/update notifications, which
      // we've already persisted. Re-emitting them would create duplicates in DB.
      logInfo("acp", `sending "session/load" RPC with sessionId=${sessionId}...`, this.threadId);
      this.suppressEmit = true;
      try {
        await this.rpc("session/load", {
          sessionId,
          cwd: this.workspacePath,
          mcpServers: [],
        });
      } finally {
        this.suppressEmit = false;
      }
      logInfo("acp", "session loaded OK", this.threadId);
      return sessionId;
    }

    // No session yet — create one for this thread.
    logInfo("acp", 'sending "session/new" RPC...', this.threadId);
    const result = await this.rpc("session/new", {
      cwd: this.workspacePath,
      mcpServers: [],
      permissionMode: "default",
    }) as { sessionId: string };

    logInfo("acp", `session/new OK, sessionId=${result.sessionId}`, this.threadId);
    return result.sessionId;
  }

  // ---------------------------------------------------------------------------
  // Raw send (fire-and-forget, caller provides full message)
  // ---------------------------------------------------------------------------

  send(msg: object): void {
    logInfo("acp", `SEND: ${JSON.stringify(msg)}`, this.threadId);
    if (!this.proc) {
      logInfo("acp", "no proc, spawning...", this.threadId);
      this.spawnProcess();
    }
    this.proc!.stdin!.write(JSON.stringify(msg) + "\n");
    logInfo("acp", "SEND complete", this.threadId);
  }

  // ---------------------------------------------------------------------------
  // Awaited RPC (used for init; server can also use this for approve/deny)
  // ---------------------------------------------------------------------------

  rpc(method: string, params: unknown): Promise<unknown> {
    logInfo("acp", `RPC: ${method} ${JSON.stringify(params)}`, this.threadId);
    if (!this.proc) {
      logInfo("acp", "no proc for RPC, spawning...", this.threadId);
      this.spawnProcess();
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pendingRpc.delete(id);
        reject(new Error(`RPC "${method}" timed out after ${this.rpcTimeoutMs}ms`));
      }, this.rpcTimeoutMs);

      this.pendingRpc.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.proc!.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      logInfo("acp", `RPC sent: id=${id} method=${method}`, this.threadId);
    });
  }

  // ---------------------------------------------------------------------------
  // Cancel: send session/cancel to the ACP subprocess
  // ---------------------------------------------------------------------------

  cancel(sessionId?: string): void {
    logInfo("acp", `CANCEL, sessionId=${sessionId ?? "none"}`, this.threadId);
    this.send({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: sessionId ? { sessionId } : {},
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  kill(): void {
    logInfo("acp", "KILL", this.threadId);
    this.proc?.kill();
    this.proc = null;
    this.initialized = false;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private spawnProcess(): void {
    logInfo("acp", `SPAWN: npx -y @agentclientprotocol/claude-agent-acp in ${this.workspacePath}`, this.threadId);
    // On Windows, spawn with shell:true + args array triggers DEP0190 and can
    // fail with ENOENT on cmd.exe. Use the platform-specific npx binary instead
    // so we can keep shell:false and let the OS resolve the executable directly.
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "npx.cmd" : "npx";

    // Validate cwd exists — fall back to process.cwd() if not (e.g. Unix paths on Windows)
    const resolvedCwd = fs.existsSync(this.workspacePath) ? this.workspacePath : process.cwd();
    if (resolvedCwd !== this.workspacePath) {
      logInfo("acp", `WARNING: workspacePath "${this.workspacePath}" does not exist, falling back to "${resolvedCwd}"`, this.threadId);
    }

    this.proc = spawn(cmd, ["-y", "@agentclientprotocol/claude-agent-acp"], {
      cwd: resolvedCwd,
      shell: true,
      env: { ...process.env },
    });

    logInfo("acp", `process spawned, pid=${this.proc.pid}`, this.threadId);

    this.proc.on("error", (err) => {
      logError("acp", `SPAWN ERROR: ${err.message}`, this.threadId);
      this.rejectAllPending(err);
      this.proc = null;
      this.initialized = false;
      this.emit("close");
    });

    this.proc.on("exit", (code, signal) => {
      logInfo("acp", `PROCESS EXIT: code=${code} signal=${signal}`, this.threadId);
    });

    const rl = readline.createInterface({ input: this.proc.stdout!, terminal: false });

    rl.on("line", (line) => {
      logInfo("acp", `STDOUT: ${line}`, this.threadId);
      let msg: any;
      try { msg = JSON.parse(line); } catch {
        logInfo("acp", "non-JSON line, ignoring", this.threadId);
        return;
      }

      // Resolve pending awaited RPCs
      if ("id" in msg && ("result" in msg || "error" in msg)) {
        const pending = this.pendingRpc.get(msg.id);
        if (pending) {
          this.pendingRpc.delete(msg.id);
          logInfo("acp", `RPC response: id=${msg.id} ${msg.error ? `error=${JSON.stringify(msg.error)}` : "ok"}`, this.threadId);
          msg.error ? pending.reject(msg.error) : pending.resolve(msg.result);
          // Also emit so wireAgent can see stopReason, etc.
        }
      }

      // Everything else (inbound requests + notifications) bubbles up raw
      logInfo("acp", `EMIT message: ${msg.method ?? "response"}`, this.threadId);
      if (!this.suppressEmit) {
        this.emit("message", msg);
      } else {
        logInfo("acp", `SUPPRESSED (session/load replay): ${msg.method ?? "response"}`, this.threadId);
      }
    });

    this.proc.stderr!.on("data", (d) => {
      const text = d.toString().trim();
      if (text) logError("acp", `STDERR: ${text}`, this.threadId);
    });

    this.proc.on("close", (code) => {
      logInfo("acp", `PROCESS CLOSED: code=${code}`, this.threadId);
      this.rejectAllPending(new Error("ACP process exited"));
      this.proc = null;
      this.initialized = false;
      this.emit("close");
    });
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingRpc) {
      pending.reject(err);
    }
    this.pendingRpc.clear();
  }
}
