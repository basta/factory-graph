import { create } from 'zustand';
import type { PortSide } from '../graph/types.ts';

/**
 * The in-flight connection drag, so every handle can show whether it would
 * accept the item. Kept out of the graph store: it is pointer state, not
 * document state, and must never reach the undo stack.
 */
interface ConnectingState {
  nodeId: string | null;
  itemId: string | null;
  side: PortSide | null;
  start(nodeId: string, itemId: string, side: PortSide): void;
  clear(): void;
}

export const useConnecting = create<ConnectingState>()((set) => ({
  nodeId: null,
  itemId: null,
  side: null,
  start: (nodeId, itemId, side) => set({ nodeId, itemId, side }),
  clear: () => set({ nodeId: null, itemId: null, side: null }),
}));
