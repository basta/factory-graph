/**
 * The simulator's runtime state, compiled from a `Build`.
 *
 * A build is the layout; a world is that layout with things in it — items on
 * belts, ingredients in machines, an inserter halfway through its swing.
 * Editing the build while the simulation runs recompiles the world and
 * carries every entity's state across by id, so a design can be changed
 * without draining it and starting over.
 *
 * Belts are modelled lane by lane. Each tile has a left and a right lane,
 * each lane is a list of items with integer positions along the tile, and a
 * lane links to the lane it empties into: straight on and round a curve the
 * lane is kept, a side-load puts both lanes onto the near lane of the belt it
 * meets, half way along the tile. That is the whole of Factorio's belt
 * behaviour that decides throughput, and none of the rendering detail that
 * does not.
 */
import type { GameIndex } from '../data/loader.ts';
import type { Machine, Recipe } from '../data/schema.ts';
import {
  CHEST_SLOTS,
  INSERTER_SPECS,
  LANE_LENGTH,
  beltSpeed,
  entityFootprint,
  handSize,
  type InserterSpec,
} from '../build/entities.ts';
import {
  leftOf,
  opposite,
  rightOf,
  step,
  tileKey,
  type BeltEntity,
  type Build,
  type BuildEntity,
  type ChestEntity,
  type Dir,
  type HandSize,
  type InserterEntity,
  type MachineEntity,
  type SinkEntity,
  type SourceEntity,
  type Tile,
} from '../build/types.ts';
import { createMeter, type Meter } from './meter.ts';

export interface LaneItem {
  itemId: string;
  /** 0 at the tile's back edge, `LANE_LENGTH` at its front. */
  pos: number;
}

export type LaneLink =
  /** `at` is where items land: 0 straight on or round a curve, mid-tile on a side-load. */
  | { kind: 'lane'; lane: number; at: number }
  | { kind: 'sink'; sink: number };

export interface Lane {
  /** Front first: the item nearest the end of the tile is `items[0]`. */
  items: LaneItem[];
  /** Units per tick. */
  speed: number;
  next: LaneLink | null;
}

/** Lane 0 is on the left looking along the belt, lane 1 on the right. */
export type LanePair = [number, number];

export interface BeltState {
  entity: BeltEntity;
  lanes: LanePair;
  /**
   * The way items are travelling when they come in. Equal to `entity.dir` on
   * a straight belt; on a curve it is the feeding belt's direction.
   */
  entry: Dir;
}

export interface SourceState {
  entity: SourceEntity;
  /** A source fills its own two lanes, which empty into the belt it faces. */
  lanes: LanePair;
  /** Items it may still hand out, topped up at `perSec`. Infinite when unlimited. */
  tokens: number;
  /** Alternates the lane each new item goes on. */
  flip: number;
  meter: Meter;
}

export type MachineStatus = 'working' | 'starved' | 'blocked' | 'no-recipe';

export interface Ingredient {
  itemId: string;
  amount: number;
  /** Inserters stop adding once the machine holds this many. */
  limit: number;
}

export interface Product {
  itemId: string;
  /** Expected amount per craft, chance already applied. */
  amount: number;
  /** The part productivity does not multiply. */
  catalyst: number;
  /** The machine stops when it is holding this many and nobody takes them. */
  cap: number;
}

export interface MachineState {
  entity: MachineEntity;
  machine: Machine | null;
  recipe: Recipe | null;
  ingredients: Ingredient[];
  products: Product[];
  /** Fluid ingredients and products. Pipes are not simulated; these are assumed. */
  fluids: string[];
  inputs: Map<string, number>;
  outputs: Map<string, number>;
  /** Fractional products carried to the next craft, for chance and productivity. */
  owed: Map<string, number>;
  crafting: boolean;
  /** Fraction of the current craft done. */
  progress: number;
  /** Craft fraction per tick. */
  perTick: number;
  productivity: number;
  /** Productivity bar: a bonus craft is paid out every time it passes 1. */
  bonus: number;
  status: MachineStatus;
  /** Ticks spent crafting. */
  working: Meter;
  crafts: Meter;
}

export type InserterPhase = 'pickup' | 'to-drop' | 'drop' | 'to-pickup';

