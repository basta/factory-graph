import { describe, expect, it } from 'vitest';
import { testGameData } from '../solver/fixtures.ts';
import { defaultMachineFor } from './loader.ts';

const index = testGameData();
const { data } = index;

describe('vendored data set', () => {
  it('carries the Factorio 2.0 Space Age content', () => {
    expect(data.id).toBe('2x1');
    expect(data.version.base?.startsWith('2.')).toBe(true);
    expect(data.version['space-age']).toBeDefined();
    expect(data.items.length).toBeGreaterThan(500);
    expect(data.recipes.length).toBeGreaterThan(800);
  });

  it('has a machine for every recipe producer', () => {
    const machines = new Set(data.machines.map((m) => m.id));
    const missing = data.recipes.flatMap((recipe) =>
      recipe.producers.filter((id) => !machines.has(id)).map((id) => `${recipe.id} -> ${id}`),
    );
    expect(missing).toEqual([]);
  });

  it('has an item for every recipe input and output', () => {
    const items = new Set(data.items.map((i) => i.id));
    const missing = data.recipes.flatMap((recipe) =>
      [...recipe.inputs, ...recipe.outputs]
        .filter((port) => !items.has(port.itemId))
        .map((port) => `${recipe.id} -> ${port.itemId}`),
    );
    expect(missing).toEqual([]);
  });

  it('keeps every icon inside the sprite sheet', () => {
    const icons = [
      ...data.items.map((i) => i.icon),
      ...data.recipes.map((r) => r.icon),
      ...data.machines.map((m) => m.icon),
    ];
    for (const icon of icons) {
      expect(icon.x + data.sprite.size).toBeLessThanOrEqual(data.sprite.width);
      expect(icon.y + data.sprite.size).toBeLessThanOrEqual(data.sprite.height);
    }
  });

  it('marks fluids and gives solids a stack size', () => {
    expect(index.items.get('water')?.isFluid).toBe(true);
    expect(index.items.get('crude-oil')?.isFluid).toBe(true);
    expect(index.items.get('iron-plate')?.isFluid).toBe(false);
    expect(index.items.get('iron-plate')?.stackSize).toBe(100);
    // Fluids are measured in units, not stacks.
    expect(index.items.get('water')?.stackSize).toBeNull();
  });

  it('keeps machines with built-in productivity', () => {
    expect(index.machines.get('foundry')?.baseProductivity).toBe(0.5);
    expect(index.machines.get('electromagnetic-plant')?.baseProductivity).toBe(0.5);
    expect(index.machines.get('biochamber')?.baseProductivity).toBe(0.5);
    expect(index.machines.get('assembling-machine-3')?.baseProductivity).toBe(0);
  });

  it('keeps recipes with the same item on both sides', () => {
    const kovarex = index.recipes.get('kovarex-enrichment-process');
    expect(kovarex?.inputs.some((p) => p.itemId === 'uranium-235')).toBe(true);
    expect(kovarex?.outputs.some((p) => p.itemId === 'uranium-235')).toBe(true);
    const liquefaction = index.recipes.get('coal-liquefaction');
    expect(liquefaction?.inputs.some((p) => p.itemId === 'heavy-oil')).toBe(true);
    expect(liquefaction?.outputs.some((p) => p.itemId === 'heavy-oil')).toBe(true);
  });

  it('keeps multi-output and probabilistic recipes', () => {
    expect(index.recipes.get('advanced-oil-processing')?.outputs).toHaveLength(3);
    expect(index.recipes.get('uranium-processing')?.probabilistic).toBe(true);
    expect(index.recipes.get('electronic-circuit')?.probabilistic).toBe(false);
  });

  it('has transport entries for capacity warnings', () => {
    expect(index.belts.get('transport-belt')?.itemsPerSec).toBe(15);
    expect(index.belts.get('turbo-transport-belt')?.itemsPerSec).toBe(60);
    expect(index.pipes.size).toBeGreaterThan(0);
    expect(index.inserters.get('fast-inserter')?.itemsPerSec).toBeCloseTo(15, 6);
    expect(index.beacons.get('beacon')?.moduleSlots).toBe(2);
  });

  it('picks a producer for every craftable recipe', () => {
    for (const recipe of data.recipes) {
      if (recipe.producers.length === 0) continue;
      const machine = defaultMachineFor(index, recipe);
      expect(machine, recipe.id).not.toBeNull();
      expect(recipe.producers, recipe.id).toContain(machine);
    }
  });

  it('indexes producers and consumers of an item', () => {
    expect(index.producersOf.get('electronic-circuit')).toContain('electronic-circuit');
    expect(index.consumersOf.get('iron-plate')).toContain('electronic-circuit');
  });
});
