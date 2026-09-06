import { describe, expect, it } from 'vitest';
import { graphOf, testGameData } from './fixtures.ts';
import { solve, type SolveResult } from './index.ts';
import { portKey } from '../graph/types.ts';
import type { GraphNode } from '../graph/types.ts';

const index = testGameData();

function recipe(
  id: string,
  recipeId: string,
  machineId: string,
  options: { modules?: string[]; machines?: number } = {},
): GraphNode {
  return {
    id,
    kind: 'recipe',
    recipeId,
    machineId,
    modules: options.modules ?? [],
    beacons: null,
    constraint:
      options.machines === undefined
        ? { type: 'free' }
        : { type: 'machines', count: options.machines },
  };
}

const source = (id: string, itemId: string, perSec?: number): GraphNode => ({
  id,
  kind: 'source',
  itemId,
  constraint: perSec === undefined ? { type: 'free' } : { type: 'rate', perSec },
});

const sink = (id: string, itemId: string, perSec?: number): GraphNode => ({
  id,
  kind: 'sink',
  itemId,
  constraint: perSec === undefined ? { type: 'free' } : { type: 'rate', perSec },
});

/** Unconnected ports are implicit sources and sinks, so only check the rest. */
function expectConnectedPortsBalance(result: SolveResult): void {
  for (const [key, port] of Object.entries(result.ports)) {
    if (!port.connected) continue;
    expect(Math.abs(port.balance), `port ${key}`).toBeLessThan(1e-6);
  }
}

const link = (from: string, to: string, itemId: string) => ({
  from,
  fromPort: itemId,
  to,
  toPort: itemId,
  transport: null,
});

