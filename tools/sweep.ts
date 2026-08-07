/**
 * The allocation sweep: which order should a captain spend its reactor in?
 *
 * `planAllocation` is a strict priority list — each step takes what it wants
 * and the next step sees what is left — so the order is the doctrine, and it
 * has never been searched. The telemetry that motivated this says the reactor
 * runs dry long before the list ends. Across thirty battles:
 *
 *     weapons            2619 spent    621 starved
 *     sensors-2          1088 spent   1278 starved
 *     accel-1             517 spent   1139 starved
 *     sif                 206 spent   2830 starved
 *     shield-repair          4 spent   5055 starved
 *     shield-reinforce      40 spent   3342 starved
 *     sensors-full           0 spent   1278 starved
 *     accel-2                0 spent   2818 starved
 *
 * Shield repair (G1.3.3) and reinforcement (G1.3.2) are doctrine on paper and
 * unfunded in practice, and the "spare change" tail never sees a single point.
 * So the candidates below are not a blind permutation — 15 steps is 15!
 * orderings and a season is three minutes. They are the moves the starvation
 * numbers argue for: bring the unfunded defensive steps up past the marginal
 * offensive ones, and see what the seasons say.
 *
 * Run it:
 *
 *   npm run sweep                # every candidate, in order
 *   npm run sweep -- --only 3    # one candidate, for running several at once
 *   npm run sweep -- --list      # names and the move each one makes
 *
 * The order binds to the admiral alone (see `setAllocationOrder`): a season is
 * the admiral against a fixed lower rank, so changing both sides would hide a
 * real gain behind its own mirror.
 */

import {
  DEFAULT_ALLOCATION_ORDER,
  setAllocationOrder,
  type AllocationStep,
} from '../src/engine/ai'
import { BASELINES, season } from './season'

/** Move `moved` so it sits immediately before `anchor`, keeping the rest. */
function before(anchor: AllocationStep, ...moved: AllocationStep[]): AllocationStep[] {
  const rest = DEFAULT_ALLOCATION_ORDER.filter((s) => !moved.includes(s))
  const at = rest.indexOf(anchor)
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)]
}

/** Move `moved` to the very end. */
function last(...moved: AllocationStep[]): AllocationStep[] {
  return [...DEFAULT_ALLOCATION_ORDER.filter((s) => !moved.includes(s)), ...moved]
}

interface Candidate {
  name: string
  why: string
  order: AllocationStep[]
}

export const CANDIDATES: Candidate[] = [
  {
    name: 'baseline',
    why: 'the standing order, as a control on the harness itself',
    order: [...DEFAULT_ALLOCATION_ORDER],
  },
  {
    name: 'shields-before-sensors2',
    why: 'both shield steps ahead of the second sensor point',
    order: before('sensors-2', 'shield-repair', 'shield-reinforce'),
  },
  {
    name: 'repair-before-sensors2',
    why: 'repair only — reinforcement stays where it is',
    order: before('sensors-2', 'shield-repair'),
  },
  {
    name: 'shields-before-accel1',
    why: 'shields ahead of the first drive point but behind the eyes',
    order: before('accel-1', 'shield-repair', 'shield-reinforce'),
  },
  {
    name: 'shields-before-weapons',
    why: 'the extreme version: a damaged shield outranks a charged gun',
    order: before('weapons', 'shield-repair', 'shield-reinforce'),
  },
  {
    name: 'sif-last',
    why: 'SIF spends 206 and is refused 2830 times; try it as true spare change',
    order: last('sif'),
  },
  {
    name: 'accel1-before-sensors2',
    why: 'legs before the second sensor point',
    order: before('sensors-2', 'accel-1'),
  },
  {
    name: 'scout-after-sensors2',
    why: 'the scout line is expensive; let the ordinary sensors fill first',
    order: before('flag-gen-sys', 'scout'),
  },
  {
    name: 'shields-and-sif-last',
    why: 'shields up front, SIF to the back — the two moves the numbers argue for',
    order: (() => {
      const withShields = before('sensors-2', 'shield-repair', 'shield-reinforce')
      return [...withShields.filter((s) => s !== 'sif'), 'sif']
    })(),
  },
  // Round two, around the winner of round one (shields-before-accel1, 403/576).
  {
    name: 'w+sif-last',
    why: 'the winner, with SIF moved to the back as well',
    order: (() => {
      const w = before('accel-1', 'shield-repair', 'shield-reinforce')
      return [...w.filter((s) => s !== 'sif'), 'sif']
    })(),
  },
  {
    name: 'w+scout-late',
    why: 'the winner, with the expensive scout line after the ordinary sensors',
    order: (() => {
      const w = before('accel-1', 'shield-repair', 'shield-reinforce').filter((s) => s !== 'scout')
      const at = w.indexOf('flag-gen-sys')
      return [...w.slice(0, at), 'scout' as AllocationStep, ...w.slice(at)]
    })(),
  },
  {
    name: 'w+reinforce-last',
    why: 'repair early, reinforcement late — is it the repairs doing the work?',
    order: (() => {
      const w = before('accel-1', 'shield-repair').filter((s) => s !== 'shield-reinforce')
      return [...w, 'shield-reinforce' as AllocationStep]
    })(),
  },
]

function evaluate(candidate: Candidate): void {
  setAllocationOrder(candidate.order)
  let wins = 0
  let games = 0
  const parts: string[] = []
  for (const baseline of BASELINES) {
    const result = season(baseline.label, baseline.scenario, 192, baseline.hi, baseline.lo)
    wins += result.wins
    games += result.games
    parts.push(`${String(result.wins).padStart(3)}W-${String(result.losses).padStart(3)}L`)
  }
  setAllocationOrder(null)
  console.log(`${candidate.name.padEnd(26)} ${parts.join('  ')}   total ${wins}/${games}`)
}

function main(): void {
  if (process.argv.includes('--list')) {
    for (const [i, c] of CANDIDATES.entries()) {
      console.log(`${String(i).padStart(2)}  ${c.name.padEnd(26)} ${c.why}`)
      console.log(`    ${c.order.join(' → ')}`)
    }
    return
  }
  const onlyAt = process.argv.indexOf('--only')
  const only = onlyAt === -1 ? null : Number(process.argv[onlyAt + 1])
  for (const [i, candidate] of CANDIDATES.entries()) {
    if (only !== null && i !== only) continue
    evaluate(candidate)
  }
}

main()
