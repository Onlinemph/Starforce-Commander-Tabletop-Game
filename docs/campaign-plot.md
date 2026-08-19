# THE OPERATIONAL PLOT — implementation contract for `CampaignMap.tsx`

Status: art-direction specification, synthesised from three proposals ("chart", "deep", "console")
after reading `shots/base/plot-crop.png`, `console.png` and `selected.png`.

Files touched:

| file | change |
|---|---|
| `src/campaign-ui/CampaignMap.tsx` | rewritten; props, handlers, viewBox and click model unchanged |
| `src/campaign-ui/plot.ts` | **new** — pure geometry, region merge, deterministic scatter. DOM-free, testable |
| `src/campaign-ui/helpers.ts` | unchanged |
| `src/ui/theme/campaign.css` | one rule: `.campaign-map` background |

---

## 0. The direction in one rule

The plot is the **same photograph of space the battle map takes, at a thousand times the scale,
with an instrument reticle laid over the glass.** Two layers, two jobs, and the whole design hangs
on keeping them apart:

- **The atmosphere layer is soft and approximate.** Nebulae bleed past their hexes, coronae spill
  across three, dust belts smear and swallow the stars behind them. It is a picture. It carries no
  rule.
- **The instrument layer is exact and thin.** Mesh, terrain rims, grid fixes, the frontier, the
  counters. Every rules-bearing fact lives here, hairline-sharp, drawn *above* the vignette so it
  never fades.

Two consequences govern every decision below.

> **Luminance is information.** Nothing is bright unless it is a map fact. There is no invented hero
> nebula, no decorative wash, no off-centre bloom. The ground is radially symmetric about the plot;
> every asymmetry the eye finds is terrain the generator actually wrote.

> **Your units are objects on a table. Contacts are marks on the glass.** A unit gets a full plate, a
> dome and a hard rim — a physical chit. A contact gets a weaker plate, stays flat, hollow and
> dashed. Withheld identity must *look* withheld, and it must look less substantial than the thing
> you own.

### What the renders actually show, and what fixes each

| defect in `plot-crop.png` | fix |
|---|---|
| system and dust are the same dull brown | system loses its area fill entirely and becomes a **point of light**; dust becomes a **dark hole in the starfield**. The two share no mark, no geometry and no value. |
| adjacent same-terrain hexes show internal seams; a nebula is blocky staining | every terrain kind is flood-filled into components and drawn from **one merged outline path**. There is no internal edge left to see. |
| a star system contains no star | corona + four-point flare + warm-white core, sized by a positional hash so no two are the same stamp. |
| the border is the loudest thing on the map | 22 dashed rings → **one smoothed hachured line** plus a merged corridor silhouette at 0.12. Red ink drops roughly 80%. |
| own units are flat dots | plate + dome + rim, a heading leader with speed chevrons, and a name that stacks clear of its neighbours. |
| grey mesh on near-black, odd bright patch top-left | plot-centred void gradient **inside the SVG**, a real starfield, a vignette, and a centre-lit mesh that dissolves at the rim. The CSS wash — centred on the *element*, while the plot is centred on the *viewBox* — is deleted; that mismatch is the bright patch. |

---

## 1. Contract preserved

**The viewBox does not change.** It stays exactly

```
viewBox = `${-HEX} ${-HEX} ${width + HEX} ${height + HEX}`
width  = hexCenter({q: W-1, r: 0}, HEX).x + HEX*2      // 728 at W=30
height = H * HEX * Math.sqrt(3) + HEX*2                // 641.68 at H=22
```

At 30×22 that is `-16 -16 744 657.68`, aspect 1.131. `HEX = 16` is unchanged. `legendTop = height − 32`,
`legendLeft = −HEX` are unchanged. This is deliberate: every alternative that widens the box for ruler
gutters buys a coordinate reference the **grid fixes** (§6.5) give for free, at the price of touching the
one thing the click model rides on.

**The click model is untouched.** The root `onClick` inverts `svg.getScreenCTM()` and calls
`pixelToHex(local.x, local.y, HEX)`. Two rules must be written into the file as comments:

1. **No ancestor `<g>` of the plot may carry a `transform`.** Legend `translate()` and the
   engagement/counter-local transforms are fine — they sit *above* the click resolution, not around
   it. A transformed wrapper around the plot layers silently breaks every map click.
2. **The ground rect must stay hit-testable.** Once the 660 hit-testable `<polygon>`s are gone, the
   bled ground rect (§6.1) is what guarantees a click on empty space has a painted target that
   bubbles to the root. It must **not** carry `pointer-events="none"`. Everything else below the
   counter layers must.

> Load-bearing fact that pays for this entire redesign: **the 660 per-hex polygons carry no
> interaction.** Clicks are resolved at the root by `pixelToHex`. The polygons exist only to draw a
> mesh and a tint, so they can all be replaced by paths with zero behavioural consequence.

**Props and handlers are consumed exactly as today:** `view`, `selectedUnitId`, `selectedContactId`,
`plannedWaypoints`, `onClickHex`, `onClickUnit`, `onClickContact`. `onClickUnit` and `onClickContact`
keep `e.stopPropagation()` and `cursor: pointer`.

**One behaviour change, flagged for review.** The click handler gains a bounds guard:

```ts
const hex = pixelToHex(local.x, local.y, HEX)
if (inBounds(hex, view.map.width, view.map.height)) onClickHex(hex)
```

Today a click on the legend band appends an off-map waypoint to the selected unit's order. That is a
bug; the guard fixes it and changes nothing for any in-map click.

**Note on `plannedWaypoints`.** The prop's docstring says "hexes the staged orders would path
through". It is actually `[unit.hex, ...order.waypoints]` (`CampaignApp.tsx:686`) — the unit's hex
plus the **ordered waypoints**, not the resolved path. Legs are therefore multi-hex and
`hexDistance` per leg is real information (§7.3). Correct the docstring while here.

**Constraint 2 — the wall.** Nothing in this component reads anything outside `view`. Every derived
value below is a pure function of `view.map`, `view.units`, `view.contacts`,
`view.infrastructure`, `view.knownEnemyInfrastructure`, `view.engagements`, `view.side`,
`view.round`. Explicitly rejected as wall breaches: sensor-range rings (the range a `sensorPower`
buys is a rules computation this component must not perform), fog or fade over unscanned space
(the view carries no such field; synthesising one from unit positions is the component modelling
detection), and contact heading (`ViewedContact` has no `course` — the wall strips it).

---

## 2. Geometry and the new pure module

`src/campaign-ui/plot.ts`. All of it DOM-free and unit-testable, in the spirit of `helpers.ts`.

```ts
export const HEX   = 16
export const COL   = HEX * 1.5                 // 24        column pitch
export const ROW   = HEX * Math.sqrt(3)        // 27.712813 row pitch
export const IN_R  = ROW / 2                   // 13.856406 inradius
```

### 2.1 Corners and the edge/direction table

Corner offsets are computed **once**, as module constants, so every hex derives its corners from
bit-identical doubles and shared vertices match exactly. Corner *i* is at 60*i*°, matching
`hexPoints()` exactly.

```ts
export const CDX = [HEX, HEX/2, -HEX/2, -HEX, -HEX/2, HEX/2]
export const CDY = [0, IN_R, IN_R, 0, -IN_R, -IN_R]
```

Edge *i* runs corner *i* → corner *i*+1 and faces this neighbour:

```ts
export const EDGE_DIR = [
  { q:  1, r:  0 },   // E0  midpoint ( 0.75s,  0.433s)
  { q:  0, r:  1 },   // E1  midpoint ( 0,      0.866s)
  { q: -1, r:  1 },   // E2  midpoint (-0.75s,  0.433s)
  { q: -1, r:  0 },   // E3  midpoint (-0.75s, -0.433s)
  { q:  0, r: -1 },   // E4  midpoint ( 0,     -0.866s)
  { q:  1, r: -1 },   // E5  midpoint ( 0.75s, -0.433s)
] as const
```

**This table is the one non-obvious fact in the whole change. Get it wrong and every region outline
is inside-out.** It is derived, not guessed: `hexCenter` places a neighbour at
`Δx = 1.5s·Δq`, `Δy = s√3·(Δr + Δq/2)`, so `d{1,0}` lies at `(1.5s, 0.866s)` — *lower*-right, not
east — whose half is exactly E0's midpoint. Note this is **not** `HEX_DIRECTIONS` reordered by
accident; `hexmap.ts` lists a different order and mixing them will produce silently wrong regions.

Traversal *i* → *i*+1 is **clockwise in screen coordinates** (y down). Outer loops therefore come out
clockwise and holes counter-clockwise for free; render with `fillRule="evenodd"` and holes are
correct with no extra work.

### 2.2 Connected components

