import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { initWebSocket, broadcastToThread } from "../../server_src/wsServer";

// Mock node-pty
const mockPtyWrite = vi.fn();
const mockPtyResize = vi.fn();
const mockPtyKill = vi.fn();
const mockOnDataCb = vi.fn();
const mockOnExitCb = vi.fn();

vi.mock("node-pty", () => ({
  default: {
    spawn: vi.fn(() => ({
      write: mockPtyWrite,
      resize: mockPtyResize,
      kill: mockPtyKill,
      onData: (cb: (...args: any[]) => any) => { mockOnDataCb.mockImplementation(cb); },
      onExit: (cb: (...args: any[]) => any) => { mockOnExitCb.mockImplementation(cb); },
    })),
  },
}));

// Mock fs for shell detection
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      if (p === "/bin/zsh") return true;
      return (actual as any).existsSync(p);
    }),
  };
});

function createTestServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer();
    const readDb = (_threadId: string) => ({ thread: undefined, messages: [] });
    const newId = (prefix: string) => `${prefix}-${Date.now()}`;

    initWebSocket(server, readDb, newId, {
      sendMessage: vi.fn(),
      respond: vi.fn(),
      cancel: vi.fn(),
    });

    server.listen(0, () => {
      const addr = server.address() as any;
      resolve({ server, port: addr.port });
    });
  });
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitForMessage(ws: WebSocket, type: string, timeout = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const handler = (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          ws.off("message", handler);
          resolve(msg);
        }
      } catch {}
    };
    ws.on("message", handler);
  });
}

