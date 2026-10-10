/**
 * Every rate formula in the app lives here.
 *
 * Sources, all Factorio 2.0:
 *   - https://wiki.factorio.com/Module        (module effects, stacking, caps)
 *   - https://wiki.factorio.com/Beacon        (2.0 beacon distribution)
 *   - https://wiki.factorio.com/Crafting_machine
 *   - https://wiki.factorio.com/Pollution     (pollution scales with power draw)
 *
 * The three rules that matter and are easy to get wrong:
 *
 * 1. **Beacons, 2.0.** Each beacon transmits `effectivity × profile[n-1]` of its
 *    modules' effects, where `n` is how many beacons reach the machine. Vanilla
 *    `profile[n-1] = 1/sqrt(n)`, so `n` beacons deliver `sqrt(n) × effectivity ×
 *    (sum of one beacon's module effects)`. Eight vanilla beacons of two
 *    speed-3 modules therefore give `sqrt(8) × 1.5 × 1.0 = +424.26 %` speed,
 *    not the +400 % that 1.1's flat 0.5 distribution gave. The profile table
 *    ships in the data set so we match the game's own rounding instead of
 *    recomputing `1/sqrt(n)`.
 *
 * 2. **Productivity changes the ratio, not the speed.** Crafts per second are
 *    driven by speed alone; productivity multiplies the *outputs* of each
 *    craft, so inputs per output fall. It never applies to the catalyst part of
 *    an output — Kovarex returns its 40 seed U-235 untouched and only the 1 net
 *    U-235 is boosted.
 *
 * 3. **Effects clamp.** Speed and consumption multipliers bottom out at 0.2
 *    (a -80 % effect); productivity tops out at +300 %.
 */
import type { Beacon, Machine, Module, Recipe } from '../data/schema.ts';
import type { EffectName } from '../data/schema.ts';
import type { GameIndex } from '../data/loader.ts';
import type { BeaconConfig, Transport } from '../graph/types.ts';

/** Lowest multiplier any effect can push a machine to. */
export const MIN_EFFECT_MULTIPLIER = 0.2;
/** Total productivity bonus cap, Factorio 2.0. */
export const MAX_PRODUCTIVITY = 3;
/** Factorio 2.0 pipe throughput over a short run, units/s. Warnings only. */
export const PIPE_THROUGHPUT_PER_SEC = 1000;

export interface Effects {
  speed: number;
  productivity: number;
  consumption: number;
  pollution: number;
}

const ZERO: Effects = { speed: 0, productivity: 0, consumption: 0, pollution: 0 };

/**
 * Whether a module can go in at all.
 *
 * Factorio treats the two restrictions differently. A machine's `allowed_effects`
 * *masks* effects — a speed module works in an oil refinery even though the
 * refinery ignores the module's quality penalty. A recipe with
 * `allow_productivity: false` instead refuses the module outright, which is why
 * you cannot put a productivity module in a recycler. Productivity modules are
 * the only ones carrying a productivity effect, so that single rule covers it.
 */
export function moduleAllowed(module: Module, blocked: ReadonlySet<EffectName>): boolean {
  return !(module.productivity !== 0 && blocked.has('productivity'));
}

function addModule(into: Effects, module: Module, weight: number, blocked: Set<EffectName>): void {
  if (!moduleAllowed(module, blocked)) return;
  if (!blocked.has('speed')) into.speed += module.speed * weight;
  if (!blocked.has('productivity')) into.productivity += module.productivity * weight;
  if (!blocked.has('consumption')) into.consumption += module.consumption * weight;
  if (!blocked.has('pollution')) into.pollution += module.pollution * weight;
}

/** Effects this machine/recipe pairing refuses. */
export function blockedEffects(machine: Machine, recipe: Recipe): Set<EffectName> {
  return new Set<EffectName>([...machine.disallowedEffects, ...recipe.disallowedEffects]);
}

/**
 * Fraction of one beacon's module effects that reaches the machine when `count`
 * beacons cover it. Reads the shipped profile table, holding the last entry for
 * counts past its end.
 */
export function beaconTransmission(beacon: Beacon, count: number): number {
  if (count <= 0) return 0;
  const profile = beacon.profile;
  if (profile.length === 0) return beacon.effectivity / Math.sqrt(count);
  const index = Math.min(Math.round(count), profile.length) - 1;
  return beacon.effectivity * (profile[index] ?? 0);
}

export interface EffectInput {
  machine: Machine;
  recipe: Recipe;
  moduleIds: readonly string[];
  beacons: BeaconConfig | null;
}

/**
 * Sums module and beacon effects, honouring what the machine and the recipe
 * each refuse. Machine base productivity is added separately in
 * `machineRates` because the game applies it regardless of module rules.
 */
