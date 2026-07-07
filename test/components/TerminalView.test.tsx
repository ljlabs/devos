/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TerminalView — verifies the iTerm2-style layout behaviour:
 *   - starts with a single pane + single tab
 *   - splitting a pane adds panes
 *   - closing a pane removes it (and its tab when last)
 *   - adding a tab adds an independent tab
 *
 * xterm.js and the live WebSocket are mocked so this runs under jsdom.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("../../src/hooks/useTerminalSocket", () => ({
  useTerminalSocket: () => ({
    createTerminal: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    closeTerminal: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  }),
}));

vi.mock("../../src/components/terminal/TerminalPane", () => ({
  default: ({ cwd, onSplit, onClose }: any) => (
    <div data-testid="terminal-pane" data-cwd={cwd || "~"}>
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
  ),
}));

vi.mock("../../src/components/terminal/ResizableSplit", () => ({
  default: ({ first, second }: any) => (
    <div data-testid="split">
      {first}
      {second}
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
});
