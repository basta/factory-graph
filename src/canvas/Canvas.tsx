import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { useGameData } from '../data/context.ts';
import { defaultTransport, settingsOf } from '../graph/settings.ts';
import { useGraphStore } from '../graph/store.ts';
import type { PortSide } from '../graph/types.ts';
import { CanvasControls } from './CanvasControls.tsx';
import { DotGrid } from './DotGrid.tsx';
import { EdgeMarkers, FlowEdgeView } from './FlowEdgeView.tsx';
import { IoNodeView } from './IoNodeView.tsx';
import { MiniMap } from './MiniMap.tsx';
import { NoteNodeView } from './NoteNodeView.tsx';
import { PlanBar } from './PlanBar.tsx';
import { RecipeNodeView } from './RecipeNodeView.tsx';
import { nodeShape } from './geometry.ts';
import { useConnecting } from './connecting.ts';
import { useKeepSelectionVisible } from './useKeepSelectionVisible.ts';
import { useSolve } from '../solver/context.ts';
import styles from './Canvas.module.css';

const nodeTypes = {
  recipe: RecipeNodeView,
  source: IoNodeView,
  sink: IoNodeView,
  note: NoteNodeView,
};

const edgeTypes = { flow: FlowEdgeView };

export interface DropSearch {
  /** Where the dragged edge was let go, in screen coordinates. */
  screen: { x: number; y: number };
  itemId: string;
  /** The side the drag *started* from; the new node supplies the other side. */
  fromSide: PortSide;
  nodeId: string;
}

interface Props {
  empty: boolean;
  /** Double-click on blank canvas: open the palette at this point. */
  onAddAt: (screen: { x: number; y: number }) => void;
  /** Edge dragged into blank canvas: open the palette pre-filtered. */
  onDropSearch: (drop: DropSearch) => void;
  /** The plan bar's bus "+": open the palette to pick an item. */
  onAddBusItem: () => void;
}

export function Canvas({ empty, onAddAt, onDropSearch, onAddBusItem }: Props): JSX.Element {
  const index = useGameData();
  const graph = useGraphStore((state) => state.graph);
  const selection = useGraphStore((state) => state.selection);
  const selectedEdges = useGraphStore((state) => state.selectedEdges);
  const moveNodes = useGraphStore((state) => state.moveNodes);
  const setSelection = useGraphStore((state) => state.setSelection);
  const addEdge = useGraphStore((state) => state.addEdge);
  const removeEdges = useGraphStore((state) => state.removeEdges);
  const beginBatch = useGraphStore((state) => state.beginBatch);
  const endBatch = useGraphStore((state) => state.endBatch);
  const result = useSolve();
  const startConnecting = useConnecting((state) => state.start);
  useKeepSelectionVisible(selection);
  const clearConnecting = useConnecting((state) => state.clear);

  const nodes = useMemo<Node[]>(
    () =>
      graph.nodes.map((node) => {
        const shape = nodeShape(node, index);
        return {
          id: node.id,
          type: node.kind,
          position: graph.positions[node.id] ?? { x: 0, y: 0 },
          data: { nodeId: node.id },
          selected: selection.includes(node.id),
          width: shape.width,
          height: shape.height,
        };
      }),
    [graph.nodes, graph.positions, index, selection],
  );

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        sourceHandle: edge.fromPort,
        targetHandle: edge.toPort,
        type: 'flow',
        selected: selectedEdges.includes(edge.id),
      })),
    [graph.edges, selectedEdges],
  );

  /**
   * React Flow is fully controlled here, so it reports intent as changes and we
   * decide what to keep. Selection has to be applied by us — dropping `select`
   * changes is what makes clicking a node do nothing.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const moves: Record<string, { x: number; y: number }> = {};
      const current = useGraphStore.getState();
      const selected = new Set(current.selection);
      let selectionChanged = false;
      const removed: string[] = [];

      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          moves[change.id] = change.position;
        } else if (change.type === 'select') {
          selectionChanged = true;
          if (change.selected) selected.add(change.id);
          else selected.delete(change.id);
        } else if (change.type === 'remove') {
          removed.push(change.id);
        }
      }

      // Positions stream during a drag; the undo point was taken on drag start,
      // so these are transient.
      if (Object.keys(moves).length > 0) moveNodes(moves, true);
      if (selectionChanged) setSelection([...selected], current.selectedEdges);
      if (removed.length > 0) current.removeNodes(removed);
    },
    [moveNodes, setSelection],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const current = useGraphStore.getState();
      const selected = new Set(current.selectedEdges);
      let selectionChanged = false;
      const removed: string[] = [];

      for (const change of changes) {
        if (change.type === 'select') {
          selectionChanged = true;
          if (change.selected) selected.add(change.id);
          else selected.delete(change.id);
        } else if (change.type === 'remove') {
          removed.push(change.id);
        }
      }

      if (selectionChanged) setSelection(current.selection, [...selected]);
      if (removed.length > 0) current.removeEdges(removed);
    },
    [setSelection],
  );

  // Ports only join when the item matches; the handle shows red otherwise.
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => connection.sourceHandle === connection.targetHandle,
    [],
  );

  return (
    <div className={styles.canvas}>
      <EdgeMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={2.5}
        zoomOnScroll
        zoomOnDoubleClick={false}
        panOnScroll={false}
        panOnDrag={[1, 2]}
        selectionOnDrag
        panActivationKeyCode="Space"
        deleteKeyCode={null}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        selectionKeyCode={null}
        nodesConnectable
        elevateEdgesOnSelect
        connectionRadius={26}
        isValidConnection={isValidConnection}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={beginBatch}
        onNodeDragStop={endBatch}
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement;
          if (!target.classList.contains('react-flow__pane')) return;
          onAddAt({ x: event.clientX, y: event.clientY });
        }}
        onConnectStart={(_event, params) => {
          const side: PortSide = params.handleType === 'source' ? 'out' : 'in';
          if (params.nodeId && params.handleId) startConnecting(params.nodeId, params.handleId, side);
        }}
        onConnect={(connection) => {
          if (!connection.sourceHandle || !connection.targetHandle) return;
          addEdge({
            from: connection.source,
            fromPort: connection.sourceHandle,
            to: connection.target,
            toPort: connection.targetHandle,
            transport: defaultTransport(
              index,
              settingsOf(useGraphStore.getState().graph),
              connection.sourceHandle,
            ),
          });
        }}
        onConnectEnd={(event, connectionState) => {
          clearConnecting();
          const from = connectionState.fromHandle;
          // React Flow tells us where the drag started and whether it landed on
          // a node, which beats guessing from the event target's class list.
          if (!from?.nodeId || !from.id) return;
          if (connectionState.toNode) return;
          const point =
            'clientX' in event
              ? { x: event.clientX, y: event.clientY }
              : {
                  x: event.changedTouches[0]?.clientX ?? 0,
                  y: event.changedTouches[0]?.clientY ?? 0,
                };
          onDropSearch({
            screen: point,
            itemId: from.id,
            fromSide: from.type === 'source' ? 'out' : 'in',
            nodeId: from.nodeId,
          });
        }}
        onEdgeDoubleClick={(_event, edge) => removeEdges([edge.id])}
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
      {!empty && result?.status === 'no-constraint' ? (
        // Every rate is zero until something pins one down. Say which knob.
        <p className={styles.hint}>
          Nothing is pinned yet, so every rate is zero. Select a node and fix its machine
          count, or add a sink with a rate.
        </p>
      ) : null}
      <PlanBar onAddBusItem={onAddBusItem} />
      <MiniMap />
      <CanvasControls />
    </div>
  );
}
