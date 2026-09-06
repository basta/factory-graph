import { assetUrl } from './assetUrl.ts';
import { gameDataSchema } from './schema.ts';
import type {
  Beacon,
  Belt,
  GameData,
  Inserter,
  Item,
  Machine,
  Module,
  Pipe,
  Recipe,
} from './schema.ts';

export const DEFAULT_DATA_SET = '2x1';

/**
 * `GameData` plus the lookup tables every other module wants. Built once at
 * load; nothing mutates it.
 */
export interface GameIndex {
  data: GameData;
  items: ReadonlyMap<string, Item>;
  recipes: ReadonlyMap<string, Recipe>;
  machines: ReadonlyMap<string, Machine>;
  modules: ReadonlyMap<string, Module>;
  beacons: ReadonlyMap<string, Beacon>;
  belts: ReadonlyMap<string, Belt>;
  pipes: ReadonlyMap<string, Pipe>;
  inserters: ReadonlyMap<string, Inserter>;
  /** Recipe ids producing an item, in data order. */
  producersOf: ReadonlyMap<string, string[]>;
  /** Recipe ids consuming an item, in data order. */
  consumersOf: ReadonlyMap<string, string[]>;
}

function byId<T extends { id: string }>(list: readonly T[]): Map<string, T> {
  return new Map(list.map((entry) => [entry.id, entry]));
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

export function indexGameData(data: GameData): GameIndex {
  const producersOf = new Map<string, string[]>();
  const consumersOf = new Map<string, string[]>();
  for (const recipe of data.recipes) {
    for (const out of recipe.outputs) push(producersOf, out.itemId, recipe.id);
    for (const input of recipe.inputs) push(consumersOf, input.itemId, recipe.id);
  }
  return {
    data,
    items: byId(data.items),
    recipes: byId(data.recipes),
    machines: byId(data.machines),
    modules: byId(data.modules),
    beacons: byId(data.beacons),
    belts: byId(data.belts),
    pipes: byId(data.pipes),
    inserters: byId(data.inserters),
    producersOf,
    consumersOf,
  };
}

/** Fetches and zod-validates a vendored data set. */
export async function loadGameData(setId = DEFAULT_DATA_SET): Promise<GameIndex> {
  const response = await fetch(assetUrl(`data/${setId}.json`));
  if (!response.ok) {
    throw new Error(`Could not load data set "${setId}" (${response.status}).`);
  }
  const parsed = gameDataSchema.safeParse(await response.json());
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `Data set "${setId}" is malformed at ${first?.path.join('.') || '<root>'}: ${first?.message}`,
    );
  }
  return indexGameData(parsed.data);
}

/**
 * The machine we pick when a recipe node is created: the highest-ranked
 * producer per the data set's preferred machine order, else the last producer
 * listed (FactorioLab orders producers by tier).
 */
export function defaultMachineFor(index: GameIndex, recipe: Recipe): string | null {
  for (const ranked of index.data.defaults.machineRank) {
    if (recipe.producers.includes(ranked)) return ranked;
  }
  return recipe.producers.at(-1) ?? null;
}
