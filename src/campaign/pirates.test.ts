import { describe, expect, it } from 'vitest'
import { blankScenario, newCampaign } from './file'
import { PIRATE_DEFAULTS, resolvePirates, systemOwner } from './pirates'
import { resolvePhase, type DetectionContext } from './turn'
import { sideToMove, type CampaignFile, type PhaseMove } from './types'

/**
 * Pirates (the designer's anti-doom-stack incentive): an unpatrolled star
 * system on your side of the frontier risks a raid at every round tick, and
 * a raid costs victory points. A single picket deters the clans.
 */

const BLIND = [0, 0, 0, 0, 0, 0]

function coastFile(pirates?: { enabled?: boolean; raidChance?: number; raidVp?: number; patrolRange?: number }): CampaignFile {
  const scenario = blankScenario({
    mapSeed: 9,
    mapWidth: 40,
    mapHeight: 20,
    rounds: 20,
    forces: {
      A: [
        {
          id: 'a-picket',
          kind: 'ship',
          name: 'USS Picket',
          ships: ['union-nelson-ii-class-light-frigate'],
          hex: { q: 4, r: 8 },
          order: { speed: 'hold' },
        },
      ],
      B: [
        {
          id: 'b-far',
          kind: 'ship',
          name: 'IMS Far Away',
          ships: ['vallari-v-6l-savage-class-light-cruiser'],
          hex: { q: 36, r: 0 },
          order: { speed: 'hold' },
        },
      ],
    },
    tuning: {
      detectionCurve: BLIND,
      misinformationBase: 0,
      falseContacts: false,
      pirates: { raidChance: 1, raidVp: 2, patrolRange: 2, ...pirates },
    },
  })
  const file = newCampaign(scenario, 'c-pirates')
  // A hand-laid chart: one system on each coast, a straight frontier at q 20.
  file.map.terrain = [
    { q: 5, r: 8, kind: 'system' }, // A's coast — one hex from the picket
    { q: 30, r: 5, kind: 'system' }, // B's coast — nobody anywhere near
  ]
  file.map.border = Array.from({ length: 20 }, (_, row) => ({ q: 20, r: -10 + row }))
  return file
}

const ctxOf = (file: CampaignFile): DetectionContext => ({ map: file.map, scenario: file.scenario })

function passRound(file: CampaignFile): void {
  for (let i = 0; i < 16; i++) {
    const move: PhaseMove = {
      round: file.state.round,
      phase: file.state.phase,
      side: sideToMove(file.state.phase),
      interventions: [],
    }
    file.state = resolvePhase(ctxOf(file), file.state, move)
  }
}

describe('whose coast a system is on', () => {
  it('splits by the frontier, and a system ON the line belongs to nobody', () => {
    const file = coastFile()
    expect(systemOwner(file.map, { q: 5, r: 8 })).toBe('A')
    expect(systemOwner(file.map, { q: 30, r: 5 })).toBe('B')
    expect(systemOwner(file.map, { q: 20, r: 2 })).toBeNull()
  })
})

describe('the raid at the round tick', () => {
  it('bleeds the unpatrolled coast and spares the picketed one', () => {
    const file = coastFile()
    passRound(file)
    // B's system sits alone: at chance 1 the raid lands every round.
    expect(file.state.vp.B).toBe(-2)
    // A's picket is one hex out — within patrol range 2: the clans pass by.
    expect(file.state.vp.A).toBe(0)
    // The raid makes the news, addressed to the raided side, at the system.
    expect(file.state.events).toHaveLength(1)
    expect(file.state.events[0].side).toBe('B')
    expect(file.state.events[0].hex).toEqual({ q: 30, r: 5 })
    expect(file.state.events[0].text).toMatch(/Pirate raid/)

    passRound(file)
    expect(file.state.vp.B).toBe(-4)
    expect(file.state.events).toHaveLength(2)
  })

  it('a picket pulled off station opens the coast', () => {
    const file = coastFile()
    file.state.units.find((u) => u.id === 'a-picket')!.hex = { q: 12, r: 8 } // 7 hexes out
    passRound(file)
    expect(file.state.vp.A).toBe(-2)
  })

  it('the clans can be switched off, and the knobs resolve over defaults', () => {
    const off = coastFile({ enabled: false })
    passRound(off)
    expect(off.state.vp.A).toBe(0)
    expect(off.state.vp.B).toBe(0)
    expect(off.state.events).toHaveLength(0)

    expect(resolvePirates(undefined)).toEqual(PIRATE_DEFAULTS)
    expect(resolvePirates({ raidVp: 5 }).raidVp).toBe(5)
    expect(resolvePirates({ raidVp: 5 }).raidChance).toBe(PIRATE_DEFAULTS.raidChance)
  })
})
