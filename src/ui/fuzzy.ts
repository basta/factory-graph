/**
 * Subsequence fuzzy matching for the add-node search.
 *
 * Scoring is deliberately simple and explainable: a match must contain every
 * query character in order, and it scores higher when characters land at word
 * starts and when they run consecutively. That makes "gc" find "Green circuit"
 * (via its id `electronic-circuit` too) and "ecirc" find "Electronic circuit",
 * while keeping the ranking stable enough that the top result does not jump
 * around as you type.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices in the haystack that the query matched, for highlighting. */
  positions: number[];
}

const SCORE_START = 12;
const SCORE_WORD_START = 9;
const SCORE_CONSECUTIVE = 6;
const SCORE_MATCH = 1;
/** Charged once per character skipped, so tighter matches win. */
const PENALTY_GAP = 0.4;

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1] ?? '';
  return previous === ' ' || previous === '-' || previous === '_' || previous === '.';
}

/**
 * Greedy left-to-right match. Returns null when `query` is not a subsequence
 * of `haystack`.
 */
export function fuzzyMatch(query: string, haystack: string): FuzzyMatch | null {
  if (query === '') return { score: 0, positions: [] };

  const needle = query.toLowerCase();
  const target = haystack.toLowerCase();
  const positions: number[] = [];

  let score = 0;
  let cursor = 0;
  let previousIndex = -2;

  for (const character of needle) {
    if (character === ' ') continue;
    const found = target.indexOf(character, cursor);
    if (found === -1) return null;

    if (found === 0) score += SCORE_START;
    else if (isBoundary(target, found)) score += SCORE_WORD_START;
    else score += SCORE_MATCH;

    if (found === previousIndex + 1) score += SCORE_CONSECUTIVE;
    else score -= Math.min(found - cursor, 10) * PENALTY_GAP;

    positions.push(found);
    previousIndex = found;
    cursor = found + 1;
  }

  // Prefer the shorter of two names that both match, so "iron plate" ranks
  // above "iron plate from molten iron".
  score -= haystack.length * 0.02;
  return { score, positions };
}

export interface Ranked<T> {
  item: T;
  score: number;
  /** Match positions in the item's display name, when the name is what hit. */
  positions: number[];
}

/**
 * Ranks `items` against `query`, matching each item's display name and its id
 * and keeping whichever scored better. Ties break on the supplied order, so an
 * empty query leaves the caller's ordering intact.
 */
export function rank<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => { name: string; id: string },
  limit: number,
): Ranked<T>[] {
  const results: Ranked<T>[] = [];

  for (const item of items) {
    const { name, id } = fields(item);
    const byName = fuzzyMatch(query, name);
    const byId = fuzzyMatch(query, id);
    if (!byName && !byId) continue;

    // An id hit is worth slightly less than a name hit: the user sees names.
    const idScore = byId ? byId.score - 2 : -Infinity;
    const nameScore = byName ? byName.score : -Infinity;
    const useName = nameScore >= idScore;
    results.push({
      item,
      score: useName ? nameScore : idScore,
      positions: useName && byName ? byName.positions : [],
    });
  }

  if (query !== '') results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
