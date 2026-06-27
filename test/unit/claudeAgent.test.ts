import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable, Writable } from "stream";
import { EventEmitter } from "events";
import readline from "readline";
import { ClaudeAgent } from "../../claudeAgent";

// Suppress console output
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

let mockStdout: Readable;
let mockStdin: Writable;
let mockProc: any;

function createMockProc() {
  mockStdout = new Readable({ read() {} });
  mockStdin = new Writable({
    write(chunk, _encoding, cb) { cb(); },
  });
  const stderr = new EventEmitter();
  const listeners: Record<string, Function[]> = {};

  mockProc = {
    stdin: mockStdin,
    stdout: mockStdout,
    stderr,
    pid: 12345,
    kill: vi.fn(),
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      return mockProc;
    }),
    emit: vi.fn((event: string, ...args: any[]) => {
      if (listeners[event]) {
        listeners[event].forEach((cb) => cb(...args));
      }
    }),
  };

  // When stdout ends, emit "close" on the process
  mockStdout.on("end", () => {
    if (listeners["close"]) {
      listeners["close"].forEach((cb) => cb(0));
    }
  });

  return mockProc;
}

function injectProc(agent: ClaudeAgent, proc: any) {
  (agent as any).proc = proc;

  // Wire readline on stdout just like spawnProcess() does
  const rl = readline.createInterface({ input: proc.stdout, terminal: false });
  rl.on("line", (line: string) => {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }

    // Resolve pending RPCs
    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const pending = (agent as any).pendingRpc.get(msg.id);
      if (pending) {
        (agent as any).pendingRpc.delete(msg.id);
        msg.error ? pending.reject(msg.error) : pending.resolve(msg.result);
        return;
      }
    }

    // Emit everything else as a message event
    agent.emit("message", msg);
  });

  // Wire close event
  proc.stdout.on("end", () => {
    (agent as any).proc = null;
    (agent as any).initialized = false;
    agent.emit("close");
  });
}

function pushToStdout(msg: object) {
  mockStdout.push(JSON.stringify(msg) + "\n");
}

async function waitFor(
  predicate: () => boolean,
  timeout = 2000,
  interval = 10
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, interval));
  }
}

function trackStdin(): any[] {
  const written: any[] = [];
  const origWrite = mockStdin.write.bind(mockStdin);
  mockStdin.write = function (chunk: any, ...args: any[]) {
    const line = chunk.toString().trim();
    if (line) {
      try { written.push(JSON.parse(line)); } catch {}
    }
    return origWrite(chunk, ...args);
  };
  return written;
}

