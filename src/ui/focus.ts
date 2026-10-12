import { create } from 'zustand';

/**
 * A one-shot request for the inspector to put the cursor in a node's number
 * field. Adding a sink sets it, so the very next keys typed are its rate.
 * Pointer-and-panel state, kept out of the graph store like `connecting.ts`.
 */
interface FocusState {
  nodeId: string | null;
  request(nodeId: string): void;
  clear(): void;
}

export const useFocusRequest = create<FocusState>()((set) => ({
  nodeId: null,
  request: (nodeId) => set({ nodeId }),
  clear: () => set({ nodeId: null }),
}));
