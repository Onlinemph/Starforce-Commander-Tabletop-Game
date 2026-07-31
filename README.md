# StarForce Commander — Digital Tabletop

A browser implementation of **StarForce Commander** (Mariner Games, rulebook v2.6, 2026), a game
of tactical starship combat by Patrick Doyle.

Local hot-seat, no server, no accounts. All game data is canon: **93 ships** across three factions
from the Master Ship Book and the Expansion 5 Aurelian Starship Book, the **56-card damage deck**
and the **attack dice** from the print-and-play components. The Basic Set Standard rules are
complete, plus **every expansion released** — Formation Maneuvering (C5), Scouting Sensors (H3),
Command Systems (H5), nebulae and gas clouds (K4, K5), cloaking (H6), homing weapons (E5), and,
behind toggles, the optional Coordinated Fire (H4) and jamming-versus-homing (E5.10) rules. The rules engine is a standalone TypeScript library with no UI dependencies, so it can
later be driven by a networked client or an AI opponent without change.

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # 312 rules and data-integrity tests
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

Plus the **operations systems** of Section J — tractor beams that tow a ship down to a crawl,
informational scans, transporters landing boarding parties, marines fighting through a ship's
corridors until it is captured, probes flown out of torpedo tubes, and shuttles that launch, fly
unplotted, board enemy hulls and jam for their mother ship.

Plus **every expansion**: squadrons flying as one counter, scouts that illuminate and jam for the
whole fleet, command ships that lend tactical scan, the optional ten-step Coordinated Fire sequence,
battles fought inside a nebula, and the Aurelian Empire's cloaking ships and homing plasma
torpedoes. See below.

The map is drawn at 1 inch = 20 pixels, so every range and template on screen is the rulebook's own
measurement.

**Forces** are composed from the full roster — 37 Union, 35 Vallari and 21 Aurelian ships, from the
V-2N Flanker scout to the UNION III dreadnought — to a point budget, under the availability limits
of S2.5.4.

And a **ship builder**, built on the designers' own costing spreadsheet, so you can design your own
hulls, have them priced on the same scale as the printed ones, and fly them the same afternoon.

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
| E12 Small Targets | ⚠️ | Shuttles, probes and missiles are targetable; fighters await a carrier book |
| F1–F4 Weapons | ✅ | Traits, special hits, `STR+X`, `PD WPN` vs. `PD MODE`, `NoBAT`, `AMMO` |
| G1 Shields | ✅ | Blue/green boxes, generator rating, raise/lower, repair, reinforce |
| G2 Hull Armor | ✅ | Absorbs after shields; leak bypasses it |
| H1 Basic Sensors | ✅ | Available by leaving sensor points unallocated |
| H2 Sensors | ✅ | Targeting, jamming, tactical scan, per-function caps, sensor damage |
| J1 General Systems | ✅ | NRM/MAX power levels, Operations Segment steps |
| J3 Tractor Beams | ✅ | Lock-on rolls, towing at adjusted speed, displacement, breaking |
| J4 Sciences | ✅ | Informational scans, cumulative across ships and phases |
| J5 Transporters | ✅ | Range by power, shields down at both ends, boarding parties |
| J6 Marine Squads | ✅ | Boarding combat, tight quarters, sabotage, capture (J6.3 is optional) |
| J7 Probes | ✅ | Launched from torpedo tubes, flight, standoff, transmitting |
| J8 Shuttle Operations | ✅ | Launch, unplotted movement, recovery, boarding, jamming shuttles |
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
| **E5 Homing Weapons** *(Expansion 5)* | ✅ | Launch, per-phase flight, endurance, point defense, tractors, head-on and overflight |
| **F5 Plasma Torpedoes** *(Expansion 5)* | ✅ | Imported as homing particle weapons with per-phase bonus damage |
| **F1.13 / F1.16 Missile & Particle** *(Expansion 5)* | ✅ | `MISL X` destruction thresholds; particle damage worn down one point per three |
| **H6 Cloaking Systems** *(Expansion 5)* | ✅ | Four detection levels, datum tracking, search and evasion rolls, all eleven cloaking effects |

