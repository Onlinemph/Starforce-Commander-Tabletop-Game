import { describe, expect, it } from 'vitest'
import { blankScenario, newCampaign } from '../campaign/file'
import { allHexes, hexDistance, hexEquals } from '../campaign/hexmap'
import { orderedSpeed } from '../campaign/logistics'
import { resolvePhase } from '../campaign/turn'
import {
  hexCenter,
  pixelToHex,
  routeEntryPhases,
  stageOrder,
  stagedOrderFor,
  waypointRounds,
  type RouteStep,
} from './helpers'
import {
  sideToMove,
  type CampaignFile,
  type CampaignMap,
  type Intervention,
  type PhaseMove,
  type StandingOrder,
} from '../campaign/types'

describe('campaign map geometry', () => {
  it('pixelToHex inverts hexCenter across the whole board', () => {
    for (const h of allHexes(20, 16)) {
      const c = hexCenter(h, 14)
      expect(pixelToHex(c.x, c.y, 14)).toEqual(h)
    }
  })

  it('a click near a hex edge still lands on one of the two neighbors', () => {
    const a = hexCenter({ q: 3, r: 4 }, 14)
    const b = hexCenter({ q: 4, r: 4 }, 14)
    const mid = pixelToHex((a.x + b.x) / 2 + 0.01, (a.y + b.y) / 2, 14)
    expect(hexDistance(mid, { q: 3, r: 4 })).toBeLessThanOrEqual(1)
    expect(hexDistance(mid, { q: 4, r: 4 })).toBeLessThanOrEqual(1)
  })
})

describe('waypoint ETAs', () => {
  const flat: CampaignMap = { width: 20, height: 16, terrain: [], border: [] }

  it('counts cumulative rounds at the ordered pace, one leg after another', () => {
    // 8 hexes at 4 a round is 2 rounds; the first waypoint 4 in lands at 1.
    expect(waypointRounds(flat, { q: 0, r: 0 }, [{ q: 4, r: 0 }, { q: 8, r: 0 }], 4)).toEqual([1, 2])
    // A leg the speed does not divide rounds UP — half-finished is not arrived.
    expect(waypointRounds(flat, { q: 0, r: 0 }, [{ q: 5, r: 0 }], 4)).toEqual([2])
  })

  it('charges nebula and dust hexes double, the resolver’s own entry cost', () => {
    const misty: CampaignMap = {
      ...flat,
      terrain: [
        { q: 1, r: 0, kind: 'nebula' },
        { q: 2, r: 0, kind: 'dust' },
      ],
    }
    // 2 + 2 + 1 = 5 credits to (3,0): at speed 2 that is 3 rounds, not 2.
    expect(waypointRounds(misty, { q: 0, r: 0 }, [{ q: 3, r: 0 }], 2)).toEqual([3])
    expect(waypointRounds(flat, { q: 0, r: 0 }, [{ q: 3, r: 0 }], 2)).toEqual([2])
  })

  it('a unit making no way has no ETA', () => {
    expect(waypointRounds(flat, { q: 0, r: 0 }, [{ q: 4, r: 0 }], 0)).toEqual([])
  })
})

describe('route entry phases', () => {
  function patrolFile(): CampaignFile {
    const scenario = blankScenario({
      mapSeed: 9,
      mapWidth: 20,
      mapHeight: 16,
      rounds: 20,
      forces: {
        A: [
          {
            id: 'a-1',
            kind: 'ship',
            name: 'Pathfinder',
            ships: ['union-yorktown-i-class-heavy-cruiser'],
            hex: { q: 2, r: 8 },
            order: { speed: 'hold' },
          },
        ],
        B: [
          {
            id: 'b-1',
            kind: 'ship',
            name: 'Bystander',
            ships: ['vallari-v-6l-savage-class-light-cruiser'],
            hex: { q: 18, r: 0 },
            order: { speed: 'hold' },
          },
        ],
      },
      tuning: { detectionCurve: [0, 0, 0, 0, 0, 0], misinformationBase: 0, falseContacts: false },
    })
    const file = newCampaign(scenario, 'c-route')
    file.map.terrain = []
    return file
  }

  function pass(file: CampaignFile): void {
    const move: PhaseMove = {
      round: file.state.round,
      phase: file.state.phase,
      side: sideToMove(file.state.phase),
      interventions: [],
    }
    file.state = resolvePhase({ map: file.map, scenario: file.scenario }, file.state, move)
  }

  it('predicts exactly the phase the resolver enters each hex, slow terrain included', () => {
    const file = patrolFile()
    // A nebula astride the route: entering it owes a second movement credit.
    file.map.terrain = [{ q: 5, r: 8, kind: 'nebula' }]
    const a = file.state.units.find((u) => u.id === 'a-1')!
    a.order.waypoints = [{ q: 10, r: 8 }]
    a.order.speed = 'cruise'
    a.order.exactSpeed = 3

    const predicted = routeEntryPhases(
      file.map,
      a,
      a.order.waypoints,
      orderedSpeed(a),
      file.state.phase,
    )
    expect(predicted).toHaveLength(8)
    expect(predicted.map((s) => s.hex.q)).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    // Monotone, and the nebula's exit is delayed by the owed credit.
    for (let i = 1; i < predicted.length; i++) {
      expect(predicted[i].phases).toBeGreaterThan(predicted[i - 1].phases)
    }

    // The gold standard: the resolver itself, phase by phase.
    const actual: RouteStep[] = []
    let count = 0
    let prev = { ...a.hex }
    for (let i = 0; i < 200 && actual.length < predicted.length; i++) {
      pass(file)
      count += 1
      const now = file.state.units.find((u) => u.id === 'a-1')!.hex
      if (!hexEquals(now, prev)) {
        actual.push({ hex: { ...now }, phases: count })
        prev = { ...now }
      }
    }
    expect(actual).toEqual(predicted)
  })

  it('the numbers move with the speed, and a hold has none', () => {
    const file = patrolFile()
    const a = file.state.units.find((u) => u.id === 'a-1')!
    const waypoints = [{ q: 8, r: 8 }]
    const slow = routeEntryPhases(file.map, a, waypoints, 2, file.state.phase)
    const fast = routeEntryPhases(file.map, a, waypoints, 6, file.state.phase)
    expect(slow).toHaveLength(6)
    expect(fast).toHaveLength(6)
    expect(fast[5].phases).toBeLessThan(slow[5].phases)
    expect(routeEntryPhases(file.map, a, waypoints, 0, file.state.phase)).toEqual([])
  })
})

describe('intervention staging (5.2)', () => {
  const order = (speed: StandingOrder['speed']): StandingOrder => ({
    waypoints: [],
    speed,
    sensorPower: 1,
    cloaked: false,
    formation: 'standard',
  })

  it('keeps one set-order per unit, last edit winning', () => {
    let pending: Intervention[] = []
    pending = stageOrder(pending, 'u-1', order('cruise'))
    pending = stageOrder(pending, 'u-2', order('hold'))
    pending = stageOrder(pending, 'u-1', order('hold'))
    expect(pending).toHaveLength(2)
    expect(stagedOrderFor(pending, 'u-1')?.speed).toBe('hold')
    expect(stagedOrderFor(pending, 'u-2')?.speed).toBe('hold')
    expect(stagedOrderFor(pending, 'u-3')).toBeNull()
  })
})
