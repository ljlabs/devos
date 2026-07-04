/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * usePaginatedMessages - Expanding-window message loading hook.
 *
 * Starts by showing the latest PAGE_SIZE messages. When the user scrolls up,
 * the limit grows by PAGE_SIZE each time (10 → 20 → 30 …) so the visible
 * window always ends at the latest message and just gets taller.
 */

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { Message } from "../types";

export interface UsePaginatedMessagesReturn {
  /** Currently loaded messages (oldest first for display) */
  messages: Message[];
  /** Load older messages (grows the window) */
  loadMore: () => Promise<void>;
  /** Whether older messages exist beyond the current window */
  hasMore: boolean;
  /** Whether a load-more request is in progress */
  isLoadingMore: boolean;
  /** Total message count in the thread */
  totalCount: number;
  /** Re-fetch with the current limit (picks up new messages) */
  refresh: () => void;
  /** Whether the initial load is still in progress */
  isLoading: boolean;
}

const PAGE_SIZE = 10;

export function usePaginatedMessages(threadId: string | null): UsePaginatedMessagesReturn {
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  const confirmedIdsRef = useRef<Set<string>>(new Set());

  // Fetch latest `currentLimit` messages
  const fetchMessages = useCallback(async (currentLimit: number, isLoadMore: boolean) => {
    if (!threadId) return;

    if (isLoadMore) setIsLoadingMore(true);
    else setIsLoading(true);

    try {
      const res = await fetch(`/api/threads/${threadId}/messages/paginated?limit=${currentLimit}`);
      const data = res.ok ? await res.json() : { messages: [], hasMore: false, total: 0 };

      // Server returns newest-first, reverse for oldest-first display
      const msgs: Message[] = (data.messages || []).reverse();

      // Deduplicate
      const newMsgs = msgs.filter(m => !confirmedIdsRef.current.has(m.id));
      newMsgs.forEach(m => confirmedIdsRef.current.add(m.id));

      if (isLoadMore) {
        // Prepend older messages (they're older than everything we already have)
        setAllMessages(prev => [...newMsgs, ...prev]);
      } else {
        setAllMessages(msgs);
      }

      setHasMore(data.hasMore ?? false);
      setTotalCount(data.total ?? 0);
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    } finally {
      setIsLoadingMore(false);
      setIsLoading(false);
    }
  }, [threadId]);

  // Reset and fetch initial page when thread changes
  useEffect(() => {
    if (!threadId) {
      setAllMessages([]);
      setHasMore(true);
      setTotalCount(0);
      setIsLoading(false);
      return;
    }

    setLimit(PAGE_SIZE);
    confirmedIdsRef.current.clear();
    fetchMessages(PAGE_SIZE, false);
  }, [threadId, fetchMessages]);

  // Load older messages — grows the window
  const loadMore = useCallback(async () => {
    if (!threadId || !hasMore || isLoadingMore) return;
    const nextLimit = limit + PAGE_SIZE;
    setLimit(nextLimit);
    await fetchMessages(nextLimit, true);
  }, [threadId, hasMore, isLoadingMore, limit, fetchMessages]);

  // Refresh — re-fetch with current limit to pick up new messages
  const refresh = useCallback(() => {
    if (!threadId) return;
    confirmedIdsRef.current.clear();
    fetchMessages(limit, false);
  }, [threadId, limit, fetchMessages]);

  // Sort oldest-first for display
  const messages = useMemo(() => {
    return [...allMessages].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [allMessages]);

  return {
    messages,
    loadMore,
    hasMore,
    isLoadingMore,
    totalCount,
    refresh,
    isLoading,
  };
}
