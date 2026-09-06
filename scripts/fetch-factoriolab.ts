/**
 * Downloads FactorioLab's raw data set into `vendor/factoriolab/<set>/`.
 *
 *   npm run data:fetch && npm run data:import
 *
 * `vendor/` is not committed — the committed artefacts are this script,
 * `import-factoriolab.ts`, and their output under `public/`. Run these two only
 * when refreshing to a newer game version.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SET_ID = '2x1'; // Factorio 2.0 base + Space Age
const BASE = `https://raw.githubusercontent.com/factoriolab/factoriolab/main/public/data/${SET_ID}`;
const FILES = ['data.json', 'hash.json', 'defaults.json', 'icons.webp'];

async function main(): Promise<void> {
  const target = resolve(ROOT, 'vendor/factoriolab', SET_ID);
  mkdirSync(target, { recursive: true });
  for (const file of FILES) {
    const response = await fetch(`${BASE}/${file}`);
    if (!response.ok) throw new Error(`${file}: ${response.status} ${response.statusText}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    writeFileSync(resolve(target, file), bytes);
    process.stdout.write(`${file}  ${(bytes.length / 1024).toFixed(0)} kB\n`);
  }
}

void main();
