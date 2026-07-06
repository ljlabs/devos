/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Locale-aware timestamp formatting for chat messages.
 * Shows time-only for today's messages; includes date for older messages.
 */

/**
 * Returns `true` if `ts` falls on the same calendar day as `now`.
 */
export function isSameDay(ts: Date, now: Date): boolean {
  return (
    ts.getFullYear() === now.getFullYear() &&
    ts.getMonth() === now.getMonth() &&
    ts.getDate() === now.getDate()
  );
}

/**
 * Format a timestamp for display in a chat bubble.
 *
 * - Same day  → "2:34 PM"
 * - Different day → "Jun 15, 2025 · 2:34 PM"
 *
 * Uses the user's locale via `Intl.DateTimeFormat`.
 */
export function formatTimestamp(
  timestamp: string | number,
  now: Date = new Date(),
): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : new Date(timestamp);

  const timePart = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  if (isSameDay(date, now)) {
    return timePart;
  }

  const datePart = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);

  return `${datePart} · ${timePart}`;
}
