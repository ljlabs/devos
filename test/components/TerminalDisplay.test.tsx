import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Mock xterm.js
const mockTerminalInstance = {
  open: vi.fn(),
  write: vi.fn(),
  onData: vi.fn(),
  dispose: vi.fn(),
};

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(() => mockTerminalInstance),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(() => ({
    proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })),
    fit: vi.fn(),
  })),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 1; // OPEN
  send = vi.fn();
  close = vi.fn();
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    // Simulate async open
    setTimeout(() => this.onopen?.(), 0);
  }

  simulateMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

(global as any).WebSocket = MockWebSocket;

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
(global as any).ResizeObserver = MockResizeObserver;

import TerminalDisplay from "../../src/components/TerminalDisplay";

describe("TerminalDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("renders the terminal container", () => {
    render(<TerminalDisplay />);
    // The component should render the xterm container div
    expect(document.querySelector(".flex-1.min-h-0")).toBeTruthy();
  });

  it("renders terminal header", () => {
    render(<TerminalDisplay threadTitle="Test Thread" />);
    expect(screen.getByText(/Test Thread/)).toBeInTheDocument();
  });

  it("creates xterm Terminal on mount", async () => {
    const { Terminal } = await import("@xterm/xterm");
    render(<TerminalDisplay />);
    expect(Terminal).toHaveBeenCalled();
  });

  it("opens WebSocket on mount", () => {
    render(<TerminalDisplay />);
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
  });

  it("sends terminal_create after WebSocket opens", async () => {
    render(<TerminalDisplay />);
    const ws = MockWebSocket.instances[0];
    // Simulate WebSocket open
    ws.onopen?.();
    await vi.advanceTimersByTimeAsync(10);

    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining('"terminal_create"')
    );
  });

  it("writes to terminal on WebSocket output message", async () => {
    render(<TerminalDisplay />);
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    await vi.advanceTimersByTimeAsync(10);

    ws.simulateMessage({ type: "terminal_output", data: "hello" });
    expect(mockTerminalInstance.write).toHaveBeenCalledWith("hello");
  });

  it("sends close message on unmount", async () => {
    const { unmount } = render(<TerminalDisplay />);
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    await vi.advanceTimersByTimeAsync(10);

    unmount();
    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining('"terminal_close"')
    );
  });

  it("disposes terminal on unmount", async () => {
    const { unmount } = render(<TerminalDisplay />);
    unmount();
    expect(mockTerminalInstance.dispose).toHaveBeenCalled();
  });

  it("renders virtual keyboard buttons", () => {
    render(<TerminalDisplay />);
    expect(screen.getByText("ESC")).toBeInTheDocument();
    expect(screen.getByText("TAB")).toBeInTheDocument();
    expect(screen.getByText("CTRL")).toBeInTheDocument();
    expect(screen.getByText("ALT")).toBeInTheDocument();
  });

  it("ESC button writes escape sequence to terminal", async () => {
    render(<TerminalDisplay />);
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    await vi.advanceTimersByTimeAsync(10);

    fireEvent.click(screen.getByText("ESC"));
    expect(mockTerminalInstance.write).toHaveBeenCalledWith("\x1b");
  });

  it("TAB button writes tab character to terminal", async () => {
    render(<TerminalDisplay />);
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    await vi.advanceTimersByTimeAsync(10);

    fireEvent.click(screen.getByText("TAB"));
    expect(mockTerminalInstance.write).toHaveBeenCalledWith("\t");
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(<TerminalDisplay onClose={onClose} />);
    // Find the X button in the header
    const closeBtn = screen.getByTitle("Close terminal");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
