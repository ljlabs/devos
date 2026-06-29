import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock scrollIntoView for jsdom (guarded so node-environment tests don't crash)
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// Polyfill ResizeObserver — not implemented in jsdom
if (typeof ResizeObserver === "undefined") {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
