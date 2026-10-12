import { describe, expect, it } from 'vitest';
import { placeEntities, removeEntities, rotateEntity, rotateStamp, stampAt, stampOf } from './edit.ts';
import { emptyBuild, type BuildEntity, type Dir } from './types.ts';

const belt = (id: string, x: number, y: number, dir: Dir = 1): BuildEntity => ({
  id, kind: 'belt', x, y, dir, beltId: 'transport-belt',
});
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
