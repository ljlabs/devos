/**
 * wsServer.ts
 *
 * WebSocket server for real-time message delivery.
 * Attaches to the existing Express HTTP server and manages
 * per-thread subscriptions so clients only receive messages
 * for threads they're interested in.
 */

import { WebSocketServer as WSServer, WebSocket } from "ws";
import type { Server } from "http";
import type { Message, Thread } from "../src/types";
import { logInfo } from "../src/logger";
import { terminalManager } from "./terminal";
import os from "os";

// ---------------------------------------------------------------------------
// Subscription tracking
// ---------------------------------------------------------------------------

/** threadId → set of connected WebSocket clients */
const threadSubscribers = new Map<string, Set<WebSocket>>();

/** WebSocket → set of threadIds it's subscribed to */
const clientSubscriptions = new Map<WebSocket, Set<string>>();

/** terminalId → the WebSocket currently receiving its output */
const terminalClients = new Map<string, WebSocket>();

// ---------------------------------------------------------------------------
// Handler callbacks — provided by server.ts to avoid circular imports
// ---------------------------------------------------------------------------

export interface WsHandlers {
  /** Handle a user message sent via WebSocket */
  sendMessage(threadId: string, text: string, clientMsgId: string, ws: WebSocket): void;
  /** Handle a permission response sent via WebSocket */
  respond(threadId: string, optionId: string, toolCommand?: string, toolName?: string): void;
  /** Handle a cancel request sent via WebSocket */
  cancel(threadId: string): void;
}

let handlers: WsHandlers = {
  sendMessage: () => {},
  respond: () => {},
  cancel: () => {},
};

// ---------------------------------------------------------------------------
// Broadcast functions — called from server.ts after DB writes
// ---------------------------------------------------------------------------

