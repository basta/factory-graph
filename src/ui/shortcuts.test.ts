import { describe, expect, it } from 'vitest';
import { HINTS, SHORTCUTS, hintContext, type HintContext } from './shortcuts.ts';

describe('hintContext', () => {
  it('follows the selection, most capable node first', () => {
    expect(hintContext(['sink', 'recipe'], 0, false)).toBe('recipe');
    expect(hintContext(['sink'], 2, false)).toBe('sink');
    expect(hintContext(['source'], 0, false)).toBe('source');
    expect(hintContext(['note'], 0, false)).toBe('note');
  });

  it('falls back to connections, then to the canvas', () => {
    expect(hintContext([], 1, false)).toBe('edge');
    expect(hintContext([], 0, false)).toBe('canvas');
    expect(hintContext([], 0, true)).toBe('empty');
  });
});

describe('HINTS', () => {
  // Every key a hint teaches must be one the shortcuts list documents, so the
  // strip cannot advertise a key that does nothing. Digit runs are listed in
  // the full list as "1 to 4".
  const documented = new Set(SHORTCUTS.flatMap((group) => group.items.flatMap((item) => item.keys)));

  it.each(Object.keys(HINTS) as HintContext[])('%s only teaches documented keys', (context) => {
    for (const hint of HINTS[context]) {
      for (const key of hint.keys) {
        expect(documented.has(key) || /^[1-4]$/.test(key), `${context}: ${key}`).toBe(true);
      }
    }
  });

  it('keeps each strip short enough to read at a glance', () => {
    for (const hints of Object.values(HINTS)) expect(hints.length).toBeLessThanOrEqual(4);
  });
});
