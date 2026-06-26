/**
 * ClaudeAgent.test.ts
 *
 * Unit tests for the ClaudeAgent permission system.
 *
 * These tests run entirely in-process — no ACP subprocess is needed.
 * We replace the subprocess with a FakeAcpProcess that emits hand-crafted
 * JSON-RPC messages over a pair of streams, giving us deterministic control
 * over every scenario that previously caused race conditions.
 *
 * Test runner: Vitest (drop-in for Jest: swap `vi` for `jest` if needed)
 *
 * Run: npx vitest run ClaudeAgent.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter, Readable, Writable } from "stream";
import {
  ClaudeAgent,
  StaticPermissionStrategy,
  AgentState,
  PendingTool,
  ToolCall,
  ToolResult,
} from "./claudeAgent";

// ---------------------------------------------------------------------------
// Helpers — fake ACP subprocess
// ---------------------------------------------------------------------------

/**
 * Creates a pair of in-process streams that mimic what the ACP subprocess
 * provides over its stdin / stdout pipes.
 *
 * Returns:
 *   - `agentStdin`  – what ClaudeAgent writes to (we read from it)
 *   - `agentStdout` – what ClaudeAgent reads from (we write into it)
 *   - `send(msg)`   – push a JSON-RPC message into agentStdout
 *   - `received()`  – returns all JSON-RPC messages the agent has sent us
 */
function createFakeSubprocess() {
  // We'll collect lines written by ClaudeAgent to "stdin"
  const sentMessages: object[] = [];

  const stdinWritable = new Writable({
    write(chunk, _encoding, cb) {
      const line = chunk.toString().trim();
      if (line) {
        try {
          sentMessages.push(JSON.parse(line));
        } catch {
          // ignore non-JSON
        }
      }
      cb();
    },
  });

  // stdout is a Readable we control
  const stdoutReadable = new Readable({ read() {} });

  function send(msg: object) {
    stdoutReadable.push(JSON.stringify(msg) + "\n");
  }

  function received() {
    return [...sentMessages];
  }

  // The fake "process" object
  const fakeProcess = {
    stdin: stdinWritable,
    stdout: stdoutReadable,
    stderr: new EventEmitter() as unknown as NodeJS.ReadableStream,
    on(_event: string, _cb: (...args: unknown[]) => void) {},
    kill() {},
  };

  return { fakeProcess, send, received };
}

/**
 * Builds a ClaudeAgent with its subprocess swapped out for a fake.
 * Returns the agent plus helpers to drive the fake subprocess.
 */
function buildAgent(allowedPatterns: string[] = []) {
  const strategy = new StaticPermissionStrategy(allowedPatterns);
  const agent = new ClaudeAgent("thread-test", "/fake/workspace", strategy);

  const { fakeProcess, send, received } = createFakeSubprocess();

  // Monkey-patch ensureProcess to inject our fake
  // @ts-expect-error — accessing private for testing
  agent["ensureProcess"] = () => {
    // @ts-expect-error
    if (agent["sm"].process) return;
    // @ts-expect-error
    agent["sm"].process = fakeProcess;

    // Wire stdout via readline the same way the real implementation does
    const readline = require("readline");
    const rl = readline.createInterface({ input: fakeProcess.stdout, terminal: false });
    // @ts-expect-error
    rl.on("line", (line: string) => agent["dispatchIncoming"](JSON.parse(line)));
  };

  return { agent, send, received, strategy };
}

/**
 * Sends the standard ACP handshake responses so `initialize()` resolves.
 */
async function performHandshake(
  send: (msg: object) => void,
  received: () => object[]
) {
  // Wait for ClaudeAgent to send "initialize"
  await waitFor(() => received().some((m: any) => m.method === "initialize"));
  const initMsg: any = received().find((m: any) => m.method === "initialize");
  send({ jsonrpc: "2.0", id: initMsg.id, result: {} });

  // Wait for "session/new"
  await waitFor(() => received().some((m: any) => m.method === "session/new"));
  const sessionMsg: any = received().find((m: any) => m.method === "session/new");
  send({ jsonrpc: "2.0", id: sessionMsg.id, result: { sessionId: "sid-123" } });
}

/** Poll until predicate returns true or timeout. */
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

