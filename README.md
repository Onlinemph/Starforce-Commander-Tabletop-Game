# StarForce Commander — Digital Tabletop

A browser implementation of **StarForce Commander** (Mariner Games, rulebook v2.6, 2026), a game
of tactical starship combat by Patrick Doyle.

Local hot-seat, no server, no accounts. All game data is canon: **72 ships** through Expansion 3 from
the Master Ship Book, the **56-card damage deck** and the **attack dice** from the print-and-play
components. The Basic Set Standard rules are complete, plus **Expansions 1, 2 and 3** — Formation
Maneuvering (C5), Scouting Sensors (H3), Command Systems (H5), nebulae and gas clouds (K4, K5), and,
behind a toggle, the optional Coordinated Fire rules (H4). The rules engine is a standalone TypeScript library with no UI dependencies, so it can
later be driven by a networked client or an AI opponent without change.

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # 245 rules and data-integrity tests
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

Plus **Expansions 1, 2 and 3**: squadrons flying as one counter, scouts that illuminate and jam for
the whole fleet, command ships that lend tactical scan, the optional ten-step Coordinated Fire
sequence, and battles fought inside a nebula. See below.

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
| **C5 Formation Maneuvering** *(Expansion 1)* | ✅ | Join requirements, lead selection, one plot for the group, one counter on the map |
| **H3 Scouting Sensors** *(Expansion 1)* | ✅ | Targeting illumination, area jamming, scan range; canon scout blocks for all 8 scouts |
| **H4 Coordinated Fire** *(Expansion 2, optional)* | ✅ | Ten-step firing sequence, group validation, one attack per faction per phase |
| **H5 Command Systems** *(Expansion 2)* | ✅ | CMND boxes lend tactical scan for the round, live withdrawal on damage |
| E11.3 Ship Explosions *(optional)* | ✅ | Excess-damage check, range-1 blast, aft shield for stacked ships |
| **K4 Nebula** *(Expansion 3)* | ✅ | All eight Common Nebula Effects, plus optional turbulence |
| **K5 Gas Clouds** *(Expansion 3)* | ✅ | Counters, safe speed 1, transit damage, all four degraded-fire cases |

Optional rules (B2.5 full batteries, C3.6 evasive maneuvers, C3.7 reverse movement, C3.8 emergency
stop, C3.9 precise turns, E11.2 derelicts, E11.3 explosions, J6 boarding) are partly implemented in
the engine — reverse movement, emergency stop, derelicts and explosions all work — but are not yet
surfaced as UI toggles beyond the destruction options.

## Expansion 1 — Formation Maneuvering and Scouting Sensors

Both rules are Standard (neither is marked `(Optional)`), so both are always on. Expansion 1 also
reprints C4 Special Situations, which the base implementation already covered.

**C5 Formation Maneuvering** lets a group fly as one counter. Joining takes range 1 of the lead ship,
the same speed, and a heading the joining ship could match with a turn of 45° or less (C5.1.2); the
lead is the *least* maneuverable ship at the formation's speed — the smallest turn template, since a
bigger template angle is a tighter turn (C5.1.1). The formation then plots one set of helm orders for
everybody, and the map draws a single counter with a `×n` badge, as C5.1.3 describes. Everything
else stays independent: sensors, shields, weapons, damage control (C5.2).

The price is E11.3.4 — a ship exploding inside the formation hits everyone on that counter, on the
aft shield. That made E11.3 Ship Explosions worth finishing: it was a declared option whose effect
had never been implemented, so C5's stated tradeoff had nothing to bite on. It is now complete —
one red die per point of excess structure damage, a range-1 blast of one blue die per size class,
and chain explosions that terminate.