describe("ClaudeAgent", () => {
  beforeEach(() => {
    (ClaudeAgent as any).instances.clear();
    createMockProc();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Singleton management", () => {
    it("returns the same instance for the same threadId", () => {
      const a = ClaudeAgent.getInstance("thread-1", "/ws");
      const b = ClaudeAgent.getInstance("thread-1", "/ws");
      expect(a).toBe(b);
    });

    it("returns different instances for different threadIds", () => {
      const a = ClaudeAgent.getInstance("thread-1", "/ws");
      const b = ClaudeAgent.getInstance("thread-2", "/ws");
      expect(a).not.toBe(b);
    });

    it("removeInstance kills and removes the agent", () => {
      const agent = ClaudeAgent.getInstance("thread-rm", "/ws");
      injectProc(agent, mockProc);
      ClaudeAgent.removeInstance("thread-rm");
      expect(mockProc.kill).toHaveBeenCalled();

      const agent2 = ClaudeAgent.getInstance("thread-rm", "/ws");
      expect(agent2).not.toBe(agent);
    });

    it("removeInstance for nonexistent thread is a no-op", () => {
      expect(() => ClaudeAgent.removeInstance("nonexistent")).not.toThrow();
    });
  });

  describe("kill()", () => {
    it("calls kill on the child process and resets state", () => {
      const agent = ClaudeAgent.getInstance("thread-kill", "/ws");
      injectProc(agent, mockProc);
      (agent as any).initialized = true;
      agent.kill();
      expect(mockProc.kill).toHaveBeenCalled();
      expect((agent as any).proc).toBeNull();
      expect((agent as any).initialized).toBe(false);
    });
  });

  describe("send()", () => {
    it("writes JSON-RPC message to stdin", () => {
      const written = trackStdin();
      const agent = ClaudeAgent.getInstance("thread-send", "/ws");
      injectProc(agent, mockProc);
      const msg = { jsonrpc: "2.0", method: "session/prompt", params: { text: "hello" } };
      agent.send(msg);

      expect(written).toHaveLength(1);
      expect(written[0]).toEqual(msg);
    });
  });

  describe("rpc()", () => {
    it("sends request and resolves when response arrives", async () => {
      const written = trackStdin();
      const agent = ClaudeAgent.getInstance("thread-rpc", "/ws");
      injectProc(agent, mockProc);
      const resultPromise = agent.rpc("initialize", { protocolVersion: 1 });

      const request = written.find((m) => m.method === "initialize");
      expect(request).toBeDefined();

      pushToStdout({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: 1 } });

      const result = await resultPromise;
      expect(result).toEqual({ protocolVersion: 1 });
    });

    it("rejects when error response arrives", async () => {
      const written = trackStdin();
      const agent = ClaudeAgent.getInstance("thread-rpc-err", "/ws");
      injectProc(agent, mockProc);
      const resultPromise = agent.rpc("session/new", {});

      const request = written.find((m) => m.method === "session/new");

      pushToStdout({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message: "Internal error" },
      });

      await expect(resultPromise).rejects.toEqual({
        code: -32603,
        message: "Internal error",
      });
    });
  });

  describe("initialize()", () => {
    it("calls initialize then session/new", async () => {
      const written = trackStdin();
      const agent = ClaudeAgent.getInstance("thread-init", "/ws");
      injectProc(agent, mockProc);
      const initPromise = agent.initialize();

      // Wait for initialize request
      await waitFor(() => written.some((m) => m.method === "initialize"));
      const initReq = written.find((m) => m.method === "initialize");
      pushToStdout({ jsonrpc: "2.0", id: initReq.id, result: {} });

      // Wait for session/new request
      await waitFor(() => written.some((m) => m.method === "session/new"));
      const newReq = written.find((m) => m.method === "session/new");
      pushToStdout({ jsonrpc: "2.0", id: newReq.id, result: { sessionId: "sid-abc" } });

      const sessionId = await initPromise;
      expect(sessionId).toBe("sid-abc");
    });

    it("attempts session/load before session/new when sessionId provided", async () => {
      const written = trackStdin();
      const agent = ClaudeAgent.getInstance("thread-init-load", "/ws");
      injectProc(agent, mockProc);
      const initPromise = agent.initialize("existing-sid");

      await waitFor(() => written.some((m) => m.method === "initialize"));
      const initReq = written.find((m) => m.method === "initialize");
      pushToStdout({ jsonrpc: "2.0", id: initReq.id, result: {} });

      await waitFor(() => written.some((m) => m.method === "session/load"));
      const loadReq = written.find((m) => m.method === "session/load");
      pushToStdout({ jsonrpc: "2.0", id: loadReq.id, result: { sessionId: "existing-sid" } });

      const sessionId = await initPromise;
      expect(sessionId).toBe("existing-sid");
    });

    it("falls through to session/new when session/load fails", async () => {
      const written = trackStdin();
      const agent = ClaudeAgent.getInstance("thread-init-fallback", "/ws");
      injectProc(agent, mockProc);
      const initPromise = agent.initialize("bad-sid");

      await waitFor(() => written.some((m) => m.method === "initialize"));
      const initReq = written.find((m) => m.method === "initialize");
      pushToStdout({ jsonrpc: "2.0", id: initReq.id, result: {} });

      await waitFor(() => written.some((m) => m.method === "session/load"));
      const loadReq = written.find((m) => m.method === "session/load");
      pushToStdout({
        jsonrpc: "2.0",
        id: loadReq.id,
        error: { code: -32603, message: "session not found" },
      });

      await waitFor(() => written.some((m) => m.method === "session/new"));
      const newReq = written.find((m) => m.method === "session/new");
      pushToStdout({ jsonrpc: "2.0", id: newReq.id, result: { sessionId: "new-sid" } });

      const sessionId = await initPromise;
      expect(sessionId).toBe("new-sid");
    });
  });

  describe("message events", () => {
    it("emits message event for non-RPC messages", async () => {
      const agent = ClaudeAgent.getInstance("thread-events", "/ws");
      injectProc(agent, mockProc);
      const messages: any[] = [];
      agent.on("message", (msg) => messages.push(msg));

      pushToStdout({
        jsonrpc: "2.0",
        method: "session/update",
        params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } } },
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(messages).toHaveLength(1);
      expect(messages[0].method).toBe("session/update");
    });

    it("emits close event when process exits", async () => {
      const agent = ClaudeAgent.getInstance("thread-close", "/ws");
      injectProc(agent, mockProc);
      let closed = false;
      agent.on("close", () => { closed = true; });

      mockStdout.push(null);

      await new Promise((r) => setTimeout(r, 50));
      expect(closed).toBe(true);
    });
  });
});
