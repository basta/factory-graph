/**
 * Screenshots the built app against `vite preview`.
 *
 *   npm run shot -- <name> [--width 1440] [--height 900] [--dpr 2] [--hash <graph hash>]
 *                         [--press "Control+k"] [--type "green circ"] [--wait 400]
 *
 * Writes `shots/<name>.png`. Run `npm run build` first.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, type Page } from 'playwright';

const PORT = 4317;

interface Options {
  name: string;
  width: number;
  height: number;
  dpr: number;
  hash: string | null;
  steps: { kind: 'press' | 'type' | 'click' | 'hover' | 'wait'; value: string }[];
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    name: argv[0] ?? 'shot',
    width: 1440,
    height: 900,
    dpr: 2,
    hash: null,
    steps: [],
  };
  for (let i = 1; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1] ?? '';
    if (flag === '--width') options.width = Number(value);
    else if (flag === '--height') options.height = Number(value);
    else if (flag === '--dpr') options.dpr = Number(value);
    else if (flag === '--hash') options.hash = value;
    else if (flag === '--press') options.steps.push({ kind: 'press', value });
    else if (flag === '--type') options.steps.push({ kind: 'type', value });
    else if (flag === '--click') options.steps.push({ kind: 'click', value });
    else if (flag === '--hover') options.steps.push({ kind: 'hover', value });
    else if (flag === '--wait') options.steps.push({ kind: 'wait', value });
  }
  return options;
}

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`preview server never came up at ${url}`);
}

async function runSteps(page: Page, options: Options): Promise<void> {
  for (const step of options.steps) {
    if (step.kind === 'press') await page.keyboard.press(step.value);
    else if (step.kind === 'type') await page.keyboard.type(step.value, { delay: 12 });
    else if (step.kind === 'click') await page.click(step.value);
    else if (step.kind === 'hover') await page.hover(step.value);
    else await page.waitForTimeout(Number(step.value));
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const url = `http://localhost:${PORT}/`;

  const preview = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore', shell: process.platform === 'win32' },
  );

  try {
    await waitForServer(url);
    const browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: options.dpr,
    });
    const messages: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') messages.push(message.text());
    });
    page.on('pageerror', (error) => messages.push(String(error)));

    await page.goto(options.hash ? `${url}#${options.hash}` : url);
    // Fonts and the sprite sheet must be in before the pixels mean anything.
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await page.waitForTimeout(350);
    await runSteps(page, options);

    mkdirSync(resolve(process.cwd(), 'shots'), { recursive: true });
    const path = resolve(process.cwd(), 'shots', `${options.name}.png`);
    await page.screenshot({ path });
    await browser.close();

    process.stdout.write(`${path}\n`);
    if (messages.length > 0) {
      process.stdout.write(`console errors:\n${messages.map((m) => `  ${m}`).join('\n')}\n`);
    }
  } finally {
    preview.kill();
  }
}

void main();
