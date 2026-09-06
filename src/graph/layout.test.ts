import { describe, expect, it } from 'vitest';
import { autoLayout } from './layout.ts';
import { graphOf, testGameData } from '../solver/fixtures.ts';
import type { GraphNode } from './types.ts';

const index = testGameData();

const recipe = (id: string, recipeId: string, machineId: string): GraphNode => ({
  id,
  kind: 'recipe',
  recipeId,
  machineId,
  modules: [],
  beacons: null,
  constraint: { type: 'free' },
});

const link = (from: string, to: string, itemId: string) => ({
  from,
  fromPort: itemId,
  to,
  toPort: itemId,
  transport: null,
});

describe('auto-layout', () => {
  it('returns nothing for an empty graph', async () => {
    expect(await autoLayout(graphOf([]), index)).toEqual({});
  });

  it('places every node exactly once', async () => {
    const graph = graphOf(
      [
        recipe('plate', 'iron-plate', 'electric-furnace'),
        recipe('cable', 'copper-cable', 'assembling-machine-2'),
        recipe('circuit', 'electronic-circuit', 'assembling-machine-3'),
      ],
      [link('plate', 'circuit', 'iron-plate'), link('cable', 'circuit', 'copper-cable')],
    );
    const positions = await autoLayout(graph, index);
    expect(Object.keys(positions).sort()).toEqual(['cable', 'circuit', 'plate']);
    for (const position of Object.values(positions)) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
  });

  it('runs left to right, so a consumer sits right of its producer', async () => {
    const graph = graphOf(
      [
        recipe('plate', 'iron-plate', 'electric-furnace'),
        recipe('gear', 'iron-gear-wheel', 'assembling-machine-3'),
        recipe('belt', 'transport-belt', 'assembling-machine-3'),
      ],
      [link('plate', 'gear', 'iron-plate'), link('gear', 'belt', 'iron-gear-wheel')],
    );
    const positions = await autoLayout(graph, index);
    expect(positions.plate!.x).toBeLessThan(positions.gear!.x);
    expect(positions.gear!.x).toBeLessThan(positions.belt!.x);
  });

  it('separates nodes rather than stacking them', async () => {
    const nodes = Array.from({ length: 6 }, (_unused, i) =>
      recipe(`n${i}`, 'iron-plate', 'electric-furnace'),
    );
    const positions = await autoLayout(graphOf(nodes), index);
    const seen = new Set(Object.values(positions).map((p) => `${p.x},${p.y}`));
    expect(seen.size).toBe(nodes.length);
  });

  it('lays out a self-looping recipe without hanging on it', async () => {
    // The self-edge is dropped before ELK sees it; a loop carries no ordering
    // information and ELK routes it badly.
    const graph = graphOf(
      [recipe('kov', 'kovarex-enrichment-process', 'centrifuge')],
      [link('kov', 'kov', 'uranium-235')],
    );
    const positions = await autoLayout(graph, index);
    expect(Object.keys(positions)).toEqual(['kov']);
  });

  it('handles a 60-node graph', async () => {
    const nodes: GraphNode[] = [];
    const edges = [];
    for (let i = 0; i < 30; i += 1) {
      nodes.push(recipe(`plate${i}`, 'iron-plate', 'electric-furnace'));
      nodes.push(recipe(`gear${i}`, 'iron-gear-wheel', 'assembling-machine-3'));
      edges.push(link(`plate${i}`, `gear${i}`, 'iron-plate'));
    }
    const positions = await autoLayout(graphOf(nodes, edges), index);
    expect(Object.keys(positions)).toHaveLength(60);
  });
});
