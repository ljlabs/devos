import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ThreadList from "../../src/components/ThreadList";
import { WorkspaceModal } from "../../src/components/Dialogs";
import WorkspaceSidebar from "../../src/components/WorkspaceSidebar";
import { Thread, Workspace } from "../../src/types";

// ─── ThreadList unhappy paths ────────────────────────────────────────────

describe("ThreadList — Unhappy Path", () => {
  const baseProps = {
    activeThreadId: "",
    onSelectThread: vi.fn(),
    onOpenNewThread: vi.fn(),
    onRenameThread: vi.fn(),
    onDeleteThread: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  describe("empty and null states", () => {
    it("renders empty state for empty array", () => {
      render(<ThreadList {...baseProps} threads={[]} />);
      expect(screen.getByText(/No conversation threads/)).toBeInTheDocument();
    });

    it("does not render any thread items for empty array", () => {
      render(<ThreadList {...baseProps} threads={[]} />);
      expect(screen.queryByText("Idle")).not.toBeInTheDocument();
      expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
    });
  });

  describe("delete guard", () => {
    it("does not call onDeleteThread when confirm returns false", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = userEvent.setup();
      const threads: Thread[] = [
        { id: "t-1", workspaceId: "ws-1", title: "Thread One", status: "idle" },
      ];
      render(<ThreadList {...baseProps} threads={threads} />);
      const item = screen.getByText("Thread One").closest("div.group")!;
      const deleteBtn = within(item).getByTitle("Delete thread");
      await user.click(deleteBtn);

      expect(baseProps.onDeleteThread).not.toHaveBeenCalled();
    });

    it("calls confirm with correct thread name", async () => {
      const user = userEvent.setup();
      const threads: Thread[] = [
        { id: "t-1", workspaceId: "ws-1", title: "My Special Thread", status: "idle" },
      ];
      render(<ThreadList {...baseProps} threads={threads} />);
      const item = screen.getByText("My Special Thread").closest("div.group")!;
      const deleteBtn = within(item).getByTitle("Delete thread");
      await user.click(deleteBtn);

      expect(window.confirm).toHaveBeenCalledWith('Delete "My Special Thread"?');
    });
  });

  describe("rename guard", () => {
    it("does not commit rename when Enter pressed with empty string", async () => {
      const user = userEvent.setup();
      const threads: Thread[] = [
        { id: "t-1", workspaceId: "ws-1", title: "Original", status: "idle" },
      ];
      render(<ThreadList {...baseProps} threads={threads} />);
      const item = screen.getByText("Original").closest("div.group")!;
      const renameBtn = within(item).getByTitle("Rename thread");
      await user.click(renameBtn);

      const input = item.querySelector("input")!;
      await user.clear(input);
      await user.type(input, "{Enter}");

      // Empty title should not trigger rename (server rejects it)
      expect(baseProps.onRenameThread).not.toHaveBeenCalled();
    });

    it("Escape cancels rename and discards changes", async () => {
      const user = userEvent.setup();
      const threads: Thread[] = [
        { id: "t-1", workspaceId: "ws-1", title: "Original", status: "idle" },
      ];
      render(<ThreadList {...baseProps} threads={threads} />);
      const item = screen.getByText("Original").closest("div.group")!;
      const renameBtn = within(item).getByTitle("Rename thread");
      await user.click(renameBtn);

      const input = item.querySelector("input")!;
      await user.type(input, "This should be discarded{Escape}");

      expect(baseProps.onRenameThread).not.toHaveBeenCalled();
      expect(item.querySelector("input")).toBeNull();
      // Original text should still be visible
      expect(screen.getByText("Original")).toBeInTheDocument();
    });

    it("blur discards if title is empty", async () => {
      const user = userEvent.setup();
      const threads: Thread[] = [
        { id: "t-1", workspaceId: "ws-1", title: "Original", status: "idle" },
      ];
      render(<ThreadList {...baseProps} threads={threads} />);
      const item = screen.getByText("Original").closest("div.group")!;
      const renameBtn = within(item).getByTitle("Rename thread");
      await user.click(renameBtn);

      const input = item.querySelector("input")!;
      await user.clear(input);
      await user.tab(); // blur

      expect(baseProps.onRenameThread).not.toHaveBeenCalled();
    });
  });

  describe("all status variants render", () => {
    it("handles running status", () => {
      const threads: Thread[] = [
        { id: "t-1", workspaceId: "ws-1", title: "Running", status: "running" },
      ];
      render(<ThreadList {...baseProps} threads={threads} />);
      expect(screen.getByText("Running agent session")).toBeInTheDocument();
    });
  });
});

// ─── WorkspaceModal unhappy paths ────────────────────────────────────────

