import { useGameData } from '../data/context.ts';
import { useGraphStore } from '../graph/store.ts';
import type { FlowEdge, RecipeNode, Transport } from '../graph/types.ts';
import { useSolve } from '../solver/context.ts';
import { linesNeeded } from '../solver/rates.ts';
import { NumberField } from './NumberField.tsx';
import { PickerRow } from './PickerRow.tsx';
import { Sprite } from './Sprite.tsx';
import { percent } from './format.ts';
import { useFlow } from './units.ts';
import styles from './Inspector.module.css';

interface Props {
  edges: FlowEdge[];
}

type Kind = 'none' | 'belt' | 'pipe' | 'inserter';

/**
 * How an item gets from one machine to the next. Setting a transport does not
 * change any rate — it only gives the edge a capacity to be measured against,
 * which is what turns a number into "this belt is not going to be enough".
 */
export function EdgeInspector({ edges }: Props): JSX.Element {
  const index = useGameData();
  const result = useSolve();
  const flow = useFlow();
  const setTransport = useGraphStore((state) => state.setTransport);
  const setBlocks = useGraphStore((state) => state.setBlocks);
  const removeEdges = useGraphStore((state) => state.removeEdges);
  const nodes = useGraphStore((state) => state.graph.nodes);
  const beginBatch = useGraphStore((state) => state.beginBatch);
  const endBatch = useGraphStore((state) => state.endBatch);

  const first = edges[0]!;
  const item = index.items.get(first.fromPort);
  const isFluid = item?.isFluid ?? false;
  const solved = result?.edges[first.id] ?? null;

  const kind: Kind = first.transport?.kind ?? 'none';

  const applyAll = (next: (edge: FlowEdge) => Transport): void => {
    beginBatch();
    for (const edge of edges) setTransport(edge.id, next(edge));
    endBatch();
  };

  const setKind = (nextKind: Kind): void => {
    applyAll(() => {
      if (nextKind === 'none') return null;
      if (nextKind === 'belt') {
        const beltId = index.data.defaults.beltId ?? index.data.belts[0]?.id;
        return beltId ? { kind: 'belt', beltId, lanes: 2 } : null;
      }
      if (nextKind === 'pipe') {
        const pipeId = index.data.defaults.pipeId ?? index.data.pipes[0]?.id;
        return pipeId ? { kind: 'pipe', pipeId } : null;
      }
      const inserterId = index.data.defaults.inserterId ?? index.data.inserters[0]?.id;
      return inserterId ? { kind: 'inserter', inserterId, count: 1 } : null;
    });
  };

  // Fluids move in pipes, everything else on belts and inserters. Offering the
  // wrong one would only produce a meaningless capacity.
  const kinds: { value: Kind; label: string }[] = isFluid
    ? [
        { value: 'none', label: 'None' },
        { value: 'pipe', label: 'Pipe' },
      ]
    : [
        { value: 'none', label: 'None' },
        { value: 'belt', label: 'Belt' },
        { value: 'inserter', label: 'Inserter' },
      ];

  const transport = first.transport;
  const over = solved?.saturation !== null && (solved?.saturation ?? 0) > 1;

  // Splitting into blocks gives each block its own belt or pipe, so it can fix
  // an overloaded one; inserter counts are totals and it cannot. The producer
  // goes first: planning back from a sink, it is the node just added.
  const splitTarget =
    over && (transport?.kind === 'belt' || transport?.kind === 'pipe')
      ? [first.from, first.to]
          .map((id) => nodes.find((node) => node.id === id))
          .find(
            (node): node is RecipeNode =>
              node?.kind === 'recipe' && node.blocks?.type !== 'fit',
          )
      : undefined;
  const splitName = splitTarget
    ? (index.recipes.get(splitTarget.recipeId)?.name ?? splitTarget.recipeId).toLowerCase()
    : '';

  return (
    <>
      <section className={styles.section}>
        <div className={styles.row}>
          <span className={styles.label}>Item</span>
          <span className={styles.value}>{item?.name ?? first.fromPort}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Rate</span>
          <span className={`mono ${styles.value}`}>
            {solved ? flow.text(solved.perSec) : '—'}
          </span>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.row}>
          <span className={styles.label}>Transport</span>
          <div className={styles.segmented}>
            {kinds.map((option) => (
              <button
                key={option.value}
                type="button"
                className={[styles.segment, kind === option.value ? styles.segmentOn : '']
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={kind === option.value}
                onClick={() => setKind(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {transport?.kind === 'belt' ? (
          <>
            <PickerRow
              label="Belt"
              value={transport.beltId}
              placeholder="None"
              options={index.data.belts}
              onChange={(beltId) =>
                applyAll((edge) =>
                  edge.transport?.kind === 'belt' ? { ...edge.transport, beltId } : edge.transport,
                )
              }
            />
            <div className={styles.row}>
              <span className={styles.label}>Lanes</span>
              <div className={styles.segmented}>
                {[1, 2].map((lanes) => (
                  <button
                    key={lanes}
                    type="button"
                    className={[
                      styles.segment,
                      transport.lanes === lanes ? styles.segmentOn : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-pressed={transport.lanes === lanes}
                    onClick={() =>
                      applyAll((edge) =>
                        edge.transport?.kind === 'belt'
                          ? { ...edge.transport, lanes: lanes === 1 ? 1 : 2 }
                          : edge.transport,
                      )
                    }
                  >
                    {lanes === 1 ? 'One' : 'Both'}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {transport?.kind === 'pipe' ? (
          <PickerRow
            label="Pipe"
            value={transport.pipeId}
            placeholder="None"
            options={index.data.pipes}
            onChange={(pipeId) =>
              applyAll((edge) =>
                edge.transport?.kind === 'pipe' ? { ...edge.transport, pipeId } : edge.transport,
              )
            }
          />
        ) : null}

        {transport?.kind === 'inserter' ? (
          <>
            <PickerRow
              label="Inserter"
              value={transport.inserterId}
              placeholder="None"
              options={index.data.inserters}
              onChange={(inserterId) =>
                applyAll((edge) =>
                  edge.transport?.kind === 'inserter'
                    ? { ...edge.transport, inserterId }
                    : edge.transport,
                )
              }
            />
            <NumberField
              label="Count"
              value={transport.count}
              min={1}
              step={1}
              onCommit={(count) =>
                applyAll((edge) =>
                  edge.transport?.kind === 'inserter'
                    ? { ...edge.transport, count: Math.max(1, Math.round(count)) }
                    : edge.transport,
                )
              }
            />
          </>
        ) : null}
      </section>

      {solved && solved.capacityPerSec !== null ? (
        <section className={styles.section}>
          <div className={styles.row}>
            <span className={styles.label}>Capacity</span>
            <span className={`mono ${styles.value}`}>{flow.text(solved.capacityPerSec)}</span>
          </div>
          {solved.parallel > 1 ? (
            <div className={styles.row}>
              <span className={styles.label}>{transport?.kind === 'pipe' ? 'Pipes' : 'Belts'}</span>
              <span className={`mono ${styles.value}`}>{solved.parallel}</span>
            </div>
          ) : null}
          <div className={styles.row}>
            <span className={styles.label}>Saturation</span>
            <span className={`mono ${styles.value} ${over ? styles.valueWarn : ''}`}>
              {percent(solved.saturation ?? 0)}
            </span>
          </div>
          {transport?.kind === 'belt' ? (
            // The sum you would otherwise do in your head: this flow, on each
            // tier of belt, at the lanes chosen above.
            <div className={styles.row}>
              <span className={styles.label}>Belts needed</span>
              <span className={styles.tiers}>
                {index.data.belts.map((belt) => (
                  <span key={belt.id} className={styles.tier} title={belt.name}>
                    <Sprite icon={belt.icon} size={16} />
                    <span className="mono">
                      {linesNeeded(solved.perSec, (belt.itemsPerSec * transport.lanes) / 2)}
                    </span>
                  </span>
                ))}
              </span>
            </div>
          ) : null}
          {over && splitTarget ? (
            <>
              <p className={styles.note}>
                Over capacity. Split the {splitName} machines into blocks, each on its own{' '}
                {transport?.kind === 'pipe' ? 'pipe' : 'belt'}.
              </p>
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.toggle}
                  onClick={() => setBlocks(splitTarget.id, { type: 'fit' })}
                >
                  Split {splitName} to fit
                </button>
              </div>
            </>
          ) : over ? (
            <p className={styles.note}>
              Over capacity. Use a faster belt, split the flow, or add a lane.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.remove}
          onClick={() => removeEdges(edges.map((edge) => edge.id))}
        >
          Delete {edges.length === 1 ? 'connection' : `${edges.length} connections`}
        </button>
      </div>
    </>
  );
}
