/**
 * claudeAgent.ts
 *
 * ACP subprocess wrapper with built-in permission state machine.
 * Implements the "allow similar" pattern system for tool auto-approval.
 *
 * Public API (Thin wrapper methods)
 * ---------------------------------
 * ClaudeAgent.getInstance(threadId, workspacePath, strategy?)
 * ClaudeAgent.removeInstance(threadId)
 *
 * instance.send(msg)           – fire-and-forget outbound JSON-RPC
 * instance.rpc(method, params) – awaited outbound RPC (gets a response)
 * instance.kill()
 * instance.cancel(sessionId?)  – send session/cancel
 *
 * Public API (Permission state machine methods)
 * -----------------------------------------------
 * instance.sendPrompt(text)              – fire a prompt and enter state machine
 * instance.getState()                    – current state: idle|initializing|thinking|awaiting_permission
 * instance.getPendingTool()              – tool waiting for approval
 * instance.approveCurrentTool()          – approve and resume
 * instance.denyCurrentTool()             – deny, cancel turn, and stop emitting
 *
 * Events emitted:
 *   "message" (raw: object)              – every inbound ACP line from subprocess
 *   "close"                              – subprocess exited
 *   "state" (state: AgentState)          – state machine transitions
 *   "tool_call" (call: ToolCall)         – tool execution started
 *   "tool_result" (result: ToolResult)   – tool execution completed
 *   "permission" (pending: PendingTool)  – permission gate hit, awaiting approval
 */

import { spawn, ChildProcess } from "child_process";
import readline from "readline";
import { EventEmitter } from "events";
import fs from "fs";
import { logInfo, logError } from "./src/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentState = "idle" | "initializing" | "thinking" | "awaiting_permission";

export interface ToolCall {
  command: string;
  toolName?: string;
}

export interface ToolResult {
  command: string;
  output: string;
  toolName?: string;
}

export interface PendingTool {
  input: string;
  toolName?: string;
}

// ---------------------------------------------------------------------------
// Permission Strategy
// ---------------------------------------------------------------------------

/**
 * Strategy for deciding if a tool command is auto-approved.
 * Subclass or provide a custom implementation.
 */
export interface IPermissionStrategy {
  isAllowed(command: string): boolean;
}

/**
 * Static pattern-based permission strategy.
 * Allows commands that prefix-match any pattern in the list.
 * Pattern "*" allows everything.
 */
export class StaticPermissionStrategy implements IPermissionStrategy {
  constructor(private patterns: string[]) {}

  isAllowed(command: string): boolean {
    // Handle null, undefined, or non-string commands safely
    if (!command || typeof command !== 'string') {
      return false;
    }
    
    if (this.patterns.includes("*")) return true;
    return this.patterns.some((pat) => command.startsWith(pat));
  }
}

// ---------------------------------------------------------------------------
// Main ClaudeAgent class
// ---------------------------------------------------------------------------

export class ClaudeAgent extends EventEmitter {
  // ---------------------------------------------------------------------------
  // Singleton per thread
  // ---------------------------------------------------------------------------

  private static instances = new Map<string, ClaudeAgent>();

  static getInstance(
    threadId: string,
    workspacePath: string,
    strategy?: IPermissionStrategy
  ): ClaudeAgent {
    let inst = this.instances.get(threadId);
    if (!inst) {
      inst = new ClaudeAgent(threadId, workspacePath, strategy);
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
  // Instance — Thin wrapper state
  // ---------------------------------------------------------------------------

  private proc: ChildProcess | null = null;
  private initialized = false;
  private pendingRpc = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private nextId = 1;
  private suppressEmit = false;
  private rpcTimeoutMs = 30_000;

  // ---------------------------------------------------------------------------
  // Instance — Permission state machine state
  // ---------------------------------------------------------------------------

  private strategy: IPermissionStrategy;
  private state: AgentState = "idle";
  private pendingTool: PendingTool | null = null;
  private suppressNotifications = false;
  private messageQueue: any[] = [];
  private currentSessionId: string | null = null;

  constructor(
    private readonly threadId: string,
    private readonly workspacePath: string,
    strategy?: IPermissionStrategy
  ) {
    super();
    this.strategy = strategy || new StaticPermissionStrategy([]);
  }

  // ---------------------------------------------------------------------------
  // State machine API
  // ---------------------------------------------------------------------------

  setRpcTimeout(ms: number): void {
    this.rpcTimeoutMs = ms;
  }

  getState(): AgentState {
    return this.state;
  }

  getPendingTool(): PendingTool | null {
    return this.pendingTool;
  }

  async sendPrompt(text: string): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`Cannot send prompt while in state "${this.state}"`);
    }

