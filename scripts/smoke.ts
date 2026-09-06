/**
 * Drives the built app through the interactions that cannot be unit-tested:
 * pointer drags between ports, the drop-on-empty-canvas search, the inspector,
 * and undo. Prints a pass/fail line per step and exits non-zero on failure.
 *
 *   npm run build && npm run smoke
 */
import { spawn } from 'node:child_process';
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
  edges: { from: string; fromPort: string; to: string; toPort: string }[];
  selection: string[];
}

/** Reads the store through the debug hook the app exposes in every build. */
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as { __factoryGraph?: { getState: () => unknown } })
      .__factoryGraph;
    if (!store) throw new Error('__factoryGraph hook is missing');
    const state = store.getState() as Snapshot & {
      graph: { nodes: { id: string; kind: string }[]; edges: Snapshot['edges'] };
    };
    return {
      nodes: state.graph.nodes.map((node) => ({ id: node.id, kind: node.kind })),
      edges: state.graph.edges.map((edge) => ({
        from: edge.from,
        fromPort: edge.fromPort,
        to: edge.to,
        toPort: edge.toPort,
      })),
      selection: state.selection,
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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

    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  } finally {
    preview.kill();
  }

  process.stdout.write(failures === 0 ? '\nall checks passed\n' : `\n${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
