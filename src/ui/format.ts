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

/**
 * A machine count split into blocks: `6 × 4.9` is six blocks of 4.9 machines.
 * Count first, because the block count is the number you lay out.
 */
export function perBlock(blocks: number, machines: number): string {
  return `${blocks} × ${rate(blocks > 0 ? machines / blocks : machines)}`;
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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago something was saved, for the plan list. Coarse on purpose —
 * the question it answers is "which of these was I just working on", and a
 * ticking "47 seconds ago" invites a precision the timestamp does not have.
 */
export function timeAgo(then: number, now: number = Date.now()): string {
  const elapsed = now - then;
  if (!Number.isFinite(elapsed)) return '';
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return minutes === 1 ? '1 min ago' : `${minutes} min ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
