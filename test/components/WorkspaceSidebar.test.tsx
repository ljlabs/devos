import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkspaceSidebar from "../../src/components/WorkspaceSidebar";
import { Workspace } from "../../src/types";

const mockOnSelectWorkspace = vi.fn();
const mockOnOpenNewWorkspace = vi.fn();
const mockOnEditWorkspace = vi.fn();
const mockOnDeleteWorkspace = vi.fn();
const mockOnSelectView = vi.fn();
const mockOnToggleCollapse = vi.fn();

const baseProps = {
  workspaces: [] as Workspace[],
  activeWorkspaceId: "",
  onSelectWorkspace: mockOnSelectWorkspace,
  onOpenNewWorkspace: mockOnOpenNewWorkspace,
  onEditWorkspace: mockOnEditWorkspace,
  onDeleteWorkspace: mockOnDeleteWorkspace,
  activeView: "threads" as const,
  onSelectView: mockOnSelectView,
  collapsed: false,
  onToggleCollapse: mockOnToggleCollapse,
};

const sampleWorkspaces: Workspace[] = [
  { id: "ws-1", name: "Backend API", path: "/projects/backend" },
  { id: "ws-2", name: "Frontend App", path: "/projects/frontend" },
];

describe("WorkspaceSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  describe("Workspace rendering", () => {
    it("renders all workspace names", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} />);
      expect(screen.getByText("Backend API")).toBeInTheDocument();
      expect(screen.getByText("Frontend App")).toBeInTheDocument();
    });

    it("renders empty workspace list", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={[]} />);
      expect(screen.queryByText("Backend API")).not.toBeInTheDocument();
    });

    it("shows 'Workspaces' label when expanded", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} />);
      expect(screen.getByText("Workspaces")).toBeInTheDocument();
    });

    it("hides 'Workspaces' label when collapsed", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} collapsed={true} />);
      expect(screen.queryByText("Workspaces")).not.toBeInTheDocument();
    });
  });

  describe("Active workspace", () => {
    it("highlights the active workspace", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} activeWorkspaceId="ws-1" />);
      const activeBtn = screen.getByText("Backend API").closest("button")!;
      expect(activeBtn.className).toContain("bg-emerald-500/10");
    });

    it("does not highlight inactive workspaces", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} activeWorkspaceId="ws-1" />);
      const inactiveBtn = screen.getByText("Frontend App").closest("button")!;
      expect(inactiveBtn.className).not.toContain("bg-emerald-500/10");
    });
  });

  describe("Workspace selection", () => {
    it("calls onSelectWorkspace when workspace is clicked", async () => {
      const user = userEvent.setup();
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} />);
      await user.click(screen.getByText("Backend API"));
      expect(mockOnSelectWorkspace).toHaveBeenCalledWith("ws-1");
    });
  });

  describe("Edit workspace", () => {
    it("calls onEditWorkspace when settings button is clicked", async () => {
      const user = userEvent.setup();
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} />);
      const wsItem = screen.getByText("Backend API").closest("div.group")!;
      const settingsBtn = within(wsItem).getByTitle("Edit workspace");
      await user.click(settingsBtn);
      expect(mockOnEditWorkspace).toHaveBeenCalledWith("ws-1");
    });
  });

  describe("Delete workspace", () => {
    it("calls onDeleteWorkspace when confirmed", async () => {
      const user = userEvent.setup();
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} />);
      const wsItem = screen.getByText("Backend API").closest("div.group")!;
      const deleteBtn = within(wsItem).getByTitle("Delete workspace");
      await user.click(deleteBtn);
      expect(window.confirm).toHaveBeenCalledWith('Delete workspace "Backend API" and all its threads?');
      expect(mockOnDeleteWorkspace).toHaveBeenCalledWith("ws-1");
    });

    it("does not call onDeleteWorkspace when cancelled", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = userEvent.setup();
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} />);
      const wsItem = screen.getByText("Backend API").closest("div.group")!;
      const deleteBtn = within(wsItem).getByTitle("Delete workspace");
      await user.click(deleteBtn);
      expect(mockOnDeleteWorkspace).not.toHaveBeenCalled();
    });
  });

  describe("Navigation", () => {
    it("calls onSelectView with correct view for each nav button", async () => {
      const user = userEvent.setup();
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} />);

      await user.click(screen.getByText("Search Code"));
      expect(mockOnSelectView).toHaveBeenCalledWith("search");

      await user.click(screen.getByText("Global Logs"));
      expect(mockOnSelectView).toHaveBeenCalledWith("activity");

      await user.click(screen.getByText("Gatekeeping Rules"));
      expect(mockOnSelectView).toHaveBeenCalledWith("security");
    });

    it("highlights the active view", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} activeView="search" />);
      const searchBtn = screen.getByText("Search Code").closest("button")!;
      expect(searchBtn.className).toContain("bg-emerald-500/5");
    });
  });

  describe("New Workspace button", () => {
    it("calls onOpenNewWorkspace when clicked", async () => {
      const user = userEvent.setup();
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} />);
      await user.click(screen.getByText("New Workspace"));
      expect(mockOnOpenNewWorkspace).toHaveBeenCalled();
    });
  });

  describe("Collapse/Expand", () => {
    it("calls onToggleCollapse when menu button is clicked", async () => {
      const user = userEvent.setup();
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} />);
      const menuBtn = screen.getByTitle("Collapse sidebar");
      await user.click(menuBtn);
      expect(mockOnToggleCollapse).toHaveBeenCalled();
    });

    it("shows expand button when collapsed", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} collapsed={true} />);
      expect(screen.getByTitle("Expand sidebar")).toBeInTheDocument();
    });

    it("hides workspace names when collapsed", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} collapsed={true} />);
      expect(screen.queryByText("Backend API")).not.toBeInTheDocument();
    });

    it("shows collapsed 'D' logo when collapsed", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} collapsed={true} />);
      expect(screen.getByText("D")).toBeInTheDocument();
    });

    it("shows DevOS brand when expanded", () => {
      render(<WorkspaceSidebar {...baseProps} workspaces={sampleWorkspaces} collapsed={false} />);
      expect(screen.getByText("Dev")).toBeInTheDocument();
      expect(screen.getByText("OS")).toBeInTheDocument();
    });
  });
});