```ts
export function components(members: Hex[]): Hex[][]
```

Flood fill over `hexNeighbors()` within the member set, iterating `members` in **array order** so the
result is deterministic. `Map`/`Set` iteration in JS is insertion order — this is stated here so
nobody "optimises" it into an unordered structure and breaks §5.

Expected output on a generated 30×22 map: systems are singletons (the generator rejection-samples
them ≥ 4 apart, `hexmap.ts:111-116`), so ≈ 8–14 one-hex components; nebula 3–6 components of 3–8;
dust 2–4 belts of 4–8.

### 2.3 The merged region outline

```ts
export function regionPath(members: Hex[], size = HEX): string
```

For every member hex, for each of the six edges: if the neighbour in `EDGE_DIR[i]` is also a member,
**drop the edge** (it is interior); otherwise emit the segment corner *i* → corner *i*+1. Then chain
segments end-to-start into closed loops and emit `M … L … Z` per loop, all loops in one `d`.

Four details decide whether this works:

1. **Point keys must round.** `pkey(p) = ${p.x.toFixed(2)},${p.y.toFixed(2)}` — the same 2 dp
   `hexPoints` already uses, so endpoint matching is exact **string equality**, never a float
   comparison. Two hexes compute a shared corner from different centres; the doubles agree to ~1e-13
   while the corner lattice is spaced 8 units in x and 13.86 in y — eleven orders of magnitude of
   margin. Using `CDX`/`CDY` as precomputed constants removes the last ulp of drift at source.
2. **The start-point index must hold a list, not a value.** Two lobes of one region can pinch at a
   single shared corner, where the vertex has two outgoing edges. A plain `Map<point, edge>` silently
   drops one and the chain never closes.
3. **Winding is free** (§2.1). `fillRule="evenodd"` throughout.
4. **No collinear simplification is needed** — adjacent outline edges always meet at 120°.

Cost: ≤ 6 edge tests per member plus a linear chain walk. Callers on a 30×22 map: terrain (~40
hexes total), the border corridor (22), the whole map once for the plot edge (660), and one contact
uncertainty cloud each (≤ 37 hexes, capped). All trivial, all inside a memo except the contact
clouds.

### 2.4 The mesh, each edge emitted once

```ts
export function meshPaths(w: number, h: number, systemKeys: Set<string>):
  { grid: string; rim: string; lit: string }
```

For each hex, for each edge *i*: let `nbIn = inBounds(hex + EDGE_DIR[i], w, h)`.
**If `i >= 3 && nbIn`, skip** — the neighbour owns that edge as its own *i*−3. Otherwise emit
`M a L b` into `grid` when `nbIn`, into `rim` when not; and additionally into `lit` when the hex is a
system.

Because `EDGE_DIR[i+3] = −EDGE_DIR[i]`, every interior edge is emitted by exactly one of its two
hexes and every boundary edge by its only in-bounds owner. **Today every interior edge is stroked
twice by two overlapping polygons — that is half of why the mesh reads at double weight.**

≈ 2,000 segments, a `d` string of ~62 KB, built once and memoised. One DOM node replaces 660.

### 2.5 Frontier smoothing

```ts
export function smooth(p: P[], t = 1/6): string      // Catmull-Rom → cubic Bézier
```

`c1 = p1 + (p2 − p0)·t`, `c2 = p2 − (p3 − p1)·t`, endpoints clamped (`p0 = p1`, `p3 = p2`). All
coordinates `.toFixed(2)`.

### 2.6 Ink extents

```ts
const INK_L = -HEX,  INK_R = COL*(w-1) + HEX          // -16 … 712
const INK_T = -IN_R, INK_B = ROW*(h - 0.5) + IN_R     // -13.86 … 609.68
const CX = (INK_L + INK_R)/2, CY = (INK_T + INK_B)/2  // the plot's optical centre
const RMAJ = Math.hypot(INK_R - CX, INK_B - CY)       // ~443 at 30×22
```

`BLEED = 160`. The root `<svg>` has no `preserveAspectRatio` override, so it letterboxes
`xMidYMid meet` inside a column that is normally wider than 744∶658. Content drawn outside the
viewBox but inside the element box **is painted** (the root clips at its own bounds, not at the
viewBox). Ground, starfield and vignette are therefore drawn over

```
SPACE = [-HEX - BLEED, -HEX - BLEED, 744 + 2*BLEED, 657.68 + 2*BLEED]
```

so the letterbox fills with real space rather than flat CSS. 160 covers the letterbox at any
container aspect up to ≈ 1.62∶1; past that the vignette is already at 0.62 black there and the flat
`#010206` behind it is within a JND.

---

## 3. Palette — exact values

No new hue. No new side colour. No third terrain identity. Every value below is an existing token, a
**ground**, or a **light** — luminance, not identity.

| role | value | provenance |
|---|---|---|
| own side | `var(--blue)` / `var(--red)` by `view.side` | **frozen** |
| contact, enemy infra ring | the **opposing** side's token | **frozen** |
| engagement | `var(--lc-orange)` `#ff9c00` | **frozen** |
| your plan: route, waypoints, selection | `var(--lc-sand)` `#ffcc66` | token |
| void centre / mid / rim | `#0b0d1c` / `#06080f` / `#010206` | grounds; `#010206` is the tactical `.map-bg` **exactly** |
| counter plate, every label halo | `#03050b` | ground |
| star tiers: dust / field / near | `#aab6d8` .34 / `#ccd6f2` .55 / `#eef2ff` .85 | lights (tactical uses `#dce6ff`) |
| star tiers: warm K / cool B | `#ffd9b0` .50 / `#bcd8ff` .50 | lights |
| bright-star flare | `#cfe0ff` @ .30 | tactical `.star-bright`, value for value |
| system core | `#fff6de` | light |
| system corona | `var(--yellow)` `#ffc94a` → `var(--lc-orange)` | tokens; the doc's terrain anchor for system |
| system hex edge (promoted mesh) | `rgba(255,201,74,0.26)` | `--yellow` |
| nebula spill / heart / knot | `var(--lc-plum)` .16 / `--lc-plum` → `#6a4a96` → `--lc-plum-deep` / `#b48ee0` @ .20 | tokens + one light of plum |
| nebula rim | `rgba(154,114,201,0.30)` | `--lc-plum`; today's terrain value |
| dust body / clump | `#14100a` @ .94 / `#070503` @ .50 | grounds (a 6%-of-`--lc-orange` brown on the void) |
| dust grain | `#6b5a44` @ .14–.20 | a shade of `--lc-sand` |
| dust rim | `rgba(255,156,0,0.24)` | `--lc-orange`; today's terrain value |
| mesh | `#a3b9e0` .18 → .09 | a lift of today's `rgba(122,140,175,.18)` |
| plot edge | `rgba(125,91,166,0.55)` dashed `8 6` | tactical `.map-edge`, **exact** |
| grid fixes | `rgba(150,172,208,0.34)` | rule ink |
| frontier | `var(--red)` @ .07 / .55 / .42 / .12 | frozen hue, quietened |
| infrastructure glyph | `var(--ink-dim)`; destroyed `var(--ink-mute)` + `var(--danger)` strike | doc |
| dome (counter light) | `#ffffff` .34 → `#000000` .30 | pure luminance, colour-agnostic |
| unit codes, legend, labels | `var(--ink-dim)` / `var(--ink-mute)` | ink ramp |

`color-interpolation-filters="sRGB"` on both filters is **load-bearing, not pedantry**: the SVG
default is linearRGB, which turns a dark blurred plum into washed grey haze. Omit it and the nebulae
look like smoke.

Gradient stops use literal hex values with the token they mirror named in a comment. `var()` does
resolve in `stopColor` in current engines, but a pattern's or symbol's contents sit outside the
referencing element's inheritance chain in older WebKit. Everywhere outside `<defs>`, reference
tokens directly.

**Two radial gradients for the two side hues, not one.** `stop-color: currentColor` and
`var(--side)` in a stop resolve against the *stop's* inherited colour — the stop lives in `<defs>` —
not the referencing element's. One def cannot serve both sides. Ship `#cm-hold-blue` and
`#cm-hold-red`, each still naming a frozen token.

---

## 4. Paint order

Bottom to top. **Layers 1–11 are the memoised scenery subtree; 12–17 re-render on interaction.**

