import { useMemo } from 'react';
import { useGraphStore } from '../graph/store.ts';
import { useHints } from '../ui/hints.ts';
import { HINTS, hintContext } from '../ui/shortcuts.ts';
import styles from './KeyHints.module.css';

interface Props {
  /** Says how to bring the hints back, since the strip itself is gone. */
  onHide: () => void;
}

/**
 * The keys for what is selected, along the bottom of the canvas. It changes as
 * the selection does — select a node and it says E builds the inputs, select
 * a connection and it says 1 to 4 set the belt — so a shortcut is met at the
 * moment it is useful rather than in a list read once.
 */
export function KeyHints({ onHide }: Props): JSX.Element | null {
  const visible = useHints((state) => state.visible);
  const setVisible = useHints((state) => state.setVisible);
  const nodes = useGraphStore((state) => state.graph.nodes);
  const selection = useGraphStore((state) => state.selection);
  const selectedEdges = useGraphStore((state) => state.selectedEdges);

  const context = useMemo(
    () =>
      hintContext(
        nodes.filter((node) => selection.includes(node.id)).map((node) => node.kind),
        selectedEdges.length,
        nodes.length === 0,
      ),
    [nodes, selection, selectedEdges.length],
  );

  if (!visible) return null;

  return (
    <div className={styles.hints} role="note" aria-label="Keys for the selection" data-context={context}>
      <span className={styles.list}>
        {HINTS[context].map((hint) => (
          <span key={hint.label} className={styles.hint}>
            {hint.keys.map((key) => (
              <kbd key={key} className={styles.key}>
                {key}
              </kbd>
            ))}
            {hint.then ? <span className={styles.then}>{hint.then}</span> : null}
            <span className={styles.label}>{hint.label}</span>
          </span>
        ))}
      </span>
      <button
        type="button"
        className={styles.hide}
        title="Hide key hints. The shortcuts list (?) can bring them back."
        aria-label="Hide key hints"
        onClick={() => {
          setVisible(false);
          onHide();
        }}
      >
        <span className={styles.cross} />
      </button>
    </div>
  );
}
