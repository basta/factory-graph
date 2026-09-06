import { decodeFromHash, encodeToHash, GraphParseError, type GraphDocument } from './serialize.ts';

/**
 * The share link. The whole graph lives in the fragment, so nothing is ever
 * sent to a server and a link keeps working with no backend behind it.
 */
export function shareUrl(doc: GraphDocument): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${encodeToHash(doc)}`;
}

/** Reads a graph out of the current URL, or null when there is none. */
export function documentFromLocation(): GraphDocument | null {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === '') return null;
  try {
    return decodeFromHash(hash);
  } catch (error) {
    if (error instanceof GraphParseError) return null;
    throw error;
  }
}

/** Drops the graph from the address bar without adding a history entry. */
export function clearLocationHash(): void {
  const { origin, pathname, search } = window.location;
  window.history.replaceState(null, '', `${origin}${pathname}${search}`);
}
