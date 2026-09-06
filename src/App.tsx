import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { GameDataProvider } from './data/context.ts';
import { loadGameData, type GameIndex } from './data/loader.ts';
import { useGraphStore } from './graph/store.ts';
import { Canvas } from './canvas/Canvas.tsx';
import { Header } from './ui/Header.tsx';
import { ShortcutsOverlay } from './ui/ShortcutsOverlay.tsx';
import { isTyping } from './ui/keys.ts';
import styles from './App.module.css';

export function App(): JSX.Element {
  const [index, setIndex] = useState<GameIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadGameData()
      .then((loaded) => {
        if (live) setIndex(loaded);
      })
      .catch((error: unknown) => {
        if (live) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      live = false;
    };
  }, []);

  if (loadError !== null) {
    return (
      <div className={styles.loading}>
        <p>{loadError}</p>
        <p className={styles.loadingHint}>Reload the page to try again.</p>
      </div>
    );
  }
  if (!index) return <div className={styles.loading} aria-busy="true" />;

  return (
    <GameDataProvider value={index}>
      <ReactFlowProvider>
        <Editor />
      </ReactFlowProvider>
    </GameDataProvider>
  );
}

function Editor(): JSX.Element {
  const [helpOpen, setHelpOpen] = useState(false);

  const nodeCount = useGraphStore((state) => state.graph.nodes.length);
  const projectName = useGraphStore((state) => state.projectName);
  const setProjectName = useGraphStore((state) => state.setProjectName);
  const past = useGraphStore((state) => state.history.past.length);
  const future = useGraphStore((state) => state.history.future.length);
  const undo = useGraphStore((state) => state.undo);
  const redo = useGraphStore((state) => state.redo);

  const notYet = useCallback(() => undefined, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === '?' && !isTyping(event.target)) {
        event.preventDefault();
        setHelpOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={styles.app}>
      <Header
        projectName={projectName}
        onProjectNameChange={setProjectName}
        result={null}
        canUndo={past > 0}
        canRedo={future > 0}
        onUndo={undo}
        onRedo={redo}
        onLayout={notYet}
        onShare={notYet}
        onExport={notYet}
        onImport={notYet}
        onHelp={() => setHelpOpen(true)}
      />
      <div className={styles.body}>
        <Canvas empty={nodeCount === 0} />
      </div>
      <ShortcutsOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
