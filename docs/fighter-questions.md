# Fighters: questions for Patrick

Against **FIGHTERS AND SMALL CRAFT — NOTES AND OUTLINE, APR 2026** (with the 4‑25‑2026 playtest
notes), read alongside the published v2.6 rulebooks and the V41 ship-form builder.

Everything below is a question the digital tabletop cannot answer for itself. Where the outline,
the published rules, or the builder already imply an answer, that is noted as **our default** —
if a default is right, "yes, do that" is a complete reply and costs you nothing.

The stat cards embedded in this outline's own document are transcribed in `fighter-stats.md`, and
they answer more than we expected — Q3 below is rewritten because of them.

A note on what's *not* here: a large share of the outline turns out to be already published, and
we don't need those confirmed. E12.3.4 already gives the ship its point-defense shot before the
fighters attack, in the outline's own words. E11.3.5 already exempts small craft from starship
explosions. E12.4.4 and E10.2.3 already halve non-PD fire. E12.4.2 already targets *the flight*
rather than individual craft, and already uses the word "flight". E7.1.2 already carries a
forward reference to "Fighter Operations rules" for the one-volley-per-shield rule. J8.2.2 already
has players alternating **two** small craft at a time, with priority by Tactical Scan and passing
allowed. And J3.2.1 already answers the outline's "Tractor beams can possibly be used against
fighters" with a firm **no** — "may not lock onto fighter craft due to their maneuverability
unless the owning player allows it".

---

## The three that block everything

### 1. d6 or the coloured dice?

> "Standard 6-sided dice are used. The colored dice impose constraints and lack granularity."

The playtest agrees ("Using 6 sided dice for fighters worked well"), so we take this as settled —
but the same document then rolls **a red die for an "S" result** in the end-of-battle casualty
rule. Which is it? If fighters own a d6 subsystem, does *anything* else about them touch the
coloured dice, or is the boundary exactly "fighter-vs-fighter and fighter survival are d6,
everything a starship rolls stays coloured"?

**Our default:** the boundary above, and the casualty roll becomes a d6 too.

*Why it blocks:* it decides whether fighters share the combat core or get a parallel one.

### 2. COA 1 or COA 2 for ships killing fighters?

You wrote "Use COA 1 for now since its an existing game mechanic," which we read as a lean rather
than a decision. Worth knowing before you choose: **E12.4.2 already says** the firing player is
"not required to assign specific weapon mounts to a single small target; only the volley or
flight is required." That is COA 1's pooling, already in print — and it rules against the COA 1
*variant* in your notes that assigns specific dice to single fighters.

**Our default:** COA 1 as written — pool the damage against the flight, divide by Structure,
non-PD fire halved by E10.2.3 first.

*Why it blocks:* it is the entire fighter-casualty model.

### 3. Are the six card fighters the roster, or a calibration set?

*(This question changed once we found the stat cards embedded in this outline's own .docx — the
file is 1.4 MB against 9.8 KB of text, and the difference is eleven images a text extraction never
sees. Sixteen cards are transcribed in `fighter-stats.md`; we no longer need the numbers.)*

What we need instead: every card is a **Babylon 5** design — EA Starfury and Thunderbolt, Narn
Frazi, Minbari Nial, Centauri Sentri. Not one of StarForce Commander's own factions has a fighter
among them. Is this a calibration set — the same instinct as pricing the DFR ladder against known
franchises — with Union/Vallari/Aurelian/Pirate craft still to come? Or are these meant to be
fieldable, with the SFC factions borrowing from them?

**Our default:** treat them as a calibration set and ship them as fan designs, the way the
cross-franchise hulls in `tools/fan_designs.ts` already work — clearly marked, playable, and kept
out of the printed roster.

**And the number that is still missing: point values.** Nothing on a card prices a flight, and the
V41 builder explicitly excludes fighters from the hangar's cost. What does a flight of six
Starfuries cost in a fleet list?

*We have since derived an answer — about 20 points for a flight of six, 15 for those Starfuries
specifically — by fitting the printed roster's own prices to damage delivered and damage absorbed,
and it agrees with what a carrier's wing measures at in play. `docs/fighters.md` has the working.
The question stands: is that the right order of magnitude, and is a flight priced per aircraft or
per counter?*

*Why it blocks:* fighters can be flown without prices, but they cannot be balanced or fielded in a
points-matched game.

---

## The ones with a number missing

### 4. How many attacks does a load buy?

"When ordinance is expended, the counter is flipped" gives the trigger, but nothing says how much
ordnance a loadout carries. One strike and it's spent? One per phase until exhausted? A count per
loadout?

**Our default:** one strike per load — the counter flips after its first anti-ship or anti-fighter
missile attack. It matches "it will get a good initial strike and then take a reduction in
capability."

