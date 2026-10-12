/**
 * One simulation tick, a sixtieth of a second, in the order the game's own
 * update runs closely enough to matter: belts move, then sources fill,
 * machines craft, and inserters swing.
 */
import { ITEM_GAP, LANE_LENGTH } from '../build/entities.ts';
import { createMeter, record } from './meter.ts';
import {
  SOURCE_TOKEN_CAP,
  chestRoom,
  type InserterState,
  type Lane,
  type LaneItem,
  type MachineState,
  type Ref,
  type SplitterState,
  type World,
} from './world.ts';

/**
 * Where an item stops at a dead end or while waiting to side-load: half a gap
 * short of the edge, so a tile holds four items a lane and the next tile back
 * lines up behind them at the usual spacing.
 */
export const LANE_END = LANE_LENGTH - ITEM_GAP / 2;

const endOf = (lane: Lane): number => lane.length - ITEM_GAP / 2;

/** How far either side of a tile's middle an inserter will put an item down. */
export const DROP_SPREAD = 12;

/** How long an inserter at a belt waits for a fuller hand before swinging with what it has. */
export const BELT_PICKUP_PATIENCE = 12;

export function stepWorld(world: World, ticks = 1): void {
  for (let i = 0; i < ticks; i += 1) {
    for (const lane of world.order) moveLane(world, lane);
    for (const splitter of world.splitters) split(world, splitter);
    for (const source of world.sources) fillSource(world, source);
    for (const machine of world.machines) craft(world, machine);
    for (const inserter of world.inserters) swing(world, inserter);
    world.tick += 1;
  }
}

// --- belts -------------------------------------------------------------------

/** Whether an item can be put down at `pos` without crowding a neighbour. */
function roomAt(lane: Lane, pos: number): boolean {
  for (const item of lane.items) {
    if (Math.abs(item.pos - pos) < ITEM_GAP) return false;
  }
  return true;
}

/** Inserts keeping the list front-first. */
function insertSorted(lane: Lane, item: LaneItem): void {
  let i = 0;
  while (i < lane.items.length && lane.items[i]!.pos > item.pos) i += 1;
  lane.items.splice(i, 0, item);
}

function moveLane(world: World, index: number): void {
  const lane = world.lanes[index]!;
  if (lane.items.length === 0) return;
  const next = lane.next;

  // How far the front item may go. Straight on, it may run into the next tile
  // up to a gap behind that tile's last item; a side-load has to wait at the
  // edge for a hole; a dead end stops it at the edge.
  let limit: number;
  if (next === null || (next.kind === 'lane' && next.at !== 0)) limit = endOf(lane);
  else if (next.kind === 'sink') limit = Number.POSITIVE_INFINITY;
  else {
    const rear = world.lanes[next.lane]!.items.at(-1);
    limit = rear ? lane.length + rear.pos - ITEM_GAP : Number.POSITIVE_INFINITY;
  }

  for (const item of lane.items) {
    const moved = Math.min(item.pos + lane.speed, limit);
    if (moved > item.pos) item.pos = moved;
    limit = item.pos - ITEM_GAP;
  }

  // Speeds are below the item gap, so at most one item crosses per tick.
  const front = lane.items[0]!;
  if (next === null) return;
  if (next.kind === 'sink') {
    if (front.pos < lane.length) return;
    lane.items.shift();
    deliverToSink(world, next.sink, front.itemId, 1);
    return;
  }
  const target = world.lanes[next.lane]!;
  if (next.at === 0) {
    if (front.pos < lane.length) return;
    lane.items.shift();
    front.pos -= lane.length;
    target.items.push(front);
  } else if (front.pos >= endOf(lane) && roomAt(target, next.at)) {
    lane.items.shift();
    front.pos = next.at;
    insertSorted(target, front);
  }
}

/**
 * Puts an item on at the back of a lane if the last one has moved a gap
 * along, exactly a gap behind it, so belts whose speed does not divide the
 * gap still fill solid.
 */
function pushRear(lane: Lane, itemId: string): boolean {
  const rear = lane.items.at(-1);
  if (rear && rear.pos < ITEM_GAP) return false;
  const pos = rear ? Math.min(rear.pos - ITEM_GAP, lane.speed - 1) : 0;
  lane.items.push({ itemId, pos });
  return true;
}

