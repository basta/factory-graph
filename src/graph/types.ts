export type NodeId = string;
export type EdgeId = string;

/** A node's rate is either pinned by the user or left for the solver. */
export type Constraint = { type: 'machines'; count: number } | { type: 'free' };
export type RateConstraint = { type: 'rate'; perSec: number } | { type: 'free' };

export interface BeaconConfig {
  beaconId: string;
  count: number;
  modules: string[];
}

/**
 * A recipe node built as several identical copies, each with its own belt or
 * pipe for every item. `fit` sizes the count from the belts on the node's
 * connections, so it follows the rate when the sink changes; `count` is a
 * number the user chose.
 */
export type Blocks = { type: 'fit' } | { type: 'count'; count: number };

export interface RecipeNode {
  id: NodeId;
  kind: 'recipe';
  recipeId: string;
  machineId: string;
  /** Length <= machine.moduleSlots; '' is an empty slot. */
  modules: string[];
  beacons: BeaconConfig | null;
  constraint: Constraint;
  /** Absent means one block — the node is built as a single unit. */
  blocks?: Blocks;
}

export interface SourceNode {
  id: NodeId;
  kind: 'source';
  itemId: string;
  constraint: RateConstraint;
}

export interface SinkNode {
  id: NodeId;
  kind: 'sink';
  itemId: string;
  constraint: RateConstraint;
}

export interface NoteNode {
  id: NodeId;
  kind: 'note';
  text: string;
}

export type GraphNode = RecipeNode | SourceNode | SinkNode | NoteNode;

export type Transport =
  | null
  | { kind: 'belt'; beltId: string; lanes: 1 | 2 }
  | { kind: 'pipe'; pipeId: string }
  | { kind: 'inserter'; inserterId: string; count: number };

export interface FlowEdge {
  id: EdgeId;
  from: NodeId;
  /** Item id — a port is one per distinct item on that side of the node. */
  fromPort: string;
  to: NodeId;
  toPort: string;
  transport: Transport;
}

export interface Position {
  x: number;
  y: number;
}

/**
 * Choices a plan makes once instead of on every node and connection: what new
 * connections are carried on, which machines new nodes use, where Expand
 * stops, and the unit rates are shown in.
 */
export interface PlanSettings {
  /** Belt every new item connection starts on; null for none. */
  beltId: string | null;
  /**
   * Machines new nodes prefer, first match wins — one per family, such as
   * `assembling-machine-2` and `steel-furnace`. A recipe none of them can make
   * falls back to the data set's ranking.
   */
  machines: string[];
  /** Items Expand leaves as inputs rather than building, such as bus plates. */
  bus: string[];
  /** Rates are stored per second; this is only how they are shown. */
  unit: 's' | 'min';
}

/** Positions live outside the semantic graph so the solver never sees layout. */
export interface Graph {
  version: 1;
  dataSet: string;
  nodes: GraphNode[];
  edges: FlowEdge[];
  positions: Record<NodeId, Position>;
  /** Absent on plans saved before settings existed; read with `settingsOf`. */
  settings?: PlanSettings;
}

/**
 * Which side of a node a port sits on. Kovarex and coal liquefaction have the
 * same item on both sides, so the side is part of a port's identity.
 */
export type PortSide = 'in' | 'out';

/**
 * What the solver is allowed to see. Positions are deliberately not part of
 * it, so "the solver never touches layout" is enforced by the type rather than
 * by discipline — and so a drag cannot invalidate a memoised solve.
 */
export type SolverGraph = Pick<Graph, 'nodes' | 'edges'>;

export type PortKey = `${NodeId}:${string}`;

export const portKey = (nodeId: NodeId, side: PortSide, itemId: string): PortKey =>
  `${nodeId}:${side}:${itemId}`;

export function emptyGraph(dataSet: string, settings?: PlanSettings): Graph {
  return {
    version: 1,
    dataSet,
    nodes: [],
    edges: [],
    positions: {},
    ...(settings ? { settings } : {}),
  };
}
