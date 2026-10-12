/**
 * Paints a build and its simulation onto a 2D canvas. Pure drawing: it reads
 * the world and the view and touches nothing else, so the canvas component
 * can call it every animation frame.
 *
 * The rules are DESIGN.md's, carried over to a tile grid: warm greys, game
 * sprites for game things, `--copper` for selection, `--brass` for rates and
 * `--warn` only for a machine that is not keeping up.
 */
import type { GameIndex } from '../data/loader.ts';
import type { IconRef } from '../data/schema.ts';
import { INSERTER_SPECS, LANE_LENGTH, entityFootprint } from './entities.ts';
import { leftOf, rightOf, type BuildEntity, type Dir } from './types.ts';
import { armPosition } from '../sim/step.ts';
import { meterRate } from '../sim/meter.ts';
import type { World } from '../sim/world.ts';

/** Tile edge at zoom 1, CSS px. */
export const TILE = 32;

export interface View {
  /** Screen position of tile 0,0's corner, CSS px. */
  x: number;
  y: number;
  zoom: number;
}

export interface Palette {
  bg: string;
  dot: string;
  panel: string;
  raised: string;
  line: string;
  ink: string;
  muted: string;
  copper: string;
  brass: string;
  warn: string;
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--bg-canvas', '#2b2a28'),
    dot: v('--grid-dot', '#3a3835'),
    panel: v('--panel', '#34322f'),
    raised: v('--panel-raised', '#403d39'),
    line: v('--line', '#57534e'),
    ink: v('--ink', '#ede7da'),
    muted: v('--ink-muted', '#a39e93'),
    copper: v('--copper', '#d4874a'),
    brass: v('--brass', '#e5b95c'),
    warn: v('--warn', '#e0553a'),
  };
}

/** A machine under this share of the time spent crafting is not keeping up. */
export const KEEPING_UP = 0.95;

export interface Ghost {
  entities: BuildEntity[];
  valid: boolean;
}

export interface Scene {
  world: World;
  index: GameIndex;
  view: View;
  palette: Palette;
  sprites: HTMLImageElement | null;
  selection: ReadonlySet<string>;
  ghost: Ghost | null;
  /** Box selection in progress, in tiles. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Tile under the pointer, outlined when no ghost is shown. */
  hover: { x: number; y: number } | null;
  width: number;
  height: number;
}

const VX = [0, 1, 0, -1] as const;
const VY = [-1, 0, 1, 0] as const;

export function draw(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { view, palette, width, height } = scene;
  const t = TILE * view.zoom;

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  // Visible tile range, with a margin for footprints that start off-screen.
  const x0 = Math.floor(-view.x / t) - 5;
  const y0 = Math.floor(-view.y / t) - 5;
  const x1 = Math.ceil((width - view.x) / t) + 1;
  const y1 = Math.ceil((height - view.y) / t) + 1;
  const visible = (e: BuildEntity): boolean => {
    const { w, h } = entityFootprint(e);
    return e.x + w >= x0 && e.x <= x1 && e.y + h >= y0 && e.y <= y1;
  };

  drawDots(ctx, scene, t);

  const { world } = scene;
  for (const belt of world.belts) if (visible(belt.entity)) drawBelt(ctx, scene, belt.entity, belt.entry, t);
  for (const source of world.sources) if (visible(source.entity)) drawSource(ctx, scene, source.entity, t);
  for (const sink of world.sinks) if (visible(sink.entity)) drawSink(ctx, scene, sink.entity, t);
  for (const chest of world.chests) if (visible(chest.entity)) drawChest(ctx, scene, chest.entity, t);
  for (const machine of world.machines) if (visible(machine.entity)) drawMachine(ctx, scene, machine, t);

  // Items above belts, inserters above items, so a held item is never hidden.
  if (t >= 6) {
    for (const belt of world.belts) {
      if (visible(belt.entity)) drawLaneItems(ctx, scene, belt.entity, belt.entry, belt.lanes, t);
    }
  }
  for (const inserter of world.inserters) {
    if (visible(inserter.entity)) drawInserter(ctx, scene, inserter, t);
  }

  for (const id of scene.selection) {
    const ref = world.byId.get(id);
    if (!ref) continue;
    const entity = entityOf(world, ref);
    const { w, h } = entityFootprint(entity);
    outline(ctx, scene, entity.x, entity.y, w, h, palette.copper, 2, t);
  }

  if (scene.ghost) drawGhost(ctx, scene, scene.ghost, t);
  else if (scene.hover) outline(ctx, scene, scene.hover.x, scene.hover.y, 1, 1, palette.line, 1, t);

  if (scene.box) {
    const bx = Math.min(scene.box.x0, scene.box.x1);
    const by = Math.min(scene.box.y0, scene.box.y1);
    const bw = Math.abs(scene.box.x1 - scene.box.x0) + 1;
    const bh = Math.abs(scene.box.y1 - scene.box.y0) + 1;
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = palette.copper;
    ctx.fillRect(view.x + bx * t, view.y + by * t, bw * t, bh * t);
    ctx.restore();
    outline(ctx, scene, bx, by, bw, bh, palette.copper, 1, t);
  }
}

