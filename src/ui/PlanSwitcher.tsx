import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PlanMeta } from '../graph/library.ts';
import { rank } from './fuzzy.ts';
import { timeAgo } from './format.ts';
import { ChevronDownIcon, PlusIcon, TrashIcon } from './icons.tsx';
import styles from './PlanSwitcher.module.css';

interface Props {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  plans: PlanMeta[];
  activeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

/**
 * Past this many plans the list stops being scannable and a filter earns the
 * row it costs. Below it, typing would be slower than looking.
 */
const FILTER_THRESHOLD = 6;

/**
 * The project block in the header: the active plan's name, and the list of
 * every saved plan hanging under it.
 *
 * A dropdown rather than a tab strip: a permanent second bar would cost 28px
 * of canvas forever and stop working somewhere around the sixth plan, which is
 * exactly where a list starts being useful. See DESIGN.md on density.
 *
 * The name field lives here rather than in the header so that one element is
 * the positioning context for the panel, and the panel can hang under the
 * name it belongs to instead of under a stray caret.
 */
export function PlanSwitcher(props: Props): JSX.Element {
  const { projectName, onProjectNameChange } = props;
  const { plans, activeId, open, onOpenChange, onOpen, onNew, onDelete } = props;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState(projectName);
  const [lastName, setLastName] = useState(projectName);
  // Undo, import, share and a plan switch can all rename from outside this
  // field. Adjusting during render beats an effect: no second commit, no
  // flash of the stale name.
  if (lastName !== projectName) {
    setLastName(projectName);
    setDraft(projectName);
  }

  const commitName = (): void => {
    const next = draft.trim() || 'Untitled factory';
    setDraft(next);
    if (next !== projectName) onProjectNameChange(next);
  };

  const showFilter = plans.length > FILTER_THRESHOLD;

  // Every opening starts clean, and lands on the plan you are looking at, so
  // Enter without typing is a no-op rather than a surprise.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setQuery('');
      setActive(Math.max(0, plans.findIndex((plan) => plan.id === activeId)));
    }
  }

  const results = useMemo(
    () => rank(plans, query, (plan) => ({ name: plan.name, id: plan.id }), 200),
    [plans, query],
  );

  useEffect(() => {
    if (!open) return;
    // Focus the panel rather than the first row: the arrow keys move a
    // highlight, and moving real focus with them would draw a focus ring on
    // every row in turn, clipped by the list's own scroll box.
    if (showFilter) inputRef.current?.focus();
    else panelRef.current?.focus();
  }, [open, showFilter]);

  // Clicking anywhere else closes it. Pointerdown rather than click, so the
  // list is gone by the time the thing underneath reacts.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    const node = listRef.current?.children[active];
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (id: string): void => {
    onOpen(id);
    onOpenChange(false);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[active];
      if (chosen) choose(chosen.item.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <input
        ref={nameRef}
        className={styles.name}
        value={draft}
        aria-label="Project name"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') nameRef.current?.blur();
          if (event.key === 'Escape') {
            setDraft(projectName);
            nameRef.current?.blur();
          }
        }}
      />
      <button
        type="button"
        className={styles.toggle}
        title="Saved plans (Ctrl P)"
        aria-label="Saved plans"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => onOpenChange(!open)}
      >
        <ChevronDownIcon />
      </button>

      {open ? (
        <div
          ref={panelRef}
          className={styles.panel}
          role="menu"
          aria-label="Saved plans"
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {showFilter ? (
            <input
              ref={inputRef}
              className={styles.filter}
              value={query}
              placeholder="Filter plans"
              aria-label="Filter plans"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
            />
          ) : null}

          <div className={styles.list} ref={listRef}>
            {results.length === 0 ? (
              <p className={styles.none}>Nothing matches “{query}”.</p>
            ) : (
              results.map((entry, position) => {
                const plan = entry.item;
                const isActive = plan.id === activeId;
                return (
                  <div
                    key={plan.id}
                    className={[
                      styles.row,
                      position === active ? styles.highlighted : '',
                      isActive ? styles.current : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onPointerEnter={() => setActive(position)}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.openButton}
                      aria-current={isActive}
                      onClick={() => choose(plan.id)}
                    >
                      <span className={styles.planName}>{plan.name}</span>
                      <span className={styles.when}>{timeAgo(plan.updatedAt)}</span>
                    </button>
                    <button
                      type="button"
                      className={styles.delete}
                      title={`Delete ${plan.name}`}
                      aria-label={`Delete ${plan.name}`}
                      onClick={() => onDelete(plan.id)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <button
            type="button"
            role="menuitem"
            className={styles.new}
            onClick={() => {
              onNew();
              onOpenChange(false);
            }}
          >
            <PlusIcon />
            New plan
          </button>
        </div>
      ) : null}
    </div>
  );
}