Optional rules (B2.5 full batteries, B3.4 repelling boarders, C3.6 evasive maneuvers, C3.7 reverse
movement, C3.8 emergency stop, C3.9 precise turns, E11.2 derelicts, E11.3 explosions, J6.3 arming
the crew) are partly implemented in the engine — reverse movement, emergency stop, repelling
boarders, derelicts and explosions all work — but are not yet surfaced as UI toggles beyond the
destruction options.

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
a command ship; 18 of the ships in the roster have them, from the COVENTRY IIc (2 boxes) to the
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

## Expansion 5 — the Aurelian Empire

The largest expansion by far: a third faction, cloaking, homing weapons, and the two weapon traits
they depend on. Sections E12 and F1–F4 in its table of contents are v2.6 reprints of chapters the
base rulebook already carries.

### H6 Cloaking Systems

The rule's core idea is that **an undetected cloaked ship has no position**. Its counter comes off
the map and a *datum* marks where it was last seen; the owning player tracks only power, speed, and
how many phases it has gone unseen (H6.1). When it decloaks or is found, it replays that speed log
forward from the datum, one phase at a time, using only gentle maneuvers (H6.8).

Searching climbs a four-rung ladder, and each enemy ship climbs it separately (H6.9.3):

| Level | What the searcher may do |
| --- | --- |
| 0 Undetected | Nothing — the ship cannot be fired at (H6.14.1) |
| 1 Contact | Position known too vaguely to shoot (H6.14.2) |
| 2 Track | Fire, but only through Degraded Fire Control (H6.14.3) |
| 3 Target Lock | Fire normally — though the shields stay down (H6.14.4) |

A search compares the searcher's targeting against the cloaked ship's *jamming*, which is
re-purposed as extra power to the cloak while it runs (H6.4.5). More targeting rolls at least two
dice plus one per point of the difference beyond that, equal targeting rolls one, and less targeting
cannot search at all (H6.10.2). Any `H` climbs exactly one rung however many are rolled, and a
searcher may only climb one rung per segment (H6.10.3, H6.15.1). Once a searcher holds a Track it
switches from green dice to yellow, which hit twice as often (H6.12.3). The cloaked ship answers by
rolling one blue die per searcher that holds a fix, dropping a rung on an `M` (H6.13).

All eleven cloaking effects are in force while the cloak runs (H6.4): shields down, weapons and
homing launches locked, no scans, no targeting, no tractors or transporters in either direction, no
command points lent, and no precision targeting against it at any detection level. Engaging the
cloak within 8 inches of an enemy hands that enemy a free Contact (H6.6.3); the cloak must run for a
full phase before it can come off and stay off for one before it can go back on (H6.6.7, H6.7.7).
Speed above 2, and every four points of damage taken, grant the hunters bonus search rolls
(H6.15.2, H6.15.3).

### E5 Homing Weapons

A homing weapon is a counter on the map that flies one leg per phase. Its firing chart is divided
into thick red boxes — the same boxes the importer reads off the page — and E5.1.5 makes each one a
phase of flight: the widest bracket in box *n* is how far it travels during phase *n*, and the
bracket the target actually falls into decides the dice. The launch phase costs no endurance
(E5.1.6), and a weapon that outlives its last box is removed.

Impacts resolve through E5.4: the shield is read from the line between the counter and the target,
both arcs of that shield may answer with point defense, and each shield struck is its own volley.
The two weapon traits then diverge sharply:

- **`MISL X`** (F1.13) — a missile dies once it has taken X points, and partial damage does nothing
  at all. Point defense either kills it or wastes its shots.
- **`PARTCL`** (F1.16) — a particle weapon is never stopped, only worn down: every three points it
  absorbs takes one point off its warhead, eating standard damage first, then leak, then `STR +X`.
  Wear all three to zero and the volley fizzles out entirely.

Tractor beams can hold a missile but never a particle weapon (E5.4 Step 6). The two awkward
geometry cases are handled: a weapon dead ahead of a target moving at least as fast as the range
resolves **before** the target moves, so it strikes the bow rather than being overtaken (E5.9.1),
and a target that flies over a counter is hit as it passes (E5.9.2). E5.10's optional jamming rule —
which slows a homing weapon from its second leg onward rather than shortening its range — is behind
a flag.

### Playing it

An **Aurelian Raid** scenario ships with the expansion: two cloaked Aurelians against a Union
patrol. The tension the rules create is real — a cloaked ship cannot fire at all, so the raiders
have to pick the moment to decloak, while their plasma torpedoes take phases to arrive and can be
ground down by point defense on the way in.

