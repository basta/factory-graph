import type { EdgePlan } from './routingPlan.ts';

/**
 * Edge routes for one port feeding several others, or several feeding one.
 *
 * Smoothstep turns each connection halfway to its own target, so four
 * consumers of one furnace get four labels stacked on one shared vertical
 * line, none of them obviously belonging to its consumer — and consumers at
 * different distances get several near-parallel lines instead of one. A
 * manifold fixes both: one spine close to the shared port, a junction where
 * the branches leave it, and each branch's label on the run that is only
 * that branch's. `routingPlan.ts` decides where, for all connections at once;
 * this draws one.
 */

/** How far a spine sits from the shared port, in its first lane. */
export const SPINE_REACH = 36;
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
 * A connection's route from its plan: the spine where the plan put it, and the
 * label where the plan found room. React Flow's handle positions go in, so the
 * route meets the ports exactly wherever the plan's own estimate was off.
 */
export function routeFromPlan(
  plan: EdgePlan,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): Route {
  const spineX = plan.kind === 'in' ? targetX - plan.reach : sourceX + plan.reach;
  const path = elbowPath(sourceX, sourceY, spineX, targetX, targetY);
  const straight = plan.kind === 'single' && Math.abs(sourceY - targetY) < 0.5;
  const [a, b, y] = straight
    ? [sourceX, targetX, targetY]
    : plan.kind === 'in'
      ? [sourceX, spineX, sourceY]
      : [spineX, targetX, targetY];
  return {
    path,
    labelX: a + plan.labelT * (b - a),
    labelY: y + plan.labelDy,
    junction:
      plan.kind === 'out'
        ? { x: spineX, y: sourceY }
        : plan.kind === 'in'
          ? { x: spineX, y: targetY }
          : null,
  };
}
