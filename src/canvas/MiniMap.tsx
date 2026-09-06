import { useCallback, useEffect, useRef, type MouseEvent } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { useGameData } from '../data/context.ts';
import { useGraphStore } from '../graph/store.ts';
import { nodeShape } from './geometry.ts';
import { viewportDuration } from '../ui/keys.ts';
import styles from './MiniMap.module.css';

const WIDTH = 168;
const HEIGHT = 108;
const PADDING = 24;

/**
 * A minimap drawn from the graph rather than from React Flow's own component,
 * so the node fills, the viewport frame and the click-to-centre behaviour all
 * follow the app's tokens. Hidden until there is something to map.
 */
export function MiniMap(): JSX.Element | null {
  const index = useGameData();
  const graph = useGraphStore((state) => state.graph);
  const selection = useGraphStore((state) => state.selection);
  const flow = useReactFlow();
  const [translateX, translateY, zoom] = useStore((state) => state.transform);
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);

  const boxes = graph.nodes.map((node) => {
    const shape = nodeShape(node, index);
    const position = graph.positions[node.id] ?? { x: 0, y: 0 };
    return { id: node.id, ...position, width: shape.width, height: shape.height };
  });

  // The viewport rectangle in graph coordinates.
  const view = {
    x: -translateX / zoom,
    y: -translateY / zoom,
    width: paneWidth / zoom,
    height: paneHeight / zoom,
  };

  const bounds = boxes.reduce(
    (accumulated, box) => ({
      minX: Math.min(accumulated.minX, box.x),
      minY: Math.min(accumulated.minY, box.y),
      maxX: Math.max(accumulated.maxX, box.x + box.width),
      maxY: Math.max(accumulated.maxY, box.y + box.height),
    }),
    { minX: view.x, minY: view.y, maxX: view.x + view.width, maxY: view.y + view.height },
  );

  const viewBox: [number, number, number, number] = [
    bounds.minX - PADDING,
    bounds.minY - PADDING,
    Math.max(1, bounds.maxX - bounds.minX + PADDING * 2),
    Math.max(1, bounds.maxY - bounds.minY + PADDING * 2),
  ];

  // The click handler needs the current viewBox and zoom, both of which change
  // on every pan. Parking them in a ref keeps the handler itself stable; the
  // write happens after paint, which is soon enough for a click target.
  const latest = useRef({ viewBox, zoom });
  useEffect(() => {
    latest.current = { viewBox, zoom };
  });

  const onClick = useCallback(
    (event: MouseEvent<SVGSVGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const { viewBox: box, zoom: scale } = latest.current;
      const fraction = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      };
      flow.setCenter(box[0] + fraction.x * box[2], box[1] + fraction.y * box[3], {
        zoom: scale,
        duration: viewportDuration(),
      });
    },
    [flow],
  );

  if (boxes.length === 0) return null;

  return (
    <svg
      className={styles.minimap}
      width={WIDTH}
      height={HEIGHT}
      viewBox={viewBox.join(' ')}
      preserveAspectRatio="xMidYMid meet"
      onClick={onClick}
      role="img"
      aria-label="Graph overview"
    >
      {boxes.map((box) => (
        <rect
          key={box.id}
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          className={selection.includes(box.id) ? styles.selected : styles.node}
        />
      ))}
      <rect
        x={view.x}
        y={view.y}
        width={view.width}
        height={view.height}
        className={styles.viewport}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
