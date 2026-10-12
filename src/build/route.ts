/**
 * Belt routing: a path of belts from one tile to another across a build,
 * found by A* over (tile, direction of travel). It turns corners, hops under
 * whatever is in the way with a pair of undergrounds of its own tier, and
 * keeps out of every tile that would change what an existing belt does:
 * anything occupied, and the empty tile in front of a belt that dead-ends,
 * which a new belt would quietly start receiving items from.
 */
import { entityFootprint, splitterHalves, undergroundReach } from './entities.ts';
import { opposite, step, tileKey, type BuildEntity, type Dir, type Tile } from './types.ts';

export interface RouteEnd {
  tile: Tile;
  /**
   * At the start, the way items are already travelling as they arrive on the
   * tile. At the end, the way the last belt must face, into whatever it feeds.
   */
  dir: Dir;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Cost of one belt tile; a turn adds a little, so straight runs win ties. */
const TURN = 0.4;
/** An underground pair costs its span plus this, so it is used to cross, not to save a tile. */
const TUNNEL = 4;
/** Gives up past this many expansions, rather than searching a hopeless grid forever. */
const MAX_EXPANSIONS = 60_000;

/** The tile each conveyor puts items into, when that tile is empty. */
function deadEndTiles(entities: readonly BuildEntity[], occupied: ReadonlySet<string>): Set<string> {
  const ahead = new Set<string>();
  const mark = (tile: Tile, dir: Dir): void => {
    const next = step(tile, dir);
    const key = tileKey(next.x, next.y);
    if (!occupied.has(key)) ahead.add(key);
  };
  for (const entity of entities) {
    if (entity.kind === 'belt' || entity.kind === 'source') mark(entity, entity.dir);
    else if (entity.kind === 'underground' && entity.io === 'out') mark(entity, entity.dir);
    else if (entity.kind === 'splitter') for (const half of splitterHalves(entity)) mark(half, entity.dir);
  }
  return ahead;
}

export function occupiedTiles(entities: readonly BuildEntity[]): Set<string> {
  const tiles = new Set<string>();
  for (const entity of entities) {
    const { w, h } = entityFootprint(entity);
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) tiles.add(tileKey(entity.x + dx, entity.y + dy));
    }
  }
  return tiles;
}

interface Node {
  tile: Tile;
  /** Direction items travel as they arrive here. */
  dir: Dir;
  /** This tile is an underground exit: the next tile must be straight on. */
  exit: boolean;
  g: number;
  f: number;
  parent: Node | null;
  /** What sits on the parent's tile to get here. */
  via: 'belt' | 'tunnel';
}

/** A tiny binary heap on `f`; the grids are small, but A* re-pushes a lot. */
class Heap {
  private items: Node[] = [];
  get size(): number {
    return this.items.length;
  }
  push(node: Node): void {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (items[p]!.f <= items[i]!.f) break;
      [items[p], items[i]] = [items[i]!, items[p]!];
      i = p;
    }
  }
  pop(): Node | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l]!.f < items[m]!.f) m = l;
        if (r < items.length && items[r]!.f < items[m]!.f) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i]!, items[m]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Belts (and underground pairs) from `from` to `to`, or null when there is
 * no way through inside `bounds`. Both end tiles must be empty. Ids come from
 * `newId`.
 */
