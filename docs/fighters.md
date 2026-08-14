# Fighters, as built (Package A)

What the digital tabletop actually does when you launch a flight, and which of Doyle's open
questions each decision is standing in for. The questions themselves are in
`docs/fighter-questions.md`; the options we offered against each are in `docs/fighter-options.html`.
This file is the record of which option is in the engine, so that when an answer comes back we
know exactly what has to change.

Source: **FIGHTERS AND SMALL CRAFT — NOTES AND OUTLINE, APR 2026**, with the 4‑25‑2026 playtest
notes, read alongside the published v2.6 rulebooks and the V41 ship-form builder.

---

## The one-line version

Fighters roll a plain **d6**. Starships roll the **coloured dice**. The two systems never meet
inside a single roll, which is what lets both live in the same engine without a conversion table.

---

## The six decisions

| # | Question | What is built |
| --- | --- | --- |
| 1 | d6 or coloured dice | **d6 for fighters**, coloured for everything a starship's guns do. The end-of-battle casualty roll would be d6 too, when it exists. |
| 2 | COA 1 or COA 2 | **COA 1**: pool the volley, halve it if it is not point defense, divide by one fighter's Structure, remove that many. |
| 4 | Attacks per load | **One strike per load.** The counter flips to its BASIC face; the Hangar Bay Segment flips it back. |
| 5 | Launch and landing rates | **One flight out per LNCH box per phase, one in per LNDG box.** The V41 builder's own pricing. |
| 12 | Flight or six craft, for cloak | **One launch**, however many fighters go out (H6.15.4). |
| 18 | Jamming | **Exactly E10.2.2** — added to the actual range of non-PD fire. |

---

## How a phase of fighter combat runs

1. **Combat Segment.** The ship's guns fire, including at flights, which is E12.3.4's
   point-defense-first ordering falling out of the published sequence of play rather than being
   bolted on. A flight is one small target (E12.4.2) — the firer picks mounts, not fighters.
2. **Flight Operations Segment (A3.3.5).** Flights launch, fly and fight.
   - **Launching.** One per undamaged LNCH box; a flight's launch is a single cloak-detection roll
     under H6.15.4, so a cloaked carrier can operate. Forming up costs the flight its activation
     for the phase, exactly as a launching shuttle's does under J8.2.1.
   - **Flying.** No facing, no plot. A flight moves up to its airframe's speed in any direction,
     the way a shuttle does under J8.2.3. The counter's position is the leader's, and everything is
     measured from and to it.
   - **Dogfighting.** Every surviving fighter rolls a d6 and hits on its DFR or less; the target
     answers each hit with a Dodge roll. Unsaved hits kill outright — Structure is what a
     *starship's* guns have to chew through, not what another fighter's cannon does.
   - **Striking.** One d6 per fighter against the card's Strike range, each hit doing the card's
     damage to the shield the flight is bearing on. The load is spent in the act.
   - **Landing.** One flight per undamaged LNDG box, finishing within two inches of the carrier.
3. **Hangar Bay Segment (A3.4.4).** Printed "TBD" in the published sequence; this is what goes in
   it. A flight that is aboard rearms — the counter comes off its BASIC face. Fighters lost are
   lost; nothing here replaces them.

---

## The numbers that matter, and why

**Jamming is the most consequential stat on the cards, and the easiest to under-read.** It is not
a to-hit modifier. Under E10.2.2 the target's jamming is *added to the actual range*, so a Nial at
jamming 8 sitting two inches off a Yorktown's bow is fired at as though it were ten inches away —
which demotes the MK‑3 torpedo from its red die to its yellow one, and with it removes the `S`
face entirely (E7.2.5). Ten inches further out, the same flight is simply off the chart and the
battery may not fire at all. Point defense ignores the whole thing under E12.4.3, which is what
makes PD mounts *the* anti-fighter answer and not the main battery. That is thematic and matches
F1.20, and it is also a much sharper effect than the cards let on.

**Structure is armour, not quality.** COA 1 divides pooled damage by one fighter's Structure, so
six Frazis at 5 soak thirty points of point-defense fire before the flight is gone, and six Sentris
at 3 soak eighteen. The Frazi is also the worst dogfighter on the sheet. That is a deliberate
armour-versus-agility axis, not a good-versus-bad ladder — worth confirming, because it makes the
clumsy airframe far more survivable against ships than its DFR suggests (Q19).

**The dogfight model predicts its own playtest.** Six fighters at DFR 1‑3 against a dodge of 1‑2
average `6 × 3/6 × 4/6 = 2.0` kills a phase, so a flight of six is wiped in three combat phases —
one round. The 4‑25‑2026 notes recorded 2, 4 and 5 kills across three phases. That agreement is
checked in `src/engine/fighters.test.ts` rather than assumed, because a model that cannot
reproduce its own source's numbers is the wrong model.

---

