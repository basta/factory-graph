/**
 * Turns a graph into a linear program and back.
 *
 * Variables
 *   `c|node`   crafts per second of a recipe node
 *   `t|node`   rate of a free source or sink node
 *   `f|edge`   items per second carried by one edge
 *   `si|port`  material appearing at a port from outside the graph
 *   `so|port`  material leaving a port to outside the graph
 *
 * Every port gets one equality constraint: what arrives equals what leaves,
 * with `si`/`so` absorbing the difference. A port with **no edges** is an
 * implicit source/sink, so its slack is cheap and lands in `totals`. A port
 * **with** edges is supposed to balance, so its slack is expensive — it only
 * appears when the user has pinned machine counts that cannot agree, and that
 * is exactly the nonzero balance the canvas shows as a warning.
 *
 * The objective minimises implicit input first (the "tightest" solution), then
 * breaks ties on total machines. Because every variable is non-negative and
 * every cost is non-negative, the program is always bounded.
 */
import solver, { type ModelDefinition } from 'javascript-lp-solver';
import type { GameIndex } from '../data/loader.ts';
import type { FlowEdge, GraphNode, NodeId, PortSide, SolverGraph } from '../graph/types.ts';
import { portKey } from '../graph/types.ts';
import { inputPerCraft, machineRates, outputPerCraft, type MachineRates } from './rates.ts';

/** Cost of pulling material in through an unconnected port. */
const W_IMPLICIT_IN = 1;
/** Mild dislike of throwing material away, so ties resolve the same way twice. */
const W_EXCESS = 1e-3;
/** Cost of a connected port failing to balance. Dominates the other terms. */
const W_IMBALANCE = 1e4;
/**
 * Tilt applied to the wrong side of an imbalance. A shortfall is the same size
 * whether it is booked as "the producer conjured too little" or "the consumer
 * got too little", and the LP would otherwise pick arbitrarily. The tilt puts a
 * shortfall on the consumer's input port and a surplus on the producer's output
 * port, which is where each one reads as an explanation.
 */
const W_WRONG_SIDE = 1.1;
/** Tie-break so an otherwise-equal solution uses fewer machines. */
const W_MACHINE = 1e-6;

const OBJECTIVE = '__obj';

export interface PortSpec {
  key: string;
  nodeId: NodeId;
  side: PortSide;
  itemId: string;
  /** Per-craft amount, already adjusted for productivity on the output side. */
  perCraft: number;
  edgeIds: string[];
}

export interface NodeSpec {
  node: GraphNode;
  rates: MachineRates | null;
  /** Crafts per second at one machine; 0 when the node cannot run. */
  craftsPerSecPerMachine: number;
}

export interface LpBuild {
  model: ModelDefinition;
  nodes: Map<NodeId, NodeSpec>;
  ports: Map<string, PortSpec>;
  /** Edges kept in the program — mismatched or dangling ones are dropped. */
  edges: FlowEdge[];
  /** True when at least one node pins a rate; without one the LP is all zeros. */
  hasConstraint: boolean;
}

const craftVar = (id: NodeId): string => `c|${id}`;
const rateVar = (id: NodeId): string => `t|${id}`;
const flowVar = (id: string): string => `f|${id}`;
const supplyVar = (key: string): string => `si|${key}`;
const excessVar = (key: string): string => `so|${key}`;

type Coefficients = Record<string, number>;

/** Accumulates `variables[name][constraint] += coefficient`. */
function addTerm(
  variables: Record<string, Coefficients>,
  name: string,
  constraint: string,
  coefficient: number,
): void {
  const entry = (variables[name] ??= { [OBJECTIVE]: 0 });
  entry[constraint] = (entry[constraint] ?? 0) + coefficient;
}

function setCost(variables: Record<string, Coefficients>, name: string, cost: number): void {
  const entry = (variables[name] ??= { [OBJECTIVE]: 0 });
  entry[OBJECTIVE] = cost;
}

