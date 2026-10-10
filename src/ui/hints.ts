import { create } from 'zustand';
import { CHANNEL, storagePrefix } from '../graph/channel.ts';

/**
 * Whether the key hints along the bottom of the canvas are shown. On until
 * hidden, and remembered per browser: someone who knows the keys should only
 * have to say so once.
 */
const KEY = `${storagePrefix(CHANNEL)}hints`;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

interface HintsState {
  visible: boolean;
  setVisible(visible: boolean): void;
}

export const useHints = create<HintsState>()((set) => ({
  visible: read(),
  setVisible: (visible) => {
    try {
      localStorage.setItem(KEY, visible ? 'on' : 'off');
    } catch {
      // Not remembering is harmless; it still applies for this visit.
    }
    set({ visible });
  },
}));