## What we filled in ourselves, and would rather not have

Three things are ours, not Doyle's, and are marked as such in the code.

- **Point values.** Nothing on a card prices a flight and the V41 builder says outright that "the
  point value of any fighters is not included in the hangar", so `fighterPoints` prices each stat
  by what it does in a phase and divides to land a six-Starfury flight near 19 points, against a
  printed roster running 6 to 158 for whole ships. It is a placeholder with a formula, not an
  answer. **This is Q3, and it is the one that blocks points-matched play.**
- **The Peregrine's two missing loadouts.** Its sheet is watermarked MASTER COPY and carries only
  its STRIKE card. The other two are interpolated from the shape every other card holds to.
- **Damage carried between volleys.** COA 1 says divide and remove; it does not say what happens to
  the remainder. A flight here carries it, so two half-kills are a kill. The alternative — the
  remainder evaporating at the end of each volley — makes flights markedly tougher against dribbles
  of fire, and is a one-line change if that is the intent.

---

## What the AI does with them

It loads for the dogfight while there are enemy fighters in the air and for the hull once the sky
is clear — a flight that loses the dogfight never reaches the target. It closes on the nearest
enemy flight in preference to a hull, engages, and takes a spent flight home to rearm rather than
loitering as a free target for somebody's point defense. It keeps the wing in the hangar while the
enemy is still a map away.

---

## Where it lives

| | |
| --- | --- |
| `src/engine/fighters.ts` | The cards, the flight, the dice, COA 1, launch and recovery rules |
| `src/data/fighters.ts` | The sixteen transcribed stat cards |
| `src/engine/game.ts` | Flight lifecycle, the Hangar Bay Segment, flights as E12.4 small targets |
| `src/engine/ai.ts` | `planFlightOps` |
| `src/ui/FlightOpsPanel.tsx` | Launching, flying and fighting from the console |
| `src/engine/fighters.test.ts` | The rules, including the playtest-rate check |
| `src/engine/aiFighters.test.ts` | The AI's wing |

Carriers need **HNGR** boxes for the hangar, **LNCH** for the launch rate and **LNDG** for the
recovery rate. All three are in the ship builder and on the Shuttle-or-Hangar-Bay damage card
(E8.4.6). Note the spelling: the rulebook says **LNDG**, the V41 sheet says **LAND**, and the
rulebook wins until Doyle says otherwise (Q5).

Nothing in the printed roster has a hangar, so fighters reach the table through the ship builder,
the fan designs, or a scenario that fields a carrier. A scenario may name each carrier's wing in
the designer; left unset, whoever launches picks the card at the bay door.

---

## The carrier, and what it proved about Q3

`tools/fan_designs.ts` now carries the **ARK ROYAL I-class Fleet Carrier**: a Union hull built to
the YORKTOWN III's own technology — the same LNC-500 phasers and DGR-12A light phasers, on their
printed charts — with a flight deck instead of torpedo tubes. It fills the rung the printed roster
skips: there is not one size-6 hull in ninety-three ships, and a carrier is exactly the shape that
belongs between the size-5 cruiser and the size-7 dreadnought.

Its defining choice is that **it has no torpedoes and every mount it does have is point defense**.
That is doctrine rather than flavour: E10.2.2 adds a flight's jamming to the range of every
non-PD volley and E12.4.3 exempts point defense, so the ship that cannot hurt a cruiser is the best
anti-fighter platform in the Union inventory. Kill its wing and it has nothing left but flak, which
is what a carrier should feel like.

**And flying it measured Q3 for us.** The point model prices the hull at 47.3 and is right about
every part it can see. Mirrored duels at captain, retreat off, 16 games against each printed hull:

| opponent | points | result | | opponent | points | result |
| --- | --- | --- | --- | --- | --- | --- |
| YORKTOWN III | 42 | 16W‑0L | | YORKTOWN V | 78 | 11W‑5L |
| YORKTOWN IV | 48 | 15W‑1L | | EXETER II | 100 | 8W‑8L |
| KURSK I | 50 | 12W‑4L | | UNION I | 50 | 12W‑3L |

A 47-point hull is **dead even with a 100-point EXETER II** — the most efficient hull in the
printed roster. The missing 53 points are twenty-four fighters that no rule prices. So the design
carries a ×2.1 cost modifier and ships at 99.2, priced where it fights the way the armour-only
hulls in that file are, with a note to delete the modifier the day flights are bought separately.

Two independent estimates agree on the order: the provisional `fighterPoints` formula makes four
six-Starfury strike flights about 77 points, which would put the package at 124. Measured play says
100, and the gap is the half of the wing that is always in transit, rearming, or dead.

That is the concrete answer to give Doyle on Q3: **a flight of six is worth roughly 13 to 19
points**, and until that number is printed, any points-matched game with a carrier in it is broken
by about the cost of a second cruiser.
