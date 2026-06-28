/**
 * fakeProcess.ts
 *
 * In-process mock ACP process for unit tests.
 * Returns fake ChildProcess-like streams without spawning a real subprocess.
 * Speaks the same ndJSON wire protocol as the real @agentclientprotocol/claude-agent-acp.
 */

import { Readable, Writable } from "stream";
import { EventEmitter } from "events";

export interface AcpScenario {
  /** Called when a JSON-RPC request arrives. Return a response or notifications to emit. */
  handleRequest?: (msg: any) => any;
  /** Notifications to emit after initialize completes */
  postInit?: any[];
  /** Notifications to emit after session/new completes */
  postSessionNew?: any[];
}

export interface FakeAcpProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: EventEmitter;
  kill(): void;
  /** All messages written to stdin (parsed) */
  receivedMessages: any[];
  /** Push raw JSON-RPC message into stdout (simulate agent sending to client) */
  pushMessage(msg: object): void;
}

/**
 * Creates an in-process fake ACP process.
 * The caller controls timing by calling pushMessage() to simulate agent responses.
 */
export function createFakeAcpProcess(): FakeAcpProcess {
  const receivedMessages: any[] = [];

  const stderr = new EventEmitter();

  const stdin = new Writable({
    write(chunk, _encoding, cb) {
      const line = chunk.toString().trim();
      if (line) {
        try {
          const msg = JSON.parse(line);
          receivedMessages.push(msg);
        } catch {
          // ignore non-JSON
        }
      }
      cb();
    },
  });

  const stdout = new Readable({ read() {} });

  let killed = false;

  function pushMessage(msg: object) {
    if (!killed) {
      stdout.push(JSON.stringify(msg) + "\n");
    }
  }

  function kill() {
    killed = true;
    stdout.push(null);
  }

  return { stdin, stdout, stderr, kill, receivedMessages, pushMessage };
}

/**
 * Builds a mock scenario that handles the standard ACP lifecycle:
 * initialize → session/new → session/prompt → session/update notifications → response
 *
 * Returns the fake process and helpers to drive the interaction.
 */
export function buildMockScenario() {
  const fp = createFakeAcpProcess();
  let pendingId = 1;

  function respond(id: number, result: any) {
    fp.pushMessage({ jsonrpc: "2.0", id, result });
  }

  function notify(method: string, params: any) {
    fp.pushMessage({ jsonrpc: "2.0", method, params });
  }

  /**
   * Process one incoming JSON-RPC request and emit appropriate responses.
   * Returns the method name for the caller to assert on.
   */
  function handleNextRequest(
    response: any = {},
    notifications: any[] = []
  ): Promise<string> {
    // Wait a tick for the message to arrive
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        const msg = fp.receivedMessages[fp.receivedMessages.length - 1];
        if (!msg) {
          resolve("no_message");
          return;
        }

        // Emit any notifications first
        for (const n of notifications) {
          fp.pushMessage(n);
        }

        // Send response
        if (msg.id !== undefined) {
          respond(msg.id, response);
        }

        resolve(msg.method || "unknown");
      }, 10);
    });
  }

  return { fp, respond, notify, handleNextRequest };
}
