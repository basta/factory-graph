import { describe, expect, it } from 'vitest';
import { testGameData } from './fixtures.ts';
import { beaconTransmission, machineRates, outputPerCraft } from './rates.ts';

const index = testGameData();

function setup(recipeId: string, machineId: string, modules: string[], beacons = null) {
  const recipe = index.recipes.get(recipeId);
  const machine = index.machines.get(machineId);
  if (!recipe || !machine) throw new Error(`missing ${recipeId} / ${machineId}`);
  return machineRates(index, { recipe, machine, moduleIds: modules, beacons });
}

describe('known rates', () => {
  // 1. The number every green-circuit build is checked against: an assembling
  //    machine 3 with four productivity module 3s makes 1.4 circuits/s.
  //    speed 1.25 x (1 - 4x0.15) = 0.5; 0.5 / 0.5 s = 1 craft/s; x1.4 prod.
  it('assembling machine 3 with four productivity module 3 on green circuits', () => {
    const rates = setup('electronic-circuit', 'assembling-machine-3', [
      'productivity-module-3',
      'productivity-module-3',
      'productivity-module-3',
      'productivity-module-3',
    ]);
    expect(rates.speedMultiplier).toBeCloseTo(0.4, 12);
    expect(rates.craftsPerSecPerMachine).toBeCloseTo(1, 12);
    expect(rates.productivity).toBeCloseTo(0.4, 12);

    const circuits = index.recipes.get('electronic-circuit')!.outputs[0]!;
    expect(outputPerCraft(circuits, rates.productivity) * rates.craftsPerSecPerMachine).toBeCloseTo(
      1.4,
      12,
    );

    // 375 kW x (1 + 4x0.8) = 1575 kW active, plus 12.5 kW drain.
    expect(rates.activePowerKwPerMachine).toBeCloseTo(1575, 9);
    expect(rates.drainKwPerMachine).toBeCloseTo(12.5, 12);
    // 2/min x (1 + 4x0.1) x 4.2 consumption = 11.76/min.
    expect(rates.pollutionPerMinPerMachine).toBeCloseTo(11.76, 9);
  });

  // 2. A steel furnace smelts one iron plate every 3.2 s at speed 2, so
  //    0.625 plates/s — the ratio behind "1 steel furnace per 0.625/s".
  it('steel furnace smelting iron plate', () => {
    const rates = setup('iron-plate', 'steel-furnace', []);
    expect(rates.craftsPerSecPerMachine).toBeCloseTo(0.625, 12);
    // Steel furnaces refuse productivity, and burn fuel rather than draw power.
    expect(rates.productivity).toBe(0);
    expect(rates.activePowerKwPerMachine).toBe(0);
  });

  // 3. Eight vanilla beacons of two speed module 3s: sqrt(8) x 1.5 x 1.0
  //    = +424.26 % speed in Factorio 2.0, not 1.1's +400 %.
  it('eight beacons of speed module 3 on an electric furnace', () => {
    const beacons = {
      beaconId: 'beacon',
      count: 8,
      modules: ['speed-module-3', 'speed-module-3'],
    };
    const rates = machineRates(index, {
      recipe: index.recipes.get('iron-plate')!,
      machine: index.machines.get('electric-furnace')!,
      moduleIds: [],
      beacons,
    });
    // The data set ships the game's own profile table, which is rounded to
    // four places (0.3535, not 0.35355...), so match to three places.
    expect(rates.effects.speed).toBeCloseTo(Math.sqrt(8) * 1.5, 2);
    expect(rates.effects.speed).toBeCloseTo(4.242, 3);
    // Electric furnace speed 2 x 5.242 / 3.2 s per plate.
    expect(rates.craftsPerSecPerMachine).toBeCloseTo((2 * (1 + 4.242)) / 3.2, 3);
    // Beacons draw 480 kW each whether or not the furnace is busy.
    expect(rates.beaconPowerKwPerMachine).toBeCloseTo(3840, 9);
  });
});

describe('beacon distribution', () => {
  const beacon = index.beacons.get('beacon')!;

  it('follows the 2.0 1/sqrt(n) profile', () => {
    // n beacons deliver sqrt(n) x effectivity in total.
    for (const n of [1, 2, 4, 8, 12]) {
      expect(beaconTransmission(beacon, n) * n).toBeCloseTo(Math.sqrt(n) * beacon.effectivity, 2);
    }
  });

  it('is zero for no beacons', () => {
    expect(beaconTransmission(beacon, 0)).toBe(0);
  });
});

describe('effect rules', () => {
  it('applies machine base productivity', () => {
    // The foundry ships with +50 % productivity before any module.
    const rates = setup('casting-iron', 'foundry', []);
    expect(rates.productivity).toBeCloseTo(0.5, 12);
    const plates = index.recipes.get('casting-iron')!.outputs[0]!;
    expect(outputPerCraft(plates, rates.productivity)).toBeCloseTo(3, 12);
  });

  it('refuses a productivity module where productivity is disallowed', () => {
    // A recycler cannot take productivity modules at all, so neither the
    // productivity nor the module's speed penalty applies.
    const rates = setup('iron-gear-wheel-recycling', 'recycler', ['productivity-module-3']);
    expect(rates.productivity).toBe(0);
    expect(rates.speedMultiplier).toBe(1);
  });

  it('masks an effect a machine ignores but keeps the module', () => {
    // An oil refinery ignores quality, but speed modules still work in it.
    const rates = setup('advanced-oil-processing', 'oil-refinery', [
      'speed-module-3',
      'speed-module-3',
      'speed-module-3',
    ]);
    expect(rates.speedMultiplier).toBeCloseTo(2.5, 12);
  });

  it('clamps speed and consumption at 20 %', () => {
    // Three efficiency module 3s would be -150 % consumption unclamped.
    const rates = setup('electronic-circuit', 'assembling-machine-3', [
      'efficiency-module-3',
      'efficiency-module-3',
      'efficiency-module-3',
      'efficiency-module-3',
    ]);
    expect(rates.consumptionMultiplier).toBeCloseTo(0.2, 12);
    expect(rates.activePowerKwPerMachine).toBeCloseTo(75, 9);
  });

  it('leaves catalyst amounts out of productivity', () => {
    // Kovarex returns 40 seed U-235 plus 1 net; only the 1 is boosted.
    const kovarex = index.recipes.get('kovarex-enrichment-process')!;
    const u235 = kovarex.outputs.find((o) => o.itemId === 'uranium-235')!;
    expect(u235.catalyst).toBe(40);
    expect(outputPerCraft(u235, 0)).toBeCloseTo(41, 12);
    expect(outputPerCraft(u235, 1)).toBeCloseTo(42, 12);
  });

  it('averages probabilistic outputs', () => {
    // Uranium processing yields U-235 0.7 % of the time; the data set carries
    // the expected amount and flags the recipe.
    const recipe = index.recipes.get('uranium-processing')!;
    expect(recipe.probabilistic).toBe(true);
    const u235 = recipe.outputs.find((o) => o.itemId === 'uranium-235')!;
    expect(outputPerCraft(u235, 0)).toBeCloseTo(0.007, 12);
  });
});
