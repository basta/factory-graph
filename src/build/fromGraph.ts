/**
 * "Build this": a recipe node from the graph, laid out as a row of machines
 * ready to simulate. It is a template, not a solver — the standard row a
 * player would put down first, sized from the node's solved numbers — and
 * the simulation is what then says whether it holds up.
 *
 *     y = -3   <<<<<<<<<<<<<<<<<<<<<<<<<<  [3][4]   second belt, ingredients 3 and 4
 *     y = -2   [1][2]>>>>>>>>>>>>>>>>>>>>>          first belt, one lane each
 *     y = -1      i     L  i     L  i     L         inserters, long-handed reach y = -3
 *     y = 0..    +-----++-----++-----+
 *                |  M  ||  M  ||  M  |              the machines, side by side
 *                +-----++-----++-----+
 *     y = h          o      o      o                output inserters
 *     y = h+1  >>>>>>>>>>>>>>>>>>>>>>[sink]         output belt, to a sink with a target
 *
 * Ingredients are fed by sources, one or two to a belt, side-loaded so each
 * has its own lane; fluids are assumed piped, as everywhere in the build.
 */
import type { GameIndex } from '../data/loader.ts';
import { portKey, type RecipeNode } from '../graph/types.ts';
import { newId } from '../graph/store.ts';
import type { SolveResult } from '../solver/types.ts';
import {
  INSERTER_SPECS,
  defaultBuildMachine,
  footprint,
  handSize,
  isBuildableMachine,
} from './entities.ts';
import type { BuildEntity, Dir, HandSize } from './types.ts';

/** An entity before it has an id; distributes over the union, unlike plain `Omit`. */
type Unplaced = BuildEntity extends infer T ? (T extends BuildEntity ? Omit<T, 'id'> : never) : never;

const N: Dir = 0;
const E: Dir = 1;
const S: Dir = 2;
const W: Dir = 3;

/** More than this in one row is a sign the node wants splitting into blocks. */
export const MAX_ROW = 40;

/**
 * Inserters off a belt do worse than chest to chest: they wait for items to
 * come past. Sizing to 80 % of the chest figure leaves room for that.
 */
const BELT_PICKUP_FACTOR = 0.8;

/** Tried slowest first; the first that keeps up is used. */
const INSERTER_LADDER = ['inserter', 'fast-inserter', 'bulk-inserter'] as const;

export type RowLayout =
  | {
      ok: true;
      entities: BuildEntity[];
      machineId: string;
      machines: number;
      /** How many blocks the node is built as; the row is one of them. */
      blocks: number;
      /** Things the simulation is likely to show, said up front. */
      notes: string[];
    }
  | { ok: false; reason: string };

/** Items per second one inserter of this kind moves at this research level. */
export function inserterRate(inserterId: string, hands: HandSize): number {
  const spec = INSERTER_SPECS[inserterId];
  if (!spec) return 0;
  return (handSize(spec, hands) * 60 * BELT_PICKUP_FACTOR) / (2 * spec.swingTicks);
}

/** The slowest inserter, and how many of it, to move `perSec`. */
export function insertersFor(
  perSec: number,
  hands: HandSize,
  slots: number,
): { inserterId: string; count: number; enough: boolean } {
  for (const inserterId of INSERTER_LADDER) {
    if (inserterRate(inserterId, hands) >= perSec) return { inserterId, count: 1, enough: true };
  }
  // Nothing keeps up alone: as many of the fastest as there is room for.
  const fastest = INSERTER_LADDER.at(-1)!;
  const needed = Math.ceil(perSec / inserterRate(fastest, hands));
  const count = Math.max(1, Math.min(needed, slots));
  return { inserterId: fastest, count, enough: count >= needed };
}

interface Options {
  /** The plan's belt; null picks the slowest tier that carries the load. */
  beltId: string | null;
  hands: HandSize;
  /** Where the first machine's top-left corner goes. */
  origin: { x: number; y: number };
}

