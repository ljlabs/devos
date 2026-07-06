/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * usePaginatedMessages - Cursor-based message loading hook.
 *
 * Fetches messages in batches using a cursor-based approach.
 * First page: cursor = null (returns latest messages).
 * Subsequent pages: cursor = oldest message ID from previous page.
 * Prevents multiple concurrent load requests via isLoadingMore flag.
 */

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { Message } from "../types";

export interface UsePaginatedMessagesReturn {
  /** Currently loaded messages (oldest first for display) */
  messages: Message[];
  /** Load older messages (with cursor-based pagination) */
  loadMore: () => Promise<void>;
  /** Whether older messages exist beyond the current load */
  hasMore: boolean;
  /** Whether a load-more request is in progress */
  isLoadingMore: boolean;
  /** Total message count in the thread */
  totalCount: number;
  /** Re-fetch with the current cursor to pick up new messages */
  refresh: () => void;
  /** Whether the initial load is still in progress */
  isLoading: boolean;
}

const PAGE_SIZE = 10;

export function usePaginatedMessages(threadId: string | null): UsePaginatedMessagesReturn {
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // Keep track of the oldest message ID we've fetched (used as cursor for next page)
  const cursorRef = useRef<string | null>(null);
  // Track confirmed IDs to prevent duplicates when refreshing
  const confirmedIdsRef = useRef<Set<string>>(new Set());
  // Track if a loadMore is currently in flight
  const isLoadingMoreRef = useRef(false);

  // Fetch messages with cursor
  const fetchMessages = useCallback(
    async (cursor: string | null, isLoadMore: boolean) => {
      if (!threadId) return;

      // Prevent concurrent requests while one is already in flight
      if (isLoadMore && isLoadingMoreRef.current) return;

      if (isLoadMore) {
        setIsLoadingMore(true);
        isLoadingMoreRef.current = true;
      } else {
        setIsLoading(true);
      }

      try {
        const url = cursor
          ? `/api/threads/${threadId}/messages/paginated?cursor=${cursor}&limit=${PAGE_SIZE}`
          : `/api/threads/${threadId}/messages/paginated?limit=${PAGE_SIZE}`;

        const res = await fetch(url);
        const data = res.ok
          ? await res.json()
          : { messages: [], hasMore: false, total: 0, nextCursor: null };

        // Server returns newest-first, reverse for oldest-first display
        const msgs: Message[] = (data.messages || []).reverse();

        // Deduplicate
        const newMsgs = msgs.filter((m) => !confirmedIdsRef.current.has(m.id));
        newMsgs.forEach((m) => confirmedIdsRef.current.add(m.id));

        if (isLoadMore) {
          // Prepend older messages to the front
          setAllMessages((prev) => [...newMsgs, ...prev]);
        } else {
          // Initial load: replace all
          setAllMessages(msgs);
        }

        setHasMore(data.hasMore ?? false);
        setTotalCount(data.total ?? 0);

        // Update cursor for next page (points to the oldest message ID in the current batch)
        if (data.nextCursor) {
          cursorRef.current = data.nextCursor;
        }
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      } finally {
        if (isLoadMore) {
          setIsLoadingMore(false);
          isLoadingMoreRef.current = false;
        } else {
          setIsLoading(false);
        }
      }
    },
    [threadId]
  );

  // Reset and fetch initial page when thread changes
  useEffect(() => {
    if (!threadId) {
      setAllMessages([]);
      setHasMore(true);
      setTotalCount(0);
      setIsLoading(false);
      return;
    }

    cursorRef.current = null;
    confirmedIdsRef.current.clear();
    isLoadingMoreRef.current = false;
    fetchMessages(null, false);
  }, [threadId, fetchMessages]);

  // Load older messages — uses cursor from previous page
  const loadMore = useCallback(async () => {
    if (!threadId || !hasMore || isLoadingMoreRef.current) return;

    await fetchMessages(cursorRef.current, true);
  }, [threadId, hasMore, fetchMessages]);

  // Refresh — re-fetch with null cursor (latest messages)
  const refresh = useCallback(() => {
    if (!threadId) return;
    cursorRef.current = null;
    confirmedIdsRef.current.clear();
    fetchMessages(null, false);
  }, [threadId, fetchMessages]);

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
