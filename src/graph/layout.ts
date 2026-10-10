import type { ELK, ElkNode } from 'elkjs/lib/elk-api';
import type { GameIndex } from '../data/loader.ts';
import { nodeShape, portOffsetY } from '../canvas/geometry.ts';
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
 *
 * ELK is 1.4 MB — three times the rest of the app — for something most sessions
 * press once or never. It is loaded on first use instead of at startup, and the
 * instance is kept so the second layout is immediate.
 */
let elk: ELK | null = null;

async function getElk(): Promise<ELK> {
  if (!elk) {
    const { default: ElkConstructor } = await import('elkjs/lib/elk.bundled.js');
    elk = new ElkConstructor();
  }
  return elk;
}

/**
 * Tuned against `scoreLayout` on the fixtures and a two-science tree built
 * with Expand; see NOTES.md, M10, for the numbers behind each choice.
 */
const OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  // Room for a manifold: a 36px spine plus a branch long enough to carry its
  // rate label clear of the next node. At 120 the labels sat on the nodes.
  'elk.layered.spacing.nodeNodeBetweenLayers': '180',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.edgeNodeBetweenLayers': '30',
  'elk.edgeRouting': 'ORTHOGONAL',
  // Brandes-Köpf left connections running behind unrelated nodes; network
  // simplex was the only placement that never did, for one more bend at most.
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  // Respects the order the user already has; laying out from scratch scored
  // worse as well as reshuffling what they were reading.
  'elk.layered.crossingMinimization.semiInteractive': 'true',
};

const portId = (nodeId: string, side: 'in' | 'out', itemId: string): string =>
  `${nodeId}|${side}|${itemId}`;

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
      layoutOptions: {
        // Seed ELK with where things already are, so a re-layout keeps the
        // arrangement the user has been reading rather than reshuffling it.
        'elk.position': `(${at.x},${at.y})`,
        // Connections attach at port rows, not node centres. Told where the
        // ports are, ELK lines ports up rather than centres, which is what
        // makes a connection straight: 23 of 24 bent on the science tree
        // without this, 7 with it.
        'elk.portConstraints': 'FIXED_POS',
      },
      ports: [
        ...shape.inputs.map((port) => ({
          id: portId(node.id, 'in', port.itemId),
          x: 0,
          y: portOffsetY(shape, port.row),
          width: 0,
          height: 0,
          layoutOptions: { 'elk.port.side': 'WEST' },
        })),
        ...shape.outputs.map((port) => ({
          id: portId(node.id, 'out', port.itemId),
          x: shape.width,
          y: portOffsetY(shape, port.row),
          width: 0,
          height: 0,
          layoutOptions: { 'elk.port.side': 'EAST' },
        })),
      ],
    };
  });

  // ELK throws on a connection to a port it was not given — one whose item no
  // longer matches its node, which the solver already ignores — so those sit
  // the layout out too.
  const ports = new Set(children.flatMap((child) => (child.ports ?? []).map((port) => port.id)));

  // A self-loop carries no ordering information and ELK routes it oddly, so it
  // is left out of the layout and drawn around its node afterwards.
  const edges = graph.edges
    .filter((edge) => edge.from !== edge.to)
    .filter(
      (edge) =>
        ports.has(portId(edge.from, 'out', edge.fromPort)) &&
        ports.has(portId(edge.to, 'in', edge.toPort)),
    )
    .map((edge) => ({
      id: edge.id,
      sources: [portId(edge.from, 'out', edge.fromPort)],
      targets: [portId(edge.to, 'in', edge.toPort)],
    }));

  const laid = await (await getElk()).layout({
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
