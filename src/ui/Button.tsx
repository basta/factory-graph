import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'default' | 'primary' | 'ghost';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({ variant = 'default', className, children, ...rest }: Props): JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      className={[styles.button, styles[variant], className].filter(Boolean).join(' ')}
    >
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

/** Square 28px action button. `label` is both tooltip and accessible name. */
export function IconButton({ label, className, children, ...rest }: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...rest}
      className={[styles.button, styles.icon, className].filter(Boolean).join(' ')}
    >
      {children}
    </button>
  );
}
