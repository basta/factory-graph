/**
 * Prints a share hash for one of the demo graphs, for screenshots and manual
 * poking:
 *
 *   npx tsx scripts/make-fixture.ts green-circuits
 *
 * Positions are hand-placed so a screenshot of a given fixture is stable.
 */
import { encodeToHash } from '../src/graph/serialize.ts';
import type { FlowEdge, Graph, GraphNode, Transport } from '../src/graph/types.ts';

type NodeSpec = { node: GraphNode; at: { x: number; y: number } };

function recipe(
  id: string,
  recipeId: string,
  machineId: string,
  at: { x: number; y: number },
  options: { modules?: string[]; machines?: number } = {},
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

const FIXTURES: Record<string, { projectName: string; graph: Graph }> = {
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

const name = process.argv[2] ?? 'green-circuits';
const fixture = FIXTURES[name];
if (!fixture) {
  process.stderr.write(`unknown fixture "${name}". Try: ${Object.keys(FIXTURES).join(', ')}\n`);
  process.exit(1);
}
process.stdout.write(`${encodeToHash(fixture)}\n`);