/**
 * Moves items from a splitter's inputs to its outputs, lane by lane: a left
 * lane item stays on a left lane. Each lane alternates between the two
 * outputs, and takes from the two inputs in turn, unless a side has
 * priority, in which case that side is tried first and the other only gets
 * what does not fit. A filter sends the filtered item only to the priority
 * output and everything else only to the other.
 */
function split(world: World, splitter: SplitterState): void {
  const { inputPriority, outputPriority, filter } = splitter.entity;
  const sideIndex = (side: 'left' | 'right'): 0 | 1 => (side === 'left' ? 0 : 1);
  for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
    const first: 0 | 1 = inputPriority ? sideIndex(inputPriority) : splitter.nextInput[laneIndex]!;
    for (const from of [first, first === 0 ? 1 : 0] as const) {
      const input = world.lanes[splitter.halves[from].input[laneIndex]!]!;
      const front = input.items[0];
      if (!front || front.pos < endOf(input)) continue;

      let outputs: (0 | 1)[];
      if (outputPriority && filter) {
        const preferred = sideIndex(outputPriority);
        outputs = [front.itemId === filter ? preferred : preferred === 0 ? 1 : 0];
      } else if (outputPriority) {
        const preferred = sideIndex(outputPriority);
        outputs = [preferred, preferred === 0 ? 1 : 0];
      } else {
        const next = splitter.nextOutput[laneIndex]!;
        outputs = [next, next === 0 ? 1 : 0];
      }
      for (const to of outputs) {
        const output = world.lanes[splitter.halves[to].output[laneIndex]!]!;
        if (!pushRear(output, front.itemId)) continue;
        input.items.shift();
        splitter.nextOutput[laneIndex] = to === 0 ? 1 : 0;
        splitter.nextInput[laneIndex] = from === 0 ? 1 : 0;
        break;
      }
    }
  }
}

function fillSource(world: World, source: World['sources'][number]): void {
  const { perSec, itemId } = source.entity;
  if (perSec !== null) {
    source.tokens = Math.min(source.tokens + perSec / 60, SOURCE_TOKEN_CAP);
  }
  if (world.fluidIds.has(itemId)) return;
  // One item a tick, alternating lanes, wherever the back of a lane has room.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (source.tokens < 1) return;
    const lane = world.lanes[source.lanes[source.flip]!]!;
    source.flip = source.flip === 0 ? 1 : 0;
    if (lane.next === null) continue;
    if (!pushRear(lane, itemId)) continue;
    source.tokens -= 1;
    record(source.meter, world.tick);
  }
}

// --- machines ----------------------------------------------------------------

function craft(world: World, machine: MachineState): void {
  if (!machine.recipe) {
    machine.status = 'no-recipe';
    return;
  }
  if (machine.crafting) {
    machine.progress += machine.perTick;
    record(machine.working, world.tick);
    if (machine.progress < 1) return;
    machine.progress -= 1;
    machine.crafting = false;
    finish(world, machine);
  } else {
    machine.progress = 0;
  }

  for (const product of machine.products) {
    if ((machine.outputs.get(product.itemId) ?? 0) >= product.cap) {
      machine.status = 'blocked';
      machine.progress = 0;
      return;
    }
  }
  for (const ingredient of machine.ingredients) {
    if ((machine.inputs.get(ingredient.itemId) ?? 0) < ingredient.amount) {
      machine.status = 'starved';
      machine.progress = 0;
      record(machine.starved, world.tick);
      return;
    }
  }
  for (const ingredient of machine.ingredients) {
    machine.inputs.set(
      ingredient.itemId,
      (machine.inputs.get(ingredient.itemId) ?? 0) - ingredient.amount,
    );
  }
  machine.crafting = true;
  machine.status = 'working';
}

