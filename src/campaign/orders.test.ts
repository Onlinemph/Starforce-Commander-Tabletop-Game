import { describe, expect, it } from 'vitest'
import { DEFAULT_ORDER, blankScenario, newCampaign } from './file'
import { hexDistance } from './hexmap'
import { resolvePhase, type DetectionContext } from './turn'
import {
  sideToMove,
  type CampaignFile,
  type ContactRecord,
  type Intervention,
  type PhaseMove,
  type ScenarioForceUnit,
  type Side,
  type StandingOrder,
} from './types'

/**
 * The designer's orders list, resolver-side: Attack Nearest, Avoid Contact,
 * patrol loops, Raid/Assault on known enemy stations, and task-force
 * merge/split. Detection is dialed to zero so every hex and die in here is
 * the ORDER's doing, and contacts are laid by hand where a test needs one.
 */

const BLIND = { override: { detection: 0, intelligence: 0 } }

function shipAt(id: string, side: Side, q: number, r: number, order: Partial<StandingOrder> = {}): ScenarioForceUnit {
  return {
    id,
    kind: 'ship',
    name: id.toUpperCase(),
    ships: [side === 'A' ? 'union-nelson-ii-class-light-frigate' : 'vallari-v-6l-savage-class-light-cruiser'],
    hex: { q, r },
    order: { speed: 'hold', ...order },
  }
}

function ordersFile(
  forces: { A?: ScenarioForceUnit[]; B?: ScenarioForceUnit[] },
  infrastructure: CampaignFile['scenario']['infrastructure'] = [],
): CampaignFile {
  const scenario = blankScenario({
    mapSeed: 11,
    mapWidth: 40,
    mapHeight: 20,
    rounds: 20,
    forces: { A: forces.A ?? [], B: forces.B ?? [] },
    infrastructure,
    tuning: {
      detectionCurve: [0, 0, 0, 0, 0, 0],
      misinformationBase: 0,
      falseContacts: false,
      sensorModel: BLIND,
      pirates: { enabled: false },
    },
  })
  const file = newCampaign(scenario, 'c-orders')
  file.map.terrain = [] // clean space: movement owes no debts
  return file
}

const ctxOf = (file: CampaignFile): DetectionContext => ({ map: file.map, scenario: file.scenario })

/** Resolve phases; the interventions (if any) ride the first one — an A phase. */
function pass(file: CampaignFile, phases: number, interventions: Intervention[] = []): void {
  for (let i = 0; i < phases; i++) {
    const move: PhaseMove = {
      round: file.state.round,
      phase: file.state.phase,
      side: sideToMove(file.state.phase),
      interventions: i === 0 ? interventions : [],
    }
    file.state = resolvePhase(ctxOf(file), file.state, move)
  }
}

/** A hand-laid contact: what the side believes, shadowing nothing real. */
function plantContact(file: CampaignFile, side: Side, q: number, r: number, id = `ct-${side}-9`): void {
  const spotters = file.state.units.filter((u) => u.side === side).map((u) => u.id)
  const record: ContactRecord = {
    id,
    side,
    targetUnitId: `phantom-${side}-99`,
    track: 'tracked',
    attributes: { exists: { value: 'yes', truthful: false, resolvedAtRange: 2, stale: false } },
    estimatedHex: { q, r },
    positionEstimated: false,
    lastScan: { round: file.state.round, phase: file.state.phase },
    unscannedRounds: 0,
    course: null,
    observedMoving: false,
    // A side with no hulls plants a legacy record (no spotters field): an
    // empty list would be pruned as an orphan the very next phase.
    ...(spotters.length > 0 ? { spotters } : {}),
  }
  file.state.contacts.push(record)
}

const order = (patch: Partial<StandingOrder>): StandingOrder => ({
  ...structuredClone(DEFAULT_ORDER),
  ...patch,
})

