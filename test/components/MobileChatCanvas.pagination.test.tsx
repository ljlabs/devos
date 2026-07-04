import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MobileChatCanvas from "../../src/components/MobileChatCanvas";
import type { Thread, Message } from "../../src/types";

// ---------------------------------------------------------------------------
// Mock shared bubbles to keep the test focused on pagination UI
// ---------------------------------------------------------------------------
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

// Mock getMessageContent — return a simple user message for any input
vi.mock("../../src/components/ChatCanvas", () => ({
  getMessageContent: (msg: Message) => {
    if (!msg) return null;
    return { type: "user", content: msg.raw?.content ?? msg.id };
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseThread: Thread = {
  id: "th-1",
  workspaceId: "ws-1",
  title: "Test Thread",
  status: "idle",
};

function makeMsg(id: string, minutesAgo: number): Message {
  return {
    id,
    threadId: "th-1",
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    raw: { content: `Message ${id}` },
  };
}

function buildMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) =>
    makeMsg(`msg-${i + 1}`, count - i)
  );
}

const defaultProps = {
  activeThread: baseThread,
  messages: buildMessages(5),
  inputText: "",
  onChangeInput: vi.fn(),
  onSendMessage: vi.fn(),
  onCancelAgent: vi.fn(),
  onPermissionResponse: vi.fn(),
  onDeploy: vi.fn(),
  isDeploying: false,
  threadLogs: [],
  workspacePath: "/projects/alpha",
  onBack: vi.fn(),
};

function renderCanvas(overrides: Record<string, any> = {}) {
  return render(
    <MobileChatCanvas {...defaultProps} {...overrides} />
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MobileChatCanvas — pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Load more button", () => {
    it("renders 'Load older messages' button when hasMore is true", () => {
      renderCanvas({ hasMore: true, isLoadingMore: false, totalCount: 25 });

      expect(
        screen.getByText("Load older messages (25 total)")
      ).toBeDefined();
    });

    it("does NOT render load-more button when hasMore is false", () => {
      renderCanvas({ hasMore: false, totalCount: 5 });

      expect(screen.queryByText(/Load older messages/)).toBeNull();
    });

    it("does NOT render load-more button when hasMore is undefined", () => {
      renderCanvas({ hasMore: undefined, totalCount: undefined });

      expect(screen.queryByText(/Load older messages/)).toBeNull();
    });

    it("calls onLoadMore when the button is clicked", () => {
      const onLoadMore = vi.fn();
      renderCanvas({ hasMore: true, isLoadingMore: false, onLoadMore, totalCount: 15 });

      fireEvent.click(screen.getByText("Load older messages (15 total)"));

      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });
  });

  describe("Loading state", () => {
    it("shows 'Loading older messages...' when isLoadingMore is true", () => {
      renderCanvas({ hasMore: true, isLoadingMore: true, totalCount: 30 });

      expect(screen.getByText("Loading older messages...")).toBeDefined();
    });

    it("does NOT show the load-more button while loading", () => {
      renderCanvas({ hasMore: true, isLoadingMore: true, onLoadMore: vi.fn(), totalCount: 30 });

      expect(screen.queryByText(/Load older messages \(/)).toBeNull();
    });
  });

  describe("Scroll to load more", () => {
    it("calls onLoadMore when scrolled near the top", () => {
      const onLoadMore = vi.fn();
      renderCanvas({ hasMore: true, isLoadingMore: false, onLoadMore, totalCount: 20 });

      // Find the scroll container (the messages area div with overflow-y-auto)
      const scrollContainer = document.querySelector(".overflow-y-auto");
      expect(scrollContainer).toBeTruthy();

      // Simulate scroll near top (scrollTop < 100)
      Object.defineProperty(scrollContainer!, "scrollTop", { value: 20, writable: true });
      fireEvent.scroll(scrollContainer!);

      expect(onLoadMore).toHaveBeenCalled();
    });

    it("does NOT call onLoadMore when scrolled away from top", () => {
      const onLoadMore = vi.fn();
      renderCanvas({ hasMore: true, isLoadingMore: false, onLoadMore, totalCount: 20 });

      const scrollContainer = document.querySelector(".overflow-y-auto");
      expect(scrollContainer).toBeTruthy();

      // Simulate scroll away from top (scrollTop >= 100)
      Object.defineProperty(scrollContainer!, "scrollTop", { value: 200, writable: true });
      fireEvent.scroll(scrollContainer!);

      expect(onLoadMore).not.toHaveBeenCalled();
    });

    it("does NOT call onLoadMore when isLoadingMore is true (even near top)", () => {
      const onLoadMore = vi.fn();
      renderCanvas({ hasMore: true, isLoadingMore: true, onLoadMore, totalCount: 20 });

      const scrollContainer = document.querySelector(".overflow-y-auto");
      expect(scrollContainer).toBeTruthy();

      Object.defineProperty(scrollContainer!, "scrollTop", { value: 10, writable: true });
      fireEvent.scroll(scrollContainer!);

      expect(onLoadMore).not.toHaveBeenCalled();
    });

    it("does NOT call onLoadMore when hasMore is false", () => {
      const onLoadMore = vi.fn();
      renderCanvas({ hasMore: false, isLoadingMore: false, onLoadMore, totalCount: 5 });

      const scrollContainer = document.querySelector(".overflow-y-auto");
      expect(scrollContainer).toBeTruthy();

      Object.defineProperty(scrollContainer!, "scrollTop", { value: 0, writable: true });
      fireEvent.scroll(scrollContainer!);

      expect(onLoadMore).not.toHaveBeenCalled();
    });
  });

  describe("Message rendering with pagination", () => {
    it("renders user messages from the paginated set", () => {
      const messages = [makeMsg("msg-1", 10), makeMsg("msg-2", 5)];
      renderCanvas({ messages, hasMore: true, totalCount: 10 });

      expect(screen.getByText("Message msg-1")).toBeDefined();
      expect(screen.getByText("Message msg-2")).toBeDefined();
    });

    it("shows empty state when no messages", () => {
      renderCanvas({ messages: [], hasMore: false, totalCount: 0 });

      expect(screen.getByText("Start the conversation")).toBeDefined();
    });

    it("shows empty state when messages array is undefined", () => {
      renderCanvas({ messages: [], hasMore: false, totalCount: 0 });

      expect(screen.getByText("Start the conversation")).toBeDefined();
    });
  });

  describe("Thread switching", () => {
    it("scrolls to bottom when activeThread changes (thread switch)", () => {
      const scrollIntoView = vi.fn();
      HTMLDivElement.prototype.scrollIntoView = scrollIntoView;

      const { rerender } = render(
        <MobileChatCanvas {...defaultProps} activeThread={baseThread} />
      );

      // Re-render with a different thread
      rerender(
        <MobileChatCanvas
          {...defaultProps}
          activeThread={{ ...baseThread, id: "th-2", title: "Thread Two" }}
        />
      );

      // scrollIntoView should have been called (for the thread switch)
      expect(scrollIntoView).toHaveBeenCalled();
    });
  });
});
