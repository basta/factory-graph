import { useReactFlow } from '@xyflow/react';
import { FitIcon, MinusIcon, PlusIcon } from '../ui/icons.tsx';
import { viewportDuration } from '../ui/keys.ts';
import { IconButton } from '../ui/Button.tsx';
import styles from './CanvasControls.module.css';

/** Replaces React Flow's default control panel entirely. */
export function CanvasControls(): JSX.Element {
  const flow = useReactFlow();
  return (
    <div className={styles.controls}>
      <IconButton label="Zoom out" onClick={() => flow.zoomOut({ duration: viewportDuration() })}>
        <MinusIcon />
      </IconButton>
      <IconButton label="Zoom in" onClick={() => flow.zoomIn({ duration: viewportDuration() })}>
        <PlusIcon />
      </IconButton>
      <IconButton
        label="Fit graph to screen (Ctrl 0)"
        onClick={() => void flow.fitView({ duration: viewportDuration(), padding: 0.2 })}
      >
        <FitIcon />
      </IconButton>
    </div>
  );
}