**H3 Scouting Sensors** are the fleet-support rule. Eight ships in the roster carry a SCOUT SENSOR
block — four Hermes scouts, the Knox II survey cruiser, two Spectra heavy scouts and the V-2R
Flanker. The block was machine-extracted from the ship forms along with everything else; see
[Ship data](#ship-data).

Each powered sensor is assigned one function during Resource Allocation and holds it for the round
(H3.2.2):

- **Targeting** illuminates one enemy ship within the scout's targeting range. *Every* friendly ship
  firing at that ship gains one targeting point per sensor pointed at it (H3.4.1, H3.4.3) — the
  scout does not need to be anywhere near the shooter.
- **Area jamming** adds one jamming point to every friendly ship within the scout's jamming radius,
  itself included (H3.5.1).
- **Informational scans** extend J4.2 scans to the scout's scan range for one bonus information
  point per sensor (H3.6). J4.2's scan procedure is not interactive yet, so the engine reports the
  capability rather than resolving a scan.

A ship may take targeting from one scout and jamming from one scout (H3.4.4, H3.5.3), and a scout
busy using its own sensors cannot take data from another scout — though its own sensors still serve
it, which H3.5.1 states outright for jamming. Sensors are switched on and off during Operations step
2.E (H3.3.2), never carry power between rounds (H3.3.3), and are marked off by Special System hits
or, at the captain's choice, by Sensor Hits (H3.1.1).

One erratum: H3.2.1 lists the three functions as "targeting, jamming, or tactical scan", but H3.3.1
and H3.6 both name them targeting, area jamming and informational scans, and no rule anywhere lets a
scout sensor feed H2.4 Tactical Scan. The engine follows H3.3.1.

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

A three-a-side **Squadron Engagement** scenario ships with the expansions, since none of these rules
bites in a duel. Neither expansion prints a scenario of its own, so this is a plain Standard
Placement setup (S2.4.1): a command cruiser, a line ship and a scout per side, entering in a tight
vee so the squadron can form up in the first Command Segment.

## Expansion 3 — Nebulae and Gas Clouds

Expansion 3's Sections B and E are the Version 2.6 text of chapters the Basic Set rulebook already
carries — the same B1–B3, E3, E4 and E10 this project implemented from the base book. Comparing
every rule id in the expansion against the base rulebook turns up exactly 28 that are new, and all
28 are K4 and K5. (K6 Hidden Units is a header reserving space for a future expansion.)

**K4 Nebula** covers the entire play area and has no counter (K4.1.1). All eight Common Nebula
Effects are implemented:

| Rule | Effect |
| --- | --- |
| K4.2.1 | Blue and green shield boxes are ignored — damage strikes armor, then goes internal |
| K4.2.2 | Safe speed 2; one blue damage die per point above it, every Navigation Segment |
| K4.2.3 | No low-speed penalty; slow ships are no easier to hit |
| K4.2.4 | SCNC, TRAN and TRAC are offline unless GEN SYS is set to MAX |
| K4.2.5 | *(Optional)* Turbulence: in Phase 3, one red and one green die may push a ship 30° off course |
| K4.2.6 | All weapon fire uses Degraded Fire Control (E10) |
| K4.2.7 | No FTL travel, and no FTL disengagement |
| K4.2.8 | Cloaking gives no benefit — noted for Expansion 5, which introduces cloaks |

Because "specific scenarios may alter the effects of a nebula" (K4.2), and K5.2.4 asks players to
agree which effects apply inside a gas cloud, each effect is a switch on the scenario. Turbulence is
the only one off by default, since it is the only one the rules mark `(Optional)`.

**K5 Gas Clouds** are denser patches drawn as counters. A ship is inside once its base overlaps the
counter (K5.1.2), which the engine measures as the cloud's radius plus half a 1.5-inch counter. The
safe speed drops to 1 (K5.2.1), transit damage follows the same one-blue-die rule (K5.2.2), each
counter records the information points needed to find a hidden unit in it (K5.2.3), and K5.2.4 sends
everything else back to the Common Nebula Effects above. K5.2.5's four degraded-fire cases —
shooting out, shooting in, both inside, and a line of sight merely crossing a cloud — reduce to "any
cloud anywhere on the firing line", which is how the engine tests it.

Where a nebula and a gas cloud overlap, the cloud is the denser region, so its lower safe speed wins.

A **Nebula Patrol** scenario ships with it: two patrols a side, a nebula over the whole map and two
gas clouds inside it (K4.1.2 allows exactly that). With no shields, a crawl for a safe speed and
every shot degraded, it plays nothing like open space.

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

The eight scouts additionally carry a SCOUT SENSOR block — sensor count, damage boxes and the
targeting, jamming and scan ranges — read from the same forms. Each one is checked three ways: the
power circles, the damage boxes and the top step of the SCOUT SEN line must all agree on how many
sensors the ship has. All eight reconcile.

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
- **Terrain** (K) — planets, moons, asteroid fields, nebulae and gas clouds are all implemented, but
  the printed terrain counters are raster art, so the individual SPD/DMG/CVR/SCAN values on each
  numbered counter have not been imported; scenarios set them directly instead.
- **Hidden units** (K6) — the rule is a placeholder in Expansion 3 itself ("we will add Hidden Units
  in a future expansion"). Gas clouds carry their SCAN value ready for it.
- **Scenarios** (S3) — The Duel, Orbital Ambush, the Squadron Engagement and Nebula Patrol; the rest
  are straightforward to add.
- **Informational scans** (J4.2) — scout sensors report their scan range and bonus information
  points (H3.6), but the scan procedure itself is not interactive.
- **Expansions 4 and 5** — not yet supplied. Expansion 4 is the Master Ship Book, already imported
  in full. Expansions 1 (C5, H3), 2 (H4, H5) and 3 (K4, K5) are done.

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
    formation.ts   Formation maneuvering: joining, leading, flying as one (C5)
    nebula.ts      Nebulae and gas clouds (K4, K5)
    scouting.ts    Scouting sensors: illumination, area jamming, scans (H3)
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