function entityOf(world: World, ref: { kind: string; index: number }): BuildEntity {
  switch (ref.kind) {
    case 'belt':
      return world.belts[ref.index]!.entity;
    case 'source':
      return world.sources[ref.index]!.entity;
    case 'machine':
      return world.machines[ref.index]!.entity;
    case 'inserter':
      return world.inserters[ref.index]!.entity;
    case 'chest':
      return world.chests[ref.index]!.entity;
    default:
      return world.sinks[ref.index]!.entity;
  }
}

function drawDots(ctx: CanvasRenderingContext2D, scene: Scene, t: number): void {
  // Dots at tile corners, as on the graph canvas; dropped when zoomed so far
  // out that they would merge into a wash.
  if (t < 10) return;
  const { view, width, height, palette } = scene;
  ctx.fillStyle = palette.dot;
  const startX = ((view.x % t) + t) % t;
  const startY = ((view.y % t) + t) % t;
  const px = 1 / (window.devicePixelRatio || 1);
  for (let x = startX; x < width; x += t) {
    for (let y = startY; y < height; y += t) ctx.fillRect(Math.round(x), Math.round(y), px * 1.5, px * 1.5);
  }
}

function outline(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
  lineWidth: number,
  t: number,
): void {
  const { view } = scene;
  ctx.strokeStyle = colour;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(
    view.x + x * t + lineWidth / 2,
    view.y + y * t + lineWidth / 2,
    w * t - lineWidth,
    h * t - lineWidth,
  );
}

function sprite(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  icon: IconRef,
  cx: number,
  cy: number,
  size: number,
): void {
  const image = scene.sprites;
  if (!image || !image.complete || image.naturalWidth === 0) return;
  const native = scene.index.data.sprite.size;
  // The sheet is drawn at its own pixel size; `icon` is in those pixels.
  const scale = image.naturalWidth / scene.index.data.sprite.width;
  ctx.drawImage(
    image,
    icon.x * scale,
    icon.y * scale,
    native * scale,
    native * scale,
    cx - size / 2,
    cy - size / 2,
    size,
    size,
  );
}

function tileRect(scene: Scene, x: number, y: number, t: number): [number, number] {
  return [scene.view.x + x * t, scene.view.y + y * t];
}

function chevron(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: Dir,
  size: number,
  colour: string,
): void {
  const fx = VX[dir];
  const fy = VY[dir];
  // Perpendicular, for the chevron's arms.
  const px = -fy;
  const py = fx;
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, size / 6);
  ctx.beginPath();
  ctx.moveTo(cx - fx * size * 0.4 + px * size * 0.5, cy - fy * size * 0.4 + py * size * 0.5);
  ctx.lineTo(cx + fx * size * 0.2, cy + fy * size * 0.2);
  ctx.lineTo(cx - fx * size * 0.4 - px * size * 0.5, cy - fy * size * 0.4 - py * size * 0.5);
  ctx.stroke();
}

