/**
 * A fixed-depth undo stack over immutable snapshots.
 *
 * Callers snapshot *before* mutating (`push`), so `past` holds prior states and
 * the live document is never inside the stack. `beginBatch`/`endBatch` collapse
 * a burst of changes — a node drag, an auto-layout — into one undo step.
 */

export const HISTORY_LIMIT = 100;

export interface History<T> {
  past: T[];
  future: T[];
  /** Depth of open batches; >0 means further pushes are folded into the first. */
  batchDepth: number;
  /** True once a batch has pushed its snapshot, so siblings do not push again. */
  batchPushed: boolean;
}

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [], batchDepth: 0, batchPushed: false };
}

/** Records `snapshot` as an undo point and drops the redo branch. */
export function push<T>(history: History<T>, snapshot: T): History<T> {
  if (history.batchDepth > 0 && history.batchPushed) return history;
  const past = [...history.past, snapshot];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return {
    past,
    future: [],
    batchDepth: history.batchDepth,
    batchPushed: history.batchDepth > 0,
  };
}

export function beginBatch<T>(history: History<T>): History<T> {
  return {
    ...history,
    batchDepth: history.batchDepth + 1,
    batchPushed: history.batchDepth > 0 ? history.batchPushed : false,
  };
}

export function endBatch<T>(history: History<T>): History<T> {
  const batchDepth = Math.max(0, history.batchDepth - 1);
  return { ...history, batchDepth, batchPushed: batchDepth > 0 ? history.batchPushed : false };
}

export interface Step<T> {
  history: History<T>;
  present: T;
}

/** Moves one step back, putting `present` on the redo stack. Null when empty. */
export function undo<T>(history: History<T>, present: T): Step<T> | null {
  const previous = history.past.at(-1);
  if (previous === undefined) return null;
  return {
    history: { ...history, past: history.past.slice(0, -1), future: [...history.future, present] },
    present: previous,
  };
}

export function redo<T>(history: History<T>, present: T): Step<T> | null {
  const next = history.future.at(-1);
  if (next === undefined) return null;
  return {
    history: { ...history, past: [...history.past, present], future: history.future.slice(0, -1) },
    present: next,
  };
}
