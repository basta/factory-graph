import { useGameData } from '../data/context.ts';
import { useGraphStore } from '../graph/store.ts';
import type { SolveResult } from '../solver/types.ts';
import { meterRate } from '../sim/meter.ts';
import type { InserterState, MachineState, Ref, World } from '../sim/world.ts';
import { refEntity } from '../sim/world.ts';
import { Button } from '../ui/Button.tsx';
import { NumberField } from '../ui/NumberField.tsx';
import { PickerRow } from '../ui/PickerRow.tsx';
import { Sprite } from '../ui/Sprite.tsx';
import { percent, rate } from '../ui/format.ts';
import { KEEPING_UP } from './draw.ts';
import { INSERTER_SPECS, buildableMachinesFor } from './entities.ts';
import type { HandSize } from './types.ts';
import { entityName, formatClock } from './names.ts';
import styles from '../ui/Inspector.module.css';
import own from './BuildView.module.css';

interface Props {
  world: World;
  selection: string[];
  /** The plan's solve, for comparing what the build makes with what was planned. */
  result: SolveResult | null;
  /** Opens the palette to pick a recipe or item for an entity already placed. */
  onPick: (entityId: string, scope: 'build-recipe' | 'build-item') => void;
}

/**
 * The right-hand panel of the build view. With nothing selected it is the
 * test report: what the build turns out, what it takes in, and which
 * machines are not keeping up. With something selected it is that entity.
 */
