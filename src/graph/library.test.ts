import { beforeEach, describe, expect, it } from 'vitest';
import {
  deletePlan,
  openingPlan,
  emptyIndex,
  migrateLegacyPlan,
  newPlanId,
  readIndex,
  readPlan,
  restorePlan,
  seedLibrary,
  setActivePlan,
  writePlan,
} from './library.ts';
import { storagePrefix } from './channel.ts';
import { serializeDocument, type GraphDocument } from './serialize.ts';
import { emptyGraph } from './types.ts';
import type { GraphNode } from './types.ts';

/** Enough of the Storage API for the library, including a quota it can hit. */
class MemoryStorage {
  private data = new Map<string, string>();
  limit = Infinity;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    const size = [...this.data].reduce((n, [k, v]) => n + k.length + v.length, 0);
    if (size - (this.getItem(key)?.length ?? 0) + value.length > this.limit) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  get keys(): string[] {
    return [...this.data.keys()];
  }
}

let store: MemoryStorage;

beforeEach(() => {
  store = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
});

const note = (id: string, text: string): GraphNode => ({ id, kind: 'note', text });

function doc(projectName: string, text = 'hello'): GraphDocument {
  const graph = emptyGraph('2x1');
  graph.nodes.push(note('n1', text));
  graph.positions.n1 = { x: 1, y: 2 };
  return { graph, projectName };
}

describe('library index', () => {
  it('starts empty and survives a missing store', () => {
    expect(readIndex()).toEqual(emptyIndex());
  });

  it('adds a plan on first write and updates it on the next', () => {
    const id = newPlanId();
    expect(writePlan(id, doc('Red science'))).toBe(true);
    expect(readIndex().plans.map((p) => p.name)).toEqual(['Red science']);

    expect(writePlan(id, doc('Red science v2'))).toBe(true);
    const { plans } = readIndex();
    expect(plans).toHaveLength(1);
    expect(plans[0]!.name).toBe('Red science v2');
  });

  it('keeps plans in creation order', () => {
    const ids = ['a', 'b', 'c'].map(() => newPlanId());
    ids.forEach((id, i) => writePlan(id, doc(`Plan ${i}`)));
    // Touching the first must not move it to the end.
    writePlan(ids[0]!, doc('Plan 0 again'));
    expect(readIndex().plans.map((p) => p.id)).toEqual(ids);
  });

  it('round-trips a document through compression', () => {
    const id = newPlanId();
    const original = doc('Blue science', 'a note with … unicode ✓');
    writePlan(id, original);
    expect(readPlan(id)).toEqual(original);
  });

  it('stores plans compressed, not as plain JSON', () => {
    const id = newPlanId();
    const original = doc('Blue science');
    writePlan(id, original);
    const raw = store.getItem(`factory-graph:plan:${id}`)!;
    expect(raw).not.toContain('projectName');
    expect(raw.length).toBeLessThan(serializeDocument(original).length);
  });

  it('returns null for a plan that is not there', () => {
    expect(readPlan('nope')).toBeNull();
  });

  it('returns null for a corrupt body but leaves the entry listed', () => {
    const id = newPlanId();
    writePlan(id, doc('Broken'));
    store.setItem(`factory-graph:plan:${id}`, 'not compressed anything');

    expect(readPlan(id)).toBeNull();
    // Still listed, so the user can see it and delete it.
    expect(readIndex().plans.map((p) => p.id)).toEqual([id]);
  });

  it('reports a refused write instead of pretending to save', () => {
    const id = newPlanId();
    store.limit = 10;
    expect(writePlan(id, doc('Too big'))).toBe(false);
    expect(readIndex().plans).toEqual([]);
  });

  it('falls back to empty when the index itself is corrupt', () => {
    store.setItem('factory-graph:index', '{ not json');
    expect(readIndex()).toEqual(emptyIndex());
    store.setItem('factory-graph:index', JSON.stringify({ version: 99, plans: 'x' }));
    expect(readIndex()).toEqual(emptyIndex());
  });
});

describe('deleting and restoring', () => {
  it('removes the body and the entry, and hands back what it removed', () => {
    const id = newPlanId();
    const original = doc('Doomed');
    writePlan(id, original);

    const removed = deletePlan(id)!;
    expect(removed.meta.name).toBe('Doomed');
    expect(removed.doc).toEqual(original);
    expect(readIndex().plans).toEqual([]);
    expect(store.keys).not.toContain(`factory-graph:plan:${id}`);
  });

  it('clears activeId when the active plan is deleted', () => {
    const id = newPlanId();
    writePlan(id, doc('Active'));
    setActivePlan(id);
    deletePlan(id);
    expect(readIndex().activeId).toBeNull();
  });

  it('leaves activeId alone when another plan is deleted', () => {
    const keep = newPlanId();
    const drop = newPlanId();
    writePlan(keep, doc('Keep'));
    writePlan(drop, doc('Drop'));
    setActivePlan(keep);
    deletePlan(drop);
    expect(readIndex().activeId).toBe(keep);
  });

  it('restores a deleted plan to its original position', () => {
    const ids = [newPlanId(), newPlanId(), newPlanId()];
    ids.forEach((id, i) => writePlan(id, doc(`Plan ${i}`)));

    const removed = deletePlan(ids[1]!)!;
    expect(readIndex().plans.map((p) => p.id)).toEqual([ids[0], ids[2]]);

    expect(restorePlan(removed.meta, removed.doc, 1)).toBe(true);
    expect(readIndex().plans.map((p) => p.id)).toEqual(ids);
    expect(readPlan(ids[1]!)).toEqual(removed.doc);
  });

  it('does not duplicate an entry when restoring over a live plan', () => {
    const id = newPlanId();
    writePlan(id, doc('Here'));
    restorePlan({ id, name: 'Here', updatedAt: 1 }, doc('Here'), 0);
    expect(readIndex().plans).toHaveLength(1);
  });
});

