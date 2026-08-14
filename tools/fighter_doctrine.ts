/**
 * What is the best way to run a wing?
 *
 *     npx vite-node tools/fighter_doctrine.ts [games]
 *
 * Fighters arrived with a set of choices nobody had a number for. Do you mass
 * the wing on one hull or give it a hull each? Do you clear the sky first, or
 * ignore the enemy's fighters and go for the ships? Is a flight that has spent
 * its ordnance worth the trip home, or should it stay up and plink? When do you
 * open the doors? Four flights of six, or four of three?
 *
 * Each of those is a knob on `WingDoctrine`. This plays a carrier through full
 * battles under each setting — one knob moved at a time against the default —
 * and reports what happened. Every row uses the same seeds, so two rows differ
 * because the doctrine differed and not because one drew better cards. Only the
 * Blue wing flies the variant; where the enemy has a wing of its own it flies
 * the default, which makes each row a straight A/B rather than self-play.
 *
 * Two matchups, because they ask different questions:
 *
 *  - **Strike** — a carrier against two battlecruisers with no wing at all.
 *    Nothing to dogfight, so this is purely "how do you get ordnance onto a
 *    hull and live", and every fighter in the log is Blue's.
 *  - **Contested** — a carrier against an OMEGA, which flies Starfuries. Now
 *    there is a sky to lose. The two wings fly different cards, so the log
 *    still attributes cleanly.
 *
 * The measure that matters is **damage delivered per fighter lost**. Raw damage
 * rewards a doctrine that throws the wing into a battleship's flak; raw
 * casualties reward one that never fights. The ratio is the trade a carrier
 * captain is actually making. The scoreboard margin is printed beside it,
 * because a wing exists to win the battle and not to look efficient losing it.
 */

import { buildGame } from '../src/data/savedGame'
import { applyAction, type GameAction } from '../src/engine/actions'
import {
  aiNextActions,
  createAiMemo,
  setWingDoctrine,
  type WingDoctrine,
} from '../src/engine/ai'
import { activeShips, isCombatPhase, flightsAirborne, victoryPoints } from '../src/engine/game'

const GAMES = Number(process.argv[2] ?? 6)
const SIDE = 'Blue Force'
const FOE = 'Red Force'

interface Matchup {
  label: string
  blue: string[]
  red: string[]
  /** Blue's fighter card name, as it appears in the log. */
  ours: RegExp
}

const MATCHUPS: Matchup[] = [
  {
    label: 'strike (no enemy wing)',
    blue: ['fan-union-ark-royal-fleet-carrier'],
    red: ['vallari-v-7c-raider-class-battlecruiser', 'vallari-v-7c-raider-class-battlecruiser'],
    ours: /^SABRE flight/,
  },
  {
    label: 'contested (OMEGA flies Starfuries)',
    blue: ['fan-union-ark-royal-fleet-carrier'],
    red: ['fan-b5-omega-destroyer'],
    ours: /^SABRE flight/,
  },
]

interface Variant {
  label: string
  doctrine: Partial<WingDoctrine>
}

/*
 * One knob at a time. A full factorial is 3×2×2×3×2×2 = 144 cells at about two
 * minutes a game — a day of compute for an answer that would still be dominated
 * by the main effects.
 */
const VARIANTS: Variant[] = [
  { label: 'default', doctrine: {} },
  { label: 'hull first (ignore fighters)', doctrine: { priority: 'hull' } },
  { label: 'clear the sky first', doctrine: { priority: 'fighters' } },
  { label: 'a hull each (distribute)', doctrine: { massing: 'distribute' } },
  { label: 'stay up, never rearm', doctrine: { spent: 'loiter' } },
  { label: 'launch early (4 rounds out)', doctrine: { launchHorizonRounds: 4 } },
  { label: 'hold back (1 round out)', doctrine: { launchHorizonRounds: 1 } },
  { label: 'half-strength flights (x3)', doctrine: { flightSize: 3 } },
  { label: 'go up rigged to dogfight', doctrine: { strikeLoad: 'space-superiority' } },
]

interface Tally {
  damage: number
  lost: number
  runs: number
  kills: number
  margin: number
  rounds: number
  airborne: number
  phases: number
}

function zero(): Tally {
  return { damage: 0, lost: 0, runs: 0, kills: 0, margin: 0, rounds: 0, airborne: 0, phases: 0 }
}

function add(into: Tally, from: Tally): void {
  for (const k of Object.keys(into) as (keyof Tally)[]) into[k] += from[k]
}

