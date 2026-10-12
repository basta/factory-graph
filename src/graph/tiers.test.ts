import { describe, expect, it } from 'vitest';
import { graphOf, testGameData } from '../solver/fixtures.ts';
import { tierChanges } from './tiers.ts';
import type { GraphNode, Transport } from './types.ts';

const index = testGameData();

const recipe = (id: string, recipeId: string, machineId: string, modules: string[] = []): GraphNode => ({
  id,
  kind: 'recipe',
  recipeId,
  machineId,
  modules,
  beacons: null,
  constraint: { type: 'free' },
});

const yellow: Transport = { kind: 'belt', beltId: 'transport-belt', lanes: 1 };

const graph = graphOf(
  [
    recipe('cable', 'copper-cable', 'assembling-machine-2', ['', '']),
    recipe('circuit', 'electronic-circuit', 'electromagnetic-plant'),
    recipe('plate', 'iron-plate', 'stone-furnace'),
    recipe('oil', 'advanced-oil-processing', 'oil-refinery'),
    recipe('lube', 'lubricant', 'chemical-plant'),
  ],
  [
    { from: 'cable', fromPort: 'copper-cable', to: 'circuit', toPort: 'copper-cable', transport: yellow },
    { from: 'oil', fromPort: 'heavy-oil', to: 'lube', toPort: 'heavy-oil', transport: null },
  ],
);

describe('tierChanges', () => {
  it('puts selected connections on that tier of belt, keeping lanes, and skips fluids', () => {
    const changes = tierChanges(graph, index, [], ['e0', 'e1'], 2);
    expect(changes.transports).toEqual([
      ['e0', { kind: 'belt', beltId: 'fast-transport-belt', lanes: 1 }],
    ]);
  });

  it('takes the belt off with 0', () => {
    expect(tierChanges(graph, index, [], ['e0'], 0).transports).toEqual([['e0', null]]);
  });

  it('moves machines to that tier of their own family', () => {
    const changes = tierChanges(graph, index, ['cable', 'plate', 'circuit'], [], 3);
    expect(Object.fromEntries(changes.machines.map(([id, node]) => [id, node.machineId]))).toEqual({
      cable: 'assembling-machine-3',
      plate: 'electric-furnace',
    });
    // Assembler 3 has four slots; the two that were there are kept.
    expect(changes.machines[0]![1].modules).toEqual(['', '', '', '']);
  });

  it('changes nothing it cannot do', () => {
    expect(tierChanges(graph, index, ['oil'], [], 1).machines).toEqual([]);
    expect(tierChanges(graph, index, [], ['e0'], 9).transports).toEqual([]);
  });
});