function beltTier(scene: Scene, beltId: string): number {
  const at = scene.index.data.belts.findIndex((belt) => belt.id === beltId);
  return Math.max(0, at);
}

function drawBelt(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  belt: BuildEntity & { kind: 'belt' },
  entry: Dir,
  t: number,
): void {
  const { palette } = scene;
  const [x, y] = tileRect(scene, belt.x, belt.y, t);
  ctx.fillStyle = palette.panel;
  ctx.fillRect(x + 1, y + 1, t - 2, t - 2);

  // Rails along the two sides items travel between; on a curve, arcs round
  // the corner shared by the entry and exit edges, clipped to the tile.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, t, t);
  ctx.clip();
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (entry === belt.dir) {
    if (belt.dir % 2 === 0) {
      ctx.moveTo(x + 1.5, y);
      ctx.lineTo(x + 1.5, y + t);
      ctx.moveTo(x + t - 1.5, y);
      ctx.lineTo(x + t - 1.5, y + t);
    } else {
      ctx.moveTo(x, y + 1.5);
      ctx.lineTo(x + t, y + 1.5);
      ctx.moveTo(x, y + t - 1.5);
      ctx.lineTo(x + t, y + t - 1.5);
    }
  } else {
    const corner = curveCorner(entry, belt.dir);
    const pcx = x + corner.x * t;
    const pcy = y + corner.y * t;
    ctx.moveTo(pcx + t - 1.5, pcy);
    ctx.arc(pcx, pcy, t - 1.5, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();

  // One chevron per tier, so a turbo belt reads differently from a yellow
  // one without colouring it.
  if (t >= 14) {
    const tiers = beltTier(scene, belt.beltId) + 1;
    const size = t * 0.22;
    for (let i = 0; i < tiers; i += 1) {
      const offset = (i - (tiers - 1) / 2) * size * 0.7;
      chevron(
        ctx,
        x + t / 2 + VX[belt.dir] * offset,
        y + t / 2 + VY[belt.dir] * offset,
        belt.dir,
        size,
        palette.line,
      );
    }
  }
}

/** The tile corner a curve turns about, as a fraction of the tile. */
function curveCorner(entry: Dir, exit: Dir): { x: number; y: number } {
  // Back edge of the entry plus half a tile toward the exit.
  return { x: 0.5 - VX[entry] * 0.5 + VX[exit] * 0.5, y: 0.5 - VY[entry] * 0.5 + VY[exit] * 0.5 };
}

/**
 * Where an item at `pos` on a lane sits, in tile fractions. Straight lanes
 * run a quarter-tile either side of the middle; on a curve each lane follows
 * an arc round the inner corner, outer lane wider.
 */
export function lanePoint(entry: Dir, exit: Dir, lane: 0 | 1, pos: number): { x: number; y: number } {
  const along = Math.min(Math.max(pos / LANE_LENGTH, 0), 1);
  const side = lane === 0 ? leftOf(entry) : rightOf(entry);
  if (entry === exit) {
    return {
      x: 0.5 + VX[entry] * (along - 0.5) + VX[side] * 0.25,
      y: 0.5 + VY[entry] * (along - 0.5) + VY[side] * 0.25,
    };
  }
  const corner = curveCorner(entry, exit);
  // Start point on the entry edge, relative to the corner.
  const sx = 0.5 - VX[entry] * 0.5 + VX[side] * 0.25 - corner.x;
  const sy = 0.5 - VY[entry] * 0.5 + VY[side] * 0.25 - corner.y;
  const clockwise = exit === rightOf(entry);
  const angle = (clockwise ? 1 : -1) * along * (Math.PI / 2);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: corner.x + sx * cos - sy * sin, y: corner.y + sx * sin + sy * cos };
}

function drawLaneItems(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  tile: { x: number; y: number; dir: Dir },
  entry: Dir,
  lanes: [number, number],
  t: number,
): void {
  const size = t * 0.36;
  const [x, y] = tileRect(scene, tile.x, tile.y, t);
  for (let lane = 0; lane < 2; lane += 1) {
    for (const item of scene.world.lanes[lanes[lane]!]!.items) {
      const icon = scene.index.items.get(item.itemId)?.icon;
      if (!icon) continue;
      // Side-loaded items land mid-tile and run straight from there.
      const p = lanePoint(entry, tile.dir, lane as 0 | 1, item.pos);
      sprite(ctx, scene, icon, x + p.x * t, y + p.y * t, size);
    }
  }
}

function drawInserter(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  inserter: World['inserters'][number],
  t: number,
): void {
  const { palette } = scene;
  const { entity } = inserter;
  const [x, y] = tileRect(scene, entity.x, entity.y, t);
  const cx = x + t / 2;
  const cy = y + t / 2;

  ctx.fillStyle = palette.raised;
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 1;
  const base = t * 0.56;
  ctx.fillRect(cx - base / 2, cy - base / 2, base, base);
  ctx.strokeRect(cx - base / 2 + 0.5, cy - base / 2 + 0.5, base - 1, base - 1);
  const icon = scene.index.items.get(entity.inserterId)?.icon;
  if (icon && t >= 14) sprite(ctx, scene, icon, cx, cy, t * 0.5);

  // The arm swings through the inserter's left side, pickup to drop.
  const reach = INSERTER_SPECS[entity.inserterId]?.reach ?? 1;
  const back = Math.atan2(-VY[entity.dir], -VX[entity.dir]);
  const angle = back + armPosition(inserter) * Math.PI;
  const length = reach * t * 0.9;
  const hx = cx + Math.cos(angle) * length;
  const hy = cy + Math.sin(angle) * length;
  ctx.strokeStyle = palette.muted;
  ctx.lineWidth = Math.max(1.5, t / 14);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  const held = inserter.held;
  if (held) {
    const heldIcon = scene.index.items.get(held.itemId)?.icon;
    if (heldIcon) sprite(ctx, scene, heldIcon, hx, hy, t * 0.36);
  }
}

function drawMachine(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  machine: World['machines'][number],
  t: number,
): void {
  const { palette, index, world } = scene;
  const { entity } = machine;
  const { w, h } = entityFootprint(entity);
  const [x, y] = tileRect(scene, entity.x, entity.y, t);
  const pw = w * t;
  const ph = h * t;

  ctx.fillStyle = palette.panel;
  ctx.fillRect(x + 2, y + 2, pw - 4, ph - 4);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 3, y + 3, pw - 6, ph - 6);

  const machineIcon = index.machines.get(entity.machineId)?.icon;
  const recipeIcon = machine.recipe?.icon;
  const iconSize = Math.min(pw, ph) * 0.5;
  if (recipeIcon) sprite(ctx, scene, recipeIcon, x + pw / 2, y + ph / 2, iconSize);
  else if (machineIcon) sprite(ctx, scene, machineIcon, x + pw / 2, y + ph / 2, iconSize);
  if (recipeIcon && machineIcon && t >= 16) {
    sprite(ctx, scene, machineIcon, x + 4 + t * 0.3, y + 4 + t * 0.3, t * 0.6);
  }

  if (!machine.recipe) return;
  // Along the bottom: the current craft's progress, thin, and under it the
  // share of time spent crafting, which goes to --warn when the machine is
  // not keeping up.
  const inset = 6;
  const barW = pw - inset * 2;
  const barH = Math.max(2, t / 10);
  const barY = y + ph - inset - barH;
  ctx.fillStyle = palette.line;
  ctx.fillRect(x + inset, barY, barW, barH);
  if (world.tick > 0) {
    const share = Math.min(1, meterRate(machine.working, world.tick) / 60);
    ctx.fillStyle = share >= KEEPING_UP ? palette.brass : palette.warn;
    ctx.fillRect(x + inset, barY, barW * share, barH);
  }
  if (machine.crafting) {
    const progressH = Math.max(1, barH / 2);
    ctx.fillStyle = palette.muted;
    ctx.fillRect(x + inset, barY - progressH - 2, barW * Math.min(1, machine.progress), progressH);
  }
}

