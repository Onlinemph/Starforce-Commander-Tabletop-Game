import { describe, expect, it } from 'vitest'
import { DEFAULT_ORDER, blankScenario, newCampaign } from './file'
import { resolvePhase, type DetectionContext } from './turn'
import { viewFor } from './views'
import {
  sideToMove,
  type CampaignFile,
  type CampaignObjective,
  type PhaseMove,
  type ScenarioForceUnit,
} from './types'

/**
 * The objectives scaffold (objectives.ts): scenario data the round tick
 * judges and pays once. Four kinds the state can already tell — a station
 * destroyed, hulls killed, a system scouted, a hex held — each pinned here
 * on a hand-laid chart with detection dialed to zero.
 */

function ship(id: string, side: 'A' | 'B', q: number, r: number, order: Partial<typeof DEFAULT_ORDER> = {}): ScenarioForceUnit {
  return {
    id,
    kind: 'ship',
    name: id,
    ships: [side === 'A' ? 'union-nelson-ii-class-light-frigate' : 'vallari-v-6l-savage-class-light-cruiser'],
    hex: { q, r },
    order: { speed: 'hold', ...order },
  }
}

function file(objectives: CampaignObjective[], forces: { A?: ScenarioForceUnit[]; B?: ScenarioForceUnit[] }): CampaignFile {
  const scenario = blankScenario({
    mapSeed: 8,
    mapWidth: 30,
    mapHeight: 20,
    rounds: 20,
    forces: { A: forces.A ?? [], B: forces.B ?? [] },
    infrastructure: [{ id: 'b-outpost', side: 'B', kind: 'outpost', hex: { q: 20, r: 5 } }],
    objectives,
    tuning: {
      detectionCurve: [0, 0, 0, 0, 0, 0],
      misinformationBase: 0,
      falseContacts: false,
      sensorModel: { override: { detection: 0, intelligence: 0 } },
      pirates: { enabled: false },
    },
  })
  const f = newCampaign(scenario, 'c-objectives')
  f.map.terrain = [{ q: 14, r: 5, kind: 'system' }]
  return f
}

const ctxOf = (f: CampaignFile): DetectionContext => ({ map: f.map, scenario: f.scenario })

function round(f: CampaignFile, phases = 16): void {
  for (let i = 0; i < phases; i++) {
    const move: PhaseMove = {
      round: f.state.round,
      phase: f.state.phase,
      side: sideToMove(f.state.phase),
      interventions: [],
    }
    f.state = resolvePhase(ctxOf(f), f.state, move)
  }
}

describe('objectives', () => {
  it('scout-hex pays once when a unit enters the system, and the news says so', () => {
    const f = file(
      [{ id: 'a-scout', side: 'A', kind: 'scout-hex', hex: { q: 14, r: 5 }, vp: 5, text: 'Scout the Kappa system' }],
      { A: [ship('a-1', 'A', 10, 5, { speed: 'cruise', waypoints: [{ q: 14, r: 5 }] })] },
    )
    round(f)
    expect(f.state.units[0].hex).toEqual({ q: 14, r: 5 })
    expect(f.state.vp.A).toBe(5)
    expect(f.state.objectivesDone).toEqual(['a-scout'])
    expect(f.state.events.some((e) => /Objective achieved — Commander A: Scout the Kappa system/.test(e.text))).toBe(true)
    round(f)
    expect(f.state.vp.A).toBe(5) // paid once
  })

  it('hold-hex counts consecutive round ticks and resets when the hex is left', () => {
    const f = file(
      [{ id: 'a-hold', side: 'A', kind: 'hold-hex', hex: { q: 10, r: 5 }, count: 3, vp: 8, text: 'Hold the line' }],
      { A: [ship('a-1', 'A', 10, 5)] },
    )
    round(f)
    round(f)
    expect(f.state.objectiveProgress['a-hold']).toBe(2)
    expect(viewFor(f.map, f.state, 'A', f.scenario).objectives[0]).toMatchObject({ done: false, progress: 2, count: 3 })
    // Pulled off station for a round: the clock resets.
    f.state.units[0].hex = { q: 11, r: 5 }
    round(f)
    expect(f.state.objectiveProgress['a-hold']).toBe(0)
    f.state.units[0].hex = { q: 10, r: 5 }
    round(f)
    round(f)
    round(f)
    expect(f.state.vp.A).toBe(8)
    expect(viewFor(f.map, f.state, 'A', f.scenario).objectives[0].done).toBe(true)
  })

  it('destroy-station pays when the station falls, destroy-ships when the count is met', () => {
    const f = file(
      [
        { id: 'a-raze', side: 'A', kind: 'destroy-station', stationId: 'b-outpost', vp: 15, text: 'Raze the outpost' },
        { id: 'a-kills', side: 'A', kind: 'destroy-ships', count: 2, vp: 10, text: 'Destroy two hulls' },
      ],
      { A: [ship('a-1', 'A', 10, 5)] },
    )
    round(f)
    expect(f.state.vp.A).toBe(0)
    f.state.infrastructure[0].destroyed = true
    f.state.shipsLost.B = 1
    round(f)
    expect(f.state.vp.A).toBe(15)
    f.state.shipsLost.B = 2
    round(f)
    expect(f.state.vp.A).toBe(25)
    expect(f.state.objectivesDone).toEqual(['a-raze', 'a-kills'])
  })

  it('a side sees only its own objectives', () => {
    const f = file(
      [
        { id: 'a-x', side: 'A', kind: 'scout-hex', hex: { q: 14, r: 5 }, vp: 5, text: 'A goal' },
        { id: 'b-x', side: 'B', kind: 'scout-hex', hex: { q: 14, r: 5 }, vp: 5, text: 'B goal' },
      ],
      { A: [ship('a-1', 'A', 10, 5)] },
    )
    const viewA = viewFor(f.map, f.state, 'A', f.scenario)
    expect(viewA.objectives.map((o) => o.id)).toEqual(['a-x'])
    expect(JSON.stringify(viewA)).not.toContain('B goal')
  })
})
