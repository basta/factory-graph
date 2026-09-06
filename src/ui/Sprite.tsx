import { useGameData } from '../data/context.ts';
import { spriteStyle } from '../data/sprite.ts';
import type { IconRef } from '../data/schema.ts';
import styles from './Sprite.module.css';

interface Props {
  icon: IconRef;
  size: number;
  title?: string;
  className?: string;
}

/** One game icon, drawn from the shared sprite sheet. */
export function Sprite({ icon, size, title, className }: Props): JSX.Element {
  const { data } = useGameData();
  return (
    <span
      className={className ? `${styles.sprite} ${className}` : styles.sprite}
      style={{ ...spriteStyle(data, icon, size), fontSize: `${Math.round(size * 0.42)}px` }}
      title={title}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
    >
      {icon.text ? <span className={styles.text}>{icon.text}</span> : null}
    </span>
  );
}
