import type { GameIndex } from '../data/loader.ts';
import { nodeShape, portOffsetY, type NodeShape } from '../canvas/geometry.ts';
import { manifoldRoute } from '../canvas/routing.ts';
import type { Graph, Position } from './types.ts';

/**
 * How readable a layout is, as numbers, so a change to the auto-layout can be
 * judged by more than a screenshot. It traces each connection the way the
 * canvas draws it — a manifold for a shared port, otherwise smoothstep's turn
 * halfway across — and counts what makes a graph hard to read:
 *
 * - `bent`: connections that are not a straight line from port to port.
 * - `throughNodes`: connections that pass behind a node they do not touch.
 * - `labelClashes`: rate labels that land on another label or on a node.
 * - `sharedRuns`: pairs of connections drawn along the same stretch of line
 *   without sharing a port — two flows that look like one.
 */
export interface LayoutScore {
  edges: number;
  bent: number;
  throughNodes: number;
  labelClashes: number;
  sharedRuns: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** About the size of a rate label with its belt sprite. */
const LABEL = { width: 92, height: 26 };

const hits = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Whether an axis-aligned segment crosses the inside of a rect. */
function segmentHits(ax: number, ay: number, bx: number, by: number, rect: Rect): boolean {
  const inset = { x: rect.x + 2, y: rect.y + 2, width: rect.width - 4, height: rect.height - 4 };
  const box = {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.max(Math.abs(bx - ax), 0.5),
    height: Math.max(Math.abs(by - ay), 0.5),
  };
  return hits(box, inset);
}

function portPoint(
  at: Position,
  shape: NodeShape,
  side: 'in' | 'out',
  itemId: string,
): Position | null {
  const ports = side === 'in' ? shape.inputs : shape.outputs;
  const port = ports.find((candidate) => candidate.itemId === itemId);
  if (!port) return null;
  return { x: at.x + (side === 'in' ? 0 : shape.width), y: at.y + portOffsetY(shape, port.row) };
}

export function scoreLayout(
  graph: Graph,
  index: GameIndex,
  positions: Record<string, Position> = graph.positions,
): LayoutScore {
  const shapes = new Map(graph.nodes.map((node) => [node.id, nodeShape(node, index)]));
  const rects = new Map<string, Rect>();
  for (const node of graph.nodes) {
    const shape = shapes.get(node.id)!;
    const at = positions[node.id] ?? { x: 0, y: 0 };
    rects.set(node.id, { x: at.x, y: at.y, width: shape.width, height: shape.height });
  }

  const score: LayoutScore = { edges: 0, bent: 0, throughNodes: 0, labelClashes: 0, sharedRuns: 0 };
  const labels: Rect[] = [];
  const traced: { from: string; to: string; points: Position[] }[] = [];

  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue;
    const fromShape = shapes.get(edge.from);
    const toShape = shapes.get(edge.to);
    if (!fromShape || !toShape) continue;
    const source = portPoint(positions[edge.from] ?? { x: 0, y: 0 }, fromShape, 'out', edge.fromPort);
    const target = portPoint(positions[edge.to] ?? { x: 0, y: 0 }, toShape, 'in', edge.toPort);
    if (!source || !target) continue;
    score.edges += 1;

    const fanOut = graph.edges.filter((o) => o.from === edge.from && o.fromPort === edge.fromPort).length;
    const fanIn = graph.edges.filter((o) => o.to === edge.to && o.toPort === edge.toPort).length;
    const shared = fanOut > 1 ? 'out' : fanIn > 1 ? 'in' : null;
    const manifold = shared ? manifoldRoute(shared, source.x, source.y, target.x, target.y) : null;

    let points: Position[];
    let label: Position;
    if (manifold) {
      const spineX = manifold.junction!.x;
      points = [source, { x: spineX, y: source.y }, { x: spineX, y: target.y }, target];
      label = { x: manifold.labelX, y: manifold.labelY };
    } else if (target.x > source.x) {
      const middle = (source.x + target.x) / 2;
      points = [source, { x: middle, y: source.y }, { x: middle, y: target.y }, target];
      label = { x: middle, y: (source.y + target.y) / 2 };
    } else {
      // A connection running backwards loops round both nodes; close enough
      // to count it as bent and through whatever sits between them.
      const below = Math.max(source.y, target.y) + 40;
      points = [
        source,
        { x: source.x + 20, y: source.y },
        { x: source.x + 20, y: below },
        { x: target.x - 20, y: below },
        { x: target.x - 20, y: target.y },
        target,
      ];
      label = { x: (source.x + target.x) / 2, y: below };
    }

    if (Math.abs(source.y - target.y) >= 1) score.bent += 1;

    for (const [id, rect] of rects) {
      if (id === edge.from || id === edge.to) continue;
      const crosses = points.some((point, i) => {
        const next = points[i + 1];
        return next !== undefined && segmentHits(point.x, point.y, next.x, next.y, rect);
      });
      if (crosses) score.throughNodes += 1;
    }

    traced.push({ from: `${edge.from}|${edge.fromPort}`, to: `${edge.to}|${edge.toPort}`, points });

    labels.push({
      x: label.x - LABEL.width / 2,
      y: label.y - LABEL.height / 2,
      width: LABEL.width,
      height: LABEL.height,
    });
  }

  for (let i = 0; i < labels.length; i += 1) {
    const mine = labels[i]!;
    const clash =
      labels.some((other, j) => j !== i && hits(mine, other)) ||
      [...rects.values()].some((rect) => hits(mine, rect));
    if (clash) score.labelClashes += 1;
  }

  for (let i = 0; i < traced.length; i += 1) {
    for (let j = i + 1; j < traced.length; j += 1) {
      const a = traced[i]!;
      const b = traced[j]!;
      // A manifold's branches share their spine on purpose.
      if (a.from === b.from || a.to === b.to) continue;
      if (runsOverlap(a.points, b.points)) score.sharedRuns += 1;
    }
  }

  return score;
}

/** Whether two polylines have collinear segments overlapping by more than 4px. */
function runsOverlap(a: Position[], b: Position[]): boolean {
  const segments = (points: Position[]) =>
    points.slice(1).map((point, i) => [points[i]!, point] as const);
  for (const [a1, a2] of segments(a)) {
    for (const [b1, b2] of segments(b)) {
      const horizontal = Math.abs(a1.y - a2.y) < 0.5 && Math.abs(b1.y - b2.y) < 0.5;
      const vertical = Math.abs(a1.x - a2.x) < 0.5 && Math.abs(b1.x - b2.x) < 0.5;
      if (horizontal && Math.abs(a1.y - b1.y) < 1) {
        const overlap =
          Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) -
          Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
        if (overlap > 4) return true;
      }
      if (vertical && Math.abs(a1.x - b1.x) < 1) {
        const overlap =
          Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) -
          Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
        if (overlap > 4) return true;
      }
    }
  }
  return false;
}
