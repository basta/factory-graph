import { describe, expect, it } from 'vitest';
import { graphOf, testGameData } from '../solver/fixtures.ts';
import {
  applySettings,
  DEFAULT_SETTINGS,
  defaultTransport,
  MACHINE_FAMILIES,
  preferredMachine,
  withFamilyPick,
} from './settings.ts';
import type { FlowEdge, GraphNode, PlanSettings, Transport } from './types.ts';

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

const link = (from: string, to: string, itemId: string, transport: Transport) => ({
  from,
  fromPort: itemId,
  to,
  toPort: itemId,
  transport,
});

const belt = (beltId: string, lanes: 1 | 2 = 2): Transport => ({ kind: 'belt', beltId, lanes });

const settings = (patch: Partial<PlanSettings>): PlanSettings => ({ ...DEFAULT_SETTINGS, ...patch });

describe('every machine family names real machines', () => {
  it.each(MACHINE_FAMILIES.map((family) => [family.id, family.machines]))('%s', (_id, machines) => {
    for (const id of machines as string[]) expect(index.machines.has(id), id).toBe(true);
  });
});

describe('preferredMachine', () => {
  it("takes the plan's assembler over the electromagnetic plant", () => {
    const circuits = index.recipes.get('electronic-circuit')!;
    expect(preferredMachine(index, circuits, DEFAULT_SETTINGS)).toBe('assembling-machine-2');
  });

  it("takes the plan's furnace for smelting", () => {
    const plates = index.recipes.get('iron-plate')!;
    expect(preferredMachine(index, plates, settings({ machines: ['electric-furnace'] }))).toBe(
      'electric-furnace',
    );
  });

  it('falls back to the ranking for a recipe no preferred machine makes', () => {
    const casting = index.recipes.get('casting-iron')!;
    expect(preferredMachine(index, casting, DEFAULT_SETTINGS)).toBe('foundry');
  });
});

describe('defaultTransport', () => {
  it("puts items on the plan's belt", () => {
    expect(defaultTransport(index, settings({ beltId: 'fast-transport-belt' }), 'iron-plate')).toEqual(
      belt('fast-transport-belt'),
    );
  });

  it('leaves fluids and belt-less plans alone', () => {
    expect(defaultTransport(index, DEFAULT_SETTINGS, 'petroleum-gas')).toBeNull();
    expect(defaultTransport(index, settings({ beltId: null }), 'iron-plate')).toBeNull();
  });
});

describe('applySettings', () => {
  function plan(edges: Omit<FlowEdge, 'id'>[]) {
    return graphOf(
      [
        recipe('cable', 'copper-cable', 'assembling-machine-2', ['', '']),
        recipe('circuit', 'electronic-circuit', 'assembling-machine-2', ['speed-module', '']),
        recipe('em', 'electronic-circuit', 'electromagnetic-plant'),
        recipe('plate', 'iron-plate', 'steel-furnace'),
        recipe('oil', 'advanced-oil-processing', 'oil-refinery'),
        recipe('plastic', 'plastic-bar', 'chemical-plant'),
      ],
      edges,
    );
  }

  it('moves every connection on the old belt to the new one, keeping lanes', () => {
    const graph = plan([
      link('cable', 'circuit', 'copper-cable', belt('transport-belt', 1)),
      link('plate', 'circuit', 'iron-plate', belt('transport-belt')),
    ]);
    const next = applySettings(graph, DEFAULT_SETTINGS, settings({ beltId: 'fast-transport-belt' }), index);
    expect(next.edges.map((edge) => edge.transport)).toEqual([
      belt('fast-transport-belt', 1),
      belt('fast-transport-belt'),
    ]);
  });

  it('leaves alone what was set by hand to something else', () => {
    const graph = plan([
      link('cable', 'circuit', 'copper-cable', belt('express-transport-belt')),
      link('plate', 'circuit', 'iron-plate', { kind: 'inserter', inserterId: 'fast-inserter', count: 2 }),
    ]);
    const next = applySettings(graph, DEFAULT_SETTINGS, settings({ beltId: 'fast-transport-belt' }), index);
    expect(next.edges.map((edge) => edge.transport)).toEqual(graph.edges.map((edge) => edge.transport));
  });

  it('puts belts on bare item connections when a belt-less plan gets one, but not on fluids', () => {
    const graph = plan([
      link('cable', 'circuit', 'copper-cable', null),
      link('oil', 'plastic', 'petroleum-gas', null),
    ]);
    const next = applySettings(graph, settings({ beltId: null }), DEFAULT_SETTINGS, index);
    expect(next.edges.map((edge) => edge.transport)).toEqual([belt('transport-belt'), null]);
  });

  it('moves nodes on the old tier to the new one and pads their module slots', () => {
    const graph = plan([]);
    const next = applySettings(
      graph,
      DEFAULT_SETTINGS,
      settings({ machines: ['assembling-machine-3', 'steel-furnace'] }),
      index,
    );
    const byId = Object.fromEntries(next.nodes.map((node) => [node.id, node]));
    expect(byId.circuit).toMatchObject({
      machineId: 'assembling-machine-3',
      modules: ['speed-module', '', '', ''],
    });
    expect(byId.cable).toMatchObject({ machineId: 'assembling-machine-3' });
    // Not on the old default, so not following it.
    expect(byId.em).toMatchObject({ machineId: 'electromagnetic-plant' });
    expect(byId.plate).toMatchObject({ machineId: 'steel-furnace' });
  });

  it('records the new settings on the graph', () => {
    const next = settings({ unit: 'min' });
    expect(applySettings(plan([]), DEFAULT_SETTINGS, next, index).settings).toEqual(next);
  });
});

describe('withFamilyPick', () => {
  it("replaces only that family's machine", () => {
    const assemblers = MACHINE_FAMILIES.find((family) => family.id === 'assembler')!;
    expect(withFamilyPick(['assembling-machine-2', 'steel-furnace'], assemblers, 'assembling-machine-3')).toEqual([
      'steel-furnace',
      'assembling-machine-3',
    ]);
  });
});
