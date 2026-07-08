/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useTerminalSocket — owns a dedicated WebSocket to the PTY terminal backend
 * (separate from the chat WebSocket) and fans PTY output out to subscribed
 * terminal panes.
 *
 * Protocol (see server_src/wsServer.ts):
 *   client → server: terminal_create { terminalId, cwd, cols, rows }
 *                    terminal_data   { terminalId, data }
 *                    terminal_resize { terminalId, cols, rows }
 *                    terminal_close  { terminalId }
 *   server → client: terminal_created  { terminalId }
 *                    terminal_output  { terminalId, data }
 *                    terminal_exit    { terminalId, exitCode }
 *                    terminal_closed  { terminalId }
 */

import { useRef, useCallback, useEffect, useMemo, useState } from "react";

type OutputListener = (data: string) => void;
type ExitListener = (exitCode: number) => void;
type HistoryListener = (history: string[]) => void;

export interface TerminalSocketApi {
  createTerminal: (sessionId: string, cwd?: string, cols?: number, rows?: number) => void;
  write: (sessionId: string, data: string) => void;
  resize: (sessionId: string, cols: number, rows: number) => void;
  closeTerminal: (sessionId: string) => void;
  subscribe: (sessionId: string, onData: OutputListener, onExit: ExitListener) => () => void;
  /** Subscribe to history replay on reconnect. */
  onHistory: (sessionId: string, listener: HistoryListener) => () => void;
}

export function useTerminalSocket(): TerminalSocketApi {
  const wsRef = useRef<WebSocket | null>(null);
  const connectedRef = useRef(false);
  const pendingRef = useRef<Record<string, { cwd?: string; cols: number; rows: number }>>({});
  const outputListeners = useRef<Map<string, Set<OutputListener>>>(new Map());
  const exitListeners = useRef<Map<string, Set<ExitListener>>>(new Map());
  const historyListeners = useRef<Map<string, Set<HistoryListener>>>(new Map());
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  // Ref for the connect function so reconnect timeout can call the latest version
  const connectRef = useRef<() => void>(() => {});

  // Create the actual connect logic that will be stored in connectRef
  useEffect(() => {
    const connect = () => {
      if (connectedRef.current) return;
      connectedRef.current = true;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0; // reset on successful connect
        // Re-create any sessions requested before the socket finished opening.
        const pending = pendingRef.current;
        pendingRef.current = {};
        Object.entries(pending).forEach(([id, cfg]) => {
          ws.send(
            JSON.stringify({
              type: "terminal_create",
              terminalId: id,
              cwd: cfg.cwd,
              cols: cfg.cols,
              rows: cfg.rows,
            })
          );
        });
      };

      ws.onmessage = (event) => {
        let msg: Record<string, any>;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case "terminal_created": {
            // On reconnect, server may send history to restore the buffer
            if (msg.history && Array.isArray(msg.history)) {
              const set = historyListeners.current.get(msg.terminalId);
              if (set) set.forEach((fn) => fn(msg.history as string[]));
            }
            break;
          }
          case "terminal_output": {
            const set = outputListeners.current.get(msg.terminalId);
            if (set) set.forEach((fn) => fn(msg.data as string));
            break;
          }
          case "terminal_exit": {
            const set = exitListeners.current.get(msg.terminalId);
            if (set) set.forEach((fn) => fn(msg.exitCode as number));
            break;
          }
          default:
            break;
        }
      };

      ws.onclose = () => {
        connectedRef.current = false;
        wsRef.current = null;

        // Auto-reconnect with exponential backoff (max ~30s)
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect(); // Recursive call to reconnect
        }, delay);
      };

      ws.onerror = () => {
        // onclose handles reconnect; nothing to do here.
      };
    };

    connectRef.current = connect;
  }, []);

  // Connect on mount
  useEffect(() => {
    connectRef.current();
    return () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) ws.close();
      connectedRef.current = false;
      wsRef.current = null;
    };
  }, []);

  const createTerminal = useCallback(
    (sessionId: string, cwd?: string, cols = 80, rows = 24) => {
      connectRef.current();
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) {
        ws.send(
          JSON.stringify({ type: "terminal_create", terminalId: sessionId, cwd, cols, rows })
        );
      } else {
        pendingRef.current[sessionId] = { cwd, cols, rows };
      }
    },
    []
  );

  const write = useCallback((sessionId: string, data: string) => {
    connectRef.current();
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "terminal_data", terminalId: sessionId, data }));
    }
  }, []);

  const resize = useCallback((sessionId: string, cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "terminal_resize", terminalId: sessionId, cols, rows }));
    }
  }, []);

  const closeTerminal = useCallback((sessionId: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "terminal_close", terminalId: sessionId }));
    }
    outputListeners.current.delete(sessionId);
    exitListeners.current.delete(sessionId);
  }, []);

  const subscribe = useCallback(
    (sessionId: string, onData: OutputListener, onExit: ExitListener) => {
      let set = outputListeners.current.get(sessionId);
      if (!set) {
        set = new Set();
        outputListeners.current.set(sessionId, set);
      }
      set.add(onData);

      let exits = exitListeners.current.get(sessionId);
      if (!exits) {
        exits = new Set();
        exitListeners.current.set(sessionId, exits);
      }
      exits.add(onExit);

      return () => {
        outputListeners.current.get(sessionId)?.delete(onData);
        exitListeners.current.get(sessionId)?.delete(onExit);
      };
    },
    []
  );

  const onHistory = useCallback(
    (sessionId: string, listener: HistoryListener) => {
      let set = historyListeners.current.get(sessionId);
      if (!set) {
        set = new Set();
        historyListeners.current.set(sessionId, set);
      }
      set.add(listener);

      return () => {
        historyListeners.current.get(sessionId)?.delete(listener);
      };
    },
    []
  );

  // Stable object identity so consumers' effects don't re-run (and spuriously
  // tear down PTY sessions) on every parent render.
  return useMemo(
    () => ({ createTerminal, write, resize, closeTerminal, subscribe, onHistory }),
    [createTerminal, write, resize, closeTerminal, subscribe, onHistory]
  );
}
