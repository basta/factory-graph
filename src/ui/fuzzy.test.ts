import { describe, expect, it } from 'vitest';
import { fuzzyMatch, rank } from './fuzzy.ts';
import { testGameData } from '../solver/fixtures.ts';

describe('fuzzyMatch', () => {
  it('requires the query to be a subsequence', () => {
    expect(fuzzyMatch('ecirc', 'Electronic circuit')).not.toBeNull();
    expect(fuzzyMatch('zzz', 'Electronic circuit')).toBeNull();
  });

  it('reports where it matched', () => {
    const match = fuzzyMatch('ele', 'Electronic circuit');
    expect(match?.positions).toEqual([0, 1, 2]);
  });

  it('ranks a word start above the same character mid-word', () => {
    // Same query, same length, same positions — only the space differs.
    const wordStart = fuzzyMatch('sm', 'Speed module')!.score;
    const midWord = fuzzyMatch('sm', 'Speedomodule')!.score;
    expect(wordStart).toBeGreaterThan(midWord);
  });

  it('ranks initials above a scattered match', () => {
    const initials = fuzzyMatch('ec', 'Electronic circuit')!.score;
    const scattered = fuzzyMatch('ec', 'Advanced circuit')!.score;
    expect(initials).toBeGreaterThan(scattered);
  });

  it('ranks a shorter name above a longer one that also matches', () => {
    const short = fuzzyMatch('iron plate', 'Iron plate')!.score;
    const long = fuzzyMatch('iron plate', 'Iron plate from molten iron')!.score;
    expect(short).toBeGreaterThan(long);
  });

  it('treats an empty query as a match with no ranking effect', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });
});

describe('rank over the real data set', () => {
  const { data } = testGameData();
  const fields = (recipe: { name: string; id: string }) => recipe;

  const top = (query: string, limit = 5): string[] =>
    rank(data.recipes, query, fields, limit).map((entry) => entry.item.id);

  it('finds green circuits by name', () => {
    expect(top('electronic circuit')[0]).toBe('electronic-circuit');
  });

  it('finds a recipe by id when the name differs', () => {
    // "Boiler : Steam" is named nothing like its id.
    expect(top('steam', 8)).toContain('steam');
  });

  it('finds a recipe from initials', () => {
    expect(top('adv oil')).toContain('advanced-oil-processing');
  });

  it('tolerates a typo-free abbreviation', () => {
    expect(top('kovarex')[0]).toBe('kovarex-enrichment-process');
  });

  it('returns the head of the list unsorted for an empty query', () => {
    const results = rank(data.recipes, '', fields, 3);
    expect(results.map((r) => r.item.id)).toEqual(data.recipes.slice(0, 3).map((r) => r.id));
  });

  it('respects the limit', () => {
    expect(rank(data.recipes, 'a', fields, 7)).toHaveLength(7);
  });
});
