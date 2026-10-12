import { describe, expect, it } from 'vitest';
import { testGameData } from '../solver/fixtures.ts';
import { meterRate } from '../sim/meter.ts';
import { stepWorld } from '../sim/step.ts';
import { compileWorld } from '../sim/world.ts';
import { placeEntities } from './edit.ts';
import { routeBelt } from './route.ts';
import type { BuildEntity, Dir } from './types.ts';

const index = testGameData();
let n = 0;
const id = (): string => `r${(n += 1)}`;
const E: Dir = 1;
const S: Dir = 2;

const belt = (x: number, y: number, dir: Dir): BuildEntity => ({ id: id(), kind: 'belt', x, y, dir, beltId: 'transport-belt' });
const source = (x: number, y: number, dir: Dir, itemId = 'iron-plate'): BuildEntity => ({
  id: id(), kind: 'source', x, y, dir, itemId, perSec: null,
});
const sink = (x: number, y: number): BuildEntity => ({ id: id(), kind: 'sink', x, y, dir: 0 });
const bounds = { minX: -10, minY: -10, maxX: 20, maxY: 20 };

/** Source and one belt at the start, one belt and a sink at the end; route between. */
function connect(extra: BuildEntity[], to = { x: 10, y: 6 }) {
  const ends = [source(0, 0, E), belt(1, 0, E), belt(to.x + 1, to.y, E), sink(to.x + 2, to.y)];
  const entities = [...ends, ...extra];
  const path = routeBelt(entities, { tile: { x: 2, y: 0 }, dir: E }, { tile: to, dir: E }, 'transport-belt', bounds, id);
  return { entities, path };
}

function deliver(entities: BuildEntity[], x: number, y: number, itemId = 'iron-plate'): number {
  const placed = placeEntities({ entities: [], hands: 'researched' }, entities);
  expect(placed.placed.every((p) => p !== null), 'route overlaps nothing').toBe(true);
  const world = compileWorld(placed.build, index);
  stepWorld(world, 90 * 60);
  const s = world.sinks.find((k) => k.entity.x === x && k.entity.y === y)!;
  const meter = s.meters.get(itemId);
  return meter ? meterRate(meter, world.tick) : 0;
}

describe('routeBelt', () => {
  it('lays a belt that carries a full belt round corners', () => {
    const { entities, path } = connect([]);
    expect(path).not.toBeNull();
    expect(deliver([...entities, ...path!], 12, 6)).toBeCloseTo(15, 0);
  });

  it('tunnels under a thin wall, since that is shorter than going round', () => {
    const wall: BuildEntity[] = [];
    for (let y = -10; y <= 15; y += 1) wall.push({ id: id(), kind: 'chest', x: 6, y, dir: 0 });
    const { entities, path } = connect(wall);
    expect(path!.filter((e) => e.kind === 'underground')).toHaveLength(2);
    expect(deliver([...entities, ...path!], 12, 6)).toBeCloseTo(15, 0);
  });

  it('goes round a wall too thick to tunnel under', () => {
    // Six tiles is past a transport belt underground's reach of five.
    const wall: BuildEntity[] = [];
    for (let y = -10; y <= 15; y += 1) {
      for (let x = 4; x <= 9; x += 1) wall.push({ id: id(), kind: 'chest', x, y, dir: 0 });
    }
    const { entities, path } = connect(wall, { x: 14, y: 6 });
    expect(path).not.toBeNull();
    expect(path!.every((e) => e.kind === 'belt')).toBe(true);
    expect(deliver([...entities, ...path!], 16, 6)).toBeCloseTo(15, 0);
  });

  it('tunnels under a belt line it cannot go round, and both keep running', () => {
    // A copper line running south through the whole search area.
    const line: BuildEntity[] = [source(6, -10, S, 'copper-plate')];
    for (let y = -9; y <= 19; y += 1) line.push(belt(6, y, S));
    line.push(sink(6, 20));
    const { entities, path } = connect(line);
    expect(path).not.toBeNull();
    expect(path!.filter((e) => e.kind === 'underground')).toHaveLength(2);
    const all = [...entities, ...path!];
    expect(deliver(all, 12, 6)).toBeCloseTo(15, 0);
    expect(deliver(all, 6, 20, 'copper-plate')).toBeCloseTo(15, 0);
  });

  it('never ends up in front of a belt that dead-ends, where it would be side-loaded', () => {
    // A belt pointing south at (5, -1) dead-ends into (5, 0)... except that is
    // the straight line the route would like.
    const stub = [belt(5, -2, S), belt(5, -1, S)];
    const { path } = connect(stub);
    expect(path!.some((e) => e.x === 5 && e.y === 0)).toBe(false);
  });

  it('gives up when there is no way through', () => {
    const box: BuildEntity[] = [];
    for (let x = 8; x <= 12; x += 1) for (const y of [4, 8]) box.push({ id: id(), kind: 'chest', x, y, dir: 0 });
    for (let y = 5; y <= 7; y += 1) for (const x of [8, 12]) box.push({ id: id(), kind: 'chest', x, y, dir: 0 });
    // The goal sits inside a sealed box of chests, two thick on no side, but
    // chests are not belts, so a tunnel could still pass: seal it with reach.
    const { path } = connect(box, { x: 10, y: 6 });
    // A tunnel can reach in, so this one is reachable; a goal with no
    // neighbour free at all is not.
    expect(path).not.toBeNull();
    const sealed = routeBelt(
      [sink(10, 5), sink(9, 6), sink(11, 6), sink(10, 7)],
      { tile: { x: 0, y: 0 }, dir: E },
      { tile: { x: 10, y: 6 }, dir: E },
      'transport-belt',
      bounds,
      id,
    );
    expect(sealed).toBeNull();
  });
});
