import { useRef, useState } from 'react';
import { useGameData } from '../data/context.ts';
import type { SolveResult } from '../solver/types.ts';
import { IconButton } from './Button.tsx';
import { Sprite } from './Sprite.tsx';
import { pollution, power, rate } from './format.ts';
import {
  ExportIcon,
  HelpIcon,
  ImportIcon,
  LayoutIcon,
  PollutionIcon,
  PowerIcon,
  RedoIcon,
  ShareIcon,
  UndoIcon,
} from './icons.tsx';
import styles from './Header.module.css';

interface Props {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  result: SolveResult | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onLayout: () => void;
  onShare: () => void;
  onExport: () => void;
  onImport: () => void;
  onHelp: () => void;
}

/** How many raw inputs fit before the strip stops listing them. */
const MAX_INPUTS = 6;

export function Header(props: Props): JSX.Element {
  const { data, items } = useGameData();
  const [draft, setDraft] = useState(props.projectName);
  const [lastName, setLastName] = useState(props.projectName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Undo, import and share can rename the project from outside this field.
  // Adjusting during render beats an effect: no second commit, no flash of the
  // stale name.
  if (lastName !== props.projectName) {
    setLastName(props.projectName);
    setDraft(props.projectName);
  }

  const result = props.result;
  const inputs = Object.entries(result?.totals.rawInputs ?? {})
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_INPUTS);

  const commitName = (): void => {
    const next = draft.trim() || 'Untitled factory';
    setDraft(next);
    if (next !== props.projectName) props.onProjectNameChange(next);
  };

  return (
    <header className={styles.header}>
      <input
        ref={inputRef}
        className={styles.name}
        value={draft}
        aria-label="Project name"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') inputRef.current?.blur();
          if (event.key === 'Escape') {
            setDraft(props.projectName);
            inputRef.current?.blur();
          }
        }}
      />
      <span className={styles.dataSet}>{data.name}</span>

      <div className={styles.totals}>
        {result && result.status === 'ok' ? (
          <>
            <span className={styles.total} title="Total electricity">
              <PowerIcon className={styles.glyph} />
              <span className="mono">{power(result.totals.powerKw)}</span>
            </span>
            <span className={styles.total} title="Total pollution">
              <PollutionIcon className={styles.glyph} />
              <span className="mono">{pollution(result.totals.pollutionPerMin)}</span>
            </span>
            {inputs.length > 0 ? <span className={styles.divider} /> : null}
            {inputs.map(([itemId, value]) => {
              const item = items.get(itemId);
              if (!item) return null;
              return (
                <span className={styles.total} key={itemId} title={`${item.name} in`}>
                  <Sprite icon={item.icon} size={16} />
                  <span className="mono">{rate(value)}/s</span>
                </span>
              );
            })}
          </>
        ) : (
          <span className={styles.hint}>
            {result?.status === 'infeasible'
              ? 'No solution — check for conflicting fixed counts.'
              : 'Set a fixed rate or machine count to solve.'}
          </span>
        )}
      </div>

      <div className={styles.actions}>
        <div className={styles.group}>
          <IconButton label="Undo (Ctrl Z)" onClick={props.onUndo} disabled={!props.canUndo}>
            <UndoIcon />
          </IconButton>
          <IconButton label="Redo (Ctrl Shift Z)" onClick={props.onRedo} disabled={!props.canRedo}>
            <RedoIcon />
          </IconButton>
          <IconButton label="Auto-layout (Ctrl L)" onClick={props.onLayout}>
            <LayoutIcon />
          </IconButton>
        </div>
        <div className={styles.group}>
          <IconButton label="Copy link (Ctrl S)" onClick={props.onShare}>
            <ShareIcon />
          </IconButton>
          <IconButton label="Export JSON (Ctrl E)" onClick={props.onExport}>
            <ExportIcon />
          </IconButton>
          <IconButton label="Import JSON (Ctrl I)" onClick={props.onImport}>
            <ImportIcon />
          </IconButton>
        </div>
        <IconButton label="Keyboard shortcuts (?)" onClick={props.onHelp}>
          <HelpIcon />
        </IconButton>
      </div>
    </header>
  );
}
