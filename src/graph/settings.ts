import type { GameIndex } from '../data/loader.ts';
import { defaultMachineFor } from '../data/loader.ts';
import type { Recipe } from '../data/schema.ts';
import { CHANNEL, storagePrefix } from './channel.ts';
import { settingsSchema } from './serialize.ts';
import type { Graph, PlanSettings, RecipeNode, Transport } from './types.ts';

/**
 * Plan settings: the choices made once per plan instead of once per node and
 * per connection. Everything here is pure except the last-used memory at the
 * bottom, which is what lets a new plan start where the last one left off.
 */

/**
 * Yellow belts and assembler 2s: an early-to-mid game base, which is where
 * most planning happens. A plan saved before settings existed reads as this.
 */
export const DEFAULT_SETTINGS: PlanSettings = {
  beltId: 'transport-belt',
  machines: ['assembling-machine-2', 'steel-furnace'],
  bus: ['iron-plate', 'copper-plate', 'steel-plate'],
  unit: 's',
};

export function settingsOf(graph: Pick<Graph, 'settings'>): PlanSettings {
  return graph.settings ?? DEFAULT_SETTINGS;
}

/** Machines that are tiers of one another, lowest first. */
export interface MachineFamily {
  id: string;
  label: string;
  machines: string[];
}

export const MACHINE_FAMILIES: readonly MachineFamily[] = [
  {
    id: 'assembler',
    label: 'Assembler',
    machines: ['assembling-machine-1', 'assembling-machine-2', 'assembling-machine-3'],
  },
  {
    id: 'furnace',
    label: 'Furnace',
    machines: ['stone-furnace', 'steel-furnace', 'electric-furnace'],
  },
  {
    id: 'drill',
    label: 'Drill',
    machines: ['burner-mining-drill', 'electric-mining-drill', 'big-mining-drill'],
  },
];

export function familyOf(machineId: string): MachineFamily | undefined {
  return MACHINE_FAMILIES.find((family) => family.machines.includes(machineId));
}

/**
 * The machine a new node for `recipe` gets: the plan's pick where the recipe
 * allows it, else the data set's ranking. Without the plan's pick first, green
 * circuits default to the electromagnetic plant, which no early base has.
 */
export function preferredMachine(
  index: GameIndex,
  recipe: Recipe,
  settings: PlanSettings,
): string | null {
  for (const id of settings.machines) if (recipe.producers.includes(id)) return id;
  return defaultMachineFor(index, recipe);
}

/**
 * What a new connection carrying `itemId` starts on. Fluids get nothing: the
 * plan's belt means nothing on a pipe, and a pipe is rarely the limit.
 */
export function defaultTransport(
  index: GameIndex,
  settings: PlanSettings,
  itemId: string,
): Transport {
  if (settings.beltId === null || !index.belts.has(settings.beltId)) return null;
  if (index.items.get(itemId)?.isFluid) return null;
  return { kind: 'belt', beltId: settings.beltId, lanes: 2 };
}

/** Swaps a node's machine, keeping the modules that still fit. */
export function withMachine(index: GameIndex, node: RecipeNode, machineId: string): RecipeNode {
  const slots = index.machines.get(machineId)?.moduleSlots ?? 0;
  return {
    ...node,
    machineId,
    modules: Array.from({ length: slots }, (_unused, slot) => node.modules[slot] ?? ''),
  };
}

/**
 * Carries a change of settings through the graph. Whatever was following the
 * old default follows the new one — connections on the old belt, nodes on the
 * old tier — and anything set by hand to something else is left alone. That is
 * what makes "this plan is on red belts now" one click instead of one per
 * connection.
 */
export function applySettings(
  graph: Graph,
  prev: PlanSettings,
  next: PlanSettings,
  index: GameIndex,
): Graph {
  let { nodes, edges } = graph;

  if (prev.beltId !== next.beltId) {
    edges = edges.map((edge) => {
      if (index.items.get(edge.fromPort)?.isFluid) return edge;
      const follows =
        prev.beltId === null
          ? edge.transport === null
          : edge.transport?.kind === 'belt' && edge.transport.beltId === prev.beltId;
      if (!follows) return edge;
      if (next.beltId === null) return { ...edge, transport: null };
      const lanes = edge.transport?.kind === 'belt' ? edge.transport.lanes : 2;
      return { ...edge, transport: { kind: 'belt', beltId: next.beltId, lanes } };
    });
  }

  for (const family of MACHINE_FAMILIES) {
    const from = prev.machines.find((id) => family.machines.includes(id));
    const to = next.machines.find((id) => family.machines.includes(id));
    if (!from || !to || from === to) continue;
    nodes = nodes.map((node) => {
      if (node.kind !== 'recipe' || node.machineId !== from) return node;
      // Assembler 1 cannot take fluids, so not every recipe can move down.
      if (!index.recipes.get(node.recipeId)?.producers.includes(to)) return node;
      return withMachine(index, node, to);
    });
  }

  return { ...graph, nodes, edges, settings: next };
}

/** Replaces the family's pick in a preference list, or adds it. */
export function withFamilyPick(machines: string[], family: MachineFamily, pick: string): string[] {
  const rest = machines.filter((id) => !family.machines.includes(id));
  return [...rest, pick];
}

// --- last used ---------------------------------------------------------------
// A new plan starts with the settings the last one was left on, so the choice
// is made once per base rather than once per plan.

const LAST_KEY = `${storagePrefix(CHANNEL)}settings`;

export function lastSettings(): PlanSettings {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (raw !== null) {
      const parsed = settingsSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Private window, blocked storage or a malformed value: the default will do.
  }
  return DEFAULT_SETTINGS;
}

export function rememberSettings(settings: PlanSettings): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(settings));
  } catch {
    // Not remembering is harmless; the plan itself still carries them.
  }
}