describe("Terminal WebSocket integration", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    const s = await createTestServer();
    server = s.server;
    port = s.port;
  });

  afterEach(async () => {
    // Close all WS connections first
    server.close();
  });

  it("sends terminal_create and receives terminal_created", async () => {
    const ws = await connectWs(port);
    ws.send(JSON.stringify({ type: "terminal_create", terminalId: "t1", cols: 80, rows: 24 }));
    const msg = await waitForMessage(ws, "terminal_created");
    expect(msg.terminalId).toBe("t1");
    ws.close();
  });

  it("sends terminal_data and writes to PTY", async () => {
    const ws = await connectWs(port);
    ws.send(JSON.stringify({ type: "terminal_create", terminalId: "t2", cols: 80, rows: 24 }));
    await waitForMessage(ws, "terminal_created");

    ws.send(JSON.stringify({ type: "terminal_data", terminalId: "t2", data: "ls\n" }));
    // Allow time for message processing
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPtyWrite).toHaveBeenCalledWith("ls\n");
    ws.close();
  });

  it("sends terminal_resize and calls PTY resize", async () => {
    const ws = await connectWs(port);
    ws.send(JSON.stringify({ type: "terminal_create", terminalId: "t3", cols: 80, rows: 24 }));
    await waitForMessage(ws, "terminal_created");

    ws.send(JSON.stringify({ type: "terminal_resize", terminalId: "t3", cols: 120, rows: 40 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPtyResize).toHaveBeenCalledWith(120, 40);
    ws.close();
  });

  it("sends terminal_close and cleans up", async () => {
    const ws = await connectWs(port);
    ws.send(JSON.stringify({ type: "terminal_create", terminalId: "t4", cols: 80, rows: 24 }));
    await waitForMessage(ws, "terminal_created");

    ws.send(JSON.stringify({ type: "terminal_close", terminalId: "t4" }));
    const msg = await waitForMessage(ws, "terminal_closed");
    expect(msg.terminalId).toBe("t4");
    ws.close();
  });

  it("returns error for unknown message type", async () => {
    const ws = await connectWs(port);
    ws.send(JSON.stringify({ type: "unknown_type" }));
    const msg = await waitForMessage(ws, "error");
    expect(msg.message).toContain("unknown");
    ws.close();
  });

  it("returns error when terminal_create missing terminalId", async () => {
    const ws = await connectWs(port);
    ws.send(JSON.stringify({ type: "terminal_create" }));
    const msg = await waitForMessage(ws, "error");
    expect(msg.message).toContain("terminalId");
    ws.close();
  });

  it("returns error when terminal_data missing fields", async () => {
    const ws = await connectWs(port);
    ws.send(JSON.stringify({ type: "terminal_data", terminalId: "t5" }));
    const msg = await waitForMessage(ws, "error");
    expect(msg.message).toContain("data");
    ws.close();
  });

  it("reconnects to existing terminal (idempotent create)", async () => {
    const ws1 = await connectWs(port);
    ws1.send(JSON.stringify({ type: "terminal_create", terminalId: "t6", cols: 80, rows: 24 }));
    await waitForMessage(ws1, "terminal_created");

    // Second connection to same terminal
    const ws2 = await connectWs(port);
    ws2.send(JSON.stringify({ type: "terminal_create", terminalId: "t6", cols: 80, rows: 24 }));
    const msg = await waitForMessage(ws2, "terminal_created");
    expect(msg.terminalId).toBe("t6");

    ws1.close();
    ws2.close();
  });

  // --- Bug #4: an exited PTY must be closed server-side, not left as a zombie
  // A later reconnect to the same id should spawn a fresh shell, not route to
  // a dead session. We assert the exit handler triggers a terminal_manager
  // close (pty.kill) and that a second create re-spawns the PTY (new onData).
  it("closes the PTY on exit so a later reconnect re-spawns a fresh shell", async () => {
    const ws = await connectWs(port);
    ws.send(JSON.stringify({ type: "terminal_create", terminalId: "t7", cols: 80, rows: 24 }));
    await waitForMessage(ws, "terminal_created");

    // Simulate the PTY exiting (server emits terminal_exit and should release
    // the session so it isn't a zombie).
    mockOnExitCb({ exitCode: 0 });
    const exitMsg = await waitForMessage(ws, "terminal_exit");
    expect(exitMsg.terminalId).toBe("t7");
    // The session must be torn down on exit, not left lingering.
    expect(mockPtyKill).toHaveBeenCalled();

    // A reconnect to the same terminalId must re-create a live PTY rather than
    // silently routing output to a dead session.
    const ws2 = await connectWs(port);
    mockPtyWrite.mockClear();
    ws2.send(JSON.stringify({ type: "terminal_create", terminalId: "t7", cols: 80, rows: 24 }));
    await waitForMessage(ws2, "terminal_created");
    ws2.send(JSON.stringify({ type: "terminal_data", terminalId: "t7", data: "echo hi\n" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPtyWrite).toHaveBeenCalledWith("echo hi\n");

    ws.close();
    ws2.close();
  });

  // --- Bug #3: live session must survive a transient socket disconnect
  // When the client WS drops, the server should detach output routing but keep
  // the PTY alive, so a reconnect re-wires (re-attaches) the live session.
  it("keeps the PTY alive across a client disconnect so a reconnect re-attaches", async () => {
    const ws1 = await connectWs(port);
    ws1.send(JSON.stringify({ type: "terminal_create", terminalId: "t8", cols: 80, rows: 24 }));
    await waitForMessage(ws1, "terminal_created");

    // Client drops (e.g. transient network blip). The PTY must NOT be killed.
    ws1.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPtyKill).not.toHaveBeenCalled();

    // Reconnect on a fresh socket; the live session is re-wired (not re-spawned
    // as a new shell), and terminal output flows to the new client.
    mockPtyWrite.mockClear();
    const ws2 = await connectWs(port);
    ws2.send(JSON.stringify({ type: "terminal_create", terminalId: "t8", cols: 80, rows: 24 }));
    await waitForMessage(ws2, "terminal_created");
    ws2.send(JSON.stringify({ type: "terminal_data", terminalId: "t8", data: "whoami\n" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPtyWrite).toHaveBeenCalledWith("whoami\n");

    ws2.close();
  });
});
