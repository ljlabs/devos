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
 *
 * Events emitted:
 *   "message" (raw: object)  – every inbound JSON-RPC line from the subprocess
 *   "close"                  – subprocess exited
 */

import { spawn, ChildProcess } from "child_process";
import readline from "readline";
import { EventEmitter } from "events";

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

  constructor(
    private readonly threadId: string,
    private readonly workspacePath: string
  ) {
    super();
  }

  // ---------------------------------------------------------------------------
  // Initialization (idempotent)
  // ---------------------------------------------------------------------------

  async initialize(sessionId?: string): Promise<string> {
    if (!this.proc) this.spawnProcess();

    if (!this.initialized) {
      await this.rpc("initialize", {
        protocolVersion: 1,
        capabilities: { agent: {}, filesystem: {}, terminal: {} },
      });
      this.initialized = true;
    }

    if (sessionId) {
      try {
        await this.rpc("session/load", { sessionId });
        return sessionId;
      } catch {
        // fall through to new session
      }
    }

    const result = await this.rpc("session/new", {
      cwd: this.workspacePath,
      mcpServers: [],
      permissionMode: "default",
    }) as { sessionId: string };

    return result.sessionId;
  }

  // ---------------------------------------------------------------------------
  // Raw send (fire-and-forget, caller provides full message)
  // ---------------------------------------------------------------------------

  send(msg: object): void {
    console.log("[SEND_MESSAGE]", msg);
    if (!this.proc) throw new Error("Process not started");
    this.proc.stdin!.write(JSON.stringify(msg) + "\n");
  }

  // ---------------------------------------------------------------------------
  // Awaited RPC (used for init; server can also use this for approve/deny)
  // ---------------------------------------------------------------------------

  rpc(method: string, params: unknown): Promise<unknown> {
    if (!this.proc) this.spawnProcess();
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pendingRpc.set(id, { resolve, reject });
      this.proc!.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  kill(): void {
    this.proc?.kill();
    this.proc = null;
    this.initialized = false;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private spawnProcess(): void {
    this.proc = spawn("npx", ["-y", "@agentclientprotocol/claude-agent-acp"], {
      cwd: this.workspacePath,
      shell: true,
      env: { ...process.env },
    });

    const rl = readline.createInterface({ input: this.proc.stdout!, terminal: false });

    rl.on("line", (line) => {
      console.log("[LINE]", line)
      let msg: any;
      try { msg = JSON.parse(line); } catch { return; }

      // Resolve pending awaited RPCs
      if ("id" in msg && ("result" in msg || "error" in msg)) {
        const pending = this.pendingRpc.get(msg.id);
        if (pending) {
          this.pendingRpc.delete(msg.id);
          msg.error ? pending.reject(msg.error) : pending.resolve(msg.result);
          return; // don't also emit — these are internal handshakes
        }
      }

      // Everything else (inbound requests + notifications) bubbles up raw
      this.emit("message", msg);
    });

    this.proc.stderr!.on("data", (d) => console.error(`[acp:${this.threadId}]`, d.toString()));

    this.proc.on("close", () => {
      this.proc = null;
      this.initialized = false;
      this.emit("close");
    });
  }
}