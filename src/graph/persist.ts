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

/**
 * How long a burst of edits is allowed to run before it is written. Dragging a
 * node rewrites `positions` on every pointer move, and a write is a full
 * `JSON.stringify` of the document plus a *synchronous* `localStorage` call —
 * 48 KB at 100 nodes, on the frame budget. Coalescing the burst costs at most
 * this many milliseconds of work on a hard crash, and nothing at all on a
 * close, a reload or a tab switch, which `flush` covers.
 */
export const AUTOSAVE_DELAY_MS = 500;

export interface Autosave {
  /** Records the document and arms the timer, restarting it if already armed. */
  schedule(doc: GraphDocument): void;
  /** Writes a pending document now. A no-op when nothing is pending. */
  flush(): void;
  /** Drops a pending document without writing it. */
  cancel(): void;
}

/**
 * A trailing debounce over `write`. Only the newest document is kept, so a
 * long drag writes once, at the end, rather than once per frame.
 */
export function createAutosave(
  write: (doc: GraphDocument) => void,
  delay: number = AUTOSAVE_DELAY_MS,
): Autosave {
  let pending: GraphDocument | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    schedule(doc) {
      pending = doc;
      clear();
      timer = setTimeout(() => {
        timer = null;
        const doomed = pending;
        pending = null;
        if (doomed) write(doomed);
      }, delay);
    },
    flush() {
      clear();
      const doomed = pending;
      pending = null;
      if (doomed) write(doomed);
    },
    cancel() {
      clear();
      pending = null;
    },
  };
}

/**
 * Calls `flush` whenever the page is going away. `pagehide` and a hidden
 * `visibilitychange` are the two that actually fire on mobile Safari, where
 * `beforeunload` is not dispatched at all; both are registered because a
 * background tab that is later killed only ever sees `visibilitychange`.
 */
export function flushOnHide(flush: () => void): () => void {
  const onHide = (): void => flush();
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