function finish(world: World, machine: MachineState): void {
  record(machine.crafts, world.tick);
  machine.bonus += machine.productivity;
  const bonusCraft = machine.bonus >= 1;
  if (bonusCraft) machine.bonus -= 1;
  for (const product of machine.products) {
    let amount = product.amount;
    if (bonusCraft) amount += product.amount - product.catalyst;
    // Chance outputs and fractional amounts pay out whole items as they add up.
    const owed = (machine.owed.get(product.itemId) ?? 0) + amount;
    const whole = Math.floor(owed + 1e-9);
    machine.owed.set(product.itemId, owed - whole);
    if (whole > 0) {
      machine.outputs.set(product.itemId, (machine.outputs.get(product.itemId) ?? 0) + whole);
    }
  }
}

// --- inserters ---------------------------------------------------------------

/** How many of `itemId` the drop target would take right now. */
function wants(world: World, ref: Ref, itemId: string): number {
  switch (ref.kind) {
    case 'belt':
    case 'underground':
      return world.fluidIds.has(itemId) ? 0 : Number.POSITIVE_INFINITY;
    case 'sink':
      return Number.POSITIVE_INFINITY;
    case 'chest':
      return chestRoom(world, world.chests[ref.index]!, itemId);
    case 'machine': {
      const machine = world.machines[ref.index]!;
      const ingredient = machine.ingredients.find((entry) => entry.itemId === itemId);
      if (!ingredient) return 0;
      return Math.max(0, ingredient.limit - (machine.inputs.get(itemId) ?? 0));
    }
    default:
      return 0;
  }
}