    this.setState("initializing");
    this.messageQueue = [];
    this.suppressNotifications = false;

    try {
      const sessionId = await this.initialize();
      this.currentSessionId = sessionId;

      // Clear the queue before entering thinking state
      this.messageQueue = [];
      this.setState("thinking");

      // Send prompt and await completion
      await this.rpc("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }],
      });

      // Drain any suppressed messages before going idle
      if (this.suppressNotifications) {
        this.suppressNotifications = false;
      }

      this.setState("idle");
    } catch (err: any) {
      logError("acp", `sendPrompt failed: ${err.message}`, this.threadId);
      this.setState("idle");
      throw err;
    }
  }

  async approveCurrentTool(): Promise<void> {
    if (!this.pendingTool) {
      throw new Error("No tool pending approval");
    }

    this.pendingTool = null;
    this.suppressNotifications = false;
    this.setState("thinking");

    // Drain any queued notifications that arrived while blocked
    for (const msg of this.messageQueue) {
      this.emit("message", msg);
    }
    this.messageQueue = [];
  }

  async denyCurrentTool(): Promise<void> {
    if (!this.pendingTool) {
      throw new Error("No tool pending approval");
    }

    this.pendingTool = null;
    this.suppressNotifications = true;

    if (this.currentSessionId) {
      this.cancel(this.currentSessionId);
    }

    // Drain queue without emitting anything
    this.messageQueue = [];
    this.setState("idle");
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
  // Private helpers
  // ---------------------------------------------------------------------------

  private setState(newState: AgentState): void {
    if (this.state !== newState) {
      logInfo("acp", `state transition: ${this.state} -> ${newState}`, this.threadId);
      this.state = newState;
      this.emit("state", newState);
    }
  }

  private dispatchIncoming(msg: any): void {
    const update = msg.params?.update;

    // Emit typed events for tool_call and tool_result so consumers
    // can listen on them directly — but always fall through to emit("message")
    // so wireAgent in server.ts sees every message unchanged.

    if (update?.sessionUpdate === "tool_call" && update?.status === "pending") {
      const command = update.rawInput?.command || "unknown";
      const toolName = update._meta?.claudeCode?.toolName;
      this.emit("tool_call", { command, toolName } as ToolCall);
    }

    if (update?.sessionUpdate === "tool_call_update" && update?.status === "completed") {
      const command = update.rawInput?.command || "unknown";
      const output = update.rawOutput || "";
      const toolName = update._meta?.claudeCode?.toolName;
      this.emit("tool_result", { command, output, toolName } as ToolResult);
    }

    // NOTE: do NOT suppress or queue here — server.ts wireAgent handles all
    // permission logic via the "message" event. The sendPrompt() state machine
    // is an alternative high-level API not used by server.ts.
  }

  // ---------------------------------------------------------------------------
  // Subprocess management
  // ---------------------------------------------------------------------------

  private spawnProcess(): void {
    logInfo("acp", `SPAWN: npx -y @agentclientprotocol/claude-agent-acp in ${this.workspacePath}`, this.threadId);
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "npx.cmd" : "npx";

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
      try {
        msg = JSON.parse(line);
      } catch {
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
        }
      }

      // Dispatch incoming message through state machine
      this.dispatchIncoming(msg);

      // Also emit raw for server.ts wireAgent compatibility
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
    for (const [, pending] of this.pendingRpc) {
      pending.reject(err);
    }
    this.pendingRpc.clear();
  }
}
