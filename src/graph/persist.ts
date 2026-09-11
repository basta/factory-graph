/**
 * Autosave timing. The store itself is `library.ts`; this is only the part
 * that decides *when* a write happens.
 */

/**
 * How long a burst of edits is allowed to run before it is written. Dragging a
 * node rewrites `positions` on every pointer move, and a write is a full
 * `JSON.stringify` of the document plus a *synchronous* `localStorage` call —
 * 48 KB at 100 nodes, on the frame budget. Coalescing the burst costs at most
 * this many milliseconds of work on a hard crash, and nothing at all on a
 * close, a reload or a tab switch, which `flush` covers.
 */
export const AUTOSAVE_DELAY_MS = 500;

export interface Autosave<T> {
  /** Records the payload and arms the timer, restarting it if already armed. */
  schedule(payload: T): void;
  /** Writes a pending payload now. A no-op when nothing is pending. */
  flush(): void;
  /** Drops a pending payload without writing it. */
  cancel(): void;
}

/**
 * A trailing debounce over `write`. Only the newest payload is kept, so a long
 * drag writes once, at the end, rather than once per frame.
 *
 * The payload carries *which* plan to write as well as what, so a write left
 * pending when the user switches plans can never land under the new plan's id.
 */
export function createAutosave<T>(
  write: (payload: T) => void,
  delay: number = AUTOSAVE_DELAY_MS,
): Autosave<T> {
  let pending: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    schedule(payload) {
      pending = payload;
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
