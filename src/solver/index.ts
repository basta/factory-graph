import type { GameIndex } from '../data/loader.ts';
import type { Graph, PortKey } from '../graph/types.ts';
import { buildLp, runLp } from './lp.ts';
import { PIPE_THROUGHPUT_PER_SEC } from './rates.ts';
import type { EdgeResult, NodeResult, PortResult, SolveResult } from './types.ts';
import { emptySolveResult } from './types.ts';

export * from './types.ts';
export * from './rates.ts';

/** Rates below this are rounding noise from the simplex and read as zero. */
const EPSILON = 1e-7;

function clean(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.abs(value) < EPSILON ? 0 : value;
}

/**
 * A balance is a difference of two solver outputs, so its error scales with
 * their magnitude. Anything under a part in a million of the larger side is
 * simplex noise, not a real imbalance.
 */
function cleanBalance(produced: number, consumed: number): number {
  const difference = produced - consumed;
  const scale = Math.max(1, Math.abs(produced), Math.abs(consumed));
  return Math.abs(difference) < scale * 1e-6 ? 0 : difference;
}

function bump(into: Record<string, number>, key: string, amount: number): void {
  if (amount === 0) return;
  into[key] = (into[key] ?? 0) + amount;
}

/**
 * Solves a graph. Synchronous and pure: same graph in, same numbers out.
 *
 * Returns `no-constraint` when nothing pins a rate — the whole graph is zero
 * and the canvas says so, rather than showing a meaningless all-zero solution
 * as if it were an answer.
 */
export function solve(graph: Graph, index: GameIndex): SolveResult {
  const build = buildLp(graph, index);
  if (!build.hasConstraint) return emptySolveResult('no-constraint');

  const solution = runLp(build.model);
  if (!solution.bounded) return emptySolveResult('unbounded');
  if (!solution.feasible) return emptySolveResult('infeasible');

  const values = solution.values;
  const result: SolveResult = emptySolveResult('ok');

  // --- nodes ---------------------------------------------------------------
  for (const [nodeId, spec] of build.nodes) {
    if (spec.node.kind === 'note') continue;
    if (spec.node.kind !== 'recipe') {
      // Source and sink nodes have a rate, not machines; their numbers live on
      // their single port, so nothing goes in `nodes`.
      continue;
    }
    // A pinned node's rate is known exactly; taking it from the LP would only
    // add the simplex's rounding to a number the user typed.
    const craftsPerSec =
      spec.node.constraint.type === 'machines'
        ? spec.node.constraint.count * spec.craftsPerSecPerMachine
        : clean(values[`c|${nodeId}`]);
    const machines = spec.craftsPerSecPerMachine > 0 ? craftsPerSec / spec.craftsPerSecPerMachine : 0;
    const machinesCeil = Math.ceil(machines - EPSILON);
    const rates = spec.rates;

    // Active draw scales with the fractional machine count; idle drain and
    // beacons are paid by every machine you actually build, so they use the
    // rounded-up count.
    const powerKw = rates
      ? machines * rates.activePowerKwPerMachine +
        machinesCeil * (rates.drainKwPerMachine + rates.beaconPowerKwPerMachine)
      : 0;
    const pollutionPerMin = rates ? machines * rates.pollutionPerMinPerMachine : 0;

    const node: NodeResult = {
      craftsPerSec,
      machines,
      machinesCeil,
      powerKw,
      pollutionPerMin,
    };
    result.nodes[nodeId] = node;
    result.totals.powerKw += powerKw;
    result.totals.pollutionPerMin += pollutionPerMin;
  }

  // --- edges ---------------------------------------------------------------
  for (const edge of build.edges) {
    const perSec = clean(values[`f|${edge.id}`]);
    let capacityPerSec: number | null = null;
    const transport = edge.transport;
    if (transport?.kind === 'belt') {
      const belt = index.belts.get(transport.beltId);
      // A belt's rated speed covers both lanes; one lane carries half.
      if (belt) capacityPerSec = (belt.itemsPerSec * transport.lanes) / 2;
    } else if (transport?.kind === 'pipe') {
      capacityPerSec = index.pipes.get(transport.pipeId)?.fluidPerSec ?? PIPE_THROUGHPUT_PER_SEC;
    } else if (transport?.kind === 'inserter') {
      const inserter = index.inserters.get(transport.inserterId);
      if (inserter) capacityPerSec = inserter.itemsPerSec * transport.count;
    }
    const edgeResult: EdgeResult = {
      perSec,
      capacityPerSec,
      saturation: capacityPerSec && capacityPerSec > 0 ? perSec / capacityPerSec : null,
    };
    result.edges[edge.id] = edgeResult;
  }

  // --- ports ---------------------------------------------------------------
  for (const port of build.ports.values()) {
    const spec = build.nodes.get(port.nodeId);
    if (!spec) continue;
    const supply = clean(values[`si|${port.key}`]);
    const excess = clean(values[`so|${port.key}`]);
    const edgeFlow = port.edgeIds.reduce((sum, id) => sum + clean(values[`f|${id}`]), 0);

    let produced: number;
    let consumed: number;
    if (spec.node.kind === 'recipe') {
      const made = (result.nodes[port.nodeId]?.craftsPerSec ?? 0) * port.perCraft;
      produced = port.side === 'in' ? edgeFlow : made;
      consumed = port.side === 'in' ? made : edgeFlow;
    } else if (spec.node.kind === 'source' || spec.node.kind === 'sink') {
      const rate =
        spec.node.constraint.type === 'rate'
          ? spec.node.constraint.perSec
          : clean(values[`t|${port.nodeId}`]);
      // A source makes its rate and ships it out; a sink takes its rate in.
      produced = port.side === 'out' ? rate : edgeFlow;
      consumed = port.side === 'out' ? edgeFlow : rate;
    } else {
      continue;
    }

    const entry: PortResult = {
      produced,
      consumed,
      balance: cleanBalance(produced, consumed),
      connected: port.edgeIds.length > 0,
    };
    result.ports[port.key as PortKey] = entry;

    // Only recipe ports contribute implicit flows; source and sink nodes are
    // explicit and are tallied from their own rate below.
    if (spec.node.kind === 'recipe' && port.edgeIds.length === 0) {
      bump(result.totals.rawInputs, port.itemId, supply);
      bump(result.totals.outputs, port.itemId, excess);
    }
    if (spec.node.kind === 'source') bump(result.totals.rawInputs, port.itemId, produced);
    if (spec.node.kind === 'sink') bump(result.totals.outputs, port.itemId, consumed);
  }

  return result;
}