function play(matchup: Matchup, seed: number): Tally {
  const game = buildGame({
    scenarioId: 's3.1-the-duel',
    seed,
    mapScale: 2,
    fleets: { [SIDE]: matchup.blue, [FOE]: matchup.red },
    aiSides: [FOE, SIDE],
  })
  const carrier = game.ships.find((s) => s.side === SIDE)!
  const memo = createAiMemo()
  const tally = zero()
  let lastPhase = ''

  for (let step = 0; step < 30000 && game.round <= 10; step++) {
    if (isCombatPhase(game.phase) && game.segment === 'flight-operations') {
      const key = `${game.round}/${game.phase}`
      if (key !== lastPhase) {
        lastPhase = key
        tally.phases += 1
        tally.airborne += flightsAirborne(game, carrier).length
      }
    }
    let acted = false
    for (const action of aiNextActions(game, [FOE, SIDE], memo, true, 'admiral') as GameAction[]) {
      applyAction(game, action)
      acted = true
    }
    if (!acted) applyAction(game, { type: 'advance-segment' })
    if (activeShips(game).length < 2) break
  }

  tally.rounds = game.round
  for (const { message } of game.log) {
    const mine = matchup.ours.test(message)
    // Strike runs and their damage: only ours count.
    const hit = /strikes .*? for (\d+) damage/.exec(message)
    if (hit && mine) {
      tally.runs += 1
      tally.damage += Number(hit[1])
    }
    // Point defense and gunnery casualties. The line names the flight that took
    // them, so "ours" is the same test.
    const down = /— (\d+) fighter\(s\) down/.exec(message)
    if (down && mine) tally.lost += Number(down[1])
    // Dogfights: the attacker leads the line, so a line we start is a kill we
    // scored, and a line we do not start that names us is a loss we took.
    const dogfight = /engages .*?, (\d+) destroyed/.exec(message)
    if (dogfight) {
      if (mine) tally.kills += Number(dogfight[1])
      else if (matchup.ours.test(message.split('engages ')[1] ?? '')) {
        tally.lost += Number(dogfight[1])
      }
    }
  }
  const score = victoryPoints(game)
  tally.margin = (score[SIDE] ?? 0) - (score[FOE] ?? 0)
  return tally
}

const SEEDS = Array.from({ length: GAMES }, (_, i) => 0x5f04ce + i * 7919)

console.log(`${GAMES} games a row · 72" map · same seeds every row · Blue flies the variant\n`)

for (const matchup of MATCHUPS) {
  console.log(`  ${matchup.label}`)
  console.log('    doctrine                       dmg  lost  dmg/loss  kills  runs   up  margin')
  console.log('    ' + '-'.repeat(76))
  const rows: (Tally & { label: string })[] = []

  for (const variant of VARIANTS) {
    // Blue only: the enemy's wing keeps flying the default, so the row is an
    // A/B and not two copies of the same idea agreeing with each other.
    setWingDoctrine()
    setWingDoctrine(variant.doctrine, SIDE)
    const sum = zero()
    for (const seed of SEEDS) add(sum, play(matchup, seed))
    const per = (n: number) => n / GAMES
    const ratio = sum.damage / Math.max(1, sum.lost)
    rows.push({ ...sum, label: variant.label })
    console.log(
      '    ' +
        variant.label.padEnd(31) +
        per(sum.damage).toFixed(0).padStart(4) +
        per(sum.lost).toFixed(1).padStart(6) +
        ratio.toFixed(1).padStart(10) +
        per(sum.kills).toFixed(1).padStart(7) +
        per(sum.runs).toFixed(1).padStart(6) +
        (sum.airborne / Math.max(1, sum.phases)).toFixed(1).padStart(5) +
        per(sum.margin).toFixed(0).padStart(8),
    )
  }

  const byRatio = [...rows].sort(
    (a, b) => b.damage / Math.max(1, b.lost) - a.damage / Math.max(1, a.lost),
  )
  const byMargin = [...rows].sort((a, b) => b.margin - a.margin)
  console.log(
    `\n    best trade:  ${byRatio[0].label} ` +
      `(${(byRatio[0].damage / Math.max(1, byRatio[0].lost)).toFixed(1)} damage a fighter)`,
  )
  console.log(
    `    best margin: ${byMargin[0].label} (${(byMargin[0].margin / GAMES).toFixed(0)})\n`,
  )
}

setWingDoctrine()
