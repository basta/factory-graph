/**
 * Transforms FactorioLab's dataset into our `GameData` shape.
 *
 *   npx tsx scripts/import-factoriolab.ts
 *
 * Reads `vendor/factoriolab/<set>/` (data.json + icons.webp, fetched from
 * github.com/factoriolab/factoriolab `public/data/<set>/`) and writes
 * `public/data/<set>.json` + `public/sprites/<set>.webp`. Both the script and
 * its output are committed; the app never fetches from FactorioLab at runtime.
 *
 * FactorioLab data is CC-BY-SA / MIT per that repository; see README.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  gameDataSchema,
  type EffectName,
  type GameData,
  type IconRef,
  type RecipePort,
} from '../src/data/schema.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SET_ID = '2x1';
const SET_NAME = 'Space Age';
/** Icons are 64px on a 66px pitch in FactorioLab's sheet. */
const ICON_SIZE = 64;

/** Effects we model. FactorioLab uses the same names. */
const EFFECTS = new Set<string>([
  'speed',
  'productivity',
  'consumption',
  'pollution',
  'quality',
]);

// --- FactorioLab's shape, only the parts we read ----------------------------

interface FlIcon {
  id: string;
  x: number;
  y: number;
  color?: string;
}
interface FlMachine {
  speed: number;
  modules?: number;
  type?: string;
  usage?: number;
  drain?: number;
  pollution?: number;
  disallowedEffects?: string[];
  baseEffect?: Record<string, number>;
}
interface FlModule {
  speed?: number;
  productivity?: number;
  consumption?: number;
  pollution?: number;
  quality?: number;
}
interface FlBeacon {
  effectivity: number;
  modules: number;
  usage?: number;
  disallowedEffects?: string[];
  profile?: number[];
}
interface FlItem {
  id: string;
  name: string;
  category: string;
  stack?: number;
  icon?: string;
  iconText?: string;
  machine?: FlMachine;
  module?: FlModule;
  beacon?: FlBeacon;
  belt?: { speed: number };
  pipe?: { speed: number | string };
  inserter?: { speed: number | string };
}
interface FlRecipe {
  id: string;
  name: string;
  category: string;
  time: number;
  producers?: string[];
  in: Record<string, number>;
  out: Record<string, number>;
  catalyst?: Record<string, number>;
  disallowedEffects?: string[];
  flags?: string[];
  icon?: string;
  iconText?: string;
}
interface FlData {
  version: Record<string, string>;
  icons: FlIcon[];
  items: FlItem[];
  recipes: FlRecipe[];
  defaults?: {
    beacon?: string;
    belt?: string;
    pipe?: string;
    presets?: { id: number; machineRank?: string[] }[];
  };
}

// --- helpers ----------------------------------------------------------------

/** FactorioLab stores exact values as rational strings, e.g. `"2160/7"`. */
function num(value: number | string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return value;
  const slash = value.indexOf('/');
  if (slash === -1) return Number(value);
  return Number(value.slice(0, slash)) / Number(value.slice(slash + 1));
}

function effects(list: string[] | undefined): EffectName[] {
  return (list ?? []).filter((e): e is EffectName => EFFECTS.has(e));
}

