import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceModal } from "../../src/components/Dialogs";
import { Workspace } from "../../src/types";

const mockOnClose = vi.fn();
const mockSetName = vi.fn();
const mockSetPath = vi.fn();
const mockOnSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());

const defaultProps = {
  isOpen: true,
  onClose: mockOnClose,
  editingWorkspace: null as Workspace | null,
  name: "test-ws",
  setName: mockSetName,
  path: "/Users/dev/test",
  setPath: mockSetPath,
  onSubmit: mockOnSubmit,
};

describe("WorkspaceModal", () => {
  it("renders null when isOpen is false", () => {
    const { container } = render(
      <WorkspaceModal {...defaultProps} isOpen={false} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders create mode when editingWorkspace is null", () => {
    render(<WorkspaceModal {...defaultProps} />);
    expect(screen.getByText("Register New Workspace")).toBeInTheDocument();
    expect(screen.getByText("Create Workspace")).toBeInTheDocument();
  });

  it("renders edit mode when editingWorkspace is set", () => {
    render(
      <WorkspaceModal
        {...defaultProps}
        editingWorkspace={{ id: "ws-1", name: "my-ws", path: "/ws" }}
      />
    );
    expect(screen.getByText("Edit Workspace")).toBeInTheDocument();
    expect(screen.getByText("Save Changes")).toBeInTheDocument();
  });

  it("displays workspace name in name input", () => {
    render(<WorkspaceModal {...defaultProps} name="my-project" />);
    expect(screen.getByDisplayValue("my-project")).toBeInTheDocument();
  });

  it("displays path in path input", () => {
    render(<WorkspaceModal {...defaultProps} path="/Users/dev/ws" />);
    expect(screen.getByDisplayValue("/Users/dev/ws")).toBeInTheDocument();
  });

  it("path input is disabled", () => {
    render(<WorkspaceModal {...defaultProps} />);
    const pathInput = screen.getByPlaceholderText("/Users/developer/projects/...");
    expect(pathInput).toBeDisabled();
  });

  it("name input is not disabled", () => {
    render(<WorkspaceModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("e.g. backend-services, task-dashboard");
    expect(nameInput).not.toBeDisabled();
  });

  it("calls setName when name input changes", async () => {
    const user = userEvent.setup();
    render(<WorkspaceModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("e.g. backend-services, task-dashboard");
    await user.clear(nameInput);
    await user.type(nameInput, "new-name");
    expect(mockSetName).toHaveBeenCalled();
  });

  it("calls onSubmit when form is submitted", async () => {
    const user = userEvent.setup();
    render(<WorkspaceModal {...defaultProps} />);
    const submitButton = screen.getByText("Create Workspace");
    await user.click(submitButton);
    expect(mockOnSubmit).toHaveBeenCalled();
  });

  it("calls onClose when cancel button is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkspaceModal {...defaultProps} />);
    const cancelButton = screen.getByText("Cancel");
    await user.click(cancelButton);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("calls onClose when X button is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkspaceModal {...defaultProps} />);
    // The X button is the first button (absolute positioned close)
    const buttons = screen.getAllByRole("button");
    const xButton = buttons[0]; // Close button
    await user.click(xButton);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("shows correct description for create mode", () => {
    render(<WorkspaceModal {...defaultProps} />);
    expect(
      screen.getByText(/Specify a workspace directory/)
    ).toBeInTheDocument();
  });

  it("shows correct description for edit mode", () => {
    render(
      <WorkspaceModal
        {...defaultProps}
        editingWorkspace={{ id: "ws-1", name: "my-ws", path: "/ws" }}
      />
    );
    expect(
      screen.getByText(/Update the workspace name/)
    ).toBeInTheDocument();
  });
});