| # | layer | nodes | depends on |
|---|---|---|---|
| 0 | `<defs>` | ~18 | constants |
| 1 | ground — **the click target**, no `pointer-events:none` | 1 | map size |
| 2 | starfield: 5 tier paths + 10 bright groups | ~36 | map seed |
| 3 | nebula clouds — 3–6 filtered groups | ~24 | terrain |
| 4 | dust belts — 2–4 filtered groups | ~24 | terrain |
| 5 | star systems — 8–14 groups | ~42 | terrain |
| 6 | **VIGNETTE** | 1 | map size |
| 7 | mesh + plot edge + system-lit edges | 3 | map size + terrain |
| 8 | terrain rims (nebula, dust) | 2 | terrain |
| 9 | grid fixes | 1 path + ≤26 texts | map size |
| 10 | the frontier | 5 | border + `view.side` |
| — | *(1–10 = `<Deepspace>`, `React.memo`, `pointer-events:none` except layer 1)* | | |
| 11 | infrastructure | ~6 per site | view |
| 12 | planned route | ≤ 40 | props |
| 13 | contacts | ~10 each | view |
| 14 | own units | ~11 each | view |
| 15 | engagements | ~7 each | view |
| 16 | legend + caption | ~40 | view |

**The vignette sits at 6 — under every counter, every rule and every terrain rim, and over every
depiction of space.** This is the single ordering decision that is easy to get wrong. Space falls
away at the edges; the instrument does not. A unit in the corner is on near-black.

---

## 5. Determinism (constraint 5)

There is **no `Math.random`, no `Date`, no `useRef` counter and no unordered iteration** anywhere in
this component.

**5.1 One seed, from map data only.**

```ts
function mapSeed(map: CampaignMap): number {
  let h = 0x811c9dc5
  const feed = (n: number) => { h ^= n | 0; h = Math.imul(h, 0x01000193) }
  feed(map.width); feed(map.height)
  for (const t of map.terrain) { feed(t.q); feed(t.r); feed(t.kind.charCodeAt(0)) }
  for (const b of map.border)  { feed(b.q); feed(b.r) }
  return h >>> 0
}
const rng = new Rng(mapSeed(view.map))     // src/engine/dice.ts — mulberry32, already tested
```

Same campaign → same sky, on every render, after a reload, in a replay, and on the opponent's
screen. Different campaign → a different sky. It reads only `view.map`, which is already public to
both sides, so it leaks nothing.

**5.2 One RNG, consumed in a fixed order:** field stars → bright-star selection → nebula knots
(components in discovery order) → dust clumps (components in discovery order). Nothing else draws
from it.

**5.3 Per-hex features use a positional hash, never the sequential stream**, so adding a nebula
somewhere can never resize a star on the other side of the map:

```ts
export function hexNoise(h: Hex, salt: number): number {
  let n = (Math.imul(h.q, 0x27d4eb2d) ^ Math.imul(h.r, 0x165667b1) ^ salt) | 0
  n = Math.imul(n ^ (n >>> 15), n | 1)
  n ^= n + Math.imul(n ^ (n >>> 7), n | 61)
  return ((n ^ (n >>> 14)) >>> 0) / 4294967296
}
```

Salts: `0x51` system core radius, `0x52` corona radius, `0x53` flare length.

---

## 6. The scenery layers

### 6.0 `<defs>` — the entire shared cost

Eighteen def nodes, module-level, **independent of map size**. Nine gradients, one pattern, one
symbol, two filters, plus the two side-hue holding glows.

```jsx
<defs>
  {/* ground, plot-centred — userSpaceOnUse so the light is on the PLOT, not the element */}
  <radialGradient id="cm-void" gradientUnits="userSpaceOnUse" cx={CX} cy={CY} r={RMAJ * 0.86}>
    <stop offset="0"    stopColor="#0b0d1c" />
    <stop offset="0.46" stopColor="#06080f" />
    <stop offset="1"    stopColor="#010206" />
  </radialGradient>

  <radialGradient id="cm-falloff" gradientUnits="userSpaceOnUse" cx={CX} cy={CY} r={RMAJ * 0.80}>
    <stop offset="0.55" stopColor="#000000" stopOpacity="0" />
    <stop offset="0.86" stopColor="#000000" stopOpacity="0.30" />
    <stop offset="1"    stopColor="#000000" stopOpacity="0.62" />
  </radialGradient>

  <radialGradient id="cm-mesh-fade" gradientUnits="userSpaceOnUse" cx={CX} cy={CY} r={RMAJ * 0.78}>
    <stop offset="0"    stopColor="#a3b9e0" stopOpacity="0.18" />
    <stop offset="0.70" stopColor="#a3b9e0" stopOpacity="0.13" />
    <stop offset="1"    stopColor="#a3b9e0" stopOpacity="0.09" />
  </radialGradient>

  <radialGradient id="cm-star-halo">
    <stop offset="0"    stopColor="#eaf0ff" stopOpacity="0.55" />
    <stop offset="0.40" stopColor="#9fb6e8" stopOpacity="0.16" />
    <stop offset="1"    stopColor="#9fb6e8" stopOpacity="0" />
  </radialGradient>

  <radialGradient id="cm-corona">                       {/* --yellow → --lc-orange */}
    <stop offset="0"    stopColor="#fff6de" stopOpacity="0.95" />
    <stop offset="0.16" stopColor="#ffc94a" stopOpacity="0.45" />
    <stop offset="0.44" stopColor="#ff9c00" stopOpacity="0.15" />
    <stop offset="1"    stopColor="#ff9c00" stopOpacity="0" />
  </radialGradient>

  <radialGradient id="cm-neb-core" cx="50%" cy="46%" r="64%">   {/* --lc-plum ramp */}
    <stop offset="0"    stopColor="#9a72c9" stopOpacity="0.34" />
    <stop offset="0.55" stopColor="#6a4a96" stopOpacity="0.18" />
    <stop offset="1"    stopColor="#4a3466" stopOpacity="0" />
  </radialGradient>
  <radialGradient id="cm-neb-knot">
    <stop offset="0" stopColor="#b48ee0" stopOpacity="0.20" />
    <stop offset="1" stopColor="#b48ee0" stopOpacity="0" />
  </radialGradient>

  {/* Dust grain: a 12×12 tile of seven fixed dots, rotated OFF the mesh angle so the
     texture can never align with a hex edge. A pattern rasterises one tile and blits it —
     the cheapest texture in SVG, and the reason feTurbulence is refused (§10.3). */}
  <pattern id="cm-grain" patternUnits="userSpaceOnUse" width="12" height="12"
           patternTransform="rotate(24)">
    <circle cx="1.6"  cy="2.4"  r="1.05" fill="#6b5a44" fillOpacity="0.20" />
    <circle cx="6.2"  cy="1.1"  r="0.55" fill="#6b5a44" fillOpacity="0.16" />
    <circle cx="9.7"  cy="4.3"  r="0.85" fill="#6b5a44" fillOpacity="0.18" />
    <circle cx="3.4"  cy="6.9"  r="0.60" fill="#6b5a44" fillOpacity="0.15" />
    <circle cx="7.8"  cy="8.6"  r="1.00" fill="#6b5a44" fillOpacity="0.20" />
    <circle cx="11.2" cy="10.4" r="0.50" fill="#6b5a44" fillOpacity="0.14" />
    <circle cx="0.9"  cy="10.8" r="0.75" fill="#6b5a44" fillOpacity="0.17" />
  </pattern>

  {/* counters — objectBoundingBox, so ONE def serves every mark at every position */}
  <radialGradient id="cm-plate">
    <stop offset="0"    stopColor="#03050b" stopOpacity="0.86" />
    <stop offset="0.62" stopColor="#03050b" stopOpacity="0.70" />
    <stop offset="1"    stopColor="#03050b" stopOpacity="0" />
  </radialGradient>
  <radialGradient id="cm-dome" cx="36%" cy="30%" r="76%">
    <stop offset="0"    stopColor="#ffffff" stopOpacity="0.34" />
    <stop offset="0.42" stopColor="#ffffff" stopOpacity="0.06" />
    <stop offset="0.70" stopColor="#000000" stopOpacity="0" />
    <stop offset="1"    stopColor="#000000" stopOpacity="0.30" />
  </radialGradient>
  <radialGradient id="cm-hold-blue">
    <stop offset="0"   stopColor="var(--blue)" stopOpacity="0.14" />
    <stop offset="0.6" stopColor="var(--blue)" stopOpacity="0.05" />
    <stop offset="1"   stopColor="var(--blue)" stopOpacity="0" />
  </radialGradient>
  <radialGradient id="cm-hold-red">
    <stop offset="0"   stopColor="var(--red)" stopOpacity="0.14" />
    <stop offset="0.6" stopColor="var(--red)" stopOpacity="0.05" />
    <stop offset="1"   stopColor="var(--red)" stopOpacity="0" />
  </radialGradient>

  {/* THE ONLY TWO FILTERS IN THE FILE. Bounded by construction — see §9.2. */}
  <filter id="cm-neb"  x="-40%" y="-40%" width="180%" height="180%"
          colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="6" /></filter>
  <filter id="cm-dust" x="-28%" y="-28%" width="156%" height="156%"
          colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="3" /></filter>
</defs>
```