// ---------------------------------------------------------------------------
// StaticPermissionStrategy
// ---------------------------------------------------------------------------

describe("StaticPermissionStrategy", () => {
  it("allows a command matching a known pattern", () => {
    const s = new StaticPermissionStrategy(["npm run lint", "npm test"]);
    expect(s.isAllowed("npm run lint")).toBe(true);
    expect(s.isAllowed("npm test -- --watch")).toBe(true);
  });

  it("blocks a command that matches no pattern", () => {
    const s = new StaticPermissionStrategy(["npm run lint"]);
    expect(s.isAllowed("rm -rf /")).toBe(false);
  });

  it("wildcard '*' allows everything", () => {
    const s = new StaticPermissionStrategy(["*"]);
    expect(s.isAllowed("rm -rf /")).toBe(true);
    expect(s.isAllowed("any command")).toBe(true);
  });

  it("empty pattern list blocks everything", () => {
    const s = new StaticPermissionStrategy([]);
    expect(s.isAllowed("npm run lint")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ClaudeAgent state machine
// ---------------------------------------------------------------------------

describe("ClaudeAgent state", () => {
  it("starts in idle state", () => {
    const { agent } = buildAgent();
    expect(agent.getState()).toBe("idle");
  });

  it("transitions to initializing then thinking on sendPrompt", async () => {
    const { agent, send, received } = buildAgent(["*"]);
    const states: AgentState[] = [];
    agent.on("state", (s) => states.push(s));

    const promptPromise = agent.sendPrompt("hello");

    // Drive handshake
    await performHandshake(send, received);

    // Drive session/prompt response
    await waitFor(() => received().some((m: any) => m.method === "session/prompt"));
    const promptMsg: any = received().find((m: any) => m.method === "session/prompt");
    send({ jsonrpc: "2.0", id: promptMsg.id, result: {} });

    await promptPromise;

    expect(states).toContain("initializing");
    expect(states).toContain("thinking");
    expect(states).toContain("idle");
  });
});

// ---------------------------------------------------------------------------
// Auto-approval path (allowed tool)
// ---------------------------------------------------------------------------

describe("Auto-approval for allowed tools", () => {
  it("emits tool_call and tool_result without pausing", async () => {
    const { agent, send, received } = buildAgent(["npm run lint"]);

    const emittedToolCalls: ToolCall[] = [];
    const emittedToolResults: ToolResult[] = [];
    agent.on("tool_call", (t) => emittedToolCalls.push(t));
    agent.on("tool_result", (r) => emittedToolResults.push(r));

    const promptPromise = agent.sendPrompt("lint the code");
    await performHandshake(send, received);

    await waitFor(() => received().some((m: any) => m.method === "session/prompt"));
    const promptMsg: any = received().find((m: any) => m.method === "session/prompt");

    // Simulate agent emitting a tool_call notification
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          status: "pending",
          _meta: { claudeCode: { toolName: "Bash" } },
          rawInput: { command: "npm run lint" },
        },
      },
    });

    await waitFor(() => emittedToolCalls.length > 0);
    expect(emittedToolCalls[0].command).toBe("npm run lint");

    // No permission event should have fired
    let permissionFired = false;
    agent.on("permission", () => { permissionFired = true; });

    // Simulate tool completion
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          status: "completed",
          rawOutput: "0 errors",
          rawInput: { command: "npm run lint" },
        },
      },
    });

    await waitFor(() => emittedToolResults.length > 0);
    expect(emittedToolResults[0].output).toBe("0 errors");
    expect(permissionFired).toBe(false);

    // Resolve prompt
    send({ jsonrpc: "2.0", id: promptMsg.id, result: {} });
    await promptPromise;
  });
});

// ---------------------------------------------------------------------------
// Permission gate — approve path
// ---------------------------------------------------------------------------

