/**
 * One shortcut row. `keys` are drawn as key caps; `then` is the plain-language
 * part of a gesture ("Space" + "drag"), so prose never ends up in a key cap.
 */
export interface Shortcut {
  keys: string[];
  then?: string;
  description: string;
}

/** The overlay and the key handler both read this, so they cannot drift. */
export const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: 'Build',
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
  {
    group: 'Project',
    items: [
      { keys: ['Ctrl', 'P'], description: 'Open the plan list' },
      { keys: ['Ctrl', 'S'], description: 'Copy share link' },
      { keys: ['Ctrl', 'E'], description: 'Export JSON' },
      { keys: ['Ctrl', 'I'], description: 'Import JSON' },
      { keys: ['?'], description: 'This list' },
    ],
  },
];
