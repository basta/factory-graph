import { describe, expect, it } from 'vitest';
import { elbowPath, manifoldRoute, SPINE_REACH } from './routing.ts';

describe('elbowPath', () => {
  it('is a straight line when the ports line up', () => {
    expect(elbowPath(0, 100, 36, 400, 100)).toBe('M 0 100 L 400 100');
  });

  it('turns at the spine, with corners no bigger than the legs allow', () => {
    const path = elbowPath(0, 100, 36, 400, 104);
    expect(path).toContain('L 34 100');
    expect(path).toContain('Q 36 100 36 102');
    expect(path.endsWith('L 400 104')).toBe(true);
  });
});

describe('manifoldRoute', () => {
  it('puts a fan-out spine by the producer and each label on its own branch', () => {
    const up = manifoldRoute('out', 0, 300, 500, 100)!;
    const down = manifoldRoute('out', 0, 300, 500, 500)!;
    // One spine for both branches, so they share it rather than run side by side.
    expect(up.junction).toEqual({ x: SPINE_REACH, y: 300 });
    expect(down.junction).toEqual(up.junction);
    // Labels at their consumers' heights, so they cannot stack.
    expect(up.labelY).toBe(100);
    expect(down.labelY).toBe(500);
  });

  it('mirrors for a fan-in, with labels at the producers', () => {
    const route = manifoldRoute('in', 0, 120, 500, 300)!;
    expect(route.junction).toEqual({ x: 500 - SPINE_REACH, y: 300 });
    expect(route.labelY).toBe(120);
  });

  it('gives way to the ordinary route when there is no room', () => {
    expect(manifoldRoute('out', 0, 0, 60, 200)).toBeNull();
    expect(manifoldRoute('out', 500, 0, 0, 200)).toBeNull();
  });
});