**A related reading we'd like confirmed or killed.** On the cards, BASIC is always the weakest
Strike — `1/1` on the Starfury and Sentri, meaning it hits a starship only on a natural 1, for one
point. Is **BASIC the expended side** of a STRIKE or SPACE SUPERIORITY card, or a genuinely
separate third loadout chosen at launch? Both readings fit "There may be 2 sets of stats on each
card." If it is the flip side, the double-sided counter is already solved and no separate expended
block is needed.

### 5. Launch and landing rates

Both lines in the outline are placeholders for numbers that were never written. **The V41 builder
answers this,** and we'd like it confirmed: it prices **LNCH** at 2 points with the note "One
launch bay represents the ability to launch a fighter unit," and **LAND** at 1 point, "the ability
to land/recover a fighter unit."

**Our default:** one flight launched per LNCH box per phase, one recovered per LAND box per phase
— replacing J8.1.2's one-shuttle-per-phase for carriers rather than adding to it.

**Related:** the builder calls the landing bay **LAND**, but rulebook E8.4.6 calls it **LNDG**.
Which abbreviation is canonical?

### 6. What does a hangar hold?

The builder says a hangar "contain[s] a full fighter unit (generally 2-12 craft)" and prices
**HNGR** at 1 point per box, with fighter point values excluded. Is one HNGR box one *flight*
(1–6), or is the 2–12 range per box? And does the "point value of any fighters is not included"
note mean fighters are bought separately in a fleet list?

### 7. Fighter Control — in or out?

You hedge three ways ("optional… might overcomplicate the game… perhaps an advanced rule"), but
the builder already prices **FCON at 12 points a box**, by far the most expensive system on that
list, and the mechanic is specified: it lets a carrier activate a flight during its own offensive
fire step.

**Our default:** build it as an optional rule, off by default, exactly like Coordinated Fire (H4)
and the other H-series options.

---

## The ones where the outline contradicts itself

Each is a one-word answer.

| # | Where | The conflict |
|---|---|---|
| 8 | Flight size | "groups of **1-6**" vs "maximum of 4 flights of **less than 6** fighters" |
| 9 | DFR range | "DFR: from **1-5**" vs the table beneath it, which starts at **0: Unarmed** |
| 10 | Dodge | "Dodge Roll: **1-4**" vs the playtest's "a dodge of **1-2**" |
| 11 | Dice | d6 throughout vs "roll a **red die**" for casualties (same as Q1) |

**Our defaults:** 1–6 fighters per flight; DFR 0–5; Dodge 1–4 as the design range with playtest
values sitting inside it.

---

## The ones the published rules force us to ask

### 12. Does a flight launch as one craft, or as six?

**H6.15.4** gives every searching ship an extra detection roll *per small craft launched*, and the
Aurelian reference card prints it as "Launching Craft: +1 Roll per Small Craft Launched". If a
six-fighter flight counts as six launches, a cloaked carrier is effectively forbidden to launch.

**Our default:** a flight launches as **one** small craft for H6.15.4.

### 13. What is a fighter's "Dodge" in published terms?

J8.3.2 gives shuttles "evasion level 1" and points at **C3.6**, where the benefit is *re-rolling
incoming attack dice* — not a save roll. Your Dodge is a save roll wearing that name. Two
consequences we want confirmed:

- **F1.4.3** already rules "Small craft MAY NOT use their evasion roll when fired at by point
  defense weapons." Does that carry over to the Dodge roll? (**Our default:** yes.)
- **K2.2.3** already lets small craft take asteroid-cover re-rolls *and then* "their regular evade
  rolls against starship weapons." So both mechanics may coexist for fighters.

### 14. Leader succession

The flight leader's position is load-bearing — it's what movement is measured from and what all
ranges are measured to. Nothing says what happens when the leader is the casualty, and "simply
remove one of the flight's counters" doesn't say the owner may protect it.

**Our default:** the owner nominates a new leader immediately, placed where the old one stood.

### 15. Does a fighter have a facing?

The outline lists "Maneuvering and Facing" as a header and never returns to it. Shuttles under
J8.2.3 explicitly move "in any direction, regardless of its facing."

**Our default:** fighters have no facing — they move like shuttles, and Strike/DFR ignore arcs.

### 16. Activation: individually, or two flights at a time?

Two lines are given without a choice: "Players alternate moving all Individual small craft" and
"Players alternate moving 2 Flights." Are those alternatives, or two rules (loose craft one at a
time, organised flights two at a time)? **J8.2.2 already publishes** two-at-a-time with priority
by Tactical Scan.

**Our default:** two flights at a time, J8.2.2's priority and passing unchanged.

---

## Smaller, and safe to defer

