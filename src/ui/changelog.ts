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
    id: '2026-10-12-whole-plan',
    date: '12 Oct 2026',
    title: 'Lay out the whole plan',
    items: [
      'Press Shift B, or Lay out plan in the build toolbar, to build every recipe in the plan at once: one row per recipe, stacked in production order, with belts routed between them. Belts go round what is in the way, or under it with undergrounds.',
      'Raw inputs come from sources and the final products go to sinks that know the planned rate. Where one output feeds several recipes, the first gets a belt and the rest get a source, and the message says how many.',
      'Machines are drawn in red only when they wait for ingredients. One sitting idle because nothing downstream needs more stays brass.',
      'Inserters now drop into any gap on their tile, so two inserters can share a busy lane.',
    ],
  },
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
  {
    id: '2026-10-10-tidier-connections',
    date: '10 Oct 2026',
    title: 'Tidier connections and layout',
    items: [
      'One output feeding several inputs is drawn as one line that branches, with each rate next to the machine it feeds. The same goes for several outputs feeding one input.',
      'Connections no longer run along the same line, and rate labels move clear of each other and of nodes.',
      'Tidy up (Ctrl L) lines up ports rather than node centres, so most connections run straight.',
    ],
  },
  {
    id: '2026-10-10-fewer-clicks',
    date: '10 Oct 2026',
    title: 'Fewer clicks when planning',
    items: [
      'The bar at the top left sets the belt new connections start on, the machines new nodes use, /s or /min, and which items come from the bus. Changing the belt or a machine there moves everything that was following it.',
      'Select a node and press E to build what feeds its open inputs. Press E again to go one step further back. It stops at bus items, and asks when an item has more than one sensible recipe.',
      'Shift Enter in the search adds the item as a sink, ready for you to type its rate. Nodes already on the canvas come first in the search, and recycling comes last.',
      'With connections selected, 1 to 4 set the belt and 0 removes it. With machines selected, 1 to 3 set the tier.',
      'Double-click a machine count or a rate to type it in place. Click a rate label to select its connection.',
      'The strip along the bottom shows the keys for whatever is selected.',
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
