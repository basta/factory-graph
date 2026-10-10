import { describe, expect, it } from 'vitest';
import { isStandardRecipe, mainRecipe, recipeOrder } from '../data/recipes.ts';
import { nodeShape } from '../canvas/geometry.ts';
import { graphOf, testGameData } from '../solver/fixtures.ts';
import { planExpand } from './expand.ts';
import { DEFAULT_SETTINGS } from './settings.ts';
import type { Graph, GraphNode, RecipeNode } from './types.ts';

const index = testGameData();

const sink = (id: string, itemId: string): GraphNode => ({
  id,
  kind: 'sink',
  itemId,
  constraint: { type: 'rate', perSec: 30 },
});

const recipe = (id: string, recipeId: string, machineId = 'assembling-machine-2'): GraphNode => ({
  id,
  kind: 'recipe',
  recipeId,
  machineId,
  modules: [],
  beacons: null,
  constraint: { type: 'free' },
});

const recipesOf = (nodes: { node: GraphNode }[]): string[] =>
  nodes.map(({ node }) => (node as RecipeNode).recipeId);

describe('mainRecipe', () => {
  it('picks the recipe named after the item', () => {
    expect(mainRecipe(index, 'iron-plate')).toBe('iron-plate');
    expect(mainRecipe(index, 'copper-cable')).toBe('copper-cable');
  });

  it('picks mining for an ore', () => {
    expect(mainRecipe(index, 'iron-ore')).toBe('iron-ore-mining');
  });

  it('leaves a real choice to the user', () => {
    expect(mainRecipe(index, 'petroleum-gas')).toBeNull();
    expect(mainRecipe(index, 'solid-fuel')).toBeNull();
  });
});

describe('recipe order for a dragged connection', () => {
  it('puts the standard recipe first and recycling last', () => {
    const producers = (index.producersOf.get('iron-plate') ?? []).map((id) => index.recipes.get(id)!);
    const order = recipeOrder(index, 'iron-plate');
    const sorted = [...producers].sort((a, b) => order(a) - order(b));
    expect(sorted[0]!.id).toBe('iron-plate');
    expect(isStandardRecipe(sorted.at(-1)!)).toBe(false);
    expect(isStandardRecipe(index.recipes.get('iron-gear-wheel-recycling')!)).toBe(false);
    expect(isStandardRecipe(index.recipes.get('water-barrel')!)).toBe(false);
  });
});

describe('planExpand', () => {
  it("builds what a sink needs, on the plan's machine and belt", () => {
    const graph = graphOf([sink('out', 'electronic-circuit')]);
    const result = planExpand(graph, index, DEFAULT_SETTINGS, ['out']);
    expect(recipesOf(result.nodes)).toEqual(['electronic-circuit']);
    expect(result.nodes[0]!.node).toMatchObject({ machineId: 'assembling-machine-2' });
    expect(result.edges).toEqual([
      {
        from: result.nodes[0]!.node.id,
        fromPort: 'electronic-circuit',
        to: 'out',
        toPort: 'electronic-circuit',
        transport: { kind: 'belt', beltId: 'transport-belt', lanes: 2 },
      },
    ]);
  });

  it('stops at bus items and at inputs already fed', () => {
    const graph = graphOf(
      [recipe('circuit', 'electronic-circuit'), recipe('cable', 'copper-cable')],
      [{ from: 'cable', fromPort: 'copper-cable', to: 'circuit', toPort: 'copper-cable', transport: null }],
    );
    // Iron plate is on the default bus and the cable is already connected.
    expect(planExpand(graph, index, DEFAULT_SETTINGS, ['circuit']).nodes).toEqual([]);
    // Off the bus, the plate gets its furnace.
    const offBus = planExpand(graph, index, { ...DEFAULT_SETTINGS, bus: [] }, ['circuit']);
    expect(recipesOf(offBus.nodes)).toEqual(['iron-plate']);
    expect(offBus.nodes[0]!.node).toMatchObject({ machineId: 'steel-furnace' });
  });

  it('expands several selected nodes in one go', () => {
    const graph = graphOf([recipe('circuit', 'electronic-circuit'), recipe('gear', 'iron-gear-wheel')]);
    graph.positions.gear = { x: 0, y: 400 };
    const result = planExpand(graph, index, { ...DEFAULT_SETTINGS, bus: [] }, ['circuit', 'gear']);
    expect(recipesOf(result.nodes).sort()).toEqual(['copper-cable', 'iron-plate', 'iron-plate']);
  });

  it('asks about an input with a real choice instead of guessing', () => {
    const graph = graphOf([recipe('plastic', 'plastic-bar', 'chemical-plant')]);
    const result = planExpand(graph, index, DEFAULT_SETTINGS, ['plastic']);
    expect(result.choices.map((choice) => choice.itemId)).toEqual(['petroleum-gas']);
    // Coal is not a choice: its one standard recipe is the mine.
    expect(recipesOf(result.nodes)).toEqual(['coal']);
  });

  it('places producers to the left without landing on anything', () => {
    const graph: Graph = graphOf([recipe('circuit', 'electronic-circuit')]);
    graph.positions.circuit = { x: 1000, y: 200 };
    // Something already sits exactly where the cable would go.
    graph.nodes.push(recipe('blocker', 'iron-gear-wheel'));
    graph.positions.blocker = { x: 1000 - 120 - 300, y: 200 };

    const result = planExpand(graph, index, DEFAULT_SETTINGS, ['circuit']);
    const placed = result.nodes[0]!;
    expect(placed.position.x + nodeShape(placed.node, index).width).toBeLessThan(1000);
    const blocker = nodeShape(graph.nodes[1]!, index);
    const clear =
      placed.position.y >= graph.positions.blocker!.y + blocker.height ||
      placed.position.y + nodeShape(placed.node, index).height <= graph.positions.blocker!.y;
    expect(clear).toBe(true);
  });
});
