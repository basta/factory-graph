/** Number formatting for the mono columns. Consistent width beats precision. */

/** Rates and machine counts: 3 significant-ish digits, no trailing zero noise. */
export function rate(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude === 0) return '0';
  if (magnitude < 0.001) return value.toExponential(1);
  if (magnitude < 1) return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  if (magnitude < 100) return trimZeros(value.toFixed(2));
  if (magnitude < 10000) return trimZeros(value.toFixed(1));
  return Math.round(value).toLocaleString('en-US');
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** kW below 1000, then MW, then GW. */
export function power(kw: number): string {
  if (!Number.isFinite(kw)) return '—';
  const magnitude = Math.abs(kw);
  if (magnitude < 1000) return `${rate(kw)} kW`;
  if (magnitude < 1_000_000) return `${rate(kw / 1000)} MW`;
  return `${rate(kw / 1_000_000)} GW`;
}

export function pollution(perMin: number): string {
  return Number.isFinite(perMin) ? `${rate(perMin)}/min` : '—';
}

export function percent(fraction: number): string {
  return Number.isFinite(fraction) ? `${Math.round(fraction * 100)}%` : '—';
}
