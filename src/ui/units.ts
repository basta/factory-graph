import { useMemo } from 'react';
import { settingsOf } from '../graph/settings.ts';
import { useGraphStore } from '../graph/store.ts';
import type { PlanSettings } from '../graph/types.ts';
import { rate } from './format.ts';

/**
 * Item rates as the plan shows them. Everything is stored and solved per
 * second; per minute is only a way of reading it, which is how science and
 * most belt maths get talked about.
 */
export interface FlowFormat {
  unit: PlanSettings['unit'];
  /** `/s` or `/min`. */
  suffix: string;
  /** Multiplies a per-second figure into the shown unit. */
  scale: number;
  /** A rate with its unit: `45/s`, `2700/min`. */
  text(perSec: number): string;
  /** The number alone, for columns where the unit goes without saying. */
  number(perSec: number): string;
}

export function flowFormat(unit: PlanSettings['unit']): FlowFormat {
  const scale = unit === 'min' ? 60 : 1;
  const suffix = unit === 'min' ? '/min' : '/s';
  return {
    unit,
    suffix,
    scale,
    text: (perSec) => `${rate(perSec * scale)}${suffix}`,
    number: (perSec) => rate(perSec * scale),
  };
}

export function useFlow(): FlowFormat {
  const unit = useGraphStore((state) => settingsOf(state.graph).unit);
  return useMemo(() => flowFormat(unit), [unit]);
}
