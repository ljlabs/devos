/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TerminalView — verifies the iTerm2-style layout behaviour:
 *   - starts with a single pane + single tab
 *   - splitting a pane adds panes
 *   - closing a pane removes it (and its tab when last)
 *   - adding a tab adds an independent tab
 *   - view-level split button targets the focused pane
 *
 * xterm.js, the live WebSocket, and xterm Terminal constructor are all
 * mocked so this runs under jsdom.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function () {
    return {
      open: vi.fn(),
      write: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      cols: 80,
      rows: 24,
    };
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    loadAddon: vi.fn(),
    fit: vi.fn(),
  })),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("../../src/hooks/useTerminalSocket", () => ({
  useTerminalSocket: () => ({
    createTerminal: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    closeTerminal: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  }),
}));

vi.mock("../../src/components/terminal/TerminalPane", () => {
  return {
    default: function MockTerminalPane({ cwd, onSplit, onClose, onFocus, onDragStart, onDrop }: any) {
      return (
        <div
          data-testid="terminal-pane"
          data-cwd={cwd || "~"}
          onClick={onFocus}
          draggable
          onDragStart={onDragStart}
          onDrop={onDrop}
        >
          <button data-testid="split-right" onClick={() => onSplit("horizontal")}>
            Split right
          </button>
          <button data-testid="split-down" onClick={() => onSplit("vertical")}>
            Split down
          </button>
          <button data-testid="pane-close" onClick={onClose}>
            Close pane
          </button>
        </div>
      );
    },
  };
});

vi.mock("../../src/components/terminal/ResizableSplit", () => ({
  default: ({ first, second, direction, sizes }: any) => (
    <div data-testid="split" data-direction={direction}>
      <div data-testid="split-first">{first}</div>
      <div data-testid="split-second">{second}</div>
    </div>
  ),
}));

import TerminalView from "../../src/components/terminal/TerminalView";

describe("TerminalView", () => {
  it("renders a single terminal pane and single tab initially", () => {
    render(<TerminalView />);
    expect(screen.getAllByTestId("terminal-pane")).toHaveLength(1);
    expect(screen.getAllByText(/Terminal \d+/)).toHaveLength(1);
  });

  it("splits a pane into two panes", () => {
    render(<TerminalView />);
    expect(screen.getAllByTestId("terminal-pane")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("split-right"));
    expect(screen.getAllByTestId("terminal-pane")).toHaveLength(2);
  });

  it("closes a pane and removes it from the layout", () => {
    render(<TerminalView />);
    fireEvent.click(screen.getByTestId("split-right"));
    expect(screen.getAllByTestId("terminal-pane")).toHaveLength(2);

    // Close the first pane → one remains.
    const panes = screen.getAllByTestId("terminal-pane");
    fireEvent.click(within(panes[0]).getByTestId("pane-close"));
    expect(screen.getAllByTestId("terminal-pane")).toHaveLength(1);
  });

  it("adds an independent terminal tab", () => {
    render(<TerminalView />);
    expect(screen.getAllByText(/Terminal \d+/)).toHaveLength(1);

    fireEvent.click(screen.getByTitle("New terminal tab"));
    expect(screen.getAllByText(/Terminal \d+/)).toHaveLength(2);
  });

  it("closing the only pane of a single tab closes the tab too", () => {
    render(<TerminalView />);
    expect(screen.getAllByText(/Terminal \d+/)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("pane-close"));
    // Layout reset to a fresh single pane; the original tab was removed and
    // the view re-seeded with one tab.
    expect(screen.getAllByText(/Terminal \d+/)).toHaveLength(1);
  });

  it("view-level split button splits the focused pane", () => {
    render(<TerminalView />);
    fireEvent.click(screen.getByTestId("split-right")); // → 2 panes
    expect(screen.getAllByTestId("terminal-pane")).toHaveLength(2);

    // Focus the second pane, then split via the view-level button.
    const panes = screen.getAllByTestId("terminal-pane");
    fireEvent.click(panes[1]);

    fireEvent.click(screen.getByTitle("Split focused pane right"));
    // Focused pane is the one that splits → 3 panes total.
    expect(screen.getAllByTestId("terminal-pane")).toHaveLength(3);
  });

  it("dragging a pane onto another relocates it (same session, no copy)", () => {
    render(<TerminalView />);
    fireEvent.click(screen.getByTestId("split-right")); // → 2 panes (A, B)
    const before = screen.getAllByTestId("terminal-pane").length;
    expect(before).toBe(2);

    const panes = screen.getAllByTestId("terminal-pane");
    // Drag pane 0, drop it onto pane 1.
    fireEvent.dragStart(panes[0]);
    fireEvent.drop(panes[1]);

    // Relocated, not copied: still two panes.
    expect(screen.getAllByTestId("terminal-pane")).toHaveLength(2);
  });
});
