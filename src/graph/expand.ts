import type { GameIndex } from '../data/loader.ts';
import { mainRecipe } from '../data/recipes.ts';
import { nodeShape } from '../canvas/geometry.ts';
import { defaultTransport } from './settings.ts';
import { makeRecipeNode } from './store.ts';
import type { FlowEdge, Graph, GraphNode, NodeId, PlanSettings, Position } from './types.ts';

/**
 * Expand: build one step upstream of the selected nodes in one go.
 *
 * Every unconnected input gets a producer, placed to the left and connected,
 * on the plan's machine and belt. Planning back from a sink is a run of
 * "what makes this?" questions, and for almost every item the answer is not
 * a question at all — so it should not cost a drag and a search each.
 */

export interface ExpandResult {
  nodes: { node: GraphNode; position: Position }[];
  edges: Omit<FlowEdge, 'id'>[];
  /** Inputs with a real choice of recipe, left for the user to pick. */
  choices: { nodeId: NodeId; itemId: string; position: Position }[];
}

/** Horizontal room between a node and the producers placed to its left. */
const COLUMN_GAP = 120;
/** Vertical room between producers stacked in one column. */
const ROW_GAP = 28;
/** Grid pitch: a placement that collides moves down by this much and tries again. */
const NUDGE = 24;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The inputs Expand would build for: unconnected, and not on the bus. */
export function openInputs(
  graph: Graph,
  index: GameIndex,
  settings: PlanSettings,
  node: GraphNode,
): string[] {
  const fed = new Set(graph.edges.filter((edge) => edge.to === node.id).map((edge) => edge.toPort));
  if (node.kind === 'sink') {
    // A sink is the thing you asked for, bus item or not.
    return fed.has(node.itemId) ? [] : [node.itemId];
  }
  if (node.kind !== 'recipe') return [];
  const recipe = index.recipes.get(node.recipeId);
  if (!recipe) return [];
  return recipe.inputs
    .map((input) => input.itemId)
    .filter((itemId) => !fed.has(itemId) && !settings.bus.includes(itemId));
}

export function planExpand(
  graph: Graph,
  index: GameIndex,
  settings: PlanSettings,
  ids: readonly NodeId[],
): ExpandResult {
  const result: ExpandResult = { nodes: [], edges: [], choices: [] };

  // Everything already on the canvas, so new nodes land in clear space.
  const occupied: Rect[] = graph.nodes.map((node) => {
    const shape = nodeShape(node, index);
    const at = graph.positions[node.id] ?? { x: 0, y: 0 };
    return { x: at.x, y: at.y, width: shape.width, height: shape.height };
  });

  const place = (wanted: Rect): Position => {
    const rect = { ...wanted };
    for (let tries = 0; tries < 400 && occupied.some((other) => overlaps(rect, other)); tries += 1) {
      rect.y += NUDGE;
    }
    occupied.push(rect);
    return { x: rect.x, y: rect.y };
  };

  for (const id of ids) {
    const parent = graph.nodes.find((node) => node.id === id);
    if (!parent) continue;
    const items = openInputs(graph, index, settings, parent);
    if (items.length === 0) continue;

    const at = graph.positions[parent.id] ?? { x: 0, y: 0 };
    const parentShape = nodeShape(parent, index);

    // Build the column first so it can be centred on the parent.
    const column = items.map((itemId) => {
      const recipeId = mainRecipe(index, itemId);
      const node = recipeId ? makeRecipeNode(index, recipeId, settings) : null;
      return { itemId, node, shape: node ? nodeShape(node, index) : null };
    });
    const heights = column.map((entry) => entry.shape?.height ?? parentShape.height);
    const total = heights.reduce((sum, height) => sum + height, 0) + ROW_GAP * (column.length - 1);
    let y = at.y + parentShape.height / 2 - total / 2;

    column.forEach((entry, row) => {
      const width = entry.shape?.width ?? parentShape.width;
      const height = heights[row]!;
      const x = at.x - COLUMN_GAP - width;
      if (entry.node) {
        const position = place({ x, y, width, height });
        result.nodes.push({ node: entry.node, position });
        result.edges.push({
          from: entry.node.id,
          fromPort: entry.itemId,
          to: parent.id,
          toPort: entry.itemId,
          transport: defaultTransport(index, settings, entry.itemId),
        });
      } else {
        result.choices.push({ nodeId: parent.id, itemId: entry.itemId, position: { x, y } });
      }
      y += height + ROW_GAP;
    });
  }

  return result;
}
