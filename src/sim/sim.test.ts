import { describe, expect, it } from 'vitest';
import { testGameData } from '../solver/fixtures.ts';
import type { Build, BuildEntity, Dir, HandSize } from '../build/types.ts';
import { meterRate } from './meter.ts';
import { stepWorld } from './step.ts';
import { compileWorld, type World } from './world.ts';

const index = testGameData();
const N: Dir = 0;
const E: Dir = 1;
const S: Dir = 2;

let ids = 0;
const id = (): string => `t${(ids += 1)}`;

const belt = (x: number, y: number, dir: Dir, beltId = 'transport-belt'): BuildEntity => ({
  id: id(), kind: 'belt', x, y, dir, beltId,
});
const source = (x: number, y: number, dir: Dir, itemId: string, perSec: number | null = null): BuildEntity => ({
  id: id(), kind: 'source', x, y, dir, itemId, perSec,
});
const sink = (x: number, y: number): BuildEntity => ({ id: id(), kind: 'sink', x, y, dir: N });
const inserter = (x: number, y: number, dir: Dir, inserterId = 'inserter'): BuildEntity => ({
  id: id(), kind: 'inserter', x, y, dir, inserterId,
});
const machine = (x: number, y: number, machineId: string, recipeId: string): BuildEntity => ({
  id: id(), kind: 'machine', x, y, dir: N, machineId, recipeId,
});

function run(entities: BuildEntity[], seconds: number, hands: HandSize = 'researched'): World {
  const build: Build = { entities, hands };
  const world = compileWorld(build, index);
  stepWorld(world, seconds * 60);
  return world;
}

/** Items per second into every sink, over the meter's window. */
function sinkRate(world: World, itemId: string): number {
  let total = 0;
  for (const s of world.sinks) {
    const meter = s.meters.get(itemId);
    if (meter) total += meterRate(meter, world.tick);
  }
  return total;
}

/** A straight eastbound line from a source to a sink. */
function line(length: number, beltId: string, itemId = 'iron-plate'): BuildEntity[] {
  const entities: BuildEntity[] = [source(0, 0, E, itemId)];
  for (let x = 1; x <= length; x += 1) entities.push(belt(x, 0, E, beltId));
  entities.push(sink(length + 1, 0));
  return entities;
}

describe('belts', () => {
  it.each([
    ['transport-belt', 15],
    ['fast-transport-belt', 30],
    ['express-transport-belt', 45],
    ['turbo-transport-belt', 60],
  ])('a full %s carries %d items/s', (beltId, perSec) => {
    const world = run(line(20, beltId), 60);
    expect(sinkRate(world, 'iron-plate')).toBeCloseTo(perSec, 1);
  });

  it('packs four items per lane per tile when the end is blocked', () => {
    const entities: BuildEntity[] = [source(0, 0, E, 'iron-plate')];
    for (let x = 1; x <= 5; x += 1) entities.push(belt(x, 0, E));
    const world = run(entities, 20);
    for (const b of world.belts) {
      expect(world.lanes[b.lanes[0]]!.items).toHaveLength(4);
      expect(world.lanes[b.lanes[1]]!.items).toHaveLength(4);
    }
  });

  it('keeps both lanes round a curve', () => {
    // East into a southbound belt with nothing behind it: a curve.
    const entities: BuildEntity[] = [source(0, 0, E, 'iron-plate'), belt(1, 0, S)];
    for (let y = 1; y <= 10; y += 1) entities.push(belt(1, y, S));
    entities.push(sink(1, 11));
    const world = run(entities, 60);
    expect(world.belts[0]!.entry).toBe(E);
    expect(sinkRate(world, 'iron-plate')).toBeCloseTo(15, 1);
  });

  it('side-loads onto the near lane only', () => {
    // A southbound line with a belt behind its first tile, so a source coming
    // in from the west side-loads rather than turning.
    const entities: BuildEntity[] = [belt(1, -1, S)];
    for (let y = 0; y <= 10; y += 1) entities.push(belt(1, y, S));
    entities.push(sink(1, 11), source(0, 0, E, 'copper-plate'));
    const world = run(entities, 60);
    // Facing south, west is on the right.
    const target = world.belts[1]!;
    expect(world.lanes[target.lanes[0]]!.items).toHaveLength(0);
    expect(sinkRate(world, 'copper-plate')).toBeCloseTo(7.5, 1);
  });

  it('merges two side-loads into a full belt', () => {
    const entities: BuildEntity[] = [belt(1, -1, S)];
    for (let y = 0; y <= 10; y += 1) entities.push(belt(1, y, S));
    entities.push(sink(1, 11), source(0, 0, E, 'iron-plate'), source(2, 0, 3 as Dir, 'copper-plate'));
    const world = run(entities, 60);
    expect(sinkRate(world, 'iron-plate')).toBeCloseTo(7.5, 1);
    expect(sinkRate(world, 'copper-plate')).toBeCloseTo(7.5, 1);
  });

  it('honours a source rate limit', () => {
    const entities = line(10, 'transport-belt');
    const first = entities[0]!;
    if (first.kind === 'source') first.perSec = 2;
    const world = run(entities, 60);
    expect(sinkRate(world, 'iron-plate')).toBeCloseTo(2, 1);
  });
});

