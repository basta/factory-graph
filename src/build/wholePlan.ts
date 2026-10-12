/**
 * "Lay out whole plan": every recipe node as a row, stacked top to bottom in
 * production order, with a belt routed along every link of the graph that a
 * belt can carry. What is left stays as the single-row layout leaves it —
 * the plan's raw inputs come from sources, and a link that could not be
 * routed keeps a source at one end and a sink at the other, and is reported.
 */
import type { GameIndex } from '../data/loader.ts';
import type { Graph, RecipeNode } from '../graph/types.ts';
import { newId } from '../graph/store.ts';
import type { SolveResult } from '../solver/types.ts';
import { entityFootprint } from './entities.ts';
import { layoutRow } from './fromGraph.ts';
import { routeBelt, type Bounds } from './route.ts';
import type { BuildEntity, Dir, HandSize } from './types.ts';

/** Empty rows between stacked rows, for belts to run along. */
export const ROW_GAP = 4;
/** Free tiles kept round the whole layout, for belts to run round the outside. */
const MARGIN = 6;

export interface PlanLayout {
  entities: BuildEntity[];
  rows: number;
  /** Graph links now carried by a routed belt. */
  routed: number;
  /** Graph links left as a source and a sink. */
  stubbed: number;
  notes: string[];
}

interface Row {
  node: RecipeNode;
  entities: BuildEntity[];
  feeds: { itemId: string; sourceId: string }[];
  output: { itemId: string; sinkId: string } | null;
}

/** Producers before consumers; whatever a loop leaves is appended in graph order. */
function productionOrder(graph: Pick<Graph, 'nodes' | 'edges'>, ids: readonly string[]): string[] {
  const inside = new Set(ids);
  const incoming = new Map(ids.map((id) => [id, 0]));
  for (const edge of graph.edges) {
    if (inside.has(edge.from) && inside.has(edge.to) && edge.from !== edge.to) {
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    }
  }
  const order: string[] = [];
  const ready = ids.filter((id) => incoming.get(id) === 0);
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const edge of graph.edges) {
      if (edge.from !== id || !inside.has(edge.to) || edge.to === id) continue;
      const left = (incoming.get(edge.to) ?? 0) - 1;
      incoming.set(edge.to, left);
      if (left === 0) ready.push(edge.to);
    }
  }
  for (const id of ids) if (!order.includes(id)) order.push(id);
  return order;
}

function extent(entities: readonly BuildEntity[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entity of entities) {
    const { w, h } = entityFootprint(entity);
    minX = Math.min(minX, entity.x);
    minY = Math.min(minY, entity.y);
    maxX = Math.max(maxX, entity.x + w - 1);
    maxY = Math.max(maxY, entity.y + h - 1);
  }
  return { minX, minY, maxX, maxY };
}

