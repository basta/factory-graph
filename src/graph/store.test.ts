import { beforeEach, describe, expect, it } from 'vitest';
import { testGameData } from '../solver/fixtures.ts';
import {
  makeNoteNode,
  makeRecipeNode,
  makeSinkNode,
  makeSourceNode,
  PARKED_HISTORY_LIMIT,
  useGraphStore,
} from './store.ts';
import type { GraphDocument } from './serialize.ts';
import { emptyGraph } from './types.ts';

const index = testGameData();

function reset(): void {
  useGraphStore
    .getState()
    .load({ graph: emptyGraph('2x1'), projectName: 'Untitled factory' });
}

const state = () => useGraphStore.getState();

/** Adds a circuit node and returns its id. */
function addCircuit(x = 0, y = 0): string {
  const node = makeRecipeNode(index, 'electronic-circuit');
  if (!node) throw new Error('electronic-circuit has no producer');
  state().addNode(node, { x, y });
  return node.id;
}

beforeEach(reset);

describe('node editing', () => {
  it('adds a recipe node with the ranked machine and empty module slots', () => {
    const id = addCircuit();
    const node = state().graph.nodes.find((candidate) => candidate.id === id);
    expect(node?.kind).toBe('recipe');
    if (node?.kind !== 'recipe') throw new Error('unreachable');
    expect(index.recipes.get('electronic-circuit')!.producers).toContain(node.machineId);
    expect(node.modules).toHaveLength(index.machines.get(node.machineId)!.moduleSlots);
    expect(node.modules.every((slot) => slot === '')).toBe(true);
    expect(node.constraint).toEqual({ type: 'free' });
  });

  it('removes a node together with its edges and position', () => {
    const a = addCircuit(0, 0);
    const b = addCircuit(400, 0);
    state().addEdge({
      from: a,
      fromPort: 'electronic-circuit',
      to: b,
      toPort: 'electronic-circuit',
      transport: null,
    });
    expect(state().graph.edges).toHaveLength(1);

    state().removeNodes([a]);
    expect(state().graph.nodes.map((node) => node.id)).toEqual([b]);
    expect(state().graph.edges).toHaveLength(0);
    expect(state().graph.positions[a]).toBeUndefined();
  });

  it('refuses a duplicate edge but allows a self-loop', () => {
    const kovarex = makeRecipeNode(index, 'kovarex-enrichment-process')!;
    state().addNode(kovarex, { x: 0, y: 0 });
    const loop = {
      from: kovarex.id,
      fromPort: 'uranium-235',
      to: kovarex.id,
      toPort: 'uranium-235',
      transport: null,
    };
    expect(state().addEdge(loop)).not.toBeNull();
    expect(state().addEdge(loop)).toBeNull();
    expect(state().graph.edges).toHaveLength(1);
  });

  it('copies a sub-chain, including the edges inside it', () => {
    const a = addCircuit(0, 0);
    const b = addCircuit(400, 0);
    state().addEdge({
      from: a,
      fromPort: 'electronic-circuit',
      to: b,
      toPort: 'electronic-circuit',
      transport: null,
    });

    const copies = state().duplicateNodes([a, b]);
    expect(copies).toHaveLength(2);
    expect(state().graph.nodes).toHaveLength(4);
    // The copied edge joins the copies, not the originals.
    expect(state().graph.edges).toHaveLength(2);
    const copied = state().graph.edges.find((edge) => copies.includes(edge.from));
    expect(copies).toContain(copied?.to);
    // Copies are offset so they are visibly separate.
    expect(state().graph.positions[copies[0]!]).not.toEqual(state().graph.positions[a]);
  });

  it('splits a node into blocks and puts it back as one, as one undo step each', () => {
    const id = addCircuit();
    const node = () => state().graph.nodes.find((candidate) => candidate.id === id);

    state().setBlocks(id, { type: 'fit' });
    expect(node()).toMatchObject({ blocks: { type: 'fit' } });

    state().setBlocks(id, null);
    // Gone, not `undefined`: a node set back to one block saves as it did
    // before blocks existed.
    expect(Object.keys(node()!)).not.toContain('blocks');

    state().undo();
    expect(node()).toMatchObject({ blocks: { type: 'fit' } });
  });

  it('ignores a rate constraint on a recipe node and vice versa', () => {
    const id = addCircuit();
    state().setConstraint(id, { type: 'rate', perSec: 5 });
    const node = state().graph.nodes.find((candidate) => candidate.id === id);
    expect(node?.kind === 'recipe' && node.constraint).toEqual({ type: 'free' });

    const source = makeSourceNode('iron-plate');
    state().addNode(source, { x: 0, y: 0 });
    state().setConstraint(source.id, { type: 'machines', count: 3 });
    const kept = state().graph.nodes.find((candidate) => candidate.id === source.id);
    expect(kept?.kind === 'source' && kept.constraint).toEqual({ type: 'free' });
  });
});

