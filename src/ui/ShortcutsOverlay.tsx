import { useEffect } from 'react';
import { CloseIcon } from './icons.tsx';
import { IconButton } from './Button.tsx';
import { SHORTCUTS } from './shortcuts.ts';
import styles from './ShortcutsOverlay.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsOverlay({ open, onClose }: Props): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.scrim} onPointerDown={onClose} role="presentation">
      <div
        className={styles.panel}
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className={styles.head}>
          <span className={styles.title}>Keyboard shortcuts</span>
          <IconButton label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        <div className={styles.groups}>
          {SHORTCUTS.map((group) => (
            <section key={group.group} className={styles.group}>
              <h2 className={styles.groupName}>{group.group}</h2>
              {group.items.map((item) => (
                <div key={item.description + item.keys.join()} className={styles.row}>
                  <span className={styles.keys}>
                    {item.keys.map((key) => (
                      <kbd key={key} className={styles.key}>
                        {key}
                      </kbd>
                    ))}
                    {item.then ? <span className={styles.then}>{item.then}</span> : null}
                  </span>
                  <span className={styles.description}>{item.description}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
