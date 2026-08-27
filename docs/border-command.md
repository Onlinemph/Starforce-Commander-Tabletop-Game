# StarForce: Border Command — implementation notes

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

## Build Phase 4 — operations and Quick Resolve (shipped)

- **Endurance** (6.4, `logistics.ts`): one pooled point a round, one more for
  cloaked running (tracked per phase, either side's), one more for sensors
  held at full power; the smallest tank aboard sets a unit's legs (3.1);
  bases, outposts and colonies refill whoever ends the round alongside
  (3.4). A dry tank grounds the cloak and caps sensors at zero power. Sprint
  costs join when Doyle's FTL rules replace the 5.4 placeholder.
- **Convoys and victory** (6.3, 10.1, `scoring.ts`): a convoy ending its
  round beside an intact friendly jump beacon rides the chain one hex
  further; standing on its delivery hex banks the scenario's points and
  leaves the map. The campaign ends at the round limit or a VP threshold,
  higher ledger wins, level draws — settled at the tick so a final-round
  delivery counts. The 3.4 infrastructure VP table is exported for when
  infrastructure assault lands.
- **Reinforcements** (S3.2): scenario units with `arrivesRound` are held OFF
  the map — not drawn, not scannable, not engageable — and spawned by the
  tick. Your own schedule shows in your view (`incoming`); the enemy's never
  crosses, and an arrived reinforcement is found the way anything is found.
- **Starwings** (3.3): `WingRecord` per carrier hull — ready wings fly their
  card into the battle file; readback grades the survivors (fought → rearming
  two rounds; under half left → depleted until a fleet base rebuilds; none →
  destroyed, replacements being reinforcements, not a timer). A not-ready
  wing withholds its card; fully grounding its hangar awaits a scenario knob
  for hangar contents.
- **Quick Resolve** (Part 8, `quickResolve.ts` over the engine's new public
  `playBattle` driver — the doc's permitted touch 7.6.1): the same battle
  file, played headlessly, read back by the same readback; temperament from
  posture (intercept → aggressive, withdraw/shadow → cautious); admiral by
  default, honest about retreat. The parity test pins quick = played-with-
  both-AI byte for byte, and the returned battle file replays in the theater.
- **Launch scenarios** (10.2, `scenarios.ts`): The Border Watch, Raid on
  Delta Videus, The Long Patrol — all canon hulls, convoys sailing small
  warships as freighter stand-ins until Doyle's civilian designs land.

Still to come per the doc: server-held fog for online play (the rest of
build Phase 5), false contacts (4.6 — the tuning flag exists, off by default), and
infrastructure assault (the VP table waits on it). Listening posts are not
yet themselves scannable targets; enemy bases, outposts, colonies and
beacons are chart-known per the doc's 12.8 presumption. Post-battle,
contacts are not force-updated to truth — the table revealed the enemy for
one fight, but the dossier keeps its own history (a deliberate reading; flag
for Doyle if deployment should teach). One honesty note for hotseat play:
the VIEW is the leak-proof window, but the campaign file itself holds the
umpire's truth — file-exchange play trusts the players not to read it, and
build Phase 5's server is what removes that trust.

## The campaign console and the solo opponent (shipped)

- **The console** (`src/campaign-ui/`, opened from the title screen's
  "Border Command" entry): an SVG map drawn from ONE `viewFor` result and
  nothing else — the component's props are the wall's shape, so it cannot
  render what the view does not carry. Own units whole; contacts as the
  dossier knows them (position estimates fade, drift rings grow, collapsed
  tracks grey out as "last known"); enemy infrastructure only as the charts
  show it. Orders are edited per unit (speed, sensor power, formation,
  engagement posture, cloak, waypoints by map click, intercept/shadow by
  contact id) and staged as the interventions the journal will carry — one
  set-order per touched unit, last edit winning, so the screen IS the file
  format (5.2).
- **Hotseat** hands the console across the same fully opaque blackout the
  tactical game uses for B1.9 — nothing of the other commander's view is
  mounted behind it.
- **Battles round-trip**: a pending engagement offers *Fight on the tabletop*
  (loads the deterministic battle file straight into the tactical table),
  *Read back from the table* (verifies the save's campaignRef against this
  campaign's pending engagements before grading), *Quick resolve*, and
  *Download battle file* for a table elsewhere. Results stage onto the next
  phase move exactly as the journal records them.
- **Solo** (`campaign/solo.ts`): the computer commands side B through
  `soloOrders(view: SideView)` — typed against the VIEW, so the compiler
  itself enforces that the doctrine sees only fog: it hunts contact ids, not
  enemy units, steers by reckoned positions, and patrols the border when the
  picture is empty. Its pending battles quick-resolve at captain (the
  browser's latency budget; the doc's admiral default remains the flag for a
  patient player). A 48-phase double-blind self-play test drives both sides
  through the real resolver, battles included.
- The campaign autosaves to the browser and travels as JSON (Save /
  Load campaign); the finished screen names the winner and offers the file.

## Build Phase 5 — online campaigns (shipped, first slice)

Two commanders, two browsers, one border. An online campaign is hosted from
the Border Command menu as a persistent match on the SAME Supabase backend the
tactical Online matches use — the match service stores "a jsonb setup plus an
ordered jsonb journal" and never reads either, so a campaign is simply a match
whose setup says `kind: 'campaign'` and whose journal rows are phase moves.
Nothing new to deploy: a project running `supabase/schema.sql` already serves
campaigns.

- **Seats, not hotseat**: each console binds to one seat (Commander A or B),
  claimed through the same ledger referee tactical chairs use, renewed on a
  timer. The view is locked to the seat — there is no blackout online because
  there is nothing to hand over. End phase is enabled only on your phases;
  the other commander's moves arrive over Realtime and fold into the local
  replay, each carrying a fingerprint of the state it produced so a drifted
  board resyncs from the ledger instead of playing on in silence.
- **Correspondence-friendly**: the enrollment (server, code, password, seat)
  is remembered, the console reconnects by itself, presence shows whether the
  other commander is at their desk, and the match browser lists campaigns
  (recognized by their seat names) with whose phase they wait on.
- **Battles online**: the moving commander resolves pending engagements —
  quick resolve, or download the deterministic battle file, fight it anywhere
  (including as an online tactical match), and read the save back in; the
  record rides their phase move and the hash links it to the battle file both
  clients derive identically.
- **Trust posture, stated plainly**: every client holds the full ledger and
  replays it (the resolver runs locally), rendering only its seat's view —
  the same honour system the tactical online matches run on. The doc's full
  Phase 5 ambition — truth held server-side, views served per seat by an edge
  function — remains the hardening step on top of this slice.

## The fine-tuning pass (designer feedback, 2026-08)

The name is now **StarForce: Border Command**, per the designer. Three of his
notes were concrete enough to ship; the rest are recorded below as pending.

- **The 16-phase movement schedule** (`schedule.ts`): a round is sixteen
  phases, A odd / B even, and a unit's speed in hexes-a-round decides WHICH
  of its side's eight phases it steps in — his table, reproduced row for row
  by a test. The implementation encodes the table's generating order (phases
  join at 8, 4, 2, 6, 7, 3, 5, 1 as speed climbs), which also answers his
  "some ships could move twice in a phase" note: past speed eight the order
  wraps, and the extra hexes land as doubled phases. Slow terrain still costs
  two movement credits per hex. Detection stays a sweep after every phase —
  sixteen a round now. Dead-reckoning extrapolates at a typical cruise of
  four (one hex per four table phases).
- **Speed tiers off the ship form** (`stats.ts`, his formulas verbatim):
  cruise = FTL circles + 1; max cruise = FTL circles × 2; maximum = max
  cruise + SIF; emergency = maximum + 1. "FTL circles" are the FTL DRV
  function line's green circles — the reading under which his "a Yorktown
  has 9" comes out exactly true (3 × 2 + SIF 3), and "most ships have a 4"
  cruising holds across the roster (both are pinned tests). Orders name the
  tier, the hull supplies the number; the slowest ship sets a unit's pace,
  and marked FTL DRV boxes bite the circles proportionally (a shot-out
  drive limps at cruise 1) — that scar coupling is provisional.
- **Speed costs** (provisional numbers, his design intent): max cruise +1
  endurance a round, maximum +3, emergency +5 over the baseline; a dry tank
  caps the speed at cruise. Maximum reads one detection band easier to find,
  emergency two ("makes you much easier to detect"). Emergency running rolls
  a one-in-six per hull per round for drive wear — FTL box first, sublight
  when the FTL track is full, then the frame ("ships can take damage or
  breakdown at this speed").
- **Sensor power stats in detection**: the searcher's rating now reads the
  form's own 0-power / 1-power / 2-power SENSOR values (H2.2.1's ladder) at
  the power the standing order sets, plus the scout and CMND bonuses —
  "Sensor Ratings, zero power sensor points, 1 Power and 2 power sensor
  point stats" as he listed them. The power setting's band shift remains as
  the emission side of the same dial. Cloak, CMND and SCNC already fed the
  derivation (Phase 1).

Pending from the designer, hooks left clean: the endurance formula (quarters
+ cargo + size class — `endurance` still derives from size class alone until
it lands).

## The sensor model (designer's spreadsheet briefing, 2026-08)

His sensor equations arrived as a Copilot-written briefing plus the Sensor
Model workbook, and `src/campaign/sensorModel.ts` implements the workbook
cell for cell: five separate checks — initial detection (B60), intelligence
(B96), track retention (B106), reacquisition (B107), false contacts (B108)
— never substituted for one another, every coefficient in one configurable
structure (`SENSOR_MODEL`, overridable per scenario via
`tuning.sensorModel`), and a factors log on every reading.

The equation's shape: a logistic gate σ(5·((capability − difficulty) −
offset)) — capability a weighted sum of the searcher's SENS, ACTUAL POWER,
SP1/SP2/SP0 sensor points, active status and SNCS, scaled by the
scout-or-command factor (+25%/pt or +5%/pt detection, +20%/+15%
intelligence); difficulty an additive stack of the target's cloak, terrain,
formation, ship count and a whisper of its SENS — multiplied by a stepped
range factor (steep ×0.35/hex past range 4), the searcher and target
piecewise speed curves (target active = +7 signature speed), an environment
factor for the searcher's own and intervening terrain, the power signature
MAX(0.5, 0.75 + 0.25 × power/85), the size signature MAX(0.10, 1 + 0.15 ×
(size − 4)), active ×2/×1.5 inside range 2, the 10+-speed tails
(×0.10/×0.05 past range 1), civilians ×3, and detection's additive damage
points (+5 per full 20 inside range 6). The golden anchor is the sheet's
own worked example — Yorktown II vs V-2P Raider at range 2 — pinned to the
cached cell values (detection 0.515470552703701, intelligence
0.18991849618949763, retention 0.8689918496189497), plus the rest of his
§17 validation list (32 tests). The SENS rating reads the forms' SENS
system boxes (Yorktown II = 3, exactly the sheet's baseline).

Two cells were flagged to the designer and are now resolved by his rulings:

- **B91's damage term, fixed as approved.** The sheet added 0.06 ×
  (damage + 1) to intelligence difficulty with damage on the 0–100 points
  scale — one band of damage (20 points) added 1.26 difficulty and shut
  intelligence off entirely, backwards for a game where damaged ships are
  supposed to be easier to read. The term now reads damage in the same
  20-point bands as detection's E49: 0.06 × (INT(damage/20) + 1). An
  undamaged hull still contributes exactly the sheet's 0.06, so the golden
  worked-example cells pin unchanged; each band of damage now costs a
  noticeable but survivable slice of intelligence (≈×0.74 per band through
  the sigmoid) instead of all of it.

- **Formations, redesigned to his spec: two types.** *Standard* is the
  default — every ship in the unit scans. *Close Formation* (2+ ships)
  flies tight enough to read as ONE target: the difficulty stack counts a
  single hull, the formation step (0.06 × (formation + 1), formation now
  0 = Standard / 1 = Close) adds on top — so the disguise is strictly
  better than actually being one ship — and only the lead ship (best SENS
  aboard, its stats whole, not a committee of best-of-each) works the
  scopes while searching. The true ship count resolves only through a
  25%-per-scan peek at the count rung of the intelligence ladder
  (`closeFormationCountChance`), and formation-keeping carries a
  0.25%-per-own-phase collision risk (`closeFormationCollision`) that
  marks one structure box on a random hull — surfacing through the normal
  damage bands and repair queue. 'Wide' survives only in old files and
  reads as Standard.

The campaign sweep (`detection.ts`) now runs the model with explicit track
states per contact — detected / tracked / track-lost / reacquired — a lost
track keeping its last-known picture, ghosts spawning as contacts whose
target id matches no unit (they fade like any cold trail, and only the
umpire knows). Two structural rules survive from the doc on top of the
model: a same-hex scan always finds an uncloaked hull (4.3 — engagement and
ambush logic stand on it), and no retention or reacquisition roll happens
past a tracking horizon (default 8 hexes, configurable) so the 5% floor
cannot hold a track on a target half a map away. Active Sensors is a
standing order (checkbox in the console) separate from the power setting.

**Specific speed orders (shipped, his note):** a standing order may carry
an exact speed in hexes a round (`exactSpeed`) beside the named tier. The
tier is the authorization and the number a throttle within it: the ceiling
is the CHOSEN tier's own speed (`orderSpeedCap`), never past the hull's
envelope, and a civilian unit caps at 1–3 by its merchant hull. Under a
Hold order the number stands on its own (full envelope) — the console
keeps the pair in sync anyway, the tier following a typed number up and
the number reined in when the tier drops. The pace made still reads as whichever tier the
number lands in, so endurance burn, emergency drive wear and the detection
speed signature follow the real speed, not the label: cruise-4 hull
ordered maximum-tier but throttled to 3 burns and glows like a cruiser at
3. The resolver refuses an over-tier number for every actor identically;
the console's numeric field is bounded to the live tier's cap. The solo
doctrine keeps ordering by tier.

**Fleet status readout (console):** the selected unit's panel now shows
the fleet's makeup and state in full — these are your own ships, so the
wall hides nothing: unit kind, hull count, point value, endurance, the
pace the staged order will actually make with the hull's four speeds, and
a per-ship roster of class, damage band chip (fresh/damaged/crippled),
structure remaining, marked-system chips (FTL, sublight, sensors,
weapons, shield generator, reactors, batteries, systems, armor), and the
wing's readiness where a hull carries one.

**Ships follow their paths again (playtest fix):** an Intercept or Shadow
whose contact collapsed used to hold the unit "until told otherwise" —
which, under the sensor model's faster-fading contacts, read as ships
abandoning their plotted routes forever. A mission whose trail goes cold
now CLEARS, and the unit resumes its waypoints. The same pass unstranded
orders saved by the first exact-speed build with the tier still at Hold.

From his orders list, still to build: task forces, Shadow as a first-class
order (intercept exists; shadow-at-2-hexes is a mission type away), Attack
Nearest / Attack Specified with speed caps, Raid / Assault system orders,
Avoid Contact, and AI civilian shipping between planets and bases. Quick
Resolve already covers his "auto-resolve battles" item; ship entry via the
builder covers "add ships" (campaign scenarios take any form id, custom
forms embed in the file).

**The designer's roadmap (Aug 2026, verbatim intent, to build once
movement and detection feel right):**

