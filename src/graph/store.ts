import { create } from 'zustand';
import type { GameIndex } from '../data/loader.ts';
import { defaultMachineFor } from '../data/loader.ts';
import * as history from './history.ts';
import type { PlanMeta } from './library.ts';
import type { GraphDocument } from './serialize.ts';
import { emptyGraph } from './types.ts';
import * as edit from '../build/edit.ts';
import { emptyBuild, type Build, type BuildEntity, type HandSize } from '../build/types.ts';
import type {
  BeaconConfig,
  Blocks,
  Constraint,
  FlowEdge,
  Graph,
  GraphNode,
  NodeId,
  Position,
  RateConstraint,
  RecipeNode,
  Transport,
} from './types.ts';

let counter = 0;
/** Short, collision-free within a document; graphs are single-user. */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface GraphState extends GraphDocument {
  /** Always present in memory; only the saved document may leave it out. */
  build: Build;
  history: history.History<GraphDocument>;
  selection: NodeId[];
  selectedEdges: string[];
  /** Selected entities on the build view. Not undoable, like node selection. */
  buildSelection: string[];
  /** Every saved plan, in the order the switcher lists them. */
  plans: PlanMeta[];
  /** Which of them is on the canvas. Null only before the first boot step. */
  activeId: string | null;
}

/**
 * Undo stacks for plans that are not on the canvas. Switching away parks the
 * stack here and switching back restores it, so a round trip through another
 * plan does not cost you your history.
 *
 * Snapshots are deep clones, so this is the one place in the app that can grow
 * without bound; the few most recently visited plans are kept and the rest are
 * dropped. Losing undo on a plan you have not touched in a while is a far
 * better failure than an editor that swells until the tab dies.
 */
export const PARKED_HISTORY_LIMIT = 5;
const parkedHistories = new Map<string, history.History<GraphDocument>>();

function park(id: string, stack: history.History<GraphDocument>): void {
  if (stack.past.length === 0 && stack.future.length === 0) {
    parkedHistories.delete(id);
    return;
  }
  // Delete first so the re-insert moves it to the young end of the Map.
  parkedHistories.delete(id);
  parkedHistories.set(id, stack);
  while (parkedHistories.size > PARKED_HISTORY_LIMIT) {
    const oldest = parkedHistories.keys().next().value;
    if (oldest === undefined) break;
    parkedHistories.delete(oldest);
  }
}

function unpark(id: string): history.History<GraphDocument> {
  const stack = parkedHistories.get(id);
  parkedHistories.delete(id);
  return stack ?? history.emptyHistory<GraphDocument>();
}

interface Actions {
  /** Replaces the whole document and forgets every undo stack — a cold start. */
  load(doc: GraphDocument): void;
  /** Switches plans, parking the current undo stack and restoring the target's. */
  openPlan(id: string, doc: GraphDocument): void;
  /** Refreshes the switcher list from the library. */
  setPlans(plans: PlanMeta[]): void;
  /** Drops a deleted plan's parked undo stack. */
  forgetPlan(id: string): void;
  setProjectName(name: string): void;

  addNode(node: GraphNode, position: Position): void;
  addNodes(nodes: { node: GraphNode; position: Position }[]): void;
  removeNodes(ids: NodeId[]): void;
  duplicateNodes(ids: NodeId[]): NodeId[];
  updateRecipeNode(id: NodeId, patch: Partial<Omit<RecipeNode, 'id' | 'kind'>>): void;
  setConstraint(id: NodeId, constraint: Constraint | RateConstraint): void;
  setNoteText(id: NodeId, text: string): void;
  setBeacons(id: NodeId, beacons: BeaconConfig | null): void;
  /** Null builds the node as one block and drops the field entirely. */
  setBlocks(id: NodeId, blocks: Blocks | null): void;

  addEdge(edge: Omit<FlowEdge, 'id'>): string | null;
  removeEdges(ids: string[]): void;
  setTransport(id: string, transport: Transport): void;

  /** Layout-only; `transient` skips the undo push so a drag is one step. */
  moveNodes(moves: Record<NodeId, Position>, transient: boolean): void;
  setPositions(positions: Record<NodeId, Position>): void;

