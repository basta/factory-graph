import { useGameData } from '../data/context.ts';
import type { PlanMeta } from '../graph/library.ts';
import type { SolveResult } from '../solver/types.ts';
import { IconButton } from './Button.tsx';
import { PlanSwitcher } from './PlanSwitcher.tsx';
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
  WarnIcon,
} from './icons.tsx';
import styles from './Header.module.css';

interface Props {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  plans: PlanMeta[];
  activePlanId: string | null;
  plansOpen: boolean;
  onPlansOpenChange: (open: boolean) => void;
  onOpenPlan: (id: string) => void;
  onNewPlan: () => void;
  onDeletePlan: (id: string) => void;
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
/** Balance below this is solver rounding, not a real shortfall. */
const BALANCE_EPSILON = 1e-6;

export function Header(props: Props): JSX.Element {
  const { data, items } = useGameData();

  const result = props.result;
  // A graph with an unbalanced port has totals that do not add up, so say so
  // rather than letting the strip read like a valid bill of materials.
  const unbalanced = Object.values(result?.ports ?? {}).filter(
    (port) => port.connected && Math.abs(port.balance) > BALANCE_EPSILON,
  ).length;

  const inputs = Object.entries(result?.totals.rawInputs ?? {})
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_INPUTS);

  return (
    <header className={styles.header}>
      <PlanSwitcher
        projectName={props.projectName}
        onProjectNameChange={props.onProjectNameChange}
        plans={props.plans}
        activeId={props.activePlanId}
        open={props.plansOpen}
        onOpenChange={props.onPlansOpenChange}
        onOpen={props.onOpenPlan}
        onNew={props.onNewPlan}
        onDelete={props.onDeletePlan}
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
            {unbalanced > 0 ? (
              <>
                <span className={styles.divider} />
                <span
                  className={styles.warn}
                  title="Fixed machine counts disagree. Free a count, or change it, to make the chain balance."
                >
                  <WarnIcon />
                  {unbalanced === 1 ? '1 port unbalanced' : `${unbalanced} ports unbalanced`}
                </span>
              </>
            ) : null}
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
        ) : result?.status === 'infeasible' ? (
          <span className={styles.hint}>
            No solution. Free one of the fixed counts and try again.
          </span>
        ) : null}
      </div>

      <div className={styles.actions}>
        <div className={styles.group}>
          <IconButton label="Undo (Ctrl Z)" onClick={props.onUndo} disabled={!props.canUndo}>
            <UndoIcon />
          </IconButton>
          <IconButton label="Redo (Ctrl Shift Z)" onClick={props.onRedo} disabled={!props.canRedo}>
            <RedoIcon />
          </IconButton>
          <IconButton
            label="Auto-layout (Ctrl L)"
            onClick={props.onLayout}
            className={styles.wide}
          >
            <LayoutIcon />
          </IconButton>
        </div>
        <div className={styles.group}>
          <IconButton label="Copy link (Ctrl S)" onClick={props.onShare}>
            <ShareIcon />
          </IconButton>
          {/* File actions need a filesystem to be worth much; on a phone the
              share link is the useful one and these only crowd the bar. */}
          <IconButton
            label="Export JSON (Ctrl E)"
            onClick={props.onExport}
            className={styles.wide}
          >
            <ExportIcon />
          </IconButton>
          <IconButton
            label="Import JSON (Ctrl I)"
            onClick={props.onImport}
            className={styles.wide}
          >
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
