# Factory Graph

A node editor for Factorio production chains. Nodes are recipe steps, edges are item
flows, and a linear-programming solver keeps every rate consistent as you edit. The
result is a ratio sheet you can read spatially and share as a URL.

Static site, no backend. Factorio 2.0 base + Space Age.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check and build to dist/
npm test             # solver, serializer and data tests
npm run shot -- name # screenshot the built app into shots/
```

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

## Layout

```
src/
  data/     GameData types, zod schema, loader, sprite lookup
  solver/   rates.ts (formulas), lp.ts (LP build), index.ts (solve), tests
  graph/    zustand store, history, serializer, url
  canvas/   React Flow setup and custom nodes, edges, handles, grid
  ui/       Header, Inspector, Search, Toast, ShortcutsOverlay
  tokens.css
scripts/    data fetch, data import, screenshots
public/     data/, sprites/, fonts/
```

`DESIGN.md` is the visual brief. `NOTES.md` is the running log of what each screenshot
showed and what changed because of it.

## Credits

Recipe data and icons are derived from
[FactorioLab](https://github.com/factoriolab/factoriolab) and are subject to that
project's licence; Factorio is a trademark of Wube Software. This project is not
affiliated with either.