## Ship data

`src/data/ships.json` holds all 93 forms, machine-extracted from the **Master Ship Book** (all ships
through Expansion 3) and the **Aurelian Starship Book** (Expansion 5). The forms are vector art
rather than tables, so the importer reads them structurally:

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
four shield values) and against the Master Ship List's structure count. All 93 ships pass with zero
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

| Ship | Problem | Resolution |
| --- | --- | --- |
| V-6N Savage-class Light Cruiser | G-YAGUS A/MAT Torpedo prints `0-4  5-10  9-15  16-20` — the third bracket overlaps the second | Read as `11-15` so the chart is continuous |
| Invictus I-class Dreadnought | Its RP-B Medium Plasma Torpedo prints the disruptor's trait line, `PREC 1, PD MODE, ATMO` | Restored to `HOMING 3, PARTCL, NoBAT, FTL`, which the same weapon reads on all eight other ships that carry it, and which F5.4 gives as standard |
| Passer II-class Frigate | Prints `FWD SHIELD 6` but draws 7 forward boxes | Printed strengths used; the box count is recorded |
| Corvus I-class Destroyer | Prints `AFT SHIELD 12` but draws 10 aft boxes | Printed strengths used; the box count is recorded |

Every other weapon in the books has a continuous chart, and a test enforces that — with an exception
for homing weapons, whose range restarts at zero in each endurance box (E5.1.5). The Invictus
erratum was found by cross-checking the same weapon across every ship that carries it, and the two
shield errata by the importer's own box-count validation, which is left strict rather than loosened.

## Section J — Operations

Most of a ship's general systems are used in the **Operations Segment**, and the segment runs as the
five steps the rules print (J1.2, J1.4), so everyone's shields settle before anyone's tractor beams
reach out, and beams settle before anyone beams across:

    A · Delayed activation  B · Shields  C · Tractor beams  D · Transporters  E · Everything else

**Power** is the constraint that ties them together. GEN SYS at MAX does not put every system on
maximum — **one system per combat phase** runs at its maximum level and the rest stay normal
(J1.1.2). So the panel makes you pick: tractor beams reaching 2 inches instead of 1, or transporters
reaching 4 instead of 2, or sciences paying double, or a probe in the tube. Not all of them.

### Tractor beams (J3)

Each undamaged `TRAC` box is one beam, and locks are rolled on blue dice — but what counts as a lock
depends on what you are grabbing:

- **A small target** — a shuttle, a probe — needs any single die to come up L or M (J3.2.1).
- **A starship** needs the *summed* damage result across every beam committed (miss 0, light 2,
  medium 3) to equal or beat its size class, doubled at MAX power (J3.3.1). One blue die is worth at
  most 3, so a single beam can never hold a size-5 cruiser however well it rolls — you have to
  commit several, and they stay committed until you let go (J3.2.4).

Once linked, both ships travel at an **adjusted speed** from the Tractor Link Speed Adjustment Chart,
which is where the rule earns its place: being tied to something two size classes larger takes a
speed-8 ship down to 3, and every further ship in the chain costs another point. The ships keep
plotting their true speed, and the difference costs no acceleration and causes no stress (J3.4.5) —
so a towed ship's command card still reads 8 while its counter crawls.

A beam can also reach out and **catch an incoming missile** in Step 4A, after defensive fire has
been rolled (J3.2.2). A held missile goes nowhere; released, it strikes at once with no defensive
fire against it; held to the end of its endurance, it simply expires. Worth knowing before you plan
around it: *every* homing weapon in the printed roster is a plasma torpedo, and particle weapons
cannot be held at all (E5.4 Step 6). So on canon data this rule never fires — it is there for
missiles, which only a custom design currently carries.

The defender is not helpless. Each phase they may force the beam to make its lock-on roll again
(J3.6.1); a link stretched past its range lapses once both ships have moved (J3.6.2); and a lock
whose last beam has been shot away lets go immediately (J3.6.4). A held ship cannot go to FTL at all
(J3.4.4). A big enough ship at MAX power can shove its captive an inch in any direction, unless the
captive has grabbed it back and they are the same size, in which case they simply hold each other in
place (J3.5.1).

### Shooting at small targets (E12.4)

Shuttles, probes and missiles in flight are counters you can fire on. What matters is whether the
weapon was built for it:

- A **point defense** weapon (any `PD` trait) fires normally and applies its damage in full
  (E12.4.3).
- Anything else must use **Degraded Fire Control**, which totals the damage and halves it, rounding
  down (E12.4.4, E10.2.3). A phaser can swat a shuttle; it just does half of what it would to a hull.

A homing weapon may not be fired on during the phase it launched (E12.3.2), so only counters that
have already flown a leg appear as targets.

The exception is a target held in your **own** tractor beam. You shift it into whatever arc suits
and every die does its own maximum — blue a Medium, green and yellow a Heavy, red its Special — so
there is nothing to roll at all (J3.2.5).

### Informational scans (J4)

A scan is worth **a point per science box at normal power, two at maximum, plus a point per sensor
point on Tactical Scan** (J4.2.2). Points are cumulative across phases *and across every friendly
unit*, so three ships scanning the same object pool their findings (J4.2.3).

Range is effective, not actual: 8 inches or less — but a scout illuminating the target pulls it into
reach (H3.4, J4.2.1). Terrain is scannable too.

### Transporters (J5)

One marine squad or landing party per undamaged `TRAN` box per phase, at 2 inches or 4 at MAX
(J5.1.2, J5.2.2). Shields must be down **at both ends** (J5.1.3), which is what makes beaming a
decision rather than a free action. Squads landed on a friendly hull reinforce it; squads landed on
an enemy become boarders for the Boarding Combat Segment (J6).

### Boarding combat (J6)

Marines get aboard by transporter (J5) or by shuttle (J8.2.6); once there, they fight in the
**Boarding Combat Segment** of the Final Phase. Both sides roll one blue die per squad and a Light
hit kills one enemy squad — misses and Mediums do nothing at all. Both sides roll at once, so an
even fight can wipe out everyone and leave the ship in nobody's hands.

**Tight quarters (J6.2.3)** is what makes the rule interesting. Once one side outnumbers the other
two to one, no more than two squads may set about any one enemy squad — so sixteen marines facing
two boarders still only bring four dice, and a small boarding party can hold a corridor for a very
long time.

Instead of fighting, an attacking squad may go after **the ship itself** (J6.2.4): one die each, a
damage point per Light hit, applied by drawing damage cards — except that anything reaching the
structure track is simply lost. Marines wreck systems; they do not scuttle a hull.

Kill every defender and you **capture the ship** (J6.2.5). A captured ship ceases to perform any
actions or functions: no firing, no scanning, no operations. It keeps its engines but may only fly
straight or make Standard turns, though it can still change speed. It may disengage at sublight
immediately, but its captors cannot jump it to FTL until ten rounds after the capture.

J6.3, arming the general crew to repel boarders, is an optional rule and is not implemented. B3.4,
spending damage control dice to kill a boarding squad, is also optional but was already in the
Damage Control Segment.

### Probes (J7)

No printed ship in the roster carries a dedicated `PROB` launcher, which is exactly the case J7.1.3
covers: probes fly from **torpedo and missile tubes**, and loading one costs the tube its full
arming cycle (J7.2.2). A probe runs 16 inches in the Navigation Segment and stops 4 short of its
target; if it cannot close that far in one flight it is lost. On station it feeds back a point of
information a phase, while its target stays inside the 4-inch bubble and its mother ship inside 36
(J7.3). Any hit at all destroys it.

### Shuttles (J8)

Two shuttles per undamaged `SHTL` box, one launch a phase, into the aft arc within an inch (J8.1.5,
J8.2.1). A launched shuttle has spent its activation for that phase. Thereafter it moves up to 3
inches a phase in **any direction regardless of facing**, unplotted and ignoring stress (J8.2.3) —
the only thing on the map that does not plot its movement.

- **Landing** needs its ship moving forward slower than the shuttle and holding that speed (J8.2.4).
  One a phase; two at MAX power, and the second needs a spare tractor beam (J8.1.3).
- **Boarding an enemy** needs the target slower than the shuttle, at least one shield down, and no
  more than its size class in shuttles that phase (J8.2.6).
- **Jamming shuttles** need GEN SYS at MAX and a mother ship at speed 3 or less. One lends its own
  ship a single point of jamming — only its own ship, only one point however many are flying, and it
  self-destructs the moment its ship outruns it or dies (J8.4).

## Force composition

