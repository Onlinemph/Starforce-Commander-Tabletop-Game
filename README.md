# StarForce Commander — Digital Tabletop

A browser implementation of **StarForce Commander** (Mariner Games, rulebook v2.6, 2026), a game
of tactical starship combat by Patrick Doyle.

Local hot-seat, no server, no accounts. All game data is canon: **72 ships** through Expansion 3 from
the Master Ship Book, the **56-card damage deck** and the **attack dice** from the print-and-play
components. The Basic Set Standard rules are complete, plus **Expansion 2** — Command Systems (H5)
and, behind a toggle, the optional Coordinated Fire rules (H4). The rules engine is a standalone TypeScript library with no UI dependencies, so it can
later be driven by a networked client or an AI opponent without change.

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # 183 rules and data-integrity tests
npm run typecheck
npm run build
```

## What you get

The **Standard rules** — everything in the rulebook not marked `(Optional)` — driven through the
full Sequence of Play:

- **Engineering Phase** — secret resource allocation across every FUNCTIONS line, weapon arming
  (including slow-arming diamonds), shield repair and reinforcement, batteries, and damage control.
- **Three Combat Phases** — command-card plotting, the Operations Segment steps A–E, simultaneous
  movement with real turn-template geometry, and the Combat Segment with Tactical Scan firing order.
- **Final Phase** — stress checks, disengagement, and victory-point scoring.

Plus **Expansion 2**: command ships that lend tactical scan to the fleet, and the optional ten-step
Coordinated Fire sequence. See below.

The map is drawn at 1 inch = 20 pixels, so every range and template on screen is the rulebook's own
measurement.

**Forces** are chosen from the full Master Ship Book roster — 37 Union and 35 Vallari ships, from the
V-2N Flanker scout to the UNION III dreadnought — with the point values, availability and
introduction years the Master Ship List prints.

## Rules coverage

| Section | Status | Notes |
| --- | --- | --- |
| A3 Sequence of Play | ✅ | All five phases, all segments, round rollover |
| B1 Starship Forms | ✅ | Full data-driven schema; rendered as an interactive form |
| B2 Resource Allocation | ✅ | Free power, sequential vs. free-order lines, multi-power circles (E4.2.11) |
| B2.4 Simplified Batteries | ✅ | Spend during allocation, recharge, damage |
| B3 Damage Control | ✅ | Red-dice repair by category, DC rating decay along the structure track |
| C1 Command Segment | ✅ | Plotting with full validation; illegal plots fall back to straight (C1.1.2) |
| C2 Basic Maneuvers | ✅ | Forward, standard, easy (always 20°), slide (incl. half-inch) |
| C3 Advanced Maneuvers | ✅ | Hard, S-turn, snap, EM-90/180, stress, SIF cancellation |
| C4 Special Situations | ✅ | Unlimited stacking, no collisions, involuntary deceleration |
| E1 Range | ✅ | Round-down measurement, targeting/jamming, green & red brackets |
| E2 Firing Arcs | ✅ | Eight 45° arcs, shield mapping, ambiguous-arc choice, line of sight |
| E3 Weapon Systems | ✅ | Firing charts, proximity fire, firing at low power |
| E4 Weapon Arming | ✅ | Arming points, distribution, slow arming, bonus damage |
| E6 Combat Segment | ✅ | Tactical Scan sequence with simultaneous ties |
| E7 Damage Resolution | ✅ | Volleys, leak damage, shields → armor → internal |
| E8 Damage Card Results | ✅ | All card effects, alternate hits, fires, bridge hits |
| E9 Precision Targeting | ✅ | Section targeting, attacker's replacement hand, no alternate hits |
| E10 Degraded Fire Control | ✅ | No targeting, jamming applies, halved damage, no leak |
| E11.1 Destroying Ships | ✅ | Derelicts and explosions available as optional toggles |
| E12 Small Targets | ⚠️ | Terminology and degraded-fire rules in place; no small craft to shoot at yet |
| F1–F4 Weapons | ✅ | Traits, special hits, `STR+X`, `PD WPN` vs. `PD MODE`, `NoBAT`, `AMMO` |
| G1 Shields | ✅ | Blue/green boxes, generator rating, raise/lower, repair, reinforce |
| G2 Hull Armor | ✅ | Absorbs after shields; leak bypasses it |
| H1 Basic Sensors | ✅ | Available by leaving sensor points unallocated |
| H2 Sensors | ✅ | Targeting, jamming, tactical scan, per-function caps, sensor damage |
| J1 General Systems | ✅ | NRM/MAX power levels, Operations Segment steps |
| J3–J8 Operations | ⚠️ | Modelled on the ship form and damageable; interactive use not built |
| J9 Disengagement | ✅ | FTL, leaving the map, range 36, mutual agreement |
| K Space Terrain | ⚠️ | Planets/moons block line of sight; asteroid transit damage and cover done |
| S2 Scenario Rules | ✅ | Map types, placement, victory points by damage level |
| S3 Scenarios | ⚠️ | The Duel and Orbital Ambush; the rest are straightforward to add |
| **H4 Coordinated Fire** *(Expansion 2, optional)* | ✅ | Ten-step firing sequence, group validation, one attack per faction per phase |
| **H5 Command Systems** *(Expansion 2)* | ✅ | CMND boxes lend tactical scan for the round, live withdrawal on damage |

Optional rules (B2.5 full batteries, C3.6 evasive maneuvers, C3.7 reverse movement, C3.8 emergency
stop, C3.9 precise turns, E11.2 derelicts, E11.3 explosions, J6 boarding) are partly implemented in
the engine — reverse movement, emergency stop, derelicts and explosions all work — but are not yet
surfaced as UI toggles beyond the destruction options.

## Expansion 2 — Coordinated Fire and Command Systems

Expansion 2 adds two rules, both implemented.

**H5 Command Systems** is a Standard rule and is always on. A ship with `CMND` boxes on its form is
a command ship; 18 of the 72 ships in the roster have them, from the COVENTRY IIc (2 boxes) to the
UNION II/III dreadnoughts (5). While its GEN SYS line is set to **MAX** (H5.1.3), each undamaged
`CMND` box generates one tactical scan point that the flagship lends to a friendly ship within
**36 inches** during the Resource Allocation Segment. Lent points last the whole round and let the
receiving ship exceed the tactical scan cap its own sensor rating imposes (H5.2.2). Only one ship
per faction may lend at a time (H5.1.6), and it may lend itself at most one point (H5.2.3).

The loan is **live**, not a one-off transfer, which is what makes the worked examples in H4.7 come
out right: destroy the flagship, or knock out one of its `CMND` boxes, and the points come off the
recipients immediately. When capacity drops, the tail of the assignment list loses its point unless
the owning player names a different ship — the "he decides which one as soon as the damage occurs"
choice, exposed as **revoke** in the panel.

**H4 Coordinated Fire** is marked `(Optional)` in the expansion, so it ships behind the
**Coordinated Fire** toggle in the top bar and is off by default. With it on, the Combat Segment
runs through the ten firing steps of H4.2.3 — six Individual steps in descending Tactical Scan
order, then four Coordinated steps in ascending order — instead of the single Tactical Scan pass of
H2.4. A ship gets **one** firing opportunity per phase and must choose: fire early alone, or fire
later together. Coordinating ships each need at least as many tactical scan points as there are
ships in the group (H4.5.1), a faction may attack any one target only once per phase (H4.3.1), and
group members may not use precision targeting (H4.6.2).

Two readings had to be settled where the text disagrees with itself:

- **H4.5.5** is headed "ships with different tactical scan levels may not coordinate their fire",
  but its own worked example has a scan-2 ship and a scan-3 ship firing together on step 8. The
  engine follows the example: mixed groups are legal and fire on the step matching the group's
  *highest* level, so coordinating never lets anyone fire earlier than they could alone.
- **Step 10** is printed as "Up to Five Ships with Tactical Scan Level 5+" while H4.5.3 says
  "followed by five and up". The engine leaves the ship count open at step 10, because H4.5.1's
  one-point-per-ship requirement already bounds it — a six-ship group needs six points each.

A three-a-side **Squadron Engagement** scenario ships with the expansion, since neither rule bites
in a duel. Expansion 2 prints no scenario of its own, so this is a plain Standard Placement setup
(S2.4.1) with a command cruiser and two line ships per side.

## Ship data

`src/data/ships.json` holds all 72 forms, machine-extracted from the **Master Ship Book** (all ships
through Expansion 3). The forms are vector art rather than tables, so the importer reads them
structurally:

- Hit, shield, armor and structure boxes are Wingdings glyphs whose **colour** gives their kind —
  blue shields, green reinforcement, black systems, red unrepairable structure, grey armor (B1.1.1).
- Power circles are `⚫` for free power and `○` for purchasable (B2.2.3), with the value printed to
  the right of each.
- Range brackets are Calibri spans whose colour and italics give the band — green optimum, black,
  red extreme (E1.2).
- Attack dice are Wingdings2 glyphs whose colour gives the die (E3.2.1).
- Firing-arc icons are small images that the layout rotates and mirrors, so every *placement* is
  rasterised and its eight wedges read for red (usable) versus white (E2.2.2). Wedge classification
  came out unambiguous — typically 690 red pixels to 0 white, or the reverse.

Every import is cross-checked against the form's own printed totals (TOTAL POWER, battery count, the
four shield values) and against the Master Ship List's structure count. All 72 ships pass with zero
discrepancies, and the arc-icon count matches the hit-box group count on every weapon block in the
book, so no mount is silently dropped.

Several independent spot-checks against the rulebook's own worked examples came out exact: the
Yorktown I's `□□□■ 4` structure track (B3.1.2), its four slow-arming torpedo mounts (E4.2.8), and the
Type-51 Gravitic Disruptor's full firing chart (E3.2.1).

### Errata

One transcription conflict in the source is corrected at import and recorded on the ship's `notes`:

| Ship | Weapon | Printed | Used |
| --- | --- | --- | --- |
| V-6N Savage-class Light Cruiser | G-YAGUS A/MAT Torpedo | `0-4  5-10  9-15  16-20` | `9-15` read as `11-15` |

The third bracket overlaps the second as printed; every other weapon in the book has a continuous
chart, and a test enforces that.

## Damage deck and dice

`src/data/damageDeck.json` holds all 56 cards, transcribed from the four "CARD FRONT n of 4" sheets
in the print-and-play components. Each card's category comes from its header band colour, its primary
and alternate hits from the two band titles, and its Stress Damage icon (C3.1.4) from the one piece
of artwork a card can carry. Thirteen of the 56 carry the icon.

The attack die faces in `src/engine/dice.ts` come from the DIE ROLL CHART on the Captain's Reference
Card, which prints the equivalent result for every face of a standard d6:

| Roll | Red | Yellow | Green | Blue |
| --- | --- | --- | --- | --- |
| 1 | SPCL | L (2) | L (2) | L (2) |
| 2 | SPCL | M (3) | L (2) | L (2) |
| 3 | SPCL | M (3) | L (2) | L (2) |
| 4 | M (3) | H (4+1) | M (3) | M (3) |
| 5 | H (4+1) | H (4+1) | H (4+1) | MISS |
| 6 | MISS | MISS | MISS | MISS |

Half of a red die's faces are Special, so red dice are only fearsome on weapons with a strong `SPCL`
line — which is exactly what E7.2.5 describes.

## Known gaps

- **Small craft** (E12, J8) — the terminology, degraded-fire and point-defense rules are in the
  engine, but there are no shuttles or fighters to fly yet.
- **Operations systems** (J3–J8) — tractor beams, transporters, sciences, probes and shuttle bays are
  on the ship form and take damage correctly, but are not interactively usable.
- **Terrain** (K) — planets and moons block line of sight, and asteroid transit damage and cover are
  implemented, but the printed terrain counters are raster art, so their individual SPD/DMG/CVR/SCAN
  values have not been imported.
- **Scenarios** (S3) — The Duel, Orbital Ambush and the Expansion 2 Squadron Engagement; the rest
  are straightforward to add.
- **Expansions 1, 3, 4 and 5** — not yet supplied. Expansion 2 (H4, H5) is done.

## Architecture

```
src/
  engine/          Pure rules engine — no React, fully unit tested
    types.ts       Ship-form schema, orders, sequence of play
    dice.ts        Four attack dice + seeded RNG (games replay from a seed)
    geometry.ts    Ranges, arcs, line of sight, turn-template maneuvers
    shipState.ts   Mutable ship state and derived readings
    damage.ts      Damage deck, card resolution, volley application
    command.ts     Command Systems: lending tactical scan (H5)
    coordinatedFire.ts  The ten-step firing sequence (H4, optional)
    combat.ts      Volley resolution, rerolls, fire modes
    engineering.ts Resource allocation, arming, damage control
    navigation.ts  Plot validation, movement, stress checks, disengagement
    game.ts        Sequence of play, terrain, victory points
  data/            Game content — all canon, all machine-imported
    ships.json     72 ship forms from the Master Ship Book
    damageDeck.json  The 56-card damage deck from the component sheets
    scenarios.ts   Section S scenarios and force setup