export function layoutPlan(
  index: GameIndex,
  graph: Pick<Graph, 'nodes' | 'edges'>,
  result: SolveResult | null,
  options: {
    beltId: string | null;
    hands: HandSize;
    origin: { x: number; y: number };
    /** What is already built, which routes must go round. Not returned. */
    existing?: readonly BuildEntity[];
  },
): PlanLayout | { ok: false; reason: string } {
  const recipes = graph.nodes.filter((node): node is RecipeNode => node.kind === 'recipe');
  if (recipes.length === 0) return { ok: false, reason: 'The plan has no recipes to lay out.' };
  if (result?.status !== 'ok') {
    return { ok: false, reason: 'The plan has no solution yet. Give it a rate to aim for first.' };
  }

  const notes: string[] = [];
  const rows: Row[] = [];
  let cursorY = options.origin.y;
  for (const id of productionOrder(graph, recipes.map((node) => node.id))) {
    const node = recipes.find((candidate) => candidate.id === id)!;
    // Each row is laid out at the origin, then moved down under the last.
    const row = layoutRow(index, node, result, {
      beltId: options.beltId,
      hands: options.hands,
      origin: { x: options.origin.x, y: 0 },
      whole: true,
    });
    const name = index.recipes.get(node.recipeId)?.name ?? node.recipeId;
    if (!row.ok) {
      notes.push(`${name}: ${row.reason}`);
      continue;
    }
    for (const note of row.notes) {
      // One mention per kind of caveat is enough across a whole plan.
      if (!notes.some((existing) => existing.endsWith(note))) notes.push(`${name}: ${note}`);
    }
    const box = extent(row.entities);
    const dy = cursorY - box.minY;
    rows.push({
      node,
      entities: row.entities.map((entity) => ({ ...entity, y: entity.y + dy })),
      feeds: row.feeds,
      output: row.output,
    });
    cursorY += box.maxY - box.minY + 1 + ROW_GAP;
  }
  if (rows.length === 0) return { ok: false, reason: notes[0] ?? 'Nothing in the plan can be laid out.' };

  let entities = rows.flatMap((row) => row.entities);
  const box = extent(entities);
  const bounds: Bounds = {
    minX: box.minX - MARGIN,
    minY: box.minY - MARGIN,
    maxX: box.maxX + MARGIN,
    maxY: box.maxY + MARGIN,
  };

  // Links to route: one belt per producer output and per consumer feed, so
  // a fan-out or fan-in routes its first link and stubs the rest.
  const byNode = new Map(rows.map((row) => [row.node.id, row]));
  const usedOutputs = new Set<string>();
  const usedFeeds = new Set<string>();
  const links: { from: Row; to: Row; itemId: string; sourceId: string }[] = [];
  let stubbed = 0;
  for (const edge of graph.edges) {
    const from = byNode.get(edge.from);
    const to = byNode.get(edge.to);
    if (!from || !to) continue;
    if (index.items.get(edge.fromPort)?.isFluid) continue;
    const feed = to.feeds.find((f) => f.itemId === edge.toPort && !usedFeeds.has(f.sourceId));
    if (!from.output || from.output.itemId !== edge.fromPort || usedOutputs.has(from.output.sinkId) || !feed) {
      stubbed += 1;
      continue;
    }
    usedOutputs.add(from.output.sinkId);
    usedFeeds.add(feed.sourceId);
    links.push({ from, to, itemId: edge.fromPort, sourceId: feed.sourceId });
  }

  // Shortest first: they have the fewest ways to go and should get them.
  const span = (link: (typeof links)[number]): number => {
    const sink = entities.find((e) => e.id === link.from.output!.sinkId)!;
    const source = entities.find((e) => e.id === link.sourceId)!;
    return Math.abs(sink.x - source.x) + Math.abs(sink.y - source.y);
  };
  links.sort((a, b) => span(a) - span(b));

  let routed = 0;
  const beltOf = (row: Row): string =>
    row.entities.find((e): e is BuildEntity & { kind: 'belt' } => e.kind === 'belt')?.beltId ?? 'transport-belt';
  for (const link of links) {
    const sink = entities.find((e) => e.id === link.from.output!.sinkId)!;
    const source = entities.find((e) => e.id === link.sourceId)!;
    // The sink sits where the output belt ends, facing on east; the source
    // faces into the belt it feeds. The route replaces both.
    const without = entities.filter((e) => e.id !== sink.id && e.id !== source.id);
    const path = routeBelt(
      [...(options.existing ?? []), ...without],
      { tile: { x: sink.x, y: sink.y }, dir: 1 as Dir },
      { tile: { x: source.x, y: source.y }, dir: source.dir },
      beltOf(link.from),
      bounds,
      () => newId('b'),
    );
    if (!path) {
      stubbed += 1;
      continue;
    }
    entities = [...without, ...path];
    routed += 1;
  }
  if (stubbed > 0) {
    notes.push(
      `${stubbed} ${stubbed === 1 ? 'link is' : 'links are'} fed by a source instead of a belt: a split or merge, a fluid, or no way through.`,
    );
  }

  return { entities, rows: rows.length, routed, stubbed, notes };
}
