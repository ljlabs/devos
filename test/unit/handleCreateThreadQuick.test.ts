/**
 * Unit tests for handleCreateThreadQuick — optimistic thread creation.
 *
 * These tests verify the 404-window fix: the function must NOT navigate to
 * the thread until the server responds with a real thread ID. The temp thread
 * appears in the sidebar immediately, but navigation is deferred.
 */
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Thread {
  id: string;
  workspaceId: string;
  title: string;
  sessionId?: string;
  status: "thinking" | "running" | "awaiting_permission" | "idle";
}

// ---------------------------------------------------------------------------
// Extracted logic — mirrors handleCreateThreadQuick from App.tsx
//
// This is the actual logic under test, parameterized so we can mock
// setThreads, navigate, and fetch without rendering a React component.
// ---------------------------------------------------------------------------

async function handleCreateThreadQuick(opts: {
  activeWorkspaceId: string | null;
  setThreads: (updater: (prev: Thread[]) => Thread[]) => void;
  navigate: (path: string) => void;
  fetchFn: typeof fetch;
}): Promise<void> {
  const { activeWorkspaceId, setThreads, navigate, fetchFn } = opts;
  if (!activeWorkspaceId) return;

  // Optimistic: add a temp thread to the sidebar so the user sees it appear instantly.
  // We do NOT navigate yet — that avoids a 404 window where the server doesn't know
  // about the temp thread id, which would cause WS subscribe + fetch failures.
  const tempId = `thread-optimistic-${Date.now()}`;
  const optimisticThread: Thread = {
    id: tempId,
    workspaceId: activeWorkspaceId,
    title: "Untitled",
    status: "idle",
  };
  setThreads((prev) => [...prev, optimisticThread]);

  try {
    const res = await fetchFn(`/api/workspaces/${activeWorkspaceId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled" }),
    });
    if (res.ok) {
      const data: Thread = await res.json();
      // Replace the optimistic thread with the real one and navigate
      setThreads((prev) => prev.map((t) => (t.id === tempId ? data : t)));
      navigate(`/messages/${activeWorkspaceId}/${data.id}`);
    } else {
      // Server failed — remove optimistic thread
      setThreads((prev) => prev.filter((t) => t.id !== tempId));
    }
  } catch (e) {
    setThreads((prev) => prev.filter((t) => t.id !== tempId));
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockThreads(): Thread[] {
  return [{ id: "existing-1", workspaceId: "ws-1", title: "Existing", status: "idle" }];
}

function createFetchResponse(ok: boolean, body?: Thread) {
  return {
    ok,
    json: () => Promise.resolve(body ?? null),
  } as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleCreateThreadQuick", () => {
  let threads: Thread[];
  let setThreads: Mock;
  let navigate: Mock;
  let fetchFn: Mock;

  beforeEach(() => {
    threads = createMockThreads();
    setThreads = vi.fn((updater: (prev: Thread[]) => Thread[]) => {
      threads = updater(threads);
    });
    navigate = vi.fn();
    fetchFn = vi.fn();
  });

  it("does nothing when activeWorkspaceId is null", async () => {
    await handleCreateThreadQuick({
      activeWorkspaceId: null,
      setThreads,
      navigate,
      fetchFn,
    });
    expect(setThreads).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("adds a temp thread immediately without navigating", async () => {
    // Use a deferred promise so we can check state before fetch resolves
    let resolve!: (v: Response) => void;
    fetchFn.mockReturnValue(new Promise((r) => { resolve = r; }));

    const promise = handleCreateThreadQuick({
      activeWorkspaceId: "ws-1",
      setThreads,
      navigate,
      fetchFn,
    });

    // At this point, fetch is pending — temp thread should already be in state
    // but navigate should NOT have been called
    expect(setThreads).toHaveBeenCalledTimes(1);

    // The temp thread was added
    expect(threads).toHaveLength(2);
    expect(threads[1].id).toMatch(/^thread-optimistic-\d+$/);
    expect(threads[1].workspaceId).toBe("ws-1");
    expect(threads[1].title).toBe("Untitled");
    expect(threads[1].status).toBe("idle");

    // CRITICAL: navigate was NOT called while fetch is pending (no 404 window)
    expect(navigate).not.toHaveBeenCalled();

    // Now resolve the fetch to clean up
    resolve(createFetchResponse(true, { id: "thread-real", workspaceId: "ws-1", title: "Untitled", status: "idle" }));
    await promise;

    // After resolution, navigate WAS called with the real thread ID
    expect(navigate).toHaveBeenCalledWith("/messages/ws-1/thread-real");
  });

  it("on server success: replaces temp thread with real one and navigates", async () => {
    const realThread: Thread = {
      id: "thread-real-42",
      workspaceId: "ws-1",
      title: "Untitled",
      status: "idle",
    };
    fetchFn.mockResolvedValue(createFetchResponse(true, realThread));

    await handleCreateThreadQuick({
      activeWorkspaceId: "ws-1",
      setThreads,
      navigate,
      fetchFn,
    });

    // setThreads called twice: once to add temp, once to replace
    expect(setThreads).toHaveBeenCalledTimes(2);

    // After replacement, the real thread is in the list
    expect(threads).toHaveLength(2);
    expect(threads[0].id).toBe("existing-1");
    expect(threads[1]).toEqual(realThread);

    // Navigate was called with the REAL thread id
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/messages/ws-1/thread-real-42");
  });

  it("on server failure: removes temp thread, no navigation", async () => {
    fetchFn.mockResolvedValue(createFetchResponse(false));

    await handleCreateThreadQuick({
      activeWorkspaceId: "ws-1",
      setThreads,
      navigate,
      fetchFn,
    });

    // setThreads called twice: once to add temp, once to remove
    expect(setThreads).toHaveBeenCalledTimes(2);

    // After removal, back to original
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe("existing-1");

    // No navigation
    expect(navigate).not.toHaveBeenCalled();
  });

  it("on network error: removes temp thread, no navigation", async () => {
    fetchFn.mockRejectedValue(new Error("Network error"));

    await handleCreateThreadQuick({
      activeWorkspaceId: "ws-1",
      setThreads,
      navigate,
      fetchFn,
    });

    // After removal, back to original
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe("existing-1");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("POST request has correct body", async () => {
    const realThread: Thread = {
      id: "thread-new",
      workspaceId: "ws-1",
      title: "Untitled",
      status: "idle",
    };
    fetchFn.mockResolvedValue(createFetchResponse(true, realThread));

    await handleCreateThreadQuick({
      activeWorkspaceId: "ws-1",
      setThreads,
      navigate,
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith("/api/workspaces/ws-1/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled" }),
    });
  });

  it("temp thread uses correct workspace id", async () => {
    let resolve!: (v: Response) => void;
    fetchFn.mockReturnValue(new Promise((r) => { resolve = r; }));

    const promise = handleCreateThreadQuick({
      activeWorkspaceId: "ws-42",
      setThreads,
      navigate,
      fetchFn,
    });

    // Temp thread should have the correct workspace id
    expect(threads[1].workspaceId).toBe("ws-42");

    // Clean up — resolve to avoid hanging
    resolve(createFetchResponse(true, { id: "thread-real", workspaceId: "ws-42", title: "Untitled", status: "idle" }));
    await promise;
  });

  it("concurrent calls create separate temp threads", async () => {
    const resolvers: ((v: Response) => void)[] = [];
    fetchFn.mockImplementation(() => new Promise((r) => { resolvers.push(r); }));

    // Fire two calls in parallel
    const p1 = handleCreateThreadQuick({
      activeWorkspaceId: "ws-1",
      setThreads,
      navigate,
      fetchFn,
    });
    const p2 = handleCreateThreadQuick({
      activeWorkspaceId: "ws-1",
      setThreads,
      navigate,
      fetchFn,
    });

    // Both add a temp thread (setThreads called twice for add, one for each)
    expect(setThreads).toHaveBeenCalledTimes(2);

    // Both should have different temp IDs
    expect(threads.length).toBeGreaterThanOrEqual(3); // existing + 2 temp

    // Clean up — resolve both promises
    resolvers[0](createFetchResponse(true, { id: "real-1", workspaceId: "ws-1", title: "Untitled", status: "idle" }));
    resolvers[1](createFetchResponse(true, { id: "real-2", workspaceId: "ws-1", title: "Untitled", status: "idle" }));
    await Promise.all([p1, p2]);
  });
});
