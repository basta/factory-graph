import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gameDataSchema } from '../data/schema.ts';
import { indexGameData, type GameIndex } from '../data/loader.ts';
import type { FlowEdge, Graph, GraphNode } from '../graph/types.ts';

/**
 * Test-only helpers. Loads the vendored data set straight off disk so tests
 * exercise the real 906 recipes rather than a hand-made stub.
 */

let cached: GameIndex | null = null;

export function testGameData(): GameIndex {
  if (!cached) {
    const raw = readFileSync(resolve(process.cwd(), 'public/data/2x1.json'), 'utf8');
    cached = indexGameData(gameDataSchema.parse(JSON.parse(raw)));
  }
  return cached;
}

export function graphOf(nodes: GraphNode[], edges: Omit<FlowEdge, 'id'>[] = []): Graph {
  return {
    version: 1,
    dataSet: '2x1',
    nodes,
    edges: edges.map((edge, i) => ({ ...edge, id: `e${i}` })),
    positions: Object.fromEntries(nodes.map((n, i) => [n.id, { x: i * 240, y: 0 }])),
  };
}
