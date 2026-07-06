import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePaginatedMessages } from "../../src/hooks/usePaginatedMessages";
import type { Message } from "../../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(id: string, threadId: string, minutesAgo: number): Message {
  const ts = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id,
    threadId,
    timestamp: ts,
    raw: { role: "assistant", content: "msg " + id },
    type: "session/update",
  };
}

function buildThread(threadId: string, total: number): Message[] {
  return Array.from({ length: total }, (_, i) =>
    makeMsg("msg-" + (i + 1), threadId, total - i)
  );
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

/**
 * Simulate cursor-based server pagination:
 * - If cursor is null, return latest `limit` messages (newest first)
 * - If cursor provided, return `limit` messages before the cursor (newest first)
 */
function serverPageWithCursor(
  allMsgs: Message[],
  cursor: string | null,
  limit: number
) {
  const sorted = [...allMsgs].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  let messages: Message[];
  if (cursor === null) {
    // Latest messages
    messages = sorted.slice(0, limit);
  } else {
    // Find cursor position and get older messages
    const cursorIndex = sorted.findIndex((m) => m.id === cursor);
    if (cursorIndex === -1) {
      messages = [];
    } else {
      messages = sorted.slice(cursorIndex + 1, cursorIndex + 1 + limit);
    }
  }

  const hasMore =
    cursor === null
      ? sorted.length > limit
      : sorted.length > sorted.findIndex((m) => m.id === cursor) + 1 + limit;

  const nextCursor = messages.length > 0 ? messages[messages.length - 1].id : null;

  return { messages, hasMore, total: allMsgs.length, nextCursor };
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<(url: string) => Promise<Response>>();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePaginatedMessages (cursor-based)", () => {
  describe("initial load", () => {
    it("fetches the latest 10 messages on mount (cursor=null)", async () => {
      const thread = buildThread("t-1", 25);

      mockFetch.mockImplementation((url) => {
        const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
        return Promise.resolve(
          jsonResponse(serverPageWithCursor(thread, cursor, 10))
        );
      });

      const { result } = renderHook(() => usePaginatedMessages("t-1"));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/threads/t-1/messages/paginated")
      );
      // No cursor param in first call
      expect(mockFetch.mock.calls[0][0]).toContain("limit=10");
      expect(mockFetch.mock.calls[0][0]).not.toContain("cursor=");

      expect(result.current.messages).toHaveLength(10);
      expect(result.current.messages[0].id).toBe("msg-16");
      expect(result.current.messages[9].id).toBe("msg-25");
      expect(result.current.hasMore).toBe(true);
      expect(result.current.totalCount).toBe(25);
    });

    it("sets hasMore false when total <= limit", async () => {
      const thread = buildThread("t-1", 5);

      mockFetch.mockImplementation((url) => {
        const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
        return Promise.resolve(
          jsonResponse(serverPageWithCursor(thread, cursor, 10))
        );
      });

      const { result } = renderHook(() => usePaginatedMessages("t-1"));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.messages).toHaveLength(5);
      expect(result.current.hasMore).toBe(false);
    });
  });

  describe("loadMore with cursor", () => {
    it("scroll up: fetches older messages using cursor", async () => {
      const thread = buildThread("t-1", 30);

      mockFetch.mockImplementation((url) => {
        const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
        return Promise.resolve(
          jsonResponse(serverPageWithCursor(thread, cursor, 10))
        );
      });

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.messages).toHaveLength(10);
      // Oldest-first display: msg-21 (oldest) to msg-30 (newest)
      expect(result.current.messages[0].id).toBe("msg-21");
      expect(result.current.messages[9].id).toBe("msg-30");

      await act(async () => {
        await result.current.loadMore();
      });

      // Should have called with cursor pointing to msg-21 (oldest of previous batch)
      const secondCall = mockFetch.mock.calls[1][0];
      expect(secondCall).toContain("cursor=msg-21");

      expect(result.current.messages).toHaveLength(20);
      expect(result.current.messages[0].id).toBe("msg-11");
      expect(result.current.messages[19].id).toBe("msg-30");
    });

    it("multiple loadMore calls advance the cursor", async () => {
      const thread = buildThread("t-1", 40);

      mockFetch.mockImplementation((url) => {
        const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
        return Promise.resolve(
          jsonResponse(serverPageWithCursor(thread, cursor, 10))
        );
      });

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      // First batch: msg-31 to msg-40 (oldest to newest in display order)
      expect(result.current.messages[0].id).toBe("msg-31");

      await act(async () => {
        await result.current.loadMore();
      });
      // After first loadMore: msg-21 to msg-40
      expect(result.current.messages[0].id).toBe("msg-21");
      expect(result.current.messages[19].id).toBe("msg-40");

      await act(async () => {
        await result.current.loadMore();
      });
      // After second loadMore: msg-11 to msg-40
      expect(result.current.messages[0].id).toBe("msg-11");
      expect(result.current.messages[29].id).toBe("msg-40");
    });

    it("does not duplicate messages already loaded", async () => {
      const thread = buildThread("t-1", 20);

      mockFetch.mockImplementation((url) => {
        const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
        return Promise.resolve(
          jsonResponse(serverPageWithCursor(thread, cursor, 10))
        );
      });

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.loadMore();
      });

      expect(result.current.messages).toHaveLength(20);
      const ids = result.current.messages.map((m) => m.id);
      expect(new Set(ids).size).toBe(20);
    });

    it("no-ops when hasMore is false", async () => {
      const thread = buildThread("t-1", 3);

      mockFetch.mockImplementation((url) => {
        const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
        return Promise.resolve(
          jsonResponse(serverPageWithCursor(thread, cursor, 10))
        );
      });

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      const callsBefore = mockFetch.mock.calls.length;
      await act(async () => {
        await result.current.loadMore();
      });

      expect(mockFetch.mock.calls.length).toBe(callsBefore);
      expect(result.current.messages).toHaveLength(3);
    });
  });

  describe("prevents concurrent load requests", () => {
    it("ignores loadMore while another loadMore is in flight", async () => {
      const thread = buildThread("t-1", 30);

      mockFetch.mockImplementation((url) => {
        const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
        return Promise.resolve(
          jsonResponse(serverPageWithCursor(thread, cursor, 10))
        );
      });

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Hang the first loadMore to keep isLoadingMore=true
      let resolveSecondCall!: (v: Response) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((r) => {
          resolveSecondCall = r;
        })
      );

      await act(async () => {
        result.current.loadMore();
      });
      await act(async () => {});

      expect(result.current.isLoadingMore).toBe(true);

      const callsBeforeSecondLoadMore = mockFetch.mock.calls.length;

      // Try another loadMore while first is in flight
      await act(async () => {
        result.current.loadMore();
      });

      // Should not have made another fetch call
      expect(mockFetch.mock.calls.length).toBe(callsBeforeSecondLoadMore);

      // Resolve the first call
      await act(async () => {
        resolveSecondCall(
          jsonResponse(serverPageWithCursor(thread, "msg-25", 10))
        );
      });

      expect(result.current.isLoadingMore).toBe(false);
    });
  });

  describe("refresh (re-fetch with latest)", () => {
    it("refresh resets to null cursor and picks up new messages", async () => {
      const thread = buildThread("t-1", 20);

      mockFetch.mockImplementation((url) => {
        const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
        return Promise.resolve(
          jsonResponse(serverPageWithCursor(thread, cursor, 10))
        );
      });

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.loadMore();
      });

      expect(result.current.messages).toHaveLength(20);

      const newMsg = makeMsg("msg-21", "t-1", 0);
      const refreshed = [...thread, newMsg];

      mockFetch.mockImplementation((url) => {
        const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
        return Promise.resolve(
          jsonResponse(serverPageWithCursor(refreshed, cursor, 10))
        );
      });

      await act(async () => {
        result.current.refresh();
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Should fetch with cursor=null (latest 10)
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
      expect(lastCall).not.toContain("cursor=");

      expect(result.current.messages).toHaveLength(10);
      expect(result.current.messages[9].id).toBe("msg-21");
      expect(result.current.totalCount).toBe(21);
    });
  });

  describe("thread switching", () => {
    it("resets state when thread changes", async () => {
      const thread1 = buildThread("t-1", 15);
      const thread2 = buildThread("t-2", 8);

      mockFetch.mockImplementation((url) => {
        const threadId = url.match(/threads\/([^/]+)/)?.[1];
        const allMsgs = threadId === "t-1" ? thread1 : thread2;
        const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
        return Promise.resolve(
          jsonResponse(serverPageWithCursor(allMsgs, cursor, 10))
        );
      });

      const { result, rerender } = renderHook(
        ({ tid }) => usePaginatedMessages(tid),
        { initialProps: { tid: "t-1" } }
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.messages).toHaveLength(10);

      rerender({ tid: "t-2" });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.messages).toHaveLength(8);
      expect(result.current.messages[0].threadId).toBe("t-2");
      expect(result.current.hasMore).toBe(false);
    });

    it("clears messages when thread is null", async () => {
      const thread = buildThread("t-1", 10);

      mockFetch.mockImplementation((url) => {
        const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
        return Promise.resolve(
          jsonResponse(serverPageWithCursor(thread, cursor, 10))
        );
      });

      const { result, rerender } = renderHook(
        ({ tid }) => usePaginatedMessages(tid),
        { initialProps: { tid: "t-1" as string | null } }
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.messages).toHaveLength(10);

      rerender({ tid: null });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.messages).toHaveLength(0);
    });
  });

  describe("loading states", () => {
    it("isLoading is true during initial load", async () => {
      mockFetch.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => usePaginatedMessages("t-1"));

      expect(result.current.isLoading).toBe(true);
    });

    it("isLoadingMore is true during loadMore, then false", async () => {
      const thread = buildThread("t-1", 30);

      mockFetch.mockImplementation((url) => {
        const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
        return Promise.resolve(
          jsonResponse(serverPageWithCursor(thread, cursor, 10))
        );
      });

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let resolveLoadMore!: (v: Response) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((r) => {
          resolveLoadMore = r;
        })
      );

      act(() => {
        result.current.loadMore();
      });
      await act(async () => {});

      expect(result.current.isLoadingMore).toBe(true);

      await act(async () => {
        // After first fetch we have msg-21 to msg-30, so cursor for second fetch is msg-21
        resolveLoadMore(
          jsonResponse(serverPageWithCursor(thread, "msg-21", 10))
        );
      });

      expect(result.current.isLoadingMore).toBe(false);
      expect(result.current.messages).toHaveLength(20);
    });
  });

  describe("sort order", () => {
    it("messages are always sorted oldest-first regardless of server order", async () => {
      const serverMsgs = [
        makeMsg("msg-3", "t-1", 1),
        makeMsg("msg-2", "t-1", 2),
        makeMsg("msg-1", "t-1", 3),
      ];

      mockFetch.mockResolvedValue(
        jsonResponse({
          messages: serverMsgs,
          hasMore: false,
          total: 3,
          nextCursor: null,
        })
      );

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.messages[0].id).toBe("msg-1");
      expect(result.current.messages[1].id).toBe("msg-2");
      expect(result.current.messages[2].id).toBe("msg-3");
    });
  });
});