export interface InserterState {
  entity: InserterEntity;
  spec: InserterSpec;
  /** Items per swing at the build's research level. */
  hand: number;
  held: { itemId: string; count: number } | null;
  phase: InserterPhase;
  /** Ticks left in a swing. */
  timer: number;
  /** Ticks spent at a belt waiting for a full hand. */
  waited: number;
  from: Ref | null;
  to: Ref | null;
  /** Which lane of the belt it drops onto: the far one. */
  dropLane: 0 | 1;
  meter: Meter;
}

export interface ChestState {
  entity: ChestEntity;
  contents: Map<string, number>;
}

export interface SinkState {
  entity: SinkEntity;
  meters: Map<string, Meter>;
  totals: Map<string, number>;
}

export type Ref =
  | { kind: 'belt'; index: number }
  | { kind: 'source'; index: number }
  | { kind: 'machine'; index: number }
  | { kind: 'inserter'; index: number }
  | { kind: 'chest'; index: number }
  | { kind: 'sink'; index: number };

export interface World {
  /** Ticks run so far. Sixty to the second. */
  tick: number;
  hands: HandSize;
  lanes: Lane[];
  /** Lanes downstream first, so a lane moves into space its successor has just made. */
  order: number[];
  belts: BeltState[];
  sources: SourceState[];
  machines: MachineState[];
  inserters: InserterState[];
  chests: ChestState[];
  sinks: SinkState[];
  /** Every covered tile, keyed by `tileKey`. */
  tiles: Map<string, Ref>;
  byId: Map<string, Ref>;
  /** Item ids that are fluids, which never go on a belt. */
  fluidIds: ReadonlySet<string>;
  stackSizes: ReadonlyMap<string, number>;
}

/** The burst a rate-limited source may save up, so a bulk inserter is not starved by it. */
export const SOURCE_TOKEN_CAP = 16;

/**
 * Ingredients an inserter will keep topping up: two crafts' worth, or enough
 * for a little over a second of crafting for recipes faster than that. The
 * game's rule is in the same spirit and close enough not to change a
 * design's verdict.
 */
function ingredientLimit(amount: number, craftTicks: number): number {
  const crafts = Math.max(2, Math.ceil(70 / Math.max(craftTicks, 1)) + 1);
  return Math.max(1, Math.ceil(amount * crafts));
}

function newMachine(entity: MachineEntity, index: GameIndex): MachineState {
  const machine = index.machines.get(entity.machineId) ?? null;
  const recipe = entity.recipeId ? (index.recipes.get(entity.recipeId) ?? null) : null;
  const usable = machine && recipe && recipe.producers.includes(machine.id) ? recipe : null;
  const craftTicks = usable && machine ? (usable.time * 60) / machine.craftingSpeed : 1;
  const isFluid = (itemId: string): boolean => index.items.get(itemId)?.isFluid ?? false;
  const fluids: string[] = [];
  const ingredients: Ingredient[] = [];
  const products: Product[] = [];
  for (const input of usable?.inputs ?? []) {
    if (isFluid(input.itemId)) fluids.push(input.itemId);
    else {
      const amount = input.amount * input.probability;
      ingredients.push({ itemId: input.itemId, amount, limit: ingredientLimit(amount, craftTicks) });
    }
  }
  for (const output of usable?.outputs ?? []) {
    if (isFluid(output.itemId)) {
      fluids.push(output.itemId);
      continue;
    }
    const amount = output.amount * output.probability;
    const stack = index.items.get(output.itemId)?.stackSize ?? 50;
    products.push({
      itemId: output.itemId,
      amount,
      catalyst: Math.min(output.catalyst, amount),
      cap: Math.max(stack, 2 * Math.ceil(amount)),
    });
  }
  return {
    entity,
    machine,
    recipe: usable,
    ingredients,
    products,
    fluids,
    inputs: new Map(),
    outputs: new Map(),
    owed: new Map(),
    crafting: false,
    progress: 0,
    perTick: usable ? 1 / Math.max(craftTicks, 1e-9) : 0,
    productivity: machine?.baseProductivity ?? 0,
    bonus: 0,
    status: usable ? 'starved' : 'no-recipe',
    working: createMeter(),
    crafts: createMeter(),
  };
}

