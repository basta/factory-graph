import { useEffect, useLayoutEffect, useRef } from 'react';
import { useGameData } from '../data/context.ts';
import { assetUrl } from '../data/assetUrl.ts';
import { useGraphStore } from '../graph/store.ts';
import { entityAt, type World } from '../sim/world.ts';
import { entityFootprint } from './entities.ts';
import { placeEntities } from './edit.ts';
import { TILE, draw, readPalette, type Ghost, type Palette, type View } from './draw.ts';
import { entityFor, isPlacing, pasteAt, walk, type Tool } from './tools.ts';
import { dirBetween, type Build, type Dir, type Tile } from './types.ts';
import styles from './BuildView.module.css';

interface Props {
  build: Build;
  world: () => World;
  tool: Tool;
  dir: Dir;
  selection: string[];
  /** The canvas reports the tile under the pointer here, for R and Q. */
  hoverRef: React.MutableRefObject<Tile | null>;
  onDirChange: (dir: Dir) => void;
  onRefused: () => void;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; viewX: number; viewY: number }
  | { kind: 'place'; last: Tile; /** Id of the belt laid on `last`, so a turn can re-aim it. */ lastBelt: string | null }
  | { kind: 'erase' }
  | { kind: 'box'; from: Tile; to: Tile; additive: boolean };

/**
 * The build canvas. Drawing runs on its own animation frame and reads the
 * world directly, so a running simulation never goes through React; pointer
 * input turns into store edits, which do.
 */
