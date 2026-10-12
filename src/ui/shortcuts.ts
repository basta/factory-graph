/**
 * One shortcut row. `keys` are drawn as key caps; `then` is the plain-language
 * part of a gesture ("Space" + "drag"), so prose never ends up in a key cap.
 */
export interface Shortcut {
  keys: string[];
  then?: string;
  description: string;
}

export interface ShortcutGroup {
  group: string;
  items: Shortcut[];
}

const PROJECT: ShortcutGroup = {
  group: 'Project',
  items: [
    { keys: ['Ctrl', 'P'], description: 'Open the plan list' },
    { keys: ['Ctrl', 'S'], description: 'Copy share link' },
    { keys: ['Ctrl', 'E'], description: 'Export JSON' },
    { keys: ['Ctrl', 'I'], description: 'Import JSON' },
    { keys: ['?'], description: 'This list' },
  ],
};

/** The overlay and the key handler both read this, so they cannot drift. */
export const SHORTCUTS: ShortcutGroup[] = [
  {
    group: 'Graph',
    items: [
      { keys: ['Ctrl', 'K'], description: 'Add a recipe, item source or sink' },
      { keys: [], then: 'Double-click the canvas', description: 'Add a node where you clicked' },
      { keys: [], then: 'Drag from a port', description: 'Connect, or search for the next step' },
      { keys: ['Ctrl', 'K'], then: 'then "note"', description: 'Add a note to the canvas' },
      { keys: ['Ctrl', 'D'], description: 'Duplicate selection' },
      { keys: ['Delete'], description: 'Delete selection' },
    ],
  },
  {
    group: 'Edit',
    items: [
      { keys: ['Ctrl', 'Z'], description: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], description: 'Redo' },
      { keys: ['Ctrl', 'A'], description: 'Select all' },
      { keys: ['Esc'], description: 'Close panel or clear selection' },
      { keys: ['F'], description: 'Toggle fixed machine count on selection' },
    ],
  },
  {
    group: 'Canvas',
    items: [
      { keys: ['Space'], then: 'drag', description: 'Pan' },
      { keys: [], then: 'Middle-drag', description: 'Pan' },
      { keys: [], then: 'Scroll', description: 'Zoom to cursor' },
      { keys: [], then: 'Drag the canvas', description: 'Box select' },
      { keys: ['Shift'], then: 'click', description: 'Add to the selection' },
      { keys: [], then: 'Double-click an edge', description: 'Delete that connection' },
      { keys: ['Ctrl', '0'], description: 'Fit graph to screen' },
      { keys: ['Ctrl', 'L'], description: 'Auto-layout' },
    ],
  },
  PROJECT,
];

/** The build view's keys, which follow the game's where the game has one. */
export const BUILD_SHORTCUTS: ShortcutGroup[] = [
  {
    group: 'Tools',
    items: [
      { keys: ['1'], then: 'to 8', description: 'Pick a tool, in toolbar order' },
      { keys: ['R'], description: 'Rotate what you are placing, or the entity under the pointer' },
      { keys: ['Shift', 'R'], description: 'Rotate the other way' },
      { keys: ['Q'], description: 'Pick up the tool for the entity under the pointer' },
      { keys: ['Esc'], description: 'Back to select, then clear the selection' },
    ],
  },
  {
    group: 'Edit',
    items: [
      { keys: [], then: 'Drag a belt', description: 'Lay a line that follows the pointer' },
      { keys: [], then: 'Right-click', description: 'Remove; drag to remove several' },
      { keys: [], then: 'Drag on empty grid', description: 'Box select' },
      { keys: ['Ctrl', 'C'], description: 'Copy the selection as a stamp' },
      { keys: ['Ctrl', 'X'], description: 'Cut' },
      { keys: ['Ctrl', 'V'], description: 'Place the stamp' },
      { keys: ['Delete'], description: 'Delete selection' },
      { keys: ['Ctrl', 'Z'], description: 'Undo' },
    ],
  },
  {
    group: 'Simulation',
    items: [
      { keys: ['P'], description: 'Play or pause' },
      { keys: ['.'], description: 'Step one tick' },
      { keys: [], then: 'Scroll', description: 'Zoom to cursor' },
      { keys: ['Space'], then: 'drag', description: 'Pan' },
      { keys: [], then: 'Middle-drag', description: 'Pan' },
    ],
  },
  PROJECT,
];