### 6.1 Ground (layer 1)

```jsx
<rect {...SPACE} fill="url(#cm-void)" />
```

One node, one gradient. The centre lifts to `#0b0d1c` (a hair above `--panel`), the rim lands on
`#010206` — **at its edges the campaign plot is literally the colour of the tactical board.**

It keeps default `pointer-events` (`visiblePainted`; a painted fill hit-tests), so the event bubbles
to the root and `pixelToHex` runs exactly as today. Everything in layers 2–10 and 16 carries
`pointerEvents="none"` — a real saving, because otherwise every mousemove hit-tests a
2,000-segment path.

**The corresponding CSS change** (`campaign.css`, one rule):

```css
.campaign-map {
  display: block;
  flex: 1;
  min-width: 0;
  height: 100%;
  background: #010206;        /* was: a plum radial that missed the letterboxed plot */
  border-radius: var(--r-cell);
}
```

The deleted `radial-gradient(ellipse 70% 60% at 50% 42%, rgba(74,52,102,0.34), transparent 72%)` is
the "odd bright patch": it was centred on the **element** while the plot is centred on the
**viewBox**, and the letterbox offsets the two. They never coincided.

### 6.2 Starfield (layer 2)

`count = Math.round(area(SPACE) / 2400)` ≈ 430 at 30×22. They are **not** 430 nodes. They are
**five `<path>` nodes**, one per tier, each a concatenation of two-arc circles:

```ts
const dot = (x: number, y: number, r: number) =>
  `M${x},${y}m${-r},0a${r},${r} 0 1,0 ${2*r},0a${r},${r} 0 1,0 ${-2*r},0`
```

| tier | share | r | fill | opacity |
|---|---|---|---|---|
| dust | 58% | 0.35–0.60 | `#aab6d8` | 0.34 |
| field | 26% | 0.60–1.00 | `#ccd6f2` | 0.55 |
| near | 8% | 1.00–1.60 | `#eef2ff` | 0.85 |
| warm (K) | 4% | 0.60–1.10 | `#ffd9b0` | 0.50 |
| cool (B) | 4% | 0.60–1.10 | `#bcd8ff` | 0.50 |

Radius is drawn `0.35 + u³ · 1.25` — cubed, so the great majority are pinpricks. This is the same
cubing `useStarfield` uses (`MapView.tsx:117`), for the same reason. All sub-circles in a path share
winding, so `nonzero` fill never cancels them. All coordinates `.toFixed(1)`.

The **10 largest** get the tactical map's four-point flare, quoted from `.star-bright`:

```jsx
<g>
  <circle cx cy r={s.r * 4.5} fill="url(#cm-star-halo)" />
  <path d={`M${s.x - s.r*5},${s.y}H${s.x + s.r*5}M${s.x},${s.y - s.r*5}V${s.y + s.r*5}`}
        stroke="#cfe0ff" strokeWidth={0.5} opacity={0.30} />
  <circle cx cy r={s.r} fill="#ffffff" opacity={0.9} />
</g>
```

**5 paths + 30 nodes for ~430 stars, and zero filters.** The halo is a gradient disc, never a blur;
at this count that is the difference between a map and a slideshow.

### 6.3 Nebulae (layer 3) — soft luminous cloud, no tiles

Per component, **one filtered group**:

```jsx
<g filter="url(#cm-neb)" pointerEvents="none">
  <path d={ring} fill="#9a72c9" fillOpacity={0.16} fillRule="evenodd" />   {/* the spill */}
  <path d={ring} fill="url(#cm-neb-core)" fillRule="evenodd" />            {/* the heart  */}
  {knots.map(k => <circle cx={k.x} cy={k.y} r={k.r} fill="url(#cm-neb-knot)" />)}
</g>
```

- `ring` is the component's **merged** outline, so no internal hex edge exists to be seen. This is
  the fix for "adjacent same-terrain hexes show their internal edges".
- `stdDeviation="6"` blurs the union's hex facets into cloud and pushes the glow about one hex past
  the region — which is exactly right, because a nebula's edge is not a hex edge.
- **Knots**: 2–4 discs at member-hex centres chosen from the seeded stream, `r = 9 + u·9`. They are
  what stop the blur reading as a smoothed sausage. They are inside the already-filtered group and
  cost no extra filter.
- Peak alpha ≈ 0.34, so **stars still glimmer through**. Gas veils; it does not delete. This is the
  deliberate opposite of dust, and it is the primary non-colour channel separating the two.

### 6.4 Dust (layer 4) — a dark granular hole that eats the stars

```jsx
<g filter="url(#cm-dust)" pointerEvents="none">
  <path d={ring} fill="#14100a" fillOpacity={0.94} fillRule="evenodd" />
  {clumps.map(c => <circle cx={c.x} cy={c.y} r={c.r} fill="#070503" fillOpacity={0.50} />)}
  <path d={ring} fill="url(#cm-grain)" fillRule="evenodd" />
</g>
```

- The body is **darker and more opaque than the ground it sits on**, so every field star inside a
  belt is genuinely occluded. That is the whole effect, and it is free: no mask, no compositing,
  just paint order. Occlusion is a second channel that survives greyscale absolutely.
- `#14100a` is a 6%-of-`--lc-orange` brown on the void — warm where the void is cold, so a belt
  crossing an empty patch of sky still reads as *matter* rather than as a printing fault.
- **Clumps**: 3–5 discs, `r = 6 + u·8`, at member-hex centres, so the belt lumps and drifts instead
  of extruding.
- **Grain** carries the `--lc-orange` identity the design doc assigns to dust, at the 12×12 pattern's
  0.14–0.20 alphas. `stdDeviation="3"` — half the nebula's: dust is particulate, so its edge is
  crisper than gas but still not hexagonal.

### 6.5 Star systems (layer 5) — a point of light with a corona

Systems are **always singleton hexes**, which is what makes this treatment safe. **A system gets no
area fill of any kind.** Once the tint is gone, nothing on the map can confuse a system with dust.

```jsx
<g pointerEvents="none">
  <circle cx cy r={coronaR} fill="url(#cm-corona)" />
  <path d={`M${cx-flare},${cy}H${cx+flare}M${cx},${cy-flare}V${cy+flare}`}
        stroke="#ffe9b8" strokeWidth={0.7} opacity={0.45} />
  <circle cx cy r={coreR} fill="#fff6de" />
</g>
```

`coreR = 1.7 + n·0.9`, `coronaR = 10 + n·5`, `flare = coronaR * 0.62`, where `n = hexNoise(hex, salt)`
— so no two systems are the same stamp and each is pinned to its coordinates forever.

**No filter for any of the 8–14 systems.** The corona is a radial gradient; at this size a gradient
disc is indistinguishable from a blurred disc and costs nothing.

Because the corona spills across neighbouring hexes while the rules care exactly which hex is the
system, the system's six mesh edges are **promoted** into the `lit` mesh path at
`rgba(255,201,74,0.26)` (§6.7). That is the instrument layer stating the fact the atmosphere layer
only suggests.

**Explicitly not done: system names.** One proposal derived a designation from a coordinate hash
(`VESPER-4`). It is deterministic and does not cross the wall, but it invents lore the game does not
have, it can contradict future content, and it puts a second big label per system into competition
with unit names. Rejected.

### 6.6 Vignette (layer 6)

```jsx
<rect {...SPACE} fill="url(#cm-falloff)" pointerEvents="none" />
```

A strengthened quotation of `#map-falloff` (60%/0 → 100%/0.55 becomes 55%/0 → 86%/0.30 → 100%/0.62),
stronger because it also has to swallow the letterbox — but **capped at 0.62, not higher**, because
the terrain rims (layer 8) sit above it and a corner nebula must still read as cloud under its own
rim.

### 6.7 The mesh (layer 7) — the instrument reticle

```jsx
<path d={grid} fill="none" stroke="url(#cm-mesh-fade)" strokeWidth={0.6}
      shapeRendering="geometricPrecision" pointerEvents="none" />
<path d={lit}  fill="none" stroke="rgba(255,201,74,0.26)" strokeWidth={0.7}
      pointerEvents="none" />
<path d={rim}  fill="none" stroke="rgba(125,91,166,0.55)" strokeWidth={1}
      strokeDasharray="8 6" pointerEvents="none" />
```

Three things make it float rather than be the substrate:

1. **Each edge is drawn exactly once** (§2.4). Today every interior edge is stroked twice; net ink
   drops from an effective ~0.33 alpha to 0.18–0.09.
2. **`stroke="url(#cm-mesh-fade)"`** takes the hairline from 0.18 at the plot centre to 0.09 at the
   rim — an illuminated reticle dissolving into the dark. It bottoms out at 0.09, not 0, so corner
   hexes stay countable; and against the vignette's darker ground 0.09 is *more* legible there, not
   less.
