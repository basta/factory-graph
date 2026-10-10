import type { GameIndex } from '../data/loader.ts';
import type { Graph, Position } from '../graph/types.ts';
import { nodeShape, portOffsetY, type NodeShape } from './geometry.ts';
import { SPINE_REACH } from './routing.ts';

/**
 * Where every connection's vertical run and rate label go, decided for all of
 * them at once.
 *
 * Each connection used to pick its route alone, which is fine until two of them
 * pick the same thing: two producers stacked in one column both put their
 * manifold spine 36px out, on the same line, so neither fan-out could be told
 * from the other; and a consumer's two inputs are one 18px row apart while a
 * label is 25px tall, so their labels stacked. This pass hands out spine lanes
 * so no two vertical runs share a line and no two horizontal runs share a
 * stretch, then slides labels along their run — or just off it — until they
 * clear each other.
 *
 * The plan is relative (how far out a spine sits, how far along its run a
 * label goes), so the canvas applies it to React Flow's own handle positions.
 */
export interface EdgePlan {
  /** `out`/`in`: a branch of a fan-out or fan-in. `single`: an ordinary elbow. */
  kind: 'out' | 'in' | 'single';
  /** Spine distance from its port: right of the source, or for `in` left of the target. */
  reach: number;
  /** Label centre as a fraction along its run, and how far off the line. */
  labelT: number;
  labelDy: number;
}

/** Lanes are this far apart; anything closer reads as one line. */
const LANE = 14;
const MAX_LANES = 6;
/** A branch needs this much run past its spine to carry a label. */
const MIN_RUN = 48;
/** Shorter than this and the ordinary smoothstep route does better. */
const MIN_SINGLE_GAP = 24;
/** About the size of a rate label with its belt sprite. */
export const LABEL_SIZE = { width: 88, height: 25 };
/** Off-line label offset: the label sits just above or below its line. */
const LABEL_OFF = 14;

interface Port {
  x: number;
  y: number;
}

/**
 * Port positions as React Flow reports them: handles sit 6px outside the node
 * border, so the connection starts and ends there.
 */
function portPosition(at: Position, shape: NodeShape, side: 'in' | 'out', itemId: string): Port | null {
  const port = (side === 'in' ? shape.inputs : shape.outputs).find((p) => p.itemId === itemId);
  if (!port) return null;
  return { x: side === 'in' ? at.x - 6 : at.x + shape.width + 6, y: at.y + portOffsetY(shape, port.row) };
}

interface Leg {
  y: number;
  x1: number;
  x2: number;
  /** Legs at the same port are meant to meet; only legs of different flows clash. */
  from: string;
  to: string;
}

interface Route {
  kind: EdgePlan['kind'];
  edgeIds: string[];
  /** Candidate spine x positions, best first. */
  candidates: number[];
  /** Vertical extent of the spine; zero-length for a straight single. */
  top: number;
  bottom: number;
  legs: (spineX: number) => Leg[];
  /** Spine position turned back into a distance from its port. */
  reach: (spineX: number) => number;
}

interface Planned {
  spineX: number;
  route: Route;
  legs: Leg[];
}

function legsClash(a: Leg, b: Leg): boolean {
  if (a.from === b.from || a.to === b.to) return false;
  if (Math.abs(a.y - b.y) >= 2) return false;
  const overlap = Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2)) - Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2));
  return overlap > 4;
}