export function broadcastToThread(threadId: string, message: Message): void {
  const subscribers = threadSubscribers.get(threadId);
  if (!subscribers) return;

  const payload = JSON.stringify({ type: "message", threadId, message });
  for (const ws of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

export function broadcastThreadUpdate(threadId: string, thread: Thread): void {
  const subscribers = threadSubscribers.get(threadId);
  if (!subscribers) return;

  const payload = JSON.stringify({ type: "thread_update", threadId, thread });
  for (const ws of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

export function broadcastAck(threadId: string, clientMsgId: string, message: Message): void {
  const subscribers = threadSubscribers.get(threadId);
  if (!subscribers) return;

  const payload = JSON.stringify({ type: "ack", threadId, clientMsgId, message });
  for (const ws of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function sendJson(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function subscribeClient(ws: WebSocket, threadId: string, readDb: (threadId: string) => { thread: Thread | undefined; messages: Message[] }): void {
  let subs = clientSubscriptions.get(ws);
  if (!subs) {
    subs = new Set();
    clientSubscriptions.set(ws, subs);
  }
  subs.add(threadId);

  let subscribers = threadSubscribers.get(threadId);
  if (!subscribers) {
    subscribers = new Set();
    threadSubscribers.set(threadId, subscribers);
  }
  subscribers.add(ws);

  // Send current state for the thread — targeted query, not full DB read
  const { thread, messages } = readDb(threadId);

  sendJson(ws, {
    type: "subscribed",
    threadId,
    messages: [],
    thread: thread ?? null,
  });

  logInfo("ws", `client subscribed to thread ${threadId}`, threadId);
}

function unsubscribeClient(ws: WebSocket, threadId: string): void {
  const subs = clientSubscriptions.get(ws);
  if (subs) {
    subs.delete(threadId);
    if (subs.size === 0) {
      clientSubscriptions.delete(ws);
    }
  }

  const subscribers = threadSubscribers.get(threadId);
  if (subscribers) {
    subscribers.delete(ws);
    if (subscribers.size === 0) {
      threadSubscribers.delete(threadId);
    }
  }

  logInfo("ws", `client unsubscribed from thread ${threadId}`, threadId);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function initWebSocket(
  httpServer: Server,
  readDb: (threadId: string) => { thread: Thread | undefined; messages: Message[] },
  newId: (prefix: string) => string,
  wsHandlers: WsHandlers,
): WSServer {
  handlers = wsHandlers;

  const wss = new WSServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    logInfo("ws", "new WebSocket connection", "global");

    ws.on("message", (data) => {
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        sendJson(ws, { type: "error", message: "invalid JSON" });
        return;
      }

      switch (msg.type) {
        case "subscribe": {
          const threadId = msg.threadId as string;
          if (!threadId) {
            sendJson(ws, { type: "error", message: "threadId required" });
            return;
          }
          // Unsubscribe from all other threads first (single-thread focus)
          const existing = clientSubscriptions.get(ws);
          if (existing) {
            for (const tid of existing) {
              unsubscribeClient(ws, tid);
            }
          }
          subscribeClient(ws, threadId, readDb);
          break;
        }

        case "unsubscribe": {
          const threadId = msg.threadId as string;
          if (threadId) unsubscribeClient(ws, threadId);
          break;
        }

        case "send_message": {
          const { threadId, text, clientMsgId } = msg;
          if (!threadId || !text || !clientMsgId) {
            sendJson(ws, { type: "error", message: "threadId, text, and clientMsgId required" });
            return;
          }
          handlers.sendMessage(threadId, text, clientMsgId, ws);
          break;
        }

        case "respond": {
          const { threadId, optionId, toolCommand, toolName } = msg;
          if (!threadId || !optionId) {
            sendJson(ws, { type: "error", message: "threadId and optionId required" });
            return;
          }
          handlers.respond(threadId, optionId, toolCommand, toolName);
          break;
        }

        case "cancel": {
          const { threadId } = msg;
          if (!threadId) {
            sendJson(ws, { type: "error", message: "threadId required" });
            return;
          }
          handlers.cancel(threadId);
          break;
        }

        // -----------------------------------------------------------------
        // Terminal messages — PTY sessions managed via WebSocket
        // -----------------------------------------------------------------

        case "terminal_create": {
          const { terminalId, cwd, cols, rows } = msg;
          if (!terminalId) {
            sendJson(ws, { type: "error", message: "terminalId required" });
            return;
          }

          // If terminal already exists, just re-wire output to this client
          if (terminalManager.has(terminalId)) {
            terminalClients.set(terminalId, ws);
            logInfo("ws", `terminal reconnected: ${terminalId}`, "global");
            sendJson(ws, { type: "terminal_created", terminalId });
            break;
          }

          const termCwd = cwd || os.homedir();
          terminalManager.create(terminalId, termCwd, cols || 80, rows || 24);
          logInfo("ws", `terminal created: ${terminalId} (cwd=${termCwd})`, "global");

          // Wire PTY output back to this WebSocket client
          const session = terminalManager.get(terminalId);
          if (session) {
            session.pty.onData((data: string) => {
              const client = terminalClients.get(terminalId);
              if (client) sendJson(client, { type: "terminal_output", terminalId, data });
            });
            session.pty.onExit(({ exitCode }: { exitCode: number }) => {
              const client = terminalClients.get(terminalId);
              if (client) sendJson(client, { type: "terminal_exit", terminalId, exitCode });
              terminalClients.delete(terminalId);
              logInfo("ws", `terminal exited: ${terminalId} (code=${exitCode})`, "global");
            });
            terminalClients.set(terminalId, ws);
          }
          sendJson(ws, { type: "terminal_created", terminalId });
          break;
        }

        case "terminal_data": {
          const { terminalId, data } = msg;
          if (!terminalId || data === undefined) {
            sendJson(ws, { type: "error", message: "terminalId and data required" });
            return;
          }
          terminalManager.write(terminalId, data);
          break;
        }

        case "terminal_resize": {
          const { terminalId, cols, rows } = msg;
          if (!terminalId || !cols || !rows) {
            sendJson(ws, { type: "error", message: "terminalId, cols, and rows required" });
            return;
          }
          terminalManager.resize(terminalId, cols, rows);
          break;
        }

        case "terminal_close": {
          const { terminalId } = msg;
          if (!terminalId) {
            sendJson(ws, { type: "error", message: "terminalId required" });
            return;
          }
          terminalManager.close(terminalId);
          terminalClients.delete(terminalId);
          sendJson(ws, { type: "terminal_closed", terminalId });
          logInfo("ws", `terminal closed: ${terminalId}`, "global");
          break;
        }

        default:
          sendJson(ws, { type: "error", message: `unknown message type: ${msg.type}` });
      }
    });

    ws.on("close", () => {
      // Clean up all subscriptions for this client
      const subs = clientSubscriptions.get(ws);
      if (subs) {
        for (const tid of subs) {
          const subscribers = threadSubscribers.get(tid);
          if (subscribers) {
            subscribers.delete(ws);
            if (subscribers.size === 0) threadSubscribers.delete(tid);
          }
        }
        clientSubscriptions.delete(ws);
      }

      // Remove this client from terminal output routing, but keep terminals alive
      for (const [termId, client] of terminalClients) {
        if (client === ws) {
          terminalClients.delete(termId);
          logInfo("ws", `terminal output detached: ${termId} (client disconnect)`, "global");
        }
      }

      logInfo("ws", "WebSocket connection closed", "global");
    });

    ws.on("error", (err) => {
      logInfo("ws", `WebSocket error: ${err.message}`, "global");
    });
  });

  logInfo("ws", "WebSocket server initialized on /ws", "global");
  return wss;
}