export function layoutRow(
  index: GameIndex,
  node: RecipeNode,
  result: SolveResult | null,
  options: Options,
): RowLayout {
  const recipe = index.recipes.get(node.recipeId);
  if (!recipe) return { ok: false, reason: 'That recipe is not in the data set.' };
  const machineId = isBuildableMachine(node.machineId)
    ? node.machineId
    : defaultBuildMachine(index, recipe);
  const machine = machineId ? index.machines.get(machineId) : undefined;
  if (!machineId || !machine) {
    return {
      ok: false,
      reason: `${recipe.name} needs a machine the build view cannot place yet. Use a source instead.`,
    };
  }

  const solved = result?.status === 'ok' ? result.nodes[node.id] : undefined;
  const blocks = Math.max(1, solved?.blocks ?? 1);
  const machines = Math.max(1, Math.ceil((solved?.machinesCeil ?? 1) / blocks - 1e-9));
  if (machines > MAX_ROW) {
    return {
      ok: false,
      reason: `That is ${machines} machines in one row. Split the node into blocks first, and each block gets its own row.`,
    };
  }

  const isFluid = (itemId: string): boolean => index.items.get(itemId)?.isFluid ?? false;
  const ingredients = recipe.inputs.filter((port) => !isFluid(port.itemId));
  const products = recipe.outputs.filter((port) => !isFluid(port.itemId));
  if (ingredients.length > 4) {
    return { ok: false, reason: `${recipe.name} has more ingredients than the row template has lanes for.` };
  }

  const notes: string[] = [];
  if (node.modules.some((id) => id !== '') || node.beacons) {
    notes.push('Modules and beacons are not simulated, so this row runs slower than the plan expects.');
  }
  if (recipe.inputs.length + recipe.outputs.length > ingredients.length + products.length) {
    notes.push('Fluids are assumed piped.');
  }

  // Rates at full speed in the simulation, which knows no modules.
  // Productivity adds outputs, not crafts, so it only enters the output side.
  const craftsPerSec = machine.craftingSpeed / Math.max(recipe.time, 1e-9);
  const perMachine = (amount: number): number => amount * craftsPerSec;
  const outPerMachine = products.reduce(
    (sum, port) => sum + port.amount * port.probability * craftsPerSec * (1 + machine.baseProductivity),
    0,
  );

  const { w, h } = footprint({ kind: 'machine', dir: N, machineId });
  const width = machines * w;
  const { x: ox, y: oy } = options.origin;
  const entities: BuildEntity[] = [];
  const add = (entity: Unplaced): void => {
    entities.push({ ...entity, id: newId('b') } as BuildEntity);
  };

  // Belts: the plan's tier, or the slowest that carries the busiest lane.
  // Two ingredients share a belt a lane each, so each gets half of it; one
  // ingredient alone has both lanes.
  const firstBelt = ingredients.slice(0, 2);
  const secondBelt = ingredients.slice(2);
  const rowRate = (port: (typeof ingredients)[number]): number =>
    port.amount * port.probability * craftsPerSec * machines;
  const shares: { itemId: string; perSec: number; share: number }[] = [
    ...[firstBelt, secondBelt].flatMap((ports) =>
      ports.map((port) => ({ itemId: port.itemId, perSec: rowRate(port), share: 1 / ports.length })),
    ),
    ...(products.length > 0 ? [{ itemId: products[0]!.itemId, perSec: outPerMachine * machines, share: 1 }] : []),
  ];
  // Belt capacity each lane load would need, as a whole belt.
  const busiest = Math.max(0, ...shares.map((entry) => entry.perSec / entry.share));
  const beltId =
    options.beltId ??
    index.data.belts.find((belt) => belt.itemsPerSec >= busiest)?.id ??
    index.data.belts.at(-1)?.id ??
    'transport-belt';
  const capacity = index.belts.get(beltId)?.itemsPerSec ?? 15;
  if (busiest > capacity * 1.0001) {
    const worst = shares.reduce((a, b) => (b.perSec / b.share > a.perSec / a.share ? b : a));
    const item = index.items.get(worst.itemId)?.name.toLowerCase() ?? worst.itemId;
    const room = capacity * worst.share;
    const split = Math.ceil(busiest / capacity) * blocks;
    notes.push(
      `The row needs ${Math.round(worst.perSec * 10) / 10}/s of ${item} where its ${worst.share < 1 ? 'lane' : 'belt'} carries ${Math.round(room * 10) / 10}/s. ` +
        `Split the node into ${split} blocks, or use a faster belt.`,
    );
  }
  const belt = (x: number, y: number, dir: Dir): void => add({ kind: 'belt', x, y, dir, beltId });
  const source = (x: number, y: number, dir: Dir, itemId: string): void =>
    add({ kind: 'source', x, y, dir, itemId, perSec: null });

  // First belt, eastbound along y = -2, fed from the west end.
  const y1 = oy - 2;
  if (firstBelt.length > 0) {
    for (let x = ox - 1; x < ox + width; x += 1) belt(x, y1, E);
    if (firstBelt.length === 1) {
      source(ox - 2, y1, E, firstBelt[0]!.itemId);
    } else {
      // A belt behind keeps the first tile straight, so both sources side-load:
      // from the north onto the left lane, from the south onto the right.
      belt(ox - 2, y1, E);
      source(ox - 1, y1 - 1, S, firstBelt[0]!.itemId);
      source(ox - 1, y1 + 1, N, firstBelt[1]!.itemId);
    }
  }

  // Second belt, westbound along y = -3, fed from the east end so its
  // sources stay clear of the first belt's.
  const y2 = oy - 3;
  if (secondBelt.length > 0) {
    const east = ox + width + 1;
    for (let x = ox; x <= east; x += 1) belt(x, y2, W);
    if (secondBelt.length === 1) {
      source(east + 1, y2, W, secondBelt[0]!.itemId);
    } else {
      belt(east + 1, y2, W);
      source(east, y2 - 1, S, secondBelt[0]!.itemId);
      source(east, y2 + 1, N, secondBelt[1]!.itemId);
    }
  }

  // Inserters along the top: normal ones from the left for the first belt,
  // long-handed from the right for the second.
  const firstNeed = firstBelt.reduce((sum, port) => sum + perMachine(port.amount * port.probability), 0);
  const secondNeed = secondBelt.reduce((sum, port) => sum + perMachine(port.amount * port.probability), 0);
  const longSlots = secondBelt.length > 0 ? 1 : 0;
  const firstPick = firstBelt.length > 0 ? insertersFor(firstNeed, options.hands, w - longSlots) : null;
  const longRate = inserterRate('long-handed-inserter', options.hands);
  if (firstPick && !firstPick.enough) {
    notes.push('Even bulk inserters cannot feed these machines from one belt; expect them to starve.');
  }
  if (secondBelt.length > 0 && longRate < secondNeed) {
    notes.push('Long-handed inserters are too slow for the second belt; expect starving.');
  }
  const outPick = products.length > 0 ? insertersFor(outPerMachine, options.hands, w) : null;
  if (outPick && !outPick.enough) notes.push('The output inserters cannot keep up with these machines.');

  for (let m = 0; m < machines; m += 1) {
    const mx = ox + m * w;
    add({ kind: 'machine', x: mx, y: oy, dir: N, machineId, recipeId: recipe.id });
    for (let k = 0; k < (firstPick?.count ?? 0); k += 1) {
      add({ kind: 'inserter', x: mx + k, y: oy - 1, dir: S, inserterId: firstPick!.inserterId });
    }
    if (secondBelt.length > 0) {
      add({ kind: 'inserter', x: mx + w - 1, y: oy - 1, dir: S, inserterId: 'long-handed-inserter' });
    }
    for (let k = 0; k < (outPick?.count ?? 0); k += 1) {
      // From the middle outwards, so one inserter sits centred.
      const offset = Math.floor((w - 1) / 2) + (k % 2 === 0 ? k / 2 : -(k + 1) / 2);
      add({ kind: 'inserter', x: mx + offset, y: oy + h, dir: S, inserterId: outPick!.inserterId });
    }
  }

  // Output belt along the bottom, to a sink that knows what the plan expects.
  if (products.length > 0) {
    const yo = oy + h + 1;
    for (let x = ox; x < ox + width; x += 1) belt(x, yo, E);
    const main = products[0]!;
    const planned = result?.status === 'ok' ? result.ports[portKey(node.id, 'out', main.itemId)]?.produced : undefined;
    add({
      kind: 'sink',
      x: ox + width,
      y: yo,
      dir: N,
      target: planned !== undefined && planned > 0 ? { itemId: main.itemId, perSec: planned / blocks } : null,
    });
  }

  return { ok: true, entities, machineId, machines, blocks, notes };
}

/** Where a new row goes: clear of everything already built, to its right. */
export function rowOrigin(existing: readonly BuildEntity[]): { x: number; y: number } {
  if (existing.length === 0) return { x: 0, y: 0 };
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const entity of existing) {
    const { w } = footprint(entity.kind === 'machine' ? entity : { kind: entity.kind, dir: entity.dir });
    maxX = Math.max(maxX, entity.x + w - 1);
    minY = Math.min(minY, entity.y);
  }
  // Room on the left for the feeding sources, and the second belt's row above.
  return { x: maxX + 5, y: minY + 4 };
}
