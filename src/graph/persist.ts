import { parseDocument, serializeDocument, type GraphDocument } from './serialize.ts';

const KEY = 'factory-graph:document';

/**
 * Autosave to `localStorage`. Every failure mode here is survivable — a
 * private window, a full quota, a document written by an older build — so
 * nothing throws; a bad save is dropped and a bad load starts empty.
 */
export function saveLocal(doc: GraphDocument): void {
  try {
    localStorage.setItem(KEY, serializeDocument(doc));
  } catch {
    // Quota or a blocked store. The graph is still in memory and in the URL.
  }
}

export function loadLocal(): GraphDocument | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : parseDocument(raw);
  } catch {
    return null;
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do; the next save will overwrite it anyway.
  }
}
