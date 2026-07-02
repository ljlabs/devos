import { useState, useCallback, useRef, useMemo } from "react";
import type { Message } from "../types";

export interface UseOptimisticMessagesReturn {
  /** Merged confirmed + pending messages, sorted by timestamp */
  messages: Message[];
  /** Add a greyed-out user message before server ack */
  addOptimistic: (threadId: string, text: string, clientMsgId: string) => void;
  /** Replace an optimistic message with the server-acknowledged version */
  confirmMessage: (clientMsgId: string, serverMessage: Message) => void;
  /** Replace the full confirmed message list (from server subscribe/reconnect) */
  setConfirmed: (msgs: Message[]) => void;
  /** Append a single agent message to the confirmed list */
  appendMessage: (msg: Message) => void;
  /** Clear all optimistic messages (on thread switch) */
  clearOptimistic: () => void;
}

export function useOptimisticMessages(): UseOptimisticMessagesReturn {
  const [confirmed, setConfirmed] = useState<Message[]>([]);
  const [optimistic, setOptimistic] = useState<Map<string, Message>>(new Map());
  const confirmedIdsRef = useRef<Set<string>>(new Set());
  const optimisticRef = useRef(optimistic);
  optimisticRef.current = optimistic;

  const addOptimistic = useCallback((threadId: string, text: string, clientMsgId: string) => {
    const msg: Message = {
      id: clientMsgId,
      threadId,
      timestamp: new Date().toISOString(),
      raw: { role: "user", content: text },
      type: "user_message",
      pending: true,
    };
    setOptimistic((prev) => {
      const next = new Map(prev);
      next.set(clientMsgId, msg);
      return next;
    });
  }, []);

  const confirmMessage = useCallback((clientMsgId: string, serverMessage: Message) => {
    setOptimistic((prev) => {
      if (!prev.has(clientMsgId)) return prev;
      const next = new Map(prev);
      next.delete(clientMsgId);
      return next;
    });
    // Add server version to confirmed if not already present
    if (!confirmedIdsRef.current.has(serverMessage.id)) {
      confirmedIdsRef.current.add(serverMessage.id);
      setConfirmed((prev) => [...prev, serverMessage]);
    }
  }, []);

  const clearOptimistic = useCallback(() => {
    setOptimistic(new Map());
  }, []);

  const appendMessage = useCallback((msg: Message) => {
    // If this message ID already exists, update it in place (streaming accumulation)
    if (confirmedIdsRef.current.has(msg.id)) {
      setConfirmed((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
      return;
    }

    // If this is a user message that matches an optimistic one, replace it
    if (msg.type === "user_message") {
      const matchingOptKey = Array.from(optimisticRef.current.entries()).find(
        ([, optMsg]) => optMsg.threadId === msg.threadId && optMsg.raw?.content === msg.raw?.content
      )?.[0];

      if (matchingOptKey) {
        setOptimistic((prev) => {
          const next = new Map(prev);
          next.delete(matchingOptKey);
          return next;
        });
      }
    }

    confirmedIdsRef.current.add(msg.id);
    setConfirmed((prev) => [...prev, msg]);
  }, []);

  const setConfirmedMessages = useCallback((msgs: Message[]) => {
    confirmedIdsRef.current = new Set(msgs.map((m) => m.id));
    setConfirmed(msgs);
    // Remove optimistic messages that are now confirmed
    setOptimistic((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [key, optMsg] of next) {
        if (msgs.some((m) => m.type === "user_message" && m.raw?.content === optMsg.raw?.content && m.threadId === optMsg.threadId)) {
          next.delete(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const messages = useMemo(() => {
    const all = [...confirmed, ...optimistic.values()];
    all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return all;
  }, [confirmed, optimistic]);

  return {
    messages,
    addOptimistic,
    confirmMessage,
    setConfirmed: setConfirmedMessages,
    appendMessage,
    clearOptimistic,
  };
}
