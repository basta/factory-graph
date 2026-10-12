/**
 * Prints a share hash for one of the demo graphs, for screenshots and manual
 * poking:
 *
 *   npx tsx scripts/make-fixture.ts green-circuits
 *
 * Positions are hand-placed so a screenshot of a given fixture is stable.
 */
import { encodeToHash, type GraphDocument } from '../src/graph/serialize.ts';
import type { Blocks, FlowEdge, Graph, GraphNode, Transport } from '../src/graph/types.ts';
import type { BuildEntity, Dir } from '../src/build/types.ts';

type NodeSpec = { node: GraphNode; at: { x: number; y: number } };

function recipe(
  id: string,
  recipeId: string,
  machineId: string,
  at: { x: number; y: number },
  options: { modules?: string[]; machines?: number; blocks?: Blocks } = {},
): NodeSpec {
  return {
    node: {
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
      ...(options.blocks ? { blocks: options.blocks } : {}),
    },
    at,
  };
}

const sink = (
  id: string,
  itemId: string,
  at: { x: number; y: number },
  perSec?: number,
): NodeSpec => ({
  node: {
    id,
    kind: 'sink',
    itemId,
    constraint: perSec === undefined ? { type: 'free' } : { type: 'rate', perSec },
  },
  at,
});

const source = (
  id: string,
  itemId: string,
  at: { x: number; y: number },
  perSec?: number,
): NodeSpec => ({
  node: {
    id,
    kind: 'source',
    itemId,
    constraint: perSec === undefined ? { type: 'free' } : { type: 'rate', perSec },
  },
  at,
});

function link(from: string, to: string, itemId: string, transport: Transport = null): FlowEdge {
  return { id: `e-${from}-${to}-${itemId}`, from, fromPort: itemId, to, toPort: itemId, transport };
}

function build(specs: NodeSpec[], edges: FlowEdge[]): Graph {
  return {
    version: 1,
    dataSet: '2x1',
    nodes: specs.map((spec) => spec.node),
    edges,
    positions: Object.fromEntries(specs.map((spec) => [spec.node.id, spec.at])),
  };
}

