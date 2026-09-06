# Build notes

A running log: decisions that were not obvious from the spec, and what each screenshot
showed that changed the code.

## M1 — Data + skeleton

### Data

FactorioLab moved its data sets since the spec was written. They are no longer at
`src/data/<set>/data.json` but at **`public/data/<set>/`**; the Factorio 2.0 + Space Age
set is **`2x1`** (`datasets.ts` calls it "Space Age", version `2.1.16`). `hash.json` is
FactorioLab's own URL-encoding table and is not needed by us, so it is fetched but not
imported.

Shape decisions made in `scripts/import-factoriolab.ts`:

- **Fluids** are exactly the items in category `fluids` (22 of them); they are also the
  only items with no `stack`, apart from technology entries.
- **Probabilistic outputs.** FactorioLab bakes the chance into the amount — uranium
  processing ships `uranium-235: 0.007`, not `1 × 0.7 %`. The probability is therefore
  not recoverable from their export. Our schema keeps `probability` as a first-class
  field and the solver always uses `amount × probability`; the importer sets
  `probability: 1` with `amount` already the expected value, and flags the recipe
  `probabilistic: true` so the UI can say the number is an average. The arithmetic is
  identical either way.
- **Catalysts.** FactorioLab's `catalyst` map is how Kovarex and coal liquefaction are
  expressed. Productivity does not apply to the catalyst portion, so `outputPerCraft`
  splits an output into `catalyst + (amount − catalyst) × (1 + prod)`. Without this,
  Kovarex with prod modules would multiply the 40 seed U-235 as well as the 1 net.
