import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { GameDataProvider } from './data/context.ts';
import { loadGameData, type GameIndex } from './data/loader.ts';
import {
  makeNoteNode,
  makeRecipeNode,
  makeSinkNode,
  makeSourceNode,
  useGraphStore,
} from './graph/store.ts';
import { emptyGraph, type GraphNode, type Position } from './graph/types.ts';
import { loadLocal, saveLocal } from './graph/persist.ts';
import { clearLocationHash, documentFromLocation, shareUrl } from './graph/url.ts';
import { exportDocument, importDocument } from './graph/file.ts';
import { autoLayout } from './graph/layout.ts';
import { GraphParseError } from './graph/serialize.ts';
import { Canvas, type DropSearch } from './canvas/Canvas.tsx';
import { nodeShape } from './canvas/geometry.ts';
import { Header } from './ui/Header.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { Search, type SearchChoice, type SearchIntent } from './ui/Search.tsx';
import { ShortcutsOverlay } from './ui/ShortcutsOverlay.tsx';
import { Toast } from './ui/Toast.tsx';
import { isTyping, viewportDuration } from './ui/keys.ts';
import { solve } from './solver/index.ts';
import { SolveProvider } from './solver/context.ts';
import styles from './App.module.css';

export function App(): JSX.Element {
  const [index, setIndex] = useState<GameIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadGameData()
      .then((loaded) => {
        if (!live) return;
        // Restore before the canvas first renders, so React Flow's own
        // `fitView` has a graph to frame. A link beats the autosave.
        const doc = documentFromLocation() ?? loadLocal();
        useGraphStore
          .getState()
          .load(
            doc ?? { graph: emptyGraph(loaded.data.id), projectName: 'Untitled factory' },
          );
        setIndex(loaded);
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
        <Editor index={index} />
      </ReactFlowProvider>
    </GameDataProvider>
  );
}

interface SearchState {
  open: boolean;
  intent: SearchIntent;
  /** Graph position for the new node. */
  at: Position;
  /** Set when the palette was opened by dragging an edge into blank space. */
  connectTo: { nodeId: string; itemId: string; fromSide: 'in' | 'out' } | null;
}

const CLOSED: SearchState = {
  open: false,
  intent: { kind: 'anything' },
  at: { x: 0, y: 0 },
  connectTo: null,
};

function Editor({ index }: { index: GameIndex }): JSX.Element {
  const flow = useReactFlow();
  const [helpOpen, setHelpOpen] = useState(false);
  const [search, setSearch] = useState<SearchState>(CLOSED);
  const [toast, setToast] = useState<string | null>(null);

  const graph = useGraphStore((state) => state.graph);
  const projectName = useGraphStore((state) => state.projectName);
  const selection = useGraphStore((state) => state.selection);
  const selectedEdges = useGraphStore((state) => state.selectedEdges);
  const store = useGraphStore;

  // The solve is synchronous and cheap (median 5 ms at 100 nodes), so it runs
  // on every semantic change rather than behind a debounce that would make the
  // numbers lag the edit that caused them. Depending on `nodes` and `edges`
  // rather than on `graph` is what keeps a node drag — which only rewrites
  // positions — from re-solving on every pointer move.
  const { nodes, edges } = graph;
  const result = useMemo(() => solve({ nodes, edges }, index), [nodes, edges, index]);

  // --- autosave ------------------------------------------------------------
  // The document is already in the store by the time this component mounts.
  useEffect(() => {
    saveLocal({ graph, projectName });
  }, [graph, projectName]);

  // --- adding nodes --------------------------------------------------------
  const openSearchAtScreen = useCallback(
    (screen: { x: number; y: number }, intent: SearchIntent, connectTo: SearchState['connectTo']) => {
      setSearch({
        open: true,
        intent,
        at: flow.screenToFlowPosition(screen),
        connectTo,
      });
    },
    [flow],
  );

  const openSearchAtCentre = useCallback(() => {
    const rect = document.querySelector('.react-flow')?.getBoundingClientRect();
    const screen = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    openSearchAtScreen(screen, { kind: 'anything' }, null);
  }, [openSearchAtScreen]);

  const onDropSearch = useCallback(
    (drop: DropSearch) => {
      openSearchAtScreen(
        drop.screen,
        // Dragging out of an output looks for something that consumes it.
        drop.fromSide === 'out'
          ? { kind: 'consumes', itemId: drop.itemId }
          : { kind: 'produces', itemId: drop.itemId },
        { nodeId: drop.nodeId, itemId: drop.itemId, fromSide: drop.fromSide },
      );
    },
    [openSearchAtScreen],
  );

  const onChoose = useCallback(
    (choice: SearchChoice) => {
      const node: GraphNode | null =
        choice.kind === 'recipe'
          ? makeRecipeNode(index, choice.recipeId)
          : choice.kind === 'source'
            ? makeSourceNode(choice.itemId)
            : choice.kind === 'sink'
              ? makeSinkNode(choice.itemId)
              : makeNoteNode();
      if (!node) {
        setToast('That recipe has no machine that can make it.');
        setSearch(CLOSED);
        return;
      }

      const shape = nodeShape(node, index);
      // Drop the node so the cursor lands on it, not on its top-left corner.
      const at = { x: search.at.x - shape.width / 2, y: search.at.y - 20 };

      const actions = store.getState();
      actions.beginBatch();
      actions.addNode(node, at);
      const link = search.connectTo;
      if (link) {
        actions.addEdge(
          link.fromSide === 'out'
            ? { from: link.nodeId, fromPort: link.itemId, to: node.id, toPort: link.itemId, transport: null }
            : { from: node.id, fromPort: link.itemId, to: link.nodeId, toPort: link.itemId, transport: null },
        );
      }
      actions.endBatch();
      actions.setSelection([node.id], []);
      setSearch(CLOSED);
    },
    [index, search.at, search.connectTo, store],
  );

  // --- project actions -----------------------------------------------------
  const onShare = useCallback(() => {
    const actions = store.getState();
    const url = shareUrl({ graph: actions.graph, projectName: actions.projectName });
    navigator.clipboard
      .writeText(url)
      .then(() => setToast('Link copied'))
      .catch(() => setToast('Could not reach the clipboard. Copy the address bar instead.'));
    // Put the graph in the address bar too, so the link is there either way.
    window.history.replaceState(null, '', url);
  }, [store]);

  const onExport = useCallback(() => {
    const actions = store.getState();
    exportDocument({ graph: actions.graph, projectName: actions.projectName });
  }, [store]);

  const onImport = useCallback(() => {
    importDocument()
      .then((doc) => {
        if (!doc) return;
        store.getState().load(doc);
        // The old link no longer describes what is on screen.
        clearLocationHash();
        setToast(`Opened ${doc.projectName}`);
        requestAnimationFrame(() => void flow.fitView({ padding: 0.25, duration: 0 }));
      })
      .catch((error: unknown) => {
        setToast(error instanceof GraphParseError ? error.message : 'That file could not be read.');
      });
  }, [flow, store]);

  const onLayout = useCallback(() => {
    const actions = store.getState();
    autoLayout(actions.graph, index)
      .then((positions) => {
        if (Object.keys(positions).length === 0) return;
        // One undo step for the whole rearrangement.
        store.getState().setPositions(positions);
        requestAnimationFrame(() => void flow.fitView({ padding: 0.2, duration: viewportDuration() }));
      })
      .catch(() => setToast('Auto-layout failed. The graph is unchanged.'));
  }, [flow, index, store]);

  // --- keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const typing = isTyping(event.target);
      const actions = store.getState();
      const control = event.ctrlKey || event.metaKey;

      if (event.key === 'Escape') {
        if (search.open) setSearch(CLOSED);
        else if (helpOpen) setHelpOpen(false);
        else actions.setSelection([], []);
        return;
      }

      // Project-level commands work from anywhere, the way Ctrl S does in an
      // editor. Everything below them would fight the field you are typing in:
      // Ctrl A must select text, Delete must delete a character, Ctrl Z must
      // undo the typing rather than the graph.
      if (control && 'seil'.includes(event.key.toLowerCase()) && !event.shiftKey) {
        event.preventDefault();
        if (event.key.toLowerCase() === 's') onShare();
        else if (event.key.toLowerCase() === 'e') onExport();
        else if (event.key.toLowerCase() === 'i') onImport();
        else onLayout();
        return;
      }
      if (typing) return;

      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen((open) => !open);
      } else if (control && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearchAtCentre();
      } else if (control && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) actions.redo();
        else actions.undo();
      } else if (control && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        actions.redo();
      } else if (control && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        const copies = actions.duplicateNodes(actions.selection);
        if (copies.length > 0) actions.setSelection(copies, []);
      } else if (control && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        actions.setSelection(
          actions.graph.nodes.map((node) => node.id),
          actions.graph.edges.map((edge) => edge.id),
        );
      } else if (control && event.key === '0') {
        event.preventDefault();
        void flow.fitView({ padding: 0.2, duration: viewportDuration() });
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        actions.beginBatch();
        actions.removeEdges(actions.selectedEdges);
        actions.removeNodes(actions.selection);
        actions.endBatch();
        actions.setSelection([], []);
      } else if (event.key.toLowerCase() === 'f' && !control) {
        // Pin or unpin every selected recipe node at its solved count.
        const nodes = actions.graph.nodes.filter((node) => actions.selection.includes(node.id));
        if (nodes.length === 0) return;
        event.preventDefault();
        actions.beginBatch();
        for (const node of nodes) {
          if (node.kind === 'recipe') {
            actions.setConstraint(
              node.id,
              node.constraint.type === 'machines' ? { type: 'free' } : { type: 'machines', count: 1 },
            );
          } else if (node.kind === 'source' || node.kind === 'sink') {
            actions.setConstraint(
              node.id,
              node.constraint.type === 'rate' ? { type: 'free' } : { type: 'rate', perSec: 1 },
            );
          }
        }
        actions.endBatch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    flow,
    helpOpen,
    onExport,
    onImport,
    onLayout,
    onShare,
    openSearchAtCentre,
    search.open,
    store,
  ]);

  const past = useGraphStore((state) => state.history.past.length);
  const future = useGraphStore((state) => state.history.future.length);

  return (
    <div className={styles.app}>
      <Header
        projectName={projectName}
        onProjectNameChange={store.getState().setProjectName}
        result={result}
        canUndo={past > 0}
        canRedo={future > 0}
        onUndo={store.getState().undo}
        onRedo={store.getState().redo}
        onLayout={onLayout}
        onShare={onShare}
        onExport={onExport}
        onImport={onImport}
        onHelp={() => setHelpOpen(true)}
      />
      <div className={styles.body}>
        <SolveProvider value={result}>
          <Canvas
            empty={graph.nodes.length === 0}
            onAddAt={(screen) => openSearchAtScreen(screen, { kind: 'anything' }, null)}
            onDropSearch={onDropSearch}
          />
          <Inspector
            selection={selection}
            selectedEdges={selectedEdges}
            onClose={() => store.getState().setSelection([], [])}
          />
        </SolveProvider>
      </div>
      <Search
        open={search.open}
        intent={search.intent}
        onClose={() => setSearch(CLOSED)}
        onChoose={onChoose}
      />
      <ShortcutsOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

