import { useMemo } from 'react';
import { useGameData } from '../data/context.ts';
import { useGraphStore } from '../graph/store.ts';
import type { GraphNode, RecipeNode } from '../graph/types.ts';
import { useSolve } from '../solver/context.ts';
import { blockedEffects } from '../solver/rates.ts';
import { EdgeInspector } from './EdgeInspector.tsx';
import { NumberField } from './NumberField.tsx';
import { PickerRow } from './PickerRow.tsx';
import { Sprite } from './Sprite.tsx';
import { pollution, power, rate } from './format.ts';
import styles from './Inspector.module.css';

interface Props {
  /** Node ids currently selected. */
  selection: string[];
  /** Edge ids currently selected; used only when no node is selected. */
  selectedEdges: string[];
  onClose: () => void;
}

/**
 * The edit surface for the selection. With more than one node selected it
 * shows only the fields the selection has in common and applies an edit to
 * every one of them.
 */
export function Inspector({ selection, selectedEdges, onClose }: Props): JSX.Element {
  const index = useGameData();
  // Select the stable array and narrow it here: a selector that builds a new
  // array on every store read never settles under useSyncExternalStore.
  const allNodes = useGraphStore((state) => state.graph.nodes);
  const allEdges = useGraphStore((state) => state.graph.edges);
  const nodes = useMemo(
    () => allNodes.filter((node) => selection.includes(node.id)),
    [allNodes, selection],
  );
  // A node selection wins: selecting a node also selects nothing else, and
  // showing both panels at once would be two panels arguing.
  const edges = useMemo(
    () => (nodes.length > 0 ? [] : allEdges.filter((edge) => selectedEdges.includes(edge.id))),
    [allEdges, selectedEdges, nodes.length],
  );
  const result = useSolve();
  const removeNodes = useGraphStore((state) => state.removeNodes);

  const open = nodes.length > 0 || edges.length > 0;
  const recipes = nodes.filter((node): node is RecipeNode => node.kind === 'recipe');
  const multi = nodes.length > 1;

  return (
    <aside
      className={[styles.inspector, open ? styles.open : ''].filter(Boolean).join(' ')}
      aria-hidden={!open}
      aria-label="Node inspector"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      {open ? (
        <>
          <div className={styles.head}>
            <span className={styles.title}>
              {edges.length > 0 ? edgeTitle(edges, index) : titleFor(nodes, index)}
            </span>
          </div>

          {edges.length > 0 ? <EdgeInspector edges={edges} /> : null}

          {recipes.length > 0 ? (
            <RecipeSections nodes={recipes} multi={multi} />
          ) : null}

          {/* `[].every()` is true, so the length check is what stops this
              rendering when only an edge is selected. */}
          {nodes.length > 0 &&
          nodes.every((node) => node.kind === 'source' || node.kind === 'sink') ? (
            <section className={styles.section}>
              <RateConstraint nodes={nodes} />
            </section>
          ) : null}

          {result && recipes.length > 0 ? (
            <section className={styles.section}>
              {recipes.length === 1 && result.nodes[recipes[0]!.id] ? (
                <>
                  <Field
                    label="Crafts/s"
                    value={rate(result.nodes[recipes[0]!.id]!.craftsPerSec)}
                  />
                  <Field
                    label="Machines"
                    value={`${rate(result.nodes[recipes[0]!.id]!.machines)} (build ${result.nodes[recipes[0]!.id]!.machinesCeil})`}
                  />
                  <Field label="Power" value={power(result.nodes[recipes[0]!.id]!.powerKw)} />
                  <Field
                    label="Pollution"
                    value={pollution(result.nodes[recipes[0]!.id]!.pollutionPerMin)}
                  />
                </>
              ) : (
                <Field
                  label="Power"
                  value={power(
                    recipes.reduce((sum, node) => sum + (result.nodes[node.id]?.powerKw ?? 0), 0),
                  )}
                />
              )}
            </section>
          ) : null}

          {nodes.length > 0 ? (
            <div className={styles.footer}>
              <button type="button" className={styles.remove} onClick={() => removeNodes(selection)}>
                Delete {nodes.length === 1 ? 'node' : `${nodes.length} nodes`}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}

function edgeTitle(
  edges: { fromPort: string }[],
  index: ReturnType<typeof useGameData>,
): string {
  if (edges.length > 1) return `${edges.length} connections`;
  const itemId = edges[0]?.fromPort ?? '';
  return index.items.get(itemId)?.name ?? itemId;
}

function titleFor(nodes: GraphNode[], index: ReturnType<typeof useGameData>): string {
  if (nodes.length > 1) return `${nodes.length} nodes selected`;
  const node = nodes[0];
  if (!node) return '';
  if (node.kind === 'recipe') return index.recipes.get(node.recipeId)?.name ?? node.recipeId;
  if (node.kind === 'note') return 'Note';
  const item = index.items.get(node.itemId)?.name ?? node.itemId;
  return `${node.kind === 'source' ? 'Source' : 'Sink'}: ${item}`;
}

function RecipeSections({ nodes, multi }: { nodes: RecipeNode[]; multi: boolean }): JSX.Element {
  const index = useGameData();
  const update = useGraphStore((state) => state.updateRecipeNode);
  const setBeacons = useGraphStore((state) => state.setBeacons);
  const beginBatch = useGraphStore((state) => state.beginBatch);
  const endBatch = useGraphStore((state) => state.endBatch);

  const first = nodes[0]!;
  // With a mixed selection the shared value is blank rather than a lie.
  const sharedMachine = nodes.every((node) => node.machineId === first.machineId)
    ? first.machineId
    : null;

  // Machine choices are the intersection of what every selected recipe allows.
  const machineOptions = index.data.machines.filter((machine) =>
    nodes.every((node) => index.recipes.get(node.recipeId)?.producers.includes(machine.id)),
  );

  const machine = sharedMachine ? index.machines.get(sharedMachine) : undefined;
  const slots = machine?.moduleSlots ?? 0;

  const blocked = machine
    ? nodes.reduce<Set<string>>((accumulated, node) => {
        const recipe = index.recipes.get(node.recipeId);
        if (recipe) for (const effect of blockedEffects(machine, recipe)) accumulated.add(effect);
        return accumulated;
      }, new Set<string>())
    : new Set<string>();

  // Quality is a v1 non-goal, so quality modules are left out entirely rather
  // than offered as a choice whose only modelled effect is a speed penalty.
  const allowedModules = index.data.modules.filter(
    (module) =>
      module.quality <= 0 &&
      !(module.productivity !== 0 && blocked.has('productivity')),
  );

  const applyAll = (change: (node: RecipeNode) => void): void => {
    beginBatch();
    for (const node of nodes) change(node);
    endBatch();
  };

  const setMachine = (machineId: string): void => {
    const slotsNext = index.machines.get(machineId)?.moduleSlots ?? 0;
    applyAll((node) =>
      update(node.id, {
        machineId,
        // Keep the modules that still fit; pad the rest with empty slots.
        modules: Array.from({ length: slotsNext }, (_unused, slot) => node.modules[slot] ?? ''),
      }),
    );
  };

  const setModule = (slot: number, moduleId: string): void => {
    applyAll((node) => {
      const next = Array.from({ length: slots }, (_unused, i) => node.modules[i] ?? '');
      next[slot] = moduleId;
      update(node.id, { modules: next });
    });
  };

  const fillModules = (moduleId: string): void => {
    applyAll((node) =>
      update(node.id, { modules: Array.from({ length: slots }, () => moduleId) }),
    );
  };

  const beacons = first.beacons;
  const beaconOptions = index.data.beacons;
  const beaconModuleSlots = beacons ? (index.beacons.get(beacons.beaconId)?.moduleSlots ?? 0) : 0;
  const beaconModules = index.data.modules.filter(
    (module) => module.productivity === 0 && module.quality <= 0,
  );

  return (
    <>
      <section className={styles.section}>
        <PickerRow
          label="Machine"
          value={sharedMachine}
          options={machineOptions.map((option) => ({
            id: option.id,
            name: option.name,
            icon: option.icon,
          }))}
          placeholder={multi ? 'Mixed' : 'None'}
          onChange={setMachine}
        />

        {slots > 0 ? (
          <div className={styles.row}>
            <span className={styles.label}>Modules</span>
            <div className={styles.slots}>
              {Array.from({ length: slots }, (_unused, slot) => {
                const moduleId = first.modules[slot] ?? '';
                const module = moduleId ? index.modules.get(moduleId) : undefined;
                return (
                  // The sprite is what you see; the select sits invisibly on
                  // top of it so the slot stays a native, keyboard-usable
                  // control instead of a bespoke popup.
                  <span
                    key={slot}
                    className={module ? styles.slotFilled : styles.slotEmpty}
                    title={module?.name ?? 'Empty module slot'}
                  >
                    {module ? <Sprite icon={module.icon} size={16} /> : null}
                    <select
                      className={styles.slotSelect}
                      value={moduleId}
                      aria-label={`Module slot ${slot + 1}`}
                      onChange={(event) => setModule(slot, event.target.value)}
                    >
                      <option value="">Empty</option>
                      {allowedModules.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}

        {slots > 0 ? (
          <div className={styles.row}>
            <span className={styles.label}>Fill slots</span>
            <div className={styles.fill}>
              {allowedModules
                .filter((module) => module.id.endsWith('-3'))
                .map((module) => (
                  <button
                    key={module.id}
                    type="button"
                    className={styles.fillButton}
                    title={`Fill every slot with ${module.name.toLowerCase()}`}
                    onClick={() => fillModules(module.id)}
                  >
                    <Sprite icon={module.icon} size={16} />
                  </button>
                ))}
              <button
                type="button"
                className={styles.fillButton}
                title="Empty every slot"
                onClick={() => fillModules('')}
              >
                <span className={styles.clear} />
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className={styles.section}>
        <div className={styles.row}>
          <span className={styles.label}>Beacons</span>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={beacons !== null}
              onChange={(event) => {
                const beaconId = beaconOptions[0]?.id;
                if (!beaconId) return;
                applyAll((node) =>
                  setBeacons(
                    node.id,
                    event.target.checked
                      ? {
                          beaconId,
                          count: 4,
                          modules: Array.from(
                            { length: index.beacons.get(beaconId)?.moduleSlots ?? 0 },
                            () => 'speed-module-3',
                          ),
                        }
                      : null,
                  ),
                );
              }}
            />
            <span>{beacons ? 'On' : 'Off'}</span>
          </label>
        </div>

        {beacons ? (
          <>
            <NumberField
              label="Count"
              value={beacons.count}
              min={0}
              step={1}
              onCommit={(next) =>
                applyAll((node) =>
                  node.beacons
                    ? setBeacons(node.id, { ...node.beacons, count: Math.round(next) })
                    : undefined,
                )
              }
            />
            {Array.from({ length: beaconModuleSlots }, (_unused, slot) => (
              <div className={styles.row} key={slot}>
                <span className={styles.label}>Beacon module {slot + 1}</span>
                <select
                  className={styles.select}
                  value={beacons.modules[slot] ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    applyAll((node) => {
                      if (!node.beacons) return;
                      const next = Array.from(
                        { length: beaconModuleSlots },
                        (_ignored, i) => node.beacons!.modules[i] ?? '',
                      );
                      next[slot] = value;
                      setBeacons(node.id, { ...node.beacons, modules: next });
                    });
                  }}
                >
                  <option value="">Empty</option>
                  {beaconModules.map((module) => (
                    <option key={module.id} value={module.id}>
                      {module.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </>
        ) : null}
      </section>

      <section className={styles.section}>
        <MachineConstraint nodes={nodes} />
      </section>
    </>
  );
}

function MachineConstraint({ nodes }: { nodes: RecipeNode[] }): JSX.Element {
  const setConstraint = useGraphStore((state) => state.setConstraint);
  const beginBatch = useGraphStore((state) => state.beginBatch);
  const endBatch = useGraphStore((state) => state.endBatch);
  const result = useSolve();
  const first = nodes[0]!;
  const fixed = first.constraint.type === 'machines';

  const toggle = (): void => {
    beginBatch();
    for (const node of nodes) {
      if (node.constraint.type === 'machines') {
        setConstraint(node.id, { type: 'free' });
      } else {
        // Pin at whatever the solver had, rounded up — that is the count you
        // would actually build.
        const solved = result?.nodes[node.id]?.machinesCeil ?? 1;
        setConstraint(node.id, { type: 'machines', count: Math.max(1, solved) });
      }
    }
    endBatch();
  };

  return (
    <>
      <div className={styles.row}>
        <span className={styles.label}>Machine count</span>
        <button type="button" className={styles.toggle} onClick={toggle}>
          {fixed ? 'Fixed' : 'Solved'}
        </button>
      </div>
      {fixed && first.constraint.type === 'machines' ? (
        <NumberField
          label="Machines"
          value={first.constraint.count}
          min={0}
          step={1}
          onCommit={(next) => {
            beginBatch();
            for (const node of nodes) setConstraint(node.id, { type: 'machines', count: next });
            endBatch();
          }}
        />
      ) : null}
    </>
  );
}

function RateConstraint({ nodes }: { nodes: GraphNode[] }): JSX.Element {
  const setConstraint = useGraphStore((state) => state.setConstraint);
  const beginBatch = useGraphStore((state) => state.beginBatch);
  const endBatch = useGraphStore((state) => state.endBatch);
  const first = nodes[0];
  const constraint =
    first && (first.kind === 'source' || first.kind === 'sink') ? first.constraint : null;
  const fixed = constraint?.type === 'rate';

  const apply = (next: { type: 'rate'; perSec: number } | { type: 'free' }): void => {
    beginBatch();
    for (const node of nodes) setConstraint(node.id, next);
    endBatch();
  };

  return (
    <>
      <div className={styles.row}>
        <span className={styles.label}>Rate</span>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => apply(fixed ? { type: 'free' } : { type: 'rate', perSec: 1 })}
        >
          {fixed ? 'Fixed' : 'Solved'}
        </button>
      </div>
      {fixed && constraint.type === 'rate' ? (
        <NumberField
          label="Items/s"
          value={constraint.perSec}
          min={0}
          step={0.5}
          onCommit={(next) => apply({ type: 'rate', perSec: next })}
        />
      ) : null}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={`mono ${styles.value}`}>{value}</span>
    </div>
  );
}
