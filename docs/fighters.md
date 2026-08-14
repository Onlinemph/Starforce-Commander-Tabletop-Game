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
     damage to the shield the flight is bearing on. The load is spent in the act. The run is
     *declared* now and *lands* when the segment closes — see E7.1.2 below.
   - **Landing.** One flight per undamaged LNDG box, finishing within two inches of the carrier.
   - **One volley a shield (E7.1.2).** Every strike run against the same ship's same shield in
     the same combat phase resolves as **one volley**, not one each. Held as they are declared and
     settled when the segment closes, the same way homing impacts and H2.4.2 simultaneous fire
     already work.
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

## E7.1.2, and the forward reference nobody picked up

The rule is worth quoting, because it is easy to remember wrong — it is not a cap on how many
flights may attack a shield, it is **pooling**:

> **E7.1.2 Homing Weapon Volley Definition:** All homing weapons striking a single ship on a single
> shield during a single combat phase are a single volley for damage purposes. This applies even if
> those homing weapons are from multiple ships. *(See Fighter Operations rules and Homing Weapon
> rules.)*

That matters more than it looks. A volley is what the damage deck is drawn against and reshuffled
after (E7.1.3), and what a shield absorbs against — so four runs resolved separately against one
shield are four hands of cards and four absorptions where the rule says one of each. A real battle
found it: four SABRE flights each resolved a separate volley into the same forward shield.

Measured after the fix, eight games: **18.9 strike runs resolve as 7.0 volleys, 2.7 runs pooling
into each.** Total damage is unchanged; what changed is how it lands.

**The parenthetical is a question for Doyle.** "(See Fighter Operations rules…)" is a forward
reference the April outline never picks up: the rulebook expects the fighter rules to say how
fighters fold into E7.1.2, and they do not exist. We read it as *yes, fighter ordnance pools* —
the outline calls the load a missile attack, and the alternative is precisely what E7.1.2 exists to
stop — but that is our reading, not a ruling.

---

## What we filled in ourselves, and would rather not have

Three things are ours, not Doyle's, and are marked as such in the code.

- **Point values.** Nothing on a card prices a flight, so we derived one — the working is
  `tools/fighter_points.ts` and the answer is below. It is a defensible number rather than a
  printed one. **This is Q3, and it is the one that blocks points-matched play.**
- **The Peregrine's two missing loadouts.** Its sheet is watermarked MASTER COPY and carries only
  its STRIKE card. The other two are interpolated from the shape every other card holds to.
- **Damage carried between volleys.** COA 1 says divide and remove; it does not say what happens to
  the remainder. A flight here carries it, so two half-kills are a kill. The alternative — the
  remainder evaporating at the end of each volley — makes flights markedly tougher against dribbles
  of fire, and is a one-line change if that is the intent.

---

## What the AI does with them

It loads for the dogfight while there are enemy fighters in the air and for the hull once the sky
is clear — a flight that loses the dogfight never reaches the target. A loaded counter goes for a
hull rather than a dogfight, because the ordnance is spent in one run. It spreads across the
enemy's flights before doubling up on one, and takes a spent flight home to rearm rather than
loitering as a free target for somebody's point defense.

It lands a spent flight to rearm and then **leaves it down until the Hangar Bay Segment has
actually run**. Landing is only worth doing for the rearm, and the rearm is at the end of the
round — a flight that goes back up in the phase it landed has achieved nothing and stopped fighting
to do it. Measured before that rule existed: a carrier spent rounds four to six landing two flights
and relaunching the same two, every phase, still on their BASIC face. The engine still permits it,
because a BASIC counter is a fine dogfighter and a player may launch one whenever they like.

It keeps the wing in the hangar while the enemy is still a map away, and **the horizon is measured
in the fighters' own speed** — two rounds of flying, so the wing arrives about when the fleets do.
That was a flat 24 inches at first, which is most of the printed 36" board and badly wrong on a
72" one: the fleets deploy about fifty inches apart there, so the whole wing sat aboard through the
approach and launched at sixteen inches, with the shooting already started.

