/**
 * Proves the GitHub Pages build works when it is served from a sub-path.
 *
 *   BASE_PATH=/factory-graph/ npm run build && npm run check:base
 *
 * The failure this catches is an asset referenced from the site root — a font,
 * the sprite sheet, the data set — which works locally at `/` and 404s the
 * moment the site lives at `/<repo>/`.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4325;
/**
 * Deliberately without a trailing slash: that is what GitHub Pages'
 * `configure-pages` action puts in `base_path`, and it is the shape that broke
 * the first live deploy. Vite serves it either way. `CHECK_BASE_PATH` points it
 * at another build, such as staging's `/factory-graph/staging`.
 */
const BASE_PATH = process.env.CHECK_BASE_PATH ?? '/factory-graph';
const BASE = `${BASE_PATH}/`;

interface StoreWindow {
  __factoryGraph?: { getState: () => { graph: { nodes: unknown[] } } };
}

async function main(): Promise<void> {
  const preview = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--base', BASE_PATH, '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore', shell: process.platform === 'win32' },
  );

  let failures = 0;
  const check = (label: string, ok: boolean, detail = ''): void => {
    if (!ok) failures += 1;
    process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}\n`);
  };

  try {
    const url = `http://localhost:${PORT}${BASE}`;
    for (let i = 0; i < 200; i += 1) {
      try {
        if ((await fetch(url)).ok) break;
      } catch {
        // still starting
      }
      await new Promise((done) => setTimeout(done, 150));
    }

    const browser = await chromium.launch();
    const page = await browser.newPage();
    const bad: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400) bad.push(`${response.status()} ${response.url()}`);
    });
    page.on('pageerror', (error) => bad.push(String(error)));

    // Load a real graph so the sprite sheet and the data set are both fetched.
    const { execSync } = await import('node:child_process');
    const hash = execSync('npx tsx scripts/make-fixture.ts green-circuits', {
      encoding: 'utf8',
    }).trim();

    await page.goto(`${url}#${hash}`);
    await page.waitForTimeout(1500);

    const nodes = await page.evaluate(
      () => (window as StoreWindow).__factoryGraph?.getState().graph.nodes.length ?? -1,
    );
    check('the app boots under a sub-path', nodes === 4, `${nodes} nodes`);

    const fonts = await page.evaluate(() => document.fonts.status);
    check('the fonts load', fonts === 'loaded', fonts);

    const sprite = await page.evaluate(() => {
      const element = document.querySelector('.react-flow__node span[style*="background-image"]');
      return element instanceof HTMLElement ? element.style.backgroundImage : '';
    });
    check(
      'the sprite sheet is fetched from the sub-path',
      sprite.includes(`${BASE}sprites/`),
      sprite.slice(0, 80) || 'no sprite found',
    );

    check('no failed requests', bad.length === 0, bad.slice(0, 3).join(' | '));
    await browser.close();
  } finally {
    preview.kill();
  }

  process.stdout.write(failures === 0 ? '\nall checks passed\n' : `\n${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