describe('undo and redo', () => {
  it('reverses adding a node', () => {
    const id = addCircuit();
    expect(state().graph.nodes).toHaveLength(1);
    state().undo();
    expect(state().graph.nodes).toHaveLength(0);
    state().redo();
    expect(state().graph.nodes.map((node) => node.id)).toEqual([id]);
  });

  it('reverses a machine change without touching anything else', () => {
    const id = addCircuit();
    const before = state().graph.nodes[0];
    state().updateRecipeNode(id, { machineId: 'assembling-machine-1' });
    expect(state().graph.nodes[0]).not.toEqual(before);
    state().undo();
    expect(state().graph.nodes[0]).toEqual(before);
  });

  it('reverses a delete, edges and all', () => {
    const a = addCircuit(0, 0);
    const b = addCircuit(400, 0);
    state().addEdge({
      from: a,
      fromPort: 'electronic-circuit',
      to: b,
      toPort: 'electronic-circuit',
      transport: null,
    });
    state().removeNodes([a, b]);
    expect(state().graph.nodes).toHaveLength(0);
    state().undo();
    expect(state().graph.nodes).toHaveLength(2);
    expect(state().graph.edges).toHaveLength(1);
  });

  it('treats a drag as one step, not one per pointer move', () => {
    const id = addCircuit(0, 0);
    state().beginBatch();
    state().moveNodes({ [id]: { x: 10, y: 0 } }, false);
    state().moveNodes({ [id]: { x: 20, y: 0 } }, true);
    state().moveNodes({ [id]: { x: 30, y: 0 } }, true);
    state().endBatch();
    expect(state().graph.positions[id]).toEqual({ x: 30, y: 0 });

    state().undo();
    // One undo returns to where the drag started, not to an intermediate frame.
    expect(state().graph.positions[id]).toEqual({ x: 0, y: 0 });
  });

  it('treats a multi-node edit as one step', () => {
    const a = addCircuit(0, 0);
    const b = addCircuit(400, 0);
    state().beginBatch();
    state().updateRecipeNode(a, { machineId: 'assembling-machine-1' });
    state().updateRecipeNode(b, { machineId: 'assembling-machine-1' });
    state().endBatch();

    state().undo();
    const machines = state().graph.nodes.map((node) =>
      node.kind === 'recipe' ? node.machineId : '',
    );
    expect(machines.every((machine) => machine !== 'assembling-machine-1')).toBe(true);
  });

  it('undoes layout and semantics through the same stack', () => {
    const id = addCircuit(0, 0);
    state().moveNodes({ [id]: { x: 99, y: 99 } }, false);
    state().setConstraint(id, { type: 'machines', count: 4 });

    state().undo();
    const node = state().graph.nodes[0];
    expect(node?.kind === 'recipe' && node.constraint).toEqual({ type: 'free' });
    expect(state().graph.positions[id]).toEqual({ x: 99, y: 99 });

    state().undo();
    expect(state().graph.positions[id]).toEqual({ x: 0, y: 0 });
  });

  it('drops the redo branch once you edit again', () => {
    addCircuit(0, 0);
    addCircuit(400, 0);
    state().undo();
    expect(state().history.future).toHaveLength(1);
    addCircuit(800, 0);
    expect(state().history.future).toHaveLength(0);
  });

  it('does nothing when there is nothing to undo', () => {
    const before = state().graph;
    state().undo();
    state().redo();
    expect(state().graph).toBe(before);
  });

  it('keeps 100 steps and no more', () => {
    for (let i = 0; i < 120; i += 1) addCircuit(i * 10, 0);
    expect(state().history.past).toHaveLength(100);
    for (let i = 0; i < 100; i += 1) state().undo();
    // 120 added, 100 undone: the first 20 are past the end of the stack.
    expect(state().graph.nodes).toHaveLength(20);
    expect(state().history.past).toHaveLength(0);
  });

  it('does not record a position write that changes nothing', () => {
    const id = addCircuit(0, 0);
    const depth = state().history.past.length;
    state().moveNodes({ [id]: { x: 0, y: 0 } }, false);
    expect(state().history.past).toHaveLength(depth);
  });

  it('restores the project name too', () => {
    state().setProjectName('Blue circuits');
    expect(state().projectName).toBe('Blue circuits');
    state().undo();
    expect(state().projectName).toBe('Untitled factory');
  });

  it('clears history on load, so an import cannot be undone into', () => {
    addCircuit();
    expect(state().history.past.length).toBeGreaterThan(0);
    state().load({ graph: emptyGraph('2x1'), projectName: 'Imported' });
    expect(state().history.past).toHaveLength(0);
    expect(state().history.future).toHaveLength(0);
  });
});