export function BuildInspector({ world, selection, result, onPick }: Props): JSX.Element {
  const index = useGameData();
  const selected = selection
    .map((id) => world.byId.get(id))
    .filter((ref): ref is Ref => ref !== undefined);
  const single = selected.length === 1 ? selected[0]! : null;
  const entity = single ? refEntity(world, single) : null;

  return (
    <aside className={`${styles.inspector} ${styles.open} ${own.inspector}`} aria-label="Build inspector">
      <div className={styles.head}>
        <span className={styles.title}>
          {entity
            ? entityName(entity, index)
            : selected.length > 1
              ? `${selected.length} selected`
              : 'Build'}
        </span>
      </div>
      {single && entity ? (
        <EntitySections world={world} reference={single} onPick={onPick} />
      ) : selected.length > 1 ? (
        <section className={styles.section}>
          <p className={styles.hint}>Ctrl C copies these as a stamp to paste elsewhere. Delete removes them.</p>
        </section>
      ) : (
        <Report world={world} result={result} />
      )}
      {selected.length > 0 ? (
        <div className={styles.footer}>
          <Button
            variant="ghost"
            className={styles.remove}
            onClick={() => useGraphStore.getState().removeEntities(selection)}
          >
            {selected.length > 1 ? `Remove ${selected.length}` : 'Remove'}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{children}</span>
    </div>
  );
}

function ItemRow({
  itemId,
  value,
  detail,
  warn = false,
}: {
  itemId: string;
  value: string;
  detail?: string;
  warn?: boolean;
}): JSX.Element {
  const index = useGameData();
  const item = index.items.get(itemId);
  return (
    <div className={styles.row}>
      {item ? <Sprite icon={item.icon} size={16} /> : null}
      <span className={own.itemName}>{item?.name ?? itemId}</span>
      {detail ? <span className={`mono ${own.detail}`}>{detail}</span> : null}
      <span className={`mono ${warn ? styles.valueWarn : own.rate}`}>{value}</span>
    </div>
  );
}

// --- the report ----------------------------------------------------------------

function Report({ world, result }: { world: World; result: SolveResult | null }): JSX.Element {
  const index = useGameData();
  const hands = useGraphStore((state) => state.build.hands);
  const tick = world.tick;

  const outputs = new Map<string, number>();
  for (const sink of world.sinks) {
    for (const [itemId, meter] of sink.meters) {
      outputs.set(itemId, (outputs.get(itemId) ?? 0) + meterRate(meter, tick));
    }
  }
  const inputs = new Map<string, number>();
  for (const source of world.sources) {
    const id = source.entity.itemId;
    inputs.set(id, (inputs.get(id) ?? 0) + meterRate(source.meter, tick));
  }

  // What the plan turns out — its sinks and any output left unconnected —
  // for a side-by-side with what the build actually delivers.
  const planned = new Map<string, number>(
    result?.status === 'ok'
      ? Object.entries(result.totals.outputs).filter(([, perSec]) => perSec > 0)
      : [],
  );

  const machines = new Map<string, { count: number; working: number }>();
  for (const machine of world.machines) {
    if (!machine.recipe) continue;
    const entry = machines.get(machine.recipe.id) ?? { count: 0, working: 0 };
    entry.count += 1;
    entry.working += meterRate(machine.working, tick) / 60;
    machines.set(machine.recipe.id, entry);
  }

  const empty =
    world.belts.length + world.machines.length + world.sources.length + world.sinks.length === 0;

  return (
    <>
      {empty ? (
        <section className={styles.section}>
          <p className={styles.hint}>
            Pick a tool above and click the grid to build. Sources supply items, sinks count what
            arrives, and Play runs it.
          </p>
        </section>
      ) : null}
      <section className={styles.section}>
        <Row label="Clock">
          <span className="mono">{formatClock(tick)}</span>
        </Row>
        <div className={styles.row}>
          <span className={styles.label}>Inserter hands</span>
          <span className={styles.segmented} role="radiogroup" aria-label="Inserter hands">
            {(['base', 'researched'] as HandSize[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={hands === value}
                className={[styles.segment, hands === value ? styles.segmentOn : ''].join(' ')}
                title={
                  value === 'base'
                    ? 'No capacity research: one item a swing, two for bulk'
                    : 'All capacity research: three a swing, twelve for bulk'
                }
                onClick={() => useGraphStore.getState().setHands(value)}
              >
                {value === 'base' ? 'Unresearched' : 'Researched'}
              </button>
            ))}
          </span>
        </div>
      </section>
      {outputs.size > 0 ? (
        <section className={styles.section}>
          <div className={own.sectionLabel}>Output, over the last 30 s</div>
          {[...outputs.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([itemId, perSec]) => {
              const plan = planned.get(itemId);
              return (
                <ItemRow
                  key={itemId}
                  itemId={itemId}
                  value={`${rate(perSec)}/s`}
                  detail={plan !== undefined ? `plan ${rate(plan)}` : undefined}
                  warn={plan !== undefined && perSec < plan * 0.98 && tick > 60 * 30}
                />
              );
            })}
        </section>
      ) : null}
      {inputs.size > 0 ? (
        <section className={styles.section}>
          <div className={own.sectionLabel}>Input</div>
          {[...inputs.entries()].map(([itemId, perSec]) => (
            <ItemRow key={itemId} itemId={itemId} value={`${rate(perSec)}/s`} />
          ))}
        </section>
      ) : null}
      {machines.size > 0 ? (
        <section className={styles.section}>
          <div className={own.sectionLabel}>Machines, share of time crafting</div>
          {[...machines.entries()].map(([recipeId, entry]) => {
            const recipe = index.recipes.get(recipeId);
            const share = entry.working / entry.count;
            return (
              <div className={styles.row} key={recipeId}>
                {recipe ? <Sprite icon={recipe.icon} size={16} /> : null}
                <span className={own.itemName}>{recipe?.name ?? recipeId}</span>
                <span className={`mono ${own.detail}`}>× {entry.count}</span>
                <span className={`mono ${tick > 0 && share < KEEPING_UP ? styles.valueWarn : own.rate}`}>
                  {tick > 0 ? percent(share) : '—'}
                </span>
              </div>
            );
          })}
        </section>
      ) : null}
    </>
  );
}

// --- one entity --------------------------------------------------------------------

function EntitySections({
  world,
  reference,
  onPick,
}: {
  world: World;
  reference: Ref;
  onPick: Props['onPick'];
}): JSX.Element | null {
  const index = useGameData();
  const update = useGraphStore.getState().updateEntity;
  const tick = world.tick;

  switch (reference.kind) {
    case 'machine': {
      const machine = world.machines[reference.index]!;
      return <MachineSections machine={machine} tick={tick} onPick={onPick} />;
    }
    case 'inserter': {
      const inserter = world.inserters[reference.index]!;
      return <InserterSections world={world} inserter={inserter} />;
    }
    case 'belt': {
      const belt = world.belts[reference.index]!;
      const count = belt.lanes.reduce((sum, lane) => sum + world.lanes[lane]!.items.length, 0);
      const spec = index.belts.get(belt.entity.beltId);
      return (
        <section className={styles.section}>
          <PickerRow
            label="Tier"
            value={belt.entity.beltId}
            options={index.data.belts}
            placeholder="Belt"
            onChange={(beltId) => update(belt.entity.id, { beltId })}
          />
          <Row label="Carries">
            <span className="mono">{spec ? `${rate(spec.itemsPerSec)}/s` : '—'}</span>
          </Row>
          <Row label="On this tile">
            <span className="mono">{count}</span>
          </Row>
        </section>
      );
    }
    case 'source': {
      const source = world.sources[reference.index]!;
      const item = index.items.get(source.entity.itemId);
      return (
        <section className={styles.section}>
          <div className={styles.row}>
            <span className={styles.label}>Item</span>
            <button
              type="button"
              className={styles.picker}
              onClick={() => onPick(source.entity.id, 'build-item')}
            >
              {item ? <Sprite icon={item.icon} size={16} /> : null}
              <span className={styles.pickerName}>{item?.name ?? source.entity.itemId}</span>
            </button>
          </div>
          <NumberField
            label="Limit per second"
            value={source.entity.perSec ?? 0}
            min={0}
            onCommit={(value) => update(source.entity.id, { perSec: value > 0 ? value : null })}
          />
          <p className={styles.hint}>0 supplies as fast as the belt or inserter takes.</p>
          <Row label="Supplied">
            <span className="mono">{rate(meterRate(source.meter, tick))}/s</span>
          </Row>
        </section>
      );
    }
    case 'sink': {
      const sink = world.sinks[reference.index]!;
      return (
        <section className={styles.section}>
          {sink.meters.size === 0 ? (
            <p className={styles.hint}>Nothing has arrived. Run a belt into it or point an inserter at it.</p>
          ) : (
            [...sink.meters.entries()].map(([itemId, meter]) => (
              <ItemRow
                key={itemId}
                itemId={itemId}
                value={`${rate(meterRate(meter, tick))}/s`}
                detail={`${sink.totals.get(itemId) ?? 0} total`}
              />
            ))
          )}
        </section>
      );
    }
    case 'chest': {
      const chest = world.chests[reference.index]!;
      return (
        <section className={styles.section}>
          {chest.contents.size === 0 ? (
            <p className={styles.hint}>Empty.</p>
          ) : (
            [...chest.contents.entries()].map(([itemId, count]) => (
              <ItemRow key={itemId} itemId={itemId} value={String(count)} />
            ))
          )}
        </section>
      );
    }
  }
  return null;
}

const STATUS: Record<MachineState['status'], string> = {
  working: 'Working',
  starved: 'Waiting for ingredients',
  blocked: 'Output full',
  'no-recipe': 'No recipe',
};

function MachineSections({
  machine,
  tick,
  onPick,
}: {
  machine: MachineState;
  tick: number;
  onPick: Props['onPick'];
}): JSX.Element {
  const index = useGameData();
  const update = useGraphStore.getState().updateEntity;
  const { entity, recipe } = machine;
  const options = recipe
    ? buildableMachinesFor(recipe)
        .map((id) => index.machines.get(id))
        .filter((m) => m !== undefined)
    : [];
  const share = meterRate(machine.working, tick) / 60;
  const maxCrafts = recipe ? machine.perTick * 60 : 0;
  const missing = machine.ingredients.filter(
    (ingredient) => (machine.inputs.get(ingredient.itemId) ?? 0) < ingredient.amount,
  );

  return (
    <>
      <section className={styles.section}>
        <div className={styles.row}>
          <span className={styles.label}>Recipe</span>
          <button type="button" className={styles.picker} onClick={() => onPick(entity.id, 'build-recipe')}>
            {recipe ? <Sprite icon={recipe.icon} size={16} /> : null}
            <span className={styles.pickerName}>{recipe?.name ?? 'Choose a recipe'}</span>
          </button>
        </div>
        {options.length > 1 ? (
          <PickerRow
            label="Machine"
            value={entity.machineId}
            options={options}
            placeholder="Machine"
            onChange={(machineId) => update(entity.id, { machineId })}
          />
        ) : null}
      </section>
      {recipe ? (
        <section className={styles.section}>
          <Row label="Status">
            <span className={machine.status === 'working' ? undefined : styles.valueWarn}>
              {STATUS[machine.status]}
              {machine.status === 'starved' && missing.length > 0
                ? `: ${missing.map((m) => index.items.get(m.itemId)?.name ?? m.itemId).join(', ')}`
                : ''}
            </span>
          </Row>
          <Row label="Crafting">
            <span className={`mono ${tick > 0 && share < KEEPING_UP ? styles.valueWarn : ''}`}>
              {tick > 0 ? percent(share) : '—'}
            </span>
          </Row>
          <Row label="Crafts per second">
            <span className="mono">
              {rate(meterRate(machine.crafts, tick))} of {rate(maxCrafts)}
            </span>
          </Row>
          {machine.productivity > 0 ? (
            <Row label="Productivity">
              <span className="mono">+{percent(machine.productivity)}</span>
            </Row>
          ) : null}
        </section>
      ) : null}
      {machine.ingredients.length + machine.products.length > 0 ? (
        <section className={styles.section}>
          {machine.ingredients.map((ingredient) => (
            <ItemRow
              key={`in-${ingredient.itemId}`}
              itemId={ingredient.itemId}
              value={String(machine.inputs.get(ingredient.itemId) ?? 0)}
              detail={`needs ${rate(ingredient.amount)}`}
            />
          ))}
          {machine.products.map((product) => (
            <ItemRow
              key={`out-${product.itemId}`}
              itemId={product.itemId}
              value={String(machine.outputs.get(product.itemId) ?? 0)}
              detail="made"
            />
          ))}
        </section>
      ) : null}
      {machine.fluids.length > 0 ? (
        <section className={styles.section}>
          <p className={styles.hint}>
            {machine.fluids.map((id) => index.items.get(id)?.name ?? id).join(', ')}{' '}
            {machine.fluids.length === 1 ? 'is' : 'are'} assumed piped in or out. Pipes are not simulated.
          </p>
        </section>
      ) : null}
    </>
  );
}

const PHASE: Record<InserterState['phase'], string> = {
  pickup: 'Waiting for items',
  'to-drop': 'Swinging',
  drop: 'Waiting to drop',
  'to-pickup': 'Returning',
};

function InserterSections({ world, inserter }: { world: World; inserter: InserterState }): JSX.Element {
  const index = useGameData();
  const update = useGraphStore.getState().updateEntity;
  const options = index.data.inserters.filter((spec) => spec.id in INSERTER_SPECS);
  const describe = (ref: Ref | null): string => (ref ? entityName(refEntity(world, ref), index) : 'Nothing');
  return (
    <section className={styles.section}>
      <PickerRow
        label="Type"
        value={inserter.entity.inserterId}
        options={options}
        placeholder="Inserter"
        onChange={(inserterId) => update(inserter.entity.id, { inserterId })}
      />
      <Row label="Takes from">
        <span className={inserter.from ? undefined : styles.valueWarn}>{describe(inserter.from)}</span>
      </Row>
      <Row label="Puts into">
        <span className={inserter.to ? undefined : styles.valueWarn}>{describe(inserter.to)}</span>
      </Row>
      <Row label="Hand">
        <span className="mono">{inserter.hand}</span>
      </Row>
      <Row label="Moving">
        <span className="mono">{rate(meterRate(inserter.meter, world.tick))}/s</span>
      </Row>
      <Row label="Now">{PHASE[inserter.phase]}</Row>
    </section>
  );
}