export function BuildCanvas({
  build,
  world,
  tool,
  dir,
  selection,
  hoverRef,
  onDirChange,
  onRefused,
}: Props): JSX.Element {
  const index = useGameData();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const spaceRef = useRef(false);
  const dirtyRef = useRef(true);
  const sizeRef = useRef({ width: 0, height: 0 });
  const paletteRef = useRef<Palette | null>(null);
  const spritesRef = useRef<HTMLImageElement | null>(null);
  const ghostRef = useRef<{
    x: number;
    y: number;
    dir: Dir;
    tool: Tool;
    build: Build;
    ghost: Ghost | null;
  } | null>(null);

  // Everything the frame loop and the pointer handlers read, kept current
  // without re-subscribing them on every render.
  const live = useRef({ build, world, tool, dir, selection, onDirChange, onRefused });
  useLayoutEffect(() => {
    live.current = { build, world, tool, dir, selection, onDirChange, onRefused };
    dirtyRef.current = true;
  });

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      dirtyRef.current = true;
    };
    image.src = assetUrl(index.data.sprite.url);
    spritesRef.current = image;
  }, [index]);

  // --- size and the frame loop ----------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    paletteRef.current = readPalette();

    const resize = (): void => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      sizeRef.current = { width: rect.width, height: rect.height };
      if (!viewRef.current) viewRef.current = initialView(live.current.build, rect.width, rect.height);
      dirtyRef.current = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    /** The translucent preview under the pointer, cached until something it depends on changes. */
    const ghostFor = (): Ghost | null => {
      const hover = hoverRef.current;
      const { tool: current, dir: facing, build: layout } = live.current;
      if (!hover || gestureRef.current?.kind === 'pan') return null;
      const cached = ghostRef.current;
      if (
        cached &&
        cached.x === hover.x &&
        cached.y === hover.y &&
        cached.dir === facing &&
        cached.tool === current &&
        cached.build === layout
      ) {
        return cached.ghost;
      }
      let entities = null;
      if (isPlacing(current)) entities = [entityFor(current, hover, facing, 'ghost')];
      else if (current.kind === 'paste') entities = pasteAt(current.stamp, hover);
      const ghost = entities
        ? { entities, valid: placeEntities(layout, entities).placed.every((id) => id !== null) }
        : null;
      ghostRef.current = { x: hover.x, y: hover.y, dir: facing, tool: current, build: layout, ghost };
      return ghost;
    };

    let frame = 0;
    let lastTick = -1;
    const paint = (): void => {
      const current = live.current.world();
      if (dirtyRef.current || current.tick !== lastTick) {
        dirtyRef.current = false;
        lastTick = current.tick;
        const ctx = canvas.getContext('2d');
        const view = viewRef.current;
        if (ctx && view && paletteRef.current) {
          const dpr = window.devicePixelRatio || 1;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.imageSmoothingEnabled = true;
          const gesture = gestureRef.current;
          draw(ctx, {
            world: current,
            index,
            view,
            palette: paletteRef.current,
            sprites: spritesRef.current,
            selection: new Set(live.current.selection),
            ghost: ghostFor(),
            box: gesture?.kind === 'box'
              ? { x0: gesture.from.x, y0: gesture.from.y, x1: gesture.to.x, y1: gesture.to.y }
              : null,
            hover: hoverRef.current,
            width: sizeRef.current.width,
            height: sizeRef.current.height,
          });
        }
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // The loop reads everything else through refs.
  }, [hoverRef, index]);

  // --- input -------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const tileAt = (event: { clientX: number; clientY: number }): Tile => {
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current!;
      const t = TILE * view.zoom;
      return {
        x: Math.floor((event.clientX - rect.left - view.x) / t),
        y: Math.floor((event.clientY - rect.top - view.y) / t),
      };
    };

    const store = useGraphStore.getState;

    const eraseAt = (tile: Tile): void => {
      const entity = entityAt(live.current.world(), tile);
      if (entity) store().removeEntities([entity.id]);
    };

    /** Places one step of a drag. Belts are re-aimed so a dragged line turns corners. */
    const placeAt = (tile: Tile, gesture: Extract<Gesture, { kind: 'place' }>, first: boolean): void => {
      const current = live.current.tool;
      if (!isPlacing(current)) return;
      let facing = live.current.dir;
      if (!first && current.kind === 'belt') {
        const moved = dirBetween(gesture.last, tile);
        if (moved !== null) {
          facing = moved;
          if (gesture.lastBelt) store().updateEntity(gesture.lastBelt, { dir: moved });
          if (moved !== live.current.dir) live.current.onDirChange(moved);
        }
      }
      const [placed] = store().placeEntities([entityFor(current, tile, facing)]);
      if (first && placed === null) live.current.onRefused();
      gesture.last = tile;
      gesture.lastBelt = current.kind === 'belt' ? (placed ?? null) : null;
    };

    const onPointerDown = (event: PointerEvent): void => {
      const view = viewRef.current;
      if (!view) return;
      canvas.focus({ preventScroll: true });
      const tile = tileAt(event);
      const current = live.current.tool;
      const target = entityAt(live.current.world(), tile);

      const pan = event.button === 1 || (event.button === 0 && spaceRef.current) ||
        (event.button === 2 && !target);
      if (pan) {
        gestureRef.current = {
          kind: 'pan',
          startX: event.clientX,
          startY: event.clientY,
          viewX: view.x,
          viewY: view.y,
        };
      } else if (event.button === 2 || (event.button === 0 && current.kind === 'erase')) {
        // Right-click removes, as it mines in the game.
        store().beginBatch();
        gestureRef.current = { kind: 'erase' };
        eraseAt(tile);
      } else if (event.button === 0 && current.kind === 'select') {
        if (target) {
          const selected = live.current.selection;
          if (event.shiftKey) {
            store().setBuildSelection(
              selected.includes(target.id)
                ? selected.filter((id) => id !== target.id)
                : [...selected, target.id],
            );
          } else {
            store().setBuildSelection([target.id]);
          }
        } else {
          gestureRef.current = { kind: 'box', from: tile, to: tile, additive: event.shiftKey };
        }
      } else if (event.button === 0 && current.kind === 'paste') {
        const placed = store().placeEntities(pasteAt(current.stamp, tile));
        if (placed.some((id) => id === null)) live.current.onRefused();
      } else if (event.button === 0 && isPlacing(current)) {
        store().beginBatch();
        const gesture: Extract<Gesture, { kind: 'place' }> = { kind: 'place', last: tile, lastBelt: null };
        gestureRef.current = gesture;
        placeAt(tile, gesture, true);
      } else {
        return;
      }
      canvas.setPointerCapture(event.pointerId);
      dirtyRef.current = true;
    };

    const onPointerMove = (event: PointerEvent): void => {
      const tile = tileAt(event);
      const hover = hoverRef.current;
      if (!hover || hover.x !== tile.x || hover.y !== tile.y) {
        hoverRef.current = tile;
        dirtyRef.current = true;
      }
      const gesture = gestureRef.current;
      if (!gesture) return;
      const view = viewRef.current!;
      if (gesture.kind === 'pan') {
        view.x = gesture.viewX + event.clientX - gesture.startX;
        view.y = gesture.viewY + event.clientY - gesture.startY;
        dirtyRef.current = true;
      } else if (gesture.kind === 'erase') {
        eraseAt(tile);
      } else if (gesture.kind === 'box') {
        if (gesture.to.x !== tile.x || gesture.to.y !== tile.y) {
          gesture.to = tile;
          dirtyRef.current = true;
        }
      } else if (gesture.kind === 'place') {
        if (gesture.last.x === tile.x && gesture.last.y === tile.y) return;
        for (const next of walk(gesture.last, tile)) placeAt(next, gesture, false);
      }
    };

    const onPointerUp = (event: PointerEvent): void => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (!gesture) return;
      if (gesture.kind === 'place' || gesture.kind === 'erase') store().endBatch();
      if (gesture.kind === 'box') {
        const x0 = Math.min(gesture.from.x, gesture.to.x);
        const x1 = Math.max(gesture.from.x, gesture.to.x);
        const y0 = Math.min(gesture.from.y, gesture.to.y);
        const y1 = Math.max(gesture.from.y, gesture.to.y);
        const inside = live.current.build.entities
          .filter((entity) => {
            const { w, h } = entityFootprint(entity);
            return entity.x + w - 1 >= x0 && entity.x <= x1 && entity.y + h - 1 >= y0 && entity.y <= y1;
          })
          .map((entity) => entity.id);
        const base = gesture.additive ? live.current.selection : [];
        store().setBuildSelection([...new Set([...base, ...inside])]);
      }
      dirtyRef.current = true;
    };

    const onLeave = (): void => {
      if (gestureRef.current) return;
      hoverRef.current = null;
      dirtyRef.current = true;
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const view = viewRef.current;
      if (!view) return;
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * Math.exp(-event.deltaY * 0.0015)));
      // Keep the point under the cursor where it is.
      view.x = px - ((px - view.x) * zoom) / view.zoom;
      view.y = py - ((py - view.y) * zoom) / view.zoom;
      view.zoom = zoom;
      dirtyRef.current = true;
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === ' ') spaceRef.current = event.type === 'keydown';
    };
    const onContextMenu = (event: MouseEvent): void => event.preventDefault();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [hoverRef]);

  return (
    <div ref={containerRef} className={styles.canvasWrap}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        tabIndex={-1}
        aria-label="Build grid"
        data-testid="build-canvas"
      />
    </div>
  );
}

/** Frames the build, or puts tile 0,0 in the middle of an empty one. */
function initialView(build: Build, width: number, height: number): View {
  if (build.entities.length === 0) {
    return { x: Math.round(width / 2), y: Math.round(height / 2), zoom: 1 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const entity of build.entities) {
    const { w, h } = entityFootprint(entity);
    minX = Math.min(minX, entity.x);
    minY = Math.min(minY, entity.y);
    maxX = Math.max(maxX, entity.x + w);
    maxY = Math.max(maxY, entity.y + h);
  }
  const zoom = Math.min(
    2,
    Math.max(MIN_ZOOM, Math.min(width / ((maxX - minX + 4) * TILE), height / ((maxY - minY + 4) * TILE))),
  );
  const t = TILE * zoom;
  return {
    x: Math.round(width / 2 - ((minX + maxX) / 2) * t),
    y: Math.round(height / 2 - ((minY + maxY) / 2) * t),
    zoom,
  };
}
