# StarForce Commander — Digital Tabletop

A browser implementation of **StarForce Commander** (Mariner Games, rulebook v2.6, 2026), a game
of tactical starship combat by Patrick Doyle.

Local hot-seat, no server, no accounts. The rules engine is a standalone TypeScript library with no
UI dependencies, so it can later be driven by a networked client or an AI opponent without change.

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # 120 rules tests
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

The map is drawn at 1 inch = 20 pixels, so every range and template on screen is the rulebook's own
measurement.

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

Optional rules (B2.5 full batteries, C3.6 evasive maneuvers, C3.7 reverse movement, C3.8 emergency
stop, C3.9 precise turns, E11.2 derelicts, E11.3 explosions, J6 boarding) are partly implemented in
the engine — reverse movement, emergency stop, derelicts and explosions all work — but are not yet
surfaced as UI toggles beyond the destruction options.

## ⚠️ Data that still needs the real thing

Three pieces of game data live in images or physical components rather than rulebook text, so they
are **reconstructions** and are flagged in code. Replacing them requires no engine changes.

### 1. Ship stats — `src/data/ships.ts`

The rulebook points at **Ship Book 1** for every ship form. The two ships here are rebuilt from the
worked examples scattered through the rules: the Yorktown-class heavy cruiser's `TOTAL POWER 8+1`
(B2.2.1), sensor rating 3 (H2.2.3), damage-control track 4/3/2/1 (B3.1.2), turn rates at speeds
2/3/5/6 (C2.2.2), sublight damage table (E8.5.4), phaser arming progression (E4.1), torpedo slow
arming (E4.2.8), and the Type-51 Gravitic Disruptor firing chart (E3.2.1). Everything else is
interpolated. Both forms carry `provisional: true`, which puts a warning banner on the ship form.

### 2. Attack dice faces — `src/engine/dice.ts`

A2.7 shows the six faces of each die as an image. The constraints the *text* pins down are honoured:
potency order red > yellow > green > blue; only red dice carry `S` (E7.2.5); and J3.2.5 states the
maximum face of each colour (red → `S`, yellow and green → `H`, blue → `M`). The exact distribution
within those bounds is a guess. Correct `DIE_FACES` and the whole game re-balances.

### 3. Damage deck composition — `src/data/damageDeck.ts`

E8 documents what every card *does*, and A2.6 says the deck is 56 cards colour-coded by system. The
per-card counts, the ALT HIT pairings, and which cards carry the Stress Damage icon live on the
physical cards. The deck here totals 56 and follows the described colour coding and alt-hit logic.

## Architecture

```
src/
  engine/          Pure rules engine — no React, fully unit tested
    types.ts       Ship-form schema, orders, sequence of play
    dice.ts        Four attack dice + seeded RNG (games replay from a seed)
    geometry.ts    Ranges, arcs, line of sight, turn-template maneuvers
    shipState.ts   Mutable ship state and derived readings
    damage.ts      Damage deck, card resolution, volley application
    combat.ts      Volley resolution, rerolls, fire modes
    engineering.ts Resource allocation, arming, damage control
    navigation.ts  Plot validation, movement, stress checks, disengagement
    game.ts        Sequence of play, terrain, victory points
  data/            Game content: ship forms, damage deck, scenarios
  ui/              React components; the only mutable-state boundary is store.ts
```

The engine mutates ship state in place, which keeps rule code readable and matches how you'd mark a
dry-erase ship form. The UI subscribes to a version counter rather than diffing immutable trees.

Dice rolls go through a seeded RNG, so a game replays identically from its seed — useful when two
players want to audit a volley after the fact.

### Adding ships

Write a `ShipForm` object. The schema has a home for every stat on a printed form: reactor groups
and their hit boxes, FUNCTIONS lines with free power and per-circle values, weapon systems with
mounts/arcs/arming circles/slow-arm diamonds/firing charts/special hits/traits, shields with
generator rating, armor, system groups, the interleaved structure-and-DC-rating track, and the
sublight drive table. Drop it in `SHIP_FORMS` and it is immediately playable.

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

## Credits

**StarForce Commander** is designed by Patrick Doyle and published by
[Mariner Games](https://www.mariner.games). Lead developers Chandler Archibald and Brandon
Archibald. This repository is a digital implementation of those rules; the game itself, its setting,
and its ship designs are the property of Mariner Games LLC.