3. **The plot edge is the tactical map's `.map-edge`, value for value.** Same fiction, same mark,
   other scale.

`shapeRendering="geometricPrecision"` is required: at the non-integer scales this SVG lands on,
`auto` snaps 0.6-unit strokes inconsistently and the mesh shimmers between columns.

### 6.8 Terrain rims (layer 8) — the exact statement

Two paths, each concatenating every component's ring for one kind:

| terrain | stroke | width | dash |
|---|---|---|---|
| nebula | `rgba(154,114,201,0.30)` | 0.8 | `2.5 3.5` |
| dust | `rgba(255,156,0,0.24)` | 0.8 | `2.5 3.5` |

Fine dashes on a **merged** outline. This is the concession that makes the atmosphere layer safe:
the glow may spill a hex, but the hexes that actually cost 2 to enter (`entryCost`, `hexmap.ts:94`)
are stated to the pixel, in the terrain's own hue, in a mark that reads as "boundary of an effect
zone" rather than as a tile. Systems need no rim — they have the promoted mesh edge.

### 6.9 Grid fixes (layer 9)

A skew grid defeats edge rulers: `rMin = −floor(q/2)`, so a left-edge `r` scale is literally true
only for column 0. The chart's answer is **interior fixes**, and they earn their place because
`CampaignApp.tsx:717` prints `eng-3 at 14,2` and today there is **no way to find 14,2 on the plot**.

For every hex where `q % 5 === 0 && r % 5 === 0`:

- a 2.4-unit cross, all of them in **one shared path**, `stroke="rgba(150,172,208,0.34)"`, width 0.6;
- a label `` `${q},${r}` `` at `y = cy − 4.5`, `fontSize={10}`, same fill, `--font-lcars`, tabular,
  `textAnchor="middle"`.

≈ 26 fixes on a 30×22 map, forming a regular skewed lattice. Labels are suppressed when
`view.map.width < 12`, and any fix within 1 hex of a unit, contact or engagement is suppressed
entirely (build a `Set<hexKey>` of occupied hexes — ≤ 40 entries, rebuilt per render, trivial).

The values are **raw axial `q,r`** — the same pair the sidebar prints. No display coordinate is
invented. `aria-hidden="true"`: this is a visual reference, not a screen-reader path.

**No edge rulers and no gutters.** They would require widening the viewBox, they are only literally
true for one column, and the fixes give the same reference everywhere for a quarter of the ink.

### 6.10 The frontier (layer 10) — was the loudest thing on the map

`map.border` is one hex per row in row order: a jagged vertical **line**, not a set of cells. Draw it
as a line.

```ts
const pts = [...view.map.border].sort(byCentreY).map(h => hexCenter(h, HEX))
// Split into runs wherever consecutive centres are > HEX*3.4 apart. A neighbour step is
// 27.71 units; the generator's ±1 column jog is 48.0 (= 3·HEX) because bq changes while r
// advances a row. 3.4·HEX admits both and breaks only on a genuine gap.
const d = runs.map(smooth).join('')
// Extend the first and last segments HEX*0.7 past the terminal centres, clamped to
// INK_T / INK_B, so the frontier runs OFF the chart. A frontier has no ends inside a plot.
```

```jsx
<g pointerEvents="none" strokeLinecap="round" strokeLinejoin="round" fill="none">
  {/* the contested corridor: MERGED, so it is a corridor and not 22 rings */}
  <path d={regionPath(view.map.border)} stroke="var(--red)" strokeOpacity={0.12}
        strokeWidth={0.5} fillRule="evenodd" />
  <path d={d} stroke="var(--red)" strokeWidth={7}   opacity={0.07} />   {/* haze */}
  <path d={d} stroke="var(--red)" strokeWidth={1.1} opacity={0.55} strokeDasharray="7 5" />
  <path d={ticks} stroke="var(--red)" strokeWidth={0.9} opacity={0.42} />
</g>
```

- The haze is a **wide low-alpha stroke, not a blur** — a 7-unit stroke at 7% *is* a soft band, for
  one path and no filter.
- The merged corridor keeps the information "*these* hexes are the contested ones", which the rules
  need, while the merge dissolves every internal edge. That is exactly the difference between a
  chain of rings and a frontier.
- **Hachures** are generated **from the hex centres, not by sampling the curve** — `getTotalLength()`
  is a DOM measurement and this component renders from data alone. At every 3rd border hex, take the
  unit normal to `(next − prev)`, rotate 90°, emit a 4-unit tick facing the player's own half:
  `sign = view.side === 'A' ? -1 : +1` (A holds low `q`). All ticks in one path. Hachures are
  cartography's oldest boundary mark, they work in greyscale, and no other mark on this map has
  them — so the frontier survives sitting beside a red contact diamond.
- **Kept dashed.** One proposal argued the dash should go, because in this system dashes mean
  *withheld*. That rule governs **counters**, where identity is the datum; a boundary is not a
  counter, and a contested line is not a surveyed line. The hachures carry the second channel.

The `--red`/side-B ambiguity is resolved by **form, not hue**: a frontier is a *line*, a side is a
*counter*. Nobody confuses a hachured dashed boundary with a domed disc. Red ink drops roughly 80%
against today's 22 rings at width 1.4 / 0.5 opacity, and the frontier becomes about the fourth
loudest thing on the map — behind own units, engagements and systems, which is the correct order.

---

## 7. The counters

### 7.1 Infrastructure (layer 11)

Glyph, ring and the dash-means-theirs rule are preserved.

