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
      {
        keys: ['Shift', 'Enter'],
        then: 'in the search',
        description: 'Add the item as a sink, ready for its rate',
      },
      { keys: [], then: 'Double-click the canvas', description: 'Add a node where you clicked' },
      { keys: [], then: 'Drag from a port', description: 'Connect, or search for the next step' },
      { keys: ['E'], description: 'Expand: build a producer for every open input' },
      { keys: ['B'], description: 'Lay the selected recipe out in the build view, to test it' },
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
      { keys: ['1'], then: 'to 4', description: 'Belt tier on selected connections' },
      { keys: ['0'], description: 'Take the belt off selected connections' },
      { keys: ['1'], then: 'to 3', description: 'Machine tier on selected nodes' },
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
      { keys: ['2'], then: 'again', description: 'Belt, underground, splitter' },
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

/**
 * The few keys that matter for what is selected right now, shown along the
 * bottom of the canvas. The full list behind `?` is for looking things up;
 * this is for learning them, one at the moment it would have saved a click.
 */
export interface Hint {
  /** Drawn as key caps; several caps are alternatives or a chord, as labelled. */
  keys: string[];
  /** A gesture with no key, such as "Double-click the count". */
  then?: string;
  label: string;
}

export type HintContext = 'empty' | 'canvas' | 'recipe' | 'sink' | 'source' | 'edge' | 'note';

export const HINTS: Record<HintContext, Hint[]> = {
  empty: [
    { keys: ['Ctrl', 'K'], label: 'add a recipe or sink' },
    { keys: ['Shift', 'Enter'], label: 'in the search adds a sink' },
    { keys: ['?'], label: 'all shortcuts' },
  ],
  canvas: [
    { keys: ['Ctrl', 'K'], label: 'add' },
    { keys: [], then: 'Drag from a port', label: 'to build the next step' },
    { keys: ['Ctrl', 'L'], label: 'tidy up' },
    { keys: ['?'], label: 'all shortcuts' },
  ],
  // Double-clicking a count to type it is in the count's own tooltip: a strip
  // that clips is worse than one that leaves something out.
  recipe: [
    { keys: ['E'], label: 'build inputs' },
    { keys: ['F'], label: 'fix count' },
    { keys: ['1', '2', '3'], label: 'machine tier' },
    { keys: ['Ctrl', 'D'], label: 'duplicate' },
  ],
  sink: [
    { keys: ['E'], label: 'build what makes it' },
    { keys: ['F'], label: 'fix rate' },
    { keys: [], then: 'Double-click the rate', label: 'to type it' },
  ],
  source: [
    { keys: ['F'], label: 'fix rate' },
    { keys: [], then: 'Double-click the rate', label: 'to type it' },
  ],
  edge: [
    { keys: ['1', '2', '3', '4'], label: 'belt tier' },
    { keys: ['0'], label: 'no belt' },
    { keys: ['Delete'], label: 'remove' },
  ],
  note: [{ keys: ['Delete'], label: 'remove' }],
};

/** Which hints fit: the most capable kind of node selected wins. */
export function hintContext(
  selectedKinds: readonly string[],
  selectedEdges: number,
  graphIsEmpty: boolean,
): HintContext {
  for (const kind of ['recipe', 'sink', 'source', 'note'] as const) {
    if (selectedKinds.includes(kind)) return kind;
  }
  if (selectedEdges > 0) return 'edge';
  return graphIsEmpty ? 'empty' : 'canvas';
}