describe("WorkspaceModal — Unhappy Path", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    editingWorkspace: null as Workspace | null,
    name: "",
    setName: vi.fn(),
    path: "/Users/dev/test",
    setPath: vi.fn(),
    onSubmit: vi.fn((e: React.FormEvent) => e.preventDefault()),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty state behavior", () => {
    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <WorkspaceModal {...defaultProps} isOpen={false} />
      );
      expect(container.innerHTML).toBe("");
    });

    it("does not show submit button when modal is closed", () => {
      const { container } = render(
        <WorkspaceModal {...defaultProps} isOpen={false} />
      );
      expect(container.querySelector("button")).toBeNull();
    });
  });

  describe("submit with empty name", () => {
    it("browser prevents submit when name is empty (required attr)", async () => {
      const user = userEvent.setup();
      render(<WorkspaceModal {...defaultProps} name="" />);
      const submitBtn = screen.getByText("Create Workspace");
      await user.click(submitBtn);
      // The HTML5 `required` attribute on the name input prevents form submission
      expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("path is immutable", () => {
    it("path input is disabled only when editing", () => {
      render(
        <WorkspaceModal
          {...defaultProps}
          editingWorkspace={{ id: "ws-1", name: "test", path: "/immutable/path" }}
          path="/immutable/path"
        />
      );
      const pathInput = screen.getByPlaceholderText("/Users/developer/projects/...");
      expect(pathInput).toBeDisabled();
    });

    it("path input is editable when creating new workspace", () => {
      render(<WorkspaceModal {...defaultProps} path="/Users/dev/test" />);
      const pathInput = screen.getByPlaceholderText("/Users/developer/projects/...");
      expect(pathInput).not.toBeDisabled();
    });
  });
});

// ─── WorkspaceSidebar unhappy paths ──────────────────────────────────────

describe("WorkspaceSidebar — Unhappy Path", () => {
  const baseProps = {
    workspaces: [] as Workspace[],
    activeWorkspaceId: "",
    onSelectWorkspace: vi.fn(),
    onOpenNewWorkspace: vi.fn(),
    onEditWorkspace: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    activeView: "threads" as const,
    onSelectView: vi.fn(),
    collapsed: false,
    onToggleCollapse: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  describe("empty workspace state", () => {
    it("renders no workspace items when empty", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={[]} />);
      expect(screen.queryByText("Backend")).not.toBeInTheDocument();
    });

    it("still renders navigation when no workspaces", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={[]} />);
      expect(screen.getByText("Threads")).toBeInTheDocument();
      expect(screen.getByText("Global Logs")).toBeInTheDocument();
    });

    it("still renders New Workspace button when empty", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={[]} />);
      expect(screen.getByText("New Workspace")).toBeInTheDocument();
    });
  });

  describe("delete workspace guard", () => {
    it("does not delete when confirm returns false", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = userEvent.setup();
      const workspaces: Workspace[] = [
        { id: "ws-1", name: "My Workspace", path: "/ws" },
      ];
      render(<WorkspaceSidebar {...baseProps} workspaces={workspaces} />);
      const item = screen.getByText("My Workspace").closest("div.group")!;
      const deleteBtn = within(item).getByTitle("Delete workspace");
      await user.click(deleteBtn);

      expect(baseProps.onDeleteWorkspace).not.toHaveBeenCalled();
    });

    it("confirm dialog includes workspace name", async () => {
      const user = userEvent.setup();
      const workspaces: Workspace[] = [
        { id: "ws-1", name: "Prod Environment", path: "/prod" },
      ];
      render(<WorkspaceSidebar {...baseProps} workspaces={workspaces} />);
      const item = screen.getByText("Prod Environment").closest("div.group")!;
      const deleteBtn = within(item).getByTitle("Delete workspace");
      await user.click(deleteBtn);

      expect(window.confirm).toHaveBeenCalledWith(
        'Delete workspace "Prod Environment" and all its threads?'
      );
    });
  });

  describe("collapsed state isolates interaction", () => {
    it("edit and delete buttons are not visible when collapsed", () => {
      const workspaces: Workspace[] = [
        { id: "ws-1", name: "Backend", path: "/ws" },
      ];
      render(<WorkspaceSidebar {...baseProps} workspaces={workspaces} collapsed={true} />);
      expect(screen.queryByTitle("Edit workspace")).not.toBeInTheDocument();
      expect(screen.queryByTitle("Delete workspace")).not.toBeInTheDocument();
    });

    it("workspace names are hidden when collapsed", () => {
      const workspaces: Workspace[] = [
        { id: "ws-1", name: "Backend", path: "/ws" },
      ];
      render(<WorkspaceSidebar {...baseProps} workspaces={workspaces} collapsed={true} />);
      expect(screen.queryByText("Backend")).not.toBeInTheDocument();
    });

    it("New Workspace button still works when collapsed", async () => {
      const user = userEvent.setup();
      render(<WorkspaceSidebar {...baseProps} workspaces={[]} collapsed={true} />);
      const newWsBtn = screen.getByTitle("Register new local workspace");
      await user.click(newWsBtn);
      expect(baseProps.onOpenNewWorkspace).toHaveBeenCalled();
    });
  });

  describe("multiple workspaces — selection isolation", () => {
    it("clicking workspace B does not affect workspace A", async () => {
      const user = userEvent.setup();
      const workspaces: Workspace[] = [
        { id: "ws-1", name: "Alpha", path: "/a" },
        { id: "ws-2", name: "Beta", path: "/b" },
      ];
      render(<WorkspaceSidebar {...baseProps} workspaces={workspaces} />);
      await user.click(screen.getByText("Beta"));
      expect(baseProps.onSelectWorkspace).toHaveBeenCalledWith("ws-2");
      expect(baseProps.onSelectWorkspace).not.toHaveBeenCalledWith("ws-1");
    });
  });
});
