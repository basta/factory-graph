/**
 * Drives the built app through the interactions that cannot be unit-tested:
 * pointer drags between ports, the drop-on-empty-canvas search, the inspector,
 * and undo. Prints a pass/fail line per step and exits non-zero on failure.
 *
 *   npm run build && npm run smoke
 */
import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';

const PORT = 4319;
const URL = `http://localhost:${PORT}/`;

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

interface Snapshot {
  nodes: { id: string; kind: string }[];
  edges: { id: string; from: string; fromPort: string; to: string; toPort: string; transport: unknown }[];
  selection: string[];
  selectedEdges: string[];
  positions: Record<string, { x: number; y: number }>;
  undoDepth: number;
  plans: { id: string; name: string }[];
  activeId: string | null;
}

/** Reads the store through the debug hook the app exposes in every build. */
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as { __factoryGraph?: { getState: () => unknown } })
      .__factoryGraph;
    if (!store) throw new Error('__factoryGraph hook is missing');
    const state = store.getState() as Snapshot & {
      graph: {
        nodes: { id: string; kind: string }[];
        edges: Snapshot['edges'];
        positions: Snapshot['positions'];
      };
      history: { past: unknown[] };
    };
    return {
      nodes: state.graph.nodes.map((node) => ({ id: node.id, kind: node.kind })),
      edges: state.graph.edges.map((edge) => ({
        id: edge.id,
        from: edge.from,
        fromPort: edge.fromPort,
        to: edge.to,
        toPort: edge.toPort,
        transport: edge.transport,
      })),
      selection: state.selection,
      selectedEdges: state.selectedEdges,
      plans: state.plans.map((plan) => ({ id: plan.id, name: plan.name })),
      activeId: state.activeId,
      positions: state.graph.positions,
      undoDepth: state.history.past.length,
    };
  });
}

