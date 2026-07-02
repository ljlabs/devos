import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import React, { useEffect } from "react";

vi.mock("../src/routes/IdeRoute", () => ({
  default: () => <div data-testid="ide-route" />,
}));
vi.mock("../src/routes/LogsRoute", () => ({
  default: () => <div data-testid="logs-route" />,
}));
vi.mock("../src/components/WorkspaceSidebar", () => ({
  default: (props: any) => (
    <div data-testid="workspace-sidebar">
      {props.onSelectView && (
        <>
          <button data-testid="nav-threads" onClick={() => props.onSelectView("threads")}>Threads</button>
          <button data-testid="nav-logs" onClick={() => props.onSelectView("activity")}>Logs</button>
          <button data-testid="nav-ide" onClick={() => props.onSelectView("ide")}>IDE</button>
        </>
      )}
    </div>
  ),
}));
vi.mock("../src/components/ThreadList", () => ({ default: () => <div data-testid="thread-list" /> }));
vi.mock("../src/components/ChatCanvas", () => ({ default: () => <div data-testid="chat-canvas" /> }));
vi.mock("../src/components/Dialogs", () => ({
  WorkspaceModal: () => null,
  SettingsModal: () => null,
}));
vi.mock("../src/hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    sendMessage: vi.fn(),
    respondToPermission: vi.fn(),
    cancelAgent: vi.fn(),
  }),
}));
vi.mock("../src/hooks/useOptimisticMessages", () => ({
  useOptimisticMessages: () => ({
    messages: [],
    addOptimistic: vi.fn(),
    confirmMessage: vi.fn(),
    setConfirmed: vi.fn(),
    appendMessage: vi.fn(),
    clearOptimistic: vi.fn(),
  }),
}));
vi.mock("../src/pages/WorkspacesPage", () => ({ default: () => <div>wsp</div> }));
vi.mock("../src/pages/ThreadsPage", () => ({ default: () => <div>tp</div> }));
vi.mock("../src/pages/ChatPage", () => ({ default: () => <div>cp</div> }));

const mockFetch = vi.fn();
global.fetch = mockFetch;
(global as any).EventSource = class {
  onmessage: any = null;
  close = vi.fn();
  constructor() {}
};

let currentPath = "";
function PathSpy() {
  const loc = useLocation();
  useEffect(() => { currentPath = loc.pathname; }, [loc.pathname]);
  return null;
}

import App from "../src/App";

function renderApp(initialPath: string) {
  currentPath = "";
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PathSpy />
      <App />
    </MemoryRouter>
  );
}

function mockApi() {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url !== "string") return Promise.resolve({ ok: false });
    if (url.includes("/threads") && !url.includes("/messages")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ id: "t1", title: "T", workspaceId: "ws-1", status: "idle" }]),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  });
}

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 500)); });

function clickNav(id: string) {
  return act(async () => {
    document.querySelector(`[data-testid='${id}']`)?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
  });
}

describe("Route stability — no unwanted redirects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it("/logs stays on /logs after API loads", async () => {
    renderApp("/logs");
    await settle();
    expect(currentPath).toBe("/logs");
  });

  it("/messages/ws-1/t1 stays on /messages/ws-1/t1", async () => {
    renderApp("/messages/ws-1/t1");
    await settle();
    expect(currentPath).toBe("/messages/ws-1/t1");
  });

  it("/messages/ws-1 stays within /messages/ws-1/*", async () => {
    renderApp("/messages/ws-1");
    await settle();
    expect(currentPath).toMatch(/^\/messages\/ws-1/);
  });

  it("/ide/ws-1 stays on /ide/ws-1", async () => {
    renderApp("/ide/ws-1");
    await settle();
    expect(currentPath).toBe("/ide/ws-1");
  });

  it("/ide/ws-1/t1 stays on /ide/ws-1/t1", async () => {
    renderApp("/ide/ws-1/t1");
    await settle();
    expect(currentPath).toBe("/ide/ws-1/t1");
  });
});

describe("Sidebar navigation — correct URLs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it("clicking Logs from messages goes to /logs", async () => {
    renderApp("/messages/ws-1/t1");
    await settle();
    await clickNav("nav-logs");
    await settle();
    expect(currentPath).toBe("/logs");
  });

  it("clicking Threads from /logs returns to /messages/ws-1/t1", async () => {
    renderApp("/messages/ws-1/t1");
    await settle();
    await clickNav("nav-logs");
    await settle();
    expect(currentPath).toBe("/logs");

    await clickNav("nav-threads");
    await settle();
    expect(currentPath).toBe("/messages/ws-1/t1");
  });

  it("clicking IDE from /logs goes to /ide/ws-1/t1", async () => {
    renderApp("/messages/ws-1/t1");
    await settle();
    await clickNav("nav-logs");
    await settle();
    expect(currentPath).toBe("/logs");

    await clickNav("nav-ide");
    await settle();
    expect(currentPath).toBe("/ide/ws-1/t1");
  });

  it("clicking IDE from messages goes to /ide/ws-1/t1", async () => {
    renderApp("/messages/ws-1/t1");
    await settle();
    await clickNav("nav-ide");
    await settle();
    expect(currentPath).toBe("/ide/ws-1/t1");
  });
});

describe("Full round-trip navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it("messages -> logs -> ide -> messages preserves workspace context", async () => {
    renderApp("/messages/ws-1/t1");
    await settle();
    expect(currentPath).toBe("/messages/ws-1/t1");

    await clickNav("nav-logs");
    await settle();
    expect(currentPath).toBe("/logs");

    await clickNav("nav-ide");
    await settle();
    expect(currentPath).toBe("/ide/ws-1/t1");

    await clickNav("nav-threads");
    await settle();
    expect(currentPath).toBe("/messages/ws-1/t1");
  });

  it("messages -> ide -> logs -> ide -> messages survives full cycle", async () => {
    renderApp("/messages/ws-1/t1");
    await settle();

    await clickNav("nav-ide");
    await settle();
    expect(currentPath).toBe("/ide/ws-1/t1");

    await clickNav("nav-logs");
    await settle();
    expect(currentPath).toBe("/logs");

    await clickNav("nav-ide");
    await settle();
    expect(currentPath).toBe("/ide/ws-1/t1");

    await clickNav("nav-threads");
    await settle();
    expect(currentPath).toBe("/messages/ws-1/t1");
  });
});
