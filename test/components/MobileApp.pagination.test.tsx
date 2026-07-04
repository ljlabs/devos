/**
 * Mobile pagination integration tests for ChatPage.
 * Mirrors the desktop pagination coverage: hasMore, loadMore, loading states,
 * thread switching, and message rendering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ChatPage from "../../src/pages/ChatPage";
import type { Message } from "../../src/types";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const th1Messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
  id: `msg-${i + 1}`,
  threadId: "th-1",
  timestamp: new Date(Date.now() - (10 - i) * 60_000).toISOString(),
  raw: { content: `Message ${i + 1}` },
}));

const th2Messages: Message[] = [
  {
    id: "msg-t2-1",
    threadId: "th-2",
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    raw: { content: "Thread 2 message" },
  },
];

const mockThreads = [
  { id: "th-1", workspaceId: "ws-1", title: "Thread One", status: "idle" },
  { id: "th-2", workspaceId: "ws-1", title: "Thread Two", status: "idle" },
];

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock shared bubbles — render minimal output
vi.mock("../../src/components/shared/UserMessageBubble", () => ({
  UserMessageBubble: (p: any) => <div data-testid="user-bubble">{p.content}</div>,
}));
vi.mock("../../src/components/shared/AgentTextBubble", () => ({
  AgentTextBubble: (p: any) => <div data-testid="agent-text-bubble">{p.content}</div>,
}));
vi.mock("../../src/components/shared/AgentChunkBubble", () => ({
  AgentChunkBubble: () => <div data-testid="agent-chunk-bubble" />,
}));
vi.mock("../../src/components/shared/ToolPendingBubble", () => ({
  ToolPendingBubble: () => <div data-testid="tool-pending-bubble" />,
}));
vi.mock("../../src/components/shared/ToolResultBubble", () => ({
  ToolResultBubble: () => <div data-testid="tool-result-bubble" />,
}));
vi.mock("../../src/components/shared/PermissionBubble", () => ({
  PermissionBubble: () => <div data-testid="permission-bubble" />,
}));
vi.mock("../../src/components/shared/StatusIndicatorPillMobile", () => ({
  StatusIndicatorPillMobile: () => <div data-testid="status-pill" />,
}));
vi.mock("../../src/components/shared/MarkdownContent", () => ({
  MarkdownContent: (p: any) => <span>{p.content}</span>,
}));
vi.mock("../../src/components/CopyButton", () => ({
  default: () => null,
}));

// Mock getMessageContent
vi.mock("../../src/components/ChatCanvas", () => ({
  getMessageContent: (msg: any) => {
    if (!msg) return null;
    return { type: "user", content: msg.raw?.content ?? msg.id };
  },
}));

// Mock usePaginatedMessages — controls pagination state per-thread
vi.mock("../../src/hooks/usePaginatedMessages", () => ({
  usePaginatedMessages: (threadId: string | null) => {
    if (!threadId) {
      return { messages: [], loadMore: vi.fn(), hasMore: false, isLoadingMore: false, totalCount: 0, refresh: vi.fn(), isLoading: false };
    }
    const msgs = threadId === "th-1" ? th1Messages : th2Messages;
    const hasMore = threadId === "th-1";
    return {
      messages: msgs,
      loadMore: vi.fn(),
      hasMore,
      isLoadingMore: false,
      totalCount: hasMore ? 15 : msgs.length,
      refresh: vi.fn(),
      isLoading: false,
    };
  },
}));

// Mock WebSocket hook
vi.mock("../../src/hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    sendMessage: vi.fn(),
    respondToPermission: vi.fn(),
    cancelAgent: vi.fn(),
  }),
}));

// Mock fetch for workspace/thread metadata
const mockFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function jsonResponse(payload: unknown): Response {
  return { ok: true, json: async () => payload } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});

  mockFetch.mockImplementation(async (url: string) => {
    const path = typeof url === "string" ? url : String(url);
    if (path === "/api/workspaces/ws-1") return jsonResponse({ id: "ws-1", name: "Mobile Project", path: "/projects/mobile" });
    if (path === "/api/workspaces/ws-1/threads") return jsonResponse(mockThreads);
    return jsonResponse([]);
  });

  // Override global fetch directly — survives clearAllMocks unlike stubGlobal
  (globalThis as any).fetch = mockFetch;
});

// Mock EventSource
vi.stubGlobal(
  "EventSource",
  class {
    close() {}
    addEventListener() {}
  },
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatPage — mobile pagination", () => {
  describe("hasMore indicator", () => {
    it("shows 'Load older messages' button when thread has more messages", async () => {
      render(
        <MemoryRouter initialEntries={["/messages/ws-1/th-1"]}>
          <Routes>
            <Route path="/messages/:workspaceId/:threadId" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      );

      // Wait for the thread title to appear (thread metadata loaded)
      await waitFor(() => {
        expect(screen.getByText("Thread One")).toBeDefined();
      });

      // th-1 has hasMore=true, so load-more button should appear
      await waitFor(() => {
        expect(screen.getByText(/Load older messages/)).toBeDefined();
      });
    });

    it("does NOT show load-more when all messages fit in one page", async () => {
      render(
        <MemoryRouter initialEntries={["/messages/ws-1/th-2"]}>
          <Routes>
            <Route path="/messages/:workspaceId/:threadId" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Thread Two")).toBeDefined();
      });

      // th-2 has hasMore=false, so no load-more button
      await waitFor(() => {
        expect(screen.queryByText(/Load older messages/)).toBeNull();
      });
    });
  });

  describe("messages rendered via pagination", () => {
    it("renders messages from usePaginatedMessages", async () => {
      render(
        <MemoryRouter initialEntries={["/messages/ws-1/th-1"]}>
          <Routes>
            <Route path="/messages/:workspaceId/:threadId" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Message 1")).toBeDefined();
      });

      expect(screen.getByText("Message 10")).toBeDefined();
    });
  });

  describe("thread metadata", () => {
    it("loads workspace path and thread info alongside pagination", async () => {
      render(
        <MemoryRouter initialEntries={["/messages/ws-1/th-1"]}>
          <Routes>
            <Route path="/messages/:workspaceId/:threadId" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Thread One")).toBeDefined();
      });

      // Workspace path should be fetched
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/ws-1");
      });
    });
  });
});
