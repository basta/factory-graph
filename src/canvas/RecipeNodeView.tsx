import { memo } from 'react';
import { useGameData } from '../data/context.ts';
import { useGraphStore } from '../graph/store.ts';
import { portKey, type RecipeNode } from '../graph/types.ts';
import { useSolve } from '../solver/context.ts';
import { Sprite } from '../ui/Sprite.tsx';
import { perBlock, rate } from '../ui/format.ts';
import { nodeShape, type Port } from './geometry.ts';
import { PortHandle } from './PortHandle.tsx';
import { useConnecting } from './connecting.ts';
import styles from './RecipeNodeView.module.css';

export interface NodeViewData extends Record<string, unknown> {
  nodeId: string;
}

interface Props {
  data: NodeViewData;
  selected?: boolean;
}

/** Balance smaller than this is rounding, not a problem worth a red ring. */
const BALANCE_EPSILON = 1e-6;

export const RecipeNodeView = memo(function RecipeNodeView({
  data,
  selected,
}: Props): JSX.Element | null {
  const index = useGameData();
  const node = useGraphStore((state) =>
    state.graph.nodes.find((candidate) => candidate.id === data.nodeId),
  );
  const result = useSolve();
  const connecting = useConnecting();

  if (!node || node.kind !== 'recipe') return null;

  const recipe = index.recipes.get(node.recipeId);
  const machine = index.machines.get(node.machineId);
  const shape = nodeShape(node, index);
  const solved = result?.nodes[node.id] ?? null;
  const constraint = node.constraint;
  const pinned = constraint.type === 'machines';

  // A split node reads as blocks × machines in each, the way it is laid out.
  const blocks = solved?.blocks ?? 1;
  const machines = constraint.type === 'machines' ? constraint.count : solved?.machines ?? null;
  const machineCount =
    machines === null ? '—' : blocks > 1 ? perBlock(blocks, machines) : rate(machines);
  const inBlocks = blocks > 1 ? `, in ${blocks} blocks` : '';

  return (
    <div
      className={[styles.node, selected ? styles.selected : ''].filter(Boolean).join(' ')}
      style={{ width: shape.width, height: shape.height }}
      data-testid={`node-${node.id}`}
    >
      <div className={styles.header}>
        {recipe ? <Sprite icon={recipe.icon} size={24} /> : null}
        <span className={styles.title} title={recipe?.name ?? node.recipeId}>
          {recipe?.name ?? node.recipeId}
        </span>
        <span className={styles.machine}>
          <span
            className={['mono', styles.count, pinned ? styles.pinned : ''].join(' ')}
            title={
              constraint.type === 'machines'
                ? `Fixed at ${constraint.count} machines${inBlocks}`
                : `Solved machine count${inBlocks}`
            }
          >
            {machineCount}
          </span>
          {machine ? <Sprite icon={machine.icon} size={16} title={machine.name} /> : null}
        </span>
      </div>

      {shape.moduleSlots > 0 ? (
        <div className={styles.modules}>
          {Array.from({ length: shape.moduleSlots }, (_unused, slot) => {
            const moduleId = node.modules[slot] ?? '';
            const module = moduleId ? index.modules.get(moduleId) : undefined;
            return (
              <span
                key={slot}
                className={module ? styles.slotFilled : styles.slotEmpty}
                title={module?.name ?? 'Empty module slot'}
              >
                {module ? <Sprite icon={module.icon} size={16} /> : null}
              </span>
            );
          })}
          {node.beacons && node.beacons.count > 0 ? (
            <span className={styles.beacons} title={`${node.beacons.count} beacons`}>
              {index.beacons.get(node.beacons.beaconId) ? (
                <Sprite icon={index.beacons.get(node.beacons.beaconId)!.icon} size={16} />
              ) : null}
              <span className="mono">×{node.beacons.count}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className={styles.body}>
        <div className={styles.column}>
          {shape.inputs.map((port) => (
            <PortRow
              key={`in-${port.itemId}`}
              node={node}
              port={port}
              craftsPerSec={solved?.craftsPerSec ?? null}
            />
          ))}
        </div>
        <div className={`${styles.column} ${styles.right}`}>
          {shape.outputs.map((port) => (
            <PortRow
              key={`out-${port.itemId}`}
              node={node}
              port={port}
              craftsPerSec={solved?.craftsPerSec ?? null}
            />
          ))}
        </div>
      </div>

      {[...shape.inputs, ...shape.outputs].map((port) => {
        const balance = result?.ports[portKey(node.id, port.side, port.itemId)];
        return (
          <PortHandle
            key={`${port.side}-${port.itemId}`}
            port={port}
            shape={shape}
            warn={Boolean(
              balance && balance.connected && Math.abs(balance.balance) > BALANCE_EPSILON,
            )}
            connectingItemId={connecting.nodeId === null ? null : connecting.itemId}
            connectingSide={connecting.side}
            title={portTitle(index.items.get(port.itemId)?.name ?? port.itemId, balance)}
          />
        );
      })}
    </div>
  );
});

function portTitle(
  itemName: string,
  balance: { balance: number; connected: boolean } | undefined,
): string {
  if (!balance || !balance.connected || Math.abs(balance.balance) <= BALANCE_EPSILON) {
    return itemName;
  }
  return balance.balance < 0
    ? `Missing ${rate(-balance.balance)}/s ${itemName.toLowerCase()}`
    : `${rate(balance.balance)}/s ${itemName.toLowerCase()} with nowhere to go`;
}

function PortRow({
  node,
  port,
  craftsPerSec,
}: {
  node: RecipeNode;
  port: Port;
  craftsPerSec: number | null;
}): JSX.Element {
  const index = useGameData();
  const result = useSolve();
  const item = index.items.get(port.itemId);
  const balance = result?.ports[portKey(node.id, port.side, port.itemId)];
  const warn = Boolean(balance && balance.connected && Math.abs(balance.balance) > BALANCE_EPSILON);

  // Outputs already carry productivity through the solver's port amounts, so
  // prefer the solved figure and fall back to the raw per-craft rate.
  const perSec = balance
    ? port.side === 'in'
      ? balance.consumed
      : balance.produced
    : craftsPerSec === null
      ? null
      : craftsPerSec * port.perCraft;

  return (
    <div className={styles.row}>
      {item ? <Sprite icon={item.icon} size={16} /> : null}
      <span className={['mono', styles.rate, warn ? styles.rateWarn : ''].join(' ')}>
        {perSec === null ? '—' : rate(perSec)}
      </span>
      <span className={styles.itemName} title={item?.name ?? port.itemId}>
        {item?.name ?? port.itemId}
      </span>
    </div>
  );
}
