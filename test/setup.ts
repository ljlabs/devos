import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock scrollIntoView for jsdom
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
