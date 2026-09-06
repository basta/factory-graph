import { useId } from 'react';
import { useStore } from '@xyflow/react';
import styles from './DotGrid.module.css';

/** Canvas pitch in graph units. */
const PITCH = 24;
/** Below this on-screen pitch the dots merge into a haze, so stop drawing. */
const MIN_SCREEN_PITCH = 9;

/**
 * The dot grid, drawn instead of React Flow's `Background`.
 *
 * React Flow draws each dot as an antialiased circle of radius 0.5, which
 * spreads one pixel of an already-quiet colour across four and leaves the grid
 * invisible at 1x. A crisp-edged 1px rect keeps the dot exactly one pixel and
 * exactly `--grid-dot`. Dots stay 1px at every zoom; only the pitch scales.
 */
export function DotGrid(): JSX.Element | null {
  const id = useId().replace(/:/g, '');
  const [offsetX, offsetY, zoom] = useStore((state) => state.transform);

  const pitch = PITCH * zoom;
  if (pitch < MIN_SCREEN_PITCH) return null;

  return (
    <svg className={styles.grid} aria-hidden="true">
      <pattern
        id={id}
        x={offsetX % pitch}
        y={offsetY % pitch}
        width={pitch}
        height={pitch}
        patternUnits="userSpaceOnUse"
      >
        <rect width={1} height={1} className={styles.dot} shapeRendering="crispEdges" />
      </pattern>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
