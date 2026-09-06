import type { IconRef } from '../data/schema.ts';
import { Sprite } from './Sprite.tsx';
import styles from './Inspector.module.css';

interface Option {
  id: string;
  name: string;
  icon: IconRef;
}

interface Props {
  label: string;
  value: string | null;
  options: Option[];
  placeholder: string;
  onChange: (id: string) => void;
}

/**
 * Icon plus name plus a native select. The select is transparent and sits over
 * the row, which keeps keyboard use and the platform's own list behaviour
 * while showing the game sprite that a bare `<select>` cannot.
 */
export function PickerRow({ label, value, options, placeholder, onChange }: Props): JSX.Element {
  const current = options.find((option) => option.id === value);
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.picker}>
        {current ? <Sprite icon={current.icon} size={16} /> : null}
        <span className={styles.pickerName}>{current?.name ?? placeholder}</span>
        <select
          className={styles.pickerSelect}
          value={value ?? ''}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
        >
          {current ? null : <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
