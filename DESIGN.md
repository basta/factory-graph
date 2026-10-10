# Factory Graph — design

## What this is

A node canvas for Factorio production chains. Nodes are recipe steps, edges are item
flows, an LP solver keeps every rate consistent while you edit. The artifact you walk
away with is a **ratio sheet you can read spatially** — the same numbers FactorioLab and
Kirk McDonald put in a table, but laid out the way the factory is laid out, and
shareable as a URL.

## The look, restated

Heavy industry seen through a blueprint. Factorio's own UI is warm gunmetal panels,
orange/yellow accents, pixel-crisp icons at 32/64px. I borrow the *vernacular* — warm
greys instead of cool ones, copper and brass instead of a product-blue, game sprites for
anything that has a game equivalent — but none of the assets or chrome. The test I'm
holding it to: a Factorio player should look at it and think "this is a tool", not "this
is a website about a tool".

Three commitments that carry most of the weight:

1. **Warm greys, never neutral or cool.** `#2B2A28` is oiled cast iron. Every surface is
   a step up from it in the same warm family. There is no `#111`, no `#0b0b0b`, no
   blue-grey anywhere.
2. **Colour means something.** `--warn` (#E0553A) appears *only* on imbalance and
   >100 % saturation. `--fluid` (#6FA8C7) appears *only* on fluid ports and fluid edges.
   `--brass` is for rate numbers. `--copper` is selection/focus/primary. Nothing is
   coloured for decoration, so when something goes red the eye goes straight to it.
3. **Numbers are typographically distinct from prose.** IBM Plex Mono, 12px, tabular, for
   anything compared against another number: rates, machine counts, totals, saturation.
   IBM Plex Sans for everything else. Mono is *not* used for labels, headings, or
   atmosphere.

Density: this is a tool for people who will have forty nodes on screen. Nodes are
compact, rows are 18px, there is no generous padding and no breathing room for its own
sake. Nothing is larger than 18px. The dot grid is the only atmospheric element on the
whole page.

## Node anatomy

A recipe node is a **rectangle**, 2px `--line` border, 3px radius — deliberately almost
square, so it reads as a machine block and not as a card. No shadow, ever. Selection is
the border turning `--copper`; there is no glow, no scale, no ring.

```
     +----------------------------------------------------+
     |##  [ic] Electronic circuit           4.8 [asm3]  ##|  28px header band, --panel-raised
     |##  [m][m][ ][ ]                                  ##|  16px module slots, bottom of band
     +----------------------------------------------------+
  [] | [ic]  30.0  Iron plate     [ic]  30.0  E. circuit  | []   port rows, 18px
  [] | [ic]  90.0  Copper cable                           |
     +----------------------------------------------------+
        ^icon  ^mono rate  ^name in --ink-muted
```

- Header band 28px `--panel-raised`: 24px recipe sprite, recipe name (15px Plex Sans,
  `--ink`), then right-aligned the **mono machine count** and the 16px machine sprite.
  Fixed-count nodes show the number with a 1px `--copper` underline; solved nodes show it
  plain. That one hairline is the entire "this is pinned" affordance — no lock icon, no
  badge. A node split into blocks shows the count as `6 × 5` — blocks first, machines in
  each second — because the block count is the number you lay out.
- Module slots: a row of 16px squares tucked into the bottom edge of the header band,
  filled with module sprites or drawn as a 1px `--line` outline when empty. Clicking one
  opens the module picker. They only appear when the machine has slots.
- Body: input rows on the left, output rows on the right, laid out as two columns so a
  node with 3 in / 1 out has an empty right column rather than interleaved rows. Row is
  `[16px sprite] [mono rate, tabular] [item name, 11px, --ink-muted]`.
- **Handles sit half outside the border**: 10px square for items, 10px circle for fluids.
  Fill `--brass` / `--fluid`. A port whose balance is nonzero gets a 2px `--warn` ring —
  the ring, not a fill change, so the item/fluid distinction survives the warning.

Source and sink nodes are the same rectangle without a body: one header band, an item
sprite, the item name, and one editable mono rate. Note nodes are a rectangle with no
header band and no handles, `--ink-muted` text.

## Full layout

```
+--------------------------------------------------------------------------------+
| Green circuits v Space Age | 2.4 MW  18/min  [ic]45.0 [ic]90.0 |  U R  L S E I  |  44px
+------------------------------------------------------+-------------------------+
|  . . . . . . . . . . . . . . . . . . . . . . . . .   |  Electronic circuit     |
|  . . +----------+ . . . . . . . +----------+ . . . .  |  ----------------------|
|  . . | Copper c.|---30.0----->--| E.circuit| . . . .  |  Machine                |
|  . . +----------+ . . . . . . . +----------+ . . . .  |   [ic] Assembling m. 3  |
|  . . . . . . . . . . . . . . . . . . . . . . . . .   |  Modules                |
|  . . . . . . . . . . . . . . . . . . . . . . . . .   |   [m][m][ ][ ]          |
|  . . . . . . . . . . . . . . . . . . . . . . . . .   |  Beacons                |
|  . . . . . . . . . . . . . . . . . . . . . . . . .   |   [ic] Beacon   x 8     |
|  . . . . . . . . . . . . . . . . . . . . . . . . .   |  ----------------------|
|  . . . . . . . . . . . . . . . . . . . . . . . . .   |  Machines  solved   4   |
|  . . . . . . . . . . . . . . . . . . . . . . . . .   |  Crafts/s        9.375  |
|  +--------+ . . . . . . . . . . . . . . . . . . . .  |  Power          1.6 MW  |
|  | minimap| . . . . . . . . . . . . . . . . . . . .  |  Pollution     8.0/min  |
|  +--------+ . . . . . . . . . . . [- + o] . . . . .  |                         |
+------------------------------------------------------+-------------------------+
                                                          320px inspector
```

- **Header, 44px**, `--panel`, 1px `--line` bottom. Left: editable project name with a
  caret that drops the list of saved plans, then the data set as muted text. Middle: totals strip — power and pollution as a 16px inline SVG
  glyph + mono number + unit, then raw inputs as game sprites + mono rate. No words beyond
  units. Right: six 28px icon buttons — undo, redo, auto-layout, share, export, import.
- **Inspector, 320px**, slides in from the right on selection (translateX, 120ms, killed
  under `prefers-reduced-motion`). Sections separated by 1px `--line` hairlines that run
  the full width — no boxes, no cards, no rounded groups. Labels `--ink-muted` left,
  values `--ink` right. Editable values are text on a 1px `--line` underline that turns
  `--copper` on focus.
- **Plan list**, 280px, hangs off the bottom edge of the header directly under the
  project name, sharing the header's own hairline as its top border. 24px rows of
  `[plan name] [last edited, 11px --ink-muted]`, the open plan's name in `--copper` and
  nothing else coloured. A trash glyph appears on the hovered row; a `+ New plan` row
  sits below a full-width hairline. Past six plans a filter field appears above the
  list. A dropdown and not a tab strip: a permanent second bar would cost 28px of canvas
  forever and stop scaling at about the sixth plan, which is where a list starts earning
  its keep.
- **Canvas**: `--bg-canvas`, 1px dots in `--grid-dot` on a 24px pitch. Custom minimap
  bottom-left (panel-coloured nodes on a canvas-coloured field), custom zoom controls
  bottom-right. React Flow's attribution, default handles, default edges, default
  controls and default minimap styling are all replaced.
- **Plan bar**, top-left of the canvas, framed like the zoom controls: the belt new
  connections start on, the assembler and furnace tier new nodes get, `/s` or `/min`,
  and the bus items Expand stops at. Every option is its game sprite at 16px; the
  chosen one sits on `--panel-raised` and the rest recede to 45 % opacity, so the eye
  finds the choice without a colour being spent on it. Groups split by hairlines.
- **Empty state**: one line, centred, `--ink-muted`: `Double-click the canvas or press
  Ctrl K to add a recipe.` Nothing else — no illustration, no card of suggestions.

## Edges

2px, `--line`. `--brass` on hover/select. Fluids are 3px and `--fluid`. Smoothstep. The
arrowhead is a small filled triangle drawn as a marker, not React Flow's default. The
rate label is a `--panel` box with 1px `--line` and mono text on the path midpoint; when
a transport is set a 2px saturation bar sits directly under the label, filling
left-to-right in `--brass`, switching the bar *and* the label *and* the path to `--warn`
above 100 %. When blocks put several belts side by side the label adds a `--ink-muted`
`×6` after the rate, and the bar measures one of those belts, not all of them as one.
The label leads with a 16px sprite of the belt, pipe or inserter, so the tier reads
without selecting anything, and the label itself is clickable: it selects the
connection, and its border turns `--brass` on hover the way the line does.

## Type

IBM Plex Sans / IBM Plex Mono, self-hosted woff2, `font-display: swap`, with a real
system fallback stack. Plex has a slightly engineered, drawn-with-a-ruler feel that sits
right next to Factorio's own type without imitating it.

| use | face | size |
|---|---|---|
| UI text, buttons, inspector labels | Plex Sans 400/500 | 13px |
| numbers compared to each other | Plex Mono 400/500, tabular | 12px |
| node title | Plex Sans 500 | 15px |
| port row item name | Plex Sans 400 | 11px |

Nothing above 18px anywhere. No all-caps. No letter-spacing above 0.

## Generic-tells audit

Checked the plan above against the failure list before writing a line of UI:

- **Dark + one neon accent** — avoided on purpose: the palette is *warm* dark (#2B2A28,
  not #0F0F0F) and there are four semantic colours, not one accent smeared over
  everything. Copper is confined to selection/focus/primary; it is not the brand colour
  of every interactive thing.
- **Card kit — uniform radius, grey shadow, generous padding** — 3px radius is almost
  square, there are **no shadows anywhere in the app**, and the inspector uses hairlines
  instead of grouped boxes. Density is deliberately high.
- **All-caps eyebrows / tracked-out micro-labels** — banned. Inspector section labels are
  sentence-case 13px `--ink-muted`, same size as the values.
- **Mono as decoration** — mono is restricted to numbers that get compared. Buttons,
  labels, names, and the empty state are all Plex Sans.
- **Em-dash-joined meta strings** ("Assembling machine 3 — 4 modules — 375 kW") — banned;
  the inspector puts those on separate label/value rows.
- **Fade-and-slide entrances, long transitions** — nothing exceeds 120ms, only the
  inspector translates, and everything is off under `prefers-reduced-motion`.
- **Emoji or a generic icon set standing in for game content** — every item, recipe,
  machine, module and beacon uses its game sprite. Inline 16px single-weight SVG is only
  for actions that have no game equivalent: undo, redo, layout, share, import, export.

## Copy

Sentence case, plain verbs, say what to do. `Copy link` / `Link copied` / `Fixed at 4
machines` / `Missing 2.3/s iron plate` / `Belt over capacity — 118 %`. No exclamation
marks, no "Oops", no product voice.