function drawSource(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  source: BuildEntity & { kind: 'source' },
  t: number,
): void {
  const { palette } = scene;
  const [x, y] = tileRect(scene, source.x, source.y, t);
  ctx.fillStyle = palette.raised;
  ctx.fillRect(x + 1, y + 1, t - 2, t - 2);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 1.5, y + 1.5, t - 3, t - 3);
  const icon = scene.index.items.get(source.itemId)?.icon;
  if (icon) sprite(ctx, scene, icon, x + t / 2, y + t / 2, t * 0.55);
  if (t >= 14) {
    chevron(
      ctx,
      x + t / 2 + VX[source.dir] * t * 0.36,
      y + t / 2 + VY[source.dir] * t * 0.36,
      source.dir,
      t * 0.18,
      palette.brass,
    );
  }
}

function drawSink(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  sink: BuildEntity & { kind: 'sink' },
  t: number,
): void {
  const { palette } = scene;
  const [x, y] = tileRect(scene, sink.x, sink.y, t);
  ctx.fillStyle = palette.raised;
  ctx.fillRect(x + 1, y + 1, t - 2, t - 2);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 1.5, y + 1.5, t - 3, t - 3);
  // Concentric squares: everything that arrives goes in.
  const inner = t * 0.22;
  ctx.strokeStyle = palette.muted;
  ctx.strokeRect(x + t / 2 - inner, y + t / 2 - inner, inner * 2, inner * 2);
  ctx.fillStyle = palette.muted;
  ctx.fillRect(x + t / 2 - inner / 3, y + t / 2 - inner / 3, (inner * 2) / 3, (inner * 2) / 3);
}

