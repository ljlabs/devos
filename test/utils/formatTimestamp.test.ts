import { describe, it, expect, vi, afterEach } from "vitest";
import { isSameDay, formatTimestamp } from "../../src/utils/formatTimestamp";

describe("isSameDay", () => {
  it("returns true when both dates share the same calendar day", () => {
    const a = new Date("2025-06-15T09:00:00");
    const b = new Date("2025-06-15T23:59:59");
    expect(isSameDay(a, b)).toBe(true);
  });

  it("returns false when dates differ by day", () => {
    const a = new Date("2025-06-15T23:59:59");
    const b = new Date("2025-06-16T00:00:01");
    expect(isSameDay(a, b)).toBe(false);
  });

  it("returns false when dates differ by month", () => {
    const a = new Date("2025-06-15T12:00:00");
    const b = new Date("2025-07-15T12:00:00");
    expect(isSameDay(a, b)).toBe(false);
  });

  it("returns false when dates differ by year", () => {
    const a = new Date("2024-12-25T12:00:00");
    const b = new Date("2025-12-25T12:00:00");
    expect(isSameDay(a, b)).toBe(false);
  });
});

describe("formatTimestamp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows time-only for a message from today", () => {
    const now = new Date("2025-06-15T14:34:00");
    const result = formatTimestamp("2025-06-15T09:15:00", now);
    // Should not contain any date part (no month name or year)
    expect(result).not.toContain("2025");
    expect(result).not.toContain("Jun");
    // Should contain a time-like string with colon
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it("shows date + time for a message from a previous day", () => {
    const now = new Date("2025-06-15T14:34:00");
    const result = formatTimestamp("2025-06-14T09:15:00", now);
    // Should contain the date part
    expect(result).toContain("Jun");
    expect(result).toContain("14");
    expect(result).toContain("2025");
    // Should contain a separator and time
    expect(result).toContain("·");
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it("shows date + time for a message from a future day", () => {
    const now = new Date("2025-06-15T14:34:00");
    const result = formatTimestamp("2025-12-25T10:00:00", now);
    expect(result).toContain("Dec");
    expect(result).toContain("25");
    expect(result).toContain("2025");
  });

  it("handles numeric timestamps (epoch millis)", () => {
    const now = new Date("2025-06-15T14:34:00");
    const epochMs = new Date("2025-06-15T10:00:00").getTime();
    const result = formatTimestamp(epochMs, now);
    // Same day → time only
    expect(result).not.toContain("Jun");
  });

  it("handles numeric timestamps from a different day", () => {
    const now = new Date("2025-06-15T14:34:00");
    const epochMs = new Date("2025-01-01T00:00:00").getTime();
    const result = formatTimestamp(epochMs, now);
    expect(result).toContain("Jan");
    expect(result).toContain("1");
    expect(result).toContain("2025");
  });

  it("respects locale via Intl formatting", () => {
    const now = new Date("2025-06-15T14:34:00");
    // The function uses `undefined` locale (browser default), so result
    // should always be a non-empty string regardless of runtime locale.
    const result = formatTimestamp("2025-06-15T09:00:00", now);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a meaningful string for edge-case midnight boundary", () => {
    // Just before midnight vs just after
    const now = new Date("2025-06-16T00:00:30");
    const ts = new Date("2025-06-15T23:59:59");
    const result = formatTimestamp(ts.toISOString(), now);
    // Different day → should include date
    expect(result).toContain("Jun");
    expect(result).toContain("15");
  });
});
