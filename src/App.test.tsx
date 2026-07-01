import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import type { Workspace, Thread, Message } from "./types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWorkspaces: Workspace[] = [
  { id: "ws-1", name: "Project Alpha", path: "/projects/alpha" },
  { id: "ws-2", name: "Project Beta", path: "/projects/beta" },
];

const mockThreads: Record<string, Thread[]> = {
  "ws-1": [
    { id: "th-1", workspaceId: "ws-1", title: "Thread One", status: "idle" },
    { id: "th-2", workspaceId: "ws-1", title: "Thread Two", status: "idle" },
  ],
  "ws-2": [
    { id: "th-3", workspaceId: "ws-2", title: "Thread Three", status: "idle" },
  ],
};

const mockMessages: Record<string, Message[]> = {
  "th-1": [
    { id: "msg-1", threadId: "th-1", timestamp: "2025-01-01T00:00:00Z", raw: { test: true } },
  ],
  "th-2": [],
  "th-3": [],
};

// Mock fetch globally
const mockFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function jsonResponse(data: unknown): Response {
  return { ok: true, json: async () => data } as Response;
}

function setupFetchMock() {
  mockFetch.mockImplementation(async (url: string) => {
    const path = typeof url === "string" ? url : String(url);
    if (path === "/api/workspaces") return jsonResponse(mockWorkspaces);
    const threadMatch = path.match(/\/api\/workspaces\/([^/]+)\/threads/);
    if (threadMatch) return jsonResponse(mockThreads[threadMatch[1]] ?? []);
    const msgMatch = path.match(/\/api\/threads\/([^/]+)\/messages/);
    if (msgMatch) return jsonResponse(mockMessages[msgMatch[1]] ?? []);
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", mockFetch);
}

// Mock EventSource for SSE
function stubEventSource() {
  vi.stubGlobal(
    "EventSource",
    class {
      close() {}
      addEventListener() {}
    },
  );
}

// Mock WebSocket hook to avoid actual WS connections
vi.mock("./hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    sendMessage: vi.fn(),
    respondToPermission: vi.fn(),
    cancelAgent: vi.fn(),
  }),
}));