**And one bug worth recording, because it made carriers useless in exactly one configuration.**
The store hands `aiNextActions` *every* side the computer commands in a single call, so in an
AI-versus-AI game `sides` is both fleets. This planner asked "who is not in `sides`?" to find its
enemies, got nobody, and its launch gate was vacuously satisfied — the wing never left the deck.
It worked whenever a human held one of the fleets, which is the only way it had been tested. Enemies
are now read off the asking ship's own side, the way every other planner in `ai.ts` does it.

---

## Where it lives

| | |
| --- | --- |
| `src/engine/fighters.ts` | The cards, the flight, the dice, COA 1, launch and recovery rules |
| `src/data/fighters.ts` | The StarForce roster, and the transcribed calibration set |
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

## The StarForce roster

`src/data/fighters.ts` carries two sets. **`SFC_FIGHTERS` is the roster** — five airframes built
out of the printed factions' own technology, and what a carrier flies unless somebody picks
otherwise. `FAN_FIGHTERS` is the Babylon 5 calibration set from the outline, kept the way the
cross-franchise hulls in `tools/fan_designs.ts` are: clearly marked, playable, never a default.

The design rule is that file's rule for original hulls — **a fighter may only express what its
faction already fields, or it is another faction's craft wearing the wrong flag.** A card carries
seven numbers, so the whole of a faction's identity has to arrive through them.

| fighter | faction | Spd | Jam | Str | Sen | what the printed hulls made it |
| --- | --- | --- | --- | --- | --- | --- |
| **SABRE** | Union | 6 | 6 | 4 | 2 | No armour, no cloak, the best sensors in the game — so no extreme, and the only card whose three loadouts are all worth flying |
| **HALBERD** | Union | 5 | 6 | 5 | 2 | The A/MAT doctrine in a small airframe: strike 1‑4 for 3, and the worst dogfighter on the roster |
| **V-1 TALON** | Vallari | 5 | 5 | 5 | 1 | The only faction with armour: Structure 5, and **Dodge 1‑1 loaded** — it does not evade, it takes the hit |
| **STRIX** | Aurelian | 6 | **8** | **3** | 1 | 21 of 21 Aurelian hulls carry a cloak, and what a cloak does is what E10.2.2 jamming does. Plasma strike: 1‑2 to hit, for 4 |
| **MAGPIE** | Pirate | 6 | 5 | 4 | 1 | Nothing printed to read a doctrine off, so: a SABRE with the good parts sold |

Every card stays inside the calibration set's envelope — Speed 5‑6, Jamming 5‑8, Structure 3‑5,
Sensor 1‑2 — for the same reason the fan hulls were weakened into the printed envelope, and that is
asserted in `fighters.test.ts` rather than eyeballed.

### The STRIX is the one worth watching

Its two numbers are opposites, and measurement says both of them bite. Twenty-four fighters flown
off an ARK ROYAL, ten games each:

| wing | | against a **YORKTOWN III** (gunship) | against an **ARK ROYAL** (all point defense) |
| --- | --- | --- | --- |
| SABRE | jam 6, str 4 | 17.4/24 alive, 10.1 structure delivered | — |
| HALBERD | jam 6, str 5 | 20.7/24 alive, 12.4 delivered | — |
| V-1 TALON | jam 5, str 5 | 20.2/24 alive, 9.6 delivered | beat the STRIX **8W‑1L‑3D** |
| STRIX | jam 8, str 3 | 17.7/24 alive, 10.2 delivered | wiped every game |
| MAGPIE | jam 5, str 4 | 17.4/24 alive, 10.1 delivered | — |

Against a gunship the STRIX survives as well as a Structure‑4 fighter *while being Structure 3* —
jamming 8 pushes the main battery's volleys off the chart, and it is worth about a point of hull.
Against a carrier whose every mount is point defense, E12.4.3 removes the jamming entirely and
Structure 3 is fully exposed: it lost all twenty-four fighters in every game and the match 1‑8‑3.

That is the Aurelian bargain everywhere else in this game, on a card, and it means **the counter to
an Aurelian wing is flak, not guns** — which is the same answer F1.20 gives for fighters generally,
sharpened to a faction.

The Union pair is coherent for the same reason in reverse: flown against each other the SABRE beats
the HALBERD 7‑5 on the dogfight, and the HALBERD delivers a quarter more damage to a hull. Neither
is the better fighter; they are the two halves of a wing.

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

That measurement is one of the two independent estimates that produced the price below.


---