- Colonies, victory-point objectives, and automated merchant shipping
  moving between colonies.
- **Pirates as the anti-doom-stack incentive**: leave a star system
  unpatrolled and pirate attacks cost you victory points — the reason not
  to mass every hull into one giant fleet. (Expansion 7's freighters and
  the pirates it names are the raw material.)
- **Winning by objectives**, his list: destroy X amount of shipping; land
  troops on X colony; raid X colony (damage to the planet or its bases);
  destroy X border stations; destroy or damage shipyards or
  battlestations; establish a mobile supply base in enemy territory; scout
  X star system. "Figuring out the balance will take a bit."
- He is drawing up bases, defense satellites, border stations and more
  Vallari transports (some already in the Expansion 7 draft: BASTION,
  VIGILANT; the contents pages also name a Union Habitat, Chaffee Research
  Frigate, Galileo Tug and Defense Satellite whose record sheets are not
  in this draft yet).

**Quick Resolve fights for real (playtest fix):** "my ship auto-resolved
against two others and came out completely fresh." Two causes, both fixed.
The console had been quick-resolving at the captain difficulty on a
12-round clock — a fast lane left in from testing — while the button said
"the admiral is fighting it"; it now IS the admiral, on the standard clock
(the design doc's own setting, a few seconds per battle). And the clock is
a cap, not a promise of contact: the fleets deploy a board apart, so a
short clock could land while they were still closing, and the engagement
read back as if nothing had happened — every hull fresh. `playEngagement`
(quickResolve.ts) now extends the clock, doubling up to fourfold, whenever
it lands on a battle where literally nothing happened; the replay is
deterministic, so both consoles still derive the same result. A battle
where something DID happen may still end on the clock — co-located
survivors re-engage next phase, so a mid-fight call continues rather than
vanishes. One honest outcome remains that can look bloodless: the admiral
refuses hopeless odds (past triple strength) and flies for the door — that
ship reads back DISENGAGED and is pushed a hex toward home, not fresh out
of nowhere.

**Expansion 7 — Civilians, Support and Pirates (draft v21, imported):** all
nine record sheets, through the same extractor and generator as the Master
Ship Book — RUNNER, MAERSK I, HORIZON and WARFARER freighters, the GALILEO
II, V-6H SALVAGE and V-5H CORSAIR military transports, and the BASTION
battlestation and VIGILANT outpost (the roster is 112). The draft has no
Master Ship List, so each form's printed corner is its row; the two printed
prices (MAERSK "(PV6)", BASTION "Point Value 100") are used as printed and
the rest come from the design-tool point model (`tools/price_exp7.ts` —
which lands within half a point of both printed values, a nice check).
Draft defects recorded as errata on the forms: the V-6H's stale A/MAT and
T-37 arming lines (its notes say it got no heavy weapons), two STBD-shield
banner bleeds, the VIGILANT's power total, and two wrench-vs-strip Damage
Control disagreements read from the strip. New ground the engine now
accepts, printed by these sheets: Damage Control 0 (civilian freighters),
speed-0 FTL-less hulls (stations — in the campaign they hold their hex:
`shipSpeedTiers` gives a drive-less HULL no tiers, distinct from a shot-out
drive's limp), size class 8, and cut-down civilian reactor mains.

**Edit the forces before launch (the designer's testing ask):** every
launch scenario now carries an "Edit forces" button — add or remove units
on either side, re-hull them from the whole roster (Expansion 7 and custom
designs included), rename them, move their start hexes, set their kind
(ship, group, convoy). The edited scenario launches like any other and the
campaign file records it whole.

**Open table (the designer's testing ask):** a menu toggle that drops the
hotseat blackout and puts a Cmdr A / Cmdr B view switcher in the topbar —
both perspectives from one chair, for watching when each side's ships are
detected. Orders can only be staged while viewing the side whose phase it
is (the other window is sensors-only, and says so); with Solo on you can
watch the computer's own picture of you between its turns. The blackout
remains the default for real hotseat play.

**The cloak hunt, after the first real one (playtest feedback, tactical
side):** four fixes from the designer's first game against a cloaked
Tonitrus. The one that mattered: nothing enforced H6.9.2's ONE search per
phase — a missed roll could simply be pressed again until it hit. The
engine now records the attempt itself (`searchedThisSegment`, cleared with
the phase like the one-level-per-segment marker), refuses the second roll,
the AI stops proposing spent searches, and the button says "Searched this
phase". The dice are now visible where the button is — the search result
(faces rolled, level reached or "no contact") comes back into the panel as
well as the log. Cloak status went onto the counter: a running cloak
prints **CLK** above the hull, and **CLK-C / CLK-T / CLK-L** once any
searcher holds Contact, Track or a Target Lock (H6.2) — the designer's own
suggested vocabulary. And a battle launched from Border Command now
carries a **Border Command** button in its topbar plus a "Return to Border
Command" button on the battle-over summary; landing back at the console
(no blackout interstitial for solo or open-table play) with the
Battles-waiting panel's read-back button in view.

**A dead ship's contacts die with it (playtest ruling):** contacts were a
side-wide pool, so a scout's hard-won picture outlived the scout by rounds.
Every contact now records its `spotters` — the units (and stations) whose
scans built the picture; ghosts belong to the searcher that hallucinated
them. When the last spotter is gone — killed in a battle, or the station
destroyed — `pruneOrphanTracks` removes the contact the same phase, not
three quiet rounds later. A picture shared across the force survives any
one loss: only the death of EVERY contributing spotter takes it dark.

- **Zoom and pan.** Players couldn't tell whose ships were whose when
  several fleets shared a hex. The plot now zooms — mouse wheel about the
  cursor, or the ⊕/⊖/⌂ controls in the corner — up to 8×, and a drag pans
  the zoomed window (a drag never lands as a click, so panning never plots
  a waypoint). The zoom is pure viewBox: no transform is ever wrapped
  around the plot layers, so the click model's getScreenCTM inversion keeps
  resolving hexes at every scale, and same-hex counters separate because
  their fan pitch magnifies with everything else.
- **Straight legs only.** A waypoint click snaps to the nearest of the six
  straight hex lines out of the leg's start (`snapToHexLine`, hexmap.ts) —
  courses read as courses, and a zigzag is several waypoints, exactly as
  the designer asked. On a straight leg the resolver's greedy step IS the
  line, so the plot shows the hexes the ship will actually cross.
- **A phase countdown on every route hex.** Each hex the route enters
  prints how many END PHASES from now the ship stands in it — a 1 means
  the very next End Phase does it. `routeEntryPhases`
  (campaign-ui/helpers.ts) simulates the real 16-phase schedule forward
  (schedule.ts credits, nebula and dust owing their second credit) over
  the resolver's own greedy line, so the numbers on the plot are the
  numbers the campaign will produce — a property test pins the prediction
  against resolvePhase itself, terrain included. Computed from the STAGED
  order, so changing the speed tier or the exact-speed throttle moves
  every number live (cruise-4 reads 3, 7, 11, 15…; exact speed 1 reads
  15, 31, 47…). The course caption still closes with the round total
  (`COURSE 8 HEX · 2R`, via `waypointRounds` — same walk, rounds
  granularity).

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