tools/             Importers that regenerate the JSON from the source PDFs
  ui/              React components; the only mutable-state boundary is store.ts
```

The engine mutates ship state in place, which keeps rule code readable and matches how you'd mark a
dry-erase ship form. The UI subscribes to a version counter rather than diffing immutable trees.

Dice rolls go through a seeded RNG, so a game replays identically from its seed — useful when two
players want to audit a volley after the fact.

### Adding ships

The roster comes from `ships.json`, so a Ship Book update means re-running the importer and replacing
that file — no engine change. To hand-author a ship, append a `ShipForm` object. The schema has a home
for every stat on a printed form: reactor groups and their hit boxes, FUNCTIONS lines with free power
and per-circle values, weapon systems with mounts/arcs/arming circles/slow-arm diamonds/firing
charts/special hits/traits, shields with generator rating, armor, system groups, the interleaved
structure-and-DC-rating track, the sublight drive table, and the Master Ship List victory table.

### Adding scenarios

Write a `Scenario` plus a function returning its starting ships, and add both to `SCENARIOS` in
`src/data/scenarios.ts`. Facings use the scenario compass rose (S2.5.2) via `facingToHeading`.

## Design decisions worth knowing

- **Rerolls are taken on expected value.** E1.2.1 and E1.2.3 make rerolls a *choice* ("may reroll"),
  and the new result is final even if worse. Rather than reroll blindly, the engine rerolls a die
  only when doing so helps the player holding the reroll — the attacker rerolls below-average
  results, the defender rerolls above-average ones.
- **Defender choices are automated.** Damage cards constantly ask the defender to pick a system
  (E8.4.1 Any Hit, E8.3.2 Any Weapon, E8.2.2 Shield Power Loss). `autoChoices` in `damage.ts` plays
  a competent defence — soak on quarters and cargo first, keep weapons and reactors alive longest.
  The `DamageChoices` interface is pluggable, so an interactive prompt can replace it.
- **Arming points are derived, not stored.** E4.2.1 puts point generation and point spending in the
  same segment, so `armingPointsAvailable` computes them live from the FUNCTIONS line minus what has
  been spent this round. Points left over when the segment ends are lost, per E4.2.10.
- **Damage Control Rating drops a hit later than it looks.** B3.1.2 reduces the rating when a box
  *beyond* a track marker is damaged, and sets it to the *following* marker — so the Yorktown's four
  hits leave it at 4 and the fifth drops it to 3. A roster test asserts every ship starts at its
  printed rating and only ever decreases.
- **Victory points come from the Master Ship List.** Each ship carries the printed damage/points
  table (S2.8.3), which is used in preference to recomputing the S2.8.4 percentages.

## Credits

**StarForce Commander** is designed by Patrick Doyle and published by
[Mariner Games](https://www.mariner.games). Lead developers Chandler Archibald and Brandon
Archibald. This repository is a digital implementation of those rules; the game itself, its setting,
and its ship designs are the property of Mariner Games LLC.