Every scenario prints a force, and that is what **Choose forces** opens with. From there you compose
your own: pick hulls from the roster, set a point budget, and field up to eight ships a side.

The interesting part is **S2.5.4 ship availability**, which is enforced live:

- **Common** — no limit.
- **Uncommon** — at most 40% of a force by point value, *but you may always have one*, however
  expensive. The cap only bites when you add a second.
- **Rare** — at most 20% of a force by point value, with no exemption for the first. "These ships are
  valuable and rarely travel alone", so a lone rare hull is an illegal force — it needs an escort.
- **Unique** — one in the whole battle, counted across both sides.

Availability is not fixed to what the form prints. A class is **Rare in its first year of service,
Uncommon in its second and Common from its third**, and never more available than its printed
maximum. So the picker has a **battle year**: set it to 3660 and the Yorktown III is a rare new
design, set it to 3700 and it is a common workhorse. Set it before a class enters service and you
cannot field it at all. The roster shows each ship's effective rarity for the year you picked.

An illegal force blocks **Start battle**, with one escape hatch: a scenario's own force composition
overrides S2.5.4 (S2.5.1), so a "fight anyway" checkbox appears whenever a rule is broken.

Composed forces deploy into the scenario's own setup zone. A scenario's printed force keeps its
printed placement exactly; ships beyond it extend the line and fold into a second rank when the line
would run off the map (S2.5.3).

## Ship builder

The designers sent through their own design spreadsheet, `1. SHIP FORM MASTER FEDERATION V38` — the
tool they cost ships with. `src/engine/shipBuilder.ts` is a transcription of its model, and
**Ship builder** in the top bar is a front end for it.

You can start from a blank hull or copy any canon ship, edit every part of the form — reactors,
sublight drive and its damage table, shields, armor, systems, the scout sensor block, the structure
track, weapons down to individual mounts and firing-chart brackets, and the FUNCTIONS power levels —
and watch the point value move as you do. Designs are saved in the browser, export and import as
JSON, and appear in **Choose forces** alongside the canon roster, so a custom hull can be flown
immediately.

Special systems keep their own power lines in step. A scout sensor block needs a SCOUT SEN line to
switch its sensors on (H3.2.1) and a cloak needs a CLOAK line to run (H6.3.1); the engine finds both
by label, so the builder maintains the pair rather than letting you save a ship whose sensors can
never be powered. Where a printed form already does something clever — the KNOX II buys two of its
four sensors with a single power point — that is left alone rather than normalised away.

### How a ship is priced

The sheet values eight components, weights each, and divides by ten:

    point value = (general systems + sensors + defense + power system
                   + speed & accel + SIF + maneuver + offense) / 10 × special modifier

Weapons are valued first, because almost everything else is priced against the ship's firepower. A
weapon's damage is averaged across its six range brackets — each weighted by how useful that range
is and how wide the bracket is — then scaled by its reach, its arming time, the arcs each mount
covers, and its traits. Five of the eight components are then scaled by the ship's *actual power*
against a reference hull's 118.39, where actual power counts free power too: free sensor points,
free acceleration, free SIF, and every free arming circle on a weapon line.

Two things in the model are worth knowing because they are not obvious:

- **Sciences boxes are free.** The sheet leaves the SCNC modifier blank — sciences are already paid
  for through the precision bonus they give the ship's weapons (E9.1.3).
- **Damage boxes are one pool.** The system-hits component counts *every* box on the form —
  reactors, batteries, the FTL drive, the maneuvering block, weapon mounts — not just the general
  systems block.

### How accurate it is

Two ways of checking, and both are in `shipBuilder.test.ts`:

The spreadsheet arrives with a part-built hull already entered, which it prices at **8.0809**. The
transcription reproduces that number exactly, along with its actual power (149.33), its damage-box
count (40) and its defense component (76.0498). That pins the arithmetic to the source.

Against the 93 printed ships, the model is unbiased — median ratio **1.00**, and no faction or size
class drifts more than a few percent — with a median absolute error of **3.5%** and 73 of 93 ships
within a tenth of their printed value.

The residual is not a bug to be tuned away. The sheet's last input is a **Special Modifier**, a
designer's thumb on the scale for a ship that plays better or worse than its parts suggest, and the
printed value is the model's value times that modifier. So the builder shows it: type a printed
point value and it reports the modifier your number implies, the same dial the designers turned. No
fudge factor is baked into the model itself.

