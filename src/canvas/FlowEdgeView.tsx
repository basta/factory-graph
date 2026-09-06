import { memo } from 'react';
import { EdgeLabelRenderer, getSmoothStepPath, type EdgeProps, Position } from '@xyflow/react';
import { useGameData } from '../data/context.ts';
import { useGraphStore } from '../graph/store.ts';
import { useSolve } from '../solver/context.ts';
import { percent, rate } from '../ui/format.ts';
import styles from './FlowEdgeView.module.css';

export const ARROW_MARKER_ID = 'fg-arrow';
export const ARROW_MARKER_BRASS_ID = 'fg-arrow-brass';
export const ARROW_MARKER_FLUID_ID = 'fg-arrow-fluid';
export const ARROW_MARKER_WARN_ID = 'fg-arrow-warn';

/** How far a self-loop bulges out to the right before coming back. */
const LOOP_REACH = 46;

/**
 * One item flow.
 *
 * A recipe that feeds its own input — Kovarex, coal liquefaction — produces a
 * source and target on the same node, which smoothstep collapses to a stub.
 * Those get a hand-drawn loop around the node's right edge instead.
 */
export const FlowEdgeView = memo(function FlowEdgeView({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps): JSX.Element | null {
  const index = useGameData();
  const edge = useGraphStore((state) => state.graph.edges.find((candidate) => candidate.id === id));
  const result = useSolve();

  if (!edge) return null;

  const item = index.items.get(edge.fromPort);
  const isFluid = item?.isFluid ?? false;
  const solved = result?.edges[id] ?? null;
  const saturation = solved?.saturation ?? null;
  const over = saturation !== null && saturation > 1;

  const isLoop = source === target;
  const [path, labelX, labelY] = isLoop
    ? loopPath(sourceX, sourceY, targetX, targetY)
    : getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition: sourcePosition ?? Position.Right,
        targetPosition: targetPosition ?? Position.Left,
        borderRadius: 6,
      });

  const tone = over ? 'warn' : selected ? 'brass' : isFluid ? 'fluid' : 'line';
  const marker = {
    warn: ARROW_MARKER_WARN_ID,
    brass: ARROW_MARKER_BRASS_ID,
    fluid: ARROW_MARKER_FLUID_ID,
    line: ARROW_MARKER_ID,
  }[tone];

  return (
    <>
      {/* A wide invisible path so the 2px line is still easy to click. */}
      <path d={path} className={styles.hitArea} fill="none" />
      <path
        d={path}
        fill="none"
        className={[styles.path, styles[tone], isFluid ? styles.fluidWidth : '']
          .filter(Boolean)
          .join(' ')}
        markerEnd={`url(#${marker})`}
      />
      <EdgeLabelRenderer>
        <div
          className={[styles.label, over ? styles.labelWarn : ''].filter(Boolean).join(' ')}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <span className="mono">{solved ? `${rate(solved.perSec)}/s` : '—'}</span>
          {saturation !== null ? (
            <span
              className={styles.bar}
              title={`${percent(saturation)} of capacity`}
              aria-label={`${percent(saturation)} of capacity`}
            >
              <span
                className={styles.barFill}
                style={{ width: `${Math.min(100, saturation * 100)}%` }}
              />
            </span>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

/** Right side out, around, and back into the left side of the same node. */
function loopPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): [string, number, number] {
  const top = Math.min(sourceY, targetY) - 26;
  const right = sourceX + LOOP_REACH;
  const left = targetX - LOOP_REACH;
  const path = [
    `M ${sourceX} ${sourceY}`,
    `L ${right} ${sourceY}`,
    `Q ${right + 8} ${sourceY} ${right + 8} ${sourceY - 8}`,
    `L ${right + 8} ${top + 8}`,
    `Q ${right + 8} ${top} ${right} ${top}`,
    `L ${left} ${top}`,
    `Q ${left - 8} ${top} ${left - 8} ${top + 8}`,
    `L ${left - 8} ${targetY - 8}`,
    `Q ${left - 8} ${targetY} ${left} ${targetY}`,
    `L ${targetX} ${targetY}`,
  ].join(' ');
  return [path, (sourceX + targetX) / 2, top];
}

/** Arrowheads: a small filled triangle, not React Flow's default marker. */
export function EdgeMarkers(): JSX.Element {
  const tones: [string, string][] = [
    [ARROW_MARKER_ID, 'var(--line)'],
    [ARROW_MARKER_BRASS_ID, 'var(--brass)'],
    [ARROW_MARKER_FLUID_ID, 'var(--fluid)'],
    [ARROW_MARKER_WARN_ID, 'var(--warn)'],
  ];
  return (
    <svg className={styles.markerHost} aria-hidden="true">
      <defs>
        {tones.map(([id, fill]) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
            markerUnits="strokeWidth"
          >
            <path d="M0 0.5 L8 4 L0 7.5 Z" fill={fill} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