function newInserter(entity: InserterEntity, hands: HandSize): InserterState {
  const spec = INSERTER_SPECS[entity.inserterId] ?? INSERTER_SPECS.inserter!;
  return {
    entity,
    spec,
    hand: handSize(spec, hands),
    held: null,
    phase: 'pickup',
    timer: 0,
    waited: 0,
    from: null,
    to: null,
    dropLane: 1,
    meter: createMeter(),
  };
}

/** Each tile an entity covers. */
export function coveredTiles(entity: BuildEntity): Tile[] {
  const { w, h } = entityFootprint(entity);
  const tiles: Tile[] = [];
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) tiles.push({ x: entity.x + dx, y: entity.y + dy });
  }
  return tiles;
}

export function compileWorld(build: Build, index: GameIndex, previous: World | null = null): World {
  const fluidIds = new Set(index.data.items.filter((item) => item.isFluid).map((item) => item.id));
  const stackSizes = new Map(
    index.data.items.map((item) => [item.id, item.stackSize ?? 50] as const),
  );
  const world: World = {
    tick: previous?.tick ?? 0,
    hands: build.hands,
    lanes: [],
    order: [],
    belts: [],
    sources: [],
    machines: [],
    inserters: [],
    chests: [],
    sinks: [],
    tiles: new Map(),
    byId: new Map(),
    fluidIds,
    stackSizes,
  };

  const newLanes = (): LanePair => {
    world.lanes.push({ items: [], speed: 1, next: null }, { items: [], speed: 1, next: null });
    return [world.lanes.length - 2, world.lanes.length - 1];
  };

  // --- place -----------------------------------------------------------------
  for (const entity of build.entities) {
    const tiles = coveredTiles(entity);
    // The store refuses overlaps; a hand-edited file might not.
    if (tiles.some((tile) => world.tiles.has(tileKey(tile.x, tile.y)))) continue;
    if (world.byId.has(entity.id)) continue;

    let ref: Ref;
    switch (entity.kind) {
      case 'belt':
        world.belts.push({ entity, lanes: newLanes(), entry: entity.dir });
        ref = { kind: 'belt', index: world.belts.length - 1 };
        break;
      case 'source':
        world.sources.push({
          entity,
          lanes: newLanes(),
          tokens: entity.perSec === null ? Number.POSITIVE_INFINITY : 0,
          flip: 0,
          meter: createMeter(),
        });
        ref = { kind: 'source', index: world.sources.length - 1 };
        break;
      case 'machine':
        world.machines.push(newMachine(entity, index));
        ref = { kind: 'machine', index: world.machines.length - 1 };
        break;
      case 'inserter':
        world.inserters.push(newInserter(entity, build.hands));
        ref = { kind: 'inserter', index: world.inserters.length - 1 };
        break;
      case 'chest':
        world.chests.push({ entity, contents: new Map() });
        ref = { kind: 'chest', index: world.chests.length - 1 };
        break;
      case 'sink':
        world.sinks.push({ entity, meters: new Map(), totals: new Map() });
        ref = { kind: 'sink', index: world.sinks.length - 1 };
        break;
    }
    world.byId.set(entity.id, ref);
    for (const tile of tiles) world.tiles.set(tileKey(tile.x, tile.y), ref);
  }

  const at = (tile: Tile): Ref | undefined => world.tiles.get(tileKey(tile.x, tile.y));

  /** A belt or source on `tile` facing `dir`, i.e. one that moves items that way. */
  const conveyorFacing = (tile: Tile, dir: Dir): boolean => {
    const ref = at(tile);
    if (ref?.kind === 'belt') return world.belts[ref.index]!.entity.dir === dir;
    if (ref?.kind === 'source') return world.sources[ref.index]!.entity.dir === dir;
    return false;
  };

  // A belt curves when it is fed from exactly one side and not from behind;
  // otherwise it runs straight and anything at its sides side-loads.
  for (const belt of world.belts) {
    const { dir } = belt.entity;
    const behind = conveyorFacing(step(belt.entity, opposite(dir)), dir);
    if (behind) continue;
    const fromLeft = conveyorFacing(step(belt.entity, leftOf(dir)), rightOf(dir));
    const fromRight = conveyorFacing(step(belt.entity, rightOf(dir)), leftOf(dir));
    if (fromLeft !== fromRight) belt.entry = fromLeft ? rightOf(dir) : leftOf(dir);
  }

  // --- link ------------------------------------------------------------------
  const link = (from: Tile, dir: Dir, lanes: LanePair): void => {
    const ahead = at(step(from, dir));
    for (const lane of lanes) world.lanes[lane]!.next = null;
    if (!ahead) return;
    if (ahead.kind === 'sink') {
      for (const lane of lanes) world.lanes[lane]!.next = { kind: 'sink', sink: ahead.index };
      return;
    }
    if (ahead.kind !== 'belt') return;
    const target = world.belts[ahead.index]!;
    const targetDir = target.entity.dir;
    if (targetDir === opposite(dir)) return;
    if (targetDir === dir || target.entry === dir) {
      // Straight on, or round a curve this conveyor is the reason for.
      world.lanes[lanes[0]]!.next = { kind: 'lane', lane: target.lanes[0], at: 0 };
      world.lanes[lanes[1]]!.next = { kind: 'lane', lane: target.lanes[1], at: 0 };
      return;
    }
    // Side-load: everything goes onto the target lane nearest this conveyor.
    const side = opposite(dir);
    const lane = side === leftOf(targetDir) ? target.lanes[0] : target.lanes[1];
    for (const own of lanes) world.lanes[own]!.next = { kind: 'lane', lane, at: LANE_LENGTH / 2 };
  };

  for (const belt of world.belts) {
    const speed = beltSpeed(index.belts.get(belt.entity.beltId)?.itemsPerSec ?? 15);
    for (const lane of belt.lanes) world.lanes[lane]!.speed = speed;
    link(belt.entity, belt.entity.dir, belt.lanes);
  }
  for (const source of world.sources) {
    // A source runs at the speed of the belt it fills, so it can saturate it
    // and no more.
    const ahead = at(step(source.entity, source.entity.dir));
    const speed =
      ahead?.kind === 'belt' ? world.lanes[world.belts[ahead.index]!.lanes[0]]!.speed : 4;
    for (const lane of source.lanes) world.lanes[lane]!.speed = speed;
    link(source.entity, source.entity.dir, source.lanes);
  }

  world.order = downstreamFirst(world.lanes);

  // --- inserters ---------------------------------------------------------------
  const pickupKinds = new Set(['belt', 'source', 'machine', 'chest']);
  const dropKinds = new Set(['belt', 'machine', 'chest', 'sink']);
  for (const inserter of world.inserters) {
    const { dir } = inserter.entity;
    const from = at(step(inserter.entity, opposite(dir), inserter.spec.reach));
    const to = at(step(inserter.entity, dir, inserter.spec.reach));
    inserter.from = from && pickupKinds.has(from.kind) ? from : null;
    inserter.to = to && dropKinds.has(to.kind) ? to : null;
    if (to?.kind === 'belt') {
      // Inserters drop on the far lane. From behind or in front of the belt
      // there is no far side, and the game uses the right-hand lane.
      const beltDir = world.belts[to.index]!.entity.dir;
      inserter.dropLane = dir === leftOf(beltDir) ? 0 : 1;
    }
  }

  if (previous) carryOver(previous, world);
  return world;
}

