import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, createAutosave } from './persist.ts';
import { emptyGraph } from './types.ts';
import type { GraphDocument } from './serialize.ts';

const doc = (projectName: string): GraphDocument => ({
  graph: emptyGraph('2x1'),
  projectName,
});

const names = (calls: GraphDocument[]): string[] => calls.map((d) => d.projectName);

describe('autosave debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes nothing until the delay has passed', () => {
    const written: GraphDocument[] = [];
    const autosave = createAutosave((d) => written.push(d));

    autosave.schedule(doc('a'));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    expect(written).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(names(written)).toEqual(['a']);
  });

  it('collapses a burst into one write of the newest document', () => {
    const written: GraphDocument[] = [];
    const autosave = createAutosave((d) => written.push(d));

    // Stands in for a node drag: one schedule per pointer move.
    for (const name of ['a', 'b', 'c', 'd']) {
      autosave.schedule(doc(name));
      vi.advanceTimersByTime(16);
    }
    expect(written).toEqual([]);

    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    expect(names(written)).toEqual(['d']);
  });

  it('flushes a pending document immediately', () => {
    const written: GraphDocument[] = [];
    const autosave = createAutosave((d) => written.push(d));

    autosave.schedule(doc('a'));
    autosave.flush();
    expect(names(written)).toEqual(['a']);

    // The timer must not fire a second write for the same document.
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(names(written)).toEqual(['a']);
  });

  it('flushes nothing when no document is pending', () => {
    const written: GraphDocument[] = [];
    const autosave = createAutosave((d) => written.push(d));

    autosave.flush();
    autosave.schedule(doc('a'));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    autosave.flush();

    expect(names(written)).toEqual(['a']);
  });

  it('drops a pending document on cancel', () => {
    const written: GraphDocument[] = [];
    const autosave = createAutosave((d) => written.push(d));

    autosave.schedule(doc('a'));
    autosave.cancel();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    autosave.flush();

    expect(written).toEqual([]);
  });

  it('arms again after a write', () => {
    const written: GraphDocument[] = [];
    const autosave = createAutosave((d) => written.push(d));

    autosave.schedule(doc('a'));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    autosave.schedule(doc('b'));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

    expect(names(written)).toEqual(['a', 'b']);
  });
});
