import { create } from 'zustand';
import type { GameIndex } from '../data/loader.ts';
import { defaultMachineFor } from '../data/loader.ts';
import * as history from './history.ts';
import type { GraphDocument } from './serialize.ts';
import { emptyGraph } from './types.ts';
import type {
  BeaconConfig,
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
  history: history.History<GraphDocument>;
  selection: NodeId[];
  selectedEdges: string[];
}

interface Actions {
  /** Replaces the whole document, clearing history — load, import, reset. */
  load(doc: GraphDocument): void;
  setProjectName(name: string): void;

  addNode(node: GraphNode, position: Position): void;
  addNodes(nodes: { node: GraphNode; position: Position }[]): void;
  removeNodes(ids: NodeId[]): void;
  duplicateNodes(ids: NodeId[]): NodeId[];
  updateRecipeNode(id: NodeId, patch: Partial<Omit<RecipeNode, 'id' | 'kind'>>): void;
  setConstraint(id: NodeId, constraint: Constraint | RateConstraint): void;
  setNoteText(id: NodeId, text: string): void;
  setBeacons(id: NodeId, beacons: BeaconConfig | null): void;

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
}

export type GraphStore = GraphState & Actions;

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function snapshot(state: GraphState): GraphDocument {
  return { graph: structuredClone(state.graph), projectName: state.projectName };
}

export const useGraphStore = create<GraphStore>()((set, get) => {
  /** Applies a semantic change and records one undo point for it. */
  function commit(mutate: (graph: Graph) => Graph): void {
    set((state) => ({
      graph: mutate(state.graph),
      history: history.push(state.history, snapshot(state)),
    }));
  }

  return {
    graph: emptyGraph('2x1'),
    projectName: 'Untitled factory',
    history: history.emptyHistory<GraphDocument>(),
    selection: [],
    selectedEdges: [],

    load(doc) {
      set({
        graph: doc.graph,
        projectName: doc.projectName,
        history: history.emptyHistory<GraphDocument>(),
        selection: [],
        selectedEdges: [],
      });
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
  };
});

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
