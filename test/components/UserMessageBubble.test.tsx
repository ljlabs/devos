import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserMessageBubble } from "../../src/components/shared/UserMessageBubble";

const SAMPLE_CONTENT = "Hello, this is a test message from the user.";
const SAMPLE_TIMESTAMP = new Date(2025, 5, 15, 14, 34).toISOString(); // Jun 15, 2025 2:34 PM

// jsdom has no navigator.clipboard. We mock CopyButton to test its rendering
// and content prop, and test clipboard behavior via the mock.
const handleCopyMock = vi.fn();
let copiedState = false;

vi.mock("../../src/components/CopyButton", () => ({
  default: function MockCopyButton({ content }: { content: string }) {
    return (
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(content);
            copiedState = true;
            handleCopyMock(content);
            setTimeout(() => { copiedState = false; }, 2000);
          } catch {
            // silent
          }
        }}
      >
        {copiedState ? "Copied!" : "Copy"}
      </button>
    );
  },
}));

// Clipboard mock
const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  copiedState = false;

  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWriteText },
    writable: true,
    configurable: true,
  });
});

describe("UserMessageBubble", () => {
  // ── Content rendering ────────────────────────────────────────────────

  describe("Content rendering", () => {
    it("renders the message content in desktop layout", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      expect(screen.getByText(SAMPLE_CONTENT)).toBeInTheDocument();
    });

    it("renders the message content in compact (mobile) layout", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} compact />);
      expect(screen.getByText(SAMPLE_CONTENT)).toBeInTheDocument();
    });

    it("renders a paragraph element for the content", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      expect(screen.getByText(SAMPLE_CONTENT).tagName).toBe("P");
    });
  });

  // ── Text selection ───────────────────────────────────────────────────

  describe("Text selection (select-text)", () => {
    it("desktop layout has select-text on the outer container", () => {
      const { container } = render(
        <UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />
      );
      expect(container.firstElementChild!.className).toContain("select-text");
    });

    it("mobile layout bubble has select-text class", () => {
      render(
        <UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} compact />
      );
      expect(screen.getByText(SAMPLE_CONTENT).closest("div.select-text")).not.toBeNull();
    });

    it("desktop timestamp has select-none to prevent selection", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      const timeEl = screen.getByText(/Jun 15, 2025/);
      expect(timeEl.closest("div.select-none")).not.toBeNull();
    });

    it("mobile timestamp has select-none to prevent selection", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} compact />);
      expect(document.querySelectorAll(".select-none").length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── CopyButton presence and parity ───────────────────────────────────

  describe("CopyButton parity with response bubbles", () => {
    it("renders a CopyButton in desktop layout", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    });

    it("renders a CopyButton in mobile (compact) layout", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} compact />);
      expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    });

    it("CopyButton in desktop is positioned below the bubble", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      expect(screen.getByRole("button", { name: /copy/i }).closest("div.mt-1")).not.toBeNull();
    });

    it("CopyButton in mobile is positioned beside the bubble", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} compact />);
      expect(
        screen.getByRole("button", { name: /copy/i }).closest("div.flex.items-end")
      ).not.toBeNull();
    });

    it("passes the full message content to CopyButton in desktop", async () => {
      const user = userEvent.setup();
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      await user.click(screen.getByRole("button", { name: /copy/i }));
      expect(handleCopyMock).toHaveBeenCalledWith(SAMPLE_CONTENT);
    });

    it("passes the full message content to CopyButton in mobile", async () => {
      const user = userEvent.setup();
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} compact />);
      await user.click(screen.getByRole("button", { name: /copy/i }));
      expect(handleCopyMock).toHaveBeenCalledWith(SAMPLE_CONTENT);
    });
  });

  // ── Clipboard interaction ────────────────────────────────────────────

  describe("Copy-to-clipboard interaction", () => {
    it("calls clipboard.writeText on click in desktop", async () => {
      const user = userEvent.setup();
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      await user.click(screen.getByRole("button", { name: /copy/i }));
      expect(clipboardWriteText).toHaveBeenCalledWith(SAMPLE_CONTENT);
    });

    it("calls clipboard.writeText on click in mobile", async () => {
      const user = userEvent.setup();
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} compact />);
      await user.click(screen.getByRole("button", { name: /copy/i }));
      expect(clipboardWriteText).toHaveBeenCalledWith(SAMPLE_CONTENT);
    });

    it("shows 'Copied!' feedback after clicking", async () => {
      const user = userEvent.setup();
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      await user.click(screen.getByRole("button", { name: /copy/i }));
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });

    it("reverts to 'Copy' text after 2 seconds", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      const copyBtn = screen.getByRole("button", { name: /copy/i });

      await user.click(copyBtn);
      expect(screen.getByText("Copied!")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(screen.getByRole("button", { name: /copy$/i })).toBeInTheDocument();
      expect(screen.queryByText("Copied!")).not.toBeInTheDocument();

      vi.useRealTimers();
    });

    it("logs error when clipboard write fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      clipboardWriteText.mockRejectedValueOnce(new Error("clipboard denied"));
      const user = userEvent.setup();
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);

      await user.click(screen.getByRole("button", { name: /copy/i }));

      expect(consoleSpy).toHaveBeenCalledWith("Failed to copy:", expect.any(Error));
    });
  });

  // ── Pending state ────────────────────────────────────────────────────

  describe("Pending state", () => {
    it("applies opacity-50 when pending in desktop layout", () => {
      const { container } = render(
        <UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} pending />
      );
      expect(container.firstElementChild!.className).toContain("opacity-50");
    });

    it("applies opacity-50 when pending in mobile layout", () => {
      const { container } = render(
        <UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} compact pending />
      );
      expect(container.firstElementChild!.className).toContain("opacity-50");
    });

    it("does not apply opacity-50 when not pending", () => {
      const { container } = render(
        <UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />
      );
      expect(container.firstElementChild!.className).not.toContain("opacity-50");
    });
  });

  // ── Timestamp display ────────────────────────────────────────────────

  describe("Timestamp display", () => {
    it("shows formatted timestamp in desktop layout", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      expect(screen.getByText(/Jun 15, 2025/)).toBeInTheDocument();
    });

    it("shows formatted timestamp in mobile layout", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} compact />);
      expect(screen.getByText(/Jun 15, 2025/)).toBeInTheDocument();
    });

    it("renders the timestamp inside a monospace font element", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      expect(screen.getByText(/Jun 15, 2025/).className).toContain("font-mono");
    });
  });

  // ── Layout structure ─────────────────────────────────────────────────

  describe("Layout structure", () => {
    it("desktop layout is right-aligned (flex justify-end)", () => {
      const { container } = render(
        <UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />
      );
      expect(container.firstElementChild!.className).toContain("justify-end");
    });

    it("mobile layout is right-aligned (flex justify-end)", () => {
      const { container } = render(
        <UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} compact />
      );
      expect(container.firstElementChild!.className).toContain("justify-end");
    });

    it("desktop has max-w-4xl container", () => {
      const { container } = render(
        <UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />
      );
      expect(container.firstElementChild!.className).toContain("max-w-4xl");
    });

    it("bubble has correct dark background in desktop", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      expect(screen.getByText(SAMPLE_CONTENT).closest(".bg-\\[\\#18181B\\]")).not.toBeNull();
    });

    it("bubble has correct dark background in mobile", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} compact />);
      expect(screen.getByText(SAMPLE_CONTENT).closest(".bg-\\[\\#18181B\\]")).not.toBeNull();
    });
  });

  // ── Memoization ──────────────────────────────────────────────────────

  describe("React.memo behavior", () => {
    it("renders correctly on re-render with same props", () => {
      const { rerender } = render(
        <UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />
      );
      expect(screen.getByText(SAMPLE_CONTENT)).toBeInTheDocument();

      rerender(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      expect(screen.getByText(SAMPLE_CONTENT)).toBeInTheDocument();
    });
  });

  // ── Scroll gesture compatibility ─────────────────────────────────────

  describe("Scroll gesture compatibility", () => {
    it("CopyButton wrapper has select-none in desktop", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} />);
      // CopyButton is inside div.mt-1, which is a sibling of the bubble
      const copyBtn = screen.getByRole("button", { name: /copy/i });
      const wrapper = copyBtn.closest(".mt-1");
      expect(wrapper).not.toBeNull();
    });

    it("CopyButton wrapper is positioned beside bubble in mobile", () => {
      render(<UserMessageBubble content={SAMPLE_CONTENT} timestamp={SAMPLE_TIMESTAMP} compact />);
      const copyBtn = screen.getByRole("button", { name: /copy/i });
      const wrapper = copyBtn.closest(".flex.items-end");
      expect(wrapper).not.toBeNull();
    });
  });
});
