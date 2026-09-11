import { z } from 'zod';
import lzString from 'lz-string';
import { parseDocument, serializeDocument, type GraphDocument } from './serialize.ts';

// Same CommonJS-interop dance as `serialize.ts`: the named exports are only
// reachable off the default when Node's ESM loader is the one resolving it.
const { compressToUTF16, decompressFromUTF16 } = lzString;

/**
 * Saved plans in `localStorage`.
 *
 * One key per plan plus a small index, rather than a single blob, for three
 * reasons: an autosave rewrites one plan instead of all of them, a plan that
 * fails to parse can be dropped on its own, and a quota error takes down the
 * save it belongs to instead of the whole library.
 *
 * Bodies are lz-string compressed — the same trick the share link uses, worth
 * roughly 4x on a real graph — so the 5 MB budget holds a hundred-odd plans.
 */

const INDEX_KEY = 'factory-graph:index';
const PLAN_PREFIX = 'factory-graph:plan:';
/** The single-document key this replaced. Read once, then removed. */
const LEGACY_KEY = 'factory-graph:document';

const planKey = (id: string): string => `${PLAN_PREFIX}${id}`;

export interface PlanMeta {
  id: string;
  name: string;
  /** Epoch ms of the last write, for "last edited" and nothing else. */
  updatedAt: number;
}

export interface LibraryIndex {
  version: 1;
  /** Creation order. Stable on purpose: a plan never moves under the cursor. */
  plans: PlanMeta[];
  activeId: string | null;
}

const indexSchema = z.object({
  version: z.literal(1),
  plans: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      updatedAt: z.number().finite().nonnegative(),
    }),
  ),
  activeId: z.string().nullable(),
});

export const emptyIndex = (): LibraryIndex => ({ version: 1, plans: [], activeId: null });

let counter = 0;
export function newPlanId(): string {
  counter += 1;
  return `p${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// --- raw storage -------------------------------------------------------------
// Every read is allowed to fail: a private window throws on access, a quota
// error truncates a write, and a key may have been written by an older build.

function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Already gone as far as anyone can tell.
  }
}

// --- index -------------------------------------------------------------------

export function readIndex(): LibraryIndex {
  const raw = getItem(INDEX_KEY);
  if (raw === null) return emptyIndex();
  try {
    const parsed = indexSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyIndex();
  } catch {
    return emptyIndex();
  }
}

function writeIndex(index: LibraryIndex): boolean {
  return setItem(INDEX_KEY, JSON.stringify(index));
}

/** Read, change, write. Returns the index as it now stands on disk. */
function updateIndex(change: (index: LibraryIndex) => LibraryIndex): LibraryIndex {
  const next = change(readIndex());
  writeIndex(next);
  return next;
}

// --- plans -------------------------------------------------------------------

export function readPlan(id: string): GraphDocument | null {
  const raw = getItem(planKey(id));
  if (raw === null) return null;
  try {
    const json = decompressFromUTF16(raw);
    return json ? parseDocument(json) : null;
  } catch {
    // A plan written by a future version, or a half-written one. The index
    // entry is left alone so the plan still shows up and can be deleted.
    return null;
  }
}

/**
 * Writes the body and refreshes the plan's index entry, adding it when the
 * plan is new. False means the write was refused — a full quota, usually —
 * and the caller should say so rather than pretend the plan is saved.
 */
export function writePlan(id: string, doc: GraphDocument): boolean {
  if (!setItem(planKey(id), compressToUTF16(serializeDocument(doc)))) return false;
  const meta: PlanMeta = { id, name: doc.projectName, updatedAt: Date.now() };
  updateIndex((index) => ({
    ...index,
    plans: index.plans.some((plan) => plan.id === id)
      ? index.plans.map((plan) => (plan.id === id ? meta : plan))
      : [...index.plans, meta],
  }));
  return true;
}

/** Removes the body and the index entry. Returns what was removed. */
export function deletePlan(id: string): { meta: PlanMeta; doc: GraphDocument } | null {
  const doc = readPlan(id);
  const meta = readIndex().plans.find((plan) => plan.id === id);
  removeItem(planKey(id));
  updateIndex((index) => ({
    ...index,
    plans: index.plans.filter((plan) => plan.id !== id),
    activeId: index.activeId === id ? null : index.activeId,
  }));
  return meta && doc ? { meta, doc } : null;
}

export function setActivePlan(id: string | null): void {
  updateIndex((index) => ({ ...index, activeId: id }));
}

/**
 * Restores a deleted plan in its original position, so undoing a delete does
 * not silently move the plan to the end of the list.
 */
export function restorePlan(meta: PlanMeta, doc: GraphDocument, at: number): boolean {
  if (!setItem(planKey(meta.id), compressToUTF16(serializeDocument(doc)))) return false;
  updateIndex((index) => {
    if (index.plans.some((plan) => plan.id === meta.id)) return index;
    const plans = [...index.plans];
    plans.splice(Math.max(0, Math.min(at, plans.length)), 0, meta);
    return { ...index, plans };
  });
  return true;
}

/**
 * Folds a pre-library autosave into the library as one plan. Runs once: the
 * old key is dropped on success, so a second call finds nothing.
 */
export function migrateLegacyPlan(): PlanMeta | null {
  const raw = getItem(LEGACY_KEY);
  if (raw === null) return null;
  let doc: GraphDocument | null = null;
  try {
    doc = parseDocument(raw);
  } catch {
    doc = null;
  }
  removeItem(LEGACY_KEY);
  if (!doc) return null;
  const id = newPlanId();
  if (!writePlan(id, doc)) return null;
  return { id, name: doc.projectName, updatedAt: Date.now() };
}

/**
 * Calls `onChange` when another window writes to the library. Storage events
 * only fire in *other* windows, so this never reacts to our own writes.
 */
export function watchLibrary(onChange: (changedPlanId: string | null) => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === null) {
      // `localStorage.clear()` elsewhere. Everything is suspect.
      onChange(null);
    } else if (event.key === INDEX_KEY) {
      onChange(null);
    } else if (event.key.startsWith(PLAN_PREFIX)) {
      onChange(event.key.slice(PLAN_PREFIX.length));
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
