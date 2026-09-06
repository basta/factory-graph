import type { GameIndex } from '../data/loader.ts';
import type { GraphNode, PortSide } from '../graph/types.ts';

/**
 * Node geometry, in one place.
 *
 * The node components, the handle positions and the auto-layout all need the
 * same numbers, and a disagreement between them shows up as edges that miss
 * their ports. Everything derives from these constants.
 */

export const NODE_WIDTH = 300;
export const IO_WIDTH = 208;
export const NOTE_WIDTH = 220;

export const HEADER_HEIGHT = 28;
/** Extra band under the header holding the module slots. */
export const MODULE_ROW_HEIGHT = 22;
export const PORT_ROW_HEIGHT = 18;
export const BODY_PADDING = 5;
export const NOTE_MIN_HEIGHT = 76;

export interface Port {
  side: PortSide;
  itemId: string;
  /** Amount per craft; source and sink nodes report 0. */
  perCraft: number;
  isFluid: boolean;
  /** Row index within its column, for the handle's vertical position. */
  row: number;
}

export interface NodeShape {
  width: number;
  height: number;
  inputs: Port[];
  outputs: Port[];
  /** Number of module slots to draw, 0 when the machine takes none. */
  moduleSlots: number;
}

/** Vertical centre of a port row, measured from the top of the node. */
export function portOffsetY(shape: NodeShape, row: number): number {
  const bodyTop =
    HEADER_HEIGHT + (shape.moduleSlots > 0 ? MODULE_ROW_HEIGHT : 0) + BODY_PADDING;
  return bodyTop + row * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2;
}

export function nodeShape(node: GraphNode, index: GameIndex): NodeShape {
  const fluid = (itemId: string): boolean => index.items.get(itemId)?.isFluid ?? false;

  if (node.kind === 'note') {
    return { width: NOTE_WIDTH, height: NOTE_MIN_HEIGHT, inputs: [], outputs: [], moduleSlots: 0 };
  }

  if (node.kind === 'source' || node.kind === 'sink') {
    const side: PortSide = node.kind === 'source' ? 'out' : 'in';
    const port: Port = { side, itemId: node.itemId, perCraft: 0, isFluid: fluid(node.itemId), row: 0 };
    return {
      width: IO_WIDTH,
      height: HEADER_HEIGHT + BODY_PADDING * 2 + PORT_ROW_HEIGHT,
      inputs: side === 'in' ? [port] : [],
      outputs: side === 'out' ? [port] : [],
      moduleSlots: 0,
    };
  }

  const recipe = index.recipes.get(node.recipeId);
  const machine = index.machines.get(node.machineId);
  const moduleSlots = machine?.moduleSlots ?? 0;

  const inputs: Port[] = (recipe?.inputs ?? []).map((port, row) => ({
    side: 'in' as const,
    itemId: port.itemId,
    perCraft: port.amount * port.probability,
    isFluid: fluid(port.itemId),
    row,
  }));
  const outputs: Port[] = (recipe?.outputs ?? []).map((port, row) => ({
    side: 'out' as const,
    itemId: port.itemId,
    perCraft: port.amount * port.probability,
    isFluid: fluid(port.itemId),
    row,
  }));

  const rows = Math.max(inputs.length, outputs.length, 1);
  return {
    width: NODE_WIDTH,
    height:
      HEADER_HEIGHT +
      (moduleSlots > 0 ? MODULE_ROW_HEIGHT : 0) +
      BODY_PADDING * 2 +
      rows * PORT_ROW_HEIGHT,
    inputs,
    outputs,
    moduleSlots,
  };
}
