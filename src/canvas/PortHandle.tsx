import { Handle, Position } from '@xyflow/react';
import type { Port } from './geometry.ts';
import { portOffsetY, type NodeShape } from './geometry.ts';
import styles from './PortHandle.module.css';

interface Props {
  port: Port;
  shape: NodeShape;
  /** Nonzero balance on a *connected* port; drives the warning ring. */
  warn: boolean;
  /**
   * Item currently being dragged from another port, or null. A handle that
   * cannot accept it says so with a red edge instead of refusing silently.
   */
  connectingItemId: string | null;
  /** Which side the in-flight connection started from. */
  connectingSide: 'in' | 'out' | null;
  title: string;
}

/**
 * One port. Squares for items, circles for fluids, sitting half outside the
 * node border so the edge visibly lands on the port rather than on the box.
 */
export function PortHandle({
  port,
  shape,
  warn,
  connectingItemId,
  connectingSide,
  title,
}: Props): JSX.Element {
  const isTarget = port.side === 'in';
  // A drag from an output looks for inputs, and vice versa.
  const isCandidate = connectingItemId !== null && connectingSide !== null && connectingSide !== port.side;
  const rejects = isCandidate && connectingItemId !== port.itemId;

  return (
    <Handle
      id={port.itemId}
      type={isTarget ? 'target' : 'source'}
      position={isTarget ? Position.Left : Position.Right}
      className={[
        styles.handle,
        port.isFluid ? styles.fluid : styles.item,
        warn ? styles.warn : '',
        rejects ? styles.rejects : '',
        isCandidate && !rejects ? styles.accepts : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ top: portOffsetY(shape, port.row) }}
      title={title}
      isConnectableStart
      isConnectableEnd
    />
  );
}
