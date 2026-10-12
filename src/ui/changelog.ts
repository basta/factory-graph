import { CHANNEL, storagePrefix } from '../graph/channel.ts';

/**
 * What's new, newest first. Every user-visible change that ships gets an
 * entry here in the same change, and the app shows the entries a visitor has
 * not seen yet once, on their next visit. Entry ids never change once
 * shipped: the id is what "seen" is remembered by.
 *
 * Plain sentences, sentence case, the copy rules in DESIGN.md: say what it
 * does and where to find it.
 */
export interface ChangelogEntry {
  id: string;
  /** Shown as written. */
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    id: '2026-10-12-belt-shapes',
    date: '12 Oct 2026',
    title: 'Undergrounds, splitters, and laying out a recipe',
    items: [
      'Undergrounds and splitters are on the belt tool. Press 2 again to switch between belt, underground and splitter.',
      'An underground placed behind a waiting entrance becomes its exit. Each tier reaches as far as it does in the game, and an end with no partner is outlined in red.',
      'Splitters have input and output priority, and a filter that sends one item to the priority side.',
      'Select a recipe in the graph and press B to lay it out in the build view as a row sized from the plan. The report then compares the row with that node, and says up front if a belt or inserter will not keep up.',
    ],
  },
  {
    id: '2026-10-12-build-view',
    date: '12 Oct 2026',
    title: 'Build view',
    items: [
      'Each plan has a Build view, next to Graph at the top. Lay the plan out on a grid with belts, inserters and machines.',
      'Press Play to simulate it tick by tick. The panel on the right shows what the build delivers against the plan, and which machines are not keeping up.',
      'Sources supply items and sinks count what arrives. Fluids are assumed piped.',
      'Keys follow the game: R rotates, Q picks up the tool for what is under the pointer, right-click removes. Press ? for the rest.',
    ],
  },
];

/** Entries newer than the last one seen, newest first. All of them if none was. */
export function unseenEntries(
  entries: readonly ChangelogEntry[],
  lastSeenId: string | null,
): ChangelogEntry[] {
  const at = lastSeenId === null ? -1 : entries.findIndex((entry) => entry.id === lastSeenId);
  // An id we no longer know is treated as seen-everything, rather than
  // replaying the whole list at someone.
  if (lastSeenId !== null && at === -1) return [];
  return at === -1 ? [...entries] : entries.slice(0, at);
}

const KEY = `${storagePrefix(CHANNEL)}seen-changelog`;

export function readLastSeen(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function markAllSeen(entries: readonly ChangelogEntry[] = CHANGELOG): void {
  const newest = entries[0];
  if (!newest) return;
  try {
    localStorage.setItem(KEY, newest.id);
  } catch {
    // Not remembering means the popup shows again next visit; harmless.
  }
}
