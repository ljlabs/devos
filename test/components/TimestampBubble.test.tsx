import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserMessageBubble } from "../../src/components/shared/UserMessageBubble";
import { AgentTextBubble } from "../../src/components/shared/AgentTextBubble";
import { AgentChunkBubble } from "../../src/components/shared/AgentChunkBubble";

// Stub MarkdownContent to avoid pulling in rehype/remark in tests
vi.mock("../../src/components/shared/MarkdownContent", () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="markdown-content">{content}</div>
  ),
}));

// Stub CopyButton
vi.mock("../../src/components/CopyButton", () => ({
  default: () => <button data-testid="copy-btn">Copy</button>,
}));

const TODAY = "2025-06-15T14:30:00Z";
const YESTERDAY = "2025-06-14T09:15:00Z";
const LAST_MONTH = "2025-05-01T08:00:00Z";

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper: fix Date.now so "today" is deterministic
function freezeDate(dateStr: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(dateStr));
}

// ---------------------------------------------------------------------------
// UserMessageBubble
// ---------------------------------------------------------------------------
describe("UserMessageBubble timestamps", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows time-only for today's message (mobile)", () => {
    freezeDate(TODAY);
    render(
      <UserMessageBubble content="hello" timestamp={TODAY} compact />,
    );
    const tsEl = screen.getByText(/\d{1,2}:\d{2}/);
    // Should NOT contain a date
    expect(tsEl.textContent).not.toMatch(/Jun|2025/);
  });

  it("shows time-only for today's message (desktop)", () => {
    freezeDate(TODAY);
    render(
      <UserMessageBubble content="hello" timestamp={TODAY} />,
    );
    const tsEl = screen.getByText(/\d{1,2}:\d{2}/);
    expect(tsEl.textContent).not.toMatch(/Jun|2025/);
  });

  it("shows date + time for yesterday's message (mobile)", () => {
    freezeDate(TODAY);
    render(
      <UserMessageBubble content="old msg" timestamp={YESTERDAY} compact />,
    );
    const tsEl = screen.getByText(/Jun/);
    expect(tsEl.textContent).toContain("14");
    expect(tsEl.textContent).toContain("2025");
    expect(tsEl.textContent).toContain("·");
  });

  it("shows date + time for last month's message (desktop)", () => {
    freezeDate(TODAY);
    render(
      <UserMessageBubble content="old msg" timestamp={LAST_MONTH} />,
    );
    const tsEl = screen.getByText(/May/);
    expect(tsEl.textContent).toContain("1");
    expect(tsEl.textContent).toContain("2025");
  });

  it("renders message content alongside timestamp", () => {
    freezeDate(TODAY);
    render(
      <UserMessageBubble content="test content" timestamp={TODAY} />,
    );
    expect(screen.getByText("test content")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AgentTextBubble
// ---------------------------------------------------------------------------
describe("AgentTextBubble timestamps", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows time-only for today's message (mobile)", () => {
    freezeDate(TODAY);
    render(
      <AgentTextBubble content="reply" timestamp={TODAY} compact />,
    );
    const tsEls = screen.getAllByText(/\d{1,2}:\d{2}/);
    expect(tsEls.length).toBeGreaterThanOrEqual(1);
    expect(tsEls[0].textContent).not.toMatch(/Jun|2025/);
  });

  it("shows time-only for today's message (desktop)", () => {
    freezeDate(TODAY);
    render(
      <AgentTextBubble content="reply" timestamp={TODAY} />,
    );
    const tsEls = screen.getAllByText(/\d{1,2}:\d{2}/);
    expect(tsEls[0].textContent).not.toMatch(/Jun|2025/);
  });

  it("shows date + time for yesterday's message (mobile)", () => {
    freezeDate(TODAY);
    render(
      <AgentTextBubble content="reply" timestamp={YESTERDAY} compact />,
    );
    const tsEl = screen.getByText(/Jun/);
    expect(tsEl.textContent).toContain("14");
    expect(tsEl.textContent).toContain("·");
  });

  it("shows date + time for last month's message (desktop)", () => {
    freezeDate(TODAY);
    render(
      <AgentTextBubble content="reply" timestamp={LAST_MONTH} />,
    );
    const tsEl = screen.getByText(/May/);
    expect(tsEl.textContent).toContain("1");
    expect(tsEl.textContent).toContain("·");
  });

  it("shows CLAUDE label in header", () => {
    freezeDate(TODAY);
    render(
      <AgentTextBubble content="reply" timestamp={TODAY} />,
    );
    expect(screen.getByText("CLAUDE AI AGENT")).toBeInTheDocument();
  });

  it("renders markdown content", () => {
    freezeDate(TODAY);
    render(
      <AgentTextBubble content="**bold**" timestamp={TODAY} />,
    );
    expect(screen.getByTestId("markdown-content")).toHaveTextContent("**bold**");
  });
});

// ---------------------------------------------------------------------------
// AgentChunkBubble
// ---------------------------------------------------------------------------
describe("AgentChunkBubble timestamps", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows time-only for today's message (desktop)", () => {
    freezeDate(TODAY);
    render(
      <AgentChunkBubble content="streaming..." timestamp={TODAY} />,
    );
    const tsEls = screen.getAllByText(/\d{1,2}:\d{2}/);
    expect(tsEls[0].textContent).not.toMatch(/Jun|2025/);
  });

  it("shows date + time for yesterday's message (desktop)", () => {
    freezeDate(TODAY);
    render(
      <AgentChunkBubble content="streaming..." timestamp={YESTERDAY} />,
    );
    const tsEl = screen.getByText(/Jun/);
    expect(tsEl.textContent).toContain("14");
    expect(tsEl.textContent).toContain("·");
  });

  it("mobile layout has no timestamp (header is label-only)", () => {
    freezeDate(TODAY);
    const { container } = render(
      <AgentChunkBubble content="streaming..." timestamp={TODAY} compact />,
    );
    // Mobile header only shows "CLAUDE", no timestamp span
    expect(container.querySelector(".text-slate-500")).toBeNull();
  });

  it("desktop shows CLAUDE AI AGENT header with timestamp", () => {
    freezeDate(TODAY);
    render(
      <AgentChunkBubble content="streaming..." timestamp={TODAY} />,
    );
    expect(screen.getByText("CLAUDE AI AGENT")).toBeInTheDocument();
    expect(screen.getAllByText(/\d{1,2}:\d{2}/).length).toBeGreaterThanOrEqual(1);
  });
});