/**
 * Orders lanes so each comes after the lane it empties into. Every lane has
 * at most one successor, so this is a walk down each chain; a belt loop has
 * no downstream end and is broken wherever the walk entered it.
 */
function downstreamFirst(lanes: Lane[]): number[] {
  const state = new Uint8Array(lanes.length);
  const order: number[] = [];
  for (let start = 0; start < lanes.length; start += 1) {
    if (state[start] !== 0) continue;
    const path: number[] = [];
    let current: number | null = start;
    while (current !== null && state[current] === 0) {
      state[current] = 1;
      path.push(current);
      const next: LaneLink | null = lanes[current]!.next;
      current = next?.kind === 'lane' ? next.lane : null;
    }
    for (let i = path.length - 1; i >= 0; i -= 1) {
      order.push(path[i]!);
      state[path[i]!] = 2;
    }
  }
  return order;
}

/** Moves what was in the old world into the entities that are still there. */
function carryOver(previous: World, world: World): void {
  world.tick = previous.tick;
  const old = <K extends Ref['kind']>(id: string, kind: K): number | null => {
    const ref = previous.byId.get(id);
    return ref && ref.kind === kind ? ref.index : null;
  };

  const copyLanes = (from: LanePair, to: LanePair): void => {
    for (let i = 0; i < 2; i += 1) {
      world.lanes[to[i]!]!.items = previous.lanes[from[i]!]!.items.map((item) => ({ ...item }));
    }
  };

  for (const belt of world.belts) {
    const was = old(belt.entity.id, 'belt');
    if (was !== null) copyLanes(previous.belts[was]!.lanes, belt.lanes);
  }
  for (const source of world.sources) {
    const was = old(source.entity.id, 'source');
    if (was === null) continue;
    const before = previous.sources[was]!;
    copyLanes(before.lanes, source.lanes);
    source.meter = before.meter;
    source.flip = before.flip;
    if (before.entity.itemId !== source.entity.itemId) {
      for (const lane of source.lanes) world.lanes[lane]!.items = [];
    }
    if (source.entity.perSec !== null && Number.isFinite(before.tokens)) source.tokens = before.tokens;
  }
  for (const machine of world.machines) {
    const was = old(machine.entity.id, 'machine');
    if (was === null) continue;
    const before = previous.machines[was]!;
    machine.working = before.working;
    machine.crafts = before.crafts;
    // A different recipe or machine starts empty; the old contents would be
    // the wrong items or the wrong progress.
    if (before.recipe?.id !== machine.recipe?.id || before.machine?.id !== machine.machine?.id) continue;
    machine.inputs = new Map(before.inputs);
    machine.outputs = new Map(before.outputs);
    machine.owed = new Map(before.owed);
    machine.crafting = before.crafting;
    machine.progress = before.progress;
    machine.bonus = before.bonus;
    machine.status = before.status;
  }
  for (const inserter of world.inserters) {
    const was = old(inserter.entity.id, 'inserter');
    if (was === null) continue;
    const before = previous.inserters[was]!;
    inserter.meter = before.meter;
    if (before.entity.dir !== inserter.entity.dir) continue;
    inserter.held = before.held ? { ...before.held } : null;
    inserter.phase = before.phase;
    inserter.timer = Math.min(before.timer, inserter.spec.swingTicks);
    inserter.waited = before.waited;
  }
  for (const chest of world.chests) {
    const was = old(chest.entity.id, 'chest');
    if (was !== null) chest.contents = new Map(previous.chests[was]!.contents);
  }
  for (const sink of world.sinks) {
    const was = old(sink.entity.id, 'sink');
    if (was === null) continue;
    sink.meters = previous.sinks[was]!.meters;
    sink.totals = previous.sinks[was]!.totals;
  }
}

