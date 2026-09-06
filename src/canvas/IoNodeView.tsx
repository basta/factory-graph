import { memo } from 'react';
import { useGameData } from '../data/context.ts';
import { useGraphStore } from '../graph/store.ts';
import { portKey } from '../graph/types.ts';
import { useSolve } from '../solver/context.ts';
import { Sprite } from '../ui/Sprite.tsx';
import { rate } from '../ui/format.ts';
import { nodeShape } from './geometry.ts';
import { PortHandle } from './PortHandle.tsx';
import { useConnecting } from './connecting.ts';
import type { NodeViewData } from './RecipeNodeView.tsx';
import styles from './IoNodeView.module.css';

interface Props {
  data: NodeViewData;
  selected?: boolean;
}

/**
 * A source or a sink: where the graph meets the rest of the factory. Same
 * rectangle as a recipe node — the item names the node, and the one number is
 * its rate.
 */
export const IoNodeView = memo(function IoNodeView({ data, selected }: Props): JSX.Element | null {
  const index = useGameData();
  const node = useGraphStore((state) =>
    state.graph.nodes.find((candidate) => candidate.id === data.nodeId),
  );
  const result = useSolve();
  const connectingNodeId = useConnecting((state) => state.nodeId);
  const connectingItemId = useConnecting((state) => state.itemId);
  const connectingSide = useConnecting((state) => state.side);

  if (!node || (node.kind !== 'source' && node.kind !== 'sink')) return null;

  const isSource = node.kind === 'source';
  const item = index.items.get(node.itemId);
  const shape = nodeShape(node, index);
  const port = (isSource ? shape.outputs : shape.inputs)[0];
  const solvedPort = result?.ports[portKey(node.id, isSource ? 'out' : 'in', node.itemId)];
  const constraint = node.constraint;
  const pinned = constraint.type === 'rate';

  const value =
    constraint.type === 'rate'
      ? constraint.perSec
      : solvedPort
        ? isSource
          ? solvedPort.produced
          : solvedPort.consumed
        : null;

  return (
    <div
      className={[styles.node, selected ? styles.selected : ''].filter(Boolean).join(' ')}
      style={{ width: shape.width, height: shape.height }}
      data-testid={`node-${node.id}`}
    >
      <div className={styles.header}>
        {item ? <Sprite icon={item.icon} size={20} /> : null}
        <span className={styles.title} title={item?.name ?? node.itemId}>
          {item?.name ?? node.itemId}
        </span>
      </div>
      <div className={styles.body}>
        <span className={styles.kind}>{isSource ? 'Source' : 'Sink'}</span>
        <span
          className={['mono', styles.rate, pinned ? styles.pinned : ''].join(' ')}
          title={
            constraint.type === 'rate' ? `Fixed at ${rate(constraint.perSec)}/s` : 'Solved rate'
          }
        >
          {value === null ? '—' : `${rate(value)}/s`}
        </span>
      </div>
      {port ? (
        <PortHandle
          port={port}
          shape={shape}
          warn={false}
          connectingItemId={connectingNodeId === null ? null : connectingItemId}
          connectingSide={connectingSide}
          title={item?.name ?? node.itemId}
        />
      ) : null}
    </div>
  );
});
