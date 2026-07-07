/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * terminalLayout — pure model for an iTerm2-style terminal layout.
 *
 * A layout is a tree of panes:
 *   - A `terminal` leaf holds a single PTY session.
 *   - A `split` node holds two children arranged horizontally (side-by-side)
 *     or vertically (stacked), with a relative `size` for each child.
 *
 * All mutating helpers return a NEW tree (immutable) so React state updates
 * are referentially clean.
 */

export type SplitDirection = "horizontal" | "vertical";

export interface TerminalPaneNode {
  type: "terminal";
  /** Stable id for this pane; also the PTY session id. */
  id: string;
  /** Session id handed to the backend (equals `id`). */
  sessionId: string;
  /** CWD the PTY should start in. */
  cwd?: string;
}

export interface SplitNode {
  type: "split";
  direction: SplitDirection;
  /** Relative sizes of the two children; together they normalise to 1. */
  sizes: [number, number];
  children: [TerminalLayoutNode, TerminalLayoutNode];
}

export type TerminalLayoutNode = TerminalPaneNode | SplitNode;

let paneCounter = 0;
export function nextPaneId(): string {
  paneCounter += 1;
  return `pane-${Date.now().toString(36)}-${paneCounter}`;
}

export function makeTerminalPane(cwd?: string): TerminalPaneNode {
  const id = nextPaneId();
  return { type: "terminal", id, sessionId: id, cwd };
}

/** A fresh layout = a single terminal pane. */
export function makeInitialLayout(cwd?: string): TerminalLayoutNode {
  return makeTerminalPane(cwd);
}

/**
 * Split a leaf pane (by id) into two children.
 * `direction` controls the orientation of the new split.
 * Returns the new tree, or the same tree unchanged if the id was not found.
 */
export function splitLeaf(
  root: TerminalLayoutNode,
  leafId: string,
  direction: SplitDirection,
  cwd?: string
): TerminalLayoutNode {
  if (root.type === "terminal") {
    if (root.id !== leafId) return root;
    const first: TerminalPaneNode = { ...root };
    const second = makeTerminalPane(cwd ?? root.cwd);
    return {
      type: "split",
      direction,
      sizes: [0.5, 0.5],
      children: [first, second],
    };
  }

  const [a, b] = root.children;
  const newA = splitLeaf(a, leafId, direction, cwd);
  const newB = splitLeaf(b, leafId, direction, cwd);
  if (newA === a && newB === b) return root;
  return { ...root, children: [newA, newB] };
}

/**
 * Remove a leaf pane (by id) from the tree.
 * When the removed node is one half of a split, the remaining sibling is
 * hoisted up to take the split's place (flattening the tree).
 * Returns null when the last remaining pane is removed.
 */
export function removeLeaf(
  root: TerminalLayoutNode,
  leafId: string
): TerminalLayoutNode | null {
  if (root.type === "terminal") {
    return root.id === leafId ? null : root;
  }

  const [a, b] = root.children;
  const newA = removeLeaf(a, leafId);
  const newB = removeLeaf(b, leafId);

  // Only one side kept → hoist it, preserving split direction when possible.
  if (newA === null && newB !== null) return newB;
  if (newB === null && newA !== null) return newA;
  if (newA === null && newB === null) return null;

  // Neither side removed → unchanged shape.
  if (newA === a && newB === b) return root;

  return { ...root, children: [newA as TerminalLayoutNode, newB as TerminalLayoutNode] };
}

/**
 * Adjust the relative size of one child of a split that contains `leafId`.
 * `delta` is a fraction (e.g. 0.03) added to the target side and subtracted
 * from its sibling, clamped so neither side drops below `min`.
 */
export function resizeLeaf(
  root: TerminalLayoutNode,
  leafId: string,
  delta: number,
  min = 0.1
): TerminalLayoutNode {
  if (root.type === "terminal") return root;

  const [a, b] = root.children;
  const containsA = containsLeaf(a, leafId);
  const containsB = containsLeaf(b, leafId);
  if (!containsA && !containsB) return root;

  // Which child grows with +delta.
  const targetIsFirst = containsA;
  const clampedDelta = clampDelta(root.sizes, targetIsFirst, delta, min);

  if (clampedDelta === 0) return root;

  const sizes: [number, number] = targetIsFirst
    ? [root.sizes[0] + clampedDelta, root.sizes[1] - clampedDelta]
    : [root.sizes[0] - clampedDelta, root.sizes[1] + clampedDelta];

  const newA = resizeLeaf(a, leafId, delta, min);
  const newB = resizeLeaf(b, leafId, delta, min);

  return { ...root, sizes, children: [newA, newB] };
}

function clampDelta(
  sizes: [number, number],
  targetIsFirst: boolean,
  delta: number,
  min: number
): number {
  const targetIdx = targetIsFirst ? 0 : 1;
  const siblingIdx = targetIsFirst ? 1 : 0;
  const max = sizes[targetIdx] + sizes[siblingIdx] - min * 2;
  const lower = min - sizes[targetIdx];
  const upper = max - sizes[targetIdx];
  return Math.max(lower, Math.min(upper, delta));
}

export function containsLeaf(node: TerminalLayoutNode, leafId: string): boolean {
  if (node.type === "terminal") return node.id === leafId;
  return containsLeaf(node.children[0], leafId) || containsLeaf(node.children[1], leafId);
}

/** Depth-first list of all terminal leaves. */
export function collectLeaves(root: TerminalLayoutNode): TerminalPaneNode[] {
  if (root.type === "terminal") return [root];
  return [...collectLeaves(root.children[0]), ...collectLeaves(root.children[1])];
}

export function findLeaf(
  root: TerminalLayoutNode,
  leafId: string
): TerminalPaneNode | null {
  if (root.type === "terminal") return root.id === leafId ? root : null;
  return findLeaf(root.children[0], leafId) ?? findLeaf(root.children[1], leafId);
}

export function countLeaves(root: TerminalLayoutNode): number {
  return collectLeaves(root).length;
}
