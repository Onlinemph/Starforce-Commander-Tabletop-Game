# Fighters: questions for Patrick

Against **FIGHTERS AND SMALL CRAFT — NOTES AND OUTLINE, APR 2026** (with the 4‑25‑2026 playtest
notes), read alongside the published v2.6 rulebooks and the V41 ship-form builder.

Everything below is a question the digital tabletop cannot answer for itself. Where the outline,
the published rules, or the builder already imply an answer, that is noted as **our default** —
if a default is right, "yes, do that" is a complete reply and costs you nothing.

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

### 3. What are the actual fighter numbers?

There is no fighter stat block anywhere — not in the outline, not in either ship book, not on the
counter sheet. The DFR *scale* is set by your examples (Frazi 2, Starfury/Sentri 3, Nial 4,
Shadow/Vorlon 5), but no craft has a Speed, Structure, Jamming, Sensor or Strike value.

What we'd need to field even one: for a handful of representative craft — say a light
interceptor, a standard multi-role fighter, and a bomber — **Speed (1–8), DFR (0–5), Dodge (1–4),
Structure (2–5), Jamming, Sensor, and Strike (to-hit / damage-per-hit), in both loaded and
expended states.**

*Why it blocks:* rules with nothing to run on are not playable.

---

## The ones with a number missing

### 4. How many attacks does a load buy?

"When ordinance is expended, the counter is flipped" gives the trigger, but nothing says how much
ordnance a loadout carries. One strike and it's spent? One per phase until exhausted? A count per
loadout?

**Our default:** one strike per load — the counter flips after its first anti-ship or anti-fighter
missile attack. It matches "it will get a good initial strike and then take a reduction in
capability."

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

So you know what's waiting: the Flight Operations Segment and the (currently empty) Hangar Bay
Segment both already exist in our sequence of play; `HNGR` is already a recognised system; damage
cards for Shuttle/Hangar Bay already resolve; E12/E10 small-target fire, degraded fire control,
point-defense interception of homing weapons, and the J8 shuttle/probe model are all implemented
and tested. What's genuinely absent is fighters themselves — no flight, no dogfight, no DFR, and
no d6 anywhere in the engine.