- **Refuel** appears once, as a header, and nowhere else in the game. Is there a fuel rule coming,
  or is "Repair and Rearm" the whole of hangar function? (J8.1.4 already repairs 4 boxes of one
  small craft at GEN SYS MAX, in the Damage Control Segment.)
- **Squadron size** — "multiple flights", capped at 4 by one line. Is a squadron ~24 craft?
- **Fighter-era Shuttles and Transports** are listed as small-craft types, but shuttles already
  exist under J8 with their own speed, hits and evasion. Do the fighter rules replace J8's
  shuttle, or coexist with it?
- **Boosted movement** — the magnitude is never given.
- **End-of-battle casualties** — you mark it "optional… probably". Worth confirming it belongs to
  campaign play rather than a single battle, since it needs the carrier to survive.

---

## What we've already built that this lands on

**Update, since this list was written: fighters are now flyable.** We took the defaults marked
above — d6 for fighters and coloured dice for ships, COA 1 pooled with non-PD halved first, one
strike per load, a flight as one launch for H6.15.4, E10.2.2 jamming exactly as published, and one
flight out per LNCH box and in per LNDG box — and built them, so the open questions can be answered
against something you can actually play rather than in the abstract. Every one of them is a switch
we can throw the other way; `docs/fighters.md` records which decision each line of code is standing
in for. The AI flies its wing too, so a solo game has fighters on both sides.

Underneath, the Flight Operations Segment and the Hangar Bay Segment both already existed in our
sequence of play — the latter printed "TBD", and now holding rearm; `HNGR` was already a recognised
system, and `LNCH` and `LNDG` have joined it on the Shuttle-or-Hangar-Bay damage card; E12/E10
small-target fire, degraded fire control, point-defense interception of homing weapons, and the J8
shuttle/probe model were all already implemented and tested.

**And Q3 now has a proposed answer.** We derived a price rather than guessing one, by the same
method the rest of this project uses for anything the printed material does not settle: price the
93 printed hulls in two currencies the rules define — damage delivered per round, damage needed to
remove them — fit their printed point values against the product, and price a flight in the same
currencies. The fit reproduces the printed roster to 19.5%. **A flight of six comes out at 11 to 42
points depending on the card and loadout, median 21; a fighter is about 3.5.** An independent
measurement — flying a carrier against printed hulls until it found its weight — lands in the same
place. The working is `tools/fighter_points.ts` and the write-up is in `docs/fighters.md`. It is
still ours rather than yours, and a printed number replaces all of it.


---

## Raised by the stat cards themselves

### 17. Four ID boxes per card — does that cap the squadron?

Every card has exactly four `ID` boxes down its right edge. Is that "up to four flights may share
this card", or just how many fit on the artwork? It would tie neatly to "a maximum of 4 flights".

### 18. Jamming is doing an enormous amount of work — is that intended?

Jamming runs 5 to 8 across the six airframes, and under **E10.2.2** a target's jamming is added to
the actual range of any non-point-defense attack, which can push the volley into a worse bracket
or off the chart entirely. A Nial at jamming 8 is close to untouchable by a starship's main
battery — only point-defense weapons, which ignore the penalty under E12.4.3, can reliably answer
it.

That may be exactly the intent: it makes PD mounts *the* anti-fighter answer, which is thematic
and matches F1.20. We flag it because it is the most consequential number on the cards and it is
easy to under-read — it is not a to-hit modifier, it is a range-bracket shift.

**Our default:** implement E10.2.2 exactly as published, then report what it actually does to
fighter survivability once it can be measured.

### 19. Does Structure divide per fighter or per flight?

Structure is per fighter (Frazi 5, Sentri 3), and COA 1 divides pooled damage by "the structure of
the fighter" — so six Frazis soak 30 points before the flight is gone and six Sentris soak 18.
Confirming that is intended, since it makes the tough-but-clumsy airframe far more survivable
against ships than its dogfight rating suggests.

### 20. Does E7.1.2's pooling reach a fighter's strike run?

**E7.1.2** says all homing weapons striking a single ship on a single shield in a single combat
phase are one volley for damage purposes, "even if those homing weapons are from multiple ships",
and it carries a forward reference — "(See Fighter Operations rules and Homing Weapon rules.)" —
to rules that do not exist yet.

Between flights the question mostly answers itself: the outline's "only 1 fighter flight (no matter
how large) may attack a single starship shield per phase" means there is never a second flight's
run on that shield to pool with. What it does not settle is the mixed case — a flight runs in on a
cruiser's port shield in the same phase that somebody's torpedoes arrive on it. One volley or two?

It matters because a volley is what the damage deck is drawn against and reshuffled after
(**E7.1.3**), and what the shield absorbs against. Two separate volleys are two hands of cards and
two absorptions.

**Our default:** resolve them separately — the fighter's run lands in the Flight Operations
Segment, the warheads in their own, and the engine does not reach across segments to pool them.
