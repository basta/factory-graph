import { describe, expect, it, vi, afterEach } from 'vitest';
import { assetUrl } from './assetUrl.ts';

/** Rebuilds the module with a given `BASE_URL`, the way a build would. */
async function withBase(base: string): Promise<(path: string) => string> {
  vi.stubEnv('BASE_URL', base);
  vi.resetModules();
  const module = await import('./assetUrl.ts');
  return module.assetUrl;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('assetUrl', () => {
  it('joins a slash-terminated base', async () => {
    const join = await withBase('/factory-graph/');
    expect(join('data/2x1.json')).toBe('/factory-graph/data/2x1.json');
  });

  it('joins a base with no trailing slash', async () => {
    // This is the shape GitHub Pages' configure-pages action produces, and the
    // one that 404'd the data set on the first live deploy.
    const join = await withBase('/factory-graph');
    expect(join('data/2x1.json')).toBe('/factory-graph/data/2x1.json');
    expect(join('sprites/2x1.webp')).toBe('/factory-graph/sprites/2x1.webp');
  });

  it('handles the site root', async () => {
    const join = await withBase('/');
    expect(join('data/2x1.json')).toBe('/data/2x1.json');
  });

  it('never doubles a slash, whichever side has one', async () => {
    for (const base of ['/factory-graph', '/factory-graph/']) {
      const join = await withBase(base);
      for (const path of ['data/x.json', '/data/x.json']) {
        expect(join(path), `${base} + ${path}`).toBe('/factory-graph/data/x.json');
      }
    }
  });

  it('falls back to the root when BASE_URL is empty', async () => {
    const join = await withBase('');
    expect(join('data/2x1.json')).toBe('/data/2x1.json');
  });

  it('is what the shipped module does', () => {
    // The un-stubbed import, so the export the app actually uses is covered.
    expect(assetUrl('data/2x1.json')).toMatch(/\/data\/2x1\.json$/);
    expect(assetUrl('data/2x1.json')).not.toContain('//data');
  });
});
