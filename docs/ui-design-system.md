# StarForce Commander — UI design system

**Foundation layer:** `src/ui/theme/tokens.css` (imported from `src/main.tsx` *after* `src/ui/styles.css`, so its token values win).
**Region layers:** `src/ui/styles.css` and the component files, edited region by region against this document.

This is the contract. If an implementation question is not answered here, answer it with §0 and §4.

---

## 0. The five laws

Everything else is derived from these. They are the difference between an LCARS console and a dark theme with orange accents.

1. **The ground is `#000000`, always.** Blocks sit on black. The gutter between two blocks is **5px of that same black** (`--gutter`). There is no elevation ramp, no card, no bevel, no sheen, no shadow except the one that separates a modal from its backdrop.
2. **The radius law: half the height on a free end, `0` on an attached end, nothing else.** `border-radius: 0 999px 999px 0` on a fixed-height bar *is* the law — 999px resolves to exactly half the height. Never put `--r-free` on a container whose height is not fixed; a tall panel is square and its **cap bar** carries the turn.
3. **Borderless.** There are no borders in the chrome. Four exceptions, and no fifth: `.is-linked`, `.is-degraded`, `.is-down`, and the printed-record tables. Everywhere else, structure is carried by ground, fill and gutter.
4. **`#000` ink on every bright hue** (`--ink-on-fill`). One token. Every chrome hue and both side colours clear 5.8:1 against it.
5. **Records never dim; controls do.** `opacity` below 1 means exactly one thing: *this control is unavailable*. It never means "not editable right now" and never means "destroyed" or "stale". Those states get their own treatment (§7).

Two supporting laws:

- **Shape carries class.** Three shapes, three meanings (§4.3). A player can tell what a thing *is* without reading it.
- **The accent ration.** `--lc-orange` appears in at most **three roles per screen**: the frame, the *current* item in the sequence of play, and exactly one `.primary` control. There are 77 orange references in the current file; this rule costs zero pixels and is the largest single change to the screen's character.

---

## 1. Palette

### 1.1 Rules information — FROZEN, do not touch

These carry game state. Values, hues and meanings are unchanged. Chrome never borrows them; this pass never repaints them. **Side identity DOES use `--blue`/`--red` — that is their meaning.**

| token | value | meaning | on `#000` |
|---|---|---|---|
| `--blue` | `#5aa9ff` | side identity (blue force), blue die | 8.6:1 |
| `--red` | `#ff5c5c` | side identity (red force), red die, structure red band | 6.9:1 |
| `--green` | `#46c46f` | power dot, filled circle, arming, green die, `.is-linked`, `.rarity-uncommon`, `.design-ok`, `.band-green` | 8.5:1 |
| `--yellow` | `#ffc94a` | yellow die, damage-control marker (`.track-dc`) | — |
| `--warn` | `#ffb020` | degraded mount, slow-arming gate, design problems, unattended-side banner | — |
| `--danger` | `#ff5c5c` | destroyed box, shield down, excess damage | — |
| `--accent` | `var(--lc-orange)` | the primary action | — |

Also frozen, in full: `.die-*`, `.roll-*`, `.band-green` (colour **and** underline), `.band-red` (colour **and** italic), `.track-box.track-red` / `.track-black` / `.track-dc`, `.rarity-common/-uncommon/-rare/-unique/-unavailable`, `.tick-round` / `.tick-volley` / `.tick-kill` (colour **and** their 15/9/17px heights), `.online-phase[data-phase='connected']`, `input[type=checkbox] { accent-color }`, and the hollow-vs-solid battery distinction `.dot.bty:not(.is-charged)` — that asymmetry is a deliberate fix, do not fill both states.

### 1.2 The third side — the collision every direction missed

The Aurelian side (Expansion 5) is **rules information wearing chrome token names**:

- `styles.css:1081` `.ship-aurelian .glyph-trim { fill: var(--lc-lilac) }` — its counters, **on the play surface**
- `styles.css:3143` `.fleet-side.picker-aurelian > header h3 { color: var(--lc-lilac) }`
- `styles.css:2231` `.picker-aurelian { border-left-color: var(--lc-plum) }` — its fleet-picker spine

Consequently:

- **`--lc-lilac` is frozen at `#cc99cc`.** It may not be retuned, ever, while `.glyph-trim` reads it.
- **`--lc-plum` is retuned** (§1.3), so the Aurelian spine must be repointed onto its own token first — see §11 *Required first edits*.

Two frozen side tokens exist for this: `--side-aurelian` (`#cc99cc`, the exact original lilac) and `--side-aurelian-deep` (`#7d5ba6`, the exact original plum). `--side-blue` / `--side-red` alias `--blue` / `--red` for symmetry.

### 1.3 Chrome hues

Seven hues, one fixed meaning each, applied as **solid blocks with `#000` ink** — never an outline, never positionally, never cycled. Three values change, each for a stated defect; the rest are the identity and are untouched.

