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

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Terminal } from "@xterm/xterm";

// Shared socket mock so tests can assert on createTerminal/write/closeTerminal.
const { mockSocket, capturedOnResize } = vi.hoisted(() => ({
  mockSocket: {
    createTerminal: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    closeTerminal: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    onHistory: vi.fn(() => () => {}),
  },
  // Captures the onResize prop passed to every TerminalPane render so tests
  // can assert closure identity stability across renders (Bug #5).
  capturedOnResize: [] as Array<(c: number, r: number) => void>,
}));

// Reset captured handlers and sessionStorage between tests.
beforeEach(() => {
  capturedOnResize.length = 0;
  sessionStorage.clear();
  // Clear the xterm Terminal constructor mock history so index-based lookups
  // in tests (e.g. Terminal.mock.results[0]) always reference the current test.
  (Terminal as unknown as Mock).mockClear();
  // Clear call history without wiping implementations.
  mockSocket.createTerminal.mockClear();
  mockSocket.write.mockClear();
  mockSocket.resize.mockClear();
  mockSocket.closeTerminal.mockClear();
  // subscribe and onHistory return cleanup fns — restore that default after clearing.
  mockSocket.subscribe.mockClear();
  mockSocket.subscribe.mockReturnValue(() => {});
  mockSocket.onHistory.mockClear();
  mockSocket.onHistory.mockReturnValue(() => {});
});

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
  useTerminalSocket: () => mockSocket,
}));

vi.mock("../../src/components/terminal/TerminalPane", () => {
  return {
    default: function MockTerminalPane({ cwd, onSplit, onClose, onFocus, onDragStart, onDrop, onResize }: any) {
      capturedOnResize.push(onResize);
      return (
        <div
          data-testid="terminal-pane"
          data-cwd={cwd || "~"}
          onClick={onFocus}
          onDrop={onDrop}
        >
          <div data-testid="drag-handle" draggable onDragStart={onDragStart}>
            Drag
          </div>
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

  // --- Bug #1: input path (term.onData → socket.write) is unwired ---------
  it("wires xterm onData to the socket so keystrokes reach the PTY", () => {
    render(<TerminalView />);

    // The single initial pane's Terminal registered an onData handler that
    // forwards keystrokes to the socket's `write` for that session.
    const term = (Terminal as unknown as Mock).mock.results[0].value as any;
    const onData = term.onData.mock.calls[0][0];
    expect(typeof onData).toBe("function");

    onData("ls\n");
    expect(mockSocket.write).toHaveBeenCalledWith(expect.any(String), "ls\n");
  });

  it("forwards keystrokes for every pane, including after a split", () => {
    render(<TerminalView />);

    // Split once → two panes, two distinct sessions.
    fireEvent.click(screen.getByTestId("split-right"));
    expect(screen.getAllByTestId("terminal-pane")).toHaveLength(2);

    const created = mockSocket.createTerminal.mock.calls.map((c) => c[0]);
    expect(created.length).toBeGreaterThanOrEqual(2);

    // Drive onData for the second-created session and confirm it routes to
    // the socket with the matching sessionId.
    const terms = (Terminal as unknown as Mock).mock.results;
    const secondTerm = terms[1].value as any;
    const onData = secondTerm.onData.mock.calls[0][0];

    onData("pwd");
    const sessionArg = (mockSocket.write.mock.calls.at(-1) as any)[0];
    expect(sessionArg).toBe(created[1]);
  });

  // --- Bug #2: switching tabs must not tear down other tabs' terminals ----
  it("keeps other tabs' terminals alive when switching tabs", () => {
    render(<TerminalView />);

    // Tab 1, split into two panes.
    fireEvent.click(screen.getByTestId("split-right"));
    expect(screen.getAllByTestId("terminal-pane")).toHaveLength(2);

    // Open a second tab (single pane) and switch to it.
    fireEvent.click(screen.getByTitle("New terminal tab"));
    const tabTitles = screen.getAllByText(/Terminal \d+/);
    const secondTab = tabTitles[1];
    fireEvent.click(secondTab);
    // Active tab now shows exactly one pane.
    expect(screen.getAllByTestId("terminal-pane")).toHaveLength(1);

    // Tab 1's sessions were created and must NOT have been closed.
    const totalCreated = mockSocket.createTerminal.mock.calls.length;
    const totalClosed = mockSocket.closeTerminal.mock.calls.length;
    // Tab 1 contributed 2 creates; the new tab + initial render contributed more.
    expect(totalClosed).toBeLessThan(totalCreated);

    // Switch back to tab 1 — its panes reappear, no fresh creates needed.
    const beforeReactivate = mockSocket.createTerminal.mock.calls.length;
    fireEvent.click(tabTitles[0]);
    expect(screen.getAllByTestId("terminal-pane")).toHaveLength(2);
    // Re-activating an already-created tab should not spawn new sessions.
    expect(mockSocket.createTerminal.mock.calls.length).toBe(beforeReactivate);
  });

  // --- Bug #6: render-phase terminal creation must be StrictMode-safe -----
  it("does not double-create terminals on StrictMode double-invocation", () => {
    // StrictMode double-invokes the component body within the SAME mount.
    // We assert that the has-guard prevents a second create for the same
    // sessionId when the body runs twice. We do this by rendering once,
    // then re-rendering the SAME instance (not unmount/remount).
    const { rerender } = render(<TerminalView />);

    // First render of the body already created the initial terminal.
    const sessionIds = mockSocket.createTerminal.mock.calls.map((c) => c[0]);

    // Re-render triggers the component body again. The has-guard must
    // prevent a second create for the same sessionId.
    rerender(<TerminalView />);

    const sessionIdsAfter = mockSocket.createTerminal.mock.calls.map((c) => c[0]);
    // Should be identical — no duplicate creates.
    expect(sessionIdsAfter).toEqual(sessionIds);
  });

  // --- Bug #5: onResize closure identity must be stable across renders ----
  it("passes a stable onResize to each TerminalPane across renders", () => {
    const { rerender } = render(<TerminalView />);

    // Capture the onResize handler for the single initial pane.
    const handlerBefore = capturedOnResize[capturedOnResize.length - 1];

    // Re-render without any layout change.
    rerender(<TerminalView />);

    // The same pane should receive the SAME onResize handler (referential
    // identity). A new closure every render would cause TerminalPane's
    // mount effect to re-run and rebuild the ResizeObserver.
    const handlerAfter = capturedOnResize[capturedOnResize.length - 1];
    expect(handlerAfter).toBe(handlerBefore);
  });
});
