import type { ReactNode } from 'react';
import { useGameData } from '../data/context.ts';
import {
  MACHINE_FAMILIES,
  rememberSettings,
  settingsOf,
  withFamilyPick,
} from '../graph/settings.ts';
import { useGraphStore } from '../graph/store.ts';
import type { PlanSettings } from '../graph/types.ts';
import { Sprite } from '../ui/Sprite.tsx';
import styles from './PlanBar.module.css';

/**
 * Drills are left to the digit keys: a plan fed from a bus rarely has one, and
 * the bar is better short.
 */
const BAR_FAMILIES = MACHINE_FAMILIES.filter((family) => family.id !== 'drill');

interface Props {
  /** Opens the search to pick an item for the bus. */
  onAddBusItem: () => void;
}

/**
 * The plan's settings, one click each: the belt new connections start on, the
 * machine tier new nodes get, the rate unit, and the items Expand stops at.
 * Changing one also moves everything that was following it.
 */
export function PlanBar({ onAddBusItem }: Props): JSX.Element {
  const index = useGameData();
  const stored = useGraphStore((state) => state.graph.settings);
  const setSettings = useGraphStore((state) => state.setSettings);
  const settings = settingsOf({ settings: stored });

  const change = (patch: Partial<PlanSettings>): void => {
    const next = { ...settings, ...patch };
    setSettings(next, index);
    rememberSettings(next);
  };

  return (
    <div className={styles.bar} role="toolbar" aria-label="Plan settings">
      <div className={styles.group} role="group" aria-label="Belt for new connections">
        <Choice on={settings.beltId === null} title="No belt" onClick={() => change({ beltId: null })}>
          <span className={styles.none} />
        </Choice>
        {index.data.belts.map((belt) => (
          <Choice
            key={belt.id}
            on={settings.beltId === belt.id}
            title={belt.name}
            onClick={() => change({ beltId: belt.id })}
          >
            <Sprite icon={belt.icon} size={16} />
          </Choice>
        ))}
      </div>

      {BAR_FAMILIES.map((family) => {
        const pick = family.machines.find((id) => settings.machines.includes(id));
        return (
          <div key={family.id} className={styles.group} role="group" aria-label={family.label}>
            {family.machines.map((id) => {
              const machine = index.machines.get(id);
              if (!machine) return null;
              return (
                <Choice
                  key={id}
                  on={pick === id}
                  title={machine.name}
                  onClick={() => change({ machines: withFamilyPick(settings.machines, family, id) })}
                >
                  <Sprite icon={machine.icon} size={16} />
                </Choice>
              );
            })}
          </div>
        );
      })}

      <div className={styles.group} role="group" aria-label="Rate unit">
        <Choice on={settings.unit === 's'} title="Items per second" onClick={() => change({ unit: 's' })}>
          <span className="mono">/s</span>
        </Choice>
        <Choice on={settings.unit === 'min'} title="Items per minute" onClick={() => change({ unit: 'min' })}>
          <span className="mono">/min</span>
        </Choice>
      </div>

      <div className={styles.group} role="group" aria-label="Bus items">
        <span className={styles.label} title="Expand stops at these and leaves them as inputs">
          Bus
        </span>
        {settings.bus.map((itemId) => {
          const item = index.items.get(itemId);
          return (
            <button
              key={itemId}
              type="button"
              className={styles.item}
              title={`${item?.name ?? itemId}. Click to take it off the bus.`}
              onClick={() => change({ bus: settings.bus.filter((id) => id !== itemId) })}
            >
              {item ? <Sprite icon={item.icon} size={16} /> : itemId}
            </button>
          );
        })}
        <button type="button" className={styles.item} title="Add an item to the bus" onClick={onAddBusItem}>
          <span className={styles.plus} />
        </button>
      </div>
    </div>
  );
}

function Choice({
  on,
  title,
  onClick,
  children,
}: {
  on: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className={[styles.choice, on ? styles.on : ''].filter(Boolean).join(' ')}
      title={title}
      aria-label={title}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
