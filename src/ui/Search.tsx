import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameData } from '../data/context.ts';
import { preferredMachine, settingsOf } from '../graph/settings.ts';
import { useGraphStore } from '../graph/store.ts';
import { recipeOrder } from '../data/recipes.ts';
import { Sprite } from './Sprite.tsx';
import { rank } from './fuzzy.ts';
import styles from './Search.module.css';

/**
 * What the palette is being opened for. `filter` narrows the recipe list to
 * the ones that can continue a dragged edge, which is what makes chain
 * building fast: drag out of a port, type two letters, press Enter.
 */
export type SearchIntent =
  | { kind: 'anything' }
  | { kind: 'consumes'; itemId: string }
  | { kind: 'produces'; itemId: string }
  /** Picking an item for the plan's bus rather than adding a node. */
  | { kind: 'bus' };

export type SearchChoice =
  | { kind: 'recipe'; recipeId: string }
  | { kind: 'source'; itemId: string }
  | { kind: 'sink'; itemId: string }
  | { kind: 'note' }
  | { kind: 'bus'; itemId: string };

interface Props {
  open: boolean;
  intent: SearchIntent;
  onClose: () => void;
  onChoose: (choice: SearchChoice) => void;
}

interface Row {
  choice: SearchChoice;
  name: string;
  id: string;
  /** Right-hand column: producing machine, or what the source/sink does. */
  detail: string;
  /** Null for the note row, which has no game sprite. */
  icon: { x: number; y: number; color: string | null; text: string | null } | null;
}

const LIMIT = 40;