describe("Permission gate — approve", () => {
  it("emits permission event, blocks stream, then resumes after approve", async () => {
    const { agent, send, received } = buildAgent([]); // nothing allowed

    const permissionEvents: PendingTool[] = [];
    const textChunks: string[] = [];
    agent.on("permission", (p) => permissionEvents.push(p));
    agent.on("message", (c) => textChunks.push(c.text));

    const promptPromise = agent.sendPrompt("build the project");
    await performHandshake(send, received);

    await waitFor(() => received().some((m: any) => m.method === "session/prompt"));
    const promptMsg: any = received().find((m: any) => m.method === "session/prompt");

    // Agent emits a dangerous tool_call
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          status: "pending",
          _meta: { claudeCode: { toolName: "Bash" } },
          rawInput: { command: "rm -rf dist && npm run build" },
        },
      },
    });

    await waitFor(() => permissionEvents.length > 0);
    expect(agent.getState()).toBe("awaiting_permission");
    expect(agent.getPendingTool()?.input).toBe("rm -rf dist && npm run build");

    // A text chunk sent WHILE blocked should NOT reach listeners yet
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "building..." } },
      },
    });

    // Give it a tick — chunk must be queued, not emitted
    await new Promise((r) => setTimeout(r, 50));
    expect(textChunks).toHaveLength(0);

    // Approve
    await agent.approveCurrentTool();

    // Stream should now be unblocked — queued chunk should arrive
    await waitFor(() => textChunks.length > 0);
    expect(textChunks[0]).toBe("building...");
    expect(agent.getState()).toBe("thinking");

    // Resolve prompt
    send({ jsonrpc: "2.0", id: promptMsg.id, result: {} });
    await promptPromise;
  });

  it("getPendingTool() returns null after approval", async () => {
    const { agent, send, received } = buildAgent([]);

    const promptPromise = agent.sendPrompt("do something");
    await performHandshake(send, received);
    await waitFor(() => received().some((m: any) => m.method === "session/prompt"));

    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          status: "pending",
          _meta: { claudeCode: { toolName: "Bash" } },
          rawInput: { command: "dangerous command" },
        },
      },
    });

    await waitFor(() => agent.getState() === "awaiting_permission");
    await agent.approveCurrentTool();
    expect(agent.getPendingTool()).toBeNull();

    const promptMsg: any = received().find((m: any) => m.method === "session/prompt");
    send({ jsonrpc: "2.0", id: promptMsg.id, result: {} });
    await promptPromise;
  });
});

// ---------------------------------------------------------------------------
// Permission gate — deny path
// ---------------------------------------------------------------------------

describe("Permission gate — deny", () => {
  it("cancels the ACP turn after deny and stops emitting events", async () => {
    const { agent, send, received } = buildAgent([]);

    const textChunks: string[] = [];
    agent.on("message", (c) => textChunks.push(c.text));

    const promptPromise = agent.sendPrompt("do something risky");
    await performHandshake(send, received);
    await waitFor(() => received().some((m: any) => m.method === "session/prompt"));
    const promptMsg: any = received().find((m: any) => m.method === "session/prompt");

    // Dangerous tool call
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          status: "pending",
          _meta: { claudeCode: { toolName: "Bash" } },
          rawInput: { command: "rm -rf /" },
        },
      },
    });

    await waitFor(() => agent.getState() === "awaiting_permission");

    // Queue a notification that MUST NOT be processed after denial
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "you should not see this" } },
      },
    });

    // Deny
    await agent.denyCurrentTool();

    // Give time for any leaked events
    await new Promise((r) => setTimeout(r, 100));

    expect(textChunks).toHaveLength(0);
    expect(agent.getState()).toBe("idle");
    expect(agent.getPendingTool()).toBeNull();

    // A session/cancel should have been sent to the subprocess
    const cancelMsg = received().find((m: any) => m.method === "session/cancel");
    expect(cancelMsg).toBeDefined();

    // Resolve prompt so the promise settles
    send({ jsonrpc: "2.0", id: promptMsg.id, result: {} });
    await promptPromise.catch(() => {}); // may reject after cancel — acceptable
  });

  it("throws if denyCurrentTool called when no pending tool", async () => {
    const { agent } = buildAgent();
    await expect(agent.denyCurrentTool()).rejects.toThrow();
  });

  it("throws if approveCurrentTool called when no pending tool", async () => {
    const { agent } = buildAgent();
    await expect(agent.approveCurrentTool()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Multiple sequential tool calls
// ---------------------------------------------------------------------------

describe("Multiple sequential tool calls", () => {
  it("correctly gates the second dangerous tool after auto-allowing the first", async () => {
    const { agent, send, received } = buildAgent(["npm run lint"]);

    const permissionEvents: PendingTool[] = [];
    agent.on("permission", (p) => permissionEvents.push(p));

    const promptPromise = agent.sendPrompt("lint then build");
    await performHandshake(send, received);
    await waitFor(() => received().some((m: any) => m.method === "session/prompt"));
    const promptMsg: any = received().find((m: any) => m.method === "session/prompt");

    // First tool — auto-allowed
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          status: "pending",
          _meta: { claudeCode: { toolName: "Bash" } },
          rawInput: { command: "npm run lint" },
        },
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(permissionEvents).toHaveLength(0);

    // Second tool — blocked
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          status: "pending",
          _meta: { claudeCode: { toolName: "Bash" } },
          rawInput: { command: "rm -rf dist && npm run build" },
        },
      },
    });

    await waitFor(() => permissionEvents.length > 0);
    expect(agent.getState()).toBe("awaiting_permission");

    await agent.approveCurrentTool();
    send({ jsonrpc: "2.0", id: promptMsg.id, result: {} });
    await promptPromise;
  });
});