function drawChest(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  chest: BuildEntity & { kind: 'chest' },
  t: number,
): void {
  const [x, y] = tileRect(scene, chest.x, chest.y, t);
  const icon = scene.index.items.get('steel-chest')?.icon;
  if (icon) sprite(ctx, scene, icon, x + t / 2, y + t / 2, t * 0.85);
}

function drawGhost(ctx: CanvasRenderingContext2D, scene: Scene, ghost: Ghost, t: number): void {
  const { palette, view } = scene;
  ctx.save();
  ctx.globalAlpha = ghost.valid ? 0.55 : 0.3;
  for (const entity of ghost.entities) {
    const { w, h } = entityFootprint(entity);
    const x = view.x + entity.x * t;
    const y = view.y + entity.y * t;
    ctx.fillStyle = palette.raised;
    ctx.fillRect(x + 1, y + 1, w * t - 2, h * t - 2);
    let icon: IconRef | undefined;
    if (entity.kind === 'machine') {
      icon = entity.recipeId
        ? scene.index.recipes.get(entity.recipeId)?.icon
        : scene.index.machines.get(entity.machineId)?.icon;
    } else if (entity.kind === 'source') icon = scene.index.items.get(entity.itemId)?.icon;
    else if (entity.kind === 'inserter') icon = scene.index.items.get(entity.inserterId)?.icon;
    else if (entity.kind === 'chest') icon = scene.index.items.get('steel-chest')?.icon;
    if (icon) sprite(ctx, scene, icon, x + (w * t) / 2, y + (h * t) / 2, Math.min(w, h) * t * 0.5);
    if (entity.kind !== 'machine' && entity.kind !== 'chest' && entity.kind !== 'sink') {
      chevron(
        ctx,
        x + t / 2 + VX[entity.dir] * t * 0.3,
        y + t / 2 + VY[entity.dir] * t * 0.3,
        entity.dir,
        t * 0.22,
        palette.ink,
      );
    }
  }
  ctx.restore();
  for (const entity of ghost.entities) {
    const { w, h } = entityFootprint(entity);
    if (ghost.valid) outline(ctx, scene, entity.x, entity.y, w, h, palette.copper, 1, t);
    else {
      ctx.save();
      ctx.setLineDash([3, 3]);
      outline(ctx, scene, entity.x, entity.y, w, h, palette.muted, 1, t);
      ctx.restore();
    }
  }
}