### What it checks

The design is validated against the rules as you edit, and an illegal ship cannot be flown:

- Size class 1–10 (B1.3.1), max speed 1–8 (C1.2.7), at least one reactor (B2.1.1), at least one
  structure box (B1.8), a Stress Rating of at least 1 (C3.1).
- Shield facings within their printed maxima — 36 forward and aft, 28 to a side (G1.1.3). The input
  deliberately lets you exceed them so the rule can explain itself rather than silently clamping.
- Every weapon has a mount, a firing chart, an arc, arming circles, damage boxes (E2.2.2, E4.2.2,
  E8.3.1) and an arming line in FUNCTIONS (E4.2.6).
- Firing charts run continuously, except for homing weapons, whose range restarts each phase — and a
  homing weapon must say which endurance box each bracket sits in, or it has nowhere to fly
  (E3.2.1, E5.1.5).
- A scout sensor block has a SCOUT SEN line and a cloak has a CLOAK line (H3.2.1, H6.3.1).
- One damaged-speed entry per sublight drive box (E8.5.4), and a turn row for every speed (C2.2.2).
- At least one FUNCTIONS line the ship can actually afford to power (B2.2).
- Warnings for anything no printed ship does: no weapons, a Damage Control Rating of zero, a weapon
  trait the designers never priced, or a shot limit with no matching `AMMO` trait — the model prices
  the printed trait, not the number on the mount, so without it a limited weapon costs full price
  (F1.2).

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

- **Fighters and carriers** (E12.1.3) — the terminology, degraded-fire and point-defense rules are
  in the engine and shuttles and probes fly, but fighters need a carrier book that has not been
  published. Nothing to do until it exists.
- **Terrain** (K) — planets, moons, asteroid fields, nebulae and gas clouds are all implemented, but
  the printed terrain counters are raster art, so the individual SPD/DMG/CVR/SCAN values on each
  numbered counter have not been imported; scenarios set them directly instead.
- **Scenarios** (S3) — two of the six printed missions, The Duel (S3.1) and Orbital Ambush (S3.3),
  plus three written to exercise the expansions: the Squadron Engagement, Nebula Patrol and the
  Aurelian Raid. S3.2, S3.4, S3.5 and S3.6 are straightforward to add.
- **Informational scans** (J4.2) — scout sensors report their scan range and bonus information
  points (H3.6), but the scan procedure itself is not interactive.
- **Expansion 6** — the Master Ship List carries ten classes flagged for it with point values but no
  printed form yet: the Invictus II, Aquila Bellum VI, Tonitrus IV and V, Defensor Alatus II, III
  and IV, Corvus II, and Passer III and IV. Nothing to do until the book exists.
- **Hidden units** (K6) and **base rotation** (C4.3) are placeholders in the source itself — "we will
  add Hidden Units in a future expansion" — so there is nothing to implement. Gas clouds already
  carry their SCAN value ready for it.

**Every published expansion is implemented**: 1 (C5, H3), 2 (H4, H5), 3 (K4, K5), 4 (the Master
Ship Book, imported in full) and 5 (E5, F5, H6, and the Aurelian roster).

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
    cloaking.ts    Cloaking systems: detection levels, searching, datums (H6)
    homing.ts      Homing weapons: flight, endurance, impact, point defense (E5)
    nebula.ts      Nebulae and gas clouds (K4, K5)
    scouting.ts    Scouting sensors: illumination, area jamming, scans (H3)
    combat.ts      Volley resolution, rerolls, fire modes
    engineering.ts Resource allocation, arming, damage control
    navigation.ts  Plot validation, movement, stress checks, disengagement
    fleet.ts       Force composition and ship availability (S2.5)
    operations.ts  Operations Segment, informational scans, transporters (J1, J4, J5)
    boarding.ts    Boarding combat, sabotage and captured ships (J6.2)
    tractor.ts     Tractor beams: locks, towing, displacement (J3)
    smallCraft.ts  Shuttles and probes (E12, J7, J8)
    shipBuilder.ts The designers' point-value model and design validation
    game.ts        Sequence of play, terrain, victory points
  data/            Game content — all canon, all machine-imported
    ships.json     93 ship forms: the Master Ship Book plus the Aurelian book
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
that file — no engine change. To design one by hand, use the ship builder; to add one in code, append
a `ShipForm` object. The schema has a home
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
