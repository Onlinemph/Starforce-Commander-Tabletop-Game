# StarForce Commander — Digital Tabletop

A browser implementation of **StarForce Commander** (Mariner Games, rulebook v2.6, 2026), a game
of tactical starship combat by Patrick Doyle.

Hot-seat on one screen or **remote play between two browsers** — with no server and no accounts
either way. Battles autosave on every action, rewind exactly with undo, and travel as small files. All game data is canon: **93 ships** across three factions
from the Master Ship Book and the Expansion 5 Aurelian Starship Book, the **56-card damage deck**
and the **attack dice** from the print-and-play components. The Basic Set Standard rules are
complete, plus **every expansion released** — Formation Maneuvering (C5), Scouting Sensors (H3),
Command Systems (H5), nebulae and gas clouds (K4, K5), cloaking (H6), homing weapons (E5), and,
behind toggles, the optional Coordinated Fire (H4) and jamming-versus-homing (E5.10) rules. The rules engine is a standalone TypeScript library with no UI dependencies, so it can
later be driven by a networked client or an AI opponent without change.

## Quick start

Node 20 or newer (the repo pins 22 in `.nvmrc`).

```bash
npm install
npm run dev          # play at http://localhost:5173
```

That is the whole setup. There is no server to start, no database, no API keys and no accounts —
the game is a single static page and the rules engine runs in the browser.

```bash
npm test             # 688 rules and data-integrity tests
npm run typecheck
npm run check        # both of the above
npm run season       # the AI's standing baselines, measured (tools/README.md)
npm run build        # static site in dist/
npm run serve        # preview the built site on your network at :4173
```

To play on a tablet or a second screen, run `npm run dev -- --host` and open the printed LAN
address.

## Playing

A battle is **(setup + action journal)**: the engine is deterministic and the dice are seeded, so
replaying the journal reconstructs the game exactly, rolls included. Everything below falls out of
that one fact.

- **Autosave.** Every action is saved as it happens. Refresh, close the tab, come back tomorrow —
  the battle resumes mid-volley.
- **Undo** takes back the last action by exact replay. Dice included: a rewound volley re-rolls to
  the same faces.
- **Battle files.** *Save file* downloads the battle as JSON; *Load file* resumes it — on this
  machine or any other. Custom ship designs are embedded in the file, so it replays on a browser
  that has never seen them.
- **Hidden information (B1.9).** The *Viewing* selector under the map switches between the open
  table and a per-side view. A side view replaces enemy ship forms with an intel dossier, strips
  enemy shield strengths and marine counts from the map, shows your own cloaked ships as ghosts
  the enemy cannot see, and offers *pass the console* — a full blackout while the device changes
  hands.
- **Remote play.** *Remote play* in the top bar links two browsers directly over WebRTC — no
  server, no account. The host creates an invite code, the guest answers with a reply code, and
  the codes travel over any channel you already share. Once linked, every action syncs live in
  both directions; the host's journal is the authority, so crossed actions heal automatically.
  Works across home networks in most cases (a very strict NAT may refuse the direct path).
- **A shared ship library.** *Ship library* in the top bar browses designs other players have
  built, and takes a copy of any of them into your roster with one click. The ship builder
  publishes to the same library. Entries are **immutable and content-addressed**, which is forced
  by how a battle is stored: a save carries its custom ship forms inside it so it replays anywhere,
  so an entry that could be edited would quietly rewrite every battle that named it. Publishing a
  changed design therefore makes a new entry and leaves the old battles meaning what they meant.
  Taking a copy is literal — the whole design lands in your roster and keeps working if the library
  goes away. Designs are checked before they go: the builder's own validator has to agree the
  engine could field the ship, and the designers' point model prices it so the browser can sort by
  cost. Cost never refuses a design — an expensive ship is a legal ship, and the fleet picker is
  what enforces a budget. It runs on a Supabase project (`supabase/ship-library.sql`), is entirely
  optional, and is independent of online matches.

