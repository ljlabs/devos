/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ResizableSplit — desktop-only split pane with a draggable divider.
 *
 * Renders two children side-by-side (`horizontal`) or stacked (`vertical`)
 * using flex-basis driven by relative `sizes`. Dragging the divider reports a
 * signed fractional delta (applied to the first child) via `onResize`; the
 * parent owns the layout tree and applies it with `resizeLeaf`.
 */

import React, { useRef, useState, useCallback } from "react";

export type SplitDirection = "horizontal" | "vertical";

interface ResizableSplitProps {
  direction: SplitDirection;
  /** Relative sizes of [first, second]; normalised to 1 together. */
  sizes: [number, number];
  /** Minimum fraction each side may shrink to (clamped during drag). */
  min?: number;
  /** Called with the signed fractional delta to apply to the first child. */
  onResize: (delta: number) => void;
  first: React.ReactNode;
  second: React.ReactNode;
}

export default function ResizableSplit({
  direction,
  sizes,
  min = 0.1,
  onResize,
  first,
  second,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ startPos: number; startSizes: [number, number] } | null>(null);
  const [liveSizes, setLiveSizes] = useState<[number, number] | null>(null);

  const isHorizontal = direction === "horizontal";
  const activeSizes = liveSizes ?? sizes;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({
        startPos: isHorizontal ? e.clientX : e.clientY,
        startSizes: [sizes[0], sizes[1]],
      });
    },
    [isHorizontal, sizes]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag || !containerRef.current) return;
      const container = containerRef.current;
      const total = isHorizontal ? container.clientWidth : container.clientHeight;
      if (total <= 0) return;

      const currentPos = isHorizontal ? e.clientX : e.clientY;
      const deltaFrac = (currentPos - drag.startPos) / total;

      let firstSize = drag.startSizes[0] + deltaFrac;
      firstSize = Math.max(min, Math.min(1 - min, firstSize));
      setLiveSizes([firstSize, 1 - firstSize]);
    },
    [drag, isHorizontal, min]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be released */
      }
      const finalDelta = (liveSizes ? liveSizes[0] : drag.startSizes[0]) - drag.startSizes[0];
      setDrag(null);
      setLiveSizes(null);
      if (Math.abs(finalDelta) > 0.001) onResize(finalDelta);
    },
    [drag, liveSizes, onResize]
  );

  const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

  return (
    <div
      ref={containerRef}
      className="flex w-full h-full min-h-0 min-w-0 overflow-hidden"
      style={{ flexDirection: isHorizontal ? "row" : "column" }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="min-w-0 min-h-0 overflow-hidden" style={{ flexBasis: pct(activeSizes[0]), flexGrow: 0, flexShrink: 0 }}>
        {first}
      </div>

      <div
        role="separator"
        aria-orientation={isHorizontal ? "vertical" : "horizontal"}
        draggable={false}
        onPointerDown={onPointerDown}
        className={
          "group relative flex-shrink-0 bg-white/5 hover:bg-emerald-500/40 transition-colors cursor-" +
          (isHorizontal ? "col-resize" : "row-resize")
        }
        style={isHorizontal ? { width: 6 } : { height: 6 }}
      >
        {/* Visual grip centred on the divider */}
        <div
          className={
            "absolute bg-white/15 group-hover:bg-emerald-400/70 rounded-full " +
            (isHorizontal ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-8" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-0.5 w-8")
          }
        />
      </div>

      <div className="min-w-0 min-h-0 overflow-hidden" style={{ flexBasis: pct(activeSizes[1]), flexGrow: 0, flexShrink: 0 }}>
        {second}
      </div>
    </div>
  );
}
