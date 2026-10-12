import { describe, expect, it } from 'vitest';
import { elbowPath, routeFromPlan } from './routing.ts';

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

describe('routeFromPlan', () => {
  it('hangs a fan-out spine off the source, with the label on the branch into its consumer', () => {
    const route = routeFromPlan({ kind: 'out', reach: 50, labelT: 0.5, labelDy: 0 }, 0, 300, 500, 100);
    expect(route.junction).toEqual({ x: 50, y: 300 });
    expect(route.labelX).toBe(275);
    expect(route.labelY).toBe(100);
  });

  it('hangs a fan-in spine off the target, with the label by its producer', () => {
    const route = routeFromPlan({ kind: 'in', reach: 36, labelT: 0.5, labelDy: 0 }, 0, 120, 500, 300);
    expect(route.junction).toEqual({ x: 464, y: 300 });
    expect(route.labelY).toBe(120);
  });

  it('moves a label off its line when the plan says so', () => {
    const route = routeFromPlan({ kind: 'single', reach: 100, labelT: 0.5, labelDy: 14 }, 0, 50, 300, 50);
    expect(route.junction).toBeNull();
    expect(route.labelX).toBe(150);
    expect(route.labelY).toBe(64);
  });
});
