import { describe, expect, it } from 'vitest'
import { blankScenario, newCampaign } from './file'
import { ENDURANCE_DEFAULTS, resolveEndurance } from './logistics'
import { resolvePhase, type DetectionContext } from './turn'
import { sideToMove, type CampaignFile, type CampaignScenario, type PhaseMove } from './types'

/**
 * Endurance as scenario dials (6.4, PROVISIONAL numbers): the designer's
 * first campaign flew LOW fleet-wide by round 3, and his formula is still
 * pending, so every number is data he can turn — tank size, base burn, the
 * cloak and sensor surcharges, the speed-tier burn.
 */

function file(endurance?: CampaignScenario['tuning']['endurance']): CampaignFile {
  const scenario = blankScenario({
    mapSeed: 3,
    mapWidth: 30,
    mapHeight: 20,
    forces: {
      A: [
        {
          id: 'a-ship',
          kind: 'ship',
          name: 'USS Tank',
          ships: ['union-nelson-ii-class-light-frigate'],
          hex: { q: 5, r: 5 },
          order: { speed: 'hold', sensorPower: 2 },
        },
      ],
      B: [],
    },
    tuning: {
      detectionCurve: [0, 0, 0, 0, 0, 0],
      misinformationBase: 0,
      falseContacts: false,
      pirates: { enabled: false },
      ...(endurance ? { endurance } : {}),
    },
  })
  const f = newCampaign(scenario, 'c-endurance')
  f.map.terrain = []
  return f
}

const ctxOf = (f: CampaignFile): DetectionContext => ({ map: f.map, scenario: f.scenario })

function round(f: CampaignFile): void {
  for (let i = 0; i < 16; i++) {
    const move: PhaseMove = {
      round: f.state.round,
      phase: f.state.phase,
      side: sideToMove(f.state.phase),
      interventions: [],
    }
    f.state = resolvePhase(ctxOf(f), f.state, move)
  }
}

describe('endurance dials', () => {
  it('defaults are the provisional numbers, and a partial override keeps the rest', () => {
    expect(resolveEndurance(undefined)).toBe(ENDURANCE_DEFAULTS)
    const cfg = resolveEndurance({ sensorBurn: 0, speedBurn: { emergency: 9 } })
    expect(cfg.sensorBurn).toBe(0)
    expect(cfg.baseBurn).toBe(ENDURANCE_DEFAULTS.baseBurn)
    expect(cfg.speedBurn.emergency).toBe(9)
    expect(cfg.speedBurn.maximum).toBe(ENDURANCE_DEFAULTS.speedBurn.maximum)
  })

  it('the tank multiplier scales the legs and the burns drain them', () => {
    const stock = file()
    const stockMax = stock.state.units[0].enduranceMax
    round(stock)
    // Holding with sensors at full power: base 1 + sensor 1.
    expect(stock.state.units[0].endurance).toBe(stockMax - 2)

    const tuned = file({ tankMultiplier: 2, sensorBurn: 0 })
    expect(tuned.state.units[0].enduranceMax).toBe(stockMax * 2)
    round(tuned)
    expect(tuned.state.units[0].endurance).toBe(stockMax * 2 - 1) // base burn only
  })
})
