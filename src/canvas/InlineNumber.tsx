import { useEffect, useRef, useState } from 'react';
import styles from './InlineNumber.module.css';

interface Props {
  /** What the field starts with, already in the unit being shown. */
  initial: number;
  onCommit: (value: number) => void;
  onDone: () => void;
}

/**
 * A number typed straight into a node, opened by double-clicking the figure.
 * Enter or leaving the field commits; Escape leaves it as it was. Selected on
 * open, so typing replaces rather than appends.
 */
export function InlineNumber({ initial, onCommit, onDone }: Props): JSX.Element {
  const [draft, setDraft] = useState(String(Math.round(initial * 1000) / 1000));
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean): void => {
    if (settled.current) return;
    settled.current = true;
    const parsed = Number(draft);
    if (commit && draft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0) onCommit(parsed);
    onDone();
  };

  return (
    <input
      ref={ref}
      // `nodrag` so selecting the text does not drag the node.
      className={`nodrag mono ${styles.input}`}
      value={draft}
      inputMode="decimal"
      aria-label="Value"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(true);
        else if (event.key === 'Escape') finish(false);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}
