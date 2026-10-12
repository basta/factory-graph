/**
 * Pure edits on a build. The store wraps these with undo; keeping them free
 * of the store is what lets the placement rules be tested on their own.
 */
import { entityFootprint, footprint } from './entities.ts';
import { rotate } from './entities.ts';
import { tileKey, type Build, type BuildEntity, type Dir } from './types.ts';

/** Tile → entity id, for everything in the build. */
export function occupancy(entities: readonly BuildEntity[]): Map<string, string> {
  const tiles = new Map<string, string>();
  for (const entity of entities) {
    const { w, h } = entityFootprint(entity);
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) tiles.set(tileKey(entity.x + dx, entity.y + dy), entity.id);
    }
  }
  return tiles;
}

/** Ids of the entities a footprint at this spot would overlap. */
export function overlapping(
  tiles: ReadonlyMap<string, string>,
  entity: BuildEntity,
): Set<string> {
  const { w, h } = entityFootprint(entity);
  const hit = new Set<string>();
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      const id = tiles.get(tileKey(entity.x + dx, entity.y + dy));
      if (id !== undefined) hit.add(id);
    }
  }
  return hit;
}

function sameSpot(a: BuildEntity, b: BuildEntity): boolean {
  if (a.kind !== b.kind || a.x !== b.x || a.y !== b.y) return false;
  const fa = entityFootprint(a);
  const fb = entityFootprint(b);
  return fa.w === fb.w && fa.h === fb.h;
}

export interface Placement {
  build: Build;
  /** Ids now standing where each requested entity went, or null where it did not fit. */
  placed: (string | null)[];
}

/**
 * Places entities in order. Something built exactly over an entity of the
 * same kind and size replaces it and keeps its id — re-laying a belt in a new
 * direction or tier, swapping an inserter, changing a machine — so whatever
 * it was holding stays in the simulation. Anything else that overlaps is
 * refused, the way the game refuses it.
 */
export function placeEntities(build: Build, entities: readonly BuildEntity[]): Placement {
  const list = [...build.entities];
  const tiles = occupancy(list);
  const placed: (string | null)[] = [];

  for (const entity of entities) {
    const hit = overlapping(tiles, entity);
    if (hit.size === 0) {
      list.push(entity);
      const { w, h } = entityFootprint(entity);
      for (let dy = 0; dy < h; dy += 1) {
        for (let dx = 0; dx < w; dx += 1) tiles.set(tileKey(entity.x + dx, entity.y + dy), entity.id);
      }
      placed.push(entity.id);
      continue;
    }
    if (hit.size === 1) {
      const [targetId] = hit;
      const at = list.findIndex((existing) => existing.id === targetId);
      const existing = list[at];
      if (existing && sameSpot(existing, entity)) {
        list[at] = { ...entity, id: existing.id } as BuildEntity;
        placed.push(existing.id);
        continue;
      }
    }
    placed.push(null);
  }
  return { build: { ...build, entities: list }, placed };
}

export function removeEntities(build: Build, ids: readonly string[]): Build {
  const doomed = new Set(ids);
  return { ...build, entities: build.entities.filter((entity) => !doomed.has(entity.id)) };
}

export function updateEntity(build: Build, id: string, patch: Partial<BuildEntity>): Build {
  return {
    ...build,
    entities: build.entities.map((entity) =>
      entity.id === id ? ({ ...entity, ...patch, id, kind: entity.kind } as BuildEntity) : entity,
    ),
  };
}

/**
 * Turns one entity a quarter clockwise in place. A machine that is longer
 * one way than the other only turns if its new footprint is clear.
 */
export function rotateEntity(build: Build, id: string): Build {
  const entity = build.entities.find((existing) => existing.id === id);
  if (!entity) return build;
  const turned = { ...entity, dir: rotate(entity.dir, 1) } as BuildEntity;
  const before = entityFootprint(entity);
  const after = entityFootprint(turned);
  if (before.w !== after.w) {
    const others = occupancy(build.entities.filter((existing) => existing.id !== id));
    if (overlapping(others, turned).size > 0) return build;
  }
  return updateEntity(build, id, { dir: turned.dir });
}

/**
 * A copied group, normalised so its top-left is at 0,0. Pasting stamps it at
 * an offset with fresh ids.
 */
export interface Stamp {
  entities: BuildEntity[];
  w: number;
  h: number;
}

export function stampOf(entities: readonly BuildEntity[]): Stamp {
  if (entities.length === 0) return { entities: [], w: 0, h: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const entity of entities) {
    const { w, h } = entityFootprint(entity);
    minX = Math.min(minX, entity.x);
    minY = Math.min(minY, entity.y);
    maxX = Math.max(maxX, entity.x + w);
    maxY = Math.max(maxY, entity.y + h);
  }
  return {
    entities: entities.map((entity) => ({ ...entity, x: entity.x - minX, y: entity.y - minY })),
    w: maxX - minX,
    h: maxY - minY,
  };
}

/** The stamp turned a quarter clockwise, still anchored at 0,0. */
export function rotateStamp(stamp: Stamp): Stamp {
  return stampOf(
    stamp.entities.map((entity) => {
      const { h } = entityFootprint(entity);
      // Clockwise on a y-down grid sends (x, y) to (-y, x); the rectangle's
      // far corner on the y axis becomes its new left edge.
      return {
        ...entity,
        x: -(entity.y + h - 1),
        y: entity.x,
        dir: rotate(entity.dir, 1),
      } as BuildEntity;
    }),
  );
}

export function stampAt(stamp: Stamp, x: number, y: number, newId: () => string): BuildEntity[] {
  return stamp.entities.map((entity) => ({ ...entity, id: newId(), x: entity.x + x, y: entity.y + y }));
}

/** Footprint for a would-be entity, for the placement ghost. */
export function ghostFootprint(kind: BuildEntity['kind'], dir: Dir, machineId?: string): {
  w: number;
  h: number;
} {
  return footprint(machineId ? { kind, dir, machineId } : { kind, dir });
}