```jsx
<g color={mine ? own : foe}>
  {mine && !i.destroyed &&
    <circle r={11} fill={`url(#cm-hold-${view.side === 'A' ? 'blue' : 'red'})`} />}
  <circle r={13} fill="url(#cm-plate)" opacity={0.55} />
  <circle r={8} fill="none" stroke={mine ? own : foe} strokeWidth={1}
          strokeDasharray={mine ? undefined : '2 2'} opacity={0.65} />
  <text y={cy + 4} textAnchor="middle" fontSize={12}
        paintOrder="stroke" stroke="#03050b" strokeWidth={2.4} strokeLinejoin="round"
        fill={i.destroyed ? 'var(--ink-mute)' : 'var(--ink-dim)'}>{INFRA_GLYPH[i.kind]}</text>
  {i.destroyed &&
    <path d="M-6,-6L6,6" stroke="var(--danger)" strokeWidth={1.2} opacity={0.85} />}
  <title>{`${KIND_NAME[i.kind]} · ${mine ? 'yours' : 'enemy, reported'}${i.destroyed ? ' · destroyed' : ''}`}</title>
</g>
```

Three gains: the glyph gets a **halo** so a `⬢` never dissolves into a corona; **destroyed gains a
strike and keeps `opacity: 1`** — today it is opacity-only, which the design system explicitly
forbids ("`opacity` below 1 means exactly one thing: *this control is unavailable*"); and a live
owned site gets a 14%-of-token holding glow, no filter, no new hue, which gives a fleet base the
read of *a place with power*.

### 7.2 Own units (layer 14) — objects on the table

```jsx
<g onClick={stop → onClickUnit} style={{ cursor: 'pointer' }}>
  {/* heading, BEHIND the counter so it never crosses the numeral */}
  {leader}                                                      {/* §7.2.1 */}
  <circle r={13}  fill="url(#cm-plate)" />
  <circle r={8}   fill={own} opacity={cloaked ? 0.5 : 1} />
  {!cloaked && <circle r={8} fill="url(#cm-dome)" />}
  <circle r={8}   fill="none"
          stroke={selected ? 'var(--lc-sand)' : 'rgba(0,0,0,0.65)'}
          strokeWidth={selected ? 2.5 : 1}
          strokeDasharray={cloaked ? '2 2' : undefined} />
  {selected && <polygon points={hexPoints(unit.hex, HEX)} fill="none"
                        stroke="var(--lc-sand)" strokeWidth={1} opacity={0.55} />}
  <text y={cy + 3.6} fontSize={10} fontWeight={700} fill="var(--ink-on-fill)"
        textAnchor="middle">{unit.ships.length}</text>
  <text y={cy + 19 + shift} fontSize={10} textAnchor="middle"
        paintOrder="stroke" stroke="#03050b" strokeWidth={2.4} strokeLinejoin="round">
    <tspan fill={own}>{name}</tspan>
    {codes && <tspan fill="var(--ink-dim)">{` · ${codes}`}</tspan>}
  </text>
  <title>{…}</title>
</g>
```

The **dome** is a single colour-agnostic white→black radial laid *over* the untouched side fill. No
hue is invented, retuned or mixed: `--blue` is still literally painted there, with light on it. The
rim darkening at 30% is the load-bearing half — a flat disc loses its silhouette against a starfield
— and the highlight is the half that makes it a chit on a table. A cloaked hull gets **no dome**,
which is a free extra channel on top of the dim and the dash.

*On the design system's "no bevel, no sheen, no elevation": that law governs **chrome** — bars,
panels, cells, the legend. The play surface is depicted space and already carries lit planets,
coronae and a `0 0 26px` plum bloom on `.map`. Nothing here goes near a panel, a bar or a cell.*

**7.2.1 Heading, from `unit.course` (a `Hex` delta — in the view, whole).** Convert with the
linearity of `hexCenter`: `dx = COL·course.q`, `dy = ROW·(course.r + course.q/2)`,
`θ = atan2(dy, dx)`. Draw from radius 13 outward:

| datum | source | treatment |
|---|---|---|
| heading | `course` | leader line + arrowhead; `course === null` → nothing (never moved) |
| still moving | `movedLastOwnPhase` | arrowhead **filled** when true, **hollow** when it held |
| speed tier | `order.speed` | leader length `8 + 3·tier`; `tier` perpendicular 3.5-unit chevrons. `hold` → **no leader at all** — a held unit has no vector, and that reads instantly. `emergency`'s fourth chevron is `--warn` (caution, not a side hue). |

Leader and chevrons in `own` at 0.75 opacity, 1 width, with a `#03050b` casing at 2.6.

**7.2.2 The code row.** At most **two** codes appended to the name in `--ink-dim`, in priority order:
`CLK` (`order.cloaked`) > `WDRW`/`SLNT` (`order.engagement`) > `SLOW` (`moveDebt > 0`) >
`INTC`/`SHDW` (`order.mission`) > `LOW` (`endurance/enduranceMax < 0.25`) > `GRP`/`SW`/`CVY`
(`unit.kind`). The rest live in the `<title>`.

*Deliberately dropped from one proposal: the 22×2.5 endurance gauge, and an unbounded code row. At a
24-unit column pitch a pill plus a gauge plus a leader plus five codes is a bird's nest wherever two
units are within two hexes — the counters would bury each other, which is the same failure the whole
pass exists to fix. `LOW` carries the one endurance fact a commander must not miss.*

**7.2.3 Cloak keeps `opacity: 0.5`.** This is the one surviving opacity-as-state, and it is there
because §5.12 of the design system mandates it by name ("Cloaked units keep `opacity: .5` **and**
gain `stroke-dasharray: 2 2`"). It is defensible as a *material* property — reduced signature drawn
as reduced signature — and it now carries three further channels (dash, no dome, `CLK`). The tension
with law 5 is real; the specific instruction for this component wins. Flagged in §11.

**7.2.4 Labels stack.** Reuse `stackLabels` / `labelHalfWidth` from `src/ui/mapLabels.ts`. It already
does exactly this job for the tactical map, its ordering is documented as stable ("the same fleet in
the same places always stacks the same way"), and it is pure with its own tests. Feed one `LabelBox`
per unit at `y = cy + 19` and one `LabelObstacle` per counter, contact and engagement disc; add the
returned shift. **This is reuse, not new code.**

**7.2.5 Co-located units fan.** Two units in one hex are one counter to anyone looking. Sort a hex's
units by `id` and offset each by `(i − (k−1)/2) · 8` units in y. Drawing only; nothing in the view
moves. Same decision `fannedFlights` already makes in `MapView.tsx`.

### 7.3 The planned route (layer 12)

Straight segments — the legs join arbitrary ordered waypoints and smoothing would lie about which
hexes they cross.

```jsx
<g pointerEvents="none">
  <polyline points={pts} fill="none" stroke="#03050b" strokeWidth={3.2} opacity={0.6} />
  <polyline points={pts} fill="none" stroke="var(--lc-sand)" strokeWidth={1.2}
            strokeDasharray="5 3.5" opacity={0.85} strokeLinecap="round" />
  {/* origin: hollow sand circle r=3 on the unit's own hex (pts[0]) */}
  {/* each waypoint: a hard 5×5 sand square — radius 0, because a plotted order is a RECORD —
     hollow, 1.2 stroke, with its index numeral 1…n at 10u offset (+9,−6) */}
  {/* legs of ≥2 hexes: hexDistance(a,b) at the midpoint, 10u sand @0.75, halo */}
  {/* terminus: a filled 7×5 sand arrowhead on the final leg's bearing,
     plus a sand hex outline on the destination hex, plus `PLOT n HEX` (total distance) */}
</g>
```

What this gains over today's bare polyline: a dark under-stroke so the route survives crossing a
nebula, countable legs, leg lengths the view already holds and currently throws away, and an order
that visibly **ends in a hex**. Sand throughout — sand is "your plan and where you are" and must not
read as a second friendly force.

**The dash does not march.** Nothing on this map animates (§8).

### 7.4 Contacts (layer 13) — marks on the glass

Hollow **and** dashed is the frozen withheld-identity channel and it is preserved verbatim.

**(a) Uncertainty as hex geometry — the single best play idea in the three proposals.** Not a circle:

```ts
const u = Math.min(contact.uncertainty, 3)          // cap: u=3 is already 37 hexes
const cloud = allHexes-within-u-of(contact.hex).filter(h => inBounds(h, W, H))
const d = regionPath(cloud)                          // u=1 → 7 hexes, u=2 → 19, u=3 → 37
```

```jsx
<path d={d} fill={foe} fillOpacity={0.05} stroke={foe} strokeOpacity={0.30}
      strokeWidth={0.8} strokeDasharray="3 4" fillRule="evenodd" />
```

A commander now reads *"it is somewhere in these nineteen hexes"* instead of *"there is a fuzzy circle
here"*. The drift the reckoning may hide is stated in the units the game is played in. The wash is
**flat**, not a gradient, on purpose: the mechanic is uniform drift per unscanned round, so a bright
centre would imply a probability peak the rules do not model.

**(b) The counter.** A **weaker plate** (`r=12`, `opacity 0.55`), no dome, no glow. That asymmetry
against a unit's full plate is the design.

| datum | source | treatment |
|---|---|---|
| size band | `attributes.sizeClass` | diamond half-width 5 / 6.5 / 8; unknown → 6 |
| position estimated | `positionEstimated` | **two reckoning brackets** (⌐ ¬ corner ticks) flanking the diamond, 0.9 stroke — **replaces `opacity: 0.75`**, removing the second law-5 violation |
| position fixed | `!positionEstimated` | a 5-unit `+` fix cross at the exact centre, 0.8 |
| age | `view.round − lastScan.round` | dash sparsity `3 3` → `2 4` → `1 5`: the mark literally dissolves as intel ages. Plus an `R+n` tag at 10u, `--ink-mute`, upper right, when n ≥ 1 |
| collapsed | `collapsed` | `fillOpacity 0`, dotted `1 4`, and the existing `last known` label — unchanged |
| live | `!collapsed` | `fillOpacity 0.18` in `foe` |
| selected | `selectedContactId` | a sand bracket frame (four corner ticks, 1.6) — which does not cover the mark the way a fat ring does |

**(c) The label.** The existing priority chain
(`shipClass → faction → sizeClass → bearingClass → 'contact'`) is preserved exactly, uppercased, at
**10u** (was 9), in `foe`, with a `#03050b` `paintOrder="stroke"` halo. An attribute whose
`ViewedAttribute.stale` is true renders in `--ink-mute` instead of `foe` — matching the dossier's
rule that stale intel recedes rather than fades.

**(d)** `<title>`: `Contact ct-A-3 · large · military · last fix round 2 phase 9 · position estimated,
drift up to 2 hexes`. Every visual channel restated in words.

### 7.5 Engagements (layer 15)

Position, hue and the ⚔ are unchanged. It gains a **place**:

```jsx
<g pointerEvents="none">
  <polygon points={hexPoints(engagement.hex, HEX)} fill="var(--lc-orange)" fillOpacity={0.12}
           stroke="var(--lc-orange)" strokeOpacity={0.7} strokeWidth={1.4} />
  <path d={`M${cx},${cy}V${cy - 10}`} stroke="var(--lc-orange)" strokeWidth={1} opacity={0.7} />
  <circle cx={cx} cy={cy - 18.5} r={13}  fill="url(#cm-plate)" />
  <circle cx={cx} cy={cy - 18.5} r={8.5} fill="var(--lc-orange)"
          stroke="rgba(0,0,0,0.65)" strokeWidth={1} />
  <circle cx={cx} cy={cy - 18.5} r={8.5} fill="url(#cm-dome)" />
  <text y={cy - 14} fontSize={13} fill="var(--ink-on-fill)" textAnchor="middle">⚔</text>
  <text y={cy - 30} fontSize={10} fill="var(--lc-orange)" textAnchor="middle"
        paintOrder="stroke" stroke="#03050b" strokeWidth={2.4}>{tag}</text>
  <title>{…}</title>
</g>
```

`tag` is `AMBUSH` (`youAmbush`), `CAUGHT` (`youWereCaughtRetreating`), or `R{round}·P{phase}` — all
three already in `ViewedEngagement` and all three currently discarded by the map. A stem and a
filled hex tie the marker to its hex; today it floats 18 units off with nothing connecting it. It is
a domed chit like a unit, because a battle waiting is an object on the table.

The tinted hex is the one hex-shaped tint left on the plot, and it is a counter's footprint, not
terrain: one hex, at most three of them on a map, in the campaign's "act now" hue.

**No pulse, no flash, no glow.** The sidebar's orange panel is the escalation channel.

### 7.6 Legend (layer 16)

Same reserved band, `legendLeft = −HEX`, `legendTop = height − 32`, `LEG_STEP = 62`,
`aria-hidden="true"`, plus `pointerEvents="none"`. Type rises **9 → 10** (the doc reserves 9 for dead
codes); rows move to baselines `legendTop + 12` and `legendTop + 27`, which still clears the viewBox
bottom by ~5 units because the labels are uppercase and have no descenders.

Every swatch is drawn with **the same defs the map uses**, because an approximated swatch teaches the
wrong reading:

| row | cells |
|---|---|
| 1 | **SYSTEM** `r=5.5` disc of `url(#cm-corona)` + `r=1.4` core `#fff6de` · **NEBULA** `r=6` disc of `url(#cm-neb-core)` + a `2.5 3.5` dashed plum ring at `r=5` (no filter in the legend — the gradient alone reads at this size) · **DUST** an 11×11 rect `#14100a` + `url(#cm-grain)` + a `2.5 3.5` dashed orange rim · **FRONTIER** a 16-unit `--red` `7 5` dashed segment with one hachure |
| 2 | **YOURS** `r=5.5` `own` + `url(#cm-dome)` + black keyline + a leader with one chevron — identical recipe to the map · **CONTACT** the hollow dashed diamond, unchanged · **BATTLE** `r=5.5` orange + dome · **INFRA** `⬢` in a ring |

Right-aligned on row 1, unchanged and still guarded by `width > 300`:
`PLOT 30 × 22 HEXES`.

Root `aria-label` is upgraded from `"Campaign map"` to a computed sentence — free, and the only
screen-reader access this component has beyond the `<title>`s:

```
`Campaign plot, ${w} by ${h} hexes. ${units.length} of your units, ${contacts.length} contacts, ${engagements.length} battles waiting.`
```

---

## 8. How the counters stay readable

Six devices, applied without exception.

1. **The plate.** Every counter opens with a `url(#cm-plate)` disc — a soft dark pool fading to zero,
   no filter, one shared def. It restores local contrast wherever a nebula, corona or star field sits
   underneath. Units get it at full strength (`r 13`); contacts, infrastructure and the engagement
   disc weaker, because a report should look less substantial than a fact.
2. **The label halo.** Every piece of on-plot text takes
   `paintOrder="stroke" stroke="#03050b" strokeWidth={2.4} strokeLinejoin="round"`, which paints a
   1.2-unit ground-coloured outline around each glyph *before* the fill. Zero extra nodes, zero
   filters, guaranteed legibility over a star or a nebula core alike. This is the app's own idiom
   (`.mission-label`, `styles.css`).
3. **A hard ink ceiling under the counters.** Nothing in layers 2–10 exceeds **0.34 alpha**, with one
   exception: the star cores and system cores, which are ≤ 24 marks of ≤ 4 units. Counters sit at
   opacity 1 with `--ink-on-fill` digits (black on `--blue` is 8.6:1, on `--red` 6.9:1, on
   `--lc-orange` 10.0:1), so **no ground element can contribute to a counter's own contrast at all.**
4. **Frequency separation.** The dust grain is a 12-unit lattice; a counter is 16–26 units across.
   Ground texture is coarse enough to read as matter and fine enough that the eye segments figure
   from ground rather than merging them. No two textures on this plot share a period — grain is the
   only pattern, and the nebula's structure is blur and knots, not a screen.
5. **The vignette is a ground layer** (position 6). It seats the field and never dims a mark, a rule
   or a legend entry.
6. **Silhouette from the rim, not the fill.** `cm-dome`'s 30% black outer stop darkens every
   counter's edge, so `--blue` on a plum nebula still has a hard boundary; the keyline runs
   `rgba(0,0,0,0.65)`.

**Type floor.** All on-plot type is **10 user units** — up from 9 for unit names, contact labels and
the legend. At the shipped layout (1600×1000 window, ~1165×905 map column) the viewBox letterboxes
on height and the scale is ≈ 1.38, so 10u renders at ≈ 13.8 CSS px. The floor is the *rendered*
10px; it holds down to a plot height of ~730 CSS px. Below that — a window under about 1100×780 —
rendered type drops under the floor. That is a pre-existing condition made better, not worse, by this
pass, and the fix if wanted later is a `min-height` on `.campaign-map`, **not** a per-label bump:
raising labels past 10u collides adjacent unit names at the 24-unit column pitch. Flagged in §11.

**Second channels, all preserved, five added.** Contact = hollow **and** dashed (unchanged). Cloak =
dim **and** dashed **and** no dome **and** `CLK`. Terrain = three distinct *forms*: a point of light,
a translucent cloud stars shine through, a dark opaque hole that eats them — which is a genuine
accessibility gain over three tints of similar value, and exactly why "system and dust are nearly the
same dull brown" was possible. **New:** frontier dashed **and** hachured; destroyed infrastructure
struck through at full opacity; estimated contact position bracketed rather than faded; contact age
as dash sparsity **and** `R+n`; speed as a chevron count and heading as an arrow's direction.

**Opacity is no longer a record state** anywhere except the doc-mandated cloak.

---

## 9. Performance (constraint 4)

### 9.1 The architecture — which matters more than the node count

Layers 1–10 depend **only** on `view.map`, which is structurally constant for an entire campaign
(`types.ts:31-33` — the map is stored whole and "never regenerated at load"). They go in one child
component wrapped in `React.memo`.

**They cannot be memoised on `view.map` itself.** `viewFor()` does `map: structuredClone(map)`
(`views.ts:156`) — **a fresh object on every single render.** Keying on `view.map` re-runs every
merge every render and is the biggest performance landmine in this change. Key on a signature:

```tsx
const sig = useMemo(() => mapSeed(view.map).toString(16), [view.map])
const scenery = <Deepspace sig={sig} map={view.map} side={view.side} />
// React.memo(DeepspaceImpl, (a, b) => a.sig === b.sig && a.side === b.side)
```

`mapSeed` is the same FNV-1a as §5.1 — ~660 integer ops, microseconds — and doubles as the RNG seed,
so the signature costs nothing extra. Inside `DeepspaceImpl` every derived geometry lives in one
`useMemo([sig])`.

**Consequence: the entire cost of §6 is paid once per campaign, not once per click.** Selecting a
unit, plotting a waypoint or ending a phase reconciles only layers 11–16.

### 9.2 Filter arithmetic, stated honestly

The blur is applied **per component, never to a group holding all of them.** A group's filter region
is the union bounding box, which for scattered blobs is most of the map — that is the expensive
mistake, and it is the only way this design gets slow.

An 8-hex blob's bbox is ≈ 130×110 user units; +40% margin at the shipped 1.38 scale and 2× DPR is
≈ 500×425 device px ≈ 0.21 MP. Six nebulae ≈ 1.3 MP; four dust belts at the tighter margin and
`stdDeviation 3` ≈ 0.6 MP. **≤ 2 MP total, rasterised once and retained**, because the subtree is
memoised and structurally identical between renders. Per-hex filters would be 660 buffers.

**Hard guard to write in: if a component exceeds 24 cells, drop `filter` on that group** and let the
gradient body carry it unblurred. The generator's maximum blob is 8; a hand-authored map could
exceed, and an unbounded filter region is the one thing that must not be possible.

### 9.3 The ledger, 30×22 = 660 hexes

| layer | nodes | filtered elements |
|---|---|---|
| defs | 18 | — |
| ground | 1 | 0 |
| starfield (~430 stars) | 36 | 0 |
| nebulae (3–6) | ~24 | **3–6** |
| dust (2–4) | ~24 | **2–4** |
| systems (8–14) | ~42 | 0 |
| vignette | 1 | 0 |
| mesh + edge + lit | 3 | 0 |
| terrain rims | 2 | 0 |
| grid fixes | ~27 | 0 |
| frontier | 5 | 0 |
| **scenery total — never re-reconciled after mount** | **≈ 183** | **5–10** |
| counters, typical force | ~150 | 0 |
| legend | ~40 | 0 |
| **today, for comparison** | **682 + counters, ALL re-reconciled every render** | 0 |

**Fewer total nodes than today, and 55% of them never re-reconcile.** Per-interaction reconciliation
drops roughly 5×. The mesh alone goes from 660 DOM nodes with a fill *and* a stroke each to one
stroked path with no fill; its only cost is a ~62 KB `d` string built once.

Two further cheap wins: everything except the ground rect and the interactive counter groups carries
`pointerEvents="none"`, so mousemove never hit-tests a 2,000-segment path; and nothing on the plot
animates, so the well is never repainted between state changes.

---

## 10. The do-not-do list

1. **No per-hex filter, gradient, pattern or `<defs>` entry.** Every effect is a shared def, a merged
   path, or one of at most ten individually-bounded filtered groups.
2. **No animation anywhere on the plot.** No dash march on the route, no engagement pulse, no star
   twinkle, no hover transition. §6 of the design system: "nothing on the play surface moves", and
   `background-position` on a starfield is on its never-animate list. `campaign.css` §9 says the plot
   never animates at all. **This discharges `prefers-reduced-motion` by construction** — there is no
   motion to suppress and therefore no reduced-motion path that can rot. Stronger than a media query.
3. **No `feTurbulence`.** Best grain in SVG, most expensive primitive in the spec, and it would need
   a real filter region per belt. A 12×12 `<pattern>` of seven dots rasterises one tile.
4. **No side-tinted territory.** One proposal washes each half in 5–6% of its side hue. It puts a
   large field of the exact counter hue behind the counters — the precise bug `campaign.css` already
   records for the old radial — and "who holds this hex" is not a fact `SideView` carries anyway.
   Rejected on both constraint 2 and readability.
5. **No invented hero nebula, galactic band or off-centre wash.** Luminance is information. The
   ground is radially symmetric; every asymmetry is terrain.
6. **No hex-shaped terrain tile anywhere — including in the legend**, where a tinted square would
   re-teach the reading this whole pass removes. The engagement hex is the one hex-shaped tint left,
   and it is a counter's footprint.
7. **No rim on the nebula's *glow*.** The exact extent is stated once, by the dashed merged rim in
   the instrument layer. Outlining the cloud as well would put the tile back.
8. **No three-stroke "soft" falloff on a merged outline.** Stacking 14/8/3.5-wide strokes on a path
   with 120° corners produces a visible stepped rim at every vertex and reads as concentric outlines,
   not gas. Six bounded blurs are affordable and correct.
9. **No 5-unit stipple or hatch screens.** Two fine textures at the same period, at low alpha on
   near-black, at a scale the container chooses, moire unpredictably — and moire on a map is
   indistinguishable from data. One coarse rotated grain, for dust only.
10. **No edge rulers, no gutters, no viewBox change.** The grid fixes give the same reference for a
    quarter of the ink, and no ruler on a skew axial grid is literally true off column 0.
11. **No system names, no lore.** Nothing may be invented that the wall would have had to hand over,
    and a derived catalogue name is a second big label per system competing with unit names.
12. **No detection or sensor-range rings**, no fog over unscanned space, no contact heading. All
    three are the component performing or inferring a rules computation — the exact failure
    constraint 2 exists to prevent. Ignorance on this plot is shown by what is *absent*, which is
    also the honest cartographic answer: an unsurveyed area is blank paper, not shaded paper.
13. **No per-hex coordinate text.** 660 text nodes would cost more than everything else combined and
    would drown the counters.
14. **No `view.incoming` on the plot.** Reinforcements have an arrival round but no hex; there is no
    honest place to put them. The sidebar owns them.
15. **No round/phase/VP readout in the legend band.** §5.12 assigns those to the status strip.
16. **No hover crosshair or coordinate readout.** It puts a `setState` on `mousemove` and re-renders
    the counter layers at frame rate, for information the grid fixes already give statically.
17. **No zoom or pan.** There is no prop for it, and a transformed `<g>` around the plot breaks
    `pixelToHex` (§1).
18. **No CRT scanlines, phosphor glow or bloom.** The plot reads as an instrument from its vocabulary
    — mesh, fixes, hachures, codes, tags — not from a screen-effect costume.
19. **No drop-shadow or glow filter on any counter.** Plates and casings do the same job at one node
    each and zero filter cost.
20. **No new side hue.** The dome is white/black at ≤ 34%, a pure value overlay. `--blue` and `--red`
    are untouched; contacts keep the opposing token; engagements keep `--lc-orange`.
21. **No elevation language in the legend or any chrome.** The no-bevel law stands everywhere except
    the depicted play surface.
22. **No keyboard focus added to the counters in this pass.** They are click-only today; making the
    `<g>`s focusable is a real and separate improvement, and bolting an untested tab order into a
    500-node SVG inside an art-direction change is how it ships broken. Flagged, not done.

---

## 11. Constraint-1 audit, and what to confirm before merging

| drawn today | still drawn | how it changed |
|---|---|---|
| hex mesh | ✅ | 660 polygons → 1 memoised path, each edge once, centre-lit |
| terrain system | ✅ | tint → corona + flare + core + promoted hex edge |
| terrain nebula | ✅ | tinted hexes → merged blurred cloud + knots + dashed merged rim |
| terrain dust | ✅ | tinted hexes → merged opaque belt + grain + clumps + dashed merged rim |
| contested border | ✅ | 22 dashed rings → merged corridor + smoothed hachured frontier |
| infrastructure glyph + ring | ✅ | + plate, + halo, + holding glow, + destruction strike, opacity restored to 1 |
| planned route | ✅ | + casing, waypoint records with indices, leg lengths, arrowhead, destination hex |
| contact diamond (hollow + dashed) | ✅ | verbatim; + size band, fix cross, brackets, age dash + `R+n` |
| contact uncertainty ring | ✅ | circle → **merged hex region** in the units the game is played in |
| contact label + priority chain | ✅ | verbatim; 9u → 10u, + halo, stale → `--ink-mute` |
| own unit disc + count + name | ✅ | + plate, dome, rim, heading leader, speed chevrons, ≤2 codes, label stacking, fan |
| engagement disc + ⚔ | ✅ | + plate, dome, stem, hex, tag from `ViewedEngagement` |
| legend | ✅ | rebuilt from the real defs; 8 cells in 2 rows; 9u → 10u |
| `PLOT w × h HEXES` | ✅ | verbatim, same `width > 300` suppression |
| — | **new** | starfield, vignette, grid fixes, plot edge, `<title>`s, richer `aria-label` |

Props, handlers, `role="img"`, the legend's `aria-hidden` and the `pixelToHex` click path are
untouched except for the bounds guard in §1.

**Confirm before merging:**

1. **Hachure direction.** `sign = view.side === 'A' ? -1 : +1` assumes A holds the low-`q` side —
   how design doc 2.3 reads ("a jagged line of hexes A-side of which is A's") and how `generateMap`
   seeds `bq = floor(width/2)` with side A's units starting top-left. Cosmetic: if inverted the ticks
   face the other way and nothing misreads. Confirm and flip the constant if wrong.
2. **Cloak opacity.** §7.2.3 keeps `opacity: 0.5` because §5.12 mandates it by name, against law 5's
   "opacity means unavailable". Confirm which wins; if law 5 wins, drop to opacity 1 and let dash +
   no-dome + `CLK` carry it.
3. **The click bounds guard** (§1) changes behaviour for clicks in the legend band.
4. **Type floor at narrow widths** (§8): rendered type falls under 10px below a plot height of
   ~730 CSS px.

**Verification checklist:**

1. `onClickHex` fires with the correct hex for a click on empty ground, on a star, inside a nebula,
   inside a dust belt and inside the border corridor. The ground rect must be hit-testable; the
   vignette and every scenery layer must not be.
2. `onClickUnit` / `onClickContact` still `stopPropagation` and still select. The contact's
   uncertainty region is inside its group and is therefore clickable — it should be, it is part of
   the contact.
3. Nothing in the component reads anything outside the `view` prop.
4. `DeepspaceImpl` does not re-render on select / deselect / waypoint add / phase end. Verify with a
   `console.count` during a plotting session: it prints once.
5. Two renders of the same campaign file produce byte-identical starfield and knot coordinates.
6. A side-B commander sees `--red` counters and `--blue` contacts.
7. `prefers-reduced-motion: reduce` changes nothing on this screen, because nothing moved.
8. `regionPath` unit tests: a single hex → 6 segments, one closed loop; two adjacent hexes → 10
   segments, one loop; a ring of six around an empty centre → two loops, `evenodd` leaves the hole;
   two lobes pinched at one corner → two loops, neither dropped.