| token | value | change | role | on `#000` |
|---|---|---|---|---|
| `--lc-orange` | `#ff9c00` | — | frame · current segment · **the one** primary action | 10.0:1 |
| `--lc-sand` | `#ffcc66` | — | time and place: round/phase, "you are here", derived readouts, labels | 14.1:1 |
| `--lc-lilac` | `#cc99cc` | **frozen** (§1.2) | archive & browse: library, systems section, optional-rule switches | 9.0:1 |
| `--lc-peri` | `#9c9cff` | — | design & edit: builder, designer, order forms, editable fields | 8.6:1 |
| `--lc-sky` | `#57c8d4` | was `#79b8ff` | session / network / navigation / intel | 10.6:1 |
| `--lc-salmon` | `#ff8fa3` | was `#ff7b6b` | combat, launch, destructive-adjacent chrome | 7.6:1 |
| `--lc-plum` | `#9a72c9` | was `#7d5ba6` | structure: sequence ground, footer, log, rail terminator | 5.8:1 |
| `--lc-plum-deep` | `#4a3466` | new | structural ground and rail filler (the old plum's real job) | ink `--ink` at 9.1:1 |

Why the three changed:

- **sky** — `#79b8ff` sat 12 units from the rules colour `--blue #5aa9ff` and was used as a *chrome fill* on `.view-chips .chip.is-on`, `.command-card`, `.intel-panel` and the rail side blocks, i.e. next to or instead of side identity. At 10px, chrome-sky and side-blue were the same colour. `#57c8d4` is cyan-teal: unambiguously not `--blue`, not `--green`.
- **salmon** — `#ff7b6b` was a desaturated `--red`, spining the combat panel, weapon blocks and damage control, exactly where red dice and red damage boxes live. `#ff8fa3` is rose: ΔE 32.8 against rules red (vs 27.6 for the rejected `#f2668c`) and L\* 71.9 against red's 61.4, so it separates on lightness as well as hue at 10px.
- **plum** — `#7d5ba6` under `.seq-phase`'s `#0d0616` ink scores ~3.8:1 at 8.4px: the sequence of play failing AA. Split into a light fill (`--lc-plum`, 5.8:1 with `#000`) and the original dark value kept as `--lc-plum-deep` for the grounds and filler it was actually good at.

`--lc-peri` is **not** retuned: it is violet-side and much lighter than `--blue`, and every token change is a chance to repaint something load-bearing. Three changes, three named defects.

### 1.4 Two tokens that were never defined

`styles.css` references `--lc-gold` (lines 1990, 2003) and `--lc-red` (4375, 4428, 4440) with inline fallbacks, so the app silently ran a second gold (`#ffb851`) and a second red (`#ff4d4d`) a few hex points from tokens that already existed. Both are now defined as aliases — `--lc-gold: var(--lc-sand)`, `--lc-red: var(--red)` — and the duplicates disappear with no markup change.

### 1.5 Ground, surfaces, edges

| token | value | use |
|---|---|---|
| `--bg` | `#000000` | **the ground**, and the 5px gutter between blocks |
| `--stage` | `#05060b` | the near-void behind stage content where a hair of separation is wanted |
| `--panel` | `#0a0c12` | panel ground |
| `--panel-2` | `#141826` | row / chip / control rest inside a panel |
| `--panel-3` | `#1f2438` | hover / selected row — the only lit state |
| `--well` | `#05070d` | recessed well: map ground, text-input interior |
| `--line` | `#2a3350` | **the four border exceptions and the printed-record tables only** |
| `--edge` | `var(--line)` | back-compat alias |
| `--backdrop` | `rgba(0,0,0,.82)` | modal backdrop |

There is deliberately **no** `--hair`, `--line-soft` or separator-alpha token. Records are separated by **5px of black**, not by a hairline, and not by zebra striping — striping at 2% alpha is invisible on a near-black panel and is a spreadsheet idiom regardless.

### 1.6 Ink

| token | value | use | on `--panel` |
|---|---|---|---|
| `--ink` | `#e9edf7` | values, prose, primary labels | 17.6:1 |
| `--ink-2` | `#c3cce0` | secondary prose | 12.6:1 |
| `--ink-dim` | `#9fabc6` | labels, captions, meta | 9.1:1 |
| `--ink-mute` | `#7f8ca8` | receding captions; legal down to the 10px floor | 6.2:1 |
| `--ink-on-fill` | `#000000` | **the one ink on every bright hue**; alias `--lc-ink` | ≥5.8:1 on all |
| `--ink-on-deep` | `var(--ink)` | on `--lc-plum-deep` | 9.1:1 |

There are **no** per-hue near-black inks. At 11px on a saturated fill, `#150c00` and `#000` are indistinguishable, and seven tokens are seven chances to pick the wrong one.

`.title-footing`'s `opacity: .8` is deleted — 12px at 3.4:1 fails AA. `--ink-mute` at full opacity does the receding job legally.

### 1.7 Facing sub-palette

One facing key across the whole app — the ship form's shield rows, the shields table column heads and `ArcRose` all use these and nothing else.

| token | value | facing |
|---|---|---|
| `--face-f` | `var(--lc-sand)` | fore |
| `--face-s` | `var(--lc-peri)` | starboard |
| `--face-a` | `var(--lc-lilac)` | aft |
| `--face-p` | `var(--lc-sky)` | port |

`--face-a` shares lilac with the Aurelian counter trim. Different surfaces (a 14px form swatch vs an SVG counter on the map), acceptable — but do not add a *second* lilac use on the play surface.

### 1.8 Hue → zone assignment (fixed, never positional)

| hue | zone |
|---|---|
| orange | frame; the current segment; the one primary action |
| sand | time and place — round/phase, "you are here", derived readouts, section labels |
| sky | session / network / navigation / intel |
| peri | design & edit surfaces |
| lilac | archive & browse; optional/house rules |
| salmon | combat, launch, destructive-adjacent |
| plum / plum-deep | structure — sequence ground, footer, log, rail filler, map wells |

Panel spines: `.ops-panel` orange · `.cloak-panel` plum · `.abandon-panel` salmon · `.scout-panel` sky · `.formation-panel` peri · `.flight-ops` sand · `.boarding-panel` salmon · `.command-systems` sand · `.cloud-panel` lilac · `.intel-panel` sky · `.ship-form` lilac · `.command-card` sky · `.combat-panel` salmon · `.damage-control` salmon · `.log` plum · `.scenario-brief` peri · bare `.segment-help` orange.

Modal spines: FleetPicker orange · ShipBuilder / ScenarioDesigner peri · Library lilac · Online / Remote sky · ReplayTheater plum · BattleSummary sand · DamageChoice `--red` · campaign-menu plum.

`.builder-section`'s `:nth-of-type(3n+…)` cycle is **deleted** (inserting one section repaints every panel below it). Add `data-block={slug(title)}` in `Section()` and key the zone off it: identity peri · power sand · sublight sky · defenses salmon · weapons salmon · systems lilac · cost sand.

---

## 2. Type

### 2.1 Faces

```css
--font-ui:    'Inter','Segoe UI',system-ui,sans-serif;
--font-lcars: 'Antonio','Oswald','Roboto Condensed','Arial Narrow',
              'Helvetica Neue Condensed','Liberation Sans Narrow', var(--font-ui);
```

No webfonts are loaded and none may be added — the app must work offline under a strict CSP. `--font-lcars` therefore frequently resolves to Inter or Arial Narrow. Rules that follow:

- **No layout may depend on the condensing.** Size every label column for the **Inter fallback**. Where a condensed run must not overflow, use `min-width: 0` + `text-overflow: ellipsis`, never a fixed `ch` width.
- **Never `transform: scaleX()`** to fake condensing — it destroys the letterfit where Antonio *is* present.
- Keep `font-stretch: condensed` on `--font-lcars` runs (engages the condensed axis on variable faces, inert elsewhere).
- The title wordmark carries its impact through **weight and size, not width**, and is set as two stacked words so it holds up non-condensed.

### 2.2 The scale — seven steps

Root stays **14px**. Sizes are px and exact.

| token | px | face | weight | tracking | case | used by |
|---|---|---|---|---|---|---|
| `--fs-hero` | `clamp(44px,7.2vw,76px)` | lcars | 700 | `--tr-hero` .02em | UPPER | title-screen wordmark |
| `--fs-datum` | 34 | lcars | 700 | `--tr-value` .04em | — | the round number in the elbow |
| `--fs-value` | 24 | ui | 700 | `--tr-value` | — | rail block values, large numerals |
| `--fs-title` | 17 | lcars | 700 | `--tr-title` .06em | UPPER | brand, screen titles, modal titles |
| `--fs-body` | 13 | ui | 400/700 | `--tr-none` | sentence | prose, list names, values, **every form control** |
| `--fs-label` | 11 | lcars | 700 | `--tr-micro` .10em | UPPER | chrome controls, chips, `th`, `.field > span`, panel caps, sequence rows |
| `--fs-micro` | 10 | lcars | 700 | `--tr-micro` | UPPER | micro captions, rail sub-labels, tick labels |
| `--fs-code` | 9 | lcars | 700 | `--tr-micro` | UPPER | **dead codes only** — `.foot-code`, stencil tags |

**Nothing in the app is smaller than 10px except a dead code at 9px.** Sizes being raised: `.seq-segment` 7.84→10 · `.seq-phase` and `.rail-block span` 8.4→11/10 · `.ship-tab em` 8.96→10 · `.roster-meta` 9.2→10 · `.gate` ◆ 7→10 · `.chip.arc` 9.5→10 · `.field` controls 9.8→13 · `.foot-code` 9.5 sentence-case UI → 9 uppercase condensed.

**Weights: 400 and 700 only.** Arial Narrow and Liberation Sans Narrow ship 400/700; asking for 500 or 600 gets a browser-synthesised weight that smears at 10–11px. Every current `font-weight: 600` heading becomes 700.

**Tracking law:** letter-spacing scales *inversely* with size — `.10em` at 9–11px, `.08em` at 12–13px, `.06em` at 17px, `.04em` at 24px+, `.02em` at display. The current uniform `.09em` plus `.14em` on `.foot-code` breaks word shape at the small end and looks loose at the top.

**Casing law:** uppercase belongs to `--font-lcars` chrome labels and headings, and only for runs of ≤3 words. Every sentence, hint, log line, ship-class line, tooltip and `<option>` is sentence case in `--font-ui`. `SEGMENT_SHORT` in `src/ui/sequence.ts` is uppercased to match `PHASE_SHORT`, and `"Damage Ctl"` → `"DMG CTL"`.

**Line heights:** `--lh-solid` 1 (numerals) · `--lh-tight` 1.05 (display) · `--lh-ui` 1.2 (condensed caps, rows) · `--lh-body` 1.45 (prose).

### 2.3 Numerals

Every column of digits is tabular. `tokens.css` already sets `font-variant-numeric: tabular-nums` on `b`, `strong`, `td`, `dd`, `output`, `time` and the `.tnum` utility. Add `.tnum` (or the property) to anything else that reads as a column: `.rail-block b`, `.line-value`, `.circle`, `.roll`, `.roster-pv`, `.fleet-list b`, `.summary-side td`, `.campaign-dossier b`, `.match-meta time`.

### 2.4 The single highest-value type rule

```css
.field input, .field select, .field textarea,
.picker input, .picker select, .picker textarea,
.picker-controls input, .picker-controls select,
.campaign-panel input, .campaign-panel select {
  font-family: var(--font-ui);
  font-size: var(--fs-body);          /* 13px — breaks the `font: inherit` trap */
  font-variant-numeric: tabular-nums;
  text-transform: none;
  letter-spacing: var(--tr-none);
}
.field > span, .field > label > span {
  font: var(--fw-bold) var(--fs-micro)/var(--lh-ui) var(--font-lcars);
  letter-spacing: var(--tr-micro);
  text-transform: uppercase;
  color: var(--lc-sand);
}
```

`.field { font-size: .7rem }` (styles.css:1817) plus the global `input { font: inherit }` (:139) currently renders **every form control in every modal at 9.8px**, with its label at the same 9.8px in the same face, separated only by colour. This one block is most of why the builder reads as a spreadsheet dump. Ship it in the first three commits.

---

## 3. Spacing and rhythm

### 3.1 The lattice

4px base. Legal values only: `2 4 8 12 16 20 24 32 40 48`. **2px is permitted only between marks of ≤12px** (dice, damage boxes, power dots). Everything structural is a multiple of 8.

`--sp-half 2 · --sp-1 4 · --sp-2 8 · --sp-3 12 · --sp-4 16 · --sp-5 20 · --sp-6 24 · --sp-8 32 · --sp-10 40 · --sp-12 48`

Two values sit outside the lattice on purpose:

- `--gutter: 5px` — the black gutter between blocks and between record rows. It is the LCARS signature and it is 5px of `--bg`.
- `--stage-gutter: 12px` — one value for the stage's left inset, the topbar's padding-left and the footer's, so the three finally register with each other (they are 10px/12px/0 today).

All existing `rem` paddings in a region convert as they are touched: `.7rem .9rem` → `12px 12px`; `.28rem .85rem` → `0 12px` + a fixed height; `.25rem .55rem` → `4px 8px`.

### 3.2 Standard heights — also the hit-target floors

**Nothing here is ever reduced.** If a grown control overflows its container, add `overflow-x: auto` to the container; never shrink the control back.

| token | px | thing |
|---|---|---|
| `--h-btn` | 28 | chrome control |
| `--h-chip` | 22 | chip (display or interactive) |
| `--h-cap` | 22 | panel cap bar |
| `--h-row` | 30 | scan-pitch list row (roster, matches, dossier, log) |
| `--h-row-dense` | 26 | read-pitch table row (functions, shields, repair, summary) |
| `--h-menu-row` | 56 | title-screen menu row |
| `--h-modal-header` | 40 | modal header |
| `--h-modal-foot` | 20 | modal terminator |
| `--h-rail-block` | 46 | rail data block (**unchanged** from today) |
| `--h-rail-row` | 22 | sequence phase / segment row |
| `--h-topbar-min` | 74 | topbar row minimum = `--arm-h` 34 + 40 of content |
| `--h-seg-run` | 28 | segment in a button run |
| `--sz-circle` | 22 | allocation circle (was 20) |
| `--sz-box` | 8 | printed damage box |
| `--sz-box-structure` | 13 | structural integrity box |
| `--sz-dot` | 9 | power / battery dot |
| `--sz-chip-x` | 20 | the **delete** control on a force entry (was a ~10px glyph) |
| `--sz-swatch` | 8 | rarity / side swatch |

Hit-target before → after: topbar button ~29→28 in a run · `.chip.file-chip` ~20→28 · interactive `.chip` ~15–20→22 · `.chip.arc` ~16→22 · `.chip-x` ~10→20×20 · `.circle` 20→22 · `.title-row` pills ~25→28 · `.mount` ~40×47 **unchanged, do not reduce**.

### 3.3 Row rhythm

Two pitches and only two: **scan pitch 30px** for anything the eye runs down looking for one item, **read pitch 26px** for anything the eye reads as a block. Set `line-height` in px on rows so a 30px row with 11px text has even leading top and bottom.

---

## 4. Geometry

### 4.1 The radius law

> **Half the height on a free end · `0` on an attached end · nothing else.**

`border-radius: 0 var(--r-free) var(--r-free) 0` on a fixed-height element resolves to exactly half its height, so `--r-free: 999px` **is** the law rather than an approximation of it. There is no `--r-block: 10px`: a single fixed radius reads nearly stadium on a 22px cap bar and as a rounded rect on a 56px menu row — same token, two shape families, which is how you get "dark theme with orange".

**Never put `--r-free` on a container whose height is not fixed.** A tall panel body is square (`--r-cell`); its **cap bar** carries the turn.

| token | value | use |
|---|---|---|
| `--r-cell` | 0 | records: rail blocks, table cells, damage boxes, sequence rows, panel bodies |
| `--r-mark` | 0 | dice, hit boxes, swatches |
| `--r-free` | 999px | the free end of a fixed-height bar |
| `--r-pill` | `var(--r-free)` | play-surface control (both ends free) |
| `--r-input` | `var(--r-free)` | text/number/search input |

Every existing radius migrates: 2px, 3px, 4px, 5px, 6px, 8px, 8.4px, 10px, 12px, 14px, 16px, 20px, 52px are all **deleted**. A record goes to 0; a fixed-height bar goes to `0 999px 999px 0`; a play-surface control goes to `999px`; the frame corners take the elbow/foot tokens below.

### 4.2 The elbow

**Identity: `outer = inner + arm`.** Violate it and the corner reads as a mitre — which is exactly what the current one is, because the arm is a `border-top` on the topbar and a border cannot carry an inner radius.

Top-left command corner: **arm 34 · inner 34 · outer 68** (`--arm-h`, `--elbow-in`, `--elbow-out`).

```css
.app {
  display: grid;
  grid-template-columns: var(--rail-w) minmax(0, 1fr);
  /* NOT a fixed row: 13 controls plus a scenario select do not fit one line
     below ~1180px, and a control that runs off the edge is unreachable.
     74px = 34px arm + 40px of content, which is exactly today's minimum. */
  grid-template-rows: minmax(var(--h-topbar-min), auto) minmax(0, 1fr);
  padding: 0;                      /* the frame bleeds to the bezel */
  background: var(--bg);
  column-gap: var(--gutter);
}

.lcars-elbow {                     /* the stem */
  grid-area: 1 / 1;
  margin-right: calc(-1 * var(--gutter));   /* one continuous shape across the gutter */
  background: var(--lc-orange);
  border-radius: var(--elbow-out) 0 0 0;    /* bottom-left square: the rail continues it */
  display: flex; flex-direction: column;
  align-items: flex-end; justify-content: flex-end;
  padding: 0 10px 6px 0;
  color: var(--ink-on-fill);
}

.topbar {                          /* the arm + the concave fillet, as backgrounds */
  grid-area: 1 / 2;
  padding: var(--arm-h) var(--stage-gutter) 0;
  border: none;
  border-top-right-radius: var(--elbow-in);
  background:
    linear-gradient(var(--lc-orange) 0 0) 0 0 / 100% var(--arm-h) no-repeat,
    radial-gradient(circle var(--elbow-in) at 100% 100%,
      transparent 0 var(--elbow-in), var(--lc-orange) var(--elbow-in))
      0 var(--arm-h) / var(--elbow-in) var(--elbow-in) no-repeat,
    linear-gradient(var(--panel) 0 0);
}
```

Read the fillet cell: it occupies x∈[0,34], y∈[34,68] of the topbar. Its circle centre is its own bottom-right corner; points farther than 34px from that centre paint orange — the crescent between the arm's underside and the stem's right edge, arcing from (34,34) to (0,68). That is the LCARS sweep.

The elbow earns its 104×68px of the most saturated colour on screen by carrying the **round number**: `--fs-datum` over a `--fs-micro` `ROUND` label, both `--ink-on-fill`. It is a decorative duplicate of `.sequence-bar .round`, which stays the accessible source — keep `aria-hidden="true"` on the elbow so the number is not announced twice, and remove the now-redundant `.rail-orange` round block from the rail.

### 4.3 The rail, the terminator and the foot

The rail is **one straight 104px spine**. Every interior block is square (`--r-cell`); only the two ends turn.

The closing corner is deliberately **lighter than the opening one** — arm 20 · inner 20 · outer 40 (`--foot-arm`, `--foot-in`, `--foot-out`) in `--lc-plum-deep`. The eye lands top-left; the bottom only has to close the frame. `.foot-cap` is deleted — the corner *is* the cap. (Note: `.foot-cap` **is** rendered by `App.tsx` today; remove the markup in the same commit, it is not dead CSS.)

The ~500px void below the sequence list becomes the rail's most characteristic feature, with **zero markup**:

```css
.rail-sequence { flex: 0 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.lcars-rail::after {
  content: ''; order: 1; flex: 1 1 0; min-height: 0;
  background: repeating-linear-gradient(180deg,
    var(--lc-plum-deep) 0 22px, transparent 22px 27px);
}
.rail-cap { order: 2; min-height: 64px; background: var(--lc-plum-deep);
            border-radius: 0 0 0 var(--foot-out); margin-top: auto; }
```

`flex: 0 1 auto` on the sequence list is load-bearing: grow 0 so it stops claiming the void the filler now occupies, shrink 1 so five phases plus six open segments still scroll rather than being cut off.

### 4.4 Shape carries class

| shape | radius | means | examples |
|---|---|---|---|
| **Cell** | `0` | a **record** | rail blocks, sequence rows, table cells, damage boxes, dice, swatches, panel bodies |
| **Block** | `0 999px 999px 0` against a spine, fixed height | **chrome** | topbar buttons, modal buttons, cap bars, panel/menu rows, button runs |
| **Pill** | `999px`, both ends free | a **play-surface control** | `.chip`, `.ship-tab`, `.view-chips button`, `.mode`, `.maneuver` |
| **Flat tag** | `0`, `--panel-2` ground, no border, 18–22px | **non-interactive label** | `.traits`, `span.chip`, `.segments li`, rarity swatch |

`.sequence-bar .segments li` currently wears the exact topbar-button treatment on a non-interactive `<li>`; under this rule it becomes a flat tag and the false affordance disappears for free. `.chip` has two implementations today (a `<span>` at 9.8px `--ink-dim`, a `button.chip` at 10.5px `--ink`); they split cleanly along the tag/pill line.

### 4.5 Spines

Three widths, no others: **`--spine-modal` 14px** (modal identity) · **`--spine-panel` 10px** (panels and menu rows) · **`--spine-inner` 4px** (inner groups, list rows, control runs).

A spine is always **continuous with the cap bar above it** — that L is the same turn as the frame's elbow at panel scale, and it is what makes a spine read as LCARS rather than as a coloured left border.

### 4.6 Elevation

There is one shadow, `--shadow-modal: 0 24px 64px rgba(0,0,0,.8)`, and it exists because a modal must separate from its backdrop. There are **no** `--el-1/2/3` steps, no `inset 0 1px 0 rgba(255,255,255,.035)` sheen, no bevels. LCARS has no light source; a 1px white top highlight is soft-UI and dates the moment it ships.

---

## 5. Component recipes

### 5.1 Panel = spine + cap bar

```css
.panel-like {                       /* .ship-form, .command-card, .combat-panel, … */
  --zone: var(--lc-lilac);
  background: var(--panel);
  border: none;
  border-left: var(--spine-panel) solid var(--zone);
  border-radius: var(--r-cell);     /* the BODY is square; the cap turns */
  padding: 0 var(--sp-3) var(--sp-3);
  box-shadow: var(--shadow-none);
}
.panel-cap {                        /* the panel's leading h3 */
  display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2);
  height: var(--h-cap);
  margin: 0 calc(-1 * var(--sp-3)) var(--sp-2) calc(-1 * var(--spine-panel));
  padding: 0 10px 0 calc(var(--spine-panel) + var(--sp-3));
  background: var(--zone); color: var(--ink-on-fill);
  border-radius: 0 var(--r-free) var(--r-free) 0;   /* 11px — half of 22 */
  font: var(--fw-bold) var(--fs-label)/var(--h-cap) var(--font-lcars);
  font-stretch: condensed; letter-spacing: var(--tr-micro); text-transform: uppercase;
}
.panel-cap .cap-status { background: rgba(0,0,0,.28); color: inherit;
  border-radius: var(--r-free); padding: 0 var(--sp-2); font-size: var(--fs-micro); }
```

The title goes from 12.3px sand-on-black to 11px black-on-colour (≥8:1) and reads far louder while occupying *less* height than today's `h3` + `0.4rem` margin. Markup: each panel's leading `<h3>` gains `className="panel-cap"`; any adjacent status chip moves inside it with `cap-status` (this is where DamageControlPanel's "2 of 4 red dice assigned" belongs, instead of a second grey row).

`.intel-panel` gets the cap and **nothing else** — no section colour language. It stands in for the ship form under the hidden-information rule and must not look like it is showing what it withholds.

Delete `.scout-panel, .formation-panel { margin-top: .6rem }` — the column's gutter is the only rhythm.

### 5.2 Buttons

```css
button {
  font: var(--fw-bold) var(--fs-label)/1 var(--font-lcars);
  font-stretch: condensed; letter-spacing: var(--tr-micro); text-transform: uppercase;
  color: var(--lc-sand); background: var(--panel-2);
  border: none; border-radius: 0 var(--r-free) var(--r-free) 0;
  height: var(--h-btn); padding: 0 var(--sp-3); cursor: pointer;
  transition: background var(--dur-hover) var(--ease), color var(--dur-hover) var(--ease);
}
button:hover:not(:disabled) { background: var(--panel-3); color: var(--ink); }
button.primary { background: var(--lc-orange); color: var(--ink-on-fill); }
button.primary:hover:not(:disabled) { background: var(--lc-sand); }
button:disabled { opacity: .32; cursor: not-allowed; }   /* controls dim — records do not */
```

Hover no longer turns everything orange: that was spending the accent thirteen times per bar.

**The segmented run** — how thirteen identical pills become three legible zones without removing or hiding one control:

```css
.btn-run {
  display: flex; align-items: stretch; gap: var(--gutter);   /* black, not a hairline */
  border-left: var(--spine-inner) solid var(--zone);
  border-radius: 0 var(--r-free) var(--r-free) 0;
  background: var(--bg); padding-right: 0;
}
.btn-run > * { border-radius: var(--r-cell); height: var(--h-seg-run); }
.btn-run > :last-child { border-radius: 0 var(--r-free) var(--r-free) 0; }
```

Segments are separated by **5px of ground**, never by a 1px divider. LCARS separates blocks with black.

### 5.3 Chips

```css
.chip {                                   /* display: a fact, not a target */
  display: inline-flex; align-items: center; gap: 5px;
  height: var(--h-chip); padding: 0 10px;
  font: var(--fw-bold) var(--fs-micro)/var(--h-chip) var(--font-lcars);
  letter-spacing: var(--tr-micro); text-transform: uppercase;
  color: var(--ink-dim); background: var(--panel-2);
  border: none; border-radius: var(--r-cell);
}
button.chip, .chip[role='button'] {       /* control: full pill, real target */
  border-radius: var(--r-pill); color: var(--ink);
}
.chip.is-on {                             /* the missing global on-state */
  background: var(--lc-orange); color: var(--ink-on-fill); font-weight: var(--fw-bold);
}
.chip-x { width: var(--sz-chip-x); height: var(--sz-chip-x); padding: 0;
          display: inline-flex; align-items: center; justify-content: center; }
```

`CommandCardPanel` writes bare `chip is-on` for **EMER STOP**, the turn rates and the ½-inch slide, and no global rule exists — a plotted emergency stop currently looks identical to an unplotted one. Verify the five existing scoped on-states (`.chip.arc.is-on`, `.view-chips`, `.designer-tools`, `.fleet-side-tabs`, `.online-sides`) still win; all are more specific.

`.chip.file-chip`: `.chip` (styles.css:1368) and `.file-chip` (:400) have equal specificity and `.chip` wins on source order, rendering "Load file" at 9.8px/20px next to 11.5px/29px neighbours. Write `label.file-chip` with its own full declaration at `--h-btn`.

### 5.4 Records — the highest-payoff rule in the pass

`button:disabled { opacity: .32 }` is global; `.circle` is `disabled={!allocating}` (ShipFormPanel.tsx:220) and `.mount` is `disabled={pending===0||damaged}`. **Outside the Resource Allocation segment — most of every round — the entire 15-row power table and every weapon mount renders at ~1.8:1**, exactly when it is being *read* rather than set.

```css
/* A record is not a control. Narrow scope; the global rule is untouched. */
.circle:disabled, .mount:disabled { opacity: 1; cursor: default; }
.circle:disabled:not(.is-filled) { border-color: var(--line); color: var(--ink-mute); }
.circle.is-unaffordable { opacity: .55; border-style: dashed; }   /* was .32 */
.circle:hover:not(:disabled) { border-color: var(--lc-orange); background: rgba(255,156,0,.12); }
.mount.is-damaged { opacity: 1; border-color: var(--danger); background-image: var(--hatch-damage); }
```

**Source order matters between the two new 0-2-0 rules:** `.mount:disabled` must appear *before* `.mount.is-damaged`. (Both are 0-2-0; `button:disabled` is 0-1-1 and loses to either on specificity regardless of order.)

`.circle.is-free` is a `<span>` and was never dimmed, so today each row shows one bright green circle followed by a row of ghosts; that inconsistency disappears with this rule too.

### 5.5 Marks

- `.circle` → **22×22**, ring 1.5px, gap 3px, tabular. `.is-filled` keeps green fill / `#07120b` digit (rules colour) plus `inset 0 0 0 1px rgba(0,0,0,.5)`. `:focus-visible { outline-offset: 0 }` so a 2px ring at 3px gaps does not overlap its neighbour.
- `.box` stays **8×8, hard corners** — it is the printed damage box. Undamaged gains a faint `#0d1424` fill inside its ring so it reads as an empty box rather than an outline. `.is-damaged` keeps the `--danger` fill. **Do not put `--hatch-damage` inside 8px** — a 2px/3px 45° repeat in eight pixels is moire and reads as dirt.
- `.structure .box` → **13×13**, gap 4px, and *this* is where the hatch belongs. `.structure-red` becomes a **fill** (`color-mix(in srgb, var(--red) 30%, var(--panel))` + `--red` border) matching `.track-red` in ShipBuilder — today the same data is drawn two contradictory ways in two views.
- `.dc-marker` becomes a yellow tab (`background: var(--yellow); color: #241a00`), matching `.track-dc`.
- `.power-point` → `--well` ground, `--r-pill`, `padding: 2px 6px` — its current `#0f141d` is one JND from the panel and the grouping box it draws does not visually exist.
- `.dot` → **9×9** + `inset 0 0 0 1px rgba(0,0,0,.5)` so green stops blooming. The hollow-vs-solid battery distinction is **preserved exactly**.
- `.gate` ◆ → `--fs-micro` (10px, from 7px) with a `--warn` ring. At 7px it is indistinguishable from dust and it encodes rule E4.2.8.

### 5.6 The functions table

- `th` → `--font-lcars`, `--fs-label`, 700, `.10em`, `--ink-dim`, fixed **96px** gutter sized for the **Inter fallback**.
- Rows at `--h-row-dense`; separated by **black gutter**, not by borders and not by zebra.
- `.line-value` → `width: 40px; text-align: right; background: var(--panel-2); color: var(--lc-sand); tabular` — a column that reads as a column.
- **The eight shield rows** (`SHLD RNFC/REPR × F/S/A/P` differ only in characters 9 and 15) get the **safe** treatment: two `<tbody>` groups with a `.form-subhead` row each (`SHIELD REINFORCE` / `SHIELD REPAIR`, `--fs-micro`), and a **12×12 hard-square facing swatch** on each `th` using `--face-f/s/a/p` with a 9px letter in `--ink-on-fill`.
  **Do not take the 2×4 matrix option.** It abandons the `<table>`, the per-circle `title` strings that carry rules text ("Needs N power; M left") and the label→circles→value reading order, to save ~130px. Not worth re-plumbing a rules-bearing control grid.

### 5.7 State language

| state | ground | edge | second, non-colour channel |
|---|---|---|---|
| off / unset | `--panel-2` | none | — |
| on / selected | `--lc-orange` | none | weight 700 |
| armed (mount) | `--panel-2` | — | **3px orange top edge**, arming circles filled |
| unarmed | `--panel-2` | — | hollow arming circles |
| degraded | `--panel-2` + `--hatch-degraded` | 1px `--warn` *(exception 2)* | 45° hatch |
| damaged / destroyed (record) | `--danger` (+ hatch at ≥13px) | 1px `--danger` | hatch; **opacity stays 1** |
| out of action (row) | unchanged | `border-left: 3px solid var(--danger)` | `line-through` on the name; the existing `.55` dim may stay |
| **unavailable (control)** | unchanged | dashed `--line` | `opacity: .32` — **this and only this** |
| stale intel | unchanged | — | `--ink-mute` **plus the literal word `STALE`** — never a fade, never a tilde |
| waiting on you | — | `0 0 0 2px var(--lc-orange)` | static ring; optional pulse, motion-gated |
| waiting on them | spine → `--lc-plum` | — | static "…" + `aria-live="polite"` |

### 5.8 One error component

```css
.fire-error, .online-error, .alloc-error, .hint.is-error, .design-problems, .title-note {
  border: none; border-left: var(--spine-inner) solid var(--sev, var(--danger));
  background: color-mix(in srgb, var(--sev, var(--danger)) 12%, transparent);
  border-radius: var(--r-cell);
  padding: var(--sp-2) 10px; color: var(--ink); font-size: var(--fs-body);
}
.design-problems, .title-note { --sev: var(--warn); }
```

Five presentations of one job become one. **No severity glyph** — LCARS states severity with a colour block and a word, not a Bootstrap triangle. (`color-mix` is already used at styles.css:598.) Add `role="alert"` to `.title-note`, `.fire-error`, `.online-error`; `aria-live="polite"` to the campaign note.

Note: `.fire-error`'s `--danger` on `--panel` measures **6.11:1** and passes AA — the merge is worth doing for consistency, but do not describe it as a contrast fix.

### 5.9 Modals

```css
.picker {
  --zone: var(--lc-orange);
  display: flex; flex-direction: column;
  background: var(--panel);
  border: none; border-left: var(--spine-modal) solid var(--zone);
  border-radius: var(--r-cell);
  box-shadow: var(--shadow-modal);
  width: min(1100px, 100%); max-height: 90vh; overflow: hidden;
}
.picker > header {                       /* spine + header = ONE continuous L */
  flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center;
  justify-content: space-between; gap: var(--sp-2);
  min-height: var(--h-modal-header);
  margin-left: calc(-1 * var(--spine-modal));
  padding: 0 var(--sp-4) 0 calc(var(--spine-modal) + var(--sp-4));
  background: var(--zone); border: none;
  border-bottom-right-radius: calc(var(--h-modal-header) / 2);
}
.picker > header h2 { margin: 0; color: var(--ink-on-fill);
  font: var(--fw-bold) var(--fs-title)/1 var(--font-lcars);
  letter-spacing: var(--tr-title); text-transform: uppercase; }
.picker::after {                         /* the terminator: every modal closes */
  content: ''; flex: 0 0 var(--h-modal-foot); height: var(--h-modal-foot);
  background: var(--lc-plum-deep);
  border-bottom-right-radius: calc(var(--h-modal-foot) / 2);
}
.picker > footer { flex: 0 0 auto; min-height: 40px; }
```

`flex-wrap` on the header is required: ReplayTheater's header has six children. `.picker.campaign-menu` is rendered **inline with no backdrop** (CampaignApp.tsx:383, :588) — the negative-margin header and the `::after` terminator are safe there, but keep its `overflow-y: auto` override and add `flex-direction: column` so the terminator lands at the bottom of the scroll content; then verify exactly one scrollbar.

**Pay for the taller header structurally, not with magic numbers.** A 40px header breaks three hand-tuned caps; convert all three to flex:

```css
.roster                { flex: 1 1 auto; min-height: 120px; max-height: none; overflow-y: auto; }
.theater-narration ol  { flex: 1 1 auto; min-height: 120px; max-height: none; overflow-y: auto; }
.theater-stage         { display: flex; flex-direction: column; min-height: 0; }
.theater-stage .map    { flex: 1 1 0; min-height: 260px; max-height: none; }
```

`.theater-stage .map` is play surface: under `flex: 1` it *gains* height as the window grows instead of being pinned at 68vh.

Widening the modal spine to 14px takes 4px back from the **middle** column, never the map column: `.designer-body` `1.15fr 1fr 300px` → `…296px`; `.builder-body` `minmax(0,1fr) 340px` → `…336px`; `.theater-body` `1fr 320px` → `…316px`.

### 5.10 Control banks and list rows

```css
.picker-controls, .library-controls {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  align-items: end; column-gap: var(--sp-3); row-gap: var(--sp-2); padding: var(--sp-3);
}
.picker-controls .field { min-width: 0; margin: 0; }        /* kills the 220px min */
.field.tiny input, .field.tiny select { width: 100%; }
.field.tiny.checkbox { flex-direction: row; align-items: center; }  /* two-layouts bug */

.row {                       /* .roster-row, .match-row, .library-entry, .fleet-list li */
  display: grid; align-items: center; column-gap: var(--sp-2);
  min-height: var(--h-row); padding: 0 var(--sp-2);
  background: var(--panel-2);
  border-left: var(--spine-inner) solid transparent;
  border-radius: var(--r-cell);
  margin-bottom: var(--gutter);        /* black gutter, not a hairline, not zebra */
}
.row:hover { background: var(--panel-3); }
.row.is-on { border-left-color: var(--lc-orange); background: #241a06; }
```

- **Roster:** `grid-template-columns: minmax(0,1fr) 44px 56px` = name / PV / rarity, with `.roster-meta` on grid row 2. *Markup (FleetPicker.tsx:458–461):* pull the points out of the meta sentence into `<b className="roster-pv tnum">`. Without it there is no PV column to align, and `.fleet-list` (already a `5.4rem / 1fr / 3rem` grid) keeps speaking a different language about the same ships.
- **`.roster h4`** becomes an **opaque** sticky band (`--lc-peri` ground, `--ink-on-fill`, `top: 0`) so scrolled rows disappear cleanly behind it instead of showing through a same-colour ground.
- **Rarity** keeps all five colours exactly; only the shape changes — a 7–8px hard-square swatch plus the word at `--fs-micro` in a fixed right column.
- **`.match-row`** retires the bootstrap card: no border, `--spine-inner` in `--line`, `--panel-2` ground; `.is-on` → orange spine, `#241a06` ground.
- **Revive `.roster-row.is-picked`** — add the class in FleetPicker.tsx:448 when `count > 0`. The sand feedback rule already exists at :2267 and never fires; a roster with no "already in your force" feedback reads as unfinished.

### 5.11 The library — an existing reachability bug

`ShipLibraryPanel.tsx:51` renders `<ShipList/>` as a fragment whose children become direct flex children of `.picker`, which is `overflow: hidden; max-height: 94vh`. **A library longer than the viewport is clipped with no way to scroll to it**, and `.library-list` is an unstyled `<ul>` rendering fan ships as bulleted paragraphs.

Markup: wrap `<ShipList/>` / `<ScenarioList/>` in `<div className="library-body">`.

```css
.library-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: var(--sp-3); }
.library-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--gutter); }
.library-entry { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: var(--sp-3);
  align-items: start; background: var(--panel-2);
  border-left: var(--spine-panel) solid var(--lc-lilac); border-radius: var(--r-cell);
  padding: var(--sp-2) var(--sp-3); }
```

### 5.12 Campaign console

`.campaign-shell` reuses the **same** frame — same elbow, same fillet, same `--rail-w: 104px` (not 88px: the whole argument is that it is the same instrument), same foot.

**Status strip.** Replace the single run-on `<span>` ("Commander A — round 3, phase 7/16 · VP 4–2 · opponent away") with discrete label-over-value cells separated by black:

```css
.status-strip { display: flex; align-items: stretch; gap: var(--gutter); flex: 1; min-width: 0; }
.stat { display: flex; flex-direction: column; justify-content: center;
        padding: 0 var(--sp-3); background: var(--panel-2); min-width: 0; }
.stat > span { font: var(--fw-bold) var(--fs-micro)/var(--lh-ui) var(--font-lcars);
               letter-spacing: var(--tr-micro); text-transform: uppercase; color: var(--ink-mute); }
.stat > b    { font: var(--fw-bold) var(--fs-title)/var(--lh-ui) var(--font-ui);
               font-variant-numeric: tabular-nums; color: var(--ink); }
.stat.is-side-a > b { color: var(--blue); }
.stat.is-side-b > b { color: var(--red); }
.stat.is-alert > b  { color: var(--warn); }
```

Cells: `COMMANDER` · `ROUND` · `PHASE n/16` · `VP` (as `4–2`, the two figures in their own side colours) · `LINK`.

**Sidebar** panels are §5.1 panels with cap bars. Spines: Battles waiting orange (this is the campaign's "act now") · Unit orders peri · Contact dossier sky · Reinforcements sand · Online campaign plum. The current five orange `h3`s in one column are the campaign screen's worst accent violation.

**Map SVG (`CampaignMap.tsx`) — information fixes, not repaints:**

| now | new | why |
|---|---|---|
| `own = side==='A' ? '#5fb2ff' : '#ff8a5f'` | `var(--blue)` / `var(--red)` | a third set of side colours; use the tokens the counters use |
| contacts hardcoded `#e05555` / `#e08585` | the **opposing** side's rules colour | a contact is the other commander — today it is red even when *you* are red |
| — | contacts also get `stroke-dasharray: 3 3`, no fill | contact identity is deliberately withheld; dashed = unconfirmed is a non-colour channel |
| terrain system `rgba(255,214,90,.35)` | `rgba(255,201,74,.18)` | align to `--yellow`, drop alpha so units read over it |
| terrain nebula `rgba(170,90,240,.30)` | `rgba(154,114,201,.26)` | `--lc-plum` |
| terrain dust `rgba(200,140,80,.30)` | `rgba(255,156,0,.14)` | `--lc-orange` |
| hex stroke `rgba(140,160,190,.25)` | `rgba(122,140,175,.18)`; border hexes stay dashed `--red` | a uniform hairline makes it a chart, not a mesh |
| unit / contact labels `fontSize 7` | `9` | below the floor |
| infra glyph `#ccc` | `--ink-dim`, owned infra gets a 1px halo in the owner's rules colour | on-system ink |

Cloaked units keep `opacity: .5` **and** gain `stroke-dasharray="2 2"`. Selection ring and waypoints are `--lc-sand` (your plan). Add a legend block and a hex-scale caption inside the map's existing 16px margin — neither may cover the play area.

---

## 6. Motion

Chrome only. Nothing scales, nothing slides, nothing on the play surface moves.

| what | property | duration |
|---|---|---|
| control / chip / row hover and active | `background-color`, `color` | `--dur-hover` 90ms |
| chip & tab on-state | `background-color`, `color` | `--dur-hover` |
| modal enter | `opacity` 0→1 **and** `translateY(6px)→0` | `--dur-modal` 120ms |
| backdrop enter | `opacity` | `--dur-modal` |
| sequence marker advance | `background-color` cross-fade on `.is-now` | `--dur-base` 160ms |
| new log entry | `background-color` flash → transparent | `--dur-flash` 220ms |
| waiting-on-you ring | `box-shadow` opacity, 2.4s alternate | motion-gated; the ring exists statically |
| existing `.map-mover`, `.shield-fill`, `.fx-layer`, crippled pulse | unchanged | unchanged |

**Never animated:** `width`, `height`, `top/left`, `background-position` (including the starfield), anything on `.map` or the campaign SVG, and **any rules-state colour**. A damage box must snap — a fading damage state is a lie about game state.

`tokens.css` carries the authoritative `prefers-reduced-motion` block at the end of the last stylesheet, so it wins over the three earlier ones in `styles.css` (:1003, :4035, :4346) while suppressing everything they suppress. Every attention signal has a static form; no information is carried by motion alone.

---

## 7. Accessibility

**Focus.** `tokens.css` ships the dual ring — light outer (`--focus-outer #f2f5ff`), dark inner (`--focus-inner #000`) filling the 2px offset gap — on real element selectors (0-1-1) so it beats the legacy single-orange rings on source order. On a light block it reads dark-then-light; on black, light-then-dark. An orange ring on an orange fill is 2.1:1 and fails the 3:1 required of a focus indicator. Exceptions: `.circle:focus-visible` and `.chip.arc:focus-visible` take `outline-offset: 0` (3px gaps). Verify the ring is not cropped on the first/last row inside an `overflow-y: auto` scroller; add `padding: 2px` to the scroller if it is. `DamageChoicePrompt.tsx:61` sets `autoFocus` on the recommended option by design — do not suppress that ring.

**File inputs — five keyboard-unreachable controls today.** `input[type=file] { display: none }` removes the input from the tab order and a `<label>` is not focusable, so **Load battle** (App.tsx), **Load campaign** (CampaignApp.tsx:421), **Read back from a battle save** (:755), **Load file** (ReplayTheater:290) and **Load a scenario file** (ScenarioDesigner:345) are mouse-only.

```css
.file-chip input, .title-load input {
  position: absolute; width: 1px; height: 1px; opacity: 0;
  clip-path: inset(50%); overflow: hidden;        /* hidden but FOCUSABLE */
}
.file-chip:focus-within, .title-load:focus-within {
  outline: var(--focus-w) solid var(--focus-outer); outline-offset: var(--focus-gap);
  box-shadow: 0 0 0 var(--focus-gap) var(--focus-inner);
}
```

Do **not** touch `accept="application/json,.json"` or the `e.target.value = ''` reset — that reset is what allows loading the same file twice. ShipBuilder's `hidden` + real-`<button>` pattern (:223–243) is already correct; leave it alone.

**Contrast floors.** `--ink-on-fill` on the seven chrome hues ranges 5.8:1 (plum) to 14.1:1 (sand). `--ink-dim` on `--panel` is 9.1:1; `--ink-mute` 6.2:1 and legal to the 10px floor. Side blocks: `--blue` 8.6:1, `--red` 6.9:1 with black ink.

**Colour is never the only channel.** `.band-green` keeps its underline and `.band-red` its italic. Damaged marks ≥13px gain the 45° hatch. Campaign contacts and cloaked units are dashed. Stale intel gets the word `STALE`. Rarity gains a swatch shape. `is-out` rows gain a `--danger` rail and a line-through.

**Native checkboxes are retained** — they are the only genuinely native control in the app. They just get a consistent 26px row and a 13px sentence-case label instead of a bare 10px `--ink-dim` one.

---

## 8. Density — the height budget

`.lcars-stage` is `overflow: hidden` above 1000px, so **every pixel added to the chrome is silently clipped, not scrolled**: `.app` 100vh → topbar row → stage `minmax(0,1fr)` → `.layout` `flex:1 1 0` → `.map` `flex:1 1 0; min-height:260px` → `.log` `max-height:30vh`. Once the map hits its 260px floor the bottom of the log disappears with no scrollbar to recover it. Every addition is therefore paid for by a named saving.

| change | Δ |
|---|---|
| topbar: 34px arm + 40px content = 74px minimum — **exactly today's minimum**, and it keeps `auto` growth | **0**, and the arm is free |
| page padding `10px 12px 12px` → 0 (frame bleeds to the bezel) | **−22px** |
| round block leaves the rail for the elbow | −46px of rail (frees rail, not stage) |
| panel `h3` + `.4rem` margin (~17px) → 22px cap − 10px reclaimed padding-top | **−5px** × ~5 panels = **−25px** |
| `.form-section` hairline + `.6rem` × 2 → 12px margin + 4px tab | **−5px** × 6 = **−30px** |
| `.scout-panel`/`.formation-panel` double margin removed | **−8px** |
| functions rows → 26px, two shield sub-heads | **−8px** net over 15 rows |
| `.circle` 20 → 22px × 15 rows | **+30px** |
| foot: 2px rule + 12px cap → 20px arm + corner | **+8px** |
| **net on the battle stage** | **≈ −55px — the map gets bigger** |

Non-negotiable density rules:

1. **Nothing shrinks below its current hit target** (§3.2). If a grown `.chip.arc` overflows `.builder-table`, wrap the table in `overflow-x: auto`; do not shrink it back.
2. **No control moves behind an extra click.** The topbar's 13 controls stay 13 visible controls; grouping changes their shape, not their reachability.
3. **The play surface never loses height.** `.map`, `.theater-stage .map` and `.designer-map` gain height under `flex: 1; min-height: 0`. Inner panel spines stay at 10px and do not grow further.
4. **The topbar row is `minmax(var(--h-topbar-min), auto)`, never a fixed height.** styles.css:167–170 already documents why: the bar wraps at 1280px, and a control that runs off the edge is a control nobody can reach.
5. **Scroll containers preserved exactly:** `.control-column`, `.map-column > .log`, `.rail-sequence`, `.roster`, `.match-list`, `.theater-narration ol`, `.damage-choice-options`, `.fleet-body`, `.builder-body`, `.designer-body`, `.online-body`, `.theater-body`, `.summary-body`, `.picker.campaign-menu`, `.campaign-sidebar`. **Two are added** where content is currently unreachable: `.library-body` and `.title-menu`.
6. `.mission-status` `return null`s when there is no recon and no reinforcements (App.tsx:1337), so the stage's vertical rhythm differs between scenarios. **Tune with it both present and absent.**

**Breakpoints** are preserved exactly: ≥1180px full topbar with the strapline; 1001–1179px strapline hidden, runs wrap, topbar grows; ≤1000px rail hidden, elbow flattens to a cap bar, `.layout` stacks, the page scrolls as a document. Because the rail now carries per-side ship counts, add a `.rail-fallback` strip under the sequence bar at ≤1000px carrying the same numbers — that closes an existing partial feature loss rather than deepening it.

---

## 9. Do not touch

1. **Rules-information colour** — every token and consumer in §1.1. No retune, no harmonising, no chrome borrowing.
2. **`--lc-lilac`** — frozen at `#cc99cc` while `.ship-aurelian .glyph-trim` reads it (§1.2).
3. **The hollow-vs-solid battery dot** (`.dot.bty:not(.is-charged)`) — a deliberate fix, commented in place. Do not fill both states.
4. **`.band-green`'s underline and `.band-red`'s italic** — the non-colour second channel.
5. **`.tick-round` / `.tick-volley` / `.tick-kill`** — their colours *and* their 15/9/17px heights.
6. **`accept="application/json,.json"` and `e.target.value = ''`** on every file input — the reset is what allows loading the same file twice.
7. **ShipBuilder's `hidden` + real-`<button>` file pattern** (:223–243) — already correct.
8. **`DamageChoicePrompt`'s `autoFocus`** (:61).
9. **`.rail-block span`'s `overflow:hidden / text-overflow:ellipsis / max-width:100%`** — it is what stops "CONFEDERATE STRIKE GROUP" stretching the 104px rail.
10. **The per-circle `title` strings** in the functions table ("Needs N power; M left") and the label→circles→value reading order.
11. **`.mount`'s ~40×47 box** — at the floor already; do not reduce it to buy vertical space.
12. **`.unattended`'s `order: -1; flex: 1 0 100%`** — a safety warning about a side that will not fight back; it stays ahead of everything on the action bar.
13. **Root `font-size: 14px`** — changing it reflows every hand-tuned `rem` in a 4,900-line file.
14. **No webfonts, no external assets, ever.** Gradients, shapes and inline SVG only.

### Dead CSS — verified

Genuinely dead, safe to delete: `.picker-sides`, `.picker-side`, `.picked-summary`, `.picked-weapons`, `.picked-note`, `.mount-arcs`, `.fleet-footer` (`.picker > footer` at 0-1-1 already beats it at 0-1-0).

**Not dead:** `.foot-cap` **is** rendered by `App.tsx`. Remove the markup and the rule together. Grep every remaining candidate before deleting it.

---

## 10. Specificity landmines

Prefer explicit compound selectors over source order **everywhere**.

| collision | who wins today | action |
|---|---|---|
| `.chip` (1368) vs `.file-chip` (400) | `.chip` — equal specificity, later source | write `label.file-chip` with a full declaration |
| `.picker > footer` (0-1-1) vs `.fleet-footer` (0-1-0) | `.picker > footer` | delete `.fleet-footer` |
| `.fleet-side` `border-left` **shorthand** (3131) vs `.picker-blue` longhand (2224) | `.fleet-side` — **both force lists render plum and the side colours never appear at all** | split into `border-left-width/style/color`, then `.fleet-side.picker-blue { border-left-color: var(--blue) }`, `.fleet-side.picker-red { … var(--red) }`, `.fleet-side.picker-aurelian { … var(--side-aurelian-deep) }`. Leave the `h3` colours (3137–3145) alone until the spine is verified working. |
| `.field.tiny` (2773) vs `.picker-controls .field` (2187) | `.field.tiny` — equal, later source | the grid in §5.10 removes the conflict |
| `.mount.is-damaged` (0-2-0) vs `button:disabled` (0-1-1) | `.mount.is-damaged` **on specificity, not order** | order only matters between the two new 0-2-0 rules (§5.4) |
| `.title-item` shared with `CampaignApp` (8 sites) | — | scope any hue under `.title-menu` only, never on `.title-item` itself |
| `.segment-help` is the base class for 9 panels | — | `--zone` per modifier class |
| `.picker.campaign-menu { overflow-y: auto }` vs `.picker { overflow: hidden }` | campaign-menu | verify exactly one scrollbar after §5.9 |
| a new base `.chip.is-on` vs `.chip.arc.is-on`, `.view-chips`, `.designer-tools`, `.fleet-side-tabs`, `.online-sides` | the scoped ones | correct — but verify none relied on the *absence* of a base rule |

**One decorative choice explicitly rejected:** per-row rainbow spines on `.title-item`. Seven hues on seven menu rows is decorative variance on the calmest screen in the app and it contradicts the accent ration. One calm sand spine plus the stencil tag carries the same structure; solid orange stays reserved for "a battle is in progress, resume it".

---

## 11. Implementation order

**Required first edits** (they gate everything else and must land in commit 1):

1. Repoint the Aurelian side onto its frozen tokens — `styles.css:2232` `.picker-aurelian { border-left-color: var(--side-aurelian-deep) }` and `:3144` `.fleet-side.picker-aurelian > header h3 { color: var(--side-aurelian) }`. Until this lands, retuning `--lc-plum` changes a side's spine.
2. Consider repointing `.ship-aurelian .glyph-trim` (:1082), `.escape-pod.pod-aurelian` (:1188, `#b57bff`) and `.homing-aurelian .homing-counter` (:2570, `#c78bff`) onto `--side-aurelian` so the third side has one colour, not three.

Then, each step independently shippable and independently revertable:

| # | commit | risk |
|---|---|---|
| 1 | Tokens (`tokens.css`, already landed) + the Aurelian repoint | low — pure value swap |
| 2 | **The record/control fix** (§5.4) + `.chip.is-on` + `.accel-value.is-evasive` | low, **highest payoff** |
| 3 | **The `.field` control-size fix** (§2.4) + tabular numerals + the tracking law | low |
| 4 | **Keyboard-reachable file inputs** (5 sites, §7) + the `.library-body` scroll wrapper (§5.11) | low |
| 5 | Rules-colour bug fixes: rail side tones from the side's own colour (App.tsx:781 `tones = ['sky','salmon','lilac']` deleted), `.fleet-side` compound spines, `.view-chips .chip.is-on` → sand + side swatch, `.roster-row.is-picked` | medium — verify all three sides render |
| 6 | Frame: `padding: 0`, the arm + fillet, elbow datum, foot corner, `--gutter` column gap | **highest** — screenshot-diff first |
| 7 | Rail: square blocks, `flex: 0 1 auto`, the `::after` filler, three sequence states, `SEGMENT_SHORT` uppercase | medium |
| 8 | Borderless law + button/chip geometry + topbar zones + `.chip.file-chip` | medium — 13 controls to eyeball |
| 9 | Panel cap bars + per-panel zone + form-section tabs + facing key | medium — 16 panels |
| 10 | Modal header/terminator + `.picker-controls` grid + the vh→flex conversion + one error block + the dead-CSS sweep | medium — 13 `.picker` consumers |
| 11 | Campaign console + status strip + map SVG corrections + handoff card | low |
| 12 | Motion (§6) | low |

**Steps 2, 3 and 4 fix defects that exist today** — a 32%-opacity power table, 9.8px form controls, five keyboard-unreachable file loaders, and an unreachable ship library. **They must not be gated behind the highest-risk visual commit.**

**Verification per commit:** screenshot at 1600×1000, 1280×800 and 375×812; tab through every screen once; toggle `prefers-reduced-motion`; open a scenario **with and without** `.mission-status`.

---

## 12. Quick reference

```
GROUND      #000000 — always. Gutters are 5px of it.
RADIUS      half the height on a free end (999px) · 0 on an attached end · nothing else
BORDERS     none in the chrome. Exceptions: .is-linked, .is-degraded, .is-down,
            and the printed-record tables.
INK ON FILL #000 on every bright hue. One token. --ink on --lc-plum-deep.
CASE        --font-lcars is ALWAYS uppercase · --font-ui is NEVER uppercase
SIZES       34 / 24 / 17 / 13 / 11 / 10 / 9 — and 9 only for dead codes
WEIGHTS     400 and 700. Nothing else.
LATTICE     4px, plus the 5px black block gutter
FRAME       rail 104 · arm 34 · R_out 68 · R_in 34 · foot arm 20 · R_out 40
HEIGHTS     button 28 · chip 22 · cap 22 · row 30 · dense row 26 · menu row 56
            modal header 40 · terminator 20 · rail block 46 · topbar min 74
SPINES      14 modal · 10 panel & menu row · 4 inner block
SHAPE       cell = record · block = chrome · pill = play-surface control
ORANGE      three roles per screen: frame, current segment, one primary
MOTION      90ms hover · 160ms default · 220ms flash · 120ms modal
            Nothing scales. Nothing else moves. Rules states snap.
FROZEN      --blue --red --green --yellow --warn --danger, --lc-lilac,
            --side-aurelian(-deep), every die/damage/rarity/band/tick class.
            Side identity DOES use --blue/--red — that IS their meaning.
DIMMING     opacity < 1 means "this control is unavailable". Nothing else.
```
