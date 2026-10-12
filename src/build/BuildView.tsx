import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGameData } from '../data/context.ts';
import { useGraphStore } from '../graph/store.ts';
import type { SolveResult } from '../solver/types.ts';
import { entityAt } from '../sim/world.ts';
import { Search, type SearchChoice } from '../ui/Search.tsx';
import { Sprite } from '../ui/Sprite.tsx';
import { isTyping } from '../ui/keys.ts';
import {
  EraseIcon,
  PauseIcon,
  PlayIcon,
  PointerIcon,
  ResetIcon,
  SinkIcon,
  SourceIcon,
  StepIcon,
} from '../ui/icons.tsx';
import { BuildCanvas } from './BuildCanvas.tsx';
import { BuildInspector } from './BuildInspector.tsx';
import { formatClock } from './names.ts';
import {
  INSERTER_SPECS,
  buildableMachinesFor,
  defaultBuildMachine,
  rotate,
  splitterItem,
  undergroundItem,
} from './entities.ts';
import { rotateStamp, stampOf } from './edit.ts';
import type { Tool } from './tools.ts';
import { SPEEDS, useSimulation, type BuildWorld } from './useSimulation.ts';
import type { BuildEntity, Dir, Tile } from './types.ts';
import styles from './BuildView.module.css';

interface Props {
  /** Lays every recipe in the plan out as rows joined by belts. */
  onBuildPlan: () => void;
  /** The plan's simulated world, owned by the editor so it outlives this view. */
  buildWorld: BuildWorld;
  /** The plan's solve, for the report's side-by-side. */
  result: SolveResult | null;
  /** True while a dialog owns the keyboard: the help sheet or the plan list. */
  keysBlocked: boolean;
  say: (message: string) => void;
}

/** The tool buttons, in the order the number keys pick them. */
const TOOL_ORDER = ['select', 'belt', 'inserter', 'machine', 'source', 'sink', 'chest', 'erase'] as const;
type ToolKind = (typeof TOOL_ORDER)[number];

const ARROWS = ['↑', '→', '↓', '←'] as const;

/**
 * Picking a recipe or item, either for the tool or for an entity already
 * built. `field` is which of the entity's fields an item goes into.
 */
type Picking = {
  scope: 'build-recipe' | 'build-item';
  entityId: string | null;
  field?: 'itemId' | 'filter';
} | null;

/** What the belt tool lays: plain belt, an underground end, or a splitter. */
type BeltShape = 'belt' | 'underground' | 'splitter';
const SHAPES: BeltShape[] = ['belt', 'underground', 'splitter'];
const SHAPE_NAMES: Record<BeltShape, string> = {
  belt: 'Belt',
  underground: 'Underground belt',
  splitter: 'Splitter',
};

