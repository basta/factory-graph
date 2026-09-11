import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, createAutosave } from './persist.ts';
import { emptyGraph } from './types.ts';
import type { GraphDocument } from './serialize.ts';

/** What the app actually schedules: which plan to write, and what to write. */
interface Save {
  id: string;
  doc: GraphDocument;
}

const doc = (projectName: string, id = 'p1'): Save => ({
  id,
  doc: { graph: emptyGraph('2x1'), projectName },
});

const names = (calls: Save[]): string[] => calls.map((save) => save.doc.projectName);

describe('autosave debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes nothing until the delay has passed', () => {
    const written: Save[] = [];
    const autosave = createAutosave<Save>((save) => written.push(save));

    autosave.schedule(doc('a'));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    expect(written).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(names(written)).toEqual(['a']);
  });

  it('collapses a burst into one write of the newest document', () => {
    const written: Save[] = [];
    const autosave = createAutosave<Save>((save) => written.push(save));

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
    const written: Save[] = [];
    const autosave = createAutosave<Save>((save) => written.push(save));

    autosave.schedule(doc('a'));
    autosave.flush();
    expect(names(written)).toEqual(['a']);

    // The timer must not fire a second write for the same document.
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(names(written)).toEqual(['a']);
  });

  it('flushes nothing when no document is pending', () => {
    const written: Save[] = [];
    const autosave = createAutosave<Save>((save) => written.push(save));

    autosave.flush();
    autosave.schedule(doc('a'));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    autosave.flush();

    expect(names(written)).toEqual(['a']);
  });

  it('drops a pending document on cancel', () => {
    const written: Save[] = [];
    const autosave = createAutosave<Save>((save) => written.push(save));

    autosave.schedule(doc('a'));
    autosave.cancel();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    autosave.flush();

    expect(written).toEqual([]);
  });

  it('writes a pending document under the plan it was scheduled for', () => {
    const written: Save[] = [];
    const autosave = createAutosave<Save>((save) => written.push(save));

    // Edit plan a, then switch to b before the timer fires. The write that
    // lands must still be a's, under a's id — not a's document under b's id.
    autosave.schedule(doc('A edited', 'a'));
    autosave.flush();
    autosave.schedule(doc('B', 'b'));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

    expect(written).toEqual([
      { id: 'a', doc: { graph: emptyGraph('2x1'), projectName: 'A edited' } },
      { id: 'b', doc: { graph: emptyGraph('2x1'), projectName: 'B' } },
    ]);
  });

  it('arms again after a write', () => {
    const written: Save[] = [];
    const autosave = createAutosave<Save>((save) => written.push(save));

    autosave.schedule(doc('a'));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    autosave.schedule(doc('b'));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);

    expect(names(written)).toEqual(['a', 'b']);
  });
});