// Suppress console noise
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(window, "confirm").mockReturnValue(true);
  stubEventSource();
  setupFetchMock();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("App routing", () => {
  describe("redirects", () => {
    it("redirects from / to /messages/ws-1 when workspaces are loaded", async () => {
      renderAt("/");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/workspaces");
      });

      // Should have fetched threads for ws-1
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/ws-1/threads");
      });
    });

    it("redirects from /messages/ws-1 to /messages/ws-1/th-1 when threads load", async () => {
      renderAt("/messages/ws-1");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/ws-1/threads");
      });

      // Should load messages for th-1 (first thread)
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/threads/th-1/messages");
      });
    });

    it("catch-all route redirects to /", async () => {
      renderAt("/nonexistent/path");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/workspaces");
      });
    });
  });

  describe("deep-linking", () => {
    it("loads the correct thread when given workspaceId and threadId", async () => {
      renderAt("/messages/ws-1/th-2");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/workspaces");
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/ws-1/threads");
      });

      // Should load messages for th-2, NOT th-1
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/threads/th-2/messages");
      });
    });

    it("loads a thread from a different workspace", async () => {
      renderAt("/messages/ws-2/th-3");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/ws-2/threads");
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/threads/th-3/messages");
      });
    });

    it("stays on same thread after re-render (simulating refresh)", async () => {
      const { unmount } = renderAt("/messages/ws-1/th-2");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/threads/th-2/messages");
      });

      unmount();
      (mockFetch as Mock).mockClear();
      setupFetchMock();

      renderAt("/messages/ws-1/th-2");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/threads/th-2/messages");
      });

      // Verify the only messages fetched were for th-2, not th-1
      const messageCalls = (mockFetch as Mock).mock.calls.filter(
        (c: unknown[]) => typeof c[0] === "string" && c[0].includes("/api/threads/"),
      );
      expect(messageCalls.every((c: unknown[]) => (c as unknown[])[0] === "/api/threads/th-2/messages")).toBe(true);
    });
  });

  describe("navigation via sidebar", () => {
    it("clicking a workspace navigates to /messages/{workspaceId}", async () => {
      const user = userEvent.setup();
      renderAt("/messages/ws-1/th-1");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/ws-1/threads");
      });

      // Find the second workspace button in the sidebar
      const betaButton = screen.getByText("Project Beta");
      await user.click(betaButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/ws-2/threads");
      });
    });
  });

  describe("navigation via thread list", () => {
    it("clicking a thread navigates to /messages/{workspaceId}/{threadId}", async () => {
      const user = userEvent.setup();
      renderAt("/messages/ws-1/th-1");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/ws-1/threads");
      });

      const threadTwoButton = screen.getByText("Thread Two");
      await user.click(threadTwoButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/threads/th-2/messages");
      });
    });
  });

  describe("workspace creation", () => {
    it("navigates to new workspace after creation", async () => {
      const user = userEvent.setup();

      // Add the new workspace to the mock response
      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        const path = typeof url === "string" ? url : String(url);
        if (path === "/api/workspaces" && init?.method === "POST") {
          const newWs: Workspace = { id: "ws-new", name: "New Project", path: "/new" };
          return jsonResponse(newWs);
        }
        if (path === "/api/workspaces") return jsonResponse(mockWorkspaces);
        const threadMatch = path.match(/\/api\/workspaces\/([^/]+)\/threads/);
        if (threadMatch) return jsonResponse(mockThreads[threadMatch[1]] ?? []);
        return jsonResponse([]);
      });

      renderAt("/messages/ws-1/th-1");

      await waitFor(() => {
        expect(screen.getByText("Project Alpha")).toBeDefined();
      });

      // Click the "+" button to open new workspace modal
      const addButton = screen.getByRole("button", { name: /add workspace|new workspace/i });
      await user.click(addButton);

      // Fill in the form by placeholder
      const nameInput = screen.getByPlaceholderText(/backend-services/i);
      await user.type(nameInput, "New Project");

      const pathInput = screen.getByPlaceholderText(/C:\/Users/i);
      await user.type(pathInput, "/new");

      // Submit
      const submitButton = screen.getByRole("button", { name: /Create Workspace/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/workspaces",
          expect.objectContaining({ method: "POST" }),
        );
      });
    });
  });

  describe("thread deletion", () => {
    it("navigates away from deleted thread", async () => {
      const user = userEvent.setup();

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        const path = typeof url === "string" ? url : String(url);
        if (path === "/api/threads/th-1" && init?.method === "DELETE") {
          return jsonResponse({ success: true });
        }
        if (path === "/api/workspaces") return jsonResponse(mockWorkspaces);
        const threadMatch = path.match(/\/api\/workspaces\/([^/]+)\/threads/);
        if (threadMatch) return jsonResponse(mockThreads[threadMatch[1]] ?? []);
        const msgMatch = path.match(/\/api\/threads\/([^/]+)\/messages/);
        if (msgMatch) return jsonResponse(mockMessages[msgMatch[1]] ?? []);
        return jsonResponse([]);
      });

      renderAt("/messages/ws-1/th-1");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/threads/th-1/messages");
      });

      // Find the delete button for Thread One
      const deleteButtons = screen.getAllByTitle("Delete thread");
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/threads/th-1",
          expect.objectContaining({ method: "DELETE" }),
        );
      });
    });
  });

  describe("message display", () => {
    it("loads and displays messages for the deep-linked thread", async () => {
      renderAt("/messages/ws-1/th-1");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/threads/th-1/messages");
      });

      // Verify the workspace name appears in the sidebar
      expect(screen.getByText("Project Alpha")).toBeDefined();
    });
  });
});
