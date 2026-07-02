import { useEffect, useRef, useCallback, useState } from "react";
import type { Message, Thread } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseWebSocketOptions {
  /** Active thread ID — the hook subscribes to this thread */
  threadId: string | null;
  /** Called when a new agent message arrives */
  onMessage: (message: Message) => void;
  /** Called when a thread's status/title changes */
  onThreadUpdate: (thread: Thread) => void;
  /** Called when the server acknowledges a user message */
  onAck: (clientMsgId: string, message: Message) => void;
  /** Called when the subscription response arrives (full state) */
  onSubscribed: (threadId: string, messages: Message[], thread: Thread | null) => void;
  /** Called when connection state changes */
  onConnectionChange?: (connected: boolean) => void;
}

export interface UseWebSocketReturn {
  /** Whether the WebSocket is currently connected */
  isConnected: boolean;
  /** Send a user message via WebSocket */
  sendMessage: (threadId: string, text: string, clientMsgId: string) => void;
  /** Respond to a permission request via WebSocket */
  respondToPermission: (threadId: string, optionId: string, toolCommand?: string, toolName?: string) => void;
  /** Cancel an agent turn via WebSocket */
  cancelAgent: (threadId: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebSocket({
  threadId,
  onMessage,
  onThreadUpdate,
  onAck,
  onSubscribed,
  onConnectionChange,
}: UseWebSocketOptions): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const [isConnected, setIsConnected] = useState(false);
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onThreadUpdateRef = useRef(onThreadUpdate);
  onThreadUpdateRef.current = onThreadUpdate;
  const onAckRef = useRef(onAck);
  onAckRef.current = onAck;
  const onSubscribedRef = useRef(onSubscribed);
  onSubscribedRef.current = onSubscribed;
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[ws] connected");
      reconnectAttemptRef.current = 0;
      setIsConnected(true);
      onConnectionChangeRef.current?.(true);

      if (threadIdRef.current) {
        ws.send(JSON.stringify({ type: "subscribe", threadId: threadIdRef.current }));
      }
    };

    ws.onmessage = (event) => {
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "subscribed":
          onSubscribedRef.current(msg.threadId, msg.messages ?? [], msg.thread ?? null);
          break;
        case "message":
          onMessageRef.current(msg.message);
          break;
        case "thread_update":
          onThreadUpdateRef.current(msg.thread);
          break;
        case "ack":
          onAckRef.current(msg.clientMsgId, msg.message);
          break;
        case "error":
          console.error("[ws] server error:", msg.message);
          break;
      }
    };

    ws.onclose = () => {
      console.log("[ws] disconnected");
      wsRef.current = null;
      setIsConnected(false);
      onConnectionChangeRef.current?.(false);

      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      reconnectAttemptRef.current = attempt + 1;

      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = () => {
      // Error is always followed by onclose which handles reconnection.
      // Suppress noisy logs during reconnect backoff.
    };
  }, []);

  // Subscribe/unsubscribe when threadId changes
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (threadId) {
      ws.send(JSON.stringify({ type: "subscribe", threadId }));
    }

    return () => {
      if (ws.readyState === WebSocket.OPEN && threadId) {
        ws.send(JSON.stringify({ type: "unsubscribe", threadId }));
      }
    };
  }, [threadId]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const sendMessage = useCallback((threadId: string, text: string, clientMsgId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "send_message", threadId, text, clientMsgId }));
  }, []);

  const respondToPermission = useCallback((threadId: string, optionId: string, toolCommand?: string, toolName?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "respond", threadId, optionId, toolCommand, toolName }));
  }, []);

  const cancelAgent = useCallback((threadId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "cancel", threadId }));
  }, []);

  return {
    isConnected,
    sendMessage,
    respondToPermission,
    cancelAgent,
  };
}
