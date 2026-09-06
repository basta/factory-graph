import { useState } from 'react';
import styles from './Inspector.module.css';

interface Props {
  label: string;
  value: number;
  min?: number;
  step?: number;
  onCommit: (value: number) => void;
}

/**
 * A number on an underline. Commits on blur or Enter rather than on every
 * keystroke, so typing "12" does not solve for 1 on the way to 12.
 */
export function NumberField({ label, value, min = 0, step = 1, onCommit }: Props): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);

  if (lastValue !== value) {
    setLastValue(value);
    setDraft(String(value));
  }

  const commit = (): void => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < min) {
      setDraft(String(value));
      return;
    }
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <input
        className={`mono ${styles.number}`}
        value={draft}
        inputMode="decimal"
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(String(value));
            event.currentTarget.blur();
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const delta = event.key === 'ArrowUp' ? step : -step;
            const next = Math.max(min, Number(draft) + delta);
            setDraft(String(next));
            onCommit(next);
          }
        }}
      />
    </div>
  );
}
