import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import MobileIdeView from "../../src/components/MobileIdeView";

// ---------------------------------------------------------------------------
// Mock child components
// ---------------------------------------------------------------------------
vi.mock("../../src/components/ide/FileEditorPanel", () => ({
  default: (p: any) => <div data-testid="editor-panel" />,
}));
vi.mock("../../src/components/ide/FilesPanel", () => ({
  default: (p: any) => <div data-testid="files-panel" />,
}));

// ---------------------------------------------------------------------------
// Viewport mock
// ---------------------------------------------------------------------------

interface ViewportMock {
  height: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _listeners: Record<string, Function[]>;
  _resize: (newHeight: number) => void;
}

function mockVisualViewport(initialHeight: number): ViewportMock {
  const listeners: Record<string, Function[]> = {};
  const viewport: ViewportMock = {
    height: initialHeight,
    addEventListener: vi.fn((event: string, handler: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    }),
    _listeners: listeners,
    _resize: (newHeight: number) => {
      viewport.height = newHeight;
      (listeners.resize || []).forEach((h) => h());
    },
  };
  return viewport;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  panel: "editor" as const,
  workspaceId: "ws-1",
  threadTitle: "Test Thread",
  threadLogs: [],
  onBack: vi.fn(),
};

function renderIde(overrides: Record<string, any> = {}) {
  return render(<MobileIdeView {...defaultProps} {...overrides} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MobileIdeView — keyboard handling", () => {
  let originalViewport: any;
  let originalInnerHeight: number;

  beforeEach(() => {
    vi.clearAllMocks();
    originalViewport = window.visualViewport;
    originalInnerHeight = window.innerHeight;
  });

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", {
      value: originalViewport,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: originalInnerHeight,
      configurable: true,
    });
  });

  describe("Bottom inset tracks keyboard state", () => {
    it("reserves 56px at bottom when keyboard is closed", () => {
      const viewport = mockVisualViewport(768);
      Object.defineProperty(window, "visualViewport", {
        value: viewport,
        configurable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        value: 768,
        configurable: true,
      });

      const { container } = renderIde();
      const rootDiv = container.firstChild as HTMLElement;
      // keyboard closed → bottom inset is 56px
      expect(rootDiv.style.inset).toContain("56px");
    });

    it("drops bottom reservation when keyboard opens", () => {
      const viewport = mockVisualViewport(400);
      Object.defineProperty(window, "visualViewport", {
        value: viewport,
        configurable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        value: 768,
        configurable: true,
      });

      const { container } = renderIde();
      const rootDiv = container.firstChild as HTMLElement;
      // 400/768 = 0.52 < 0.75 → keyboard open → bottom becomes 0
      expect(rootDiv.style.inset).toContain("0px");
      expect(rootDiv.style.inset).not.toContain("56px");
    });

    it("restores 56px bottom when keyboard closes", () => {
      const viewport = mockVisualViewport(768);
      Object.defineProperty(window, "visualViewport", {
        value: viewport,
        configurable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        value: 768,
        configurable: true,
      });

      const { container } = renderIde();
      const rootDiv = container.firstChild as HTMLElement;

      // Initially keyboard closed
      expect(rootDiv.style.inset).toContain("56px");

      // Keyboard opens
      act(() => {
        viewport._resize(400);
      });
      expect(rootDiv.style.inset).not.toContain("56px");

      // Keyboard closes
      act(() => {
        viewport._resize(768);
      });
      expect(rootDiv.style.inset).toContain("56px");
    });
  });

  describe("Container layout", () => {
    it("uses position: fixed", () => {
      const viewport = mockVisualViewport(768);
      Object.defineProperty(window, "visualViewport", {
        value: viewport,
        configurable: true,
      });

      const { container } = renderIde();
      const rootDiv = container.firstChild as HTMLElement;
      expect(rootDiv.style.position).toBe("fixed");
    });

    it("has overflow hidden to prevent body scroll", () => {
      const viewport = mockVisualViewport(768);
      Object.defineProperty(window, "visualViewport", {
        value: viewport,
        configurable: true,
      });

      const { container } = renderIde();
      const rootDiv = container.firstChild as HTMLElement;
      expect(rootDiv.className).toContain("overflow-hidden");
    });
  });

  describe("Event listener cleanup", () => {
    it("removes visualViewport event listener on unmount", () => {
      const viewport = mockVisualViewport(768);
      Object.defineProperty(window, "visualViewport", {
        value: viewport,
        configurable: true,
      });

      const { unmount } = renderIde();

      unmount();

      expect(viewport.removeEventListener).toHaveBeenCalledWith(
        "resize",
        expect.any(Function)
      );
    });
  });
});
