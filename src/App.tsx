import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { defaultTransport, lastSettings, rememberSettings, settingsOf } from './graph/settings.ts';
import { createAutosave, flushOnHide } from './graph/persist.ts';
import {
  createPlan,
  deletePlan,
  openingPlan,
  readIndex,
  readPlan,
  restorePlan,
  setActivePlan,
  watchLibrary,
  writePlan,
} from './graph/library.ts';
import { clearLocationHash, documentFromLocation, shareUrl } from './graph/url.ts';
import { exportDocument, importDocument } from './graph/file.ts';
import { autoLayout } from './graph/layout.ts';
import { planExpand } from './graph/expand.ts';
import { GraphParseError, type GraphDocument } from './graph/serialize.ts';
import { Canvas, type DropSearch } from './canvas/Canvas.tsx';
import { nodeShape } from './canvas/geometry.ts';
import { Header } from './ui/Header.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { Search, type SearchChoice, type SearchIntent } from './ui/Search.tsx';
import { ShortcutsOverlay } from './ui/ShortcutsOverlay.tsx';
import { Toast, type ToastAction } from './ui/Toast.tsx';
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
        // `fitView` has a graph to frame.
        const fromLink = documentFromLocation();
        const { id, doc } = openingPlan(fromLink, () => ({
          graph: emptyGraph(loaded.data.id, lastSettings()),
          projectName: 'Untitled factory',
        }));
        // The link has been saved as its own plan by now, so the hash has done
        // its job. Leaving it there would make every reload another copy.
        if (fromLink) clearLocationHash();
        setActivePlan(id);
        const graphStore = useGraphStore.getState();
        graphStore.openPlan(id, doc);
        graphStore.setPlans(readIndex().plans);
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
  const [plansOpen, setPlansOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; action?: ToastAction } | null>(null);
  const say = useCallback((message: string, action?: ToastAction) => {
    // Returning the same object makes React bail out, so a message repeated
    // by something on a timer — a save that keeps being refused — neither
    // re-renders nor restarts the dismissal clock.
    setToast((current) =>
      current && current.message === message && !current.action && !action
        ? current
        : { message, action },
    );
  }, []);

  const graph = useGraphStore((state) => state.graph);
  const activeId = useGraphStore((state) => state.activeId);
  const plans = useGraphStore((state) => state.plans);
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
  // Writes are debounced because a node drag rewrites `positions` on every
  // pointer move; `flushOnHide` is what makes that safe, by writing the
  // pending document before the page can go away with it unsaved. The payload
  // carries the plan id, so a write still in flight when the user switches
  // plans lands under the plan it was scheduled for.
  const refreshPlans = useCallback(() => {
    store.getState().setPlans(readIndex().plans);
  }, [store]);

  const autosave = useMemo(
    () =>
      createAutosave<{ id: string; doc: GraphDocument }>(({ id, doc }) => {
        if (!writePlan(id, doc)) {
          say('Browser storage is full — this plan is not being saved. Export it to a file.');
        }
      }),
    [say],
  );

  useEffect(() => {
    const off = flushOnHide(autosave.flush);
    return () => {
      off();
      autosave.flush();
    };
  }, [autosave]);

  useEffect(() => {
    if (activeId === null) return;
    autosave.schedule({ id: activeId, doc: { graph, projectName } });
  }, [activeId, autosave, graph, projectName]);

  // --- plans ---------------------------------------------------------------
  /** Switches the canvas to `doc`, which must already be saved under `id`. */
  const showPlan = useCallback(
    (id: string, doc: GraphDocument, refit: boolean) => {
      store.getState().openPlan(id, doc);
      setActivePlan(id);
      // The address bar described the plan we just left.
      clearLocationHash();
      refreshPlans();
      if (refit) {
        requestAnimationFrame(() => void flow.fitView({ padding: 0.25, duration: 0 }));
      }
    },
    [flow, refreshPlans, store],
  );

  const onOpenPlan = useCallback(
    (id: string) => {
      if (id === store.getState().activeId) return;
      // The plan being left keeps its last edit.
      autosave.flush();
      const doc = readPlan(id);
      if (!doc) {
        say('That plan could not be read. It may have been saved by a newer version.');
        refreshPlans();
        return;
      }
      showPlan(id, doc, true);
    },
    [autosave, refreshPlans, say, showPlan, store],
  );

  const onNewPlan = useCallback(() => {
    autosave.flush();
    const doc: GraphDocument = {
      graph: emptyGraph(index.data.id, lastSettings()),
      projectName: 'Untitled factory',
    };
    showPlan(createPlan(doc), doc, false);
  }, [autosave, index, showPlan]);

  const onDeletePlan = useCallback(
    (id: string) => {
      const actions = store.getState();
      const wasActive = id === actions.activeId;
      // A pending write for the plan being deleted would put it straight back.
      if (wasActive) autosave.cancel();
      else autosave.flush();

      const at = readIndex().plans.findIndex((plan) => plan.id === id);
      const removed = deletePlan(id);
      actions.forgetPlan(id);
      refreshPlans();

      if (wasActive) {
        // Land on the plan that took the deleted one's place in the list,
        // rather than jumping to the top of it.
        const remaining = readIndex().plans;
        const neighbour = remaining[Math.min(Math.max(at, 0), remaining.length - 1)];
        const doc = neighbour ? readPlan(neighbour.id) : null;
        if (neighbour && doc) {
          showPlan(neighbour.id, doc, true);
        } else {
          const fresh: GraphDocument = {
            graph: emptyGraph(index.data.id, lastSettings()),
            projectName: 'Untitled factory',
          };
          showPlan(createPlan(fresh), fresh, false);
        }
      }

      if (!removed) return;
      // Deleting a plan is outside the graph's undo stack, so this offer is
      // the only way back.
      say(`Deleted ${removed.meta.name}`, {
        label: 'Undo',
        onAction: () => {
          restorePlan(removed.meta, removed.doc, at);
          refreshPlans();
        },
      });
    },
    [autosave, index, refreshPlans, say, showPlan, store],
  );

  const onPlansOpenChange = useCallback(
    (open: boolean) => {
      // "Last edited" is only worth re-reading when someone is looking at it.
      if (open) refreshPlans();
      setPlansOpen(open);
    },
    [refreshPlans],
  );

  // Another window on the same browser profile writes the same library.
  // Both keep saving and the last write wins, which is the honest behaviour
  // for a store with no locking — but the user should hear about it once.
  const warnedAbout = useRef<string | null>(null);
  useEffect(
    () =>
      watchLibrary((changedPlanId) => {
        refreshPlans();
        const current = store.getState().activeId;
        if (changedPlanId === null || current === null || changedPlanId !== current) return;
        if (warnedAbout.current === current) return;
        warnedAbout.current = current;
        say('This plan is open in another window too. Reload to see those changes.');
      }),
    [refreshPlans, say, store],
  );

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

  /**
   * E: a producer for every unconnected input of the selection. The new nodes
   * become the selection, so pressing E again builds the next step up. An
   * input with a real choice of recipe opens the search for that one.
   */
  const onExpand = useCallback(() => {
    const actions = store.getState();
    const settings = settingsOf(actions.graph);
    const plan = planExpand(actions.graph, index, settings, actions.selection);
    if (plan.nodes.length === 0 && plan.choices.length === 0) {
      say(
        actions.selection.length === 0
          ? 'Select a node to expand.'
          : 'Nothing to expand: every input is connected or on the bus.',
      );
      return;
    }
    actions.beginBatch();
    actions.addNodes(plan.nodes);
    for (const edge of plan.edges) actions.addEdge(edge);
    actions.endBatch();
    if (plan.nodes.length > 0) actions.setSelection(plan.nodes.map((entry) => entry.node.id), []);

    const choice = plan.choices[0];
    if (choice) {
      const node = actions.graph.nodes.find((candidate) => candidate.id === choice.nodeId);
      const width = node ? nodeShape(node, index).width : 0;
      setSearch({
        open: true,
        intent: { kind: 'produces', itemId: choice.itemId },
        // `onChoose` centres the new node on this point; aim it at the slot
        // Expand left for it.
        at: { x: choice.position.x + width / 2, y: choice.position.y + 20 },
        connectTo: { nodeId: choice.nodeId, itemId: choice.itemId, fromSide: 'in' },
      });
      if (plan.choices.length > 1) {
        const rest = plan.choices
          .slice(1)
          .map((entry) => (index.items.get(entry.itemId)?.name ?? entry.itemId).toLowerCase());
        say(`Also needs a recipe chosen: ${rest.join(', ')}.`);
      }
    }
  }, [index, say, store]);

  const openBusSearch = useCallback(() => {
    const rect = document.querySelector('.react-flow')?.getBoundingClientRect();
    openSearchAtScreen(
      { x: (rect?.left ?? 0) + 200, y: (rect?.top ?? 0) + 120 },
      { kind: 'bus' },
      null,
    );
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
      const settings = settingsOf(store.getState().graph);
      if (choice.kind === 'bus') {
        if (!settings.bus.includes(choice.itemId)) {
          const next = { ...settings, bus: [...settings.bus, choice.itemId] };
          store.getState().setSettings(next, index);
          rememberSettings(next);
        }
        setSearch(CLOSED);
        return;
      }
      const node: GraphNode | null =
        choice.kind === 'recipe'
          ? makeRecipeNode(index, choice.recipeId, settings)
          : choice.kind === 'source'
            ? makeSourceNode(choice.itemId)
            : choice.kind === 'sink'
              ? makeSinkNode(choice.itemId)
              : makeNoteNode();
      if (!node) {
        say('That recipe has no machine that can make it.');
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
        const transport = defaultTransport(index, settings, link.itemId);
        actions.addEdge(
          link.fromSide === 'out'
            ? { from: link.nodeId, fromPort: link.itemId, to: node.id, toPort: link.itemId, transport }
            : { from: node.id, fromPort: link.itemId, to: link.nodeId, toPort: link.itemId, transport },
        );
      }
      actions.endBatch();
      actions.setSelection([node.id], []);
      setSearch(CLOSED);
    },
    [index, say, search.at, search.connectTo, store],
  );

  // --- project actions -----------------------------------------------------
  const onShare = useCallback(() => {
    const actions = store.getState();
    const url = shareUrl({ graph: actions.graph, projectName: actions.projectName });
    navigator.clipboard
      .writeText(url)
      .then(() => say('Link copied'))
      .catch(() => say('Could not reach the clipboard. Copy the address bar instead.'));
    // Put the graph in the address bar too, so the link is there either way.
    window.history.replaceState(null, '', url);
  }, [say, store]);

  const onExport = useCallback(() => {
    const actions = store.getState();
    exportDocument({ graph: actions.graph, projectName: actions.projectName });
  }, [store]);

  const onImport = useCallback(() => {
    importDocument()
      .then((doc) => {
        if (!doc) return;
        // An imported file arrives as its own plan, the same way a share link
        // does, so importing never costs you the plan you had open.
        autosave.flush();
        showPlan(createPlan(doc), doc, true);
        say(`Opened ${doc.projectName}`);
      })
      .catch((error: unknown) => {
        say(error instanceof GraphParseError ? error.message : 'That file could not be read.');
      });
  }, [autosave, say, showPlan]);

  const onLayout = useCallback(() => {
    const actions = store.getState();
    autoLayout(actions.graph, index)
      .then((positions) => {
        if (Object.keys(positions).length === 0) return;
        // One undo step for the whole rearrangement.
        store.getState().setPositions(positions);
        requestAnimationFrame(() => void flow.fitView({ padding: 0.2, duration: viewportDuration() }));
      })
      .catch(() => say('Auto-layout failed. The graph is unchanged.'));
  }, [flow, index, say, store]);

  // --- keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const typing = isTyping(event.target);
      const actions = store.getState();
      const control = event.ctrlKey || event.metaKey;

      if (event.key === 'Escape') {
        if (search.open) setSearch(CLOSED);
        else if (plansOpen) onPlansOpenChange(false);
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
      } else if (control && event.key.toLowerCase() === 'p') {
        // Quick-switch, the way Ctrl P opens a file list in an editor.
        event.preventDefault();
        onPlansOpenChange(!plansOpen);
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
      } else if (event.key.toLowerCase() === 'e' && !control && !event.altKey) {
        event.preventDefault();
        onExpand();
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
    onExpand,
    onExport,
    onImport,
    onLayout,
    onShare,
    onPlansOpenChange,
    openSearchAtCentre,
    plansOpen,
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
        plans={plans}
        activePlanId={activeId}
        plansOpen={plansOpen}
        onPlansOpenChange={onPlansOpenChange}
        onOpenPlan={onOpenPlan}
        onNewPlan={onNewPlan}
        onDeletePlan={onDeletePlan}
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
            onAddBusItem={openBusSearch}
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
      <Toast
        message={toast?.message ?? null}
        action={toast?.action ?? null}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}