  beginBatch(): void;
  endBatch(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  setSelection(nodes: NodeId[], edges: string[]): void;

  /** Ids now standing where each entity went, or null where it did not fit. */
  placeEntities(entities: BuildEntity[]): (string | null)[];
  removeEntities(ids: string[]): void;
  updateEntity(id: string, patch: Partial<BuildEntity>): void;
  rotateEntity(id: string): void;
  setHands(hands: HandSize): void;
  setBuildSelection(ids: string[]): void;
}

export type GraphStore = GraphState & Actions;

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function snapshot(state: GraphState): GraphDocument {
  return {
    graph: structuredClone(state.graph),
    projectName: state.projectName,
    build: structuredClone(state.build),
  };
}

export const useGraphStore = create<GraphStore>()((set, get) => {
  /** Applies a semantic change and records one undo point for it. */
  function commit(mutate: (graph: Graph) => Graph): void {
    set((state) => ({
      graph: mutate(state.graph),
      history: history.push(state.history, snapshot(state)),
    }));
  }

  /** The build-side twin of `commit`: one undo point per change. */
  function commitBuild(mutate: (build: Build) => Build): void {
    set((state) => {
      const build = mutate(state.build);
      if (build === state.build) return {};
      return { build, history: history.push(state.history, snapshot(state)) };
    });
  }

  return {
    graph: emptyGraph('2x1'),
    projectName: 'Untitled factory',
    build: emptyBuild(),
    history: history.emptyHistory<GraphDocument>(),
    selection: [],
    selectedEdges: [],
    buildSelection: [],
    plans: [],
    activeId: null,

    load(doc) {
      parkedHistories.clear();
      set({
        graph: doc.graph,
        projectName: doc.projectName,
        build: doc.build ?? emptyBuild(),
        history: history.emptyHistory<GraphDocument>(),
        selection: [],
        selectedEdges: [],
        buildSelection: [],
        activeId: null,
      });
    },

    openPlan(id, doc) {
      set((state) => {
        if (state.activeId === id) {
          // Re-opening the plan already on the canvas would throw away its
          // undo stack for nothing.
          return {};
        }
        if (state.activeId !== null) park(state.activeId, state.history);
        return {
          activeId: id,
          graph: doc.graph,
          projectName: doc.projectName,
          build: doc.build ?? emptyBuild(),
          history: unpark(id),
          selection: [],
          selectedEdges: [],
          buildSelection: [],
        };
      });
    },

    setPlans(plans) {
      set({ plans });
    },

    forgetPlan(id) {
      parkedHistories.delete(id);
    },

    setProjectName(name) {
      set((state) => ({
        projectName: name,
        history: history.push(state.history, snapshot(state)),
      }));
    },

    addNode(node, position) {
      get().addNodes([{ node, position }]);
    },

    addNodes(entries) {
      if (entries.length === 0) return;
      commit((graph) => ({
        ...graph,
        nodes: [...graph.nodes, ...entries.map((e) => e.node)],
        positions: {
          ...graph.positions,
          ...Object.fromEntries(entries.map((e) => [e.node.id, e.position])),
        },
      }));
    },

    removeNodes(ids) {
      if (ids.length === 0) return;
      const doomed = new Set(ids);
      commit((graph) => {
        const positions = { ...graph.positions };
        for (const id of doomed) delete positions[id];
        return {
          ...graph,
          nodes: graph.nodes.filter((n) => !doomed.has(n.id)),
          edges: graph.edges.filter((e) => !doomed.has(e.from) && !doomed.has(e.to)),
          positions,
        };
      });
      set((state) => ({
        selection: state.selection.filter((id) => !doomed.has(id)),
      }));
    },

    duplicateNodes(ids) {
      const { graph } = get();
      const source = new Set(ids);
      const copies = graph.nodes.filter((n) => source.has(n.id));
      if (copies.length === 0) return [];

      const remap = new Map<NodeId, NodeId>();
      for (const node of copies) remap.set(node.id, newId(node.kind[0] ?? 'n'));

      const OFFSET = 32;
      const newNodes = copies.map((node) => ({ ...structuredClone(node), id: remap.get(node.id)! }));
      const newPositions = Object.fromEntries(
        copies.map((node) => {
          const from = graph.positions[node.id] ?? { x: 0, y: 0 };
          return [remap.get(node.id)!, { x: from.x + OFFSET, y: from.y + OFFSET }];
        }),
      );
      // Edges wholly inside the selection are copied too, so duplicating a
      // sub-chain gives you a working sub-chain rather than loose nodes.
      const newEdges = graph.edges
        .filter((e) => remap.has(e.from) && remap.has(e.to))
        .map((e) => ({ ...e, id: newId('e'), from: remap.get(e.from)!, to: remap.get(e.to)! }));

      commit((current) => ({
        ...current,
        nodes: [...current.nodes, ...newNodes],
        edges: [...current.edges, ...newEdges],
        positions: { ...current.positions, ...newPositions },
      }));
      return newNodes.map((n) => n.id);
    },

    updateRecipeNode(id, patch) {
      commit((graph) => ({
        ...graph,
        nodes: graph.nodes.map((n) =>
          n.id === id && n.kind === 'recipe' ? { ...n, ...patch } : n,
        ),
      }));
    },

    setConstraint(id, constraint) {
      commit((graph) => ({
        ...graph,
        nodes: graph.nodes.map((n) => {
          if (n.id !== id) return n;
          if (n.kind === 'note') return n;
          if (n.kind === 'recipe') {
            return constraint.type === 'rate' ? n : { ...n, constraint };
          }
          return constraint.type === 'machines' ? n : { ...n, constraint };
        }),
      }));
    },

    setNoteText(id, text) {
      commit((graph) => ({
        ...graph,
        nodes: graph.nodes.map((n) => (n.id === id && n.kind === 'note' ? { ...n, text } : n)),
      }));
    },

    setBeacons(id, beacons) {
      commit((graph) => ({
        ...graph,
        nodes: graph.nodes.map((n) => (n.id === id && n.kind === 'recipe' ? { ...n, beacons } : n)),
      }));
    },

    setBlocks(id, blocks) {
      commit((graph) => ({
        ...graph,
        nodes: graph.nodes.map((n) => {
          if (n.id !== id || n.kind !== 'recipe') return n;
          if (blocks) return { ...n, blocks };
          // Leave no `blocks: undefined` behind, so a node set back to one
          // block saves exactly as it did before blocks existed.
          const { blocks: _dropped, ...rest } = n;
          return rest;
        }),
      }));
    },

    addEdge(edge) {
      const { graph } = get();
      // One edge per (source port, target port) pair; re-dragging is a no-op.
      const duplicate = graph.edges.some(
        (e) =>
          e.from === edge.from &&
          e.fromPort === edge.fromPort &&
          e.to === edge.to &&
          e.toPort === edge.toPort,
      );
      // A self-edge is legitimate: Kovarex and coal liquefaction feed their own
      // input port from their own output port.
      if (duplicate) return null;
      const id = newId('e');
      commit((current) => ({ ...current, edges: [...current.edges, { ...edge, id }] }));
      return id;
    },

    removeEdges(ids) {
      if (ids.length === 0) return;
      const doomed = new Set(ids);
      commit((graph) => ({ ...graph, edges: graph.edges.filter((e) => !doomed.has(e.id)) }));
    },

    setTransport(id, transport) {
      commit((graph) => ({
        ...graph,
        edges: graph.edges.map((e) => (e.id === id ? { ...e, transport } : e)),
      }));
    },

    moveNodes(moves, transient) {
      set((state) => {
        // React Flow re-emits the current position on every render pass. Writing
        // it back unchanged would produce a new graph object, re-render the
        // canvas, and emit it again — an endless loop.
        const changed = Object.entries(moves).filter(([id, position]) => {
          const current = state.graph.positions[id];
          return !current || current.x !== position.x || current.y !== position.y;
        });
        if (changed.length === 0) return {};
        return {
          graph: {
            ...state.graph,
            positions: { ...state.graph.positions, ...Object.fromEntries(changed) },
          },
          history: transient ? state.history : history.push(state.history, snapshot(state)),
        };
      });
    },

    setPositions(positions) {
      commit((graph) => ({ ...graph, positions }));
    },

    beginBatch() {
      set((state) => ({ history: history.beginBatch(state.history) }));
    },
    endBatch() {
      set((state) => ({ history: history.endBatch(state.history) }));
    },

    undo() {
      set((state) => {
        const step = history.undo(state.history, snapshot(state));
        if (!step) return {};
        return {
          history: step.history,
          graph: step.present.graph,
          projectName: step.present.projectName,
          build: step.present.build ?? emptyBuild(),
          // An undone placement may take a selected entity with it.
          buildSelection: keepExisting(state.buildSelection, step.present.build),
        };
      });
    },

    redo() {
      set((state) => {
        const step = history.redo(state.history, snapshot(state));
        if (!step) return {};
        return {
          history: step.history,
          graph: step.present.graph,
          projectName: step.present.projectName,
          build: step.present.build ?? emptyBuild(),
          // An undone placement may take a selected entity with it.
          buildSelection: keepExisting(state.buildSelection, step.present.build),
        };
      });
    },

    canUndo: () => get().history.past.length > 0,
    canRedo: () => get().history.future.length > 0,

    setSelection(nodes, edges) {
      set((state) => {
        // Same reason as `moveNodes`: React Flow reports the selection back to
        // us after every render, and a fresh array each time would loop.
        if (sameIds(state.selection, nodes) && sameIds(state.selectedEdges, edges)) return {};
        return { selection: nodes, selectedEdges: edges };
      });
    },

    placeEntities(entities) {
      if (entities.length === 0) return [];
      const result = edit.placeEntities(get().build, entities);
      if (result.placed.every((id) => id === null)) return result.placed;
      commitBuild(() => result.build);
      return result.placed;
    },

    removeEntities(ids) {
      if (ids.length === 0) return;
      const doomed = new Set(ids);
      if (!get().build.entities.some((entity) => doomed.has(entity.id))) return;
      commitBuild((build) => edit.removeEntities(build, ids));
      set((state) => ({
        buildSelection: state.buildSelection.filter((id) => !doomed.has(id)),
      }));
    },

    updateEntity(id, patch) {
      commitBuild((build) => edit.updateEntity(build, id, patch));
    },

    rotateEntity(id) {
      commitBuild((build) => edit.rotateEntity(build, id));
    },

    setHands(hands) {
      commitBuild((build) => (build.hands === hands ? build : { ...build, hands }));
    },

    setBuildSelection(ids) {
      set((state) => (sameIds(state.buildSelection, ids) ? {} : { buildSelection: ids }));
    },
  };
});

function keepExisting(ids: string[], build: Build | undefined): string[] {
  if (ids.length === 0) return ids;
  const present = new Set((build?.entities ?? []).map((entity) => entity.id));
  const kept = ids.filter((id) => present.has(id));
  return kept.length === ids.length ? ids : kept;
}

// --- node constructors -------------------------------------------------------

export function makeRecipeNode(index: GameIndex, recipeId: string): RecipeNode | null {
  const recipe = index.recipes.get(recipeId);
  if (!recipe) return null;
  const machineId = defaultMachineFor(index, recipe);
  if (machineId === null) return null;
  const machine = index.machines.get(machineId);
  return {
    id: newId('r'),
    kind: 'recipe',
    recipeId,
    machineId,
    modules: Array.from({ length: machine?.moduleSlots ?? 0 }, () => ''),
    beacons: null,
    constraint: { type: 'free' },
  };
}

export function makeSourceNode(itemId: string): GraphNode {
  return { id: newId('s'), kind: 'source', itemId, constraint: { type: 'free' } };
}

export function makeSinkNode(itemId: string): GraphNode {
  return { id: newId('k'), kind: 'sink', itemId, constraint: { type: 'free' } };
}

export function makeNoteNode(text = ''): GraphNode {
  return { id: newId('n'), kind: 'note', text };
}

// A read-only handle on the store for the Playwright smoke test. It exposes
// nothing that the UI does not already show, and asserting against the real
// document beats scraping the DOM for it.
if (typeof window !== 'undefined') {
  (window as unknown as { __factoryGraph: typeof useGraphStore }).__factoryGraph = useGraphStore;
}
