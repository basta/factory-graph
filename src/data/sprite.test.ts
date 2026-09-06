import { describe, expect, it } from 'vitest';
import { testGameData } from '../solver/fixtures.ts';
import { spriteStyle } from './sprite.ts';

const { data, items } = testGameData();

describe('sprite lookup', () => {
  it('places an icon at its native size', () => {
    const icon = items.get('iron-plate')!.icon;
    const style = spriteStyle(data, icon, 64);
    expect(style.backgroundPosition).toBe(`${-icon.x}px ${-icon.y}px`);
    expect(style.backgroundSize).toBe(`${data.sprite.width}px ${data.sprite.height}px`);
    expect(style.width).toBe('64px');
  });

  it('scales the whole sheet when the slot is smaller', () => {
    const icon = items.get('copper-plate')!.icon;
    const style = spriteStyle(data, icon, 16);
    // A quarter-size slot means a quarter-size sheet and quarter-size offsets.
    expect(style.backgroundPosition).toBe(`${-icon.x / 4}px ${-icon.y / 4}px`);
    expect(style.backgroundSize).toBe(`${data.sprite.width / 4}px ${data.sprite.height / 4}px`);
    expect(style.height).toBe('16px');
  });

  it('points at the vendored sheet, not at FactorioLab', () => {
    const style = spriteStyle(data, items.get('water')!.icon, 24);
    expect(style.backgroundImage).toContain('sprites/2x1.webp');
    expect(style.backgroundImage).not.toContain('http');
  });
});
