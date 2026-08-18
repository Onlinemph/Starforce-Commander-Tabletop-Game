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

Still to come per the doc: detection and views (build Phase 2), battle handoff
and repair queues (Phase 3), logistics/VP/Quick Resolve (Phase 4), remote play
(Phase 5), and the campaign UI.

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
