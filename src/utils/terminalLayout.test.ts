/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from "vitest";
import {
  makeTerminalPane,
  makeInitialLayout,
  splitLeaf,
  removeLeaf,
  resizeLeaf,
  collectLeaves,
  containsLeaf,
  countLeaves,
  type TerminalLayoutNode,
} from "./terminalLayout";

describe("terminalLayout", () => {
  it("starts as a single terminal pane", () => {
    const layout = makeInitialLayout("/work");
    expect(layout.type).toBe("terminal");
    if (layout.type === "terminal") {
      expect(layout.cwd).toBe("/work");
      expect(layout.sessionId).toBe(layout.id);
    }
    expect(countLeaves(layout)).toBe(1);
  });

  it("splits a leaf into a horizontal split with two equal children", () => {
    const layout = makeInitialLayout();
    const id = (layout as any).id as string;
    const next = splitLeaf(layout, id, "horizontal");

    expect(next.type).toBe("split");
    if (next.type === "split") {
      expect(next.direction).toBe("horizontal");
      expect(next.sizes).toEqual([0.5, 0.5]);
      expect(countLeaves(next)).toBe(2);
      expect(next.children[0].type).toBe("terminal");
      expect(next.children[1].type).toBe("terminal");
    }
  });

  it("nested splits accumulate leaves", () => {
    let layout: TerminalLayoutNode = makeInitialLayout();
    let id = (layout as any).id as string;
    layout = splitLeaf(layout, id, "horizontal"); // 2 panes
    const firstId = (layout as any).children[0].id as string;
    layout = splitLeaf(layout, firstId, "vertical"); // 3 panes
    expect(countLeaves(layout)).toBe(3);
    expect(layout.type).toBe("split");
  });

  it("removing one of two leaves hoists the remaining pane", () => {
    let layout = makeInitialLayout();
    const id = (layout as any).id as string;
    layout = splitLeaf(layout, id, "horizontal");
    const leftId = (layout as any).children[0].id as string;
    const rightId = (layout as any).children[1].id as string;

    const afterLeft = removeLeaf(layout, leftId);
    expect(afterLeft?.type).toBe("terminal");
    if (afterLeft?.type === "terminal") expect(afterLeft.id).toBe(rightId);

    const afterRight = removeLeaf(layout, rightId);
    expect(afterRight?.type).toBe("terminal");
    if (afterRight?.type === "terminal") expect(afterRight.id).toBe(leftId);
  });

  it("removing a leaf inside a nested split keeps the outer split", () => {
    let layout = makeInitialLayout();
    let id = (layout as any).id as string;
    layout = splitLeaf(layout, id, "horizontal"); // [A, B]
    const aId = (layout as any).children[0].id as string;
    layout = splitLeaf(layout, aId, "vertical"); // [[A1, A2], B]
    const a1Id = (layout as any).children[0].children[0].id as string;

    const next = removeLeaf(layout, a1Id);
    expect(next?.type).toBe("split");
    if (next?.type === "split") {
      // B now hoisted to replace the collapsed left side → [A2, B]
      expect(next.children[0].type).toBe("terminal");
      expect(next.children[1].type).toBe("terminal");
      expect(countLeaves(next)).toBe(2);
    }
  });

  it("removing the last remaining leaf returns null", () => {
    const layout = makeInitialLayout();
    const id = (layout as any).id as string;
    expect(removeLeaf(layout, id)).toBeNull();
  });

  it("resizeLeaf shifts size between siblings and respects minimum", () => {
    let layout = makeInitialLayout();
    let id = (layout as any).id as string;
    layout = splitLeaf(layout, id, "horizontal", "/work");
    const leftId = (layout as any).children[0].id as string;

    const grown = resizeLeaf(layout, leftId, 0.1);
    const grownSizes = (grown as any).sizes as [number, number];
    expect(grownSizes[0]).toBeCloseTo(0.6, 5);
    expect(grownSizes[1]).toBeCloseTo(0.4, 5);

    // Cannot shrink below the minimum (0.1 default).
    const minLayout = resizeLeaf(layout, leftId, -0.9);
    const minSizes = (minLayout as any).sizes as [number, number];
    expect(minSizes[0]).toBeCloseTo(0.1, 5);
    expect(minSizes[1]).toBeCloseTo(0.9, 5);
  });

  it("resizeLeaf is a no-op when target leaf is absent", () => {
    const layout = makeInitialLayout();
    expect(resizeLeaf(layout, "does-not-exist", 0.2)).toBe(layout);
  });

  it("collectLeaves and containsLeaf behave as expected", () => {
    const pane = makeTerminalPane();
    expect(collectLeaves(pane)).toHaveLength(1);
    expect(containsLeaf(pane, pane.id)).toBe(true);
    expect(containsLeaf(pane, "nope")).toBe(false);
  });
});