/** Whatever occupies a tile, as the build entity. */
export function entityAt(world: World, tile: Tile): BuildEntity | null {
  const ref = world.tiles.get(tileKey(tile.x, tile.y));
  return ref ? refEntity(world, ref) : null;
}

export function refEntity(world: World, ref: Ref): BuildEntity {
  switch (ref.kind) {
    case 'belt':
      return world.belts[ref.index]!.entity;
    case 'source':
      return world.sources[ref.index]!.entity;
    case 'machine':
      return world.machines[ref.index]!.entity;
    case 'inserter':
      return world.inserters[ref.index]!.entity;
    case 'chest':
      return world.chests[ref.index]!.entity;
    case 'sink':
      return world.sinks[ref.index]!.entity;
  }
}

/** Steel-chest capacity check: whole stacks, the way the game counts slots. */
export function chestRoom(world: World, chest: ChestState, itemId: string): number {
  let slots = 0;
  for (const [id, count] of chest.contents) {
    slots += Math.ceil(count / (world.stackSizes.get(id) ?? 50));
  }
  const stack = world.stackSizes.get(itemId) ?? 50;
  const held = chest.contents.get(itemId) ?? 0;
  // Room left in this item's partly-filled stack, plus every empty slot.
  const partial = held % stack === 0 ? 0 : stack - (held % stack);
  return partial + Math.max(0, CHEST_SLOTS - slots) * stack;
}