- **Online matches.** *Online* in the top bar hosts the battle on screen as a **persistent
  match**: it lives on a match service, gated by a password, shared by a short code — and it
  stays up when everyone leaves. Refresh, switch devices, come back tomorrow: enrollment is
  remembered and the battle replays to exactly where it stood, which is the end of refresh
  death. The service holds no rules, just the ordered action journal — it hands out the sequence
  numbers, so two players acting in the same instant get a definite order and both boards
  converge on it; custom scenarios and custom ships travel inside the match like they do in
  battle files. Sides show live presence, and the host's device drives any AI sides.

  Two backends, same behaviour, pick either: **Supabase** — paste one SQL file into the
  dashboard and copy two values, no CLI and nothing to deploy (`supabase/README.md`); or a
  **Cloudflare Worker** — one `wrangler deploy`, or the included GitHub Action if you would
  rather not install anything (`server/README.md`). Nobody has to type an address: set the
  repository variables (`SUPABASE_URL` + `SUPABASE_ANON_KEY`, or `MATCH_SERVER`) and the Pages
  build pre-fills them for every visitor. The host's **invite link** carries the service, code
  and password — plus the anon key on Supabase, which is public by design — in the URL
  fragment, which browsers never send to any server: a joiner taps it, picks a side, and is in.
  The Supabase client is fetched only when a match is actually opened, so solo play carries none
  of its weight.

  **A segment closes by agreement.** On a shared table nobody reveals until both pencils are
  down — B1.9.1 has orders written in secret and revealed together, and the table enforces that
  by itself. Two browsers do not: before this, either player could close the Command Segment
  while the other was still writing, and the half-written card was what moved. In a match the
  *Complete* button is replaced by a ready check that shows where each side stands, and the
  segment closes when the last one says it is finished. Nobody presses next for anybody else,
  and you can take your ready back while the others are still working. It is the engine's rule
  rather than a message between clients: `signal-ready` is journalled like any other action, so
  both ends work out the same closing from the same record, and a client still showing the old
  button is refused rather than obeyed. Ready checks need a battle that has not started yet —
  a journal with bare segment advances in it could no longer replay under the gate — so the
  Online panel says which kind of match you are about to host.

  **Three things a match cannot afford to be casual about.** *Undo* is a rewind button in solo
  play and a way to fish for a better die roll in a match, so once you command a side it is
  narrowed to your own orders, still secret: you may rewrite your command card or your power
  allocation freely, because nobody has seen either. Anything that rolled a die, announced a
  system, or moved the sequence of play along is refused, and the button says why. The engine
  enforces it as well as the button, so a stale click or a second console cannot slip past.

  *Desync* used to be undetectable. Both clients replay the same journal through the same
  deterministic engine, and the sequence check catches a client whose journal has fallen behind
  — but not two clients that agree about every action ever taken and disagree about the result,
  which is what a build skew between them produces. Each action now carries a fingerprint of the
  state it produced, including the shuffle of the undrawn deck, so a divergence is caught on the
  next action rather than the next hit. Neither side can tell which of them is wrong, so the
  ledger settles it and both players are told, because a silent correction that moves your ships
  is worse than no correction at all.

  *An empty chair* used to deadlock the gate. A side whose player closed the tab never says it
  is ready, so the rule protecting the match also froze it, and the remaining player's only way
  out was to abandon the game. A side with nobody connected is now readied on its behalf —
  journalled like any other action, so both clients and any later replay agree it happened, and
  a player who comes back can take their ready back and carry on. Only the host's client does
  it, so two consoles cannot both volunteer the same absent side.

  A match is also a sealed table. Its scenario, fleets, terrain and options are frozen at
  creation, and while you are enrolled every control that would rebuild the battle — scenario
  picker, fleet picker, ship builder, scenario designer, rematch, coordinated fire, loading a
  file, the direct browser link — stands down, because a battle rebuilt here would leave every
  other commander replaying a board that no longer exists. Your view is pinned to the side you
  command: enemy ship forms are sealed and only their public face shows, which is the rulebook's
  own hidden-information model (B1.9). Every client still replays the whole battle locally, as
  it must for the rules to run without a server, so this is the tabletop's honour system made
  the path of least effort rather than a cryptographic guarantee. On Supabase there is also a
  **match browser**: hosts can list a match publicly, and anyone on the project sees its name,
  sides and progress — never its battle, and joining still costs the password.
- **Sound, synthesised and off by default.** No audio files — every voice is built from
  oscillators and filtered noise, a few hundred bytes of code instead of a megabyte of samples.
  Phasers are a bright bolt falling fast, disruptors dirtier and lower, torpedoes a thump with
  the seeker running away; shields shimmer as they absorb, hulls take a low hit with debris in
  it. It starts muted, because a page that makes noise on load is a bad guest, and the toggle
  and volume sit under the map. The anti-annoyance work is mostly measurement: every envelope
  ramps so nothing clicks, a master low-pass takes the glare off, simultaneous voices are
  counted and attenuated so an eight-mount broadside lands *quieter* than one hull hit rather
  than as a machine gun, and a limiter on the master bus catches pileups — rendered offline,
  thirty-two voices in the same instant peak at 0.71 without a clipped sample.
- **Damage you can read across the board.** Every counter wears its four shields as arcs: a faint
  track for what the facing would hold intact, a bright segment for what is still standing, so a
  stripped flank is obvious from the far side of the map without clicking anything. Green through
  amber to red as it goes, dashed when a shield is down or gone. The hull carries its damage level
  too — the marker that sits on a counter at the table (B1.9) — as a deepening wash, and a
  crippled ship gets a slow alarm pulse. What it shows respects who is looking: your own hulls
  read off their form, while an enemy shows the table's own record, printed strength minus the
  absorption everyone watched land. Secret repairs make an enemy look weaker than it is, which is
  exactly the uncertainty a player at the table has.
- **Weapons armed at start.** A house rule in *Choose forces*, off by default. The printed game
  opens cold — batteries fill their arming circles out of each round's power, and a slow-arming
  heavy needs several rounds to charge (E4.2.8) — so the first exchanges are fought with
  half-loaded guns. Tick the box and every mount deploys with its circles full, power unspent,
  and the shooting starts on turn one. It rides in the save like any other setup value, so a
  replay opens exactly as the battle did.
- **Replay to video.** The theater's *Export video* button plays the battle through and films it
  to a file — WebM, or MP4 where the browser offers it. Either way the map is held on the whole
  board while it records, so looking around does not end up in the file.

  Where the browser can film its own tab, it does: `getDisplayMedia({preferCurrentTab})` plus
  Chrome's Region Capture, which crops the track to the map element itself. The pixels are the
  ones on screen, at the frame rate the compositor is already running, and nothing is redrawn —
  measured, a 1400×900 page yields a 774×710 track holding the board and nothing else, with
  **zero frames drawn by hand**. It costs one permission prompt; decline it and the fallback
  below takes over.

  That fallback is for browsers without Region Capture (today: Firefox and Safari). The map is
  live SVG styled by the page's stylesheet, which a browser will not rasterise on its own, so
  each frame is made self-contained first: the terrain art embedded as data URLs, then drawn to
  a canvas a MediaRecorder is watching. Three things separate that from a slideshow, and all
  three were measured in a real browser rather than assumed:
  - **Frames are sampled continuously, not once per action.** Ships glide for most of a second
    and the guns fire over the top of that; one snapshot per step threw all of it away.
  - **Animated values are measured, not read off the DOM.** A CSS transition animates what is
    *rendered* while the element's own style still holds the value it is travelling towards — so
    the old recorder serialised `translate(540px)` while the browser was drawing 658px. Every
    frame now copies the computed paint, transform and stroke of every node it keeps.
  - **No stylesheet rides along.** Once every value is stated outright, 59KB of CSS re-parsed
    per frame is pure cost — and the scenery (starfield, nebulae, grid: several hundred nodes
    that never change) is photographed once and reused. Together: **765 frames over a
    29-second recording where the original managed 90.**

  Narrated moments are held; bookkeeping steps are hurried past, so the length is spent where
  there is something to watch. Recording runs in real time, the button shows progress, and
  stopping early still saves what was captured.