function main(): void {
  const src = resolve(ROOT, 'vendor/factoriolab', SET_ID);
  const fl = JSON.parse(readFileSync(resolve(src, 'data.json'), 'utf8')) as FlData;

  const iconById = new Map<string, FlIcon>(fl.icons.map((i) => [i.id, i]));
  const itemById = new Map<string, FlItem>(fl.items.map((i) => [i.id, i]));

  /**
   * Resolves an icon by explicit ref, then own id, then the fallback chain
   * (a recipe with no sprite of its own borrows its first output's).
   */
  function icon(
    ownId: string,
    explicit: string | undefined,
    text: string | undefined,
    ...fallbacks: string[]
  ): IconRef {
    for (const key of [explicit, ownId, ...fallbacks]) {
      if (key === undefined) continue;
      const found = iconById.get(key);
      if (found) {
        return {
          x: found.x,
          y: found.y,
          color: found.color ?? null,
          text: text ?? null,
        };
      }
    }
    throw new Error(`no icon for ${ownId}`);
  }

  const isFluid = (id: string): boolean => itemById.get(id)?.category === 'fluids';

  // --- items ---------------------------------------------------------------

  const items = fl.items.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    stackSize: i.stack ?? null,
    isFluid: i.category === 'fluids',
    icon: icon(i.id, i.icon, i.iconText),
  }));

  // --- recipes -------------------------------------------------------------

  const recipes = fl.recipes.map((r) => {
    const catalyst = r.catalyst ?? {};
    const port = (itemId: string, amount: number): RecipePort => ({
      itemId,
      amount,
      // FactorioLab pre-multiplies chance into the amount, so probability is 1
      // and `amount` is the expected value. `probabilistic` flags it for the UI.
      probability: 1,
      // A catalyst entry caps at the amount on this side: coal liquefaction
      // lists 25 heavy oil catalyst against 25 in / 90 out.
      catalyst: Math.min(catalyst[itemId] ?? 0, amount),
    });

    const outputs = Object.entries(r.out).map(([id, amount]) => port(id, amount));
    const inputs = Object.entries(r.in).map(([id, amount]) => port(id, amount));

    // A non-integer output amount in a non-fluid, non-mining recipe means
    // FactorioLab averaged a chance roll (uranium processing, recycling).
    const probabilistic = outputs.some(
      (o) => !isFluid(o.itemId) && Math.abs(o.amount - Math.round(o.amount)) > 1e-9,
    );

    return {
      id: r.id,
      name: r.name,
      category: r.category,
      time: r.time,
      inputs,
      outputs,
      producers: r.producers ?? [],
      disallowedEffects: effects(r.disallowedEffects),
      probabilistic,
      flags: r.flags ?? [],
      icon: icon(
        r.id,
        r.icon,
        r.iconText,
        ...outputs.map((o) => o.itemId),
        ...inputs.map((i) => i.itemId),
      ),
    };
  });

  // --- machines, modules, beacons, transport --------------------------------

  const machines = fl.items
    .filter((i) => i.machine)
    .map((i) => {
      const m = i.machine as FlMachine;
      return {
        id: i.id,
        name: i.name,
        craftingSpeed: m.speed,
        moduleSlots: m.modules ?? 0,
        energyUsageKw: m.type === 'electric' ? (m.usage ?? 0) : 0,
        drainKw: m.type === 'electric' ? (m.drain ?? 0) : 0,
        pollutionPerMin: m.pollution ?? 0,
        baseProductivity: m.baseEffect?.productivity ?? 0,
        disallowedEffects: effects(m.disallowedEffects),
        energySource: m.type ?? null,
        icon: icon(i.id, i.icon, i.iconText),
      };
    });

  const modules = fl.items
    .filter((i) => i.module)
    .map((i) => {
      const m = i.module as FlModule;
      return {
        id: i.id,
        name: i.name,
        speed: m.speed ?? 0,
        productivity: m.productivity ?? 0,
        consumption: m.consumption ?? 0,
        pollution: m.pollution ?? 0,
        quality: m.quality ?? 0,
        icon: icon(i.id, i.icon, i.iconText),
      };
    });

  const beacons = fl.items
    .filter((i) => i.beacon)
    .map((i) => {
      const b = i.beacon as FlBeacon;
      return {
        id: i.id,
        name: i.name,
        effectivity: b.effectivity,
        moduleSlots: b.modules,
        energyUsageKw: b.usage ?? 0,
        disallowedEffects: effects(b.disallowedEffects),
        profile: b.profile ?? [],
        icon: icon(i.id, i.icon, i.iconText),
      };
    });

  const belts = fl.items
    .filter((i) => i.belt)
    .map((i) => ({
      id: i.id,
      name: i.name,
      itemsPerSec: num((i.belt as { speed: number }).speed),
      icon: icon(i.id, i.icon, i.iconText),
    }));

  // FactorioLab only records throughput for the pump; plain pipes have none.
  // Factorio 2.0's pipes carry ~1000 units/s over a short run, which is the
  // number every calculator uses for a saturation warning.
  const PIPE_DEFAULT_PER_SEC = 1000;
  const pipes = [
    {
      id: 'pipe',
      name: 'Pipe',
      fluidPerSec: PIPE_DEFAULT_PER_SEC,
      icon: icon('pipe', undefined, undefined),
    },
    ...fl.items
      .filter((i) => i.pipe)
      .map((i) => ({
        id: i.id,
        name: i.name,
        fluidPerSec: num((i.pipe as { speed: number | string }).speed),
        icon: icon(i.id, i.icon, i.iconText),
      })),
  ];

  // FactorioLab stores inserter throughput in items per minute at the maximum
  // capacity bonus. We warn in items/s, so divide by 60.
  const inserters = fl.items
    .filter((i) => i.inserter)
    .map((i) => ({
      id: i.id,
      name: i.name,
      itemsPerSec: num((i.inserter as { speed: number | string }).speed) / 60,
      icon: icon(i.id, i.icon, i.iconText),
    }));

  // Highest-numbered preset is the most upgraded machine ranking.
  const presets = fl.defaults?.presets ?? [];
  const bestPreset = presets
    .filter((p) => p.machineRank?.length)
    // The legendary preset annotates ids as `foundry(5)`; strip the quality.
    .sort((a, b) => a.id - b.id)
    .filter((p) => !(p.machineRank ?? []).some((m) => m.includes('(')))
    .at(-1);

  const data: GameData = {
    id: SET_ID,
    name: SET_NAME,
    version: fl.version,
    sprite: {
      url: `sprites/${SET_ID}.webp`,
      width: 2044,
      height: 1978,
      size: ICON_SIZE,
    },
    items,
    recipes,
    machines,
    modules,
    beacons,
    belts,
    pipes,
    inserters,
    defaults: {
      beltId: fl.defaults?.belt ?? belts[0]?.id ?? null,
      pipeId: 'pipe',
      // FactorioLab records no default inserter; the plain one is the sane
      // starting point for a capacity warning.
      inserterId: inserters.find((i) => i.id === 'inserter')?.id ?? inserters[0]?.id ?? null,
      beaconId: fl.defaults?.beacon ?? beacons[0]?.id ?? null,
      machineRank: bestPreset?.machineRank ?? [],
    },
  };

  // Parse with our own schema so a bad import fails here, not in the browser.
  const parsed = gameDataSchema.parse(data);

  // Integrity checks the app relies on.
  const machineIds = new Set(parsed.machines.map((m) => m.id));
  const itemIds = new Set(parsed.items.map((i) => i.id));
  for (const r of parsed.recipes) {
    for (const p of r.producers) {
      if (!machineIds.has(p)) throw new Error(`recipe ${r.id}: unknown producer ${p}`);
    }
    for (const p of [...r.inputs, ...r.outputs]) {
      if (!itemIds.has(p.itemId)) throw new Error(`recipe ${r.id}: unknown item ${p.itemId}`);
    }
  }

  mkdirSync(resolve(ROOT, 'public/data'), { recursive: true });
  mkdirSync(resolve(ROOT, 'public/sprites'), { recursive: true });
  writeFileSync(resolve(ROOT, `public/data/${SET_ID}.json`), JSON.stringify(parsed));
  copyFileSync(resolve(src, 'icons.webp'), resolve(ROOT, `public/sprites/${SET_ID}.webp`));

  process.stdout.write(
    `wrote public/data/${SET_ID}.json — ` +
      `${parsed.items.length} items, ${parsed.recipes.length} recipes, ` +
      `${parsed.machines.length} machines, ${parsed.modules.length} modules, ` +
      `${parsed.beacons.length} beacons, ${parsed.belts.length} belts, ` +
      `${parsed.pipes.length} pipes, ${parsed.inserters.length} inserters\n`,
  );
}

main();
