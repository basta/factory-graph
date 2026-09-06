import { ReactFlow } from '@xyflow/react';
import { DotGrid } from './DotGrid.tsx';
import { CanvasControls } from './CanvasControls.tsx';
import styles from './Canvas.module.css';

interface Props {
  /** Shown centred when there is nothing on the canvas yet. */
  empty: boolean;
}

/**
 * The canvas shell: dot grid, pan/zoom behaviour, custom controls. Node and
 * edge rendering is layered on in M2.
 */
export function Canvas({ empty }: Props): JSX.Element {
  return (
    <div className={styles.canvas}>
      <ReactFlow
        nodes={[]}
        edges={[]}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2.5}
        zoomOnScroll
        panOnScroll={false}
        panOnDrag={[1, 2]}
        selectionOnDrag
        deleteKeyCode={null}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
      >
        <DotGrid />
      </ReactFlow>
      {empty ? (
        <div className={styles.emptyWrap}>
          <p className={styles.empty}>
            Double-click the canvas or press <kbd className={styles.kbd}>Ctrl K</kbd> to add a
            recipe.
          </p>
        </div>
      ) : null}
      <CanvasControls />
    </div>
  );
}
