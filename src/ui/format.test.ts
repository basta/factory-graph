import { describe, expect, it } from 'vitest';
import { perBlock, timeAgo } from './format.ts';

const NOW = Date.UTC(2026, 0, 20, 12, 0, 0);
const ago = (ms: number): string => timeAgo(NOW - ms, NOW);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('timeAgo', () => {
  it('calls anything inside a minute "just now"', () => {
    expect(ago(0)).toBe('just now');
    expect(ago(59 * SECOND)).toBe('just now');
  });

  it('counts whole minutes, singular at one', () => {
    expect(ago(MINUTE)).toBe('1 min ago');
    expect(ago(2 * MINUTE)).toBe('2 min ago');
    expect(ago(59 * MINUTE)).toBe('59 min ago');
  });

  it('counts whole hours, singular at one', () => {
    expect(ago(HOUR)).toBe('1 hour ago');
    expect(ago(5 * HOUR)).toBe('5 hours ago');
    expect(ago(23 * HOUR)).toBe('23 hours ago');
  });

  it('names the day at one, then counts days', () => {
    expect(ago(DAY)).toBe('yesterday');
    expect(ago(2 * DAY)).toBe('2 days ago');
    expect(ago(29 * DAY)).toBe('29 days ago');
  });

  it('falls back to a date past a month', () => {
    expect(ago(40 * DAY)).toBe('Dec 11');
  });

  it('does not produce a negative age from a clock that moved', () => {
    // Another window on a machine whose clock is ahead can write a future
    // timestamp; "just now" is wrong but harmless, "-3 min ago" is broken.
    expect(timeAgo(NOW + 5 * MINUTE, NOW)).toBe('just now');
  });
});

describe('perBlock', () => {
  it('puts the block count first and the machines in each second', () => {
    expect(perBlock(6, 30)).toBe('6 × 5');
    expect(perBlock(6, 29.4)).toBe('6 × 4.9');
  });
});
