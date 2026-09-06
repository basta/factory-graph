import { useEffect } from 'react';
import styles from './Toast.module.css';

interface Props {
  message: string | null;
  tone?: 'info' | 'warn';
  onDismiss: () => void;
}

const DURATION_MS = 2600;

/** One line, bottom centre, gone in under three seconds. */
export function Toast({ message, tone = 'info', onDismiss }: Props): JSX.Element | null {
  useEffect(() => {
    if (message === null) return;
    const timer = window.setTimeout(onDismiss, DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  if (message === null) return null;
  return (
    <div className={[styles.toast, tone === 'warn' ? styles.warn : ''].filter(Boolean).join(' ')} role="status">
      {message}
    </div>
  );
}
