/**
 * A build: the physical layout of a design on a tile grid, as opposed to the
 * ratio graph. It is part of the plan document, so it saves, shares and undoes
 * with everything else; what is *on* the belts while the simulator runs is
 * not, and lives in `src/sim/`.
 */

/** 0 north, 1 east, 2 south, 3 west — clockwise, so `+1` is a right turn. */
export type Dir = 0 | 1 | 2 | 3;

export interface Tile {
  x: number;
  y: number;
}

interface Placed {
  id: string;
  /** Top-left tile of the footprint. */
  x: number;
  y: number;
  dir: Dir;
}

export interface BeltEntity extends Placed {
  kind: 'belt';
  beltId: string;
}

/** `dir` is the way items travel: picked up behind, dropped in front. */
export interface InserterEntity extends Placed {
  kind: 'inserter';
  inserterId: string;
}

/** `dir` only matters for machines that are not square. */
export interface MachineEntity extends Placed {
  kind: 'machine';
  machineId: string;
  recipeId: string | null;
}

/**
 * An endless supply of one item: it fills the belt it faces, the way a loader
 * does, and inserters can take from it like a chest. Stands in for the mining
 * and smelting columns a design under test would really be fed by.
 */
export interface SourceEntity extends Placed {
  kind: 'source';
  itemId: string;
  /** Null is as fast as whatever takes from it. */
  perSec: number | null;
}

/** Accepts anything from the belt that runs into it or an inserter, and counts it. */
export interface SinkEntity extends Placed {
  kind: 'sink';
}

export interface ChestEntity extends Placed {
  kind: 'chest';
}

export type BuildEntity =
  | BeltEntity
  | InserterEntity
  | MachineEntity
  | SourceEntity
  | SinkEntity
  | ChestEntity;

export type EntityKind = BuildEntity['kind'];

/**
 * How many items an inserter carries per swing. Inserter capacity research
 * changes it from 1 to 3 (12 for bulk inserters), which is a bigger
 * difference than any inserter upgrade, so a design is tested against one or
 * the other on purpose.
 */
export type HandSize = 'base' | 'researched';

export interface Build {
  entities: BuildEntity[];
  hands: HandSize;
}

export function emptyBuild(): Build {
  return { entities: [], hands: 'researched' };
}

// --- directions --------------------------------------------------------------

const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

export function step(tile: Tile, dir: Dir, distance = 1): Tile {
  return { x: tile.x + DX[dir] * distance, y: tile.y + DY[dir] * distance };
}

export const opposite = (dir: Dir): Dir => ((dir + 2) % 4) as Dir;
export const rightOf = (dir: Dir): Dir => ((dir + 1) % 4) as Dir;
export const leftOf = (dir: Dir): Dir => ((dir + 3) % 4) as Dir;

/** The direction from `a` to an adjacent `b`, or null when they do not touch. */
export function dirBetween(a: Tile, b: Tile): Dir | null {
  for (let dir = 0; dir < 4; dir += 1) {
    if (a.x + DX[dir as Dir] === b.x && a.y + DY[dir as Dir] === b.y) return dir as Dir;
  }
  return null;
}

export const tileKey = (x: number, y: number): string => `${x},${y}`;