/** Takes up to `max` items the target wants from the pickup side. */
function take(
  world: World,
  inserter: InserterState,
  from: Ref,
  to: Ref,
  max: number,
): { itemId: string; count: number } | null {
  const heldId = inserter.held?.itemId ?? null;
  const acceptable = (itemId: string): boolean =>
    (heldId === null || itemId === heldId) && wants(world, to, itemId) > 0;

  switch (from.kind) {
    case 'belt':
    case 'underground': {
      // One item a tick off a belt, whichever acceptable item is furthest
      // along. On an underground only the part above ground can be reached.
      const lanes =
        from.kind === 'belt' ? world.belts[from.index]!.lanes : world.undergrounds[from.index]!.lanes;
      let best: { lane: Lane; at: number } | null = null;
      for (const laneIndex of lanes) {
        const lane = world.lanes[laneIndex]!;
        const at = lane.items.findIndex(
          (item) => item.pos <= LANE_LENGTH && acceptable(item.itemId),
        );
        if (at === -1) continue;
        if (!best || lane.items[at]!.pos > best.lane.items[best.at]!.pos) best = { lane, at };
      }
      if (!best) return null;
      const [item] = best.lane.items.splice(best.at, 1);
      return { itemId: item!.itemId, count: 1 };
    }
    case 'source': {
      const source = world.sources[from.index]!;
      const { itemId } = source.entity;
      if (!acceptable(itemId)) return null;
      const count = Math.min(max, Math.floor(source.tokens));
      if (count <= 0) return null;
      source.tokens -= count;
      record(source.meter, world.tick, count);
      return { itemId, count };
    }
    case 'machine': {
      const machine = world.machines[from.index]!;
      for (const [itemId, have] of machine.outputs) {
        if (have <= 0 || !acceptable(itemId)) continue;
        const count = Math.min(max, have);
        machine.outputs.set(itemId, have - count);
        return { itemId, count };
      }
      return null;
    }
    case 'chest': {
      const chest = world.chests[from.index]!;
      for (const [itemId, have] of chest.contents) {
        if (have <= 0 || !acceptable(itemId)) continue;
        const count = Math.min(max, have);
        if (have === count) chest.contents.delete(itemId);
        else chest.contents.set(itemId, have - count);
        return { itemId, count };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Puts down as much of the hand as the target accepts; returns how many. */
function give(world: World, inserter: InserterState, to: Ref, itemId: string, count: number): number {
  switch (to.kind) {
    case 'belt':
    case 'underground': {
      // One item a tick, mid-tile on the far lane, when there is a gap for it.
      const lanes =
        to.kind === 'belt' ? world.belts[to.index]!.lanes : world.undergrounds[to.index]!.lanes;
      const lane = world.lanes[lanes[inserter.dropLane]]!;
      // Into whatever gap is passing through the tile, nearest the middle
      // first. Holding out for the exact middle let a second inserter on a
      // busy lane wait out most gaps and starve the machine behind it.
      for (let offset = 0; offset <= DROP_SPREAD; offset += 1) {
        for (const at of offset === 0 ? [LANE_LENGTH / 2] : [LANE_LENGTH / 2 - offset, LANE_LENGTH / 2 + offset]) {
          if (!roomAt(lane, at)) continue;
          insertSorted(lane, { itemId, pos: at });
          return 1;
        }
      }
      return 0;
    }
    case 'sink':
      deliverToSink(world, to.index, itemId, count);
      return count;
    case 'chest': {
      const chest = world.chests[to.index]!;
      const n = Math.min(count, chestRoom(world, chest, itemId));
      if (n > 0) chest.contents.set(itemId, (chest.contents.get(itemId) ?? 0) + n);
      return n;
    }
    case 'machine': {
      // A machine takes the whole hand once it wants any of it; the limit only
      // decides when an inserter picks up, as in the game.
      const machine = world.machines[to.index]!;
      if (!machine.ingredients.some((entry) => entry.itemId === itemId)) return 0;
      machine.inputs.set(itemId, (machine.inputs.get(itemId) ?? 0) + count);
      return count;
    }
    default:
      return 0;
  }
}

function swing(world: World, inserter: InserterState): void {
  // Arriving and acting happen on the same tick, so a full cycle is exactly
  // two half-turns: 26 ticks for a fast inserter, the game's 2.31 swings/s.
  if (inserter.phase === 'to-drop' || inserter.phase === 'to-pickup') {
    inserter.timer -= 1;
    if (inserter.timer > 0) return;
    inserter.phase = inserter.phase === 'to-drop' ? 'drop' : 'pickup';
  }
  const { from, to } = inserter;
  switch (inserter.phase) {
    case 'pickup': {
      if (!from || !to) return;
      const room = inserter.hand - (inserter.held?.count ?? 0);
      if (room > 0) {
        const got = take(world, inserter, from, to, room);
        if (got) {
          inserter.held = {
            itemId: got.itemId,
            count: (inserter.held?.count ?? 0) + got.count,
          };
          inserter.waited = 0;
        } else if (inserter.held) {
          inserter.waited += 1;
        }
      }
      if (!inserter.held) return;
      // Off a belt it waits a moment for a full hand; anywhere else it goes
      // with whatever it got.
      const full = inserter.held.count >= inserter.hand;
      if (full || from.kind !== 'belt' || inserter.waited >= BELT_PICKUP_PATIENCE) {
        inserter.phase = 'to-drop';
        inserter.timer = inserter.spec.swingTicks;
        inserter.waited = 0;
      }
      return;
    }
    case 'drop': {
      const held = inserter.held;
      if (!held) {
        inserter.phase = 'to-pickup';
        inserter.timer = inserter.spec.swingTicks;
        return;
      }
      // Its target was removed mid-swing: hold on until something is built there.
      if (!to) return;
      const given = give(world, inserter, to, held.itemId, held.count);
      if (given > 0) record(inserter.meter, world.tick, given);
      held.count -= given;
      if (held.count > 0) return;
      inserter.held = null;
      inserter.phase = 'to-pickup';
      inserter.timer = inserter.spec.swingTicks;
      return;
    }
    default:
      return;
  }
}

function deliverToSink(world: World, index: number, itemId: string, count: number): void {
  const sink = world.sinks[index]!;
  let meter = sink.meters.get(itemId);
  if (!meter) {
    meter = createMeter();
    sink.meters.set(itemId, meter);
  }
  record(meter, world.tick, count);
  sink.totals.set(itemId, (sink.totals.get(itemId) ?? 0) + count);
}

/** 0 with the arm over the pickup, 1 over the drop. For drawing. */
export function armPosition(inserter: InserterState): number {
  const t = inserter.spec.swingTicks;
  switch (inserter.phase) {
    case 'pickup':
      return 0;
    case 'drop':
      return 1;
    case 'to-drop':
      return 1 - inserter.timer / t;
    case 'to-pickup':
      return inserter.timer / t;
  }
}
