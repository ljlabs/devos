import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable, Writable } from "stream";
import { EventEmitter } from "events";
import readline from "readline";
import { ClaudeAgent } from "../../server_src/claudeAgent";

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

  // Register error handler (from spawnProcess)
  proc.on("error", (err: any) => {
    (agent as any).rejectAllPending(err);
    (agent as any).proc = null;
    (agent as any).initialized = false;
    agent.emit("close");
  });

  // Register close handler (from spawnProcess)
  proc.on("close", (code: any) => {
    (agent as any).rejectAllPending(new Error("ACP process exited"));
    (agent as any).proc = null;
    (agent as any).initialized = false;
    agent.emit("close");
  });

  // Wire close event when stdout ends
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

    it("rejects when session/load fails", async () => {
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

      // The promise should reject with the error
      await expect(initPromise).rejects.toEqual({
        code: -32603,
        message: "session not found",
      });

      // Verify that session/new was NOT called (no fallthrough)
      await new Promise((r) => setTimeout(r, 100));
      expect(written.some((m) => m.method === "session/new")).toBe(false);
    });

    it("is idempotent — second call skips initialize RPC", async () => {
      const written = trackStdin();
      const agent = ClaudeAgent.getInstance("thread-init-idem", "/ws");
      injectProc(agent, mockProc);

      // First initialization
      const init1 = agent.initialize();
      await waitFor(() => written.some((m) => m.method === "initialize"));
      const initReq1 = written.find((m) => m.method === "initialize");
      pushToStdout({ jsonrpc: "2.0", id: initReq1.id, result: {} });

      await waitFor(() => written.some((m) => m.method === "session/new"));
      const newReq1 = written.find((m) => m.method === "session/new");
      pushToStdout({ jsonrpc: "2.0", id: newReq1.id, result: { sessionId: "sid-1" } });

      const sid1 = await init1;
      expect(sid1).toBe("sid-1");

      // Count how many times initialize was sent
      const initCount = written.filter((m) => m.method === "initialize").length;
      expect(initCount).toBe(1);

      // Second initialization should skip the initialize RPC and go straight to session/new
      const init2 = agent.initialize();

      // Verify no new initialize RPC was sent
      await new Promise((r) => setTimeout(r, 100));
      const initCountAfter = written.filter((m) => m.method === "initialize").length;
      expect(initCountAfter).toBe(1); // Still 1, not 2

      // Complete the second init
      const newReq2 = written.find(
        (m, idx) => m.method === "session/new" && idx > written.indexOf(newReq1!)
      );
      if (newReq2) {
        pushToStdout({ jsonrpc: "2.0", id: newReq2.id, result: { sessionId: "sid-2" } });
      }

      const sid2 = await init2;
      expect(sid2).toBe("sid-2");
    });

    it("already-loaded session does not call initialize RPC again", async () => {
      const written = trackStdin();
      const agent = ClaudeAgent.getInstance("thread-init-loaded", "/ws");
      injectProc(agent, mockProc);

      // First init to get a sessionId
      const init1 = agent.initialize();
      await waitFor(() => written.some((m) => m.method === "initialize"));
      const initReq = written.find((m) => m.method === "initialize");
      pushToStdout({ jsonrpc: "2.0", id: initReq.id, result: {} });

      await waitFor(() => written.some((m) => m.method === "session/new"));
      const newReq = written.find((m) => m.method === "session/new");
      pushToStdout({ jsonrpc: "2.0", id: newReq.id, result: { sessionId: "existing-sid" } });

      const sessionId = await init1;

      // Clear written to track only the second init
      written.length = 0;

      // Second init with the existing sessionId — should not call initialize again
      const init2 = agent.initialize(sessionId);

      await waitFor(() => written.some((m) => m.method === "session/load"));
      const loadReq = written.find((m) => m.method === "session/load");
      pushToStdout({ jsonrpc: "2.0", id: loadReq.id, result: { sessionId } });

      const result = await init2;
      expect(result).toBe(sessionId);

      // Verify initialize was NOT called in this second batch
      const initCallCount = written.filter((m) => m.method === "initialize").length;
      expect(initCallCount).toBe(0);
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