describe('attack nearest', () => {
  it('steers at the nearest held contact, phase after phase', () => {
    const file = ordersFile({ A: [shipAt('a-hunter', 'A', 10, 5)] })
    plantContact(file, 'A', 16, 5)
    pass(file, 16, [
      { type: 'set-order', unitId: 'a-hunter', order: order({ speed: 'cruise', mission: { type: 'attack-nearest' } }) },
    ])
    const hunter = file.state.units.find((u) => u.id === 'a-hunter')!
    expect(hunter.hex).toEqual({ q: 14, r: 5 }) // cruise 4, dead on the line
    expect(hunter.order.mission).toEqual({ type: 'attack-nearest' }) // the posture stands
  })

  it('falls back to its waypoints when the scope is empty', () => {
    const file = ordersFile({
      A: [shipAt('a-hunter', 'A', 10, 5, { waypoints: [{ q: 13, r: 5 }] })],
    })
    pass(file, 16, [
      { type: 'set-order', unitId: 'a-hunter', order: order({ speed: 'cruise', waypoints: [{ q: 13, r: 5 }], mission: { type: 'attack-nearest' } }) },
    ])
    expect(file.state.units.find((u) => u.id === 'a-hunter')!.hex).toEqual({ q: 13, r: 5 })
  })
})

describe('avoid contact', () => {
  it('keeps a two-hex bubble around everything on the plot while still making way', () => {
    const file = ordersFile({
      A: [
        shipAt('a-freighter', 'A', 10, 5, {
          speed: 'cruise',
          waypoints: [{ q: 16, r: 5 }],
          avoidContact: true,
        }),
      ],
    })
    plantContact(file, 'A', 13, 5)
    const start = { q: 10, r: 5 }
    for (let i = 0; i < 32; i++) {
      pass(file, 1)
      const unit = file.state.units.find((u) => u.id === 'a-freighter')!
      expect(hexDistance(unit.hex, { q: 13, r: 5 })).toBeGreaterThan(2)
    }
    const unit = file.state.units.find((u) => u.id === 'a-freighter')!
    expect(hexDistance(unit.hex, { q: 16, r: 5 })).toBeLessThan(hexDistance(start, { q: 16, r: 5 }))
  })
})

describe('patrol loop', () => {
  it('a reached waypoint rejoins the route, so the circuit never runs out', () => {
    const file = ordersFile({
      A: [
        shipAt('a-picket', 'A', 10, 5, {
          speed: 'cruise',
          waypoints: [
            { q: 12, r: 5 },
            { q: 10, r: 5 },
          ],
          patrolLoop: true,
        }),
      ],
    })
    pass(file, 16 * 3)
    const picket = file.state.units.find((u) => u.id === 'a-picket')!
    expect(picket.order.waypoints).toHaveLength(2) // nothing crossed off
    expect(picket.hex.r).toBe(5)
    expect(picket.hex.q).toBeGreaterThanOrEqual(10)
    expect(picket.hex.q).toBeLessThanOrEqual(12)
    expect(picket.movedLastOwnPhase).toBe(true) // still on its rounds
  })
})

describe('raid and assault', () => {
  const outpost = [{ id: 'b-outpost', side: 'B' as Side, kind: 'outpost' as const, hex: { q: 14, r: 5 } }]

  it('a raid at the round tick: half value, station stands, mission spent', () => {
    const file = ordersFile({ A: [shipAt('a-raider', 'A', 12, 5)] }, outpost)
    pass(file, 16, [
      { type: 'set-order', unitId: 'a-raider', order: order({ speed: 'cruise', mission: { type: 'raid', stationId: 'b-outpost' } }) },
    ])
    expect(file.state.vp.A).toBe(2) // ceil(outpost 3 / 2)
    expect(file.state.infrastructure[0].destroyed).toBe(false)
    expect(file.state.units.find((u) => u.id === 'a-raider')!.order.mission).toBeUndefined()
    expect(file.state.events.some((e) => /raided/.test(e.text))).toBe(true)
  })

  it('an assault destroys the station for full value (3.4)', () => {
    const file = ordersFile({ A: [shipAt('a-raider', 'A', 12, 5)] }, outpost)
    pass(file, 16, [
      { type: 'set-order', unitId: 'a-raider', order: order({ speed: 'cruise', mission: { type: 'assault', stationId: 'b-outpost' } }) },
    ])
    expect(file.state.vp.A).toBe(3)
    expect(file.state.infrastructure[0].destroyed).toBe(true)
    expect(file.state.events.some((e) => /destroyed by assault/.test(e.text))).toBe(true)
  })

  it('a defender within a hex calls the strike off', () => {
    const file = ordersFile(
      { A: [shipAt('a-raider', 'A', 12, 5)], B: [shipAt('b-guard', 'B', 15, 5)] },
      outpost,
    )
    pass(file, 16, [
      { type: 'set-order', unitId: 'a-raider', order: order({ speed: 'cruise', mission: { type: 'raid', stationId: 'b-outpost' } }) },
    ])
    expect(file.state.vp.A).toBe(0)
    expect(file.state.infrastructure[0].destroyed).toBe(false)
    expect(file.state.events.some((e) => /called off — defenders on station/.test(e.text))).toBe(true)
  })
})