describe('migration from the single-document key', () => {
  it('folds the old autosave into one plan and drops the old key', () => {
    const original = doc('Old factory');
    store.setItem('factory-graph:document', serializeDocument(original));

    const meta = migrateLegacyPlan()!;
    expect(meta.name).toBe('Old factory');
    expect(readPlan(meta.id)).toEqual(original);
    expect(store.getItem('factory-graph:document')).toBeNull();
  });

  it('runs once', () => {
    store.setItem('factory-graph:document', serializeDocument(doc('Old')));
    expect(migrateLegacyPlan()).not.toBeNull();
    expect(migrateLegacyPlan()).toBeNull();
    expect(readIndex().plans).toHaveLength(1);
  });

  it('drops an unreadable old autosave rather than failing the boot', () => {
    store.setItem('factory-graph:document', 'garbage');
    expect(migrateLegacyPlan()).toBeNull();
    expect(store.getItem('factory-graph:document')).toBeNull();
    expect(readIndex().plans).toEqual([]);
  });

  it('does nothing when there is no old autosave', () => {
    expect(migrateLegacyPlan()).toBeNull();
  });
});

describe('choosing the plan to open', () => {
  const fallback = (): GraphDocument => doc('Untitled factory', 'fresh');

  it('creates a plan when the library is empty', () => {
    const { id, doc: opened } = openingPlan(null, fallback);
    expect(opened).toEqual(fallback());
    expect(readIndex().plans.map((p) => p.id)).toEqual([id]);
    // Saved, not just handed back, so a reload finds it.
    expect(readPlan(id)).toEqual(fallback());
  });

  it('reopens the plan that was last active', () => {
    const other = newPlanId();
    const wanted = newPlanId();
    writePlan(other, doc('Other'));
    writePlan(wanted, doc('Wanted'));
    setActivePlan(wanted);

    expect(openingPlan(null, fallback).id).toBe(wanted);
  });

  it('falls back to another plan when the active one is unreadable', () => {
    const good = newPlanId();
    const broken = newPlanId();
    writePlan(good, doc('Good'));
    writePlan(broken, doc('Broken'));
    setActivePlan(broken);
    store.setItem(`factory-graph:plan:${broken}`, 'garbage');

    const opened = openingPlan(null, fallback);
    expect(opened.id).toBe(good);
    expect(opened.doc.projectName).toBe('Good');
  });

  it('creates a plan when every saved one is unreadable', () => {
    const broken = newPlanId();
    writePlan(broken, doc('Broken'));
    store.setItem(`factory-graph:plan:${broken}`, 'garbage');

    const opened = openingPlan(null, fallback);
    expect(opened.id).not.toBe(broken);
    expect(opened.doc).toEqual(fallback());
  });

  it('opens a share link as a new plan, leaving saved work alone', () => {
    const mine = newPlanId();
    writePlan(mine, doc('My factory'));
    setActivePlan(mine);

    const link = doc('Someone else’s factory', 'theirs');
    const opened = openingPlan(link, fallback);

    expect(opened.id).not.toBe(mine);
    expect(opened.doc).toEqual(link);
    // The whole point: what was already saved is still saved, and still mine.
    expect(readPlan(mine)).toEqual(doc('My factory'));
    expect(readIndex().plans.map((p) => p.name)).toEqual([
      'My factory',
      'Someone else’s factory',
    ]);
  });

  it('folds a pre-library autosave in before choosing', () => {
    store.setItem('factory-graph:document', serializeDocument(doc('Old factory')));

    const opened = openingPlan(null, fallback);
    expect(opened.doc.projectName).toBe('Old factory');
    expect(readIndex().plans).toHaveLength(1);
    expect(store.getItem('factory-graph:document')).toBeNull();
  });
});

describe('staging', () => {
  const live = storagePrefix('live');
  const staging = storagePrefix('staging');

  it('keeps its own keys, apart from the live site', () => {
    expect(staging).not.toBe(live);
    expect(staging.startsWith(live)).toBe(false);
  });

  it('starts from a copy of the live plans, and only once', () => {
    const id = newPlanId();
    writePlan(id, doc('Mall'));
    expect(seedLibrary(live, staging)).toBe(1);
    expect(store.getItem(`${staging}plan:${id}`)).toBe(store.getItem(`${live}plan:${id}`));
    expect(store.getItem(`${staging}index`)).toBe(store.getItem(`${live}index`));

    // A plan made on the live site later does not leak into staging, and
    // staging's own changes are never overwritten by a second seed.
    writePlan(newPlanId(), doc('Later'));
    expect(seedLibrary(live, staging)).toBe(0);
    expect(store.keys.filter((key) => key.startsWith(`${staging}plan:`))).toHaveLength(1);
  });

  it('does nothing when the live site has no plans', () => {
    expect(seedLibrary(live, staging)).toBe(0);
    expect(store.keys).toHaveLength(0);
  });
});