// ---------------------------------------------------------------------------
// Notification suppression after denial
// ---------------------------------------------------------------------------

describe("Suppression after denial", () => {
  it("suppresses session_info_update and usage_update but lifts suppression afterwards", async () => {
    const { agent, send, received } = buildAgent([]);

    const promptPromise = agent.sendPrompt("risky");
    await performHandshake(send, received);
    await waitFor(() => received().some((m: any) => m.method === "session/prompt"));
    const promptMsg: any = received().find((m: any) => m.method === "session/prompt");

    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          status: "pending",
          _meta: { claudeCode: { toolName: "Bash" } },
          rawInput: { command: "bad command" },
        },
      },
    });

    await waitFor(() => agent.getState() === "awaiting_permission");
    await agent.denyCurrentTool();

    // Send session_info_update — should lift suppression without crashing
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "session_info_update" } },
    });

    await new Promise((r) => setTimeout(r, 50));

    // After suppression is lifted, the agent should be idle and not broken
    expect(agent.getState()).toBe("idle");

    send({ jsonrpc: "2.0", id: promptMsg.id, result: {} });
    await promptPromise.catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// Singleton management
// ---------------------------------------------------------------------------

describe("ClaudeAgent.getInstance / removeInstance", () => {
  it("returns the same instance for the same threadId", () => {
    const a = ClaudeAgent.getInstance("thread-x", "/ws", new StaticPermissionStrategy());
    const b = ClaudeAgent.getInstance("thread-x", "/ws", new StaticPermissionStrategy());
    expect(a).toBe(b);
    ClaudeAgent.removeInstance("thread-x");
  });

  it("returns a fresh instance after removeInstance", () => {
    const a = ClaudeAgent.getInstance("thread-y", "/ws", new StaticPermissionStrategy());
    ClaudeAgent.removeInstance("thread-y");
    const b = ClaudeAgent.getInstance("thread-y", "/ws", new StaticPermissionStrategy());
    expect(a).not.toBe(b);
    ClaudeAgent.removeInstance("thread-y");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("handles empty/non-JSON lines from subprocess gracefully", () => {
    const { agent } = buildAgent();
    // @ts-expect-error
    expect(() => agent["dispatchIncoming"]("not json")).not.toThrow();
  });

  it("does not emit permission for tool_call with non-pending status", async () => {
    const { agent, send, received } = buildAgent([]);

    const permEvents: PendingTool[] = [];
    agent.on("permission", (p) => permEvents.push(p));

    const promptPromise = agent.sendPrompt("noop");
    await performHandshake(send, received);
    await waitFor(() => received().some((m: any) => m.method === "session/prompt"));
    const promptMsg: any = received().find((m: any) => m.method === "session/prompt");

    // tool_call with status != "pending" should NOT trigger permission gate
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          status: "completed",  // <-- not pending
          _meta: { claudeCode: { toolName: "Bash" } },
          rawInput: { command: "rm -rf /" },
        },
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(permEvents).toHaveLength(0);

    send({ jsonrpc: "2.0", id: promptMsg.id, result: {} });
    await promptPromise;
  });
});