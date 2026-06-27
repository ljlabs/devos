/**
 * index.ts
 *
 * In-process mock ACP server for Vitest integration tests.
 *
 * Instead of spawning a real @agentclientprotocol/claude-agent-acp subprocess,
 * we mock child_process.spawn to return a fake ChildProcess that speaks the
 * same ndJSON wire protocol. This lets ClaudeAgent.ts run unchanged while we
 * control all agent behavior from the test.
 *
 * Usage in tests:
 *   import { setupMockAcp } from "./mock-acp-server";
 *   const handle = await setupMockAcp();
 *   // claudeAgent.ts calls spawn() — our mock intercepts it
 *   // Push messages into the fake stdout to simulate agent responses
 */

import { Readable, Writable } from "stream";
import { EventEmitter } from "events";
import { vi } from "vitest";
import * as childProcess from "child_process";
import { scenarios, type Scenario, type ScenarioStep } from "./scenarios";

export interface MockAcpHandle {
  /** All JSON-RPC messages the agent wrote to stdin (requests from client) */
  received: any[];
  /** Push a JSON-RPC message into the fake stdout (agent → client) */
  push(msg: object): void;
  /** Find a received message by method name */
  findByMethod(method: string): any | undefined;
  /** Wait until a message with the given method has been received */
  waitForMethod(method: string, timeout?: number): Promise<any>;
  /** Restore the original spawn */
  restore(): void;
}

/**
 * Sets up a Vitest spy on child_process.spawn that returns a fake process.
 *
 * The fake process:
 * - Has writable stdin that captures ndJSON messages from ClaudeAgent
 * - Has readable stdout that we push ndJSON messages into (simulating agent)
 * - Emits "close" when kill() is called
 *
 * Returns a handle to control the mock and inspect messages.
 */
export async function setupMockAcp(): Promise<MockAcpHandle> {
  const received: any[] = [];
  let fakeProc: any = null;
  let stdout: Readable | null = null;

  const spawnSpy = vi.spyOn(await import("child_process"), "spawn").mockImplementation(
    (...args: any[]) => {
      stdout = new Readable({ read() {} });

      const stdin = new Writable({
        write(chunk, _encoding, cb) {
          const line = chunk.toString().trim();
          if (line) {
            try {
              received.push(JSON.parse(line));
            } catch {
              // ignore non-JSON
            }
          }
          cb();
        },
      });

      const stderr = new EventEmitter();

      fakeProc = {
        stdin,
        stdout,
        stderr,
        pid: 12345,
        kill: vi.fn(() => {
          stdout?.push(null);
        }),
        on: vi.fn(),
        once: vi.fn(),
        emit: vi.fn(),
      };

      // Wire the close event through the EventEmitter so ClaudeAgent can listen
      const origOn = fakeProc.on;
      fakeProc.on = function (event: string, cb: (...args: any[]) => void) {
        if (event === "close") {
          stdout!.on("end", () => cb(0));
        }
        // Always register on the underlying EventEmitter for other events
        EventEmitter.prototype.on.call(fakeProc, event, cb);
        return fakeProc;
      };

      return fakeProc;
    }
  );

  function push(msg: object) {
    if (stdout) {
      stdout.push(JSON.stringify(msg) + "\n");
    }
  }

  function findByMethod(method: string): any | undefined {
    return received.find((m: any) => m.method === method);
  }

  async function waitForMethod(method: string, timeout = 2000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const msg = findByMethod(method);
      if (msg) return msg;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`waitForMethod("${method}") timed out after ${timeout}ms`);
  }

  function restore() {
    spawnSpy.mockRestore();
  }

  return { received, push, findByMethod, waitForMethod, restore };
}

/**
 * Runs a full ACP scenario against a MockAcpHandle.
 * Drives the mock through all steps: responds to requests, emits notifications.
 */
export async function runScenario(
  handle: MockAcpHandle,
  scenarioName: string
): Promise<void> {
  const scenario = scenarios[scenarioName];
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioName}`);

  for (const step of scenario.steps) {
    // Wait for the client to send this method
    const msg = await handle.waitForMethod(step.method);

    // Emit any notifications before the response
    if (step.notifications) {
      for (const n of step.notifications) {
        handle.push(n);
      }
    }

    // Send response or error
    if (step.error) {
      handle.push({ jsonrpc: "2.0", id: msg.id, error: step.error });
    } else if (step.response) {
      handle.push({ jsonrpc: "2.0", id: msg.id, result: step.response });
    }
  }
}

/**
 * Handles a single prompt request — waits for session/prompt, emits notifications,
 * sends response. Useful when you want to drive the interaction step by step.
 */
export async function handlePrompt(
  handle: MockAcpHandle,
  options: {
    notifications?: any[];
    response?: any;
    error?: { code: number; message: string };
  } = {}
): Promise<any> {
  const msg = await handle.waitForMethod("session/prompt");

  if (options.notifications) {
    for (const n of options.notifications) {
      handle.push(n);
    }
  }

  if (options.error) {
    handle.push({ jsonrpc: "2.0", id: msg.id, error: options.error });
  } else {
    handle.push({
      jsonrpc: "2.0",
      id: msg.id,
      result: options.response ?? { stopReason: "end_turn" },
    });
  }

  return msg;
}

/**
 * Creates a session/request_permission message that the mock can send.
 * The client (server.ts) must respond with the user's choice.
 */
export function createPermissionRequest(
  sessionId: string,
  toolCallId: string,
  command: string,
  options: Array<{ optionId: string; kind: string; label: string }> = [
    { optionId: "allow_once", kind: "allow_once", label: "Allow" },
    { optionId: "deny", kind: "deny", label: "Deny" },
  ]
) {
  return {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 10000),
    method: "session/request_permission",
    params: {
      sessionId,
      toolCall: {
        toolCallId,
        kind: "execute",
        title: command,
        content: [{ type: "content", content: { type: "text", text: command } }],
      },
      options,
    },
  };
}
