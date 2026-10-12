/**
 * A sliding-window counter: how much of something happened over the last
 * `WINDOW_SECONDS`, in one-second buckets. Rates read from it settle once a
 * design reaches steady state instead of averaging in the minute it spent
 * filling its belts.
 */

export const TICKS_PER_SECOND = 60;
export const WINDOW_SECONDS = 30;

export interface Meter {
  buckets: Float64Array;
  /** The second the newest bucket belongs to. */
  second: number;
}

export function createMeter(): Meter {
  return { buckets: new Float64Array(WINDOW_SECONDS), second: 0 };
}

function roll(meter: Meter, tick: number): void {
  const second = Math.floor(tick / TICKS_PER_SECOND);
  if (second === meter.second) return;
  // Zero every bucket the clock skipped past, at most the whole ring.
  const skipped = Math.min(second - meter.second, WINDOW_SECONDS);
  for (let i = 1; i <= skipped; i += 1) {
    meter.buckets[(meter.second + i) % WINDOW_SECONDS] = 0;
  }
  meter.second = second;
}

export function record(meter: Meter, tick: number, amount = 1): void {
  roll(meter, tick);
  meter.buckets[meter.second % WINDOW_SECONDS]! += amount;
}

export function windowSum(meter: Meter, tick: number): number {
  roll(meter, tick);
  let sum = 0;
  for (const value of meter.buckets) sum += value;
  return sum;
}

/**
 * Seconds of history the window holds after `tick` ticks have run: all of
 * them early on, so the first rates are not diluted, then the full buckets
 * plus however far into the newest one the clock has got.
 */
export function windowSeconds(tick: number): number {
  const covered = Math.min(
    tick,
    (WINDOW_SECONDS - 1) * TICKS_PER_SECOND + (tick % TICKS_PER_SECOND),
  );
  return covered / TICKS_PER_SECOND;
}

/** Per second over the window. */
export function meterRate(meter: Meter, tick: number): number {
  const seconds = windowSeconds(tick);
  return seconds > 0 ? windowSum(meter, tick) / seconds : 0;
}
