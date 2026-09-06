/** True when a keystroke belongs to a field rather than to the canvas. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Whether the viewer has asked for less motion. The stylesheet already zeroes
 * CSS transitions; React Flow's pan and zoom are animated in JavaScript, so
 * they have to check this themselves.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Animation length for a viewport move, in ms. Zero when motion is reduced. */
export function viewportDuration(preferred = 120): number {
  return prefersReducedMotion() ? 0 : preferred;
}
