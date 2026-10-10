import { memo } from 'react';
import {
  EdgeLabelRenderer,
  getSmoothStepPath,
  useInternalNode,
  type EdgeProps,
  Position,
} from '@xyflow/react';
import { useGameData } from '../data/context.ts';
import { useGraphStore } from '../graph/store.ts';
import { useSolve } from '../solver/context.ts';
import { percent, rate } from '../ui/format.ts';
import styles from './FlowEdgeView.module.css';

export const ARROW_MARKER_ID = 'fg-arrow';
export const ARROW_MARKER_BRASS_ID = 'fg-arrow-brass';
export const ARROW_MARKER_FLUID_ID = 'fg-arrow-fluid';
export const ARROW_MARKER_WARN_ID = 'fg-arrow-warn';

/** How far a self-loop reaches past the node before turning. */
const LOOP_REACH = 40;
/** Vertical clearance between the node's bottom edge and the loop. */
const LOOP_DROP = 26;
const LOOP_RADIUS = 8;
/**
 * How much further out each successive port's loop runs, per pixel of port
 * offset. A port row is 18px, so 1.6 puts consecutive loops ~29px apart —
 * enough for their rate labels to clear each other.
 */
const LOOP_STAGGER = 1.6;

/**
 * One item flow.
 *
 * A recipe that feeds its own input — Kovarex, coal liquefaction — produces a
 * source and target on the same node, which smoothstep collapses to a stub.
 * Those get a hand-drawn loop that runs under the node instead.
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
  // A self-loop has to clear the node it starts and ends on, so it needs the
  // node's real box rather than just the two handle positions.
  const ownNode = useInternalNode(source);

  if (!edge) return null;

  const item = index.items.get(edge.fromPort);
  const isFluid = item?.isFluid ?? false;
  const solved = result?.edges[id] ?? null;
  const saturation = solved?.saturation ?? null;
  const over = saturation !== null && saturation > 1;

  const isLoop = source === target;
  const nodeTop = ownNode?.internals.positionAbsolute.y ?? sourceY;
  const nodeBottom = nodeTop + (ownNode?.measured.height ?? 0);
  // Lower ports loop wider and deeper, so a node with two self-loops (Kovarex
  // has U-235 and U-238) draws them as two visibly separate paths.
  const spread = Math.max(0, sourceY - nodeTop) * LOOP_STAGGER;
  const [path, labelX, labelY] = isLoop
    ? loopPath(sourceX, sourceY, targetX, targetY, nodeBottom + LOOP_DROP + spread, spread)
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
          <span className="mono">
            {solved ? `${rate(solved.perSec)}/s` : '—'}
            {/* One belt per block: `×6` is six belts side by side. */}
            {solved && solved.parallel > 1 ? (
              <span className={styles.parallel}> ×{solved.parallel}</span>
            ) : null}
          </span>
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

/**
 * Out of the right handle, down past the bottom of the node, back along under
 * it, and up into the left handle. Routing *under* the node rather than over it
 * keeps the loop clear of the node's own rows; `spread` pushes each successive
 * port's loop further out so two loops on one node never sit on top of each
 * other.
 */
function loopPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  floor: number,
  spread: number,
): [string, number, number] {
  const right = sourceX + LOOP_REACH + spread;
  const left = targetX - LOOP_REACH - spread;
  const r = LOOP_RADIUS;
  const path = [
    `M ${sourceX} ${sourceY}`,
    `L ${right - r} ${sourceY}`,
    `Q ${right} ${sourceY} ${right} ${sourceY + r}`,
    `L ${right} ${floor - r}`,
    `Q ${right} ${floor} ${right - r} ${floor}`,
    `L ${left + r} ${floor}`,
    `Q ${left} ${floor} ${left} ${floor - r}`,
    `L ${left} ${targetY + r}`,
    `Q ${left} ${targetY} ${left + r} ${targetY}`,
    `L ${targetX} ${targetY}`,
  ].join(' ');
  // Nudge the label along with the loop so two of them never stack up.
  return [path, (right + left) / 2 + spread, floor];
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
