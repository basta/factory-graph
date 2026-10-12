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
  /**
   * What this sink is meant to receive, for the report to compare against.
   * "Build this" sets it from the node's solved rate. Absent or null, the
   * report compares with the plan's own outputs instead.
   */
  target?: { itemId: string; perSec: number } | null;
}

/**
 * One end of an underground pair. Both ends face the way items travel: an
 * entrance takes items in at its back and sends them under, an exit brings
 * them up and passes them on at its front. An exit pairs with the nearest
 * entrance of the same tier behind it, within the tier's reach.
 */
export interface UndergroundEntity extends Placed {
  kind: 'underground';
  /** The belt tier, which sets both speed and reach. */
  beltId: string;
  io: 'in' | 'out';
}

export type Side = 'left' | 'right';

/**
 * Two tiles wide, across the direction of travel. Items keep their lane and
 * alternate between the two outputs; a priority side is filled first, and a
 * filter sends the filtered item to the priority side and everything else to
 * the other.
 */
export interface SplitterEntity extends Placed {
  kind: 'splitter';
  beltId: string;
  inputPriority: Side | null;
  outputPriority: Side | null;
  /** Only meaningful with an output priority. */
  filter: string | null;
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
  | ChestEntity
  | UndergroundEntity
  | SplitterEntity;

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
