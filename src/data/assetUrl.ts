/**
 * Joins Vite's `BASE_URL` to a project-relative asset path.
 *
 * `BASE_URL` is not reliably slash-terminated. Vite normalises the `base` given
 * in the config, but GitHub Pages' `configure-pages` action hands the workflow
 * a `base_path` of `/factory-graph` with no trailing slash, and building with
 * that produces `BASE_URL = "/factory-graph"`. Naive concatenation then asks for
 * `/factory-graphdata/2x1.json`, which 404s — the app boots, fails to load its
 * data, and shows an error on a deploy that passed every local check.
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const left = base.endsWith('/') ? base.slice(0, -1) : base;
  const right = path.startsWith('/') ? path.slice(1) : path;
  return `${left}/${right}`;
}
