# Rules audit against the printed books

September 2026. The engine was checked chapter by chapter against the core
rulebook (v1.2) and Expansions 1, 2, 3 and 5:

- sequence of play, resource allocation and damage control (A3, B)
- navigation and formations (C)
- gunnery, damage and destruction (E, F, G)
- homing weapons and small targets (E5, E10, E12, F5)
- sensors, coordinated fire and cloaking (H)
- special actions and terrain (J, K)

Every finding was checked again against the rule text and the current code
before anything changed. Rule numbers are cited in the code at each fix.

## Rules reading 3

A saved battle is a journal of actions, including refused ones, and replays
under the rules reading it was fought at (`CURRENT_RULES_VERSION`,
`src/data/savedGame.ts`). Every fix below that refuses something once
accepted, or changes a roll or a result, applies from **reading 3** on. New
battles start at reading 3. Older files replay exactly as they were fought.

## Fixed

| Rule | What changed |
|---|---|
| A3.2.1, B2.1.1 | `allocate` only in the Resource Allocation Segment. `arm-mount` there too, or with battery power in a Command Segment (B2.5.6). |
| A3.2.2, B3.2 | `damage-control` only in the Damage Control Segment. |
| B3.2 step 3 | One repair target per category a round, even when dice are split across assignments. |
| B2.2.10 | Dead validation branch removed (no behaviour change). |
| E11.2.4 | A ship going derelict loses its arming and battery charge. |
| E8.4.10 | A Quarters hit's CRGO/SPCL option is a real choice, not only the fallback. |
| J11.2.2 | A Special System Hit can fall on Cargo. |
| J9, J9.1.3 | `disengage` enforces J9: segment, range, FTL power, tractor, capture and cloud locks. FTL is re-checked against current reactor damage. AI and panel use the same check. |
| E8.5.10, J3.2.4, J3.5.1 | Citations corrected. The mutual-lock restriction is relabelled a house rule. |
| E7.1.1, E3.3.8 | One volley per target per phase. A split opportunity may divide fire only across other targets. |
| E3.4.2 | A mount that needs more than one round to arm may not fire at low power. |
| H4.2.3 step 10 | A coordinated group on the top step is capped at five ships. |
| E5.1.7, E5.4.1(4c) | A shield struck by mixed homing weapons resolves each weapon type on its own dice. Point defense is pooled across them. |
| E5.3.5(5), E10 | Homing impacts in a nebula or gas cloud go through Degraded Fire Control. |
| E5.4.1(4b) | A Heavy hit does 5 to a homing weapon. |
| E12.2.4–E12.2.6 | Only point defense may answer a homing weapon that has already struck. The impact panel offers only PD mounts. |
| E5.3.5(2) | Homing weapons take terrain overspeed damage on every leg. |
| E5.3.5(4) | Asteroid cover crossed by the striking leg gives the defender rerolls. |
| J7.3.2 | Probes move at the head of the Combat Segment, not in Navigation. |
| H6.6.7, H6.7.7 | A cloak holds two phase boundaries before it may come off, and stays off as long before re-engaging. It was one short. |
| H6.4.5, H6.14.4 | A cloaked target's jamming feeds the cloak and no longer lengthens the range of a shot at it. |
| H6.9.2 | One search a phase per searcher, however many cloaked ships there are. |
| H6.4.9 | Small craft cannot land on or dock with a cloaked ship. |
| H6.9.4 | A search needs line of sight to the datum or contact. |
| C3.9.3, C3.9.4 | Emergency turns honour a plotted turn rate, up to 90°. |
| C3.9.2 | Hard and S-turns may take a different rate for each heading change (`turnRate2`). |
| C2.4.1 | The command card can slide before moving forward (`slideFirst`). |
| C3.1.4 | A Fire or Bridge Hit drawn at a stress check cascades its extra cards. |
| C3.6.7 | An evasive ship may not use transporters or tractors, or launch or recover shuttles and fighters. The AI no longer tries to. |
| C5.1.3, C5.2 | A formation member that cannot pay for the lead's acceleration leaves the formation. It no longer matches the lead's speed for free. |
| K4.2.4 | Nebula and gas-cloud hampering reaches tractors and scans, not only transporters. |
| K2.1.7 | Evasive maneuvering rerolls asteroid transit damage. |

`turnRate2` and `slideFirst` are in the engine and the command card. The plot
panel does not offer them yet.

## Kept as it is

- **E11.2.4/E11.2.7: derelicts and damage control.** The book lets a derelict
  repair black structure boxes. Reading 2 locks derelicts out of repairs, a
  playtest decision from the Union III vs four Yorktowns game. It stays.
- **G1.3.3: shield repair scaling with power.** The text is silent on whether
  extra power buys extra repair, as it explicitly does for reinforcement. No
  ship has a multi-step SHLD REPR line, so the question is not live. It needs
  the designer's ruling.

## Deferred: larger than a fix

- **E3.4.4: point defense splitting dice.** Part of a PD mount's dice could
  fire defensively and the rest offensively in the same round. This needs a
  dice-count choice on small-target fire, panel controls, and AI doctrine for
  how much to hold back.
- **E12.1.2/E12.3.3: intercepting direct-fire missiles and particles.** Point
  defense would engage the shot mid-volley. This needs an interception step
  before direct-fire damage. It is live for three custom-roster weapons:
  - HYPERION's Medium Particle Cannon
  - OMEGA's Pulse Cannon
  - IMPERIAL I's NK-7 Ion Cannon
- **E5.2.9: precision targeting on homing launches.** No ship combines PREC
  and HOMING today.
- **J10: self destruction.** This covers:
  - a fuse of one to five rounds on the command card
  - cancelling it in Resource Allocation
  - marines defusing it
  - the conditions for using it at all

  It is a small subsystem of its own.