describe('solve', () => {
  it('reports no-constraint when nothing is pinned', () => {
    const graph = graphOf([recipe('a', 'electronic-circuit', 'assembling-machine-3')]);
    const result = solve(graph, index);
    expect(result.status).toBe('no-constraint');
    expect(result.nodes).toEqual({});
  });

  it('drives a chain backwards from a fixed sink', () => {
    // 45/s green circuits from plain assembling machine 3s.
    const graph = graphOf(
      [
        recipe('cable', 'copper-cable', 'assembling-machine-3'),
        recipe('circuit', 'electronic-circuit', 'assembling-machine-3'),
        sink('out', 'electronic-circuit', 45),
      ],
      [link('cable', 'circuit', 'copper-cable'), link('circuit', 'out', 'electronic-circuit')],
    );
    const result = solve(graph, index);
    expect(result.status).toBe('ok');

    // 1 circuit per craft, 0.5 s, speed 1.25 -> 2.5 crafts/s per machine.
    expect(result.nodes.circuit!.craftsPerSec).toBeCloseTo(45, 6);
    expect(result.nodes.circuit!.machines).toBeCloseTo(45 / 2.5, 6);
    expect(result.nodes.circuit!.machinesCeil).toBe(18);

    // 3 copper cable per circuit; cable makes 2 per 0.5 s craft.
    expect(result.nodes.cable!.craftsPerSec).toBeCloseTo(135 / 2, 6);

    // Iron plate and copper plate are unconnected, so they are raw inputs.
    expect(result.totals.rawInputs['iron-plate']).toBeCloseTo(45, 6);
    expect(result.totals.rawInputs['copper-plate']).toBeCloseTo(67.5, 6);
    expect(result.totals.outputs['electronic-circuit']).toBeCloseTo(45, 6);
  });

  it('drives a chain forwards from a fixed machine count', () => {
    const graph = graphOf(
      [
        recipe('circuit', 'electronic-circuit', 'assembling-machine-3', { machines: 4 }),
        sink('out', 'electronic-circuit'),
      ],
      [link('circuit', 'out', 'electronic-circuit')],
    );
    const result = solve(graph, index);
    expect(result.status).toBe('ok');
    expect(result.nodes.circuit!.craftsPerSec).toBeCloseTo(10, 6);
    expect(result.totals.outputs['electronic-circuit']).toBeCloseTo(10, 6);
  });

  it('lets productivity cut the inputs per output', () => {
    const graph = graphOf(
      [
        recipe('circuit', 'electronic-circuit', 'assembling-machine-3', {
          modules: [
            'productivity-module-3',
            'productivity-module-3',
            'productivity-module-3',
            'productivity-module-3',
          ],
        }),
        sink('out', 'electronic-circuit', 14),
      ],
      [link('circuit', 'out', 'electronic-circuit')],
    );
    const result = solve(graph, index);
    // 14/s out at 1.4 per craft = 10 crafts/s, so only 10/s iron plate.
    expect(result.nodes.circuit!.craftsPerSec).toBeCloseTo(10, 6);
    expect(result.totals.rawInputs['iron-plate']).toBeCloseTo(10, 6);
    // 10 machines, since each does 1 craft/s with four prod-3s.
    expect(result.nodes.circuit!.machines).toBeCloseTo(10, 6);
  });

  it('splits one output port across two consumers', () => {
    const graph = graphOf(
      [
        recipe('plate', 'iron-plate', 'electric-furnace', { machines: 10 }),
        sink('a', 'iron-plate'),
        sink('b', 'iron-plate', 2),
      ],
      [link('plate', 'a', 'iron-plate'), link('plate', 'b', 'iron-plate')],
    );
    const result = solve(graph, index);
    // Electric furnace speed 2 / 3.2 s = 0.625/s each, 10 of them = 6.25/s.
    expect(result.nodes.plate!.craftsPerSec).toBeCloseTo(6.25, 6);
    const total = Object.values(result.edges).reduce((sum, e) => sum + e.perSec, 0);
    expect(total).toBeCloseTo(6.25, 6);
    expect(result.totals.outputs['iron-plate']).toBeCloseTo(6.25, 6);
  });

  it('flags a connected port that cannot balance', () => {
    // Two pinned machine counts that disagree: 4 circuit machines want 10/s of
    // iron plate, but 1 electric furnace only makes 0.625/s.
    const graph = graphOf(
      [
        recipe('plate', 'iron-plate', 'electric-furnace', { machines: 1 }),
        recipe('circuit', 'electronic-circuit', 'assembling-machine-3', { machines: 4 }),
      ],
      [link('plate', 'circuit', 'iron-plate')],
    );
    const result = solve(graph, index);
    expect(result.status).toBe('ok');
    const shortfall = result.ports[portKey('circuit', 'in', 'iron-plate')]!;
    expect(shortfall.consumed).toBeCloseTo(10, 6);
    expect(shortfall.produced).toBeCloseTo(0.625, 6);
    expect(shortfall.balance).toBeCloseTo(-9.375, 6);
  });

  it('ignores layout entirely', () => {
    // The solver takes only nodes and edges, so a drag cannot change a number
    // and cannot invalidate a memoised result.
    const nodes = [recipe('circuit', 'electronic-circuit', 'assembling-machine-3', { machines: 2 })];
    const here = solve({ nodes, edges: [] }, index);
    const there = solve({ nodes, edges: [] }, index);
    expect(here).toEqual(there);
    // And a full graph with positions solves to the same thing.
    const withLayout = graphOf(nodes, []);
    withLayout.positions.circuit = { x: 9999, y: -9999 };
    expect(solve(withLayout, index)).toEqual(here);
  });

  it('keeps unconnected ports balanced against their implicit source', () => {
    const graph = graphOf(
      [recipe('circuit', 'electronic-circuit', 'assembling-machine-3', { machines: 1 })],
      [],
    );
    const result = solve(graph, index);
    const port = result.ports[portKey('circuit', 'in', 'iron-plate')]!;
    // Unconnected: nothing arrives, so the balance is the whole demand and the
    // shortfall shows up in rawInputs instead of as a warning.
    expect(port.produced).toBe(0);
    expect(port.consumed).toBeCloseTo(2.5, 6);
    expect(result.totals.rawInputs['iron-plate']).toBeCloseTo(2.5, 6);
  });
});

