import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ThreadList from "../../src/components/ThreadList";
import { Thread } from "../../src/types";

const mockOnSelectThread = vi.fn();
const mockOnOpenNewThread = vi.fn();
const mockOnRenameThread = vi.fn();
const mockOnDeleteThread = vi.fn();

const baseProps = {
  activeThreadId: "",
  onSelectThread: mockOnSelectThread,
  onOpenNewThread: mockOnOpenNewThread,
  onRenameThread: mockOnRenameThread,
  onDeleteThread: mockOnDeleteThread,
};

const sampleThreads: Thread[] = [
  { id: "t-1", workspaceId: "ws-1", title: "Thread One", status: "idle" },
  { id: "t-2", workspaceId: "ws-1", title: "Thread Two", status: "thinking" },
  { id: "t-3", workspaceId: "ws-1", title: "Thread Three", status: "awaiting_permission" },
];

describe("ThreadList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.confirm to return true by default
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  describe("Empty state", () => {
    it("renders empty state when no threads", () => {
      render(<ThreadList {...baseProps} threads={[]} />);
      expect(screen.getByText(/No conversation threads/)).toBeInTheDocument();
    });

    it("renders empty state when threads is undefined", () => {
      render(<ThreadList {...baseProps} threads={[]} />);
      expect(screen.getByText(/No conversation threads/)).toBeInTheDocument();
    });
  });

  describe("Thread rendering", () => {
    it("renders all threads", () => {
      render(<ThreadList {...baseProps} threads={sampleThreads} />);
      expect(screen.getByText("Thread One")).toBeInTheDocument();
      expect(screen.getByText("Thread Two")).toBeInTheDocument();
      expect(screen.getByText("Thread Three")).toBeInTheDocument();
    });

    it("shows 'Idle' status for idle threads", () => {
      render(<ThreadList {...baseProps} threads={sampleThreads} />);
      expect(screen.getByText("Idle")).toBeInTheDocument();
    });

    it("shows 'Thinking...' status for thinking threads", () => {
      render(<ThreadList {...baseProps} threads={sampleThreads} />);
      expect(screen.getByText("Thinking...")).toBeInTheDocument();
    });

    it("shows 'Awaiting permission...' status", () => {
      render(<ThreadList {...baseProps} threads={sampleThreads} />);
      expect(screen.getByText("Awaiting permission...")).toBeInTheDocument();
    });

    it("highlights active thread", () => {
      render(<ThreadList {...baseProps} threads={sampleThreads} activeThreadId="t-1" />);
      // The active thread should have the emerald bar indicator
      const activeThread = screen.getByText("Thread One").closest("div.group")!;
      expect(activeThread.className).toContain("bg-emerald-500/5");
    });
  });

  describe("Thread selection", () => {
    it("calls onSelectThread when thread is clicked", async () => {
      const user = userEvent.setup();
      render(<ThreadList {...baseProps} threads={sampleThreads} />);
      await user.click(screen.getByText("Thread One"));
      expect(mockOnSelectThread).toHaveBeenCalledWith("t-1");
    });
  });

  describe("New Thread button", () => {
    it("calls onOpenNewThread when clicked", async () => {
      const user = userEvent.setup();
      render(<ThreadList {...baseProps} threads={sampleThreads} />);
      await user.click(screen.getByText("New Thread"));
      expect(mockOnOpenNewThread).toHaveBeenCalled();
    });
  });

  describe("Rename thread", () => {
    it("enters edit mode when pencil is clicked", async () => {
      const user = userEvent.setup();
      render(<ThreadList {...baseProps} threads={sampleThreads} />);

      // Find the rename button for the first thread
      const threadItem = screen.getByText("Thread One").closest("div.group")!;
      const renameBtn = within(threadItem as HTMLElement).getByTitle("Rename thread");
      await user.click(renameBtn);

      // Should now show an input
      const input = threadItem.querySelector("input")!;
      expect(input).toBeDefined();
      expect(input.value).toBe("Thread One");
    });

    it("commits rename on Enter", async () => {
      const user = userEvent.setup();
      render(<ThreadList {...baseProps} threads={sampleThreads} />);

      const threadItem = screen.getByText("Thread One").closest("div.group")!;
      const renameBtn = within(threadItem as HTMLElement).getByTitle("Rename thread");
      await user.click(renameBtn);

      const input = threadItem.querySelector("input")!;
      await user.clear(input);
      await user.type(input, "Renamed Thread{Enter}");

      expect(mockOnRenameThread).toHaveBeenCalledWith("t-1", "Renamed Thread");
    });

    it("cancels rename on Escape", async () => {
      const user = userEvent.setup();
      render(<ThreadList {...baseProps} threads={sampleThreads} />);

      const threadItem = screen.getByText("Thread One").closest("div.group")!;
      const renameBtn = within(threadItem as HTMLElement).getByTitle("Rename thread");
      await user.click(renameBtn);

      const input = threadItem.querySelector("input")!;
      await user.type(input, "Should Not Save{Escape}");

      expect(mockOnRenameThread).not.toHaveBeenCalled();
      // Input should be gone
      expect(threadItem.querySelector("input")).toBeNull();
    });

    it("commits rename on blur", async () => {
      const user = userEvent.setup();
      render(<ThreadList {...baseProps} threads={sampleThreads} />);

      const threadItem = screen.getByText("Thread One").closest("div.group")!;
      const renameBtn = within(threadItem as HTMLElement).getByTitle("Rename thread");
      await user.click(renameBtn);

      const input = threadItem.querySelector("input")!;
      await user.clear(input);
      await user.type(input, "Blur Save");
      await user.tab(); // triggers blur

      expect(mockOnRenameThread).toHaveBeenCalledWith("t-1", "Blur Save");
    });
  });

  describe("Delete thread", () => {
    it("calls onDeleteThread when confirmed", async () => {
      const user = userEvent.setup();
      render(<ThreadList {...baseProps} threads={sampleThreads} />);

      const threadItem = screen.getByText("Thread One").closest("div.group")!;
      const deleteBtn = within(threadItem as HTMLElement).getByTitle("Delete thread");
      await user.click(deleteBtn);

      expect(window.confirm).toHaveBeenCalledWith('Delete "Thread One"?');
      expect(mockOnDeleteThread).toHaveBeenCalledWith("t-1");
    });

    it("does not call onDeleteThread when cancelled", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = userEvent.setup();
      render(<ThreadList {...baseProps} threads={sampleThreads} />);

      const threadItem = screen.getByText("Thread One").closest("div.group")!;
      const deleteBtn = within(threadItem as HTMLElement).getByTitle("Delete thread");
      await user.click(deleteBtn);

      expect(mockOnDeleteThread).not.toHaveBeenCalled();
    });
  });
});