export function buildLp(graph: SolverGraph, index: GameIndex): LpBuild {
  // --- per-node rates ------------------------------------------------------
  const nodes = new Map<NodeId, NodeSpec>();
  for (const node of graph.nodes) {
    if (node.kind !== 'recipe') {
      nodes.set(node.id, { node, rates: null, craftsPerSecPerMachine: 0 });
      continue;
    }
    const recipe = index.recipes.get(node.recipeId);
    const machine = index.machines.get(node.machineId);
    if (!recipe || !machine) {
      nodes.set(node.id, { node, rates: null, craftsPerSecPerMachine: 0 });
      continue;
    }
    const rates = machineRates(index, {
      machine,
      recipe,
      moduleIds: node.modules.filter((m) => m !== ''),
      beacons: node.beacons,
    });
    nodes.set(node.id, { node, rates, craftsPerSecPerMachine: rates.craftsPerSecPerMachine });
  }

  // --- ports ---------------------------------------------------------------
  const ports = new Map<string, PortSpec>();
  function definePort(nodeId: NodeId, side: PortSide, itemId: string, perCraft: number): void {
    const key = portKey(nodeId, side, itemId);
    if (!ports.has(key)) ports.set(key, { key, nodeId, side, itemId, perCraft, edgeIds: [] });
  }

  for (const node of graph.nodes) {
    if (node.kind === 'recipe') {
      const spec = nodes.get(node.id);
      const recipe = index.recipes.get(node.recipeId);
      if (!recipe) continue;
      const productivity = spec?.rates?.productivity ?? 0;
      for (const input of recipe.inputs) {
        definePort(node.id, 'in', input.itemId, inputPerCraft(input));
      }
      for (const out of recipe.outputs) {
        definePort(node.id, 'out', out.itemId, outputPerCraft(out, productivity));
      }
    } else if (node.kind === 'source') {
      definePort(node.id, 'out', node.itemId, 0);
    } else if (node.kind === 'sink') {
      definePort(node.id, 'in', node.itemId, 0);
    }
  }

  // --- edges ---------------------------------------------------------------
  // An edge is only real if both ends exist and carry the same item.
  const edges = graph.edges.filter((edge) => {
    if (edge.fromPort !== edge.toPort) return false;
    const from = ports.get(portKey(edge.from, 'out', edge.fromPort));
    const to = ports.get(portKey(edge.to, 'in', edge.toPort));
    if (!from || !to) return false;
    from.edgeIds.push(edge.id);
    to.edgeIds.push(edge.id);
    return true;
  });

  // --- model ---------------------------------------------------------------
  const variables: Record<string, Coefficients> = {};
  const constraints: Record<string, { equal: number }> = {};
  let hasConstraint = false;

  for (const spec of nodes.values()) {
    const { node } = spec;
    if (node.kind === 'note') continue;

    if (node.kind === 'recipe') {
      const name = craftVar(node.id);
      // Tie-break is per machine, so scale the cost by machines per craft/s.
      const perCraftMachines =
        spec.craftsPerSecPerMachine > 0 ? W_MACHINE / spec.craftsPerSecPerMachine : W_MACHINE;
      setCost(variables, name, perCraftMachines);
      if (node.constraint.type === 'machines') {
        hasConstraint = true;
        const fixed = `fix|${node.id}`;
        constraints[fixed] = { equal: node.constraint.count * spec.craftsPerSecPerMachine };
        addTerm(variables, name, fixed, 1);
      }
    } else {
      const name = rateVar(node.id);
      setCost(variables, name, 0);
      if (node.constraint.type === 'rate') {
        hasConstraint = true;
        const fixed = `fix|${node.id}`;
        constraints[fixed] = { equal: node.constraint.perSec };
        addTerm(variables, name, fixed, 1);
      }
    }
  }

  for (const edge of edges) setCost(variables, flowVar(edge.id), 0);

  for (const port of ports.values()) {
    const spec = nodes.get(port.nodeId);
    if (!spec) continue;
    const constraintName = `p|${port.key}`;
    constraints[constraintName] = { equal: 0 };

    // Sign convention: positive means "arrives at this port".
    const sign = port.side === 'in' ? 1 : -1;
    for (const edgeId of port.edgeIds) addTerm(variables, flowVar(edgeId), constraintName, sign);

    if (spec.node.kind === 'recipe') {
      // An input port drains the node, an output port fills it.
      addTerm(variables, craftVar(port.nodeId), constraintName, -sign * port.perCraft);
    } else if (spec.node.kind === 'source') {
      addTerm(variables, rateVar(port.nodeId), constraintName, 1);
    } else if (spec.node.kind === 'sink') {
      addTerm(variables, rateVar(port.nodeId), constraintName, -1);
    }

    const connected = port.edgeIds.length > 0;
    const supply = supplyVar(port.key);
    const excess = excessVar(port.key);
    const wrongSupply = port.side === 'out' ? W_WRONG_SIDE : 1;
    const wrongExcess = port.side === 'in' ? W_WRONG_SIDE : 1;
    setCost(variables, supply, connected ? W_IMBALANCE * wrongSupply : W_IMPLICIT_IN);
    setCost(variables, excess, connected ? W_IMBALANCE * wrongExcess : W_EXCESS);
    addTerm(variables, supply, constraintName, 1);
    addTerm(variables, excess, constraintName, -1);
  }

  const model: ModelDefinition = {
    optimize: OBJECTIVE,
    opType: 'min',
    constraints,
    variables,
  };

  return { model, nodes, ports, edges, hasConstraint };
}

export interface LpSolution {
  feasible: boolean;
  bounded: boolean;
  /** Variable name to value; absent names are zero. */
  values: Record<string, number>;
}

/**
 * The one call into the LP library. Swap this body to change backends —
 * everything above and in `index.ts` is backend-agnostic.
 */
export function runLp(model: ModelDefinition): LpSolution {
  const raw = solver.Solve(model) as Record<string, number | boolean | undefined>;
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && key !== 'result') values[key] = value;
  }
  return {
    feasible: raw.feasible !== false,
    bounded: raw.bounded !== false,
    values,
  };
}
