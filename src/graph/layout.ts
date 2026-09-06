import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';
import type { GameIndex } from '../data/loader.ts';
import { nodeShape } from '../canvas/geometry.ts';
import type { Graph, Position } from './types.ts';

/**
 * Left-to-right layered auto-layout.
 *
 * Only positions come back — nothing here touches the semantic graph, so the
 * whole thing is one undo step that changes nothing the solver can see.
 *
 * The bundled ELK build runs on the main thread. Layout is a deliberate,
 * user-invoked action rather than something that happens while typing, so a
 * few hundred milliseconds on a large graph is acceptable; a worker would buy
 * responsiveness we do not need here and cost a second bundle.
 */
const elk = new ELK();

const OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  // Wide enough that the rate labels between two layers have room to sit.
  'elk.layered.spacing.nodeNodeBetweenLayers': '120',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.edgeNodeBetweenLayers': '30',
  'elk.edgeRouting': 'ORTHOGONAL',
  // Keeps a chain readable by minimising how often edges cross layers.
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
};

export async function autoLayout(
  graph: Graph,
  index: GameIndex,
): Promise<Record<string, Position>> {
  if (graph.nodes.length === 0) return {};

  const children: ElkNode[] = graph.nodes.map((node) => {
    const shape = nodeShape(node, index);
    const at = graph.positions[node.id] ?? { x: 0, y: 0 };
    return {
      id: node.id,
      width: shape.width,
      height: shape.height,
      // Seed ELK with where things already are, so a re-layout keeps the
      // arrangement the user has been reading rather than reshuffling it.
      layoutOptions: { 'elk.position': `(${at.x},${at.y})` },
    };
  });

  // A self-loop carries no ordering information and ELK routes it oddly, so it
  // is left out of the layout and drawn around its node afterwards.
  const edges = graph.edges
    .filter((edge) => edge.from !== edge.to)
    .map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] }));

  const laid = await elk.layout({
    id: 'root',
    layoutOptions: OPTIONS,
    children,
    edges,
  });

  const positions: Record<string, Position> = {};
  for (const child of laid.children ?? []) {
    positions[child.id] = { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) };
  }
  return positions;
}
