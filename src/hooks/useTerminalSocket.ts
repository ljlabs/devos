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

import { useRef, useCallback, useEffect, useMemo } from "react";

type OutputListener = ( string) => void;
type ExitListener = (exitCode: number) => void;

export interface TerminalSocketApi {
  createTerminal: (sessionId: string, cwd?: string, cols?: number, rows?: number) => void;
  write: (sessionId: string,  string) => void;
  resize: (sessionId: string, cols: number, rows: number) => void;
  closeTerminal: (sessionId: string) => void;
  subscribe: (sessionId: string, onData: OutputListener, onExit: ExitListener) => () => void;
}

export function useTerminalSocket(): TerminalSocketApi {
  const wsRef = useRef<WebSocket | null>(null);
  const connectedRef = useRef(false);
  const pendingRef = useRef<Record<string, { cwd?: string; cols: number; rows: number }>>({});
  const outputListeners = useRef<Map<string, Set<OutputListener>>>(new Map());
  const exitListeners = useRef<Map<string, Set<ExitListener>>>(new Map());

  const connect = useCallback(() => {
    if (connectedRef.current) return;
    connectedRef.current = true;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
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
    };

    ws.onerror = () => {
      // onclose handles reconnect-free teardown; nothing to do here.
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      connectedRef.current = false;
      wsRef.current = null;
    };
  }, [connect]);

  const createTerminal = useCallback(
    (sessionId: string, cwd?: string, cols = 80, rows = 24) => {
      connect();
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "terminal_create", terminalId: sessionId, cwd, cols, rows })
        );
      } else {
        pendingRef.current[sessionId] = { cwd, cols, rows };
      }
    },
    [connect]
  );

  const write = useCallback((sessionId: string, data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal_data", terminalId: sessionId, data }));
    }
  }, []);

  const resize = useCallback((sessionId: string, cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal_resize", terminalId: sessionId, cols, rows }));
    }
  }, []);

  const closeTerminal = useCallback((sessionId: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
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

  // Stable object identity so consumers' effects don't re-run (and spuriously
  // tear down PTY sessions) on every parent render.
  return useMemo(
    () => ({ createTerminal, write, resize, closeTerminal, subscribe }),
    [createTerminal, write, resize, closeTerminal, subscribe]
  );
}