export function Search({ open, intent, onClose, onChoose }: Props): JSX.Element | null {
  const index = useGameData();
  const settings = useGraphStore((state) => settingsOf(state.graph));
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reopening should always start from a clean slate.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setQuery('');
      setActive(0);
    }
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const candidates = useMemo<Row[]>(() => {
    if (!open) return [];
    if (intent.kind === 'bus') {
      return index.data.items
        .filter((item) => item.category !== 'technology')
        .map((item) => ({
          choice: { kind: 'bus', itemId: item.id },
          name: item.name,
          id: item.id,
          detail: 'to the bus',
          icon: item.icon,
        }));
    }
    const recipeIds =
      intent.kind === 'anything'
        ? null
        : new Set(
            (intent.kind === 'consumes'
              ? index.consumersOf.get(intent.itemId)
              : index.producersOf.get(intent.itemId)) ?? [],
          );

    const rows: Row[] = [];
    let recipes = index.data.recipes.filter(
      (recipe) => (!recipeIds || recipeIds.has(recipe.id)) && recipe.producers.length > 0,
    );
    // Continuing a connection: the standard recipe first, recycling and
    // barrels last, so Enter on an empty query picks what you meant. Sort is
    // stable, so the data set's order still breaks ties.
    if (intent.kind === 'consumes' || intent.kind === 'produces') {
      const order = recipeOrder(index, intent.itemId);
      recipes = [...recipes].sort((a, b) => order(a) - order(b));
    }
    for (const recipe of recipes) {
      // The machine the node will actually get, which is the plan's pick.
      const machineId = preferredMachine(index, recipe, settings);
      rows.push({
        choice: { kind: 'recipe', recipeId: recipe.id },
        name: recipe.name,
        id: recipe.id,
        detail: (machineId && index.machines.get(machineId)?.name) ?? '',
        icon: recipe.icon,
      });
    }

    // Sources and sinks are offered for every item, at the end of the list, so
    // "iron plate" finds the recipe first and the two endpoints right after.
    for (const item of index.data.items) {
      if (item.category === 'technology') continue;
      if (intent.kind === 'consumes' || intent.kind === 'produces') {
        if (item.id !== intent.itemId) continue;
      }
      if (intent.kind !== 'produces') {
        rows.push({
          choice: { kind: 'sink', itemId: item.id },
          name: item.name,
          id: item.id,
          detail: 'as sink',
          icon: item.icon,
        });
      }
      if (intent.kind !== 'consumes') {
        rows.push({
          choice: { kind: 'source', itemId: item.id },
          name: item.name,
          id: item.id,
          detail: 'as source',
          icon: item.icon,
        });
      }
    }
    // A note is not a recipe, so it only shows in the unfiltered palette.
    if (intent.kind === 'anything') {
      rows.push({
        choice: { kind: 'note' },
        name: 'Note',
        id: 'note',
        detail: 'a label on the canvas',
        icon: null,
      });
    }
    return rows;
  }, [open, intent, index, settings]);

  const results = useMemo(
    () => rank(candidates, query, (row) => ({ name: row.name, id: row.id }), LIMIT),
    [candidates, query],
  );

  useEffect(() => {
    const node = listRef.current?.children[active];
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  // A sink takes the item in, so it only fits where nothing is waiting on an
  // output from it: the open palette, or continuing out of an output port.
  const sinkable = intent.kind === 'anything' || intent.kind === 'consumes';

  /** Shift Enter: whatever row is highlighted, add its item as a sink. */
  const commitAsSink = (indexToUse: number): void => {
    const itemId = itemOfChoice(results[indexToUse]?.item.choice, index);
    if (itemId) onChoose({ kind: 'sink', itemId });
  };

  const commit = (indexToUse: number): void => {
    const chosen = results[indexToUse];
    if (chosen) onChoose(chosen.item.choice);
  };

  return (
    <div className={styles.scrim} onPointerDown={onClose} role="presentation">
      <div
        className={styles.panel}
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add a node"
      >
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          placeholder={placeholderFor(intent, index.items.get(itemOf(intent) ?? '')?.name)}
          aria-label="Search recipes and items"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          aria-activedescendant={`search-row-${active}`}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => Math.min(current + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (event.shiftKey && sinkable) commitAsSink(active);
              else commit(active);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <div className={styles.results} id="search-results" role="listbox" ref={listRef}>
          {results.length === 0 ? (
            <p className={styles.none}>Nothing matches “{query}”. Try a shorter word.</p>
          ) : (
            results.map((entry, position) => (
              <button
                key={`${entry.item.choice.kind}-${entry.item.id}`}
                id={`search-row-${position}`}
                type="button"
                role="option"
                aria-selected={position === active}
                className={[styles.row, position === active ? styles.active : '']
                  .filter(Boolean)
                  .join(' ')}
                onPointerEnter={() => setActive(position)}
                onClick={(event) =>
                  event.shiftKey && sinkable ? commitAsSink(position) : commit(position)
                }
              >
                {entry.item.icon ? (
                  <Sprite icon={entry.item.icon} size={20} />
                ) : (
                  <span className={styles.noIcon} />
                )}
                <span className={styles.name}>
                  {highlight(entry.item.name, entry.positions)}
                </span>
                <span className={styles.detail}>{entry.item.detail}</span>
              </button>
            ))
          )}
        </div>
        {sinkable ? (
          <p className={styles.footer}>
            <kbd className={styles.kbd}>Shift</kbd> <kbd className={styles.kbd}>Enter</kbd> adds it
            as a sink
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The item a row stands for: a source or sink's item, or a recipe's main
 * product — the output named after the recipe, else its first.
 */
function itemOfChoice(
  choice: SearchChoice | undefined,
  index: ReturnType<typeof useGameData>,
): string | null {
  if (!choice || choice.kind === 'note') return null;
  if (choice.kind !== 'recipe') return choice.itemId;
  const recipe = index.recipes.get(choice.recipeId);
  if (!recipe) return null;
  return (recipe.outputs.find((out) => out.itemId === recipe.id) ?? recipe.outputs[0])?.itemId ?? null;
}

function itemOf(intent: SearchIntent): string | null {
  return intent.kind === 'consumes' || intent.kind === 'produces' ? intent.itemId : null;
}

function placeholderFor(intent: SearchIntent, itemName: string | undefined): string {
  const name = (itemName ?? 'this item').toLowerCase();
  if (intent.kind === 'consumes') return `Recipes that use ${name}`;
  if (intent.kind === 'produces') return `Recipes that make ${name}`;
  if (intent.kind === 'bus') return 'Item to treat as a bus input';
  return 'Search recipes and items';
}

/** Marks the characters the query matched, so the ranking is legible. */
function highlight(text: string, positions: number[]): JSX.Element[] {
  const hits = new Set(positions);
  const parts: JSX.Element[] = [];
  let buffer = '';
  let bufferHit = false;

  const flush = (key: number): void => {
    if (buffer === '') return;
    parts.push(
      bufferHit ? (
        <mark key={key} className={styles.hit}>
          {buffer}
        </mark>
      ) : (
        <span key={key}>{buffer}</span>
      ),
    );
    buffer = '';
  };

  for (let i = 0; i < text.length; i += 1) {
    const isHit = hits.has(i);
    if (isHit !== bufferHit) {
      flush(i);
      bufferHit = isHit;
    }
    buffer += text[i];
  }
  flush(text.length);
  return parts;
}