- **A real table feel.** Ships glide along their moves when the Navigation Segment reveals the
  plots; a ghost previews your own plot while you write it; wheel to zoom, drag to pan; a ruler
  measures in the rules' own inches; ship counters carry faction hull art. The site installs to a
  home screen and, after one visit, plays entirely offline.
- **Weapon fire you can see.** Volleys play on the map as they resolve: phasers as drawn beams,
  gravitic disruptors as pulses marching down the line, torpedoes as projectiles in flight — then
  a blue ripple when the shields take the volley, or a flash-and-sparks burst when damage gets
  through to the hull. The effects are derived from the same action journal as everything else,
  so the AI's fire, a remote opponent's fire, and every volley in the replay theater all animate
  identically. Honors `prefers-reduced-motion`.
- **Battle reports.** One click writes the battle up as markdown — forces, score, and the full
  log grouped by round.
- **Replay theater.** *Replay* in the top bar plays any battle back like a tape — the current one,
  or any battle file. Step by action, jump by round, scrub the timeline, or press play and watch:
  quiet bookkeeping hurries past, narrated moments hold. The narration is the engine's own log,
  surfaced as each action lands, and every frame is recomputed from the journal, so what you watch
  is exactly what the table saw — dice included.
- **A computer opponent.** Tick *AI* on a side in *Choose forces* and the computer commands that
  force: it allocates power, arms its batteries, plots blind alongside you, fires in Tactical Scan
  order, repairs, presses boarding actions and withdraws its cripples — all through the same action
  journal as a human, so saves, undo, replay and remote play treat its orders like anyone else's.
  It reads only what an opponent across the table could see: your position, heading, speed and
  damage marker — plus your *class* the way a veteran reads the ship book, since the name is on
  the counter and the charts are public print. It never reads your hidden state: power, arming,
  or which mounts are wrecked. Launching a test flight from the ship builder now gets you an AI
  adversary automatically.
- **Captains that come about.** The movement planner pays for every degree of bow-on progress, so
  a ship that overshoots turns and fights its way back instead of sailing off the map; it prices
  maneuver stress by whether the SIF will actually cancel it, leads its target knowing the target
  is turning too, and — above ensign rank — steers for the position its own firing charts say the
  batteries are worth most from. Trained ranks also run a real threat assessment: each visible
  enemy's **expected volley damage** is estimated from its printed firing charts at the current
  range — book knowledge — through the declared targeting and jamming, and scaled down by its
  public damage marker. The threat axis weighs enemies by that estimate times how bow-on they
  sit, and every candidate plot is charged for the expected fire arriving at its end position,
  which is what makes range control emerge: kite the heavy batteries, crowd the light ones.
- **Volley craft.** Trained ranks build the volley, not just pull the triggers: on an arc
  boundary the attacker nominates the shield struck (E6.2 Step 4) and the captain names the
  printed-weaker side; slow-arming heavies (diamond-gated mounts) are held out of red-bracket
  volleys where the defender rerolls away rounds of charging; a squadron converges its fire on
  one kill — highest threat over least structure, computed identically by every ship so the
  fleet coordinates without a channel; scarce arming points are concentrated to *ready* mounts
  instead of spread into half-charged silence; and the admiral takes the scalpel to broken ships
  at knife range, precision-firing the weapons section (E9) with its all-PREC batteries.
