import { describe, expect, it } from 'vitest';
import { CHANGELOG, unseenEntries, type ChangelogEntry } from './changelog.ts';

const entry = (id: string): ChangelogEntry => ({ id, date: '', title: id, items: [] });
const list = [entry('c'), entry('b'), entry('a')];

describe('unseenEntries', () => {
  it('shows what came after the last one seen, newest first', () => {
    expect(unseenEntries(list, 'a').map((e) => e.id)).toEqual(['c', 'b']);
    expect(unseenEntries(list, 'c')).toEqual([]);
  });

  it('shows everything to someone who has seen nothing', () => {
    expect(unseenEntries(list, null)).toHaveLength(3);
  });

  it('shows nothing for an id it does not know, rather than the whole history', () => {
    expect(unseenEntries(list, 'gone')).toEqual([]);
  });
});

describe('CHANGELOG', () => {
  it('has unique ids and something to say in every entry', () => {
    expect(new Set(CHANGELOG.map((e) => e.id)).size).toBe(CHANGELOG.length);
    for (const e of CHANGELOG) expect(e.items.length).toBeGreaterThan(0);
  });

  it('follows the copy rules: no exclamation marks', () => {
    for (const e of CHANGELOG) {
      expect([e.title, ...e.items].join(' ')).not.toMatch(/!/);
    }
  });
});
