import { describe, expect, it } from 'vitest';
import { graphOf, testGameData } from '../solver/fixtures.ts';
import { scoreLayout } from '../graph/layoutQuality.ts';
import type { GraphNode, Transport } from '../graph/types.ts';
import { computeRoutePlan } from './routingPlan.ts';

const index = testGameData();
const yellow: Transport = { kind: 'belt', beltId: 'transport-belt', lanes: 2 };

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
  transport: yellow,
});

describe('computeRoutePlan', () => {
  // Two producers in one column, each feeding the same two consumers — the
  // screenshot that started this: both spines on one line, labels stacked.
  function twoFanOuts() {
    const graph = graphOf(
      [
        recipe('iron', 'casting-iron', 'foundry'),
        recipe('cable', 'casting-copper-cable', 'foundry'),
        recipe('top', 'electronic-circuit', 'assembling-machine-2'),
        recipe('bottom', 'electronic-circuit', 'assembling-machine-2'),
      ],
      [
        link('iron', 'top', 'iron-plate'),
        link('iron', 'bottom', 'iron-plate'),
        link('cable', 'top', 'copper-cable'),
        link('cable', 'bottom', 'copper-cable'),
      ],
    );
    graph.positions = {
      iron: { x: 0, y: 0 },
      cable: { x: 0, y: 240 },
      top: { x: 490, y: 8 },
      bottom: { x: 480, y: 268 },
    };
    return graph;
  }

  it('gives two fan-outs from one column their own spines', () => {
    const plan = computeRoutePlan(twoFanOuts(), index);
    const iron = plan.get('e0')!;
    const cable = plan.get('e2')!;
    expect(iron.kind).toBe('out');
    expect(cable.kind).toBe('out');
    expect(Math.abs(iron.reach - cable.reach)).toBeGreaterThanOrEqual(10);
    // Branches of one fan-out still share theirs.
    expect(plan.get('e1')!.reach).toBe(iron.reach);
  });

  it('keeps labels on adjacent input rows off each other, and no two flows on one line', () => {
    const score = scoreLayout(twoFanOuts(), index);
    expect(score.labelClashes).toBe(0);
    expect(score.sharedRuns).toBe(0);
  });

  it("turns an elbow where it will not run along another flow's line", () => {
    // Cable's output row lines up with the gear's plate input, so a turn
    // halfway would run the cable's flow along the plate branch into the gear.
    const graph = graphOf(
      [
        recipe('cable', 'copper-cable', 'assembling-machine-2'),
        recipe('plate', 'iron-plate', 'steel-furnace'),
        recipe('gear', 'iron-gear-wheel', 'assembling-machine-2'),
        recipe('circuit', 'electronic-circuit', 'assembling-machine-2'),
      ],
      [link('plate', 'gear', 'iron-plate'), link('plate', 'circuit', 'iron-plate'), link('cable', 'circuit', 'copper-cable')],
    );
    graph.positions = {
      cable: { x: 0, y: 0 },
      plate: { x: 0, y: 120 },
      gear: { x: 480, y: 0 },
      circuit: { x: 480, y: 120 },
    };
    expect(scoreLayout(graph, index).sharedRuns).toBe(0);
  });

  it('leaves a straight connection straight, its label on the line', () => {
    const graph = graphOf(
      [recipe('plate', 'iron-plate', 'steel-furnace'), recipe('gear', 'iron-gear-wheel', 'assembling-machine-2')],
      [link('plate', 'gear', 'iron-plate')],
    );
    graph.positions = { plate: { x: 0, y: 0 }, gear: { x: 500, y: 0 } };
    expect(computeRoutePlan(graph, index).get('e0')).toMatchObject({ kind: 'single', labelDy: 0 });
  });
});