export function BuildView({ onBuildPlan, buildWorld, result, keysBlocked, say }: Props): JSX.Element {
  const index = useGameData();
  const build = useGraphStore((state) => state.build);
  const selection = useGraphStore((state) => state.buildSelection);
  const sim = useSimulation(buildWorld);

  const [beltId, setBeltId] = useState(index.data.defaults.beltId ?? 'transport-belt');
  const [shape, setShape] = useState<BeltShape>('belt');
  const [inserterId, setInserterId] = useState('fast-inserter');
  const [machinePick, setMachinePick] = useState<{ machineId: string; recipeId: string } | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [kind, setKind] = useState<ToolKind | 'paste'>('select');
  const [stamp, setStamp] = useState<ReturnType<typeof stampOf> | null>(null);
  const [dir, setDir] = useState<Dir>(1);
  const [picking, setPicking] = useState<Picking>(null);
  const hoverRef = useRef<Tile | null>(null);

  // One object per distinct tool, so the canvas can cache by identity.
  const tool = useMemo<Tool>(() => {
    switch (kind) {
      case 'belt':
        return { kind: shape, beltId };
      case 'inserter':
        return { kind, inserterId };
      case 'machine':
        return machinePick ? { kind, ...machinePick } : { kind: 'select' };
      case 'source':
        return itemId ? { kind, itemId } : { kind: 'select' };
      case 'paste':
        return stamp ? { kind, stamp } : { kind: 'select' };
      default:
        return { kind };
    }
  }, [kind, shape, beltId, inserterId, machinePick, itemId, stamp]);

  const chooseTool = useCallback(
    (next: ToolKind) => {
      // Machines and sources need something to make or supply first.
      if (next === 'machine' && !machinePick) setPicking({ scope: 'build-recipe', entityId: null });
      else if (next === 'source' && !itemId) setPicking({ scope: 'build-item', entityId: null });
      // Asking for the belt tool again steps through its shapes.
      else if (next === 'belt' && kind === 'belt') {
        setShape((current) => SHAPES[(SHAPES.indexOf(current) + 1) % SHAPES.length]!);
      } else setKind(next);
    },
    [machinePick, itemId, kind],
  );

  const onChoose = useCallback(
    (choice: SearchChoice) => {
      const target = picking;
      setPicking(null);
      if (!target) return;
      const store = useGraphStore.getState();
      if (choice.kind === 'recipe') {
        const recipe = index.recipes.get(choice.recipeId);
        const machineId = recipe ? defaultBuildMachine(index, recipe) : null;
        if (!recipe || !machineId) return;
        if (target.entityId) {
          const existing = store.build.entities.find((entity) => entity.id === target.entityId);
          // Keep the machine if it can make the new recipe; otherwise swap it,
          // which only fits if the new one is the same size.
          const keep =
            existing?.kind === 'machine' && buildableMachinesFor(recipe).includes(existing.machineId);
          store.updateEntity(target.entityId, {
            recipeId: recipe.id,
            ...(keep ? {} : { machineId }),
          } as Partial<BuildEntity>);
        } else {
          setMachinePick({ machineId, recipeId: recipe.id });
          setKind('machine');
        }
      } else if (choice.kind === 'source') {
        if (target.entityId) {
          store.updateEntity(target.entityId, {
            [target.field ?? 'itemId']: choice.itemId,
          } as Partial<BuildEntity>);
        }
        else {
          setItemId(choice.itemId);
          setKind('source');
        }
      }
    },
    [index, picking],
  );

  const copy = useCallback(
    (cut: boolean) => {
      const store = useGraphStore.getState();
      const chosen = new Set(store.buildSelection);
      const entities = store.build.entities.filter((entity) => chosen.has(entity.id));
      if (entities.length === 0) return;
      setStamp(stampOf(entities));
      if (cut) store.removeEntities([...chosen]);
      say(cut ? 'Cut. Ctrl V to place it.' : 'Copied. Ctrl V to place it.');
    },
    [say],
  );

  // --- keyboard ------------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (keysBlocked || picking || isTyping(event.target)) return;
      const store = useGraphStore.getState();
      const control = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const hovered = hoverRef.current ? entityAt(sim.world(), hoverRef.current) : null;

      if (control) {
        if (key === 'c' || key === 'x') {
          event.preventDefault();
          copy(key === 'x');
        } else if (key === 'v') {
          event.preventDefault();
          if (stamp) setKind('paste');
        } else if (key === 'a') {
          event.preventDefault();
          store.setBuildSelection(store.build.entities.map((entity) => entity.id));
        }
        return;
      }
      if (event.altKey) return;

      const number = Number.parseInt(event.key, 10);
      if (number >= 1 && number <= TOOL_ORDER.length) {
        event.preventDefault();
        chooseTool(TOOL_ORDER[number - 1]!);
      } else if (key === 'r') {
        event.preventDefault();
        if (kind === 'paste' && stamp) {
          setStamp(event.shiftKey ? rotateStamp(rotateStamp(rotateStamp(stamp))) : rotateStamp(stamp));
        } else if ((kind === 'select' || kind === 'erase') && hovered) {
          store.rotateEntity(hovered.id);
        } else {
          setDir((current) => rotate(current, event.shiftKey ? -1 : 1));
        }
      } else if (key === 'q') {
        // Pipette: pick up the tool for whatever is under the pointer.
        event.preventDefault();
        if (!hovered) {
          setKind('select');
          return;
        }
        setDir(hovered.dir);
        if (hovered.kind === 'belt' || hovered.kind === 'underground' || hovered.kind === 'splitter') {
          setBeltId(hovered.beltId);
          setShape(hovered.kind);
          setKind('belt');
        } else if (hovered.kind === 'inserter') {
          setInserterId(hovered.inserterId);
          setKind('inserter');
        } else if (hovered.kind === 'machine' && hovered.recipeId) {
          setMachinePick({ machineId: hovered.machineId, recipeId: hovered.recipeId });
          setKind('machine');
        } else if (hovered.kind === 'source') {
          setItemId(hovered.itemId);
          setKind('source');
        } else if (hovered.kind === 'sink' || hovered.kind === 'chest') {
          setKind(hovered.kind);
        }
      } else if (key === 'b' && event.shiftKey) {
        event.preventDefault();
        onBuildPlan();
      } else if (key === 'p') {
        event.preventDefault();
        sim.setRunning(!sim.running);
      } else if (event.key === '.') {
        event.preventDefault();
        sim.setRunning(false);
        sim.step(1);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        store.removeEntities(store.buildSelection);
      } else if (event.key === 'Escape') {
        if (kind !== 'select') setKind('select');
        else store.setBuildSelection([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chooseTool, copy, keysBlocked, kind, onBuildPlan, picking, sim, stamp]);

  const world = sim.world();
  const sprite = (id: string, size = 20): JSX.Element | null => {
    const icon = index.items.get(id)?.icon;
    return icon ? <Sprite icon={icon} size={size} /> : null;
  };

  const toolButton = (
    which: ToolKind,
    label: string,
    glyph: JSX.Element | null,
    position: number,
  ): JSX.Element => (
    <button
      key={which}
      type="button"
      className={[styles.tool, kind === which ? styles.toolOn : ''].join(' ')}
      aria-pressed={kind === which}
      aria-label={`${label} (${position})`}
      title={`${label} (${position})`}
      onClick={() => chooseTool(which)}
    >
      {glyph}
    </button>
  );

  const recipe = machinePick ? index.recipes.get(machinePick.recipeId) : undefined;

  return (
    <div className={styles.view}>
      <div className={styles.main}>
        <div className={styles.toolbar} role="toolbar" aria-label="Build tools">
          <div className={styles.group}>
            {toolButton('select', 'Select', <PointerIcon />, 1)}
            {toolButton('belt', 'Belt', sprite(shapeItem(shape, beltId)), 2)}
            {toolButton('inserter', 'Inserter', sprite(inserterId), 3)}
            {toolButton('machine', 'Machine', recipe ? <Sprite icon={recipe.icon} size={20} /> : sprite('assembling-machine-2'), 4)}
            {toolButton('source', 'Source', itemId ? sprite(itemId) : <SourceIcon />, 5)}
            {toolButton('sink', 'Sink', <SinkIcon />, 6)}
            {toolButton('chest', 'Chest', sprite('steel-chest'), 7)}
            {toolButton('erase', 'Remove', <EraseIcon />, 8)}
          </div>

          <span className={styles.divider} />

          <div className={styles.variants}>
            {kind === 'belt' ? (
              <>
                {SHAPES.map((which) => (
                  <button
                    key={which}
                    type="button"
                    className={[styles.variant, shape === which ? styles.variantOn : ''].join(' ')}
                    title={`${SHAPE_NAMES[which]} (2 again to switch)`}
                    aria-label={SHAPE_NAMES[which]}
                    aria-pressed={shape === which}
                    onClick={() => setShape(which)}
                  >
                    {sprite(shapeItem(which, beltId), 18)}
                  </button>
                ))}
                <span className={styles.divider} />
                {index.data.belts.map((belt) => {
                  const name = index.items.get(shapeItem(shape, belt.id))?.name ?? belt.name;
                  return (
                    <button
                      key={belt.id}
                      type="button"
                      className={[styles.variant, beltId === belt.id ? styles.variantOn : ''].join(' ')}
                      title={name}
                      aria-label={name}
                      aria-pressed={beltId === belt.id}
                      onClick={() => setBeltId(belt.id)}
                    >
                      {sprite(shapeItem(shape, belt.id), 18)}
                    </button>
                  );
                })}
              </>
            ) : null}
            {kind === 'inserter'
              ? index.data.inserters
                  .filter((spec) => spec.id in INSERTER_SPECS)
                  .map((spec) => (
                    <button
                      key={spec.id}
                      type="button"
                      className={[styles.variant, inserterId === spec.id ? styles.variantOn : ''].join(' ')}
                      title={spec.name}
                      aria-label={spec.name}
                      aria-pressed={inserterId === spec.id}
                      onClick={() => setInserterId(spec.id)}
                    >
                      <Sprite icon={spec.icon} size={18} />
                    </button>
                  ))
              : null}
            {kind === 'machine' && recipe && machinePick ? (
              <>
                <button
                  type="button"
                  className={styles.choice}
                  onClick={() => setPicking({ scope: 'build-recipe', entityId: null })}
                  title="Change recipe"
                >
                  <Sprite icon={recipe.icon} size={18} />
                  <span>{recipe.name}</span>
                </button>
                {buildableMachinesFor(recipe).map((machineId) => {
                  const machine = index.machines.get(machineId);
                  if (!machine) return null;
                  return (
                    <button
                      key={machineId}
                      type="button"
                      className={[
                        styles.variant,
                        machinePick.machineId === machineId ? styles.variantOn : '',
                      ].join(' ')}
                      title={machine.name}
                      aria-label={machine.name}
                      aria-pressed={machinePick.machineId === machineId}
                      onClick={() => setMachinePick({ ...machinePick, machineId })}
                    >
                      <Sprite icon={machine.icon} size={18} />
                    </button>
                  );
                })}
              </>
            ) : null}
            {kind === 'source' && itemId ? (
              <button
                type="button"
                className={styles.choice}
                onClick={() => setPicking({ scope: 'build-item', entityId: null })}
                title="Change item"
              >
                {sprite(itemId, 18)}
                <span>{index.items.get(itemId)?.name ?? itemId}</span>
              </button>
            ) : null}
            {kind === 'paste' && stamp ? (
              <span className={styles.hint}>
                Click to place {stamp.entities.length} {stamp.entities.length === 1 ? 'entity' : 'entities'}. R
                turns it.
              </span>
            ) : null}
            {kind === 'select' ? (
              <span className={styles.hint}>Drag to select. Right-click removes.</span>
            ) : null}
            {kind !== 'select' && kind !== 'erase' && kind !== 'paste' && kind !== 'chest' ? (
              <button
                type="button"
                className={styles.rotate}
                title="Rotate (R)"
                aria-label="Rotate (R)"
                onClick={() => setDir((current) => rotate(current, 1))}
              >
                {ARROWS[dir]}
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className={styles.planButton}
            title="Lay out every recipe in the plan, joined by belts (Shift B)"
            onClick={onBuildPlan}
          >
            Lay out plan
          </button>
          <div className={styles.sim}>
            <button type="button" className={styles.tool} title="Reset: empty everything" aria-label="Reset simulation" onClick={sim.reset}>
              <ResetIcon />
            </button>
            <button
              type="button"
              className={[styles.tool, sim.running ? styles.toolOn : ''].join(' ')}
              title={sim.running ? 'Pause (P)' : 'Play (P)'}
              aria-label={sim.running ? 'Pause (P)' : 'Play (P)'}
              onClick={() => sim.setRunning(!sim.running)}
            >
              {sim.running ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              className={styles.tool}
              title="Step one tick (.)"
              aria-label="Step one tick"
              onClick={() => {
                sim.setRunning(false);
                sim.step(1);
              }}
            >
              <StepIcon />
            </button>
            <span className={styles.speeds} role="radiogroup" aria-label="Simulation speed">
              {SPEEDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={sim.speed === value}
                  className={[styles.speed, sim.speed === value ? styles.speedOn : ''].join(' ')}
                  onClick={() => sim.setSpeed(value)}
                >
                  <span className="mono">{value}×</span>
                </button>
              ))}
            </span>
            <span className={`mono ${styles.clock}`} aria-label="Simulated time">
              {formatClock(world.tick)}
            </span>
          </div>
        </div>
        <BuildCanvas
          build={build}
          world={sim.world}
          tool={tool}
          dir={dir}
          selection={selection}
          hoverRef={hoverRef}
          onDirChange={setDir}
          onRefused={() => say('Something is in the way.')}
        />
      </div>
      <BuildInspector
        world={world}
        selection={selection}
        result={result}
        onPick={(entityId, scope, field) => setPicking({ entityId, scope, field })}
      />
      <Search
        open={picking !== null}
        intent={{ kind: 'anything' }}
        scope={picking?.scope ?? 'build-recipe'}
        onClose={() => setPicking(null)}
        onChoose={onChoose}
      />
    </div>
  );
}

/** The game item a belt-tool shape places at a tier, for its sprite and name. */
function shapeItem(shape: BeltShape, beltId: string): string {
  if (shape === 'underground') return undergroundItem(beltId);
  if (shape === 'splitter') return splitterItem(beltId);
  return beltId;
}