describe('inserters', () => {
  // Source, inserter, sink in a row: the chest-to-chest figure.
  const chestToChest = (inserterId: string, hands: HandSize): number => {
    const reach = inserterId === 'long-handed-inserter' ? 2 : 1;
    const world = run(
      [source(0, 0, N, 'iron-plate'), inserter(reach, 0, E, inserterId), sink(2 * reach, 0)],
      60,
      hands,
    );
    return sinkRate(world, 'iron-plate');
  };

  it('swing at the wiki chest-to-chest rates with one item a hand', () => {
    expect(chestToChest('burner-inserter', 'base')).toBeCloseTo(0.6, 1);
    expect(chestToChest('inserter', 'base')).toBeCloseTo(0.83, 1);
    expect(chestToChest('long-handed-inserter', 'base')).toBeCloseTo(1.2, 1);
    expect(chestToChest('fast-inserter', 'base')).toBeCloseTo(2.31, 1);
  });

  it('carry three a swing with capacity research, twelve for bulk', () => {
    expect(chestToChest('fast-inserter', 'researched')).toBeCloseTo(3 * 2.31, 0);
    expect(chestToChest('bulk-inserter', 'researched')).toBeCloseTo(12 * 2.31, 0);
  });

  it('long-handed inserters reach two tiles', () => {
    const world = run(
      [source(0, 0, N, 'iron-plate'), inserter(2, 0, E, 'long-handed-inserter'), sink(4, 0)],
      30,
      'base',
    );
    expect(sinkRate(world, 'iron-plate')).toBeCloseTo(1.2, 1);
  });

  it('take off a belt and drop onto the far lane of another', () => {
    // Iron runs east along y=0; an inserter at (5,1) lifts it south onto an
    // eastbound belt at y=2, whose far lane is its right-hand one.
    const entities: BuildEntity[] = [source(0, 0, E, 'iron-plate')];
    for (let x = 1; x <= 8; x += 1) entities.push(belt(x, 0, E));
    entities.push(inserter(5, 1, S, 'fast-inserter'));
    for (let x = 5; x <= 8; x += 1) entities.push(belt(x, 2, E));
    entities.push(sink(9, 2));
    // Long enough that the window no longer holds the belt filling up.
    const world = run(entities, 60, 'base');
    expect(sinkRate(world, 'iron-plate')).toBeCloseTo(2.31, 1);
    const lower = world.belts.filter((b) => b.entity.y === 2);
    for (const b of lower) expect(world.lanes[b.lanes[0]]!.items).toHaveLength(0);
  });
});

