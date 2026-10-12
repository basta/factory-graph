import { describe, expect, it } from 'vitest';
import { graphOf, testGameData } from '../solver/fixtures.ts';
import { solve } from '../solver/index.ts';
import type { FlowEdge, GraphNode } from '../graph/types.ts';
import { meterRate } from '../sim/meter.ts';
import { stepWorld } from '../sim/step.ts';
import { compileWorld } from '../sim/world.ts';
import { placeEntities } from './edit.ts';
import { layoutPlan } from './wholePlan.ts';

const index = testGameData();

const recipe = (id: string, recipeId: string, machineId = 'assembling-machine-2'): GraphNode => ({
  id, kind: 'recipe', recipeId, machineId, modules: [], beacons: null, constraint: { type: 'free' },
});
const source = (id: string, itemId: string): GraphNode => ({ id, kind: 'source', itemId, constraint: { type: 'free' } });
const sink = (id: string, itemId: string, perSec: number): GraphNode => ({
  id, kind: 'sink', itemId, constraint: { type: 'rate', perSec },
});
const link = (from: string, to: string, itemId: string): Omit<FlowEdge, 'id'> => ({
  from, fromPort: itemId, to, toPort: itemId, transport: null,
});

/** Lays the plan out, runs it for three minutes, and reads the final sink. */
function run(nodes: GraphNode[], edges: Omit<FlowEdge, 'id'>[], itemId: string) {
  const graph = graphOf(nodes, edges);
  const layout = layoutPlan(index, graph, solve(graph, index), {
    beltId: null,
    hands: 'researched',
    origin: { x: 0, y: 0 },
  });
  if ('ok' in layout) throw new Error(layout.reason);
  const placed = placeEntities({ entities: [], hands: 'researched' }, layout.entities);
  expect(placed.placed.every((id) => id !== null), 'nothing overlaps').toBe(true);
  const world = compileWorld(placed.build, index);
  stepWorld(world, 180 * 60);
  const finals = world.sinks.filter((s) => s.entity.target?.itemId === itemId);
  const delivered = finals.reduce((sum, s) => sum + meterRate(s.meters.get(itemId) ?? { buckets: new Float64Array(30), second: 0 }, world.tick), 0);
  return { layout, delivered, world };
}

describe('Lay out whole plan', () => {
  it('chains cable into circuits by a routed belt, and meets the plan', () => {
    const { layout, delivered, world } = run(
      [source('cu', 'copper-plate'), source('fe', 'iron-plate'), recipe('cable', 'copper-cable'), recipe('circ', 'electronic-circuit'), sink('out', 'electronic-circuit', 1.5)],
      [link('cu', 'cable', 'copper-plate'), link('fe', 'circ', 'iron-plate'), link('cable', 'circ', 'copper-cable'), link('circ', 'out', 'electronic-circuit')],
      'electronic-circuit',
    );
    expect(layout.rows).toBe(2);
    expect(layout.routed).toBe(1);
    expect(layout.stubbed).toBe(0);
    // Cable now arrives by belt: no source supplies it.
    expect(world.sources.some((s) => s.entity.itemId === 'copper-cable')).toBe(false);
    expect(delivered / 1.5).toBeGreaterThan(0.97);
  });

  it('chains gears into red science', () => {
    const { layout, delivered, world } = run(
      [source('cu', 'copper-plate'), source('fe', 'iron-plate'), recipe('gear', 'iron-gear-wheel'), recipe('red', 'automation-science-pack'), sink('out', 'automation-science-pack', 0.5)],
      [link('fe', 'gear', 'iron-plate'), link('cu', 'red', 'copper-plate'), link('gear', 'red', 'iron-gear-wheel'), link('red', 'out', 'automation-science-pack')],
      'automation-science-pack',
    );
    expect(layout.routed).toBe(1);
    expect(world.sources.some((s) => s.entity.itemId === 'iron-gear-wheel')).toBe(false);
    expect(delivered / 0.5).toBeGreaterThan(0.97);
  });

  it('says so when the plan has nothing to aim for', () => {
    const graph = graphOf([recipe('gear', 'iron-gear-wheel')]);
    const layout = layoutPlan(index, graph, solve(graph, index), { beltId: null, hands: 'researched', origin: { x: 0, y: 0 } });
    expect('ok' in layout && layout.ok === false).toBe(true);
  });
});