/** Centre of a port handle, in page coordinates. */
async function handleBox(
  page: Page,
  nodeId: string,
  side: 'source' | 'target',
  itemId: string,
): Promise<{ x: number; y: number }> {
  const selector = `.react-flow__node[data-id="${nodeId}"] .react-flow__handle-${side === 'source' ? 'right' : 'left'}[data-handleid="${itemId}"]`;
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no handle ${nodeId}/${itemId}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A CSS duration in milliseconds. Chrome reports the reduced-motion override
 * as `1e-06s`, so this has to parse rather than pattern-match.
 */
function millis(duration: string): number {
  const text = duration.trim();
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return text.endsWith('ms') ? value : value * 1000;
}

/** The inspector's first line is its title. */
const firstLine = (text: string): string => text.split(String.fromCharCode(10))[0]?.trim() ?? '';

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Several steps, so React Flow sees a drag rather than a click.
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function main(): Promise<void> {
  const preview = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore', shell: process.platform === 'win32' },
  );

  try {
    for (let i = 0; i < 200; i += 1) {
      try {
        if ((await fetch(URL)).ok) break;
      } catch {
        // still starting
      }
      await new Promise((done) => setTimeout(done, 150));
    }

    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // Ctrl S writes the share link to the clipboard.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    // Ctrl E saves a file; without this Playwright cancels the download.
    context.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await page.waitForTimeout(300);

    // --- add a node with Ctrl K ------------------------------------------
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(150);
    await page.keyboard.type('copper cable', { delay: 8 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    let state = await snapshot(page);
    check('Ctrl K adds a recipe node', state.nodes.length === 1, `${state.nodes.length} nodes`);
    check('the new node is selected', state.selection.length === 1);
    const cable = state.nodes[0]!.id;

    // --- inspector is open and shows the machine --------------------------
    const inspectorTitle = await page.locator('aside[aria-label="Node inspector"]').innerText();
    check('inspector opens on the new node', inspectorTitle.includes('Copper cable'), inspectorTitle.split('\n')[0]);

    // --- drag from the output port into empty canvas ----------------------
    const outputPort = await handleBox(page, cable, 'source', 'copper-cable');
    await drag(page, outputPort, { x: outputPort.x + 380, y: outputPort.y + 40 });
    await page.waitForTimeout(250);

    const searchVisible = await page.locator('input[aria-label="Search recipes and items"]').isVisible();
    check('dropping an edge on blank canvas opens the search', searchVisible);

    const placeholder = await page
      .locator('input[aria-label="Search recipes and items"]')
      .getAttribute('placeholder');
    check(
      'the search is pre-filtered to consumers',
      placeholder === 'Recipes that use copper cable',
      placeholder ?? 'no placeholder',
    );

    await page.keyboard.type('electronic circuit', { delay: 8 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);

    state = await snapshot(page);
    check('choosing a recipe places it', state.nodes.length === 2, `${state.nodes.length} nodes`);
    check(
      'and connects it to the port the drag started from',
      state.edges.length === 1 &&
        state.edges[0]!.from === cable &&
        state.edges[0]!.fromPort === 'copper-cable',
      JSON.stringify(state.edges),
    );
    const circuit = state.nodes.find((node) => node.id !== cable)!.id;

    // --- drag between two existing ports ----------------------------------
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(150);
    await page.keyboard.type('iron plate', { delay: 8 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);

    state = await snapshot(page);
    const plate = state.nodes.find((node) => node.id !== cable && node.id !== circuit)!.id;

    // Move it clear of the circuit node before dragging a wire.
    await page.locator(`.react-flow__node[data-id="${plate}"] div`).first().hover();
    const plateHeader = await page
      .locator(`.react-flow__node[data-id="${plate}"]`)
      .boundingBox();
    if (plateHeader) {
      await drag(
        page,
        { x: plateHeader.x + 120, y: plateHeader.y + 14 },
        { x: plateHeader.x + 120, y: plateHeader.y + 300 },
      );
    }

    const plateOut = await handleBox(page, plate, 'source', 'iron-plate');
    const circuitIn = await handleBox(page, circuit, 'target', 'iron-plate');
    await drag(page, plateOut, circuitIn);

    state = await snapshot(page);
    check(
      'dragging port to port connects them',
      state.edges.some((edge) => edge.from === plate && edge.to === circuit),
      JSON.stringify(state.edges),
    );

    // --- a mismatched port refuses -----------------------------------------
    const cableOut = await handleBox(page, cable, 'source', 'copper-cable');
    const plateIn = await handleBox(page, plate, 'target', 'iron-ore');
    const before = (await snapshot(page)).edges.length;
    await drag(page, cableOut, plateIn);
    state = await snapshot(page);
    check(
      'a mismatched port refuses the connection',
      state.edges.length === before,
      `${state.edges.length} edges`,
    );

    // --- clicking a node selects it ----------------------------------------
    await page.click('.react-flow__pane', { position: { x: 40, y: 500 } });
    await page.waitForTimeout(150);
    check('clicking blank canvas clears the selection', (await snapshot(page)).selection.length === 0);

    await page.click(`.react-flow__node[data-id="${plate}"]`, { position: { x: 120, y: 14 } });
    await page.waitForTimeout(200);
    state = await snapshot(page);
    check(
      'clicking a node selects it',
      state.selection.length === 1 && state.selection[0] === plate,
      JSON.stringify(state.selection),
    );
    const title = await page.locator('aside[aria-label="Node inspector"]').innerText();
    check('and the inspector follows the click', title.includes('Iron plate'), firstLine(title));

    // --- undo / redo --------------------------------------------------------
    const edgesBeforeUndo = (await snapshot(page)).edges.length;
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    state = await snapshot(page);
    check(
      'Ctrl Z reverses the last edge',
      state.edges.length === edgesBeforeUndo - 1,
      `${state.edges.length} edges`,
    );

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(150);
    state = await snapshot(page);
    check('Ctrl Shift Z puts it back', state.edges.length === edgesBeforeUndo);

    // --- duplicate ----------------------------------------------------------
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(120);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(200);
    state = await snapshot(page);
    check('Ctrl D duplicates the selection', state.nodes.length === 6, `${state.nodes.length} nodes`);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    state = await snapshot(page);
    check('and one undo removes all the copies', state.nodes.length === 3);

    // --- delete ------------------------------------------------------------
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(120);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    state = await snapshot(page);
    check('Delete clears the selection', state.nodes.length === 0);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    state = await snapshot(page);
    check('and undo brings the graph back', state.nodes.length === 3 && state.edges.length === 2);

    // --- persistence --------------------------------------------------------
    await page.reload();
    await page.waitForTimeout(500);
    state = await snapshot(page);
    check(
      'the graph survives a reload',
      state.nodes.length === 3 && state.edges.length === 2,
      `${state.nodes.length} nodes, ${state.edges.length} edges`,
    );

    // --- pin a node so there is a solve to measure against -------------------
    await page.click(`.react-flow__node[data-id="${circuit}"]`, { position: { x: 120, y: 14 } });
    await page.waitForTimeout(150);
    await page.keyboard.press('f');
    await page.waitForTimeout(250);
    const pinned = await page.locator('aside[aria-label="Node inspector"]').innerText();
    check('F pins the selected node', /Fixed/.test(pinned) && /Crafts\/s/.test(pinned));

    // --- edge selection and transport ---------------------------------------
    const edgeId = (await snapshot(page)).edges[0]!.id;
    await page.click(`.react-flow__edge[data-id="${edgeId}"] path:last-of-type`, { force: true });
    await page.waitForTimeout(200);
    state = await snapshot(page);
    check('clicking an edge selects it', state.selectedEdges.includes(edgeId), JSON.stringify(state.selectedEdges));

    const edgeTitle = await page.locator('aside[aria-label="Node inspector"]').innerText();
    check('the inspector shows the edge', edgeTitle.includes('Copper cable'), firstLine(edgeTitle));

    await page.click('button:has-text("Belt")');
    await page.waitForTimeout(200);
    state = await snapshot(page);
    const transport = state.edges.find((edge) => edge.id === edgeId)?.transport as
      | { kind?: string; lanes?: number }
      | null;
    check(
      'setting a belt records the transport',
      transport?.kind === 'belt' && transport.lanes === 2,
      JSON.stringify(transport),
    );

    const saturation = await page.locator('aside[aria-label="Node inspector"]').innerText();
    check('and the inspector reports saturation', /Saturation/.test(saturation));

    // --- auto-layout ---------------------------------------------------------
    const beforeLayout = await snapshot(page);
    await page.keyboard.press('Control+l');
    await page.waitForTimeout(800);
    state = await snapshot(page);
    const moved = Object.keys(beforeLayout.positions).filter(
      (id) =>
        beforeLayout.positions[id]!.x !== state.positions[id]!.x ||
        beforeLayout.positions[id]!.y !== state.positions[id]!.y,
    );
    check('Ctrl L rearranges the graph', moved.length > 0, `${moved.length} moved`);
    check(
      'and does it in one undo step',
      state.undoDepth === beforeLayout.undoDepth + 1,
      `${beforeLayout.undoDepth} -> ${state.undoDepth}`,
    );

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    state = await snapshot(page);
    check(
      'one undo restores every position',
      Object.keys(beforeLayout.positions).every(
        (id) =>
          state.positions[id]!.x === beforeLayout.positions[id]!.x &&
          state.positions[id]!.y === beforeLayout.positions[id]!.y,
      ),
    );

    // --- share ---------------------------------------------------------------
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(400);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check('Ctrl S copies a share link', copied.includes('#') && copied.length > 60, `${copied.length} chars`);
    const toastText = await page.locator('[role="status"]').innerText().catch(() => '');
    check('and says so', toastText.trim() === 'Link copied', toastText.trim());

    // The link alone must rebuild the graph.
    const beforeShare = await snapshot(page);
    await page.evaluate(() => localStorage.clear());
    // Via a blank page: navigating straight from `/` to `/#hash` only changes
    // the fragment, so the app would never reboot and this would pass without
    // the link being read at all.
    await page.goto('about:blank');
    await page.goto(copied);
    await page.waitForTimeout(700);
    state = await snapshot(page);
    check(
      'the link rebuilds the graph with no local storage',
      state.nodes.length === beforeShare.nodes.length &&
        state.edges.length === beforeShare.edges.length,
      `${state.nodes.length} nodes, ${state.edges.length} edges`,
    );

    // --- multi-select editing -----------------------------------------------
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);
    const multiTitle = await page.locator('aside[aria-label="Node inspector"]').innerText();
    check('selecting several nodes says how many', /3 nodes selected/.test(multiTitle), firstLine(multiTitle));

    // Every selected recipe node should take the machine change at once.
    const beforeMulti = await snapshot(page);
    await page.selectOption('aside[aria-label="Node inspector"] select[aria-label="Machine"]', {
      index: 0,
    });
    await page.waitForTimeout(300);
    state = await snapshot(page);
    check(
      'editing a shared field is one undo step for the whole selection',
      state.undoDepth === beforeMulti.undoDepth + 1,
      `${beforeMulti.undoDepth} -> ${state.undoDepth}`,
    );
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    // --- note nodes ----------------------------------------------------------
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(150);
    await page.keyboard.type('note', { delay: 8 });
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    state = await snapshot(page);
    check(
      'the palette can add a note',
      state.nodes.some((node) => node.kind === 'note'),
      state.nodes.map((node) => node.kind).join(','),
    );

    await page.fill('textarea[aria-label="Note text"]', 'Feeds the mall');
    await page.click('.react-flow__pane', { position: { x: 40, y: 500 } });
    await page.waitForTimeout(250);
    const noteText = await page.locator('textarea[aria-label="Note text"]').inputValue();
    check('and the note keeps what you typed', noteText === 'Feeds the mall', noteText);

    // Tidy up so the export check below sees the same graph it expects. The
    // pane click first, so focus leaves the textarea before Delete.
    await page.click('.react-flow__node:has(textarea)', { position: { x: 4, y: 2 } });
    await page.click('.react-flow__node:has(textarea)', { position: { x: 4, y: 2 } });
    await page.waitForTimeout(150);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(250);
    check('deleting the note leaves the recipes', (await snapshot(page)).nodes.length === 3);

    // --- export and import ---------------------------------------------------
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.keyboard.press('Control+e'),
    ]);
    check('Ctrl E downloads a file', download.suggestedFilename().endsWith('.json'), download.suggestedFilename());

    const savedPath = resolve(tmpdir(), `factory-graph-smoke-${Date.now()}.json`);
    await download.saveAs(savedPath);
    const savedText = readFileSync(savedPath, 'utf8');
    const saved = JSON.parse(savedText) as {
      projectName: string;
      graph: { nodes: unknown[]; edges: unknown[] };
    };
    const live = await snapshot(page);
    check(
      'the file holds the whole graph',
      saved.graph.nodes.length === live.nodes.length &&
        saved.graph.edges.length === live.edges.length,
      `${saved.graph.nodes.length} nodes, ${saved.graph.edges.length} edges`,
    );

    // Wipe everything, then bring it back from the file alone.
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    check('the canvas is empty before importing', (await snapshot(page)).nodes.length === 0);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.keyboard.press('Control+i'),
    ]);
    await chooser.setFiles(savedPath);
    await page.waitForTimeout(600);
    state = await snapshot(page);
    check(
      'importing the file restores the graph',
      state.nodes.length === live.nodes.length && state.edges.length === live.edges.length,
      `${state.nodes.length} nodes, ${state.edges.length} edges`,
    );
    unlinkSync(savedPath);

    // --- saved plans ---------------------------------------------------------
    // Name the open plan, so its row in the list can be told from the rest.
    await page.fill('input[aria-label="Project name"]', 'Mall');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);

    await page.keyboard.press('Control+p');
    await page.waitForTimeout(250);
    check(
      'Ctrl P opens the plan list',
      await page.locator('[role="menu"][aria-label="Saved plans"]').isVisible(),
    );

    const beforePlans = await snapshot(page);
    check(
      'the open plan is listed under its name',
      beforePlans.plans.some((plan) => plan.id === beforePlans.activeId && plan.name === 'Mall'),
      beforePlans.plans.map((plan) => plan.name).join(', '),
    );

    await page.getByRole('menuitem', { name: 'New plan' }).click();
    await page.waitForTimeout(500);
    state = await snapshot(page);
    check('a new plan opens an empty canvas', state.nodes.length === 0, `${state.nodes.length} nodes`);
    check(
      'and joins the list without disturbing the others',
      state.plans.length === beforePlans.plans.length + 1 &&
        state.plans.some((plan) => plan.name === 'Mall'),
      state.plans.map((plan) => plan.name).join(', '),
    );

    await page.keyboard.press('Control+p');
    await page.waitForTimeout(250);
    await page.getByRole('menuitem', { name: /^Mall/ }).click();
    await page.waitForTimeout(600);
    state = await snapshot(page);
    check(
      'switching back restores that plan',
      state.activeId === beforePlans.activeId && state.nodes.length === beforePlans.nodes.length,
      `${state.nodes.length} nodes`,
    );

    // The one this whole feature exists for: following someone's link used to
    // overwrite the single autosave slot and take your work with it.
    const beforeLink = await snapshot(page);
    await page.goto('about:blank');
    await page.goto(copied);
    await page.waitForTimeout(900);
    state = await snapshot(page);
    check(
      'a share link opens as its own plan',
      state.plans.length === beforeLink.plans.length + 1,
      `${beforeLink.plans.length} -> ${state.plans.length}`,
    );
    check(
      'and leaves every saved plan alone',
      state.plans.some((plan) => plan.name === 'Mall'),
      state.plans.map((plan) => plan.name).join(', '),
    );
    check(
      'and clears the hash it came from',
      (await page.evaluate(() => window.location.hash)) === '',
    );
    await page.reload();
    await page.waitForTimeout(800);
    check(
      'so reloading does not make a second copy of it',
      (await snapshot(page)).plans.length === beforeLink.plans.length + 1,
      `${(await snapshot(page)).plans.length} plans`,
    );

    // Deleting a plan is outside the graph's undo stack; the toast is the
    // only way back, so it had better work.
    await page.keyboard.press('Control+p');
    await page.waitForTimeout(250);
    const beforeDelete = await snapshot(page);
    await page.getByRole('button', { name: 'Delete Mall' }).click();
    await page.waitForTimeout(500);
    state = await snapshot(page);
    check(
      'deleting a plan takes it off the list',
      state.plans.length === beforeDelete.plans.length - 1 &&
        !state.plans.some((plan) => plan.name === 'Mall'),
      `${beforeDelete.plans.length} -> ${state.plans.length}`,
    );

    await page.locator('[role="status"]').getByRole('button', { name: 'Undo' }).click();
    await page.waitForTimeout(400);
    state = await snapshot(page);
    check(
      'and the toast undo puts it back',
      state.plans.length === beforeDelete.plans.length &&
        state.plans.some((plan) => plan.name === 'Mall'),
      state.plans.map((plan) => plan.name).join(', '),
    );

    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    // --- reduced motion ------------------------------------------------------
    const still = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    const stillPage = await still.newPage();
    await stillPage.goto(URL);
    await stillPage.waitForTimeout(600);
    await stillPage.keyboard.press('Control+k');
    await stillPage.waitForTimeout(150);
    await stillPage.keyboard.type('iron plate', { delay: 8 });
    await stillPage.waitForTimeout(200);
    await stillPage.keyboard.press('Enter');
    await stillPage.waitForTimeout(300);

    // No named helper inside evaluate: esbuild wraps named function
    // expressions in a `__name()` call that does not exist in the page.
    const durations = await stillPage.evaluate(() => {
      const panel = document.querySelector('aside[aria-label="Node inspector"]');
      const button = document.querySelector('header button');
      return {
        panel: panel ? getComputedStyle(panel).transitionDuration : 'missing',
        button: button ? getComputedStyle(button).transitionDuration : 'missing',
      };
    });
    check(
      'reduced motion stops the inspector sliding',
      millis(durations.panel) < 1,
      durations.panel,
    );
    check('and stops button transitions', millis(durations.button) < 1, durations.button);
    await still.close();

    await browser.close();
  } finally {
    preview.kill();
  }

  process.stdout.write(failures === 0 ? '\nall checks passed\n' : `\n${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
