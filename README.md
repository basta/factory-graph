# Factory Graph

A node editor for Factorio production chains. Nodes are recipe steps, edges are item
flows, and a linear-programming solver keeps every rate consistent as you edit. The
result is a ratio sheet you can read spatially and share as a URL.

**[basta.github.io/factory-graph](https://basta.github.io/factory-graph/)**

Static site, no backend. Factorio 2.0 base + Space Age.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check and build to dist/
npm test             # unit tests: solver, store, serializer, library, layout, data
npm run smoke        # drives the built app in a real browser (needs `build` first)
npm run check        # lint + test + build + smoke, what CI runs
npm run shot -- name # screenshot the built app into shots/
```

`npm test` covers everything that is a pure function. `npm run smoke` covers what
is not: port-to-port drags, the drop-on-empty-canvas search, click-to-select,
the clipboard, a real file download and re-import, auto-layout, switching
between saved plans, and the reduced-motion path. Both run in CI.

To poke at a specific graph, `npx tsx scripts/make-fixture.ts <name>` prints a
share hash you can paste after the `#` — `green-circuits`, `unbalanced`,
`saturated-belt`, `over-belt`, `blocks`, `kovarex`, `tangle`, `beacons`,
`no-constraint`.

## Refreshing the game data

Recipe data is vendored, not fetched at runtime. To move to a newer game version:

```sh
npm run data:fetch   # download FactorioLab's raw data set into vendor/
npm run data:import  # transform it into public/data/2x1.json + public/sprites/2x1.webp
```

`vendor/` is gitignored; the committed artefacts are the two scripts and their output.
The importer validates its own output against `src/data/schema.ts` and fails loudly if a
recipe references a machine or item that is not in the set.

## Deploying

The build is a static site. `base` comes from the `BASE_PATH` environment variable, so a
GitHub Pages project site works with `BASE_PATH=/factory-graph/ npm run build`.
`.github/workflows/deploy.yml` does exactly that on a push to `main`.

`npm run check:base` serves that build from a sub-path and asserts the app boots, the
fonts and sprite sheet load, and nothing 404s — the failure it exists to catch is an
asset referenced from the site root, which works locally at `/` and breaks the moment
the site lives at `/<repo>/`. `CHECK_BASE_PATH=/factory-graph/staging` points it at a
staging build.

### Staging

The `staging` branch is a preview of the next release, at
**[basta.github.io/factory-graph/staging](https://basta.github.io/factory-graph/staging/)**.
Push to `staging` to update it; merge into `main` to ship it.

Pages holds one artifact for the whole site, so every deploy builds both branches —
`main` at the root, `staging` under `/staging/`. A push to `staging` runs the checks and
then asks `main` to redeploy, because the Pages environment takes deploys from the default
branch only.

Staging shares an origin, and so `localStorage`, with the live site. It is built with
`VITE_CHANNEL=staging`, which gives it its own storage keys: on first visit it starts
from a copy of the live site's plans, and nothing it saves ever reaches them. The header
and the tab title both say *Staging*.

## Layout

```
src/
  data/     GameData types, zod schema, loader, sprite lookup
  solver/   rates.ts (formulas), lp.ts (LP build), index.ts (solve), tests
  graph/    zustand store, history, serializer, url, saved-plan library
  canvas/   React Flow setup and custom nodes, edges, handles, grid
  ui/       Header, Inspector, Search, Toast, ShortcutsOverlay
  tokens.css
scripts/    data fetch, data import, screenshots
public/     data/, sprites/, fonts/
```

`DESIGN.md` is the visual brief. `NOTES.md` is the running log of what each screenshot
showed and what changed because of it.

## Credits and licence

The application code is MIT licensed — see `LICENSE`.

Recipe data and the icon sprite sheet under `public/` are derived from
[FactorioLab](https://github.com/factoriolab/factoriolab), which is MIT licensed.
The icons themselves are game assets belonging to
[Wube Software](https://factorio.com); they are used here the way every community
calculator uses them, and are not covered by this project's licence. Factorio is
a trademark of Wube Software. This project is not affiliated with Wube or with
FactorioLab.
