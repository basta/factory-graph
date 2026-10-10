/**
 * Edge routes for one port feeding several others, or several feeding one.
 *
 * Smoothstep turns each connection halfway to its own target, so four
 * consumers of one furnace get four labels stacked on one shared vertical
 * line, none of them obviously belonging to its consumer — and consumers at
 * different distances get several near-parallel lines instead of one. A
 * manifold fixes both: one spine close to the shared port, a junction where
 * the branches leave it, and each branch's label on the run that is only
 * that branch's.
 */

/** How far the spine sits from the shared port. */
export const SPINE_REACH = 36;
/** A branch needs this much horizontal run past the spine to carry a label. */
const MIN_RUN = 48;
const RADIUS = 6;

export interface Route {
  path: string;
  labelX: number;
  labelY: number;
  /** Where this branch meets the spine; null on a route with no spine. */
  junction: { x: number; y: number } | null;
}

/**
 * Right from the source to `spineX`, along the spine, then right into the
 * target. Rounded corners, shrunk where the legs are too short for them.
 */
export function elbowPath(
  sourceX: number,
  sourceY: number,
  spineX: number,
  targetX: number,
  targetY: number,
): string {
  if (Math.abs(targetY - sourceY) < 0.5) return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  const down = targetY > sourceY ? 1 : -1;
  const r = Math.min(
    RADIUS,
    Math.abs(targetY - sourceY) / 2,
    spineX - sourceX,
    targetX - spineX,
  );
  return [
    `M ${sourceX} ${sourceY}`,
    `L ${spineX - r} ${sourceY}`,
    `Q ${spineX} ${sourceY} ${spineX} ${sourceY + down * r}`,
    `L ${spineX} ${targetY - down * r}`,
    `Q ${spineX} ${targetY} ${spineX + r} ${targetY}`,
    `L ${targetX} ${targetY}`,
  ].join(' ');
}

/**
 * A branch of a manifold. `shared` says which end is the shared port: `out`
 * for one producer feeding several consumers, `in` for several producers
 * feeding one port. Null when the target is too close or behind the source,
 * where the ordinary route does better.
 */
export function manifoldRoute(
  shared: 'out' | 'in',
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): Route | null {
  if (targetX - sourceX < SPINE_REACH + MIN_RUN) return null;
  const spineX = shared === 'out' ? sourceX + SPINE_REACH : targetX - SPINE_REACH;
  const path = elbowPath(sourceX, sourceY, spineX, targetX, targetY);
  return shared === 'out'
    ? // The label sits on the run into this branch's own consumer.
      { path, labelX: (spineX + targetX) / 2, labelY: targetY, junction: { x: spineX, y: sourceY } }
    : // And here on the run out of this branch's own producer.
      { path, labelX: (sourceX + spineX) / 2, labelY: sourceY, junction: { x: spineX, y: targetY } };
}
