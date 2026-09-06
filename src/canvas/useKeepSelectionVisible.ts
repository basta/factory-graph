import { useEffect } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { viewportDuration } from '../ui/keys.ts';

/** Space left between a nudged node and the edge of the canvas. */
const MARGIN = 24;

/**
 * Keeps a newly selected node on screen.
 *
 * Selecting a node opens the inspector, which takes 320px off the canvas — so
 * a node near the right edge vanishes under the panel the instant you click it.
 * This pans by the smallest amount that brings it back, and only when it is
 * actually clipped, so it never drags the view out from under someone who can
 * already see what they selected.
 */
export function useKeepSelectionVisible(selection: readonly string[]): void {
  const flow = useReactFlow();
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);

  useEffect(() => {
    if (selection.length !== 1) return;
    const id = selection[0];
    if (id === undefined) return;
    const node = flow.getInternalNode(id);
    if (!node) return;

    const { x: offsetX, y: offsetY, zoom } = flow.getViewport();
    const left = node.internals.positionAbsolute.x * zoom + offsetX;
    const top = node.internals.positionAbsolute.y * zoom + offsetY;
    const right = left + (node.measured.width ?? 0) * zoom;
    const bottom = top + (node.measured.height ?? 0) * zoom;

    let shiftX = 0;
    let shiftY = 0;
    if (right > paneWidth - MARGIN) shiftX = paneWidth - MARGIN - right;
    if (left + shiftX < MARGIN) shiftX = MARGIN - left;
    if (bottom > paneHeight - MARGIN) shiftY = paneHeight - MARGIN - bottom;
    if (top + shiftY < MARGIN) shiftY = MARGIN - top;

    if (shiftX === 0 && shiftY === 0) return;
    void flow.setViewport(
      { x: offsetX + shiftX, y: offsetY + shiftY, zoom },
      { duration: viewportDuration() },
    );
    // Keyed on the selection and the pane size, never on the viewport: this
    // *changes* the viewport, and depending on it would chase its own tail.
  }, [selection, paneWidth, paneHeight, flow]);
}
