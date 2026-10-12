import { useEffect } from 'react';
import { Button, IconButton } from './Button.tsx';
import { CloseIcon } from './icons.tsx';
import type { ChangelogEntry } from './changelog.ts';
import styles from './WhatsNew.module.css';

interface Props {
  entries: readonly ChangelogEntry[];
  onClose: () => void;
}

/** What shipped since the last visit. Shown once; the shortcuts list links back to it. */
export function WhatsNew({ entries, onClose }: Props): JSX.Element | null {
  useEffect(() => {
    if (entries.length === 0) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries.length, onClose]);

  if (entries.length === 0) return null;
  return (
    <div className={styles.scrim} onPointerDown={onClose} role="presentation">
      <div
        className={styles.panel}
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="What's new"
      >
        <div className={styles.head}>
          <span className={styles.title}>What’s new</span>
          <IconButton label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        {entries.map((entry) => (
          <section key={entry.id} className={styles.entry}>
            <h2 className={styles.entryTitle}>
              {entry.title}
              <span className={styles.date}>{entry.date}</span>
            </h2>
            <ul className={styles.items}>
              {entry.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <div className={styles.foot}>
          <Button variant="primary" onClick={onClose} autoFocus>
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}
