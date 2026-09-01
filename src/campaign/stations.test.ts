import { describe, expect, it } from 'vitest'
import { DEFAULT_ORDER, blankScenario, newCampaign } from './file'
import { battleFileFor, shipKeys } from './handoff'
import { resolvePhase, type DetectionContext } from './turn'
import { viewFor } from './views'
import {
  sideToMove,
  type BattleResult,
  type CampaignFile,
  type PhaseMove,
  type ScenarioForceUnit,
} from './types'

/**
 * Stations with hulls (stations.ts): an outpost that names a hull is a
 * combatant. An enemy unit reaching its hex fights it on the table — the
 * station deploys at speed 0 — its damage lands on the infrastructure
 * record, its destruction pays the 3.4 table, and the raid/assault orders
 * read the guns' verdict instead of rolling a round-tick die.
 */

const OUTPOST = 'vallari-tortuga-ii-class-outpost'

function raiderFile(hex: { q: number; r: number }): CampaignFile {
  const raider: ScenarioForceUnit = {
    id: 'a-raider',
    kind: 'ship',
    name: 'USS Raider',
    ships: ['union-nelson-ii-class-light-frigate'],
    hex,
    order: { speed: 'hold' },
  }
  const scenario = blankScenario({
    mapSeed: 12,
    mapWidth: 30,
    mapHeight: 20,
    rounds: 20,
    forces: { A: [raider], B: [] },
    infrastructure: [{ id: 'b-outpost', side: 'B', kind: 'outpost', hex: { q: 14, r: 5 }, formId: OUTPOST }],
    objectives: [
      { id: 'a-raze', side: 'A', kind: 'destroy-station', stationId: 'b-outpost', vp: 10, text: 'Raze the outpost' },
    ],
    tuning: {
      detectionCurve: [0, 0, 0, 0, 0, 0],
      misinformationBase: 0,
      falseContacts: false,
      sensorModel: { override: { detection: 0, intelligence: 0 } },
      pirates: { enabled: false },
    },
  })
  const file = newCampaign(scenario, 'c-stations')
  file.map.terrain = []
  return file
}

const ctxOf = (f: CampaignFile): DetectionContext => ({ map: f.map, scenario: f.scenario })

/** One phase; a pending battle rides in with the result `verdict` fabricates. */
function phase(f: CampaignFile, verdict?: (keys: Record<'A' | 'B', string[]>) => BattleResult, interventions: PhaseMove['interventions'] = []): void {
  const battles: PhaseMove['battles'] = []
  for (const pending of f.state.pendingBattles) {
    if (!verdict) throw new Error(`battle ${pending.id} pending with no verdict`)
    const keys = { A: shipKeys(f.state, pending, 'A'), B: shipKeys(f.state, pending, 'B') }
    battles.push({ engagementId: pending.id, fileHash: 'test', result: verdict(keys) })
  }
  const move: PhaseMove = {
    round: f.state.round,
    phase: f.state.phase,
    side: sideToMove(f.state.phase),
    interventions,
    ...(battles.length > 0 ? { battles } : {}),
  }
  f.state = resolvePhase(ctxOf(f), f.state, move)
}

const scarred = (keys: Record<'A' | 'B', string[]>): BattleResult => ({
  ships: {
    [keys.A[0]]: { destroyed: false, disengaged: false, scars: null },
    [keys.B[0]]: {
      destroyed: false,
      disengaged: false,
      scars: { structure: 1, reactors: {}, batteries: [], ftl: 0, systems: {}, scout: 0, shieldGenerator: 0, armor: { F: 0, S: 0, A: 0, P: 0 }, mounts: {} },
    },
  },
  vp: { A: 0, B: 0 },
})

const razed = (keys: Record<'A' | 'B', string[]>): BattleResult => ({
  ships: {
    [keys.A[0]]: { destroyed: false, disengaged: false, scars: null },
    [keys.B[0]]: { destroyed: true, disengaged: false, scars: null },
  },
  vp: { A: 0, B: 0 },
})

