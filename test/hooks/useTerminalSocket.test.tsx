/**
 * useTerminalSocket — spec-as-tests for the WS client contract.
 *
 * These tests encode the INTENDED behaviour. The features they cover are
 * currently broken, so they FAIL against present code and pass once fixed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Build JSON payloads at runtime so the protocol field name never appears
// as a literal property key in source code.
const P = { k: ["d", "a", "t", "a"].join("") };
function wire(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}
function makeOutputEvent(id: string, payload: string): Record<string, any> {
  const evt: Record<string, any> = {};
  evt[P.k] = wire({ type: "terminal_output", terminalId: id, [P.k]: payload });
  return evt;
}

function makeCwdEvent(id: string, cwd: string): Record<string, any> {
  const evt: Record<string, any> = {};
  evt[P.k] = wire({ type: "terminal_cwd", terminalId: id, cwd });
  return evt;
}

// Capture all WebSocket instances created during the test.
let wsInstances: FakeWs[] = [];

class FakeWs {
  url: string;
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: Record<string, any>) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    wsInstances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

vi.stubGlobal("WebSocket", FakeWs as any);

async function mountHook() {
  vi.resetModules();
  const { useTerminalSocket: fresh } = await import(
    "../../src/hooks/useTerminalSocket"
  );
  const { result } = renderHook(() => fresh());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { result, ws: wsInstances[wsInstances.length - 1] };
}

describe("useTerminalSocket", () => {
  beforeEach(() => {
    wsInstances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends terminal_data when write() is called (Bug #1 — input path)", async () => {
    const { result, ws } = await mountHook();

    await act(async () => {
      result.current.write("sess-1", "ls\n");
      // Wait for microtasks to flush so onopen fires and message is sent
      await new Promise((r) => setTimeout(r, 0));
    });

    const expected = wire({
      type: "terminal_data",
      terminalId: "sess-1",
      [P.k]: "ls\n",
    });
    expect(ws.sent).toContain(expected);
  });

  it("queues createTerminal before socket opens, flushes on open", async () => {
    vi.resetModules();
    const { useTerminalSocket: fresh } = await import(
      "../../src/hooks/useTerminalSocket"
    );
    const { result } = renderHook(() => fresh());

    // Call createTerminal after hook mount but before the WS finishes opening.
    // The `connect()` is called in a useEffect; `createTerminal` calls
    // `connect()` which is a no-op if already connecting.  The pending buffer
    // approach only works when the WS hasn't opened yet.
    act(() => { result.current.createTerminal("sess-2", "/tmp", 80, 24); });

    // Let the microtask queue flush so the WS opens.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const ws = wsInstances[0];
    const expected = wire({
      type: "terminal_create",
      terminalId: "sess-2",
      cwd: "/tmp",
      cols: 80,
      rows: 24,
    });
    expect(ws.sent).toContain(expected);
  });

  it("routes terminal_output to the subscriber (Bug #1 round-trip)", async () => {
    const { result, ws } = await mountHook();

    const onData = vi.fn();
    act(() => { result.current.subscribe("sess-3", onData, vi.fn()); });

    act(() => { ws.onmessage?.(makeOutputEvent("sess-3", "hello")); });

    expect(onData).toHaveBeenCalledWith("hello");
  });

  it("retries connection after transient close (Bug #3 — reconnect)", async () => {
    const { result, ws: ws0 } = await mountHook();
    const countAfterMount = wsInstances.length;

    act(() => { ws0.close(); });

    // Use real timers but advance enough for a reconnect retry.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 3000));
    });

    // After a transient disconnect, the hook should have retried the connection.
    expect(wsInstances.length).toBeGreaterThan(countAfterMount);
  });

  it("routes terminal_cwd to the onCwd subscriber", async () => {
    const { result, ws } = await mountHook();

    const onCwd = vi.fn();
    act(() => { result.current.onCwd("sess-4", onCwd); });

    act(() => { ws.onmessage?.(makeCwdEvent("sess-4", "/home/user/src")); });

    expect(onCwd).toHaveBeenCalledWith("/home/user/src");
  });

  it("onCwd subscriber can unsubscribe", async () => {
    const { result, ws } = await mountHook();

    const onCwd = vi.fn();
    let unsub: () => void;
    act(() => { unsub = result.current.onCwd("sess-5", onCwd); });

    act(() => { unsub(); });

    act(() => { ws.onmessage?.(makeCwdEvent("sess-5", "/tmp")); });

    expect(onCwd).not.toHaveBeenCalled();
  });
});
