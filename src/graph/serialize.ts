import { z } from 'zod';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Graph } from './types.ts';

/**
 * The on-the-wire graph. Kept separate from the in-memory types so a bad
 * import, a truncated URL, or a graph from a future version fails loudly here
 * instead of half-loading into the editor.
 */

const constraintSchema = z.union([
  z.object({ type: z.literal('machines'), count: z.number().finite().nonnegative() }),
  z.object({ type: z.literal('free') }),
]);

const rateConstraintSchema = z.union([
  z.object({ type: z.literal('rate'), perSec: z.number().finite().nonnegative() }),
  z.object({ type: z.literal('free') }),
]);

const nodeSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('recipe'),
    recipeId: z.string(),
    machineId: z.string(),
    modules: z.array(z.string()),
    beacons: z
      .object({
        beaconId: z.string(),
        count: z.number().int().nonnegative(),
        modules: z.array(z.string()),
      })
      .nullable(),
    constraint: constraintSchema,
  }),
  z.object({
    id: z.string(),
    kind: z.literal('source'),
    itemId: z.string(),
    constraint: rateConstraintSchema,
  }),
  z.object({
    id: z.string(),
    kind: z.literal('sink'),
    itemId: z.string(),
    constraint: rateConstraintSchema,
  }),
  z.object({ id: z.string(), kind: z.literal('note'), text: z.string() }),
]);

const transportSchema = z.union([
  z.null(),
  z.object({
    kind: z.literal('belt'),
    beltId: z.string(),
    lanes: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({ kind: z.literal('pipe'), pipeId: z.string() }),
  z.object({
    kind: z.literal('inserter'),
    inserterId: z.string(),
    count: z.number().int().positive(),
  }),
]);

const edgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  fromPort: z.string(),
  to: z.string(),
  toPort: z.string(),
  transport: transportSchema,
});

export const graphSchema = z.object({
  version: z.literal(1),
  dataSet: z.string(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  positions: z.record(z.string(), z.object({ x: z.number().finite(), y: z.number().finite() })),
});

/** A saved project: the graph plus the one non-graph thing worth keeping. */
export const documentSchema = z.object({
  graph: graphSchema,
  projectName: z.string(),
});

export interface GraphDocument {
  graph: Graph;
  projectName: string;
}

export class GraphParseError extends Error {}

/** Drops edges and positions that reference nodes which are not in the graph. */
function prune(doc: GraphDocument): GraphDocument {
  const ids = new Set(doc.graph.nodes.map((n) => n.id));
  const edges = doc.graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const positions: Graph['positions'] = {};
  for (const [id, position] of Object.entries(doc.graph.positions)) {
    if (ids.has(id)) positions[id] = position;
  }
  return { ...doc, graph: { ...doc.graph, edges, positions } };
}

export function serializeDocument(doc: GraphDocument): string {
  return JSON.stringify(doc);
}

export function parseDocument(raw: string): GraphDocument {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new GraphParseError('That file is not valid JSON.');
  }
  const parsed = documentSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new GraphParseError(
      `That file is not a Factory Graph project (${first?.path.join('.') || 'root'}: ${first?.message}).`,
    );
  }
  return prune(parsed.data);
}

export function encodeToHash(doc: GraphDocument): string {
  return compressToEncodedURIComponent(serializeDocument(doc));
}

export function decodeFromHash(hash: string): GraphDocument {
  const raw = decompressFromEncodedURIComponent(hash.replace(/^#/, ''));
  if (!raw) throw new GraphParseError('That link is damaged — the graph could not be read.');
  return parseDocument(raw);
}