export function effectsOf(index: GameIndex, input: EffectInput): Effects {
  const blocked = blockedEffects(input.machine, input.recipe);
  const total: Effects = { ...ZERO };

  for (const moduleId of input.moduleIds) {
    const module = index.modules.get(moduleId);
    if (module) addModule(total, module, 1, blocked);
  }

  const config = input.beacons;
  if (config && config.count > 0) {
    const beacon = index.beacons.get(config.beaconId);
    if (beacon) {
      const beaconBlocked = new Set<EffectName>([...blocked, ...beacon.disallowedEffects]);
      // Each beacon transmits a fraction; `count` of them then stack.
      const weight = beaconTransmission(beacon, config.count) * config.count;
      for (const moduleId of config.modules) {
        const module = index.modules.get(moduleId);
        if (module) addModule(total, module, weight, beaconBlocked);
      }
    }
  }

  return total;
}

export interface MachineRates {
  effects: Effects;
  /** Multiplier on the machine's base crafting speed, clamped. */
  speedMultiplier: number;
  /** Total productivity bonus, machine base included, clamped. */
  productivity: number;
  /** Multiplier on the machine's full-load electricity draw, clamped. */
  consumptionMultiplier: number;
  /** Crafts per second for one machine running continuously. */
  craftsPerSecPerMachine: number;
  /** Electricity for one machine at full load, kW. Scales with utilisation. */
  activePowerKwPerMachine: number;
  /** Idle draw, kW. Paid by every machine built, whether or not it is busy. */
  drainKwPerMachine: number;
  /** Beacon draw attributed to one machine, kW. Beacons run whether or not the
   *  machine does, so this is charged per machine and not scaled by load. */
  beaconPowerKwPerMachine: number;
  pollutionPerMinPerMachine: number;
}

export function machineRates(index: GameIndex, input: EffectInput): MachineRates {
  const effects = effectsOf(index, input);

  const speedMultiplier = Math.max(MIN_EFFECT_MULTIPLIER, 1 + effects.speed);
  const consumptionMultiplier = Math.max(MIN_EFFECT_MULTIPLIER, 1 + effects.consumption);
  // Machine base productivity (foundry, EM plant, biochamber) is part of the
  // machine, not a module, so recipe module rules do not remove it.
  const productivity = Math.min(
    MAX_PRODUCTIVITY,
    Math.max(0, input.machine.baseProductivity + effects.productivity),
  );

  const craftingSpeed = input.machine.craftingSpeed * speedMultiplier;
  const craftsPerSecPerMachine = input.recipe.time > 0 ? craftingSpeed / input.recipe.time : 0;

  const activePowerKwPerMachine = input.machine.energyUsageKw * consumptionMultiplier;

  let beaconPowerKwPerMachine = 0;
  if (input.beacons && input.beacons.count > 0) {
    const beacon = index.beacons.get(input.beacons.beaconId);
    if (beacon) beaconPowerKwPerMachine = beacon.energyUsageKw * input.beacons.count;
  }

  // Pollution rides on power draw, so the consumption multiplier applies on top
  // of the pollution effect itself.
  const pollutionPerMinPerMachine =
    input.machine.pollutionPerMin * (1 + effects.pollution) * consumptionMultiplier;

  return {
    effects,
    speedMultiplier,
    productivity,
    consumptionMultiplier,
    craftsPerSecPerMachine,
    activePowerKwPerMachine,
    drainKwPerMachine: input.machine.drainKw,
    beaconPowerKwPerMachine,
    pollutionPerMinPerMachine,
  };
}

/**
 * Items produced per craft after productivity. The catalyst portion is passed
 * straight through; only the net output is boosted.
 */
export function outputPerCraft(
  port: { amount: number; probability: number; catalyst: number },
  productivity: number,
): number {
  const expected = port.amount * port.probability;
  const catalyst = Math.min(port.catalyst, expected);
  return catalyst + (expected - catalyst) * (1 + productivity);
}

/** Items consumed per craft. Productivity never touches inputs. */
export function inputPerCraft(port: { amount: number; probability: number }): number {
  return port.amount * port.probability;
}

/**
 * What one belt or pipe of this transport carries — the unit a block gets its
 * own copy of. Null for inserters, whose count is already the total the user
 * typed, and for no transport.
 */
export function lineCapacity(transport: Transport, index: GameIndex): number | null {
  if (transport?.kind === 'belt') {
    const belt = index.belts.get(transport.beltId);
    // A belt's rated speed covers both lanes; one lane carries half.
    return belt ? (belt.itemsPerSec * transport.lanes) / 2 : null;
  }
  if (transport?.kind === 'pipe') {
    return index.pipes.get(transport.pipeId)?.fluidPerSec ?? PIPE_THROUGHPUT_PER_SEC;
  }
  return null;
}

/**
 * How many belts or pipes of `capacity` it takes to carry `perSec`. Never
 * fewer than one. The tolerance keeps 90/s on 15/s belts at 6 when the
 * simplex hands back 90.0000001.
 */
export function linesNeeded(perSec: number, capacity: number): number {
  if (!(capacity > 0) || !Number.isFinite(perSec)) return 1;
  return Math.max(1, Math.ceil(perSec / capacity - 1e-6));
}