function clashes(spineX: number, route: Route, placed: Planned[]): number {
  const legs = route.legs(spineX);
  let count = 0;
  for (const other of placed) {
    const vertical =
      route.bottom - route.top > 1 &&
      other.route.bottom - other.route.top > 1 &&
      Math.abs(spineX - other.spineX) < LANE - 4 &&
      route.top < other.route.bottom + 3 &&
      other.route.top < route.bottom + 3;
    if (vertical) count += 1;
    for (const leg of legs) for (const theirs of other.legs) if (legsClash(leg, theirs)) count += 1;
  }
  return count;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlapArea = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

export function computeRoutePlan(graph: Graph, index: GameIndex): Map<string, EdgePlan> {
  const shapes = new Map(graph.nodes.map((node) => [node.id, nodeShape(node, index)]));
  const at = (id: string): Position => graph.positions[id] ?? { x: 0, y: 0 };

  interface Ends {
    id: string;
    source: Port;
    target: Port;
    from: string;
    to: string;
  }
  const ends: Ends[] = [];
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue;
    const fromShape = shapes.get(edge.from);
    const toShape = shapes.get(edge.to);
    if (!fromShape || !toShape) continue;
    const source = portPosition(at(edge.from), fromShape, 'out', edge.fromPort);
    const target = portPosition(at(edge.to), toShape, 'in', edge.toPort);
    if (!source || !target) continue;
    ends.push({ id: edge.id, source, target, from: `${edge.from}|${edge.fromPort}`, to: `${edge.to}|${edge.toPort}` });
  }

  const byFrom = new Map<string, Ends[]>();
  const byTo = new Map<string, Ends[]>();
  for (const e of ends) {
    byFrom.set(e.from, [...(byFrom.get(e.from) ?? []), e]);
    byTo.set(e.to, [...(byTo.get(e.to) ?? []), e]);
  }

  // --- routes ----------------------------------------------------------------
  const routes: Route[] = [];
  const claimed = new Set<string>();

  for (const [, group] of byFrom) {
    if (group.length < 2) continue;
    const source = group[0]!.source;
    const forward = group.filter((e) => e.target.x - source.x >= SPINE_REACH + MIN_RUN);
    if (forward.length < 2) continue;
    const limit = Math.min(...forward.map((e) => e.target.x)) - MIN_RUN;
    const candidates = Array.from({ length: MAX_LANES }, (_u, k) => source.x + SPINE_REACH + LANE * k).filter(
      (x, k) => k === 0 || x <= limit,
    );
    const ys = forward.map((e) => e.target.y);
    routes.push({
      kind: 'out',
      edgeIds: forward.map((e) => e.id),
      candidates,
      top: Math.min(source.y, ...ys),
      bottom: Math.max(source.y, ...ys),
      legs: (x) => [
        { y: source.y, x1: source.x, x2: x, from: forward[0]!.from, to: '' },
        ...forward.map((e) => ({ y: e.target.y, x1: x, x2: e.target.x, from: e.from, to: e.to })),
      ],
      reach: (x) => x - source.x,
    });
    for (const e of forward) claimed.add(e.id);
  }

  for (const [, all] of byTo) {
    const group = all.filter((e) => !claimed.has(e.id));
    if (group.length < 2) continue;
    const target = group[0]!.target;
    const forward = group.filter((e) => target.x - e.source.x >= SPINE_REACH + MIN_RUN);
    if (forward.length < 2) continue;
    const limit = Math.max(...forward.map((e) => e.source.x)) + MIN_RUN;
    const candidates = Array.from({ length: MAX_LANES }, (_u, k) => target.x - SPINE_REACH - LANE * k).filter(
      (x, k) => k === 0 || x >= limit,
    );
    const ys = forward.map((e) => e.source.y);
    routes.push({
      kind: 'in',
      edgeIds: forward.map((e) => e.id),
      candidates,
      top: Math.min(target.y, ...ys),
      bottom: Math.max(target.y, ...ys),
      legs: (x) => [
        ...forward.map((e) => ({ y: e.source.y, x1: e.source.x, x2: x, from: e.from, to: e.to })),
        { y: target.y, x1: x, x2: target.x, from: '', to: forward[0]!.to },
      ],
      reach: (x) => target.x - x,
    });
    for (const e of forward) claimed.add(e.id);
  }

  for (const e of ends) {
    if (claimed.has(e.id)) continue;
    const gap = e.target.x - e.source.x;
    if (gap < MIN_SINGLE_GAP) continue;
    const middle = (e.source.x + e.target.x) / 2;
    const candidates = [middle];
    for (let k = 1; k <= MAX_LANES; k += 1) {
      for (const x of [middle - LANE * k, middle + LANE * k]) {
        if (x > e.source.x + 12 && x < e.target.x - 12) candidates.push(x);
      }
    }
    routes.push({
      kind: 'single',
      edgeIds: [e.id],
      candidates,
      top: Math.min(e.source.y, e.target.y),
      bottom: Math.max(e.source.y, e.target.y),
      legs: (x) =>
        Math.abs(e.source.y - e.target.y) < 0.5
          ? [{ y: e.source.y, x1: e.source.x, x2: e.target.x, from: e.from, to: e.to }]
          : [
              { y: e.source.y, x1: e.source.x, x2: x, from: e.from, to: e.to },
              { y: e.target.y, x1: x, x2: e.target.x, from: e.from, to: e.to },
            ],
      reach: (x) => x - e.source.x,
    });
  }

  // --- lanes -----------------------------------------------------------------
  // Manifolds first: they are the rigid ones. Then top to bottom, so the
  // result does not depend on the order the edges happen to be stored in.
  const order = [...routes].sort(
    (a, b) => (a.kind === 'single' ? 1 : 0) - (b.kind === 'single' ? 1 : 0) || a.top - b.top,
  );
  const placed: Planned[] = [];
  for (const route of order) {
    let best = route.candidates[0]!;
    let fewest = Number.POSITIVE_INFINITY;
    for (const x of route.candidates) {
      const count = clashes(x, route, placed);
      if (count < fewest) {
        fewest = count;
        best = x;
      }
      if (count === 0) break;
    }
    placed.push({ spineX: best, route, legs: route.legs(best) });
  }

  // --- labels ----------------------------------------------------------------
  const nodeRects: Rect[] = graph.nodes.map((node) => {
    const shape = shapes.get(node.id)!;
    const p = at(node.id);
    return { x: p.x, y: p.y, width: shape.width, height: shape.height };
  });
  const endsById = new Map(ends.map((e) => [e.id, e]));
  interface Run {
    id: string;
    route: Planned;
    a: number;
    b: number;
    y: number;
  }
  const runs: Run[] = [];
  for (const p of placed) {
    for (const id of p.route.edgeIds) {
      const e = endsById.get(id)!;
      // A branch's label goes on the run that is only that branch's: into
      // its consumer for a fan-out or an elbow, out of its producer for a fan-in.
      const straight = p.route.kind === 'single' && Math.abs(e.source.y - e.target.y) < 0.5;
      const run: Run = straight
        ? { id, route: p, a: e.source.x, b: e.target.x, y: e.target.y }
        : p.route.kind === 'in'
          ? { id, route: p, a: e.source.x, b: p.spineX, y: e.source.y }
          : { id, route: p, a: p.spineX, b: e.target.x, y: e.target.y };
      runs.push(run);
    }
  }
  runs.sort((r1, r2) => r1.y - r2.y || r1.a - r2.a);

  const labels: Rect[] = [];
  const plan = new Map<string, EdgePlan>();
  const { width: W, height: H } = LABEL_SIZE;
  for (const run of runs) {
    const length = run.b - run.a;
    const lo = run.a + W / 2 + 2;
    const hi = run.b - W / 2 - 2;
    const xAt = (t: number) => (hi > lo ? Math.min(hi, Math.max(lo, run.a + t * length)) : run.a + length / 2);
    let choice = { t: 0.5, dy: 0 };
    let least = Number.POSITIVE_INFINITY;
    search: for (const dy of [0, -LABEL_OFF, LABEL_OFF]) {
      for (const t of [0.5, 0.3, 0.7, 0.18, 0.82]) {
        const rect = { x: xAt(t) - W / 2, y: run.y + dy - H / 2, width: W, height: H };
        const cost =
          labels.reduce((sum, other) => sum + overlapArea(rect, other), 0) +
          nodeRects.reduce((sum, other) => sum + overlapArea(rect, other), 0);
        // Leaving the line costs a little, so it only happens when it buys clearance.
        const score = cost + (dy === 0 ? 0 : 1);
        if (score < least) {
          least = score;
          choice = { t: length > 0 ? (xAt(t) - run.a) / length : 0.5, dy };
        }
        if (cost === 0) break search;
      }
    }
    labels.push({ x: run.a + choice.t * length - W / 2, y: run.y + choice.dy - H / 2, width: W, height: H });
    plan.set(run.id, {
      kind: run.route.route.kind,
      reach: run.route.route.reach(run.route.spineX),
      labelT: choice.t,
      labelDy: choice.dy,
    });
  }
  return plan;
}

// --- memo ----------------------------------------------------------------------
// Every connection asks for its own entry, but the plan is computed once per
// graph. An entry that did not change keeps its object, so a connection the
// change did not touch does not re-render.

let cached: { graph: Graph; index: GameIndex; plan: Map<string, EdgePlan> } | null = null;

const samePlan = (a: EdgePlan | undefined, b: EdgePlan): boolean =>
  a !== undefined &&
  a.kind === b.kind &&
  Math.abs(a.reach - b.reach) < 0.01 &&
  Math.abs(a.labelT - b.labelT) < 0.001 &&
  a.labelDy === b.labelDy;

export function planRoutes(graph: Graph, index: GameIndex): Map<string, EdgePlan> {
  if (cached && cached.graph === graph && cached.index === index) return cached.plan;
  const fresh = computeRoutePlan(graph, index);
  if (cached) {
    for (const [id, entry] of fresh) {
      const previous = cached.plan.get(id);
      if (samePlan(previous, entry)) fresh.set(id, previous!);
    }
  }
  cached = { graph, index, plan: fresh };
  return fresh;
}
