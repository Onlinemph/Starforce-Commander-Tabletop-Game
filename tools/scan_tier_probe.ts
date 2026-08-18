/**
 * Is H4 a brake on numbers, or a brake on sensor tech?
 *
 *     npx vite-node tools/scan_tier_probe.ts -- --games 12
 *
 * Coordinated Fire caps a faction at one attack per target per combat phase
 * (H4.3.1), and the only way past it is a group whose every member holds
 * Tactical Scan at least equal to the group's size (H4.5.1). Tactical Scan is
 * bought out of the SENSOR line and capped by undamaged SENS boxes — both
 * printed per hull, and both of which climb with the hull's year. Across the
 * printed roster the ceiling correlates with year at r = +0.75: nothing built
 * before the 3660s exceeds 3, and every hull of the 3670s reaches 4.
 *
 * So the same swarm, at a later tech level, coordinates in bigger groups and
 * pays a smaller share of the rule. This measures exactly that: ONE probe
 * hull, one anchor, one set of seeds, and nothing varied but the swarm's scan
 * ceiling. If the anchor's break-even count falls as the ceiling rises, H4 is
 * discriminating by tech rather than by numbers.
 *
 * Caveat kept in view: raising SENS boxes also raises the ship's targeting and
 * jamming ceilings and gives it two more boxes to lose, so the high tiers are
 * mildly better ships beyond their coordination. The comparison is still the
 * cleanest available — the alternative, comparing different printed hulls,
 * varies everything at once.
 */

import fs from 'node:fs'
import { FILE_FORMS, registerCustomForms, shipFormById } from '../src/data/ships'
import { registerCustomScenarios, startScenario } from '../src/data/scenarios'
import { applyAction, type GameAction } from '../src/engine/actions'
import { aiNextActions, createAiMemo, type AiDifficulty, type AiMemo } from '../src/engine/ai'
import { activeShips, victoryPoints, type GameState } from '../src/engine/game'
import { health } from '../src/engine/battleScore'

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const games = Number(arg('games') ?? 12)
const rounds = Number(arg('rounds') ?? 12)
const rank = (arg('rank') ?? 'captain') as AiDifficulty
const out = arg('out') ?? 'tools/scan_tier.csv'
const anchorId = arg('anchor') ?? 'union-union-iii-class-dreadnought'
const baseProbeId = arg('probe') ?? 'union-yorktown-i-class-heavy-cruiser'

/** Scan ceilings to compare: below the printed hull, at it, and above it. */
const TIERS = [2, 3, 4, 5]

const base: any = shipFormById(baseProbeId)
if (!base) {
  console.error(`No such form: ${baseProbeId}`)
  process.exit(1)
}

/**
 * A copy of the probe hull whose SENS boxes and SENSOR line both reach `tier`.
 * Everything else — guns, shields, structure, drive, price — is untouched.
 */
function atTier(tier: number) {
  const form = JSON.parse(JSON.stringify(base))
  form.id = `${base.id}-scan${tier}`
  form.name = `${base.name} [scan ${tier}]`
  // Set the box count exactly, up or down: the ceiling IS the variable, so a
  // tier below the printed hull has to actually bind (H2.2.3).
  form.systems = form.systems.map((g: any) => (g.kind === 'SENS' ? { ...g, boxes: tier } : g))
  const line = form.functions.find((l: any) => l.kind === 'sensor')
  if (line) {
    // Keep the printed shape (free value, one power point per step) and only
    // lift the top step to where the tier needs it.
    const top = Math.max(tier, ...(line.steps ?? []).map((s: any) => s.value))
    line.steps = (line.steps ?? []).map((s: any, i: number, all: any[]) =>
      i === all.length - 1 ? { ...s, value: top } : s,
    )
    if ((line.steps ?? []).length === 0) line.steps = [{ powerCost: 1, value: top }]
    // The first step must still reach the tier on one power point, or the
    // swarm cannot afford the scan it is being given.
    line.steps[0] = { ...line.steps[0], value: Math.max(line.steps[0].value, tier) }
  }
  return form
}