const FIXTURES: Record<string, GraphDocument> = {
  /** Four nodes: two feeders, the circuit assembler, and a fixed sink. */
  'green-circuits': {
    projectName: 'Green circuits',
    graph: build(
      [
        recipe('plate', 'iron-plate', 'electric-furnace', { x: 0, y: 40 }),
        recipe('cable', 'copper-cable', 'assembling-machine-2', { x: 0, y: 190 }),
        recipe('circuit', 'electronic-circuit', 'assembling-machine-3', { x: 400, y: 110 }),
        sink('out', 'electronic-circuit', { x: 800, y: 130 }, 45),
      ],
      [
        link('plate', 'circuit', 'iron-plate'),
        link('cable', 'circuit', 'copper-cable'),
        link('circuit', 'out', 'electronic-circuit'),
      ],
    ),
  },

  /** Nothing pinned anywhere: every rate is zero and the canvas says why. */
  'no-constraint': {
    projectName: 'Green circuits',
    graph: build(
      [
        recipe('cable', 'copper-cable', 'assembling-machine-2', { x: 0, y: 60 }),
        recipe('circuit', 'electronic-circuit', 'assembling-machine-3', { x: 400, y: 40 }),
        sink('out', 'electronic-circuit', { x: 800, y: 60 }),
      ],
      [link('cable', 'circuit', 'copper-cable'), link('circuit', 'out', 'electronic-circuit')],
    ),
  },

  /** Same chain with one machine count pinned too low, so a port goes red. */
  'unbalanced': {
    projectName: 'Green circuits',
    graph: build(
      [
        recipe('plate', 'iron-plate', 'electric-furnace', { x: 0, y: 40 }, { machines: 4 }),
        recipe('cable', 'copper-cable', 'assembling-machine-2', { x: 0, y: 190 }),
        recipe('circuit', 'electronic-circuit', 'assembling-machine-3', { x: 400, y: 110 }, {
          machines: 18,
        }),
        sink('out', 'electronic-circuit', { x: 800, y: 130 }),
      ],
      [
        link('plate', 'circuit', 'iron-plate'),
        link('cable', 'circuit', 'copper-cable'),
        link('circuit', 'out', 'electronic-circuit'),
      ],
    ),
  },

  /** A belt deliberately pushed past capacity. */
  'saturated-belt': {
    projectName: 'Plate bus',
    graph: build(
      [
        recipe('plate', 'iron-plate', 'electric-furnace', { x: 0, y: 60 }, { machines: 40 }),
        recipe('gear', 'iron-gear-wheel', 'assembling-machine-3', { x: 430, y: 40 }),
        sink('out', 'iron-gear-wheel', { x: 830, y: 70 }),
      ],
      [
        link('plate', 'gear', 'iron-plate', { kind: 'belt', beltId: 'transport-belt', lanes: 2 }),
        link('gear', 'out', 'iron-gear-wheel', {
          kind: 'belt',
          beltId: 'express-transport-belt',
          lanes: 2,
        }),
      ],
    ),
  },

  /**
   * Planned back from a sink, with the cable too much for one yellow belt.
   * `blocks` is the same chain with the cable split to fit.
   */
  'over-belt': overBelt(),
  blocks: overBelt({ type: 'fit' }),

  /** Kovarex: a node feeding its own input port, plus the U-238 loop. */
  kovarex: {
    projectName: 'Kovarex loop',
    graph: build(
      [
        source('seed', 'uranium-235', { x: 0, y: 40 }),
        source('u238', 'uranium-238', { x: 0, y: 160 }),
        recipe('kov', 'kovarex-enrichment-process', 'centrifuge', { x: 420, y: 80 }, {
          machines: 4,
        }),
        sink('out', 'uranium-235', { x: 860, y: 100 }),
      ],
      [
        link('seed', 'kov', 'uranium-235'),
        link('u238', 'kov', 'uranium-238'),
        link('kov', 'kov', 'uranium-235'),
        link('kov', 'kov', 'uranium-238'),
        link('kov', 'out', 'uranium-235'),
      ],
    ),
  },

  /** A wider chain, deliberately laid out badly so auto-layout has work to do. */
  tangle: {
    projectName: 'Red science',
    graph: build(
      [
        recipe('ore', 'iron-ore-mining', 'electric-mining-drill', { x: 700, y: 500 }),
        recipe('cuOre', 'copper-ore-mining', 'electric-mining-drill', { x: 120, y: 640 }),
        recipe('plate', 'iron-plate', 'electric-furnace', { x: 260, y: 60 }),
        recipe('cuPlate', 'copper-plate', 'electric-furnace', { x: 900, y: 120 }),
        recipe('gear', 'iron-gear-wheel', 'assembling-machine-3', { x: 40, y: 300 }),
        recipe('cable', 'copper-cable', 'assembling-machine-2', { x: 640, y: 40 }),
        recipe('circuit', 'electronic-circuit', 'assembling-machine-3', { x: 320, y: 420 }),
        recipe('science', 'automation-science-pack', 'assembling-machine-3', { x: 880, y: 380 }),
        sink('out', 'automation-science-pack', { x: 500, y: 700 }, 5),
        sink('chips', 'electronic-circuit', { x: 60, y: 760 }, 10),
      ],
      [
        link('ore', 'plate', 'iron-ore'),
        link('cuOre', 'cuPlate', 'copper-ore'),
        link('plate', 'gear', 'iron-plate'),
        link('plate', 'circuit', 'iron-plate'),
        link('cuPlate', 'cable', 'copper-plate'),
        link('cable', 'circuit', 'copper-cable'),
        link('gear', 'science', 'iron-gear-wheel'),
        link('cuPlate', 'science', 'copper-plate'),
        link('science', 'out', 'automation-science-pack'),
        link('circuit', 'chips', 'electronic-circuit'),
      ],
    ),
  },

  /** Modules, beacons and a foundry, to see a dense node. */
  beacons: {
    projectName: 'Beaconed smelting',
    graph: build(
      [
        recipe('cast', 'casting-iron', 'foundry', { x: 0, y: 60 }, {
          modules: [
            'productivity-module-3',
            'productivity-module-3',
            'productivity-module-3',
            'productivity-module-3',
          ],
          machines: 6,
        }),
        source('molten', 'molten-iron', { x: -360, y: 80 }),
        sink('plates', 'iron-plate', { x: 420, y: 80 }),
      ],
      [link('molten', 'cast', 'molten-iron'), link('cast', 'plates', 'iron-plate')],
    ),
  },
};

