import { z } from 'zod';

/**
 * Our own `GameData` shape. Produced by `scripts/import-factoriolab.ts` from
 * FactorioLab's dataset and vendored into `public/data/`; the app never touches
 * FactorioLab at runtime.
 */

export const effectNameSchema = z.enum([
  'speed',
  'productivity',
  'consumption',
  'pollution',
  'quality',
]);
export type EffectName = z.infer<typeof effectNameSchema>;

export const iconRefSchema = z.object({
  /** Sprite-sheet x/y in CSS pixels, for `background-position: -x -y`. */
  x: z.number(),
  y: z.number(),
  /** Dominant colour, handy for the minimap and edge tinting. */
  color: z.string().nullable(),
  /** Overlay text drawn on the sprite (technology tiers show "2", "3", ...). */
  text: z.string().nullable(),
});
export type IconRef = z.infer<typeof iconRefSchema>;

export const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  /** Null for fluids and for items with no stack size (technologies). */
  stackSize: z.number().nullable(),
  isFluid: z.boolean(),
  icon: iconRefSchema,
});
export type Item = z.infer<typeof itemSchema>;

export const recipePortSchema = z.object({
  itemId: z.string(),
  /**
   * Amount per craft. For probabilistic outputs this is the *expected* amount,
   * i.e. already multiplied by `probability`.
   */
  amount: z.number(),
  /**
   * Chance the output appears at all, in `(0, 1]`. FactorioLab bakes probability
   * into the amount, so imports land here as 1 with `amount` pre-multiplied and
   * the recipe flagged `probabilistic`. The solver always uses
   * `amount * probability`, so an authored recipe may split them instead.
   */
  probability: z.number(),
  /**
   * Portion of the amount that is a catalyst — present on both sides of the
   * recipe and merely passed through (Kovarex U-235, coal-liquefaction heavy
   * oil). Productivity does not apply to the catalyst portion.
   */
  catalyst: z.number(),
});
export type RecipePort = z.infer<typeof recipePortSchema>;

export const recipeSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  /** Seconds per craft at crafting speed 1. */
  time: z.number(),
  inputs: z.array(recipePortSchema),
  outputs: z.array(recipePortSchema),
  /** Machine ids that can run this recipe. May be empty (spoilage, plants). */
  producers: z.array(z.string()),
  /** Effects the recipe itself refuses, on top of what the machine refuses. */
  disallowedEffects: z.array(effectNameSchema),
  /** True when at least one output is a chance roll and `amount` is an average. */
  probabilistic: z.boolean(),
  /** FactorioLab flags kept verbatim: mining, recycling, burn, technology, ... */
  flags: z.array(z.string()),
  icon: iconRefSchema,
});
export type Recipe = z.infer<typeof recipeSchema>;

export const machineSchema = z.object({
  id: z.string(),
  name: z.string(),
  craftingSpeed: z.number(),
  moduleSlots: z.number(),
  /** Full-load electricity draw, kW. Zero for burner machines. */
  energyUsageKw: z.number(),
  /** Idle draw, kW. Paid per machine regardless of utilisation. */
  drainKw: z.number(),
  /** Pollution units per minute at full load. Negative for the biochamber. */
  pollutionPerMin: z.number(),
  /** Foundry / EM plant / biochamber ship with +50 % productivity built in. */
  baseProductivity: z.number(),
  disallowedEffects: z.array(effectNameSchema),
  /** 'electric' | 'burner' | null (offshore pump, heat exchanger). */
  energySource: z.string().nullable(),
  icon: iconRefSchema,
});
export type Machine = z.infer<typeof machineSchema>;

export const moduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  speed: z.number(),
  productivity: z.number(),
  consumption: z.number(),
  pollution: z.number(),
  quality: z.number(),
  icon: iconRefSchema,
});
export type Module = z.infer<typeof moduleSchema>;

export const beaconSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Distribution efficiency. Vanilla beacon = 1.5. */
  effectivity: z.number(),
  moduleSlots: z.number(),
  energyUsageKw: z.number(),
  disallowedEffects: z.array(effectNameSchema),
  /**
   * Per-beacon-count multiplier from the game, index 0 = one beacon. Factorio
   * 2.0 uses `1/sqrt(n)`; the table is shipped rather than recomputed so we
   * match the game's own rounding.
   */
  profile: z.array(z.number()),
  icon: iconRefSchema,
});
export type Beacon = z.infer<typeof beaconSchema>;

export const beltSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Items per second across both lanes. */
  itemsPerSec: z.number(),
  icon: iconRefSchema,
});
export type Belt = z.infer<typeof beltSchema>;

export const pipeSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Fluid units per second. */
  fluidPerSec: z.number(),
  icon: iconRefSchema,
});
export type Pipe = z.infer<typeof pipeSchema>;

export const inserterSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Approximate items per second, at max capacity bonus. Warnings only. */
  itemsPerSec: z.number(),
  icon: iconRefSchema,
});
export type Inserter = z.infer<typeof inserterSchema>;

export const gameDataSchema = z.object({
  /** Data set id, e.g. `2x1` (Factorio 2.0 base + Space Age). */
  id: z.string(),
  name: z.string(),
  /** Game version map from the source data, e.g. `{ base: '2.1.16' }`. */
  version: z.record(z.string(), z.string()),
  sprite: z.object({
    url: z.string(),
    width: z.number(),
    height: z.number(),
    /** Rendered icon edge, px. */
    size: z.number(),
  }),
  items: z.array(itemSchema),
  recipes: z.array(recipeSchema),
  machines: z.array(machineSchema),
  modules: z.array(moduleSchema),
  beacons: z.array(beaconSchema),
  belts: z.array(beltSchema),
  pipes: z.array(pipeSchema),
  inserters: z.array(inserterSchema),
  defaults: z.object({
    beltId: z.string().nullable(),
    pipeId: z.string().nullable(),
    inserterId: z.string().nullable(),
    beaconId: z.string().nullable(),
    /** Preferred machine order; first match wins when picking a producer. */
    machineRank: z.array(z.string()),
  }),
});
export type GameData = z.infer<typeof gameDataSchema>;
