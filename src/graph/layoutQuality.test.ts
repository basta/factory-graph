import { describe, expect, it } from 'vitest';
import { graphOf, testGameData } from '../solver/fixtures.ts';
import { scoreLayout } from './layoutQuality.ts';
import type { GraphNode } from './types.ts';

const index = testGameData();

const recipe = (id: string, recipeId: string): GraphNode => ({
  id,
  kind: 'recipe',
  recipeId,
  machineId: 'assembling-machine-2',
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

describe('scoreLayout', () => {
  // Plate output and the gear's plate input both sit on their node's first
  // port row, so equal node tops make the connection a straight line.
  const graph = graphOf(
    [recipe('plate', 'iron-plate'), recipe('gear', 'iron-gear-wheel'), recipe('in-the-way', 'pipe')],
    [link('plate', 'gear', 'iron-plate')],
  );

  it('counts a port-to-port straight line as not bent', () => {
    const score = scoreLayout(graph, index, {
      plate: { x: 0, y: 0 },
      gear: { x: 600, y: 0 },
      'in-the-way': { x: 0, y: 400 },
    });
    expect(score).toEqual({ edges: 1, bent: 0, throughNodes: 0, labelClashes: 0, sharedRuns: 0 });
  });

  it('counts a connection running behind a node, and a label with nowhere to go but onto one', () => {
    const score = scoreLayout(graph, index, {
      plate: { x: 0, y: 0 },
      gear: { x: 600, y: 0 },
      // Covers the whole run between the two, at the plate row's height, so
      // the line goes straight through it and the label cannot slide clear.
      'in-the-way': { x: 300, y: 20 },
    });
    expect(score.throughNodes).toBe(1);
    expect(score.labelClashes).toBe(1);
  });
});
