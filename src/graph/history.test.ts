import { describe, expect, it } from 'vitest';
import {
  beginBatch,
  emptyHistory,
  endBatch,
  HISTORY_LIMIT,
  push,
  redo,
  undo,
  type History,
} from './history.ts';

const fresh = (): History<string> => emptyHistory<string>();

describe('history stack', () => {
  it('starts empty', () => {
    const history = fresh();
    expect(history.past).toEqual([]);
    expect(undo(history, 'now')).toBeNull();
    expect(redo(history, 'now')).toBeNull();
  });

  it('walks back and forward through snapshots', () => {
    let history = fresh();
    history = push(history, 'a');
    history = push(history, 'b');

    const back = undo(history, 'c')!;
    expect(back.present).toBe('b');
    const further = undo(back.history, back.present)!;
    expect(further.present).toBe('a');

    const forward = redo(further.history, further.present)!;
    expect(forward.present).toBe('b');
    const forwardAgain = redo(forward.history, forward.present)!;
    expect(forwardAgain.present).toBe('c');
    expect(redo(forwardAgain.history, forwardAgain.present)).toBeNull();
  });

  it('drops the redo branch on a new edit', () => {
    let history = push(fresh(), 'a');
    const back = undo(history, 'b')!;
    expect(back.history.future).toEqual(['b']);

    history = push(back.history, back.present);
    expect(history.future).toEqual([]);
    expect(redo(history, 'c')).toBeNull();
  });

  it('keeps at most the last HISTORY_LIMIT steps', () => {
    let history = fresh();
    for (let i = 0; i < HISTORY_LIMIT + 25; i += 1) history = push(history, `s${i}`);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    // The oldest entries fall off the bottom, not the newest off the top.
    expect(history.past[0]).toBe('s25');
    expect(history.past.at(-1)).toBe(`s${HISTORY_LIMIT + 24}`);
  });

  it('collapses a batch into one step', () => {
    let history = beginBatch(fresh());
    history = push(history, 'before');
    history = push(history, 'middle');
    history = push(history, 'later');
    history = endBatch(history);
    // Only the state from before the batch is recoverable.
    expect(history.past).toEqual(['before']);
  });

  it('collapses nested batches into the outermost one', () => {
    let history = beginBatch(fresh());
    history = push(history, 'outer');
    history = beginBatch(history);
    history = push(history, 'inner');
    history = endBatch(history);
    history = push(history, 'after-inner');
    history = endBatch(history);
    expect(history.past).toEqual(['outer']);
  });

  it('records normally again after a batch closes', () => {
    let history = beginBatch(fresh());
    history = push(history, 'a');
    history = push(history, 'b');
    history = endBatch(history);
    history = push(history, 'c');
    expect(history.past).toEqual(['a', 'c']);
  });
});