- **Deep maneuver planning.** The game keeps the table's public record of shield punishment —
  every volley declares its struck side and narrates its absorption in the open, and
  `shieldHitsSeen` is that tally (secret repairs stay invisible, exactly a human's uncertainty).
  Trained ranks read it everywhere: a firing position is worth up to double when it attacks into
  a battered facing, so ships work their way around onto the flank they have been hammering —
  across phases, through the admiral's lookahead, because a turn pivots only after the full move
  and flanking is inherently a multi-phase plan; boundary nominations weigh the record over the
  book, so a hammered strong side outranks a fresh weak one; and the helm steers at the
  squadron's focus kill rather than whatever is closest, so a fleet herds its chosen prey
  instead of drifting into private duels. On a quiet
  phase (crippled, discharged, out of position, or holding an all-red volley anyway) the sensors
  go dark and jam at maximum, which pushes enemy effective range out and can deny long-range
  fire entirely (H2.3.7). The same threat axis drives the shields: the threatened side gets the
  repair priority and a reinforcement point before the volley arrives (G1.3.2, G1.3.3), and when
  a shield is stripped the helm angles a healthy side into the incoming fire — guns first when
  there is a shot to take, hull first when there is not. The measured effect is dramatic: the
  admiral's season against the never-jamming ensign went from 36W–28L to 59W–5L.
- **The AI plays the game, not just the phase.** Trained ranks read the public scoreboard
  (S2.8.4) into a posture: ahead and hurt, they protect the lead — kite harder, and a heavy hull
  takes its points home rather than risk them on one more volley; behind, they press — closing
  through fire and firing even the all-red long shot, because any dice beat none. Terrain is a
  tool, not just a hazard: a covering asteroid field entered at safe speed is worth its printed
  rerolls (K2.1.8) and a world between you and every gun beats any shield, both sought in
  proportion to how much the ship currently wants to not be hit. A notebook accumulates what the
  enemy has shown — the highest scan each side has bid feeds the admiral's outbidding, and an
  enemy whose volleys keep landing far under its book strength is marked power-starved and
  discounted as a threat. On a closing round, when nothing can reach, the allocation funds the
  long game: slow-arming heavies start their multi-round charge ahead of the fast batteries, and
  the admiral floors the drive to buy the merge a round early — measured as admiral-only
  doctrine, because when every rank races the closings get so fast that dice swamp doctrine.
  And homing torpedoes go out in waves: a lone ready tube holds its shot while a wingmate is
  still arming, so the salvo arrives together and splits the point defense — unless the target
  is already broken or the scoreboard says waiting is losing. Season-measured against the
  standing baselines: duel admiral over captain 38W–25L, admiral over ensign 55W–9L, squadron
  27W–5L — every prior mark met or beaten.
- **The fleet fights the torpedo era.** Under the optional Coordinated Fire rules (H4) the AI
  now plays the ten-step machine instead of passing: one attack per faction per target per phase
  is the rule's whole geometry (H4.3.1), so trained ranks hold their scan-2+ hulls off the
  individual steps and bring them in together on the coordinated step their best scan calls,
  volleying as a declared group at the squadron's focus kill while the rest pick off secondary
  hulls — and an AI that owns every hull on the table drives the step clock itself, while in a
  mixed game that button stays yours. Point defense intercepts torpedoes in flight with a
  fleet-shared tally — every ship computes the same assignment, most urgent counter first, each
  covered once before any is covered twice — but only with idle guns aimed at counters that
  will actually land: every PD weapon in the book is a main gun with a point-defense mode, and
  the season showed that eagerly trading main-battery volleys for warhead wear turns a winning
  margin into a losing one. Homing strikes now feed the same public shield record as direct
  fire, so the deep-planning layer hunts the facing the plasma torpedoes have been grinding.
  The repair queue answers to the posture — protecting a lead fixes the drive and the umbrella
  before the guns. And a setup-chosen **temperament** reads the same scoreboard differently:
  *Steady* plays it straight, *Aggressive* presses unless clearly ahead, *Cautious* protects
  early and presses only from deep in the hole. All season baselines held exactly: duel
  admiral-over-captain 38W–25L, admiral-over-ensign 55W–9L, squadron 27W–5L.
- **Anti-swarm doctrine: the admiral kites what it cannot outnumber.** Tournament self-play
  showed numbers beating tonnage everywhere — so when the admiral is outnumbered two to one
  *and* out-reaches every enemy chart by a real margin, the fight moves to the band the swarm
  cannot answer from: hold one inch past their farthest bracket (stretched by their declared
  targeting, shrunk by our jamming — H2.3.3), price slipping inside the band at triple
  overshooting it, split sensors jam-first because the jamming *is* the moat, and from an
  untouchable position invert fire discipline entirely — red dice the defender rerolls are free
  damage when nothing answers, so even the slow-armed heavies discharge. A heavy hull facing
  those odds cuts its losses and disengages (a departed ship concedes its damage level; a dead
  one concedes everything, S2.8.4) — which surfaced a long-standing gap, now fixed for every
  rank: ships that intend to leave actually power the FTL drive during Resource Allocation
  (J9.1.3); before, cripples resolved to go home and then died at their posts with dark drives.
  Measured: Yorktown-III vs two Coventrys flipped from 3W–21L to **20W–4L**. Measured honestly
  the other way too: against five or six hulls the 36-inch board is too small to hold the band —
  envelopment beats reach — so the doctrine claims the pair fight, not the wall of frigates.
  All season baselines held exactly.
- **The admiral declines the donation.** The campaign-ledger experiment (enemy hulls
  permanently destroyed vs own hull permanently lost) ruled out every heroic option at
  three-to-one odds: diving kills a third of a frigate before dying, kiting is enveloped, and a
  flight begun at half health ends under the guns 22 sorties in 24. A ship that has resolved to
  leave now actually *flies* like one — distance from every gun, fight-shaped scoring dropped,
  and the board edge treated as the door it legally is (J9.2.2) rather than a wall — and above
  all, the admiral refuses a three-to-one battle outright while refusing is free, since the
  scoreboard prices the refusal at half value and the stand at nearly all of it (S2.8.4).
  Measured: hull losses at hopeless odds went from 24-of-24 to **0-of-24, 24 escapes**, campaign
  ledger from −68 to **0.0 per sortie** — while the winnable two-to-one fight is still fought
  and won at an identical 20W–4L, and every season baseline held.
- **Evasive maneuvers (C3.6), and what measuring them taught us.** The rule is on the command
  card: acceleration spent weaving instead of on speed, taken at reveal, buying rerolls against
  *every* incoming volley and handing the same number to anything the weaving ship shoots at.
  On paper that reads as a gift to the outnumbered — the benefit scales with the number of guns
  pointed at you, the cost does not — and it is wrong. A lone heavy cruiser weaving hard against
  six frigates goes 8W–16L; the same cruiser not weaving at all goes 11W–13L, over the same
  twenty-four mirrored games. The side that actually banks the rule is the *swarm*, which turns
  it into a six-win swing: each frigate pays the penalty on one small volley and collects
  rerolls off a capital's broadsides. There is a second, quieter cost — evasive acceleration
  counts against the round (C3.6.2), so weaving in the first combat phase disarms the helm for
  the two that follow, worth five wins in sixty-four squadron games. What survives is narrow and
  free: trained ranks weave only in the last combat phase, only when the plot leaves them no
  shot at anybody, never with acceleration the maneuver or the safe-stress line wants, and never
  while the plan is distance — a kite band and an FTL run are bought with the same points. Human
  players get the full rule and an EVASIVE control on the card. Every baseline held: duel
  admiral-over-captain 39W–24L, admiral-over-ensign 55W–9L, squadron 51W–13L of 64, and the
  outnumbered capital unchanged at 11W–13L.
- **The measuring instrument is in the box.** Every balance claim here was made with mirrored
  self-play, and `npm run season` is the harness that made them — committed, so they can be
  checked rather than believed. It plays every seed from both hulls (otherwise a scenario that
  favours the eastern deployment is indistinguishable from a doctrine that wins), reads the result
  from health rather than victory points (a fleet that wins on points while losing every hull has
  not won anything), and reproduces the three standing baselines in about twenty seconds:
  admiral-over-captain 39W–24L, admiral-over-ensign 55W–9L, squadron 51W–13L. `--games 256` when a
  result is close, `--scenario` to point it at any matchup. It is deliberately outside `npm test`,
  because a suite nobody runs is worse than one that measures nothing.
- **The optional maneuvers, now orderable.** Three rules the engine could already perform and no
  captain could actually order, because nothing on the command card said them. **Emergency stop**
  (C3.8) shuts the drive field down: the ship is stationary this phase *and* the next, even across
  a round boundary, and pays stress equal to the speed it was making rather than acceleration —
  none of it counts against the round's limits, which is what makes it a genuine escape from a
  bad plot. **Precise turns** (C3.9) let any turn be taken at any template the ship could manage
  or less — a shallower turn holds a firing arc that a hard one throws away — and slides may be
  half an inch instead of the full one. The engine already took a turn template as a parameter and
  a `halfSlide` flag; all they needed was somewhere to say so.

  Two more from that list turned out to be reachable already, and the note claiming otherwise was
  simply stale: **repelling boarders** (B3.4) has been a damage-control category all along, and
  **reverse movement** (C3.7) is what plotting a negative speed does. **Arming the crew** (J6.3)
  was the one genuinely missing, and it is an act of desperation the rulebook prices honestly:
  two improvised squads per size class, and for twenty rounds after the fighting stops the ship
  may not repair, loses two points of power, and fires last however good its Tactical Scan is.
- **All six printed missions (S3).** The rulebook prints six scenarios and each exists to turn on
  a rule the plain duel never reaches, so they are worth having as written rather than as flavour
  text. **The Duel** and **Orbital Ambush** were already here; the other four brought the
  mechanics they need with them. **First Strike** opens with the cruiser at green alert — every
  weapon cold, every shield down, because raising them would have been the provocation — and holds
  it to speed 1 for the opening round while a ship half its size empties its racks into it.
  **Mutual Surprise** rolls its own asteroid field and places both ships in secret: a seeded
  scatter, unknown to both players, the same for both of them, reproducible from the battle file —
  so a game can open bow to bow or with one cruiser already astern of the other. **Target the
  Flagship** gives each side three hulls and names one, doubles every victory point scored against
  the enemy's, and hands each flagship two free Tactical Scan points to distribute — the staff
  aboard rather than the hardware, so they cost no power and need no GEN SYS. **Recon Mission** is
  the one that is not a fight at all: the raider has to scan the survey world for information
  worth twenty points plus ten for every SCNC box it brought, and then *leave with it* — damage is
  beside the point, and three destroyers arrive across its way home on Round 8. The computer plays
  it as a mission rather than a battle: its helm answers to the planet instead of the picket, it
  scans every phase it can, and the moment the survey is complete it turns for home.
- **Batteries as a reserve, not a rounding error (B2.5, optional).** Ticked in Choose Forces, and
  it changes what a battery is *for*. Normally stored power is spent before anyone has moved — it
  simply covers whatever the round's allocation overspends. Under the optional rule it can be held
  back and spent during a combat phase's Command Segment instead: a burst of acceleration nobody
  planned for, SIF to swallow the stress it causes, a shield repaired on the spot (immediately, per
  B2.5.8), a fired weapon rearmed and fired again, sensors deepened in the same segment they are
  plotted, general systems pushed to MAX. The restrictions come with it — a circle is never filled
  twice, so a shield already reinforced this round is closed; slow-arming heavies (the NoBAT trait)
  cannot be charged off a battery mid-round; and a battery cannot recharge a battery, that being
  reactor work at Step A. The control lives on the command card, showing only the lines the rule
  could ever reach and greying out the rest with the reason.

  **The computer plays it too**, and the doctrine is the same one a good captain plays: keep the
  reserve until it buys something the round cannot buy any other way. That starts at Resource
  Allocation, where the printed allocation would spend into the batteries without noticing — a
  captain who means to keep one plans the round on reactor power alone. Then, in a combat phase's
  Command Segment, it spends on the first of these that applies: a mount one circle short of ready
  with an enemy inside its reach — the largest swing a single power point buys anywhere in the
  game, since a half-charged mount fires exactly as often as a broken one, and the points bought
  are spent in the same breath so the volley is ready *this* phase; then the shield the fire is
  coming from, if it has lost at least a generator's worth of boxes, repaired on the spot; then the
  drive, but only for a hull whose plan is distance and whose acceleration is already gone.

  Measured one side against the other, mirrored over the same seeds: duel at admiral **39W–23L**,
  squadron at admiral **29W–18L**, duel at captain level at 32W–31L. Ablated as well, because the
  doctrine has two halves and only one of them turned out to matter — holding the battery back and
  never spending it is **32W–32L**, exactly level, so the win is the spending and not the hoarding.
  Every baseline with the option off is untouched, the doctrine being inert there by construction.

  One honest note: the recharge line never actually gets a point on the hulls in the season, their
  reactors being fully committed to the guns and the eyes, so in practice the reserve is a one-shot
  per battle. Moving the recharge ahead of the spare change measures identically — there is no
  spare point either way.
- **Deep space: a map-size option.** Choose Forces now offers the printed 36" map or a 72"
  deep-space board — bounds, terrain and deployment anchors scale together, so the fleets open
  proportionally further apart. Measured consequence: room to turn, repair and reload is worth
  more to a lone capital than any doctrine we shipped. The admiral Yorktown-V that went 0W–24L
  against six frigates on the printed map (dead in all 24) goes 9W–15L in deep space, dies less
  than half the time, and kills four times as many hulls — envelopment only beats reach when
  the walls are close. Setup-carried, so saves and replays reproduce the board exactly.
- **Simultaneous fire on tied Tactical Scans (H2.4.2).** Ships with equal scans fire
  simultaneously and their damage takes effect simultaneously. The engine rolls a tied volley at
  once but holds the damage until the whole tie group has fired or passed, then lands everything
  in firing order — so no tie-mate loses its weapons, or its life, before its own guns speak.
  This is the rulebook's own table procedure ("write the damage down, draw the cards when
  everyone has fired") made mechanical; the log marks held volleys and their landings, and the
  map plays every held impact at once.
- **Three AI levels.** *Ensign* does not lead targets, sometimes takes the second-best plot,
  shoots whatever is closest — including all-red pot shots that hand the defender rerolls — and
  never touches the exotic systems. *Captain* holds the long shot, bids Tactical Scan for the
  first-fire slot, and plays the full doctrine: Aurelian ships cloak to cross the gulf and
  decloak into their firing bracket, homing torpedoes fly at anything in flight range, scouts
  illuminate for the fleet, point defense answers incoming missiles and tractor beams pluck them
  from the sky. *Admiral* adds a phase of movement lookahead, outbids the enemy's declared scan
  by exactly one, and presses tractor captures, marines beamed onto crippled hulls behind
  deliberately dropped shields, proximity-fused fire at extreme range and harder focus. In
  mirror-image self-play the ranks are worth points, not routs — a symmetric duel is decided by
  dice, as it should be; the gap a human feels is the ensign's exploitable habits. **Admiral is the
  default**, everywhere a level is not named outright: the fleet picker opens on it, a saved battle
  that never recorded one is played at it, and the engine falls back to it. Nobody should meet a
  weak opponent by accident — if you want an easier game, ask for one.

## Hosting it

`npm run build` produces a `dist/` folder of plain static files. Anything that can serve a directory
can host the game: GitHub Pages, Netlify, Cloudflare Pages, S3, nginx, a Raspberry Pi on your LAN.
There is no build-time configuration and no runtime environment to provide.

**GitHub Pages** is wired up already, but it needs one setting: in the repository, go to
*Settings → Pages → Source* and choose **GitHub Actions**.

Do not skip this. The default is *Deploy from a branch*, and it does not simply fail — it runs
GitHub's own Jekyll pipeline on every push, **in addition** to the workflow here. Jekyll publishes
the repository source, which cannot run (the source `index.html` points at `/src/main.tsx`), and it
finishes a few seconds *after* the real deploy, so it overwrites it. Both runs report success. The
site loads and does nothing.

Two things now catch that: the deploy workflow checks the Pages source before building and fails
with the fix in the message, and a page that does not start says why instead of sitting there
blank.

With the source set to GitHub Actions, every push to the **default branch** builds and publishes
via `.github/workflows/deploy.yml`. A project site lives under `/<repo-name>/`, so the workflow
passes that path as `BASE_PATH`, taken from the repository itself — forks and renames need no edit.
The workflow triggers on every branch but only publishes from the default branch, so renaming it
does not quietly stop deployments. To publish from a branch that is not the default, run the
workflow by hand from the Actions tab.

**Any other static host** — point it at `dist/`, with the build command `npm run build` and Node 20+.
Leave `BASE_PATH` unset when the site sits at a domain root.

**Docker**, if you would rather not install Node:

```bash
docker compose up --build     # http://localhost:8080
```

The image is a two-stage build — Node to compile, nginx to serve — and carries no state.

Ships you design travel with the site — see below.

`.github/workflows/ci.yml` typechecks, runs the full test suite and does a production build on every
push and pull request.

## What you get

The **Standard rules** — everything in the rulebook not marked `(Optional)` — driven through the
full Sequence of Play:

- **Engineering Phase** — secret resource allocation across every FUNCTIONS line, weapon arming
  (including slow-arming diamonds), shield repair and reinforcement, batteries, and damage control.
  A circle the ship cannot afford is drawn out of reach, and a click the rules turn down says why
  rather than doing nothing.
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

And a **scenario designer**: lay out a battle of your own on a live map — click to place the printed
asteroid counters, planets, moons and gas clouds; drop each side's deployment anchor and set its
compass facing, speed, objective and fleet — with the K1.2 placement rules checked as you design.
A finished design appears in the scenario list like the printed ones, and a battle file embeds the
whole design, so a save plays on a machine that has never seen it.

And the **printed terrain**: all 26 asteroid field counters from the Print and Play sheet, with
their densities, safe speeds, damage dice, cover diamonds and SCAN values (K2.1) — drawn on the map
with the sheet's own asteroid photography. Pick a terrain option in *Choose forces* and the K1.1
chart rolls the field count, with counters placed three inches apart (K1.2.2), deterministically
from the battle seed. Transit damage, defender cover rerolls (K2.1.8) and the in-field low-speed
exemption (K2.2.1) all apply at the table.

## Rules coverage

| Section | Status | Notes |
| --- | --- | --- |
| A3 Sequence of Play | ✅ | All five phases, all segments, round rollover |
| B1 Starship Forms | ✅ | Full data-driven schema; rendered as an interactive form |
| B2 Resource Allocation | ✅ | Free power, sequential vs. free-order lines, multi-power circles (E4.2.11) |
| B2.4 Simplified Batteries | ✅ | Spend during allocation, recharge, damage |
| B2.5 Batteries *(optional)* | ✅ | Stored power spent in a combat phase's Command Segment, with the restrictions |
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
| S3 Scenarios | ✅ | All six printed missions, with the rules each one turns on |
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
| **H6 Cloaking Systems** *(Expansion 5)* | ✅ | Four detection levels, datum tracking, search and evasion rolls, all eleven cloaking effects enforced, the three bonus-search events, and the eighteen-phase free placement |
| C3.6 Evasive Maneuvers *(optional)* | ✅ | Plotted on the card, spent at reveal, rerolls against every incoming volley and the same handed to anything it shoots |

| C3.8 Emergency Stop *(optional)* | ✅ | Drive shut down: stationary this phase and the next, stress equal to the speed it was making |
| C3.9 Precise Turns and Slides *(optional)* | ✅ | Any turn taken at any template up to the ship's rate; half-inch slides |
| J6.3 Arming the Crew *(optional)* | ✅ | Two squads per size class, at the cost of damage control, two power and the firing order |
| E11.2 Derelict Ships *(optional)* | ✅ | A gutted hull stays on the map: no systems but damage control, shields gone, speed zero |
| E11.3 Ship Explosions *(optional)* | ✅ | A red die per point of excess damage; an `S` takes the ship and a blue die per size class off everything within an inch |
| E11.4–E11.6 Abandoning Ship *(optional)* | ✅ | Crew units, emergency transporter evacuation, escape pods, self-destruct, rescue and capture, two victory points a unit |

The optional endgame is switched on in the fleet picker, where **Derelict ships (E11.2)** gates the
other two — a hull has to linger before it can explode or be abandoned. Turning on **Abandon ship**
makes the crew something to play for. Every ship carries two crew units per size class (E11.5.4),
and each one saved *or captured* is worth two victory points (E11.4.2), so a battle that is lost on
hulls can still be won on people.

Two ways off, and the choice is real. **Emergency transport** (E11.5) is instant and can be ordered
the moment a ship is dying, but the safety protocols come off: a green die per crew unit, and a Miss
is a unit that did not survive the trip. **Escape pods** (E11.6) save everyone aboard and let the
captain scuttle the hull on the way out — but they need the ship to still be there to leave, because
a hull blown apart under weapon fire takes its crew with it (E11.6.1), and the pods then sit where
they were dropped until somebody comes for them. Anybody: a pod is taken aboard by a stopped ship
within an inch, or beamed across a unit at a time, and an enemy who collects one scores exactly what
a friend would. Pods still adrift when the shooting stops go to whoever is left holding the field.

| C4.2 Deceleration from Damage *(optional)* | ✅ | A forced slowdown charged to the round's acceleration track, with stress for everything past the green circles |

**C4.2** is the rule that makes a damaged drive frightening rather than merely inconvenient. Without
it a ship shot below its top speed simply travels slower. With it, the slowdown is *charged*: the
points go on the same per-round acceleration track the captain spends voluntarily, so a forced
deceleration competes with whatever they have already used, and everything past the green circles
comes back as stress at the check — which can damage the drive again, force another slowdown, and
take the ship apart. A derelict's drop to a standstill pays the same price (C4.2.3, E11.2.4), and
reverse is held to half the already-reduced maximum (C4.2.4).

The rulebook works the arithmetic twice on one ship, and both numbers are tests: a cruiser at speed
6 with two green circles takes three drive hits, drops to speed 2, decelerates 4 and suffers **2
stress**; a fourth hit the same round drops it to speed 1 — measured from the original speed 6, so
5 of deceleration and **3 stress** in total.

| J3.5 Displacing a Towed Ship | ✅ | An inch in any of the captive's four facings, once everyone has moved, with the links re-checked after |
| J3.2.6 Capturing Small Targets | ✅ | A tractored craft brought aboard during Flight Operations — your own back, an enemy's as a prize |

**J3.5** is worth more than the inch it moves. A tractoring ship at MAX power, of similar size or
larger, may shove its captive one inch forward, aft, to port or to starboard — measured in the
*captive's* own facings, the same four its shields are printed on. The shove happens after both
ships have moved and re-checks the beam's range first (J3.5.2), and the links are re-checked after,
which is what makes the two tactics in the rulebook fall out for free: push a ship out of your own
reach to be rid of it, or nudge it into a friend's reach so a second beam can help hold it. Gravity
wells refuse the shove outright (J3.5.3); other terrain accepts it and bills the ship next time it
flies through.

**J3.2.6** lets anything held in a beam be brought aboard during Flight Operations. Your own craft
is simply recovered; an enemy's is a prize, and the hull does not become a shuttle you can fly out
again. The rule's exceptions are about not carrying something dangerous into your own hangar, so an
armed enemy craft, a probe and an enemy jamming shuttle are all refused.

Still to do: **B3.5 campaign repair limits**, which belongs with a campaign layer.

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
  point per sensor (H3.6). The scan itself is a played action — declared in Operations step E,
  rolled, journalled — but it does not yet read this capability: the range is still the flat eight
  inches and the yield still counts only the scanning ship's own sciences. The panel shows what the
  scout *would* contribute; the scan does not take it.

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

All eleven cloaking effects are in force while the cloak runs (H6.4), and each is enforced where the
rule bites rather than only described. **Shields go down with the cloak and stay down** (H6.4.1):
they cannot be raised, the counter prints `—` on every facing, and damage bypasses them whatever its
source — weapon fire, a torpedo, an asteroid field, an exploding neighbour. Weapons and homing
launches are locked, information scans refused, tractors and transporters refused in both
directions, command points neither lent nor received, and precision targeting is barred against a
cloaked ship at any detection level.

While undetected the helm is limited to straight, slide, easy and standard turns (H6.8.5) — a harder
turn is refused when plotted, and one plotted before the cloak engaged is given up at the Navigation
Segment, since the cloak goes on in Operations after the card was written. Engaging within 8 inches
of an enemy hands that enemy a free Contact (H6.6.3); the cloak must run a full phase before it can
come off and stay off for one before it can go back on (H6.6.7, H6.7.7), both enforced by the engine
rather than only greyed out in the panel.

Three events hand every hunter in range a free roll (H6.15): running above speed 2 — rolled when the
cards turn over, one die per point over — every four points of damage the hull takes, and any small
craft leaving the bay. This is what gives the speed-2 limit its teeth: a cloak does not fail above
speed two, the ship simply starts making noise. A ship that has stayed hidden for eighteen phases may
skip the approach entirely and reappear anywhere within 18 inches of its datum, on any heading, at
speed 0–2 (H6.8.7).

**One deliberate divergence.** At the table an undetected ship's position genuinely does not exist:
the player replays the speed log from the datum by eye when found, and H6.8.5(5) forbids
pre-measuring or taking the move back. A screen cannot referee that honestly — and this engine's
replays, undo and online sync all depend on every position being derivable from the action journal.
So a cloaked ship keeps flying its card, with its true position hidden from everyone but its own
commander, and appears there when it is found. What the rule actually *removes* is still removed:
nothing sharper than a standard turn need be plotted, the default straight course costs nothing to
leave alone, and a long approach can be skipped outright with H6.8.7 rather than flown out phase by
phase.

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

J6.3, arming the general crew to repel boarders, is optional and is implemented: two improvised
squads per size class, raised during the Boarding Combat Segment, at the cost of the ship's damage
control, two points of power and its place in the firing order until twenty rounds after the
fighting stops. B3.4, spending damage control dice to kill a boarding squad, is also optional and
was already in the Damage Control Segment.

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

The interesting part is **S2.5.4 ship availability**, which is checked live and reported as you
compose — as advice, never as a barrier:

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

These limits never stop a battle. They are a tournament convention — and a scenario's own force
composition overrides them outright (S2.5.1) — so breaking one shows a note beside the force and
nothing more. **Start battle** is barred only by a force that cannot physically take the field: a
side with no ships, more hulls than the setup zone holds, or a point budget the player set
themselves. That last handful still offers the "fight anyway" override.

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

### Where designs are kept

Designs live in **`src/data/customShips.json`**, which is bundled at build time exactly like the
canon roster. A design committed there reaches every player who loads the page, on any device, with
nothing to import.

The builder writes that file for you:

1. Design a ship. **Save draft** keeps it in this browser so you can come back to it.
2. **Download customShips.json** — you get the whole roster, file designs and drafts together.
3. Replace `src/data/customShips.json` with it and commit.

Until step 3 a design is a *draft*: it exists on that one device only, and the builder says so —
designs are labelled “draft” or “in the file”, and a count of what is not yet committed sits above
the form. Editing a committed design creates a draft that shadows it, so you see your change
immediately; **Revert** throws the draft away and goes back to the file.

A test keeps that file honest: it must be a JSON array, hold no duplicate ids, never shadow a canon
ship, and contain only designs that pass the rules check — so a bad hand-edit fails CI instead of
blanking the site.

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
    customShips.json  Designs made in the ship builder, bundled with the site
    customScenarios.json  Battles made in the scenario designer, bundled the same way
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

Use the **Scenario designer** in the top bar: lay the map out, save, and **Download
customScenarios.json** — commit that file over `src/data/customScenarios.json` and the design ships
with the site, exactly like the ship builder's `customShips.json` workflow. Until it is committed a
design is a draft in that one browser; either way it appears in the scenario list and in **Choose
forces**, and any battle file embeds the whole design so a save opens anywhere.

To add one in code, write a `Scenario` plus a function returning its starting ships, and add both to
`SCENARIOS` in `src/data/scenarios.ts`. Facings use the scenario compass rose (S2.5.2) via
`facingToHeading`.

## Design decisions worth knowing

- **Rerolls are taken on expected value.** E1.2.1 and E1.2.3 make rerolls a *choice* ("may reroll"),
  and the new result is final even if worse. Rather than reroll blindly, the engine rerolls a die
  only when doing so helps the player holding the reroll — the attacker rerolls below-average
  results, the defender rerolls above-average ones.
- **The defender is asked, and the answer is journalled.** Damage cards constantly hand the
  defender a decision — E8.4.1 Any Hit, E8.3.2/E8.3.3/E8.3.4 which mount, E8.3.5 which mount to
  discharge, E8.2.2 which shield, E8.5.3 which battery, E8.5.10 which main reactor — and a ship
  its player commands now stops and asks. The engine works out what is legal: structure only when
  nothing else will take the hit, never a Critical Hit (E8.4.1 forbids it), and Heavy Weapon
  offers the reds before the yellows (E8.3.4). The doctrine's own pick is marked, for a player
  who would rather not think about it.

  Getting that in without breaking replay is the interesting part. A battle is (setup + actions)
  and nothing else, so an answer given in the moment has to reach the journal or a replay will
  quietly make a different one — and it cannot be asked *during* resolution either, because
  `applyAction` is synchronous and a prompt is not. So the question is put first, on a throwaway
  copy of the battle: the engine is deterministic, so the copy draws exactly the cards the real
  one is about to. Each answer is added to a script, the copy is re-run to find the next question,
  and when the script is complete it is journalled as `queue-damage-choices` immediately ahead of
  the action that consumes it. Undo takes the pair back together; a scripted answer is checked
  against the legal options before it is used, so a hand-edited save cannot mark a box the rules
  would refuse.

  `autoChoices` still plays every ship nobody at this console commands — the computer's, and the
  far side of an online match, since the attacker's browser must neither stall waiting for the
  defender's nor answer on their behalf. And the computer firing at *you* asks too: the AI driver
  is asynchronous for exactly that case.
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
