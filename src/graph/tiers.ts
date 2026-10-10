import type { GameIndex } from '../data/loader.ts';
import { familyOf, withMachine } from './settings.ts';
import type { EdgeId, Graph, NodeId, RecipeNode, Transport } from './types.ts';

/**
 * Digit keys on the selection: `1`–`4` put selected connections on that tier
 * of belt (`0` takes the belt off) and move selected machines to that tier of
 * their family — assembler 1, 2 or 3; stone, steel or electric furnace.
 *
 * Changes nothing it cannot do: a fluid connection is left alone, and a
 * recipe the chosen tier cannot make — assembler 1 takes no fluids — stays on
 * its machine.
 */
export interface TierChanges {
  transports: [EdgeId, Transport][];
  machines: [NodeId, RecipeNode][];
}

export function tierChanges(
  graph: Graph,
  index: GameIndex,
  nodeIds: readonly NodeId[],
  edgeIds: readonly EdgeId[],
  digit: number,
): TierChanges {
  const changes: TierChanges = { transports: [], machines: [] };

  const belt = digit === 0 ? null : index.data.belts[digit - 1];
  if (digit === 0 || belt) {
    for (const edge of graph.edges) {
      if (!edgeIds.includes(edge.id)) continue;
      if (index.items.get(edge.fromPort)?.isFluid) continue;
      const next: Transport = belt
        ? {
            kind: 'belt',
            beltId: belt.id,
            lanes: edge.transport?.kind === 'belt' ? edge.transport.lanes : 2,
          }
        : null;
      if (JSON.stringify(next) !== JSON.stringify(edge.transport)) {
        changes.transports.push([edge.id, next]);
      }
    }
  }

  if (digit >= 1) {
    for (const node of graph.nodes) {
      if (node.kind !== 'recipe' || !nodeIds.includes(node.id)) continue;
      const target = familyOf(node.machineId)?.machines[digit - 1];
      if (!target || target === node.machineId) continue;
      if (!index.recipes.get(node.recipeId)?.producers.includes(target)) continue;
      changes.machines.push([node.id, withMachine(index, node, target)]);
    }
  }

  return changes;
}