describe('node constructors', () => {
  it('builds sources, sinks and notes free of constraints', () => {
    expect(makeSourceNode('iron-plate')).toMatchObject({
      kind: 'source',
      itemId: 'iron-plate',
      constraint: { type: 'free' },
    });
    expect(makeSinkNode('iron-plate')).toMatchObject({ kind: 'sink', itemId: 'iron-plate' });
    expect(makeNoteNode('hello')).toMatchObject({ kind: 'note', text: 'hello' });
  });

  it('returns null for a recipe nothing can make', () => {
    // `spoilage` has no producers in the data set.
    expect(makeRecipeNode(index, 'spoilage')).toBeNull();
    expect(makeRecipeNode(index, 'not-a-recipe')).toBeNull();
  });

  it('gives every node a distinct id', () => {
    const ids = new Set(Array.from({ length: 500 }, () => makeSourceNode('iron-plate').id));
    expect(ids.size).toBe(500);
  });
});

describe('switching plans', () => {
  const plan = (projectName: string, text: string): GraphDocument => {
    const graph = emptyGraph('2x1');
    graph.nodes.push({ id: `n-${text}`, kind: 'note', text });
    return { graph, projectName };
  };

  it('puts the target document on the canvas', () => {
    state().openPlan('a', plan('Red science', 'red'));
    expect(state().activeId).toBe('a');
    expect(state().projectName).toBe('Red science');

    state().openPlan('b', plan('Blue science', 'blue'));
    expect(state().activeId).toBe('b');
    expect(state().graph.nodes[0]).toMatchObject({ text: 'blue' });
  });

  it('keeps each plan its own undo stack across a round trip', () => {
    state().openPlan('a', plan('A', 'a'));
    state().setNoteText('n-a', 'a edited');
    expect(state().canUndo()).toBe(true);

    // A plan that has never been edited starts with nothing to undo.
    state().openPlan('b', plan('B', 'b'));
    expect(state().canUndo()).toBe(false);

    // Coming back restores the stack rather than starting over.
    state().openPlan('a', plan('A', 'a edited'));
    expect(state().canUndo()).toBe(true);
    state().undo();
    expect(state().graph.nodes[0]).toMatchObject({ text: 'a' });
  });

  it('does not undo across a switch', () => {
    state().openPlan('a', plan('A', 'a'));
    state().setNoteText('n-a', 'a edited');
    state().openPlan('b', plan('B', 'b'));

    state().undo();
    // B has no history, so the undo is a no-op — it must not reach into A.
    expect(state().activeId).toBe('b');
    expect(state().projectName).toBe('B');
    expect(state().graph.nodes[0]).toMatchObject({ text: 'b' });
  });

  it('ignores a re-open of the plan already on the canvas', () => {
    state().openPlan('a', plan('A', 'a'));
    state().setNoteText('n-a', 'a edited');
    state().openPlan('a', plan('A', 'something else'));

    expect(state().canUndo()).toBe(true);
    expect(state().graph.nodes[0]).toMatchObject({ text: 'a edited' });
  });

  it('drops the oldest parked stack past the limit', () => {
    const visit = (id: string): void => {
      state().openPlan(id, plan(id, id));
      state().setNoteText(`n-${id}`, `${id} edited`);
    };

    visit('first');
    for (let i = 0; i < PARKED_HISTORY_LIMIT; i += 1) visit(`filler${i}`);

    // 'first' was parked before the limit's worth of plans that followed it.
    state().openPlan('first', plan('first', 'first edited'));
    expect(state().canUndo()).toBe(false);
  });

  it('forgets a deleted plan stack', () => {
    state().openPlan('a', plan('A', 'a'));
    state().setNoteText('n-a', 'a edited');
    state().openPlan('b', plan('B', 'b'));

    state().forgetPlan('a');
    state().openPlan('a', plan('A', 'a edited'));
    expect(state().canUndo()).toBe(false);
  });

  it('holds the plan list for the switcher', () => {
    state().setPlans([{ id: 'a', name: 'A', updatedAt: 1 }]);
    expect(state().plans.map((p) => p.name)).toEqual(['A']);
  });
});