- **Producers, not categories.** The spec asks for machines with "allowed categories",
  but this data set lists `producers` on each recipe directly. That is strictly better
  (a recipe's category here is a UI grouping, not a crafting category), so `producers`
  is what we model. A test asserts every producer id exists in `machines`.
- **Inserter throughput** is stored by FactorioLab in items per *minute* at the maximum
  capacity bonus (`fast-inserter: 900`, i.e. 15/s — one yellow belt). We divide by 60.
  These are approximations for capacity warnings, as the spec allows.
- **Pipes.** FactorioLab 2.0 records throughput only for the pump (1200/s); plain pipes
  have no entry. The importer adds a `pipe` entry at 1000 units/s, the figure every
  calculator uses for a short run, and `PIPE_THROUGHPUT_PER_SEC` in `rates.ts` documents
  it. Pipe saturation is therefore an approximation, unlike belts which are exact.
- **Icons** are one 2044×1978 webp, 64px icons on a 66px pitch. 29 recipes (mining,
  spoilage, plants) have no icon of their own, so the importer falls back to the first
  output item's icon, then the first input's.

### Deviations from the spec's type sketch

- `PortKey` is `` `${nodeId}:${side}:${itemId}` ``, not `` `${nodeId}:${itemId}` ``.
  Kovarex has U-235 on *both* sides, so item id alone is not a unique port and the two
  would have collided. Edges are unaffected: `fromPort` is always an output and `toPort`
  always an input, so an item id identifies them unambiguously.
- `Transport` for pipes carries a `pipeId`, so a pump and a plain pipe can have
  different capacities. The spec's `{ kind: 'pipe' }` had nowhere to put that.
- `PortResult` gained `connected: boolean`. Both the tests and the canvas need to know
  whether a nonzero balance is a warning (a connected port that will not balance) or
  expected (an unconnected port acting as an implicit source or sink), and recomputing
  it from the edge list at every render was wasteful.
- **Self-edges are allowed.** `addEdge` originally refused `from === to`; Kovarex and
  coal liquefaction are naturally drawn as a node feeding its own input port from its own
  output port, so that guard was wrong. Duplicate (port, port) pairs are still refused.

### Solver

Formulation is in the header comment of `src/solver/lp.ts`. The one judgement call worth
recording: the spec asks both that "every port balances" *and* that a nonzero balance on
a connected port shows as a warning. Those are contradictory under hard equality, since a
balanced port always reads zero. Resolved by giving **every** port slack variables and
pricing them: cheap on unconnected ports (that is the implicit source/sink, reported in
`totals`), expensive on connected ports (only bought when the user pins two machine
counts that cannot agree — which is exactly the warning case). A small asymmetry
(`W_WRONG_SIDE`) puts a shortfall on the consumer's input port and a surplus on the
producer's output port, so the warning appears where it explains something instead of
landing arbitrarily on either end.

Two rate rules were corrected against the tests rather than assumed:

- **Module admission is not per-effect.** The first cut masked each effect a machine or
  recipe disallowed. That is right for a machine's `allowed_effects` — a speed module
  works in an oil refinery even though the refinery ignores its quality penalty — but
  wrong for a recipe's `allow_productivity: false`, which stops the module going in at
  all. `moduleAllowed` now rejects productivity modules outright where productivity is
  disallowed, and masks everything else. Without this a recycler would have taken a
  prod-3's −15 % speed penalty while getting none of its productivity.
- **The beacon profile is rounded in the game data.** `sqrt(8) × 1.5 = 4.242640…` but the
  shipped table gives `4.242`. Using the table is right — it is what the game does — so
  the test asserts to three places and says why.

Solver precision is jsLPSolver's default (values rounded to 8 decimals). Pinned nodes
read their rate from the constraint rather than from the LP, so a number the user typed
never comes back with rounding on it. Port balances use a *relative* epsilon, since a
balance is a difference of two solver outputs and its error scales with their size.

**Timing**, 100 nodes / 99 edges, this machine: min 2.3 ms, median 5.0 ms, max 9.1 ms.
The test asserts the median, not the best of n, so it measures what an edit actually
costs. That is under the 10 ms bar but not by much; if it gets tight, `glpk.js` is the
fallback the spec allows.

### Screenshots

`shots/m1-empty.png` at 1440×900, first look:

- The `<kbd>` in the empty state stretched to the full width of the centring grid, so the
  one-line instruction broke into three lines with a full-width box in the middle. Fixed
  by putting the `<p>` inside the grid item rather than making it the grid item.
- Seven bordered icon buttons in a row read as an undifferentiated wall. Grouped them
  into undo/redo/layout, share/export/import, and help, with real space between groups.
- The zoom controls had a border on the panel *and* on each button inside it. Dropped the
  button borders and separated them with a single hairline.

`shots/m1-grid-1x.png` at 1x — **the dot grid was invisible**. React Flow's `Background`
draws each dot as an antialiased circle of radius 0.5, which spreads one pixel of an
already-quiet colour over four and leaves nothing. Replaced it with `DotGrid`, our own
pattern of crisp-edged 1×1 rects driven off the viewport transform, so a dot is exactly
one pixel of exactly `--grid-dot`. `shots/m1-grid-magnified.png` (6× DPR crop) confirms
the lattice is there and evenly spaced.

Even so, the grid is *deliberately* near the threshold of vision: `--grid-dot` `#3A3835`
on `--bg-canvas` `#2B2A28` is about 5 % luminance apart, and a single isolated pixel at
that contrast reads as texture rather than as a visible lattice. That is the specified
palette and it is the right call for "the one atmospheric element" — it will read as
tooth under the nodes rather than as a drawn grid.

`shots/m1-help.png` — the shortcut list was splitting prose on spaces and rendering
"Drag from a port" as four key caps. Changed the data to `{ keys: string[], then?: string }`
so a gesture's plain-language half never ends up in a key cap. The section grid also had
a doubled border where the last column met the panel edge; switched to a 1px-gap hairline
grid, which is correct at any column count.

Sprite rendering has no on-screen surface yet at M1 (the empty canvas shows no game
icons), so it is covered by `src/data/sprite.test.ts` for the offset and scaling maths
and will be confirmed visually in M2 when nodes appear.

## M2 — Place and connect

### Three bugs the screenshots and the smoke test caught

**React error #185 on the first node.** A zustand selector that builds a new
array on every read (`state.graph.nodes.filter(...)` in the inspector) never
settles under `useSyncExternalStore` — React re-renders, the selector returns a
fresh array, React re-renders. Fixed by selecting the stable `nodes` array and
narrowing it in a `useMemo`. Two store setters got the same treatment:
`setSelection` and `moveNodes` now ignore writes that change nothing, because
React Flow reports the current selection and position back to us after every
render and a fresh object each time is the same infinite loop.

**Clicking a node did nothing.** React Flow is fully controlled here, so it does
not apply selection itself — it emits `select` changes and expects the host to.
Dropping those in `onNodesChange` meant selection only ever changed when the app
set it programmatically, which is why creating a node opened the inspector but
clicking one did not. `onNodesChange` and a new `onEdgesChange` now apply
`select` and `remove` changes to the store.

**Nodes clipped their own handles.** `overflow: hidden` on the node made the
rounded corners tidy and cut the handles in half — and handles sitting half
outside the border is the whole point of them. Removed the clip and gave the
header band its own top radius instead.

Two smaller ones: the initial `fitView` never ran, because it fired on the first
render while the store still held the empty graph. Rather than chase
`useNodesInitialized`, the document is now restored *before* the editor mounts,
so React Flow's own `fitView` prop does the job. And `lz-string` is CommonJS
with no named exports, so Node's ESM loader could not import
`compressToEncodedURIComponent` by name — the fixture script found that, not the
browser, where Vite's interop hides it.

### Choices

- **`onConnectEnd` reads React Flow's `connectionState`**, not the event target's
  class list. The first attempt sniffed for `.react-flow__pane` to decide
  whether a drag had landed on empty canvas; `connectionState.fromHandle` and
  `connectionState.toNode` say so directly and survive any DOM change upstream.
- **Quality modules are left out of both pickers.** Quality is a v1 non-goal, so
  the only thing a quality module would do in this model is impose a speed
  penalty. Offering it would be a trap.
- **`__factoryGraph` on `window`** exposes the store read-only for
  `scripts/smoke.ts`. Asserting against the real document beats scraping the DOM
  for what the graph contains, and it exposes nothing the UI does not show.
- The empty-state, search and inspector were all reached by keyboard first; the
  smoke test drives Ctrl K, arrow keys and Enter rather than clicking, which is
  the keyboard-first claim actually being exercised.

### Screenshots

`shots/m2-search.png` — the palette over an empty canvas. Match highlighting in
`--copper` reads well against the muted rows; the producing machine on the right
is the detail that makes two same-named rows distinguishable. Nothing changed
after looking at it.

`shots/m2-chain.png` — the four-node green-circuit chain. First version had the
graph jammed into the top-left corner (the fitView bug) and the handles sliced in
half (the overflow bug). After both fixes the chain reads left to right with
ports where the edges land. The `—` placeholders sit where the numbers will go in
M3.

`shots/m2-inspector.png` — a foundry with four productivity modules, selected.
Confirmed: the copper selection border with no glow, the copper underline under
the pinned machine count, the minimap picking the selection out in copper, and
fluids rendering in `--fluid` with round handles and a 3px path while the item
edge next to it is 2px `--line` with a square handle. The source/sink node was
redrawn after the first pass: it had "Source" as its title and the item name
buried in the body, which wasted the one line that should name the node. Now the
item names the node and "source"/"sink" is the muted qualifier.

### Interaction coverage

`npm run smoke` drives the built app through 20 checks that unit tests cannot
reach: port-to-port drags, the drop-on-blank-canvas search and its pre-filter, a
mismatched port refusing, click-to-select, Ctrl Z/Shift Z, Ctrl D, Delete, and
survival of a reload. It fails the build if any of them regress.

## M3 — Solver

Wiring, mostly: the LP and its 27 tests landed in M1, so this milestone was
`useMemo(solve)` plus a `SolveProvider`, the numbers on nodes, edges and ports,
and the totals strip. Verified against the green-circuit chain by hand:
45/s circuits needs 18 assembling machine 3s, 45 assembling machine 2s of copper
cable, 72 electric furnaces of plate, 27.34 MW and 243 pollution/min. Every one
of those matches what the formulas predict.

### What changed after looking at it

**The solver re-ran on every pointer move of a drag.** `useMemo(() => solve(graph,
…), [graph])` looked right, but `moveNodes` writes a new graph object on every
mouse move, so dragging a 100-node graph was paying a 5 ms solve per frame.
Fixed structurally rather than with a guard: `solve` now takes
`SolverGraph = Pick<Graph, 'nodes' | 'edges'>`, so "the solver never touches
layout" is enforced by the type, positions cannot invalidate the memo, and a
test asserts the same nodes solve identically no matter where they sit.

**Self-loops routed straight through their own node.** The first loop path
bulged 26px above the port, which for a node ~100px tall is *inside* it — the
Kovarex screenshot showed two loops crossing the node's own rows and each other.
Rewritten to run under the node, using `useInternalNode` for the real box, with
each successive port's loop staggered further out so U-235 and U-238 draw as two
clearly separate paths with their own labels.

**The totals strip read like a valid bill of materials even when the graph did
not balance.** With a port short by 42.5/s the strip still listed inputs and
outputs as if they added up. Added an imbalance count in `--warn` next to the
totals — `1 port unbalanced` — whose tooltip says what to do about it. That is
the only place `--warn` appears in the header.

**The header and the canvas both said "nothing is pinned".** Dropped the header
version; the canvas hint is the one that can afford to explain properly, and the
header now shows nothing at all in that state rather than a second copy.

### One deliberate deviation

The spec says a `no-constraint` graph shows "everything as 0". It shows `—`
instead. A node that genuinely solves to zero machines — disconnected from
anything that constrains it, in an otherwise-solved graph — is a different thing
from a graph that has not been given anything to solve for, and a dash keeps
those distinguishable. The canvas hint carries the actual message.

### Screenshots

`shots/m3-solved.png` — the green-circuit chain with every number filled in.
`shots/m3-unbalanced.png` — the warn state: red ring on the short port, the rate
in `--warn`, the drawn tooltip reading `Missing 42.5/s iron plate`, and the
header count. The tooltip is drawn rather than left to the browser's `title`, so
it uses the app's own type and colour and so it shows up in a screenshot at all.
`shots/m3-kovarex.png` — two self-loops on one node, each labelled.
`shots/m3-no-constraint.png` — the canvas hint.
