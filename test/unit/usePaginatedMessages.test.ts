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

/** Simulate the server: sort newest-first, return latest `limit` messages. */
function serverPage(allMsgs: Message[], limit: number) {
  const sorted = [...allMsgs].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const messages = sorted.slice(0, limit);
  return { messages, hasMore: allMsgs.length > limit, total: allMsgs.length };
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

describe("usePaginatedMessages", () => {
  describe("initial load", () => {
    it("fetches the latest 10 messages on mount", async () => {
      const thread = buildThread("t-1", 25);

      mockFetch.mockResolvedValue(
        jsonResponse(serverPage(thread, 10))
      );

      const { result } = renderHook(() => usePaginatedMessages("t-1"));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/threads/t-1/messages/paginated?limit=10")
      );
      expect(result.current.messages).toHaveLength(10);
      expect(result.current.messages[0].id).toBe("msg-16");
      expect(result.current.messages[9].id).toBe("msg-25");
      expect(result.current.hasMore).toBe(true);
      expect(result.current.totalCount).toBe(25);
    });

    it("sets hasMore false when total <= limit", async () => {
      const thread = buildThread("t-1", 5);

      mockFetch.mockResolvedValue(
        jsonResponse(serverPage(thread, 10))
      );

      const { result } = renderHook(() => usePaginatedMessages("t-1"));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.messages).toHaveLength(5);
      expect(result.current.hasMore).toBe(false);
    });
  });

  describe("loadMore -- expanding window", () => {
    it("scroll up: [10 newest] becomes [20 newest]", async () => {
      const thread = buildThread("t-1", 30);

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 10))
      );

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.messages).toHaveLength(10);
      expect(result.current.messages[0].id).toBe("msg-21");

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 20))
      );

      await act(async () => { await result.current.loadMore(); });

      expect(result.current.messages).toHaveLength(20);
      expect(result.current.messages[0].id).toBe("msg-11");
      expect(result.current.messages[19].id).toBe("msg-30");
    });

    it("second scroll up: [20 newest] becomes [30 newest]", async () => {
      const thread = buildThread("t-1", 40);

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 10))
      );

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 20))
      );
      await act(async () => { await result.current.loadMore(); });
      expect(result.current.messages).toHaveLength(20);

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 30))
      );
      await act(async () => { await result.current.loadMore(); });
      expect(result.current.messages).toHaveLength(30);
      expect(result.current.messages[0].id).toBe("msg-11");
    });

    it("does not duplicate messages already loaded", async () => {
      const thread = buildThread("t-1", 20);

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 10))
      );

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 20))
      );
      await act(async () => { await result.current.loadMore(); });

      expect(result.current.messages).toHaveLength(20);
      const ids = result.current.messages.map(m => m.id);
      expect(new Set(ids).size).toBe(20);
    });

    it("no-ops when hasMore is false", async () => {
      const thread = buildThread("t-1", 3);

      mockFetch.mockResolvedValue(
        jsonResponse(serverPage(thread, 10))
      );

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      const callsBefore = mockFetch.mock.calls.length;
      await act(async () => { await result.current.loadMore(); });

      expect(mockFetch.mock.calls.length).toBe(callsBefore);
      expect(result.current.messages).toHaveLength(3);
    });
  });

  describe("new messages arriving -- expanding right edge", () => {
    it("refresh picks up a new message: latest 10 shifts to include it", async () => {
      const thread = buildThread("t-1", 20);

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 10))
      );

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.messages).toHaveLength(10);
      expect(result.current.messages[9].id).toBe("msg-20");

      const newMsg = makeMsg("msg-21", "t-1", 0);
      const refreshed = [...thread, newMsg];

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(refreshed, 10))
      );

      await act(async () => { result.current.refresh(); });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.messages).toHaveLength(10);
      expect(result.current.messages[9].id).toBe("msg-21");
      expect(result.current.messages[0].id).toBe("msg-12");
      expect(result.current.totalCount).toBe(21);
    });

    it("refresh after loadMore: window stays at 20 with new msg at end", async () => {
      const thread = buildThread("t-1", 20);

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 10))
      );

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 20))
      );
      await act(async () => { await result.current.loadMore(); });
      expect(result.current.messages).toHaveLength(20);

      const newMsg = makeMsg("msg-21", "t-1", 0);
      const refreshed = [...thread, newMsg];

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(refreshed, 20))
      );

      await act(async () => { result.current.refresh(); });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.messages).toHaveLength(20);
      expect(result.current.messages[19].id).toBe("msg-21");
      expect(result.current.messages[0].id).toBe("msg-2");
    });

    it("multiple new messages: latest 10 shifts to cover them", async () => {
      const thread = buildThread("t-1", 10);

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 10))
      );

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Stagger timestamps so sort order is deterministic
      const newMsgs = [
        makeMsg("msg-11", "t-1", 0),
        makeMsg("msg-12", "t-1", 0),
        makeMsg("msg-13", "t-1", 0),
      ];
      // Manually set sequential timestamps to guarantee ordering
      newMsgs[0].timestamp = "2099-01-01T00:00:10Z";
      newMsgs[1].timestamp = "2099-01-01T00:00:20Z";
      newMsgs[2].timestamp = "2099-01-01T00:00:30Z";
      const refreshed = [...thread, ...newMsgs];

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(refreshed, 10))
      );

      await act(async () => { result.current.refresh(); });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.messages).toHaveLength(10);
      expect(result.current.messages[9].id).toBe("msg-13");
      expect(result.current.messages[0].id).toBe("msg-4");
      expect(result.current.hasMore).toBe(true);
      expect(result.current.totalCount).toBe(13);
    });
  });

  describe("thread switching", () => {
    it("resets state when thread changes", async () => {
      const thread1 = buildThread("t-1", 15);
      const thread2 = buildThread("t-2", 8);

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread1, 10))
      );

      const { result, rerender } = renderHook(
        ({ tid }) => usePaginatedMessages(tid),
        { initialProps: { tid: "t-1" } }
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.messages).toHaveLength(10);
      expect(result.current.messages[0].id).toBe("msg-6");

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread2, 10))
      );

      rerender({ tid: "t-2" });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.messages).toHaveLength(8);
      expect(result.current.messages[0].id).toBe("msg-1");
      expect(result.current.messages[0].threadId).toBe("t-2");
      expect(result.current.hasMore).toBe(false);
    });

    it("clears messages when thread is null", async () => {
      const thread = buildThread("t-1", 10);

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 10))
      );

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

      mockFetch.mockResolvedValueOnce(
        jsonResponse(serverPage(thread, 10))
      );

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let resolveLoadMore!: (v: Response) => void;
      mockFetch.mockReturnValueOnce(
        new Promise(r => { resolveLoadMore = r; })
      );

      act(() => { result.current.loadMore(); });
      await act(async () => {});

      expect(result.current.isLoadingMore).toBe(true);

      await act(async () => {
        resolveLoadMore(jsonResponse(serverPage(thread, 20)));
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
        jsonResponse({ messages: serverMsgs, hasMore: false, total: 3 })
      );

      const { result } = renderHook(() => usePaginatedMessages("t-1"));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.messages[0].id).toBe("msg-1");
      expect(result.current.messages[1].id).toBe("msg-2");
      expect(result.current.messages[2].id).toBe("msg-3");
    });
  });
});
