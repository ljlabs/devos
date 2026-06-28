import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsModal } from "../../src/components/Dialogs";

// Mock fetch globally
global.fetch = vi.fn();

const mockAllowedPatterns = [
  {
    pattern: "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe *",
    variant: "wildcard",
    createdAt: "2025-01-15T10:30:00Z",
  },
  {
    pattern: "C:/Users/jorda/.claude/skills/web-search/main.py *",
    variant: "wildcard",
    createdAt: "2025-01-16T14:20:00Z",
  },
  {
    pattern: "npm run build",
    variant: "exact",
    createdAt: "2025-01-17T08:00:00Z",
  },
];

describe("SettingsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders null when isOpen is false", () => {
    const { container } = render(
      <SettingsModal isOpen={false} onClose={vi.fn()} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders modal when isOpen is true", () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("fetches allowed patterns on mount", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAllowedPatterns,
    });
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/allowedPatterns");
    });
  });

  it("displays loaded patterns", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAllowedPatterns,
    });
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe *"
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText("C:/Users/jorda/.claude/skills/web-search/main.py *")
      ).toBeInTheDocument();
      expect(screen.getByText("npm run build")).toBeInTheDocument();
    });
  });

  it("shows wildcard variant badge for wildcard patterns", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAllowedPatterns,
    });
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      const badges = screen.getAllByText("wildcard");
      expect(badges.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows exact variant badge for exact patterns", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAllowedPatterns,
    });
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("exact")).toBeInTheDocument();
    });
  });

  it("shows loading state initially", () => {
    (global.fetch as any).mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => mockAllowedPatterns,
              }),
            100
          )
        )
    );
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows no patterns message when list is empty", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText("No allowed patterns saved yet.")
      ).toBeInTheDocument();
    });
  });

  it("calls onClose when close button is clicked", async () => {
    const mockOnClose = vi.fn();
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      const closeButton = screen.getAllByRole("button")[0]; // X button
      user.click(closeButton);
    });
  });

  it("calls onClose when close footer button is clicked", async () => {
    const mockOnClose = vi.fn();
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      const closeButton = screen.getByText("Close");
      user.click(closeButton);
    });
  });

  it("enables edit mode when Edit button is clicked", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAllowedPatterns,
    });
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      const editButtons = screen.getAllByText("Edit");
      user.click(editButtons[0]);
    });

    await waitFor(() => {
      const input = screen.getByDisplayValue(mockAllowedPatterns[0].pattern);
      expect(input).toBeInTheDocument();
    });
  });

  it("saves edited pattern correctly", async () => {
    const mockDeleteResponse = {
      ok: true,
      json: async () => mockAllowedPatterns,
    };
    const mockPostResponse = {
      ok: true,
      json: async () => [
        ...mockAllowedPatterns,
        { pattern: "new-pattern *", variant: "wildcard", createdAt: "" },
      ],
    };

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockAllowedPatterns,
      })
      .mockResolvedValueOnce(mockDeleteResponse) // DELETE
      .mockResolvedValueOnce(mockPostResponse); // POST

    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(mockAllowedPatterns[0].pattern)).toBeInTheDocument();
    });

    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[0]);

    const input = screen.getByDisplayValue(mockAllowedPatterns[0].pattern);
    await user.clear(input);
    await user.type(input, "new-pattern *");

    const saveButton = screen.getByText("Save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/allowedPatterns", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: mockAllowedPatterns[0].pattern }),
      });
      expect(global.fetch).toHaveBeenCalledWith("/api/allowedPatterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: "new-pattern *" }),
      });
    });
  });

  it("deletes pattern when Delete button is clicked", async () => {
    const updatedPatterns = mockAllowedPatterns.slice(1);
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockAllowedPatterns,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => updatedPatterns,
      });

    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe *"
        )
      ).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button").filter((btn) =>
      btn.getAttribute("title") === "Delete pattern"
    );
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/allowedPatterns", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: mockAllowedPatterns[0].pattern }),
      });
    });
  });

  it("cancels edit and returns to list view", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAllowedPatterns,
    });
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(mockAllowedPatterns[0].pattern)).toBeInTheDocument();
    });

    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[0]);

    const cancelButton = screen.getByText("Cancel");
    await user.click(cancelButton);

    await waitFor(() => {
      // Pattern should be visible again (not in edit mode)
      expect(screen.getByText(mockAllowedPatterns[0].pattern)).toBeInTheDocument();
    });
  });

  it("shows error when trying to save empty pattern", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAllowedPatterns,
    });
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(mockAllowedPatterns[0].pattern)).toBeInTheDocument();
    });

    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[0]);

    const input = screen.getByDisplayValue(mockAllowedPatterns[0].pattern);
    await user.clear(input);

    const saveButton = screen.getByText("Save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("Pattern cannot be empty.")).toBeInTheDocument();
    });
  });

  it("normalizes patterns stored as plain strings", async () => {
    const mixedPatterns = [
      "simple-pattern *",
      {
        pattern: "C:/Users/jorda/.claude/skills/python.exe *",
        variant: "wildcard",
        createdAt: "2025-01-15T10:30:00Z",
      },
    ];

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mixedPatterns,
    });
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("simple-pattern *")).toBeInTheDocument();
      expect(
        screen.getByText("C:/Users/jorda/.claude/skills/python.exe *")
      ).toBeInTheDocument();
    });
  });

  it("patterns render with full paths visible", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAllowedPatterns,
    });
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      // Full paths should be visible in the rendered patterns
      expect(
        screen.getByText("C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe *")
      ).toBeInTheDocument();
    });
  });
});