## Q3, answered: what a flight costs

`tools/fighter_points.ts` is the working. The method is the one the rest of this repository uses
for anything the printed material does not answer — **derive it from the printed material**:

1. Price the ninety-three printed hulls in two currencies the rules themselves define: **damage
   points delivered per round**, and **damage points needed to remove the unit**. Both come off a
   ship form with no free parameters.
2. Fit their printed point values against those two.
3. Price a flight in the same two currencies, with the Package A rules applied — E10.2.3's halving,
   COA 1's division by Structure, E10.2.2's jamming, one strike per load, and the fact that a
   flight attacks in all three combat phases where a gun mount fires once a round.

Nothing in it is tuned to how fighters play. The only calibration is the printed roster's own
prices, which is the point: where the answer agrees with measured play, that agreement is evidence
rather than construction.

### The fitted law

```
points = 0.0516 × (damage per round × damage to destroy) ^ 0.816
```

Mean absolute error against the 93 printed hulls: **19.5%**. A hand-priced roster is not a formula,
and that is about as close as a two-parameter model gets to one.

**Two shapes were tried first and both failed**, in ways worth recording because they are the two
obvious things to reach for.

- `points = a·damage + b·durability`. Firepower and durability are strongly collinear across the
  roster — big ships have more of both — so with no intercept the fit handed **firepower a negative
  price**. Every fighter in the table was being paid to shoot.
- `points = k · damage^α · durability^β`, free exponents. Same collinearity, subtler failure: it
  settled on α 0.067 and β 2.202, so firepower was worth almost nothing and price rose with the
  *square* of durability. That prices every small unit near zero, which is exactly the mistake a
  fighter model must not make.

Constraining the shape to the product — Lanchester's square law, which makes fighting strength the
product of how hard a unit hits and how long it survives to keep hitting — is identifiable where
two free exponents are not. The V41 sheet reaches for the same shape when it prices offense "twice
over", once against the target's outer defences and once against what is underneath.

### What the published rules do to a flight's durability

Point defense is **71%** of the printed roster's fire, and E12.4.3 exempts it from jamming.
Everything else is halved by E10.2.3 and pushed down the chart by E10.2.2. Walking every printed
weapon across every range on its own chart gives the real cost of that shift:

| jamming | a battery keeps | a flight soaks |
| --- | --- | --- |
| 5 | 58% of its expected damage | 1.25× its printed Structure |
| 6 | 50% | 1.27× |
| 7 | 43% | 1.29× |
| 8 | 36% | 1.31× |

Jamming is worth much less than it looks, *for pricing*, precisely because most of the guns pointed
at a flight ignore it. That is the same finding the STRIX measurement made from the other end.

### The answer

**A flight of six costs 11 to 42 points, median 21.** Against a fleet with no fighters of its own —
where the dogfight is worth nothing — the same flights are worth 2 to 16, median 6.

| | | flight of 6 | | | | flight of 6 |
| --- | --- | --- | --- | --- | --- | --- |
| SABRE | strike | 17 | | STARFURY | strike | 15 |
| SABRE | space sup | 26 | | NIAL | space sup | **42** |
| HALBERD | strike | 22 | | NIAL | strike | 28 |
| V-1 TALON | space sup | 25 | | PEREGRINE | strike | 28 |
| STRIX | space sup | 25 | | FRAZI | space sup | 30 |
| MAGPIE | strike | **11** | | SENTRI | strike | 13 |

The ranking is the one the cards imply: the NIAL is the most expensive thing in the sky and the
MAGPIE the cheapest, and within an airframe the space-superiority loadout costs more than the bomb
truck because it is the one that can do both jobs.

### It agrees with the measurement

The ARK ROYAL measurement was made before any of this existed and shares nothing with it. The
model prices that carrier's hull and wing at **75 points** counting the strike role alone and
**115** counting everything; measured play put it at **100**. The measurement sits between the two
readings, nearer the one that credits the wing for tying up an enemy's whole battery — which is
value the strike-only figure does not contain and the all-roles figure over-credits.

**The number to give Doyle: a flight of six is worth about 20 points, and a fighter about 3.5.**
The carrier keeps its measured ×2.1 modifier rather than the model's, because for one specific hull
a measurement beats a formula — but the two now bracket each other, which they did not before.