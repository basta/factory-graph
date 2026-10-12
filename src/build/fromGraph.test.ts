import { describe, expect, it } from 'vitest';
import { graphOf, testGameData } from '../solver/fixtures.ts';
import { solve } from '../solver/index.ts';
import type { GraphNode, RecipeNode } from '../graph/types.ts';
import { meterRate } from '../sim/meter.ts';
import { stepWorld } from '../sim/step.ts';
import { compileWorld } from '../sim/world.ts';
import { placeEntities } from './edit.ts';
import { layoutRow, rowOrigin } from './fromGraph.ts';
import type { BuildEntity, HandSize } from './types.ts';

const index = testGameData();

function recipeNode(id: string, recipeId: string, machineId: string, machines: number): RecipeNode {
  return {
    id,
    kind: 'recipe',
    recipeId,
    machineId,
    modules: [],
    beacons: null,
    constraint: { type: 'machines', count: machines },
  };
}

/** Lays the node out, runs it for two minutes, and returns what reached the sink against its target. */
function trial(node: RecipeNode, others: GraphNode[] = [], hands: HandSize = 'researched', beltId: string | null = null) {
  const graph = graphOf([node, ...others]);
  const result = solve(graph, index);
  const row = layoutRow(index, node, result, { beltId, hands, origin: { x: 0, y: 0 } });
  if (!row.ok) throw new Error(row.reason);
  const placed = placeEntities({ entities: [], hands }, row.entities);
  expect(placed.placed.every((id) => id !== null), 'every entity fits').toBe(true);
  const world = compileWorld(placed.build, index);
  stepWorld(world, 120 * 60);
  const sink = world.sinks[0]!;
  const target = sink.entity.target!;
  const delivered = meterRate(sink.meters.get(target.itemId)!, world.tick);
  return { row, delivered, target: target.perSec, world };
}

describe('Build this', () => {
  it('lays out gears that meet the plan', () => {
    // Four assembler 2s: 6 gears a second from 12 plates.
    const { row, delivered, target } = trial(recipeNode('g', 'iron-gear-wheel', 'assembling-machine-2', 4));
    expect(row.ok && row.machines).toBe(4);
    expect(target).toBeCloseTo(6, 5);
    expect(delivered / target).toBeGreaterThan(0.97);
  });

  it('puts two ingredients on one belt, a lane each, and meets the plan', () => {
    const { delivered, target, world } = trial(recipeNode('c', 'electronic-circuit', 'assembling-machine-2', 3));
    expect(delivered / target).toBeGreaterThan(0.97);
    // The input belt carries iron on its left lane and cable on its right.
    const input = world.belts.filter((b) => b.entity.y === -2 && b.entity.x >= 0);
    const onLane = (lane: 0 | 1) => new Set(input.flatMap((b) => world.lanes[b.lanes[lane]]!.items.map((i) => i.itemId)));
    expect([...onLane(0)]).toEqual(['iron-plate']);
    expect([...onLane(1)]).toEqual(['copper-cable']);
  });

  it('feeds a third ingredient by long-handed inserter from a second belt', () => {
    // Engines take 13 s each, so a 30 s window sees four or five of them and
    // the delivered rate is too coarse to judge by. Every machine staying
    // busy is the same question asked precisely.
    const { row, world } = trial(recipeNode('e', 'engine-unit', 'assembling-machine-2', 2));
    if (!row.ok) throw new Error('no row');
    expect(row.entities.some((e) => e.kind === 'inserter' && e.inserterId === 'long-handed-inserter')).toBe(true);
    for (const machine of world.machines) {
      expect(meterRate(machine.working, world.tick) / 60).toBeGreaterThan(0.97);
    }
  });

  it('assumes fluids and still lays out the solid side', () => {
    const { row, delivered, target } = trial(recipeNode('p', 'plastic-bar', 'chemical-plant', 2));
    if (!row.ok) throw new Error('no row');
    expect(row.notes.join(' ')).toMatch(/Fluids are assumed/);
    expect(delivered / target).toBeGreaterThan(0.97);
  });

  it('picks faster inserters when a basic one cannot keep up', () => {
    // Gears in an assembler 3 eat 5 plates a second; one unresearched basic
    // inserter manages under one.
    const { row, delivered, target } = trial(recipeNode('g', 'iron-gear-wheel', 'assembling-machine-3', 2), [], 'base');
    if (!row.ok) throw new Error('no row');
    const kinds = new Set(row.entities.flatMap((e) => (e.kind === 'inserter' ? [e.inserterId] : [])));
    expect(kinds.has('inserter')).toBe(false);
    expect(delivered / target).toBeGreaterThan(0.97);
  });

  it('lays out one block of a node split into blocks', () => {
    const node: RecipeNode = { ...recipeNode('g', 'iron-gear-wheel', 'assembling-machine-2', 6), blocks: { type: 'count', count: 3 } };
    const result = solve(graphOf([node]), index);
    const row = layoutRow(index, node, result, { beltId: null, hands: 'researched', origin: { x: 0, y: 0 } });
    expect(row.ok && [row.machines, row.blocks]).toEqual([2, 3]);
  });

  it('refuses a recipe it has no machine for, and an enormous row', () => {
    const mining = index.data.recipes.find((recipe) => recipe.flags.includes('mining'))!;
    const drill = recipeNode('m', mining.id, mining.producers[0]!, 1);
    expect(layoutRow(index, drill, null, { beltId: null, hands: 'researched', origin: { x: 0, y: 0 } }).ok).toBe(false);
    const huge = recipeNode('g', 'iron-gear-wheel', 'assembling-machine-1', 200);
    const result = solve(graphOf([huge]), index);
    expect(layoutRow(index, huge, result, { beltId: null, hands: 'researched', origin: { x: 0, y: 0 } }).ok).toBe(false);
  });

  it('places a second row clear of the first', () => {
    const node = recipeNode('c', 'electronic-circuit', 'assembling-machine-2', 3);
    const result = solve(graphOf([node]), index);
    const first = layoutRow(index, node, result, { beltId: null, hands: 'researched', origin: { x: 0, y: 0 } });
    if (!first.ok) throw new Error('no row');
    const engine = recipeNode('e', 'engine-unit', 'assembling-machine-2', 2);
    const second = layoutRow(index, engine, solve(graphOf([engine]), index), {
      beltId: null,
      hands: 'researched',
      origin: rowOrigin(first.entities),
    });
    if (!second.ok) throw new Error('no row');
    const both = placeEntities({ entities: first.entities as BuildEntity[], hands: 'researched' }, second.entities);
    expect(both.placed.every((id) => id !== null)).toBe(true);
  });
});

describe('Build this, too much for one belt', () => {
  it('says which lane runs out and how many blocks would fit', () => {
    // 18 assembler 3s of circuits eat 135 cable a second; on a yellow belt
    // shared with iron, cable has one lane, 7.5/s.
    const node = recipeNode('c', 'electronic-circuit', 'assembling-machine-3', 18);
    const result = solve(graphOf([node]), index);
    const row = layoutRow(index, node, result, { beltId: 'transport-belt', hands: 'researched', origin: { x: 0, y: 0 } });
    if (!row.ok) throw new Error('no row');
    expect(row.notes.join(' ')).toMatch(/135\/s of copper cable where its lane carries 7\.5\/s.*18 blocks/);
  });
});