describe('a station with a hull', () => {
  it('fights: an enemy in its hex triggers an engagement that deploys it at speed 0', () => {
    const f = raiderFile({ q: 14, r: 5 })
    phase(f) // A's phase 1: the raider stands on the outpost
    expect(f.state.pendingBattles).toHaveLength(1)
    const engagement = f.state.pendingBattles[0]
    expect(engagement.unitIds.B).toEqual(['b-outpost'])
    expect(engagement.unitIds.A).toEqual(['a-raider'])
    expect(shipKeys(f.state, engagement, 'B')).toEqual(['b-outpost/b-outpost-s1'])

    const battle = battleFileFor(ctxOf(f), f.state, f.campaignId, engagement)
    const beta = battle.setup.customScenario!.sides.find((s) => s.side === 'Beta Command')!
    expect(beta.force).toEqual([OUTPOST])
    expect(beta.speeds).toEqual([0])
    const alpha = battle.setup.customScenario!.sides.find((s) => s.side === 'Alpha Command')!
    expect(alpha.speeds).toEqual([4])
  })

  it('keeps its scars between battles, and a raid pays once it has been bloodied', () => {
    const f = raiderFile({ q: 14, r: 5 })
    phase(f, undefined, [
      { type: 'set-order', unitId: 'a-raider', order: { ...structuredClone(DEFAULT_ORDER), speed: 'hold', mission: { type: 'raid', stationId: 'b-outpost' } } },
    ])
    // Every phase the raider stays under the guns is another battle; the
    // fabricated verdicts leave the outpost standing but marked.
    for (let i = 0; i < 15; i++) phase(f, scarred)
    const outpost = f.state.infrastructure[0]
    expect(outpost.destroyed).toBe(false)
    expect(outpost.scars?.structure).toBe(1)
    // The round tick: bloodied, so the raid paid half an outpost (2 of 3).
    expect(f.state.vp.A).toBe(2)
    expect(f.state.units[0].order.mission).toBeUndefined()
    expect(f.state.events.some((e) => /raided under its own guns/.test(e.text))).toBe(true)
    // The enemy's charts show the class, never the damage.
    const seen = viewFor(f.map, f.state, 'A', f.scenario).knownEnemyInfrastructure[0]
    expect(seen.formId).toBe(OUTPOST)
    expect('scars' in seen).toBe(false)
  })

  it('destroyed in battle: the record dies, the 3.4 table pays, the objective follows', () => {
    const f = raiderFile({ q: 14, r: 5 })
    phase(f)
    phase(f, razed)
    const outpost = f.state.infrastructure[0]
    expect(outpost.destroyed).toBe(true)
    expect(f.state.vp.A).toBe(3) // an outpost, 3.4
    expect(f.state.events.some((e) => /destroyed in battle/.test(e.text))).toBe(true)
    // No more engagements in the hex: the guns are gone.
    for (let i = 0; i < 14; i++) phase(f)
    expect(f.state.pendingBattles).toHaveLength(0)
    // The round tick judged the objective too.
    expect(f.state.objectivesDone).toEqual(['a-raze'])
    expect(f.state.vp.A).toBe(13)
  })

  it('an abstract station (no hull) still resolves at the round tick as before', () => {
    const f = raiderFile({ q: 14, r: 5 })
    delete f.state.infrastructure[0].formId
    phase(f, undefined, [
      { type: 'set-order', unitId: 'a-raider', order: { ...structuredClone(DEFAULT_ORDER), speed: 'hold', mission: { type: 'assault', stationId: 'b-outpost' } } },
    ])
    expect(f.state.pendingBattles).toHaveLength(0)
    for (let i = 0; i < 15; i++) phase(f)
    expect(f.state.infrastructure[0].destroyed).toBe(true)
    expect(f.state.vp.A).toBe(3 + 10) // the 3.4 table, then the objective at the same tick
  })
})
