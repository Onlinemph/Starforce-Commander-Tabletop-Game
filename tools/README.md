# Tools

The importer that turns the printed ship books into `ships.json`, the season harness the balance
claims are made with, and three search tools that tune the AI against it.

## Season harness

```bash
npm run season                    # the three standing baselines, 64 mirrored games each
npm run season -- --games 256     # a deeper look when a result is close
npm run season -- --list          # the baselines and what they mean
npm run season -- --scenario s3.6-target-the-flagship --hi admiral --lo captain
```

Every balance claim in this repository was measured this way, and the harness is committed so
they can be checked rather than believed. Three things about the method are load-bearing:

- **Mirrored.** Every seed is played twice, once from each hull. Without that, a scenario that
  favours whoever deploys in the east is indistinguishable from a doctrine that wins.
- **Sixty-four games is the floor.** Thirty-two is noise — it has swung by six wins on changes
  later shown to do nothing. When a result is close, raise `--games` rather than believe it.
- **Ablate before shipping.** A doctrine with two halves usually has one that does the work. The
  battery doctrine measured 39W–23L; holding the battery back and never spending it measured
  32W–32L, which is how we know the win was the spending and not the hoarding.

Health, not victory points, decides a season: structure still floating, nothing for a hull that
left, a penalty for one that died. A fleet that wins on points while losing every hull has not
won anything.

It is deliberately outside `npm test`. A full season takes minutes, and a test suite nobody runs
is worse than one that measures nothing.

**The variance floor, measured once and worth keeping.** Twenty-four duel seeds, each played four
times between two IDENTICAL admirals with decorrelated dice: 17 of 24 flipped winners — the duel
between equals is ~71% dice-decided, every game ends in a kill, and the honest ceiling for any
future AI against the current one is therefore ~65%. A claimed 95% mirror result is a
best-response exploiter of the frozen policy, not a better player, and will lose to the ladder.
The current admiral's 97% against the captain means the skill gap covers most bad-dice games;
between equals that cushion does not exist. Side finding: the Karnath chair won 6 of the 7
position-held seeds — the printed duel matchup mildly favours the V-7C between equal players.

## Tuning the AI against it

Three of the things in `src/engine/ai.ts` were chosen by judgment rather than measured. These
tools measure them, and each one reports to the season above.

```bash
npm run sweep                     # the power allocation order (G1.3, B2.5)
npm run sweep -- --list

npm run evolve                    # the plot scorer's 19 coefficients
npm run evolve -- --generations 34 --lambda 1 --seed 22 --no-holdout
npm run evolve -- --validate '<json>'      # score a weight set on the holdout
```

Both shipped. The allocation order was worth 57 games a season; the evolved plot weights were
worth 40 on battles the search had never seen. Rollout plotting (see below) and three rounds of
tuning its joints then carried the baselines to the current standing record: **duel vs captain
187W-5L (97%), both ensign seasons perfect at 192W-0L, planet 174W-18L** — via plan-shape
nomination, a two-round horizon, the admiral self-model, and finally seven finalists judged on
two dice sequences each. Train and holdout are disjoint by scenario and the holdout is looked at **once**,
at the end — a validation set consulted every generation is just a slower training set. Two of
the three evolution restarts failed to generalise, which is what the discipline is for.

### The learned value function, and why there isn't one

```bash
npm run selfplay -- --games 150 --seed-base 0 --out data/plots-0.jsonl
npm run train -- --data 'data/plots-*.jsonl' --label dealt --hidden 16 --out models/plot.json
npm run train -- --data 'data/plots-*.jsonl' --label dealt --hidden 16 --only context   # ablation
npm run evolve -- --model models/plot.json --blends 0,1,3
```

Self-play a few hundred battles, record the 38-feature vector behind every plot the captain
commits to, fit a small network on what followed, and score candidate plots with it. This is the
"can it learn like a chess bot" question, and the answer is on the tin of `src/engine/plotModel.ts`.

The short version: the models **predict** well — AUC 0.88 on unseen battles, and the positional
features roughly double the fit over the scoreboard-only ablation — and **rank** badly. Every
model at every blend played worse than no model, *including with its sign reversed*, which is how
we know it is noise rather than a signal pointed the wrong way. Nothing ships; the machinery does,
so the question can be re-asked cheaply and so nobody has to have the idea twice.

`--explore` matters if you re-run it. Without it the training set contains only positions this
captain approves of, which is the wrong set to rank rejected candidates from. It improved the fit
and not the play.

### Rollout plotting — the thing that did work

The scorer nominates its top four plots; each is resolved by cloning the battle and letting
captain-level doctrine play both sides one full round forward, all four clones facing the same
dice. No prediction, no fitted model — the game itself is the evaluator. Admiral-only, on by
default (`setRolloutPlots` in `src/engine/ai.ts` is the off switch every measurement tool uses).

    duel adm-vs-capt   129W-62L → 167W-24L      squadron adm-vs-ens  171W-21L → 188W-4L
    duel adm-vs-ens    172W-19L → 191W-1L       orbital ambush       40W-55L  → 159W-33L