describe('task forces', () => {
  it('merge: hulls, spotter credit and the enemy dossier all follow the flag', () => {
    const file = ordersFile({
      A: [shipAt('a-1', 'A', 5, 5), shipAt('a-2', 'A', 5, 5)],
    })
    // A's own intel credited to the hull being absorbed…
    plantContact(file, 'A', 20, 5, 'ct-A-5')
    file.state.contacts[0].spotters = ['a-2']
    // …and the ENEMY's dossier on that hull.
    plantContact(file, 'B', 5, 5, 'ct-B-5')
    file.state.contacts[1].targetUnitId = 'a-2'

    pass(file, 2, [{ type: 'merge-units', unitId: 'a-2', intoId: 'a-1' }])
    expect(file.state.units.find((u) => u.id === 'a-2')).toBeUndefined()
    const flag = file.state.units.find((u) => u.id === 'a-1')!
    expect(flag.ships.map((s) => s.id)).toEqual(['a-1-s1', 'a-2-s1'])
    expect(flag.kind).toBe('group')
    expect(file.state.contacts.find((c) => c.id === 'ct-A-5')!.spotters).toEqual(['a-1'])
    expect(file.state.contacts.find((c) => c.id === 'ct-B-5')!.targetUnitId).toBe('a-1')
  })

  it('split: the named ships leave under the journaled new id', () => {
    const file = ordersFile({
      A: [shipAt('a-1', 'A', 5, 5), shipAt('a-2', 'A', 5, 5)],
    })
    pass(file, 2, [{ type: 'merge-units', unitId: 'a-2', intoId: 'a-1' }])
    pass(file, 2, [
      { type: 'split-unit', unitId: 'a-1', shipIds: ['a-2-s1'], newUnitId: 'a-1-d2' },
    ])
    const stay = file.state.units.find((u) => u.id === 'a-1')!
    const leave = file.state.units.find((u) => u.id === 'a-1-d2')!
    expect(stay.ships.map((s) => s.id)).toEqual(['a-1-s1'])
    expect(stay.kind).toBe('ship')
    expect(leave.ships.map((s) => s.id)).toEqual(['a-2-s1'])
    expect(leave.hex).toEqual(stay.hex)
    expect(leave.order.speed).toBe(stay.order.speed)
  })

  it('refuses the merges the rules forbid', () => {
    const apart = ordersFile({ A: [shipAt('a-1', 'A', 5, 5), shipAt('a-2', 'A', 9, 5)] })
    expect(() =>
      resolvePhase(ctxOf(apart), apart.state, {
        round: 1,
        phase: 1,
        side: 'A',
        interventions: [{ type: 'merge-units', unitId: 'a-2', intoId: 'a-1' }],
      }),
    ).toThrow(/share a hex/)

    const convoyFile = ordersFile({
      A: [
        shipAt('a-1', 'A', 5, 5),
        { ...shipAt('a-c', 'A', 5, 5), kind: 'convoy' as const },
      ],
    })
    expect(() =>
      resolvePhase(ctxOf(convoyFile), convoyFile.state, {
        round: 1,
        phase: 1,
        side: 'A',
        interventions: [{ type: 'merge-units', unitId: 'a-c', intoId: 'a-1' }],
      }),
    ).toThrow(/only ships and groups/)
  })
})
