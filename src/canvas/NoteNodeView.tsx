import { memo } from 'react';
import { useGraphStore } from '../graph/store.ts';
import { NOTE_MIN_HEIGHT, NOTE_WIDTH } from './geometry.ts';
import type { NodeViewData } from './RecipeNodeView.tsx';
import styles from './NoteNodeView.module.css';

interface Props {
  data: NodeViewData;
  selected?: boolean;
}

/** A label on the canvas. No header band, no handles, nothing to solve. */
export const NoteNodeView = memo(function NoteNodeView({
  data,
  selected,
}: Props): JSX.Element | null {
  const node = useGraphStore((state) =>
    state.graph.nodes.find((candidate) => candidate.id === data.nodeId),
  );
  const setNoteText = useGraphStore((state) => state.setNoteText);
  const beginBatch = useGraphStore((state) => state.beginBatch);
  const endBatch = useGraphStore((state) => state.endBatch);

  if (!node || node.kind !== 'note') return null;

  return (
    <div
      className={[styles.node, selected ? styles.selected : ''].filter(Boolean).join(' ')}
      style={{ width: NOTE_WIDTH, minHeight: NOTE_MIN_HEIGHT }}
      data-testid={`node-${node.id}`}
    >
      <textarea
        className={`${styles.text} nodrag nowheel`}
        value={node.text}
        placeholder="Note"
        aria-label="Note text"
        rows={3}
        // A typing burst is one undo step, not one per keystroke.
        onFocus={beginBatch}
        onBlur={endBatch}
        onChange={(event) => setNoteText(node.id, event.target.value)}
      />
    </div>
  );
});