export function routeBelt(
  entities: readonly BuildEntity[],
  from: RouteEnd,
  to: RouteEnd,
  beltId: string,
  bounds: Bounds,
  newId: () => string,
): BuildEntity[] | null {
  const occupied = occupiedTiles(entities);
  const blocked = new Set([...occupied, ...deadEndTiles(entities, occupied)]);
  const startKey = tileKey(from.tile.x, from.tile.y);
  const goalKey = tileKey(to.tile.x, to.tile.y);
  blocked.delete(startKey);
  blocked.delete(goalKey);
  if (occupied.has(startKey) || occupied.has(goalKey)) return null;

  // Undergrounds of this tier facing each way, which a new pair must not
  // have between its ends or it would pair with them instead.
  const tunnels = new Set(
    entities
      .filter((e) => e.kind === 'underground' && e.beltId === beltId)
      .map((e) => `${tileKey(e.x, e.y)}|${e.dir}`),
  );
  const reach = undergroundReach(beltId);
  const inBounds = (t: Tile): boolean =>
    t.x >= bounds.minX && t.x <= bounds.maxX && t.y >= bounds.minY && t.y <= bounds.maxY;
  const h = (t: Tile): number => Math.abs(t.x - to.tile.x) + Math.abs(t.y - to.tile.y);

  /** Tiles this partial path already uses, so it never crosses itself. */
  const uses = (node: Node, key: string): boolean => {
    for (let n: Node | null = node; n; n = n.parent) {
      if (tileKey(n.tile.x, n.tile.y) === key) return true;
      // A tunnel's own tiles are its two ends; what is between is free.
    }
    return false;
  };

  const heap = new Heap();
  const best = new Map<string, number>();
  const start: Node = { tile: from.tile, dir: from.dir, exit: false, g: 0, f: h(from.tile), parent: null, via: 'belt' };
  heap.push(start);
  let expansions = 0;

  while (heap.size > 0 && expansions < MAX_EXPANSIONS) {
    const node = heap.pop()!;
    const key = `${tileKey(node.tile.x, node.tile.y)}|${node.dir}|${node.exit ? 1 : 0}`;
    if ((best.get(key) ?? Infinity) < node.g) continue;
    expansions += 1;

    for (let nd = 0 as Dir; nd < 4; nd = (nd + 1) as Dir) {
      if (nd === opposite(node.dir)) continue;
      if (node.exit && nd !== node.dir) continue;
      // An underground's back is the ground: nothing may arrive into an exit sideways.
      const next = step(node.tile, nd);
      const nextKey = tileKey(next.x, next.y);
      if (nextKey === goalKey) {
        // Arriving from the far side would mean coming out of what it feeds.
        if (nd === opposite(to.dir)) continue;
        return build({ tile: next, dir: nd, exit: false, g: 0, f: 0, parent: node, via: 'belt' });
      }
      if (!inBounds(next) || blocked.has(nextKey) || uses(node, nextKey)) continue;
      const g = node.g + 1 + (nd === node.dir ? 0 : TURN);
      const child: Node = { tile: next, dir: nd, exit: false, g, f: g + h(next), parent: node, via: 'belt' };
      const childKey = `${nextKey}|${nd}|0`;
      if (g < (best.get(childKey) ?? Infinity)) {
        best.set(childKey, g);
        heap.push(child);
      }
    }

    // Tunnel straight on: this tile becomes the entrance, an exit lands
    // `span` tiles ahead. The entrance has to be entered from behind.
    if (!node.exit) {
      for (let span = 2; span <= reach; span += 1) {
        const exitTile = step(node.tile, node.dir, span);
        const exitKey = tileKey(exitTile.x, exitTile.y);
        if (!inBounds(exitTile)) break;
        let clash = false;
        for (let k = 1; k < span; k += 1) {
          const between = step(node.tile, node.dir, k);
          if (tunnels.has(`${tileKey(between.x, between.y)}|${node.dir}`)) clash = true;
        }
        if (clash) break;
        if (exitKey === goalKey || blocked.has(exitKey) || uses(node, exitKey)) continue;
        // Only worth it if the tile straight after the exit is usable too.
        const after = step(exitTile, node.dir);
        const afterKey = tileKey(after.x, after.y);
        if (afterKey !== goalKey && (blocked.has(afterKey) || !inBounds(after))) continue;
        const g = node.g + span + TUNNEL;
        const child: Node = { tile: exitTile, dir: node.dir, exit: true, g, f: g + h(exitTile), parent: node, via: 'tunnel' };
        const childKey = `${exitKey}|${node.dir}|1`;
        if (g < (best.get(childKey) ?? Infinity)) {
          best.set(childKey, g);
          heap.push(child);
        }
      }
    }
  }
  return null;

  function build(goal: Node): BuildEntity[] {
    const chain: Node[] = [];
    for (let n: Node | null = goal; n; n = n.parent) chain.unshift(n);
    const out: BuildEntity[] = [];
    for (let i = 0; i < chain.length; i += 1) {
      const node = chain[i]!;
      const next = chain[i + 1];
      const { x, y } = node.tile;
      if (!next) {
        out.push({ id: newId(), kind: 'belt', x, y, dir: to.dir, beltId });
      } else if (next.via === 'tunnel') {
        out.push({ id: newId(), kind: 'underground', x, y, dir: next.dir, beltId, io: 'in' });
      } else if (node.exit) {
        out.push({ id: newId(), kind: 'underground', x, y, dir: node.dir, beltId, io: 'out' });
      } else {
        out.push({ id: newId(), kind: 'belt', x, y, dir: next.dir, beltId });
      }
    }
    return out;
  }
}
