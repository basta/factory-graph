import { useEffect } from 'react';
import styles from './Toast.module.css';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

interface Props {
  message: string | null;
  tone?: 'info' | 'warn';
  /** An offer to reverse what just happened, for things undo cannot reach. */
  action?: ToastAction | null;
  onDismiss: () => void;
}

const DURATION_MS = 2600;
/** An offer you have to read, aim at and click needs longer than a remark. */
const ACTION_DURATION_MS = 7000;

/** One line, bottom centre, gone in under three seconds. */
export function Toast({ message, tone = 'info', action = null, onDismiss }: Props): JSX.Element | null {
  useEffect(() => {
    if (message === null) return;
    const timer = window.setTimeout(onDismiss, action ? ACTION_DURATION_MS : DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [message, action, onDismiss]);

  if (message === null) return null;
  return (
    <div className={[styles.toast, tone === 'warn' ? styles.warn : ''].filter(Boolean).join(' ')} role="status">
      {message}
      {action ? (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            action.onAction();
            onDismiss();
          }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
