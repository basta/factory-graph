import { describe, expect, it } from 'vitest';
import { placeEntities, removeEntities, rotateEntity, rotateStamp, stampAt, stampOf } from './edit.ts';
import { emptyBuild, type BuildEntity, type Dir } from './types.ts';
import { entityFor, undergroundRoleAt } from './tools.ts';

function belt(id: string, x: number, y: number, dir: Dir = 1): BuildEntity {
  return {
    id, kind: 'belt', x, y, dir, beltId: 'transport-belt',
  };
}
const assembler = (id: string, x: number, y: number): BuildEntity => ({
  id, kind: 'machine', x, y, dir: 0, machineId: 'assembling-machine-2', recipeId: null,
});

describe('placing', () => {
  it('refuses an overlap with something different', () => {
    const { build } = placeEntities(emptyBuild(), [assembler('m', 0, 0)]);
    const result = placeEntities(build, [belt('b', 1, 1)]);
    expect(result.placed).toEqual([null]);
    expect(result.build.entities).toHaveLength(1);
  });

  it('replaces like with like in place, keeping the id', () => {
    const { build } = placeEntities(emptyBuild(), [belt('b', 0, 0, 1)]);
    const result = placeEntities(build, [{ ...belt('new', 0, 0, 2), beltId: 'fast-transport-belt' } as BuildEntity]);
    expect(result.placed).toEqual(['b']);
    expect(result.build.entities).toEqual([{ ...belt('b', 0, 0, 2), beltId: 'fast-transport-belt' }]);
  });

  it('does not let a machine half-cover another', () => {
    const { build } = placeEntities(emptyBuild(), [assembler('a', 0, 0)]);
    expect(placeEntities(build, [assembler('b', 1, 0)]).placed).toEqual([null]);
  });

  it('removes by id', () => {
    const { build } = placeEntities(emptyBuild(), [belt('a', 0, 0), belt('b', 1, 0)]);
    expect(removeEntities(build, ['a']).entities.map((e) => e.id)).toEqual(['b']);
  });
});

describe('rotating', () => {
  it('turns a recycler only when its new footprint is clear', () => {
    const recycler: BuildEntity = {
      id: 'r', kind: 'machine', x: 0, y: 0, dir: 0, machineId: 'recycler', recipeId: null,
    };
    // 2 wide and 4 tall facing north; 4 wide and 2 tall once turned.
    const clear = placeEntities(emptyBuild(), [recycler]).build;
    expect(rotateEntity(clear, 'r').entities[0]!.dir).toBe(1);
    const blocked = placeEntities(clear, [belt('b', 3, 0)]).build;
    expect(rotateEntity(blocked, 'r').entities[0]!.dir).toBe(0);
  });

  it('turns a copied group about its corner', () => {
    // A belt east of a 3×3 machine, facing east.
    const stamp = stampOf([assembler('m', 10, 10), belt('b', 13, 11, 1)]);
    expect(stamp).toMatchObject({ w: 4, h: 3 });
    const turned = rotateStamp(stamp);
    expect(turned).toMatchObject({ w: 3, h: 4 });
    // Turned clockwise the belt ends up below the machine, facing south.
    const placed = stampAt(turned, 0, 0, () => 'x');
    const machine = placed.find((e) => e.kind === 'machine')!;
    const b = placed.find((e) => e.kind === 'belt')!;
    expect(machine).toMatchObject({ x: 0, y: 0 });
    expect(b).toMatchObject({ x: 1, y: 3, dir: 2 });
  });
});

describe('belt shapes', () => {
  const ug = (id: string, x: number, io: 'in' | 'out', beltId = 'transport-belt'): BuildEntity => ({
    id, kind: 'underground', x, y: 0, dir: 1, io, beltId,
  });

  it('makes the next underground an exit when an entrance waits behind it', () => {
    const build = placeEntities(emptyBuild(), [ug('a', 0, 'in')]).build;
    expect(undergroundRoleAt(build, { x: 4, y: 0 }, 1, 'transport-belt')).toBe('out');
    // Out of reach, or another tier, starts a new pair.
    expect(undergroundRoleAt(build, { x: 6, y: 0 }, 1, 'transport-belt')).toBe('in');
    expect(undergroundRoleAt(build, { x: 4, y: 0 }, 1, 'fast-transport-belt')).toBe('in');
    // And after a finished pair, the next one is an entrance again.
    const paired = placeEntities(build, [ug('b', 3, 'out')]).build;
    expect(undergroundRoleAt(paired, { x: 5, y: 0 }, 1, 'transport-belt')).toBe('in');
  });

  it('holds a splitter by its left half and covers two tiles across it', () => {
    const tool = { kind: 'splitter', beltId: 'transport-belt' } as const;
    const facingSouth = entityFor(tool, { x: 5, y: 5 }, 2, emptyBuild(), 's');
    // Facing south, left is east: the pointer tile is the east half.
    expect(facingSouth).toMatchObject({ x: 4, y: 5 });
    const facingEast = entityFor(tool, { x: 5, y: 5 }, 1, emptyBuild(), 's');
    expect(placeEntities(emptyBuild(), [facingEast]).build.entities).toHaveLength(1);
    const blocked = placeEntities(emptyBuild(), [belt('b', 5, 6)]).build;
    expect(placeEntities(blocked, [facingEast]).placed).toEqual([null]);
  });
});
