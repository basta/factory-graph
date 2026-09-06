import { describe, expect, it } from 'vitest';
import {
  decodeFromHash,
  encodeToHash,
  GraphParseError,
  parseDocument,
  serializeDocument,
  type GraphDocument,
} from './serialize.ts';
import type { Graph, GraphNode } from './types.ts';

function doc(nodes: GraphNode[], edges: Graph['edges'] = []): GraphDocument {
  return {
    projectName: 'Green circuits',
    graph: {
      version: 1,
      dataSet: '2x1',
      nodes,
      edges,
      positions: Object.fromEntries(nodes.map((node, i) => [node.id, { x: i * 300, y: i * 40 }])),
    },
  };
}

/** One of every node kind, every constraint shape, every transport. */
const kitchenSink = doc(
  [
    {
      id: 'r1',
      kind: 'recipe',
      recipeId: 'electronic-circuit',
      machineId: 'assembling-machine-3',
      modules: ['productivity-module-3', '', 'speed-module-3', ''],
      beacons: { beaconId: 'beacon', count: 8, modules: ['speed-module-3', 'speed-module-3'] },
      constraint: { type: 'machines', count: 12.5 },
    },
    {
      id: 'r2',
      kind: 'recipe',
      recipeId: 'copper-cable',
      machineId: 'assembling-machine-2',
      modules: [],
      beacons: null,
      constraint: { type: 'free' },
    },
    { id: 's1', kind: 'source', itemId: 'copper-plate', constraint: { type: 'rate', perSec: 67.5 } },
    { id: 'k1', kind: 'sink', itemId: 'electronic-circuit', constraint: { type: 'free' } },
    { id: 'n1', kind: 'note', text: 'Feeds the mall.\nNeeds a second belt.' },
  ],
  [
    {
      id: 'e1',
      from: 'r2',
      fromPort: 'copper-cable',
      to: 'r1',
      toPort: 'copper-cable',
      transport: { kind: 'belt', beltId: 'express-transport-belt', lanes: 2 },
    },
    {
      id: 'e2',
      from: 's1',
      fromPort: 'copper-plate',
      to: 'r2',
      toPort: 'copper-plate',
      transport: { kind: 'inserter', inserterId: 'bulk-inserter', count: 3 },
    },
    {
      id: 'e3',
      from: 'r1',
      fromPort: 'electronic-circuit',
      to: 'k1',
      toPort: 'electronic-circuit',
      transport: null,
    },
    {
      id: 'e4',
      from: 'r1',
      fromPort: 'electronic-circuit',
      to: 'r1',
      toPort: 'iron-plate',
      transport: { kind: 'pipe', pipeId: 'pump' },
    },
  ],
);

describe('JSON round trip', () => {
  it('comes back deep-equal', () => {
    expect(parseDocument(serializeDocument(kitchenSink))).toEqual(kitchenSink);
  });

  it('keeps positions separate from semantics', () => {
    const parsed = parseDocument(serializeDocument(kitchenSink));
    expect(parsed.graph.positions).toEqual(kitchenSink.graph.positions);
    // No position leaked into a node.
    for (const node of parsed.graph.nodes) {
      expect(node).not.toHaveProperty('x');
      expect(node).not.toHaveProperty('position');
    }
  });

  it('rejects a file that is not JSON', () => {
    expect(() => parseDocument('not json')).toThrow(GraphParseError);
  });

  it('rejects a graph from a future version', () => {
    const future = JSON.parse(serializeDocument(kitchenSink)) as { graph: { version: number } };
    future.graph.version = 2;
    expect(() => parseDocument(JSON.stringify(future))).toThrow(GraphParseError);
  });

  it('rejects a node with an unknown kind', () => {
    const broken = JSON.parse(serializeDocument(kitchenSink)) as {
      graph: { nodes: { kind: string }[] };
    };
    broken.graph.nodes[0]!.kind = 'machine';
    expect(() => parseDocument(JSON.stringify(broken))).toThrow(GraphParseError);
  });

  it('rejects a negative fixed rate', () => {
    const broken = JSON.parse(serializeDocument(kitchenSink)) as {
      graph: { nodes: { constraint: { type: string; perSec?: number } }[] };
    };
    broken.graph.nodes[2]!.constraint = { type: 'rate', perSec: -5 };
    expect(() => parseDocument(JSON.stringify(broken))).toThrow(GraphParseError);
  });

  it('drops edges and positions that point at missing nodes', () => {
    const broken = JSON.parse(serializeDocument(kitchenSink)) as GraphDocument;
    broken.graph.nodes = broken.graph.nodes.filter((node) => node.id !== 'k1');
    const parsed = parseDocument(JSON.stringify(broken));
    expect(parsed.graph.edges.map((edge) => edge.id)).toEqual(['e1', 'e2', 'e4']);
    expect(parsed.graph.positions.k1).toBeUndefined();
  });

  it('reports what is wrong and where', () => {
    expect(() => parseDocument('{"projectName":"x"}')).toThrow(/graph/);
  });
});

describe('URL hash round trip', () => {
  it('comes back deep-equal', () => {
    expect(decodeFromHash(encodeToHash(kitchenSink))).toEqual(kitchenSink);
  });

  it('tolerates a leading hash character', () => {
    expect(decodeFromHash(`#${encodeToHash(kitchenSink)}`)).toEqual(kitchenSink);
  });

  it('survives a round trip through a real URL fragment', () => {
    // lz-string emits `+` and `$`. Both are legal in a fragment and come back
    // verbatim from `location.hash`; `+` would be mangled in a *query* string,
    // which is why the graph lives in the fragment and never in a parameter.
    const hash = encodeToHash(kitchenSink);
    expect(hash).toMatch(/^[A-Za-z0-9+\-$]+$/);
    const url = new URL(`https://example.test/app#${hash}`);
    expect(url.hash.slice(1)).toBe(hash);
    expect(decodeFromHash(url.hash)).toEqual(kitchenSink);
  });

  it('compresses well enough for a shareable link', () => {
    const raw = serializeDocument(kitchenSink).length;
    const hash = encodeToHash(kitchenSink).length;
    expect(hash).toBeLessThan(raw);
  });

  it('rejects a truncated link with a message the user can act on', () => {
    const hash = encodeToHash(kitchenSink);
    expect(() => decodeFromHash(hash.slice(0, 20))).toThrow(GraphParseError);
    expect(() => decodeFromHash('')).toThrow(/damaged|not a Factory Graph/);
  });

  it('survives a hundred-node graph', () => {
    const nodes: GraphNode[] = Array.from({ length: 100 }, (_unused, i) => ({
      id: `r${i}`,
      kind: 'recipe',
      recipeId: 'electronic-circuit',
      machineId: 'assembling-machine-3',
      modules: ['productivity-module-3', '', '', ''],
      beacons: null,
      constraint: { type: 'free' },
    }));
    const big = doc(nodes);
    const hash = encodeToHash(big);
    expect(decodeFromHash(hash)).toEqual(big);
    // Comfortably inside what browsers accept in a fragment.
    expect(hash.length).toBeLessThan(8000);
  });
});
