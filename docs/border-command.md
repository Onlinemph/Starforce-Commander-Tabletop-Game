# Border Command — implementation notes

The operational campaign layer (`src/campaign/`), built to the Border Command
design doc v0.3. This file records what each build phase shipped, the decisions
the doc left to the implementer, and the discrepancies found between the doc
and the repo's data — the latter feed the doc's Part 12 list for Doyle.

## Build Phase 1 — state, map, stats (shipped)

- `types.ts` — the campaign schema: units, standing orders, contact records
  (schema only; mechanics are build Phase 2), infrastructure, scenario, the
  one JSON campaign file, and the seeded stream. Randomness is a pure function
  of `(seed, call#)`, so the call count in a stored state is itself checkable.
- `hexmap.ts` — flat-top axial math (`hexDistance` implemented once,
  property-tested; the doc's instruction) and seeded map generation: 8–14
  systems at least 4 apart, 3–5 nebula blobs, 2–4 dust belts, a jagged border.
  The generated map is **stored** in the campaign file, never regenerated at
  load — to keep that promise, the generator spends a derived throwaway
  stream and the campaign stream opens at call zero regardless of how many
  draws generation made.
- `stats.ts` — operational stats derived from ship forms plus the builder's
  ACTUAL POWER, over the full canon roster, anchor-tested. No hand-entered
  roster exists anywhere.
- `turn.ts` — `resolvePhase`: the 12-phase alternating clock (A odd, B even),
  interventions (the only journalled thing), waypoint auto-steps, nebula/dust
  move debt, the round tick skeleton.
- `file.ts` — create / save / load / replay. `loadCampaign` refuses a file
  whose stored state does not equal the journal replay; replay-equals-cache is
  the permanent test, exactly as it is for battles.

## Build Phase 2 — detection, contacts, views (shipped)

- `detection.ts` — the passive sweep after every phase's movement, both sides,
  twelve a round (4.1). Doyle's curve is scenario data; modifiers shift the
  roll by whole columns (4.3), with the worked example's arithmetic pinned as
  tests (a held-still target at range five is off-curve, sensors at two power
  read range five as four). Contacts climb the graded attribute ladder (4.4),
  sciences ≥ 3 climbing two rungs a scan, identification gated behind range
  three or a scout block, a close formation hiding its count to range one.
  Misinformation (4.5) corrupts description and never presence, and a closer
  look than the lie was bought at re-rolls it. Contacts decay at the round
  tick and collapse to last-known markers after three quiet rounds.
  Infrastructure senses (3.4): bases/outposts/colonies as radar certainty on
  the uncloaked, listening posts rolling the curve capped at three.
- `views.ts` — the wall. `viewFor(map, state, side)` is the only way
  player-facing code sees a campaign: own units whole, enemies only as
  contacts with umpire fields stripped (no truth flags, no target unit ids —
  contact ids are opaque sequence numbers precisely so they can't name their
  target), positions dead-reckoned along the observed course while unobserved.
  The tests attack the serialized view the way a cheating client would: grep
  the bytes for anything the side should not know.
- **No actor privilege, by construction.** Every actor — either player, a
  future campaign AI — issues the same interventions through the same
  resolver, which enforces the rules itself (a cloak order on a cloakless
  hull, a mission aimed at a contact the side does not hold, another side's
  unit: all `PhaseError`s, not UI conveniences). Intercept and Shadow (5.3)
  take a *contact id*, never an enemy unit id, and steer by `reckonedHex` —
  the side's belief — so no order can act on the umpire's truth. A test pins
  this by penciling in a deliberately wrong estimate and confirming the
  interceptor chases the belief, not the ship.

## Build Phase 3 — the battle handoff (shipped)

- **Exact scars** (3.2, via the doc's one permitted engine touch, 7.6.2):
  `ShipScars` + `captureScars`/`applyScars` in `src/engine/shipState.ts` —
  every marked box, clamped to the form, structure through `markStructure` so
  damage control and stress remember, and the victory baseline set in hit
  points so an opponent scores exactly the damage inflicted THIS battle.
  `CustomScenario` sides carry `scars` beside the old fractional `damage`.
- **Engagements** (`engagement.ts`, 7.1–7.2): knowledge-gated — a unit whose
  presence is unknown to the enemy is never auto-engaged; its standing-order
  posture springs the ambush or stays silent, and since a same-hex scan
  always finds an uncloaked hull, ambush is a cloak's privilege by
  construction. Withdrawal rolls the campaign stream with the doc's
  modifiers; failure fights as the defender, caught retreating.
- **The handoff** (`handoff.ts`, 7.3–7.4): a deterministic battle file per
  engagement — same campaign state, same bytes, so both consoles derive it
  without exchanging it and the journal's FNV-1a hash proves they did.
  Terrain translates per 2.2, formations set deployment spread, the richer
  dossier deploys second (an ambusher outranks arithmetic), campaignRef
  links back. `readback` replays the finished battle and walks the final
  state into a `BattleResult`; results ride the NEXT journal move, and the
  resolver refuses to advance while a battle is unresolved.
- **Repair** (`logistics.ts`, 3.2): priority queues per unit (the doc says
  per ship; per unit is the same knob with less clicking), spent down
  deterministically — 1 system box a round underway, 3 at a colony, 6 at a
  yard; structure never underway, every other round at a colony, 1 a round
  at a yard; armor plate rides with structure. Damage bands feed the fog:
  damaged hulls search worse, crippled hulls run loud and cannot cloak.
- **A latent tactical bug found by the campaign**: `deploy()` prefixes ship
  ids with the side's first word, so two sides sharing one ("Task Force 1"
  vs "Task Force 2") minted colliding ids and every lookup hit the first
  side's hull — orders landed on the wrong ship and a whole force went
  silent. Guarded in `scenarios.ts`; printed scenarios and their replays are
  untouched.

Still to come per the doc: logistics/endurance, convoys, reinforcements, VP
scoring and Quick Resolve (build Phase 4), remote play (Phase 5), the
campaign UI, and false contacts (4.6 — the tuning flag exists, off by
default). Listening posts are not yet themselves scannable targets; enemy
bases, outposts, colonies and beacons are chart-known per the doc's 12.8
presumption. Post-battle, contacts are not force-updated to truth — the
table revealed the enemy for one fight, but the dossier keeps its own
history (a deliberate reading; flag for Doyle if deployment should teach).

## Where the doc met the data (Part 12 material)

1. **"V-7: cloak true" (3.1.1) is not what the roster says.** No V-7 RAIDER
   form carries a CLOAK system. In this transcription cloak is an Aurelian
   line: all 31 Aurelian hulls, nobody else. The derivation reads the form
   (`CLOAK` boxes > 0) and the anchor tests an Aurelian destroyer instead.
   Question for Doyle: should any Vallari hull cloak?
2. **"Knox II survey cruiser: sciences ≥ 4" (3.1.1) vs SCNC 2 on the form.**
   The Knox II's survey character lives in its Scout Sensor block (H3), not in
   extra SCNC boxes. `sciences` therefore counts SCNC boxes **plus 2 for a
   scout block** — which also matches 4.4's rule that a scout block stands in
   for closing to identification range. The anchor passes honestly.
3. **The canon roster is 103 hulls, not 93.** The doc (and the README it read)
   undercounts; the derivation and its tests run over everything non-fan with
   a printed point value.
4. **Fighters are ahead of the doc.** §3.3 assumes tactical fighters are a
   gap. The engine has flights, dogfights, strikes, carrier ops and priced
   fighter cards as of this month, so starwing records (build Phase 4) can
   bind to the real flight system rather than a placeholder.

## Derivations (3.1), as shipped

- `signature = clamp(round(sizeClass/2 + actualPower/40), 1, 10)` — the doc's
  proposed formula, verbatim; spread over the roster is 2–10.
- `sensorRating = clamp(topSensorValue + 2·scoutBlock + 1·hasCMND, 1, 10)` —
  the SENSOR line's best buyable Tactical Scan is exactly the 0/1/2-power
  ladder Doyle's variable list names (H2.2.1 prices it).
- `sciences = clamp(SCNC + 2·scoutBlock, 0, 5)`.
- `endurance = clamp(sizeClass + 2, 4, 8)`; `ftlRating = FTL DRV boxes`
  (the 5.4 sprint placeholder); `combatValue` = printed points, verbatim per
  the doc — note the repo also carries measured balanced values
  (`src/engine/fleetValue.ts`) if Doyle ever wants campaign forces bought on
  the battle-value scale instead.