describe('cycles', () => {
  it('solves the Kovarex loop with a U-235 seed', () => {
    // Centrifuge, 60 s: 40 U-235 + 5 U-238 in, 41 U-235 + 2 U-238 out. The
    // node feeds its own U-235 input port; only the net 1 U-235 leaves.
    const graph = graphOf(
      [
        recipe('kov', 'kovarex-enrichment-process', 'centrifuge', { machines: 1 }),
        source('seed', 'uranium-235'),
        source('u238', 'uranium-238'),
        sink('out', 'uranium-235'),
      ],
      [
        link('kov', 'kov', 'uranium-235'),
        link('seed', 'kov', 'uranium-235'),
        link('kov', 'out', 'uranium-235'),
        link('u238', 'kov', 'uranium-238'),
        link('kov', 'kov', 'uranium-238'),
      ],
    );
    const result = solve(graph, index);
    expect(result.status).toBe('ok');

    // One centrifuge at speed 1 runs 1/60 crafts/s.
    const crafts = result.nodes.kov!.craftsPerSec;
    expect(crafts).toBeCloseTo(1 / 60, 12);

    // The loop carries 40 per craft; the seed only has to top up the deficit.
    const loop = result.edges.e0!;
    expect(loop.perSec).toBeCloseTo(40 * crafts, 6);
    expect(result.totals.rawInputs['uranium-235'] ?? 0).toBeCloseTo(0, 6);
    // Net output is the 1 extra U-235 per craft.
    expect(result.totals.outputs['uranium-235']).toBeCloseTo(crafts, 6);
    // U-238 loops too: 5 in, 2 back out, so only 3 per craft comes from outside.
    expect(result.totals.rawInputs['uranium-238']).toBeCloseTo(3 * crafts, 6);
    expect(result.totals.outputs['uranium-238'] ?? 0).toBeCloseTo(0, 6);

    expectConnectedPortsBalance(result);
  });

  it('solves coal liquefaction with its heavy-oil loop', () => {
    // Oil refinery, 5 s: 10 coal + 25 heavy oil + 50 steam in;
    // 90 heavy oil + 20 light oil + 10 petroleum gas out.
    const graph = graphOf(
      [
        recipe('liq', 'coal-liquefaction', 'oil-refinery', { machines: 1 }),
        source('coal', 'coal'),
        source('steam', 'steam'),
        sink('heavy', 'heavy-oil'),
      ],
      [
        link('liq', 'liq', 'heavy-oil'),
        link('coal', 'liq', 'coal'),
        link('steam', 'liq', 'steam'),
        link('liq', 'heavy', 'heavy-oil'),
      ],
    );
    const result = solve(graph, index);
    expect(result.status).toBe('ok');

    const crafts = result.nodes.liq!.craftsPerSec;
    expect(crafts).toBeCloseTo(1 / 5, 12);
    // The loop returns the 25 the recipe eats; 65 net heavy oil leaves.
    expect(result.edges.e0!.perSec).toBeCloseTo(25 * crafts, 6);
    expect(result.totals.outputs['heavy-oil']).toBeCloseTo(65 * crafts, 6);
    expect(result.totals.rawInputs['coal']).toBeCloseTo(10 * crafts, 6);
    expect(result.totals.rawInputs['steam']).toBeCloseTo(50 * crafts, 6);
    // Light oil and petroleum gas ports have no edges, so they are byproducts.
    expect(result.totals.outputs['light-oil']).toBeCloseTo(20 * crafts, 6);
    expect(result.totals.outputs['petroleum-gas']).toBeCloseTo(10 * crafts, 6);

    expectConnectedPortsBalance(result);
  });

  it('solves a multi-node cycle', () => {
    // Advanced oil processing plus heavy and light cracking: light oil feeds
    // back nowhere, but heavy cracking consumes what the refinery makes and
    // both feed the same petroleum sink.
    const graph = graphOf(
      [
        recipe('refine', 'advanced-oil-processing', 'oil-refinery'),
        recipe('crackHeavy', 'heavy-oil-cracking', 'chemical-plant'),
        recipe('crackLight', 'light-oil-cracking', 'chemical-plant'),
        sink('gas', 'petroleum-gas', 100),
      ],
      [
        link('refine', 'crackHeavy', 'heavy-oil'),
        link('refine', 'crackLight', 'light-oil'),
        link('crackHeavy', 'crackLight', 'light-oil'),
        link('refine', 'gas', 'petroleum-gas'),
        link('crackLight', 'gas', 'petroleum-gas'),
      ],
    );
    const result = solve(graph, index);
    expect(result.status).toBe('ok');
    expect(result.totals.outputs['petroleum-gas']).toBeCloseTo(100, 6);
    expectConnectedPortsBalance(result);
  });
});

