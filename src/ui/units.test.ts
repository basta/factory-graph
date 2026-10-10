import { describe, expect, it } from 'vitest';
import { flowFormat } from './units.ts';

describe('flowFormat', () => {
  it('shows per second as stored', () => {
    expect(flowFormat('s').text(45)).toBe('45/s');
    expect(flowFormat('s').number(0.75)).toBe('0.75');
  });

  it('scales to per minute without changing what is stored', () => {
    const perMinute = flowFormat('min');
    expect(perMinute.text(45)).toBe('2700/min');
    expect(perMinute.number(0.75)).toBe('45');
    expect(perMinute.scale).toBe(60);
  });
});