const variants = TIERS.map(atTier)
registerCustomForms([...FILE_FORMS, ...variants])

function runGame(probeId: string, n: number, seed: number) {
  registerCustomScenarios([
    {
      id: 'scan-tier',
      name: 'Scan tier',
      background: '',
      victory: 'destruction',
      bounds: { width: 72, height: 72, fixed: true },
      terrain: [],
      sides: [
        { side: 'Alpha Fleet', objective: 'destroy', facing: 2, speed: 4, anchor: { x: 12, y: 36 }, spread: { x: 0, y: 5 }, force: [anchorId] },
        { side: 'Beta Fleet', objective: 'destroy', facing: 6, speed: 4, anchor: { x: 60, y: 36 }, spread: { x: 0, y: 5 }, force: Array(n).fill(probeId) },
      ],
    },
  ])
  const game: GameState = startScenario('scan-tier', { seed, mapScale: 2, coordinatedFire: true })
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const memos = new Map<string, AiMemo>(sides.map((x) => [x, createAiMemo()]))
  let groups = 0
  let groupShips = 0
  const drive = (closing: boolean) => {
    for (let pass = 0; pass < 50; pass++) {
      const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
      for (const side of sides) {
        for (let g = 0; g < 400; g++) {
          const batch = aiNextActions(game, [side], memos.get(side)!, closing && pass === 0 && g === 0, rank, 'steady', false)
          if (batch.length === 0) break
          for (const a of batch) {
            if (a.type === 'declare-coordinated' && 'shipIds' in a) {
              const decl = a as { shipIds: string[] }
              const beta = game.ships.find((s) => s.id === decl.shipIds[0])?.side === 'Beta Fleet'
              if (beta) {
                groups++
                groupShips += decl.shipIds.length
              }
            }
            applyAction(game, a as GameAction)
          }
        }
      }
      if (game.log.length + game.firingStepIndex + game.firedThisSegment.size === before) return
    }
  }
  drive(false)
  for (let step = 0; step < 3000; step++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > rounds) break
    drive(true)
    applyAction(game, { type: 'advance-segment' })
    drive(false)
  }
  const vp = victoryPoints(game)
  return {
    vpA: vp['Alpha Fleet'] ?? 0,
    vpB: vp['Beta Fleet'] ?? 0,
    healthA: health(game, 'Alpha Fleet'),
    healthB: health(game, 'Beta Fleet'),
    groups,
    groupShips,
    endRound: game.round,
  }
}

if (!fs.existsSync(out)) {
  fs.writeFileSync(out, 'tier,n,seed,vpA,vpB,healthA,healthB,groups,groupShips,endRound\n')
}
const done = new Set(
  fs.readFileSync(out, 'utf8').split('\n').slice(1).filter(Boolean).map((l) => {
    const c = l.split(',')
    return `${c[0]}|${c[1]}|${c[2]}`
  }),
)

const pvA = shipFormById(anchorId)!.pointValue
const pvP = base.pointValue
let played = 0
for (const tier of TIERS) {
  const probeId = `${base.id}-scan${tier}`
  for (let n = 1; n <= 12; n++) {
    const ratio = (n * pvP) / pvA
    if (ratio < 0.25 || ratio > 2.0) continue
    for (let g = 0; g < games; g++) {
      const seed = 9000 + g * 7919 + tier * 733 + n * 13
      if (done.has(`${tier}|${n}|${seed}`)) continue
      const r = runGame(probeId, n, seed)
      fs.appendFileSync(
        out,
        `${tier},${n},${seed},${r.vpA},${r.vpB},${r.healthA.toFixed(3)},${r.healthB.toFixed(3)},` +
          `${r.groups},${r.groupShips},${r.endRound}\n`,
      )
      played++
      if (played % 25 === 0) console.log(`${played} games...`)
    }
  }
}
console.log(`done: ${played} games played`)
