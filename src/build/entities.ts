import type { GameIndex } from '../data/loader.ts';
import type { Recipe } from '../data/schema.ts';
import type { BuildEntity, Dir, HandSize } from './types.ts';

/**
 * Physical facts the ratio data set does not carry: how many tiles a machine
 * covers and how fast an inserter swings. FactorioLab models throughput, not
 * entities, so these are kept by hand here, from the Factorio 2.0 prototypes
 * (`base/prototypes/entity/entities.lua` and Space Age's equivalent).
 */

/**
 * Footprint in tiles, as width × height facing north. Only machines that are
 * fed by inserters are listed: drills, pumps, boilers, labs and the silo have
 * their own placement rules and are stood in for by sources and sinks.
 */
export const MACHINE_FOOTPRINT: Readonly<Record<string, readonly [number, number]>> = {
  'stone-furnace': [2, 2],
  'steel-furnace': [2, 2],
  'electric-furnace': [3, 3],
  'assembling-machine-1': [3, 3],
  'assembling-machine-2': [3, 3],
  'assembling-machine-3': [3, 3],
  'chemical-plant': [3, 3],
  'oil-refinery': [5, 5],
  centrifuge: [3, 3],
  foundry: [5, 5],
  'electromagnetic-plant': [4, 4],
  'cryogenic-plant': [5, 5],
  biochamber: [3, 3],
  recycler: [2, 4],
  crusher: [2, 3],
};

export interface InserterSpec {
  /** Ticks for half a turn — pickup to drop, or back. */
  swingTicks: number;
  /** Tiles from the inserter to where it picks up and drops. */
  reach: number;
  /** Bulk inserters take the larger hand size. */
  bulk: boolean;
}

/**
 * Rotation speeds are revolutions per tick in the prototypes: burner 0.01,
 * inserter 0.014, long-handed 0.02, fast/bulk/stack 0.04. Half a turn is
 * `0.5 / speed` ticks, which gives the wiki's chest-to-chest figures (0.83/s
 * for a basic inserter, 2.31/s for a fast one) at a hand size of one.
 * Extension time is folded into the swing; it only matters when the reach
 * changes mid-swing, which a straight-through inserter never does.
 */
export const INSERTER_SPECS: Readonly<Record<string, InserterSpec>> = {
  'burner-inserter': { swingTicks: 50, reach: 1, bulk: false },
  inserter: { swingTicks: 36, reach: 1, bulk: false },
  'long-handed-inserter': { swingTicks: 25, reach: 2, bulk: false },
  'fast-inserter': { swingTicks: 13, reach: 1, bulk: false },
  'bulk-inserter': { swingTicks: 13, reach: 1, bulk: true },
  'stack-inserter': { swingTicks: 13, reach: 1, bulk: true },
};

/** Inserter capacity research: none, and all seven levels of it. */
export function handSize(spec: InserterSpec, hands: HandSize): number {
  if (hands === 'base') return spec.bulk ? 2 : 1;
  return spec.bulk ? 12 : 3;
}

/** A steel chest: 48 stacks of whatever goes in it. */
export const CHEST_SLOTS = 48;

/**
 * Belt geometry in sub-tile units. A tile is 32 units long and items sit at
 * least a quarter-tile apart, so a lane holds four items per tile. A
 * transport belt moves 1/32 tile per tick — one unit — and the faster tiers
 * are whole multiples of that, so every position stays an integer and the
 * simulation is exact rather than drifting.
 */
export const LANE_LENGTH = 32;
export const ITEM_GAP = 8;

/** Units per tick: 1 for a transport belt, 4 for turbo. */
export function beltSpeed(itemsPerSec: number): number {
  // Two lanes, each one item per ITEM_GAP units, sixty ticks a second.
  return Math.max(1, Math.round((itemsPerSec / 2) * (ITEM_GAP / 60)));
}

export function footprint(entity: Pick<BuildEntity, 'kind' | 'dir'> & { machineId?: string }): {
  w: number;
  h: number;
} {
  if (entity.kind !== 'machine' || !entity.machineId) return { w: 1, h: 1 };
  const [w, h] = MACHINE_FOOTPRINT[entity.machineId] ?? [3, 3];
  // East and west turn the long side horizontal.
  return entity.dir % 2 === 1 ? { w: h, h: w } : { w, h };
}

export function entityFootprint(entity: BuildEntity): { w: number; h: number } {
  return footprint(entity.kind === 'machine' ? entity : { kind: entity.kind, dir: entity.dir });
}

export function isBuildableMachine(machineId: string): boolean {
  return machineId in MACHINE_FOOTPRINT;
}

/** Whether a recipe can be built at all: some machine that can make it has a footprint. */
export function buildableMachinesFor(recipe: Recipe): string[] {
  return recipe.producers.filter(isBuildableMachine);
}

/**
 * The machine a new building gets: the graph's own preference order, limited
 * to machines we can place, else the best-tier buildable producer.
 */
export function defaultBuildMachine(index: GameIndex, recipe: Recipe): string | null {
  const buildable = buildableMachinesFor(recipe);
  for (const ranked of index.data.defaults.machineRank) {
    if (buildable.includes(ranked)) return ranked;
  }
  return buildable.at(-1) ?? null;
}

export function rotate(dir: Dir, by: number): Dir {
  return (((dir + by) % 4) + 4) % 4 as Dir;
}
