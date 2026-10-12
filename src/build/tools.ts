import { newId } from '../graph/store.ts';
import { footprint } from './entities.ts';
import { stampAt, type Stamp } from './edit.ts';
import type { BuildEntity, Dir, Tile } from './types.ts';

/** What a left click on the build canvas does. */
export type Tool =
  | { kind: 'select' }
  | { kind: 'erase' }
  | { kind: 'belt'; beltId: string }
  | { kind: 'inserter'; inserterId: string }
  | { kind: 'machine'; machineId: string; recipeId: string }
  | { kind: 'source'; itemId: string }
  | { kind: 'sink' }
  | { kind: 'chest' }
  | { kind: 'paste'; stamp: Stamp };

export type PlacingTool = Extract<Tool, { kind: 'belt' | 'inserter' | 'machine' | 'source' | 'sink' | 'chest' }>;

export function isPlacing(tool: Tool): tool is PlacingTool {
  return (
    tool.kind === 'belt' ||
    tool.kind === 'inserter' ||
    tool.kind === 'machine' ||
    tool.kind === 'source' ||
    tool.kind === 'sink' ||
    tool.kind === 'chest'
  );
}

/**
 * The entity a placing tool would put down with the pointer on `tile`. A
 * machine is centred on the pointer rather than hung off its corner, the way
 * the game holds a building.
 */
export function entityFor(tool: PlacingTool, tile: Tile, dir: Dir, id = newId('b')): BuildEntity {
  switch (tool.kind) {
    case 'belt':
      return { id, kind: 'belt', x: tile.x, y: tile.y, dir, beltId: tool.beltId };
    case 'inserter':
      return { id, kind: 'inserter', x: tile.x, y: tile.y, dir, inserterId: tool.inserterId };
    case 'machine': {
      const { w, h } = footprint({ kind: 'machine', dir, machineId: tool.machineId });
      return {
        id,
        kind: 'machine',
        x: tile.x - Math.floor((w - 1) / 2),
        y: tile.y - Math.floor((h - 1) / 2),
        dir,
        machineId: tool.machineId,
        recipeId: tool.recipeId,
      };
    }
    case 'source':
      return { id, kind: 'source', x: tile.x, y: tile.y, dir, itemId: tool.itemId, perSec: null };
    case 'sink':
      return { id, kind: 'sink', x: tile.x, y: tile.y, dir };
    case 'chest':
      return { id, kind: 'chest', x: tile.x, y: tile.y, dir };
  }
}

/** A pasted stamp, centred on the pointer like a machine. */
export function pasteAt(stamp: Stamp, tile: Tile): BuildEntity[] {
  return stampAt(
    stamp,
    tile.x - Math.floor((stamp.w - 1) / 2),
    tile.y - Math.floor((stamp.h - 1) / 2),
    () => newId('b'),
  );
}

/**
 * Tiles from `a` to `b`, 4-connected, excluding `a`. A fast pointer skips
 * tiles between moves; this fills them in so a dragged belt has no holes and
 * every step is a single tile in one of the four directions.
 */
export function walk(a: Tile, b: Tile): Tile[] {
  const tiles: Tile[] = [];
  let x = a.x;
  let y = a.y;
  while (x !== b.x || y !== b.y) {
    const dx = b.x - x;
    const dy = b.y - y;
    if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx);
    else y += Math.sign(dy);
    tiles.push({ x, y });
  }
  return tiles;
}