Those figures include the knob sweep that followed (`RolloutConfig` in `ai.ts` holds the full
table): widening the shortlist was flat, but nominating the best candidate of each *plan shape*
and playing the clones two rounds instead of one each bought games everywhere they were tried —
the ensign seasons are now formalities, and `{ loRollouts: false }` fields yesterday's
scorer-only admiral as the reference opponent with resolution to spare (85W-11L in the mirror).

Volley rollouts — the same treatment for the guns — were built, measured, and left off
(`RolloutConfig.volleys`): flat in duels, and ten games *worse* in the squadron mirror. Each
ship's simulated firing choice looks good alone and collectively dissolves focus fire; the
scorer's blunt focus bonus turns out to be a coordination device, and per-agent simulation
optimises it away. The comment on the switch holds the numbers and the fleet-level idea that
could revive it.

One rule learned the hard way: the rollout must cast the enemy at its *actual* rank
(`setRolloutEnemyRank`). Imagined as a captain while really facing an ensign, the admiral hedges
against phantom competence and loses games to its own caution — the squadron season regressed
seven games before the cast was fixed and gained three after.

## The versus machine

```bash
npx vite-node tools/versus.ts -- --a fan-sw-imperial-star-destroyer \
    --b fan-b5-omega-destroyer,fan-b5-omega-destroyer --games 40 --rank captain
```

Any force against any force, measured — comma-separate form ids to field a
fleet. Born from "would a Star Destroyer beat a Star Trek ship?", which no two
fandoms have ever settled by argument. Findings that have already come out of
it: the wedge kills any single cruiser 40-0 and still dies 0-40 to a
points-matched three-ship wall; the lore pass it forced on the SHARLIN and the
OMEGA is written up in tools/fan_designs.ts. One trap it also found: a
scenario's ship ids are prefixed with the side name's first word, so two sides
whose names share it collide and the battle silently scrambles.

# Ship Book importer

Regenerates `src/data/ships.json` from the StarForce Commander **Master Ship Book** PDF.

```bash
pip install pymupdf pypdf
cd tools
python3 extract_ship_list.py                     # → msl.json         (both ship lists)
python3 extract_ship_book.py all                 # → ships_raw.json   (Master Ship Book)
BOOK=aurelian python3 extract_ship_book.py all   # → ships_raw.json, rename to
                                                 #   aurelian_raw.json
python3 generate_ships.py                        # → ships_final.json (validated)
```

The Aurelian Starship Book from Expansion 5 shares the Master Ship Book's layout and differs only in
palette — purple section bands, dark-green general-data icons — so the same extractor reads both;
`BOOK` picks which.

`extract_ship_book.py` reads the forms structurally rather than as text: box and power-circle glyphs
are identified by Wingdings codepoint plus colour, range-bracket bands by Calibri colour and italics,
attack dice by Wingdings2 colour, and firing arcs by rasterising each icon *placement* (the layout
rotates and mirrors a small set of source images) and reading its eight wedges.

Scouts also carry a SCOUT SENSOR block below the FUNCTIONS list; its power circles, damage boxes and
three range numbers (targeting, jamming, scan) are read positionally.

`generate_ships.py` maps those records onto the engine's `ShipForm` schema, joins the Master Ship
List for point values, availability, year and the victory table, applies the errata list, and
cross-checks each ship against its own printed TOTAL POWER, battery count and shield values — plus,
on scouts, that the sensor count, damage boxes and SCOUT SEN line all agree. It prints
`validation problems: 0` when everything reconciles.

`extract_ship_list.py` parses the Master Ship List from both books into `msl.json`; rows flagged
`(Exp 6)` have no form yet and are dropped at generation. All intermediates are scratch files and
are not committed.

Set the paths in `BOOKS` at the top of `extract_ship_book.py` and `extract_ship_list.py` before
running.


# Damage deck importer

Regenerates `src/data/damageDeck.json` from the **print-and-play components** PDF.

```bash
cd tools
python3 extract_damage_deck.py     # → cards_raw.json (56 cards)
```

The deck lives on four "CARD FRONT n of 4" sheets, each a 5x3 grid of card frames. A normal card has
two rounded header bands — the primary hit above, the ALT HIT below — whose fill colour encodes the
E8 category (pale pink weapon, green engineering, blue defense, yellow general, orange structure).
Critical cards have no bands and no alternate hit. The Stress Damage icon (C3.1.4) is the only
artwork a card carries, so its presence is read from the image list.

Titles are separated from rules text by case, not size or colour: titles are set in caps (allowing
for stylised small caps like `lEFT`), rules text in sentence case. Type size does not work — long
titles shrink to the body's 9pt — and neither does colour, since yellow cards set their titles in
black.

Card titles are then mapped onto the engine's `DamageHit` identifiers and written out with stable
ids. The importer prints any title it cannot map.

# Attack dice

The die faces in `src/engine/dice.ts` are transcribed from the DIE ROLL CHART on the Captain's
Reference Card (page 31 of the components PDF), which prints the equivalent result for every face of
a standard d6. They are not extracted programmatically — the table is six rows long and is easier to
read than to parse.
