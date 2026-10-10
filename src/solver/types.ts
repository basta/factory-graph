import type { EdgeId, NodeId, PortKey } from '../graph/types.ts';

export type SolveStatus = 'ok' | 'infeasible' | 'unbounded' | 'no-constraint';

export interface NodeResult {
  craftsPerSec: number;
  /** Fractional machine count — 0.4 machines is a real answer, not an error. */
  machines: number;
  /**
   * What you would actually build: each block rounded up on its own, so 29
   * machines in 5 blocks is 5 × 6 = 30, not 29.
   */
  machinesCeil: number;
  /** Identical copies the node is built as; 1 when it is not split. */
  blocks: number;
  powerKw: number;
  pollutionPerMin: number;
}

export interface EdgeResult {
  perSec: number;
  /**
   * Belts or pipes carrying the flow side by side: one per block on whichever
   * end has more blocks. Always 1 for inserters and for no transport.
   */
  parallel: number;
  /** Null when the edge has no transport set. Covers every parallel belt. */
  capacityPerSec: number | null;
  /** `perSec / capacityPerSec`; null when there is no transport. */
  saturation: number | null;
}

export interface PortResult {
  /** What arrives at, or is made by, this port. */
  produced: number;
  /** What leaves, or is eaten by, this port. */
  consumed: number;
  /** `produced - consumed`. Nonzero on a connected port is a warning. */
  balance: number;
  /**
   * Whether any edge touches this port. An unconnected port is an implicit
   * source or sink, so its balance is expected and is not a warning.
   */
  connected: boolean;
}

export interface SolveResult {
  status: SolveStatus;
  nodes: Record<NodeId, NodeResult>;
  edges: Record<EdgeId, EdgeResult>;
  ports: Record<PortKey, PortResult>;
  totals: {
    powerKw: number;
    pollutionPerMin: number;
    /** Items per second entering the graph through unconnected input ports. */
    rawInputs: Record<string, number>;
    /** Items per second leaving through unconnected output ports. */
    outputs: Record<string, number>;
  };
}

export function emptySolveResult(status: SolveStatus = 'no-constraint'): SolveResult {
  return {
    status,
    nodes: {},
    edges: {},
    ports: {},
    totals: { powerKw: 0, pollutionPerMin: 0, rawInputs: {}, outputs: {} },
  };
}
