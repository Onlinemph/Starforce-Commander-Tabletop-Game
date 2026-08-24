# The Shipwright — focused, budgeted ship construction

The third way to build a ship (the designer's request, August 2026). The
freeform Ship builder authors every box and will happily let a size-2 hull
ship twenty torpedo tubes; the Shipwright is the opposite discipline, Full
Thrust style: **the hull is the budget**.

## How it works

1. **Pick a faction and a generation.** Tech levels are generations of the
   in-universe timeline, derived from the roster's own years — the Yorktown
   marks land one per band (I 3645, II 3655, III 3662, IV 3667, V 3672):

   | TL | Label | Years |
   |----|-------|-------|
   | 1 | First Generation | to 3654 |
   | 2 | Second Generation | to 3661 |
   | 3 | Third Generation | to 3666 |
   | 4 | Fourth Generation | to 3671 |
   | 5 | Fifth Generation | 3672+ |

2. **Lay down a chassis.** Every canon hull of that faction and generation
   is a chassis: the ship with its guns removed — reactors, function
   ladders, shields, systems, structure and sublight all kept. The yard list
   shows each hull's bare power against its size's budget.

3. **Arm it from the printed catalog.** All 60 canon weapons, each carrying:
   - a **size floor** — the smallest canon hull that mounts it
     (`WEAPON_FLOOR_OVERRIDES` is the designer's dial);
   - an **intro year** — its earliest canon carrier, gated by the chosen
     generation;
   - its **factions** — the picker is faction-locked, with an "open catalog"
     toggle for what-if designs;
   - the printed brackets, dice, special hits, traits, arming ladder and
     mount template. Mounts may keep the printed arcs or take a preset
     (forward, broadside, aft, turret).

4. **The envelope refuses the rest.** Per size class, derived from the
   canon roster itself — each cap is the largest value any canon ship of
   that size actually carries (`ENVELOPE_OVERRIDES` is the dial; canon has
   no size 6, so it interpolates):

   - total **ACTUAL POWER** (the tonnage),
   - weapon **mounts** and **heavy mounts** (red-attack-dice weapons),
   - **weapon systems**, **system boxes**, **shield boxes**, **structure**.

   Violations list live in the yard; a design saves and test-flies only
   clean.

## The permanent property

**Every canon ship is a legal Shipwright design** at its own generation,
faction-locked — pinned as a test across the whole roster
(`src/data/shipwright.test.ts`). The envelope can therefore never drift
tighter than the fiction, and any cap the designer tightens by override
will show exactly which canon hulls it would orphan, by failing that test.

## Where designs go

Saved designs are ordinary custom forms: they price through the builders'
own point model, fight duels, fleets and campaigns, embed in save files,
and can be opened in the freeform Ship builder afterward for fine surgery
(at which point the freeform builder's freedom applies — the Shipwright's
discipline is a construction mode, not a lock on the file).

Code: `src/data/shipwright.ts` (rules, catalog, envelope, validation),
`src/ui/Shipwright.tsx` (the yard).