describe('transport capacity', () => {
  it('reports belt saturation and marks an over-capacity belt', () => {
    const graph = graphOf(
      [
        recipe('plate', 'iron-plate', 'electric-furnace', { machines: 40 }),
        sink('out', 'iron-plate'),
      ],
      [{ ...link('plate', 'out', 'iron-plate'), transport: { kind: 'belt' as const, beltId: 'transport-belt', lanes: 2 as const } }],
    );
    const result = solve(graph, index);
    const edge = result.edges.e0!;
    expect(edge.perSec).toBeCloseTo(25, 6);
    expect(edge.capacityPerSec).toBeCloseTo(15, 6);
    expect(edge.saturation).toBeCloseTo(25 / 15, 6);
  });

  it('halves capacity for a single lane', () => {
    const graph = graphOf(
      [recipe('plate', 'iron-plate', 'electric-furnace', { machines: 8 }), sink('out', 'iron-plate')],
      [{ ...link('plate', 'out', 'iron-plate'), transport: { kind: 'belt' as const, beltId: 'express-transport-belt', lanes: 1 as const } }],
    );
    const result = solve(graph, index);
    expect(result.edges.e0!.capacityPerSec).toBeCloseTo(22.5, 6);
  });

  it('uses fluid units for pipes', () => {
    const graph = graphOf(
      [recipe('refine', 'advanced-oil-processing', 'oil-refinery', { machines: 1 }), sink('out', 'petroleum-gas')],
      [{ ...link('refine', 'out', 'petroleum-gas'), transport: { kind: 'pipe' as const, pipeId: 'pipe' } }],
    );
    const result = solve(graph, index);
    expect(result.edges.e0!.capacityPerSec).toBe(1000);
    expect(result.edges.e0!.saturation).toBeCloseTo(11 / 1000, 6);
  });

  it('scales inserter capacity with count', () => {
    const graph = graphOf(
      [recipe('plate', 'iron-plate', 'electric-furnace', { machines: 4 }), sink('out', 'iron-plate')],
      [
        {
          ...link('plate', 'out', 'iron-plate'),
          transport: { kind: 'inserter' as const, inserterId: 'fast-inserter', count: 2 },
        },
      ],
    );
    const result = solve(graph, index);
    expect(result.edges.e0!.capacityPerSec).toBeCloseTo(30, 6);
  });
});

describe('performance', () => {
  it('solves a 100-node graph in under 10 ms', () => {
    // A 100-node chain of alternating smelting and circuit steps.
    const nodes: GraphNode[] = [];
    const edges: ReturnType<typeof link>[] = [];
    for (let i = 0; i < 50; i += 1) {
      nodes.push(recipe(`plate${i}`, 'iron-plate', 'electric-furnace'));
      nodes.push(recipe(`gear${i}`, 'iron-gear-wheel', 'assembling-machine-3'));
      edges.push(link(`plate${i}`, `gear${i}`, 'iron-plate'));
      if (i > 0) edges.push(link(`gear${i - 1}`, `gear${i}`, 'iron-gear-wheel'));
    }
    // Pin the last step so the whole graph has something to solve against.
    const last = nodes.at(-1)!;
    if (last.kind === 'recipe') last.constraint = { type: 'machines', count: 10 };
    const graph = graphOf(nodes, edges);
    expect(graph.nodes).toHaveLength(100);

    // Warm the JIT, then take the median of nine runs — a best-of-n would
    // measure the luckiest run rather than what an edit actually costs.
    for (let i = 0; i < 5; i += 1) solve(graph, index);
    const samples: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const started = performance.now();
      const result = solve(graph, index);
      samples.push(performance.now() - started);
      expect(result.status).toBe('ok');
    }
    samples.sort((a, b) => a - b);
    expect(samples[4]!).toBeLessThan(10);
  });
});