describe('machines', () => {
  // Iron in from the left, gears out to the right, through a 3×3 machine.
  const gearCell = (inserterId: string, hands: HandSize, machineId = 'assembling-machine-2'): World =>
    run(
      [
        source(0, 1, N, 'iron-plate'),
        inserter(1, 1, E, inserterId),
        machine(2, 0, machineId, 'iron-gear-wheel'),
        inserter(5, 1, E, inserterId),
        sink(6, 1),
      ],
      60,
      hands,
    );

  it('craft at the machine speed when fed enough', () => {
    // 0.5 s at speed 0.75: 1.5 gears a second, eating 3 plates.
    const world = gearCell('fast-inserter', 'researched');
    expect(sinkRate(world, 'iron-gear-wheel')).toBeCloseTo(1.5, 1);
    expect(meterRate(world.machines[0]!.working, world.tick) / 60).toBeGreaterThan(0.97);
  });

  it('starve behind a slow inserter, and say so', () => {
    // A basic inserter with no research moves 0.83 plates a second.
    const world = gearCell('inserter', 'base');
    expect(sinkRate(world, 'iron-gear-wheel')).toBeCloseTo(0.83 / 2, 1);
    expect(meterRate(world.machines[0]!.working, world.tick) / 60).toBeLessThan(0.35);
  });

  it('block when nothing takes the output', () => {
    const world = run(
      [source(0, 1, N, 'iron-plate'), inserter(1, 1, E, 'fast-inserter'), machine(2, 0, 'assembling-machine-2', 'iron-gear-wheel')],
      120,
    );
    const m = world.machines[0]!;
    expect(m.status).toBe('blocked');
    expect(m.outputs.get('iron-gear-wheel')).toBe(100);
  });

  it('pay out built-in productivity and assume piped fluids', () => {
    // Casting gears in a foundry: molten iron is a fluid, so it is assumed;
    // speed 4 and +50 % productivity on a 1 s recipe is 6 gears a second.
    const recipe = index.recipes.get('casting-iron-gear-wheel')!;
    const world = run(
      [
        machine(0, 0, 'foundry', 'casting-iron-gear-wheel'),
        inserter(5, 2, E, 'bulk-inserter'),
        sink(6, 2),
      ],
      60,
    );
    const m = world.machines[0]!;
    expect(m.fluids).toContain('molten-iron');
    const perCraft = recipe.outputs[0]!.amount;
    expect(sinkRate(world, 'iron-gear-wheel')).toBeCloseTo((4 / recipe.time) * perCraft * 1.5, 0);
  });
});

describe('recompiling', () => {
  it('keeps belt contents and the clock across an edit', () => {
    const entities = line(10, 'transport-belt');
    const build: Build = { entities, hands: 'researched' };
    const world = compileWorld(build, index);
    stepWorld(world, 120);
    const count = (w: World): number => w.lanes.reduce((sum, lane) => sum + lane.items.length, 0);
    const before = count(world);
    const next = compileWorld({ ...build, entities: [...entities] }, index, world);
    expect(next.tick).toBe(120);
    expect(count(next)).toBe(before);
  });

  it('empties a machine whose recipe changed', () => {
    const m = machine(2, 0, 'assembling-machine-2', 'iron-gear-wheel');
    const entities = [source(0, 1, N, 'iron-plate'), inserter(1, 1, E, 'fast-inserter'), m];
    const world = compileWorld({ entities, hands: 'researched' }, index);
    stepWorld(world, 300);
    expect(world.machines[0]!.outputs.get('iron-gear-wheel')).toBeGreaterThan(0);
    const changed = { ...m, recipeId: 'copper-cable' } as BuildEntity;
    const next = compileWorld({ entities: [entities[0]!, entities[1]!, changed], hands: 'researched' }, index, world);
    expect(next.machines[0]!.outputs.size).toBe(0);
  });
});