function overBelt(cableBlocks?: Blocks): { projectName: string; graph: Graph } {
  const yellow: Transport = { kind: 'belt', beltId: 'transport-belt', lanes: 2 };
  return {
    projectName: 'Green circuits',
    graph: build(
      [
        source('copper', 'copper-plate', { x: -380, y: 230 }),
        source('iron', 'iron-plate', { x: 20, y: 40 }),
        recipe('cable', 'copper-cable', 'assembling-machine-2', { x: 20, y: 210 }, {
          blocks: cableBlocks,
        }),
        recipe('circuit', 'electronic-circuit', 'assembling-machine-2', { x: 440, y: 110 }),
        sink('out', 'electronic-circuit', { x: 860, y: 130 }, 30),
      ],
      [
        link('copper', 'cable', 'copper-plate', yellow),
        link('iron', 'circuit', 'iron-plate'),
        link('cable', 'circuit', 'copper-cable', yellow),
        link('circuit', 'out', 'electronic-circuit'),
      ],
    ),
  };
}

/**
 * A plan with a build to test: one cable assembler feeding one circuit
 * assembler by direct insertion. The plan asks for 1.5 circuits a second; one
 * cable assembler only keeps the circuit one two-thirds busy, so the report
 * shows 1/s against the plan's 1.5 and both bars go to --warn. Adding a
 * second cable assembler is the fix it is there to prompt.
 */
function circuitCell(): GraphDocument {
  const E: Dir = 1;
  const S: Dir = 2;
  const W: Dir = 3;
  const belt = (id: string, x: number, y: number, dir: Dir): BuildEntity => ({
    id, kind: 'belt', x, y, dir, beltId: 'transport-belt',
  });
  const inserter = (id: string, x: number, y: number, dir: Dir): BuildEntity => ({
    id, kind: 'inserter', x, y, dir, inserterId: 'fast-inserter',
  });
  const entities: BuildEntity[] = [
    { id: 'copper', kind: 'source', x: -2, y: -2, dir: E, itemId: 'copper-plate', perSec: null },
    belt('cb1', -1, -2, E),
    belt('cb2', 0, -2, E),
    belt('cb3', 1, -2, E),
    belt('cb4', 2, -2, E),
    inserter('ci', 1, -1, S),
    { id: 'cable', kind: 'machine', x: 0, y: 0, dir: 0, machineId: 'assembling-machine-2', recipeId: 'copper-cable' },
    inserter('direct', 3, 1, E),
    { id: 'iron', kind: 'source', x: 8, y: -2, dir: W, itemId: 'iron-plate', perSec: null },
    belt('ib1', 7, -2, W),
    belt('ib2', 6, -2, W),
    belt('ib3', 5, -2, W),
    belt('ib4', 4, -2, W),
    inserter('ii', 5, -1, S),
    { id: 'circuit', kind: 'machine', x: 4, y: 0, dir: 0, machineId: 'assembling-machine-2', recipeId: 'electronic-circuit' },
    inserter('out', 5, 3, S),
    { id: 'sink', kind: 'sink', x: 5, y: 4, dir: 0 },
  ];
  return {
    projectName: 'Circuit cell',
    graph: build(
      [
        source('cu', 'copper-plate', { x: -380, y: 190 }),
        source('fe', 'iron-plate', { x: 20, y: 40 }),
        recipe('cable', 'copper-cable', 'assembling-machine-2', { x: 20, y: 190 }),
        recipe('circuit', 'electronic-circuit', 'assembling-machine-2', { x: 440, y: 110 }),
        sink('out', 'electronic-circuit', { x: 860, y: 130 }, 1.5),
      ],
      [
        link('cu', 'cable', 'copper-plate'),
        link('fe', 'circuit', 'iron-plate'),
        link('cable', 'circuit', 'copper-cable'),
        link('circuit', 'out', 'electronic-circuit'),
      ],
    ),
    build: { hands: 'researched', entities },
  };
}

FIXTURES['circuit-cell'] = circuitCell();

const name = process.argv[2] ?? 'green-circuits';
const fixture = FIXTURES[name];
if (!fixture) {
  process.stderr.write(`unknown fixture "${name}". Try: ${Object.keys(FIXTURES).join(', ')}\n`);
  process.exit(1);
}
process.stdout.write(`${encodeToHash(fixture)}\n`);
