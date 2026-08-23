import { describe, expect, it } from 'vitest'
import { blankScenario, newCampaign, replayCampaign } from './file'
import { battleFileFor, hashText, readback } from './handoff'
import { playBattle, playedBattleFile } from '../engine/selfPlay'
import { quickResolve, temperamentOf } from './quickResolve'
import { unitIsCloaked } from './detection'
import { effectiveSpeedTier, orderSpeedCap, orderedSpeed, unitSpeedCap, unitSpeedTiers } from './logistics'
import { LAUNCH_SCENARIOS, raidOnDeltaVideus } from './scenarios'
import { PhaseError, resolvePhase, type DetectionContext } from './turn'
import { viewFor } from './views'
import { hexDistance } from './hexmap'
import { sideToMove, type CampaignFile, type PhaseMove } from './types'
import type { QuickResolved as QR } from './quickResolve'

/**
 * Operations (build Phase 4): endurance, convoys, reinforcements, victory,
 * wings, and Quick Resolve — with the wall's leak tests carried forward.
 */

const CERTAIN = [1, 1, 1, 1, 1, 1]
const BLIND = [0, 0, 0, 0, 0, 0]

const ctxOf = (file: CampaignFile): DetectionContext => ({ map: file.map, scenario: file.scenario })

function pass(file: CampaignFile, battles?: PhaseMove['battles']): void {
  const move: PhaseMove = {
    round: file.state.round,
    phase: file.state.phase,
    side: sideToMove(file.state.phase),
    interventions: [],
    ...(battles ? { battles } : {}),
  }
  file.state = resolvePhase(ctxOf(file), file.state, move)
  file.journal.push(move)
}

function passRound(file: CampaignFile): void {
  for (let i = 0; i < 16; i++) pass(file)
}

function opsFile(over: Partial<Parameters<typeof blankScenario>[0]> = {}): CampaignFile {
  const scenario = blankScenario({
    mapSeed: 21,
    mapWidth: 24,
    mapHeight: 20,
    rounds: 20,
    forces: {
      A: [
        {
          id: 'a-1',
          kind: 'ship',
          name: 'USS Steady',
          ships: ['union-yorktown-i-class-heavy-cruiser'],
          hex: { q: 4, r: 8 },
          order: { speed: 'hold' },
        },
      ],
      B: [
        {
          id: 'b-1',
          kind: 'ship',
          name: 'AMV Wisp',
          ships: ['aurelian-corvus-i-class-destroyer'],
          hex: { q: 20, r: 2 },
          order: { speed: 'hold' },
        },
      ],
    },
    tuning: { detectionCurve: BLIND, misinformationBase: 0, falseContacts: false },
    ...over,
  })
  const file = newCampaign(scenario, 'c-ops')
  file.map.terrain = []
  return file
}

describe('endurance (6.4)', () => {
  it('burns one a round at cruise, one more cloaked, one more at full sensors', () => {
    const file = opsFile()
    const a = () => file.state.units.find((u) => u.id === 'a-1')!
    const b = () => file.state.units.find((u) => u.id === 'b-1')!
    expect(a().endurance).toBe(a().enduranceMax)
    b().order.cloaked = true
    a().order.sensorPower = 2
    const aStart = a().endurance
    const bStart = b().endurance
    passRound(file)
    expect(a().endurance).toBe(aStart - 2) // baseline + hungry sensors
    expect(b().endurance).toBe(bStart - 2) // baseline + cloaked running
  })

  it('a depot refills whoever ends the round alongside it (3.4)', () => {
    const file = opsFile()
    file.state.infrastructure.push({
      id: 'a-outpost',
      side: 'A',
      kind: 'outpost',
      hex: { q: 4, r: 8 },
      destroyed: false,
    })
    passRound(file)
    const a = file.state.units.find((u) => u.id === 'a-1')!
    expect(a.endurance).toBe(a.enduranceMax)
    // The enemy's outpost feeds nobody else.
    const b = file.state.units.find((u) => u.id === 'b-1')!
    expect(b.endurance).toBe(b.enduranceMax - 1)
  })

  it('the flogged tiers drink: maximum and emergency running burn the tank', () => {
    const file = opsFile()
    const a = () => file.state.units.find((u) => u.id === 'a-1')!
    a().order.speed = 'maximum'
    const start = a().endurance
    passRound(file)
    expect(a().endurance).toBe(start - 4) // baseline 1 + maximum's 3

    const emergency = opsFile()
    const e = () => emergency.state.units.find((u) => u.id === 'a-1')!
    e().order.speed = 'emergency'
    const eStart = e().endurance
    passRound(emergency)
    expect(e().endurance).toBe(eStart - 6) // baseline 1 + emergency's 5
  })

  it('a dry tank caps the speed at cruise — the limp home', () => {
    const file = opsFile()
    const a = file.state.units.find((u) => u.id === 'a-1')!
    a.order.speed = 'emergency'
    a.endurance = 0
    // Effective tier reads cruise: the burn is base-only and no wear rolls.
    passRound(file)
    const after = file.state.units.find((u) => u.id === 'a-1')!
    expect(after.endurance).toBe(0)
    expect(after.ships[0].scars).toBeUndefined()
  })

  it('a dry tank grounds the cloak (6.4)', () => {
    const file = opsFile()
    const b = file.state.units.find((u) => u.id === 'b-1')!
    b.order.cloaked = true
    expect(unitIsCloaked(b)).toBe(true)
    b.endurance = 0
    expect(unitIsCloaked(b)).toBe(false)
  })
})

describe('emergency wear (the designer: ships can break down at this speed)', () => {
  it('sustained emergency running eventually marks the drives, and the wear slows the ship', () => {
    const file = opsFile()
    const a = () => file.state.units.find((u) => u.id === 'a-1')!
    const fresh = unitSpeedTiers(a())
    a().order.speed = 'emergency'
    // Deterministic under the campaign stream: run rounds until the odds
    // land (an outpost keeps the tank wet so emergency stays effective).
    file.state.infrastructure.push({
      id: 'a-depot',
      side: 'A',
      kind: 'outpost',
      hex: { q: 4, r: 8 },
      destroyed: false,
    })
    let wore = false
    for (let round = 0; round < 20 && !wore; round++) {
      passRound(file)
      a().order.speed = 'emergency' // battle results never reset it; keep the throttle down
      wore = (a().ships[0].scars?.ftl ?? 0) > 0
    }
    expect(wore).toBe(true)
    const slowed = unitSpeedTiers(a())
    expect(slowed.maximum).toBeLessThan(fresh.maximum)
  })
})

describe('reinforcements (S3.2)', () => {
  function relief() {
    return opsFile({
      forces: {
        A: [
          { id: 'a-1', kind: 'ship', name: 'USS Steady', ships: ['union-yorktown-i-class-heavy-cruiser'], hex: { q: 4, r: 8 }, order: { speed: 'hold' } },
          { id: 'a-late', kind: 'ship', name: 'USS Latecomer', ships: ['union-kursk-i-class-battlecruiser'], hex: { q: 2, r: 9 }, arrivesRound: 3 },
        ],
        B: [{ id: 'b-1', kind: 'ship', name: 'AMV Wisp', ships: ['aurelian-corvus-i-class-destroyer'], hex: { q: 20, r: 2 }, order: { speed: 'hold' } }],
      },
    })
  }

  it('held off the map until its round, then it simply exists', () => {
    const file = relief()
    expect(file.state.units.some((u) => u.id === 'a-late')).toBe(false)
    passRound(file) // → round 2
    expect(file.state.units.some((u) => u.id === 'a-late')).toBe(false)
    passRound(file) // → round 3
    expect(file.state.units.some((u) => u.id === 'a-late')).toBe(true)
    expect(file.state.reinforcements).toHaveLength(0)
  })

  it('your schedule is in your view; theirs is nowhere in yours — the leak test', () => {
    const file = relief()
    const own = viewFor(file.map, file.state, 'A')
    expect(own.incoming).toEqual([
      { unitId: 'a-late', arrivesRound: 3, kind: 'ship', shipCount: 1 },
    ])
    const enemy = viewFor(file.map, file.state, 'B')
    expect(enemy.incoming).toEqual([])
    const bytes = JSON.stringify(enemy)
    expect(bytes).not.toContain('a-late')
    expect(bytes).not.toContain('Latecomer')
    expect(bytes).not.toContain('kursk')
  })

  it('an arrived reinforcement is found like anything else: through the fog', () => {
    const file = relief()
    passRound(file)
    passRound(file) // a-late is on the map now
    const enemy = viewFor(file.map, file.state, 'B')
    // Blind curve: on the map, still invisible.
    expect(JSON.stringify(enemy)).not.toContain('a-late')
  })
})

describe('convoys and victory (6.3, 10.1)', () => {
  function shipping() {
    return opsFile({
      vpThreshold: 10,
      forces: {
        A: [
          {
            id: 'a-convoy',
            kind: 'convoy',
            name: 'Convoy One',
            ships: ['union-nelson-i-class-light-frigate', 'union-nelson-i-class-light-frigate'],
            hex: { q: 4, r: 8 },
            order: { waypoints: [{ q: 12, r: 6 }] },
            deliverHex: { q: 12, r: 6 },
            deliveryVp: 12,
          },
        ],
        B: [{ id: 'b-1', kind: 'ship', name: 'AMV Wisp', ships: ['aurelian-corvus-i-class-destroyer'], hex: { q: 22, r: 0 }, order: { speed: 'hold' } }],
      },
    })
  }

  it('a delivery banks its points, ends a threshold campaign, and clears the board', () => {
    const file = shipping()
    for (let round = 0; round < 6 && !file.state.finished; round++) passRound(file)
    expect(file.state.vp.A).toBe(12)
    expect(file.state.units.some((u) => u.id === 'a-convoy')).toBe(false)
    expect(file.state.finished).toBe(true)
    expect(file.state.winner).toBe('A')
  })

  it('a beacon chain adds a hex a round (6.3)', () => {
    // Walk the flat run first to learn where the convoy ends its round, then
    // put the beacon exactly there for the chained run: same steps, same
    // spot, and the only difference between the two rounds is the chain.
    const route = [{ q: 20, r: 2 }]
    const flat = shipping()
    flat.scenario.vpThreshold = undefined
    flat.state.units.find((u) => u.id === 'a-convoy')!.order.waypoints = structuredClone(route)
    passRound(flat)
    const start = { q: 4, r: 8 }
    const restStop = flat.state.units.find((u) => u.id === 'a-convoy')!.hex

    const chained = shipping()
    chained.scenario.vpThreshold = undefined
    chained.state.units.find((u) => u.id === 'a-convoy')!.order.waypoints = structuredClone(route)
    chained.state.infrastructure.push({
      id: 'bcn-1',
      side: 'A',
      kind: 'jump-beacon',
      hex: { ...restStop },
      destroyed: false,
    })
    passRound(chained)
    const rode = hexDistance(start, chained.state.units.find((u) => u.id === 'a-convoy')!.hex)
    const walked = hexDistance(start, restStop)
    expect(rode).toBe(walked + 1)
  })

  it('the round limit settles the winner from the ledger', () => {
    const file = opsFile({ rounds: 1 })
    file.state.roundLimit = 1
    file.state.vp.B = 7
    passRound(file)
    expect(file.state.finished).toBe(true)
    expect(file.state.winner).toBe('B')
  })
})

describe('the map edge walls a battle retreat', () => {
  it('a disengager already on the western edge holds rather than leaving the chart', () => {
    const file = opsFile()
    const a = file.state.units.find((u) => u.id === 'a-1')!
    a.hex = { q: 0, r: 8 }
    file.state.pendingBattles.push({
      id: 'eng-edge',
      hex: { q: 0, r: 8 },
      round: file.state.round,
      phase: file.state.phase,
      unitIds: { A: ['a-1'], B: [] },
      ambushBy: null,
      caughtRetreating: null,
    })
    pass(file, [
      {
        engagementId: 'eng-edge',
        fileHash: 'test',
        result: {
          ships: { 'a-1/a-1-s1': { destroyed: false, disengaged: true, scars: null } },
          vp: { A: 0, B: 0 },
        },
      },
    ])
    expect(file.state.units.find((u) => u.id === 'a-1')!.hex).toEqual({ q: 0, r: 8 })
  })
})

describe('quick resolve (Part 8)', () => {
  function collision() {
    const file = opsFile({ tuning: { detectionCurve: CERTAIN, misinformationBase: 0, falseContacts: false } })
    const b = file.state.units.find((u) => u.id === 'b-1')!
    b.hex = { q: 5, r: 8 }
    pass(file) // scans land
    file.state.units.find((u) => u.id === 'b-1')!.hex = { ...file.state.units.find((u) => u.id === 'a-1')!.hex }
    pass(file) // engagement
    expect(file.state.pendingBattles).toHaveLength(1)
    return file
  }

  it('the parity test: quick equals played-with-both-AI, byte for byte', () => {
    const file = collision()
    const engagement = file.state.pendingBattles[0]
    const quick = quickResolve(ctxOf(file), file.state, file.campaignId, engagement, {
      difficulty: 'captain',
      rounds: 8,
    })
    expect(typeof quick).not.toBe('string')
    const q = quick as QR

    // The played path, by hand, same knobs.
    const battle = battleFileFor(ctxOf(file), file.state, file.campaignId, engagement)
    const played = playBattle(battle.setup, {
      difficulty: 'captain',
      rounds: 8,
      retreats: true,
      personality: { 'Alpha Command': 'steady', 'Beta Command': 'steady' },
    })
    const result = readback(file.state, engagement, JSON.stringify(playedBattleFile(battle.setup, played)))
    expect(JSON.stringify(q.record.result)).toBe(JSON.stringify(result))
    expect(q.record.fileHash).toBe(hashText(JSON.stringify(battle)))

    // And the record lands like any table-fought one. (Survivors standing
    // in a shared hex re-engage at once — the fight continues next phase —
    // so the assertion is that THIS battle is settled, not that the hex is
    // quiet.)
    pass(file, [q.record])
    expect(file.state.pendingBattles.some((p) => p.id === engagement.id)).toBe(false)
    // The quick battle file replays in the theater — it is a real battle.
    expect(JSON.parse(q.battleText).actions.length).toBeGreaterThan(0)
  })

  it('temperament follows posture', () => {
    const file = collision()
    const units = file.state.units.filter((u) => u.side === 'A')
    expect(temperamentOf(units)).toBe('steady')
    units[0].order.mission = { type: 'intercept', contactId: 'x' }
    expect(temperamentOf(units)).toBe('aggressive')
    units[0].order.mission = undefined
    units[0].order.engagement = 'withdraw'
    expect(temperamentOf(units)).toBe('cautious')
  })
})

describe('the launch scenarios (10.2)', () => {
  it('all three open, and their campaigns replay', () => {
    for (const { id, build } of LAUNCH_SCENARIOS) {
      const file = newCampaign(build(), `c-${id}`)
      expect(file.state.units.length, id).toBeGreaterThan(2)
      for (let i = 0; i < 6; i++) pass(file)
      expect(JSON.stringify(replayCampaign(file)), id).toBe(JSON.stringify(file.state))
    }
  })

  it('the raid ships a convoy with a route, a prize, and pickets to run', () => {
    const raid = raidOnDeltaVideus()
    const convoy = raid.forces.A.find((f) => f.kind === 'convoy')!
    expect(convoy.deliverHex).toBeDefined()
    expect(convoy.deliveryVp).toBeGreaterThan(0)
    expect(raid.forces.B.every((f) => f.ships.length > 0)).toBe(true)
  })
})

describe('the wall, operations edition', () => {
  it('a rearming wing is your ship’s business, not the enemy dossier’s', () => {
    const file = opsFile()
    const b = file.state.units.find((u) => u.id === 'b-1')!
    b.ships[0].wing = { cardId: 'strix', readiness: 'rearming', rearmRounds: 2 }
    const enemyView = viewFor(file.map, file.state, 'A')
    const bytes = JSON.stringify(enemyView)
    expect(bytes).not.toContain('rearming')
    expect(bytes).not.toContain('strix')
    const ownView = viewFor(file.map, file.state, 'B')
    expect(ownView.units[0].ships[0].wing?.readiness).toBe('rearming')
  })

  it('endurance is your own gauge: contacts carry no tank readings', () => {
    const file = opsFile({ tuning: { detectionCurve: CERTAIN, misinformationBase: 0, falseContacts: false } })
    file.state.units.find((u) => u.id === 'b-1')!.hex = { q: 6, r: 8 } // in scan range
    pass(file)
    const view = viewFor(file.map, file.state, 'A')
    expect(view.contacts.length).toBeGreaterThan(0)
    expect(JSON.stringify(view.contacts)).not.toContain('endurance')
    expect(view.units.every((u) => typeof u.endurance === 'number')).toBe(true)
  })
})

describe("exact speed orders (the designer's specific-speeds note)", () => {
  it('an exact speed overrides the tier and reads as the tier its number lands in', () => {
    const file = opsFile()
    const a = file.state.units.find((u) => u.id === 'a-1')!
    // Yorktown I: cruise 4, max cruise 6, maximum 9, emergency 10.
    expect(unitSpeedTiers(a)).toEqual({ cruise: 4, maxCruise: 6, maximum: 9, emergency: 10 })

    a.order = { ...a.order, speed: 'emergency', exactSpeed: 5 }
    expect(orderedSpeed(a)).toBe(5)
    expect(effectiveSpeedTier(a)).toBe('max-cruise') // burns and glows like the pace made

    a.order = { ...a.order, exactSpeed: 0 }
    expect(effectiveSpeedTier(a)).toBe('hold')

    a.order = { ...a.order, exactSpeed: 10 }
    expect(effectiveSpeedTier(a)).toBe('emergency')

    // Defense in depth: a number smuggled past validation still clamps.
    a.order = { ...a.order, exactSpeed: 99 }
    expect(orderedSpeed(a)).toBe(10)
  })

  it('the chosen tier is the ceiling: an exact speed never outruns it', () => {
    const file = opsFile()
    const a = file.state.units.find((u) => u.id === 'a-1')!
    // Cruise authorizes 4; an exact 6 clamps to it, and the resolver refuses.
    a.order = { ...a.order, speed: 'cruise', exactSpeed: 6 }
    expect(orderSpeedCap(a)).toBe(4)
    expect(orderedSpeed(a)).toBe(4)
    expect(() =>
      resolvePhase(ctxOf(file), file.state, {
        round: file.state.round,
        phase: file.state.phase,
        side: 'A',
        interventions: [
          { type: 'set-order', unitId: 'a-1', order: { ...a.order, speed: 'cruise', exactSpeed: 6 } },
        ],
      }),
    ).toThrow(/exceeds cruise/)
    // Under Hold the number stands on its own — the earliest exact-speed
    // build saved orders in that shape, and stranding them broke patrols.
    a.order = { ...a.order, speed: 'hold', exactSpeed: 3 }
    expect(orderedSpeed(a)).toBe(3)
    expect(effectiveSpeedTier(a)).toBe('cruise')
  })

  it('a mission whose contact faded clears, and the unit resumes its waypoints', () => {
    const file = opsFile()
    const a = file.state.units.find((u) => u.id === 'a-1')!
    const start = { ...a.hex }
    file.state.contacts.push({
      id: 'ct-A-9',
      side: 'A',
      targetUnitId: 'b-1',
      attributes: { exists: { value: 'yes', truthful: true, resolvedAtRange: 2, stale: false } },
      estimatedHex: { q: start.q, r: Math.max(0, start.r - 6) },
      positionEstimated: true,
      lastScan: { round: 1, phase: 1 },
      unscannedRounds: 3, // collapsed: the trail is already cold
      course: null,
      observedMoving: false,
    })
    a.order = {
      ...a.order,
      speed: 'cruise',
      waypoints: [{ q: start.q + 8, r: start.r }],
      mission: { type: 'intercept', contactId: 'ct-A-9' },
    }
    passRound(file)
    const after = file.state.units.find((u) => u.id === 'a-1')!
    expect(after.order.mission).toBeUndefined()
    expect(after.hex.q).toBeGreaterThan(start.q) // back on its plotted route
  })

  it('the resolver refuses an exact speed beyond the envelope', () => {
    const file = opsFile()
    const a = file.state.units.find((u) => u.id === 'a-1')!
    expect(() =>
      resolvePhase(ctxOf(file), file.state, {
        round: file.state.round,
        phase: file.state.phase,
        side: 'A',
        interventions: [
          { type: 'set-order', unitId: 'a-1', order: { ...a.order, exactSpeed: 11 } },
        ],
      }),
    ).toThrow(PhaseError)
  })

  it('civilian hulls run 1-3, by the merchant (his note)', () => {
    const file = opsFile()
    const a = file.state.units.find((u) => u.id === 'a-1')!
    a.kind = 'convoy'
    // A Yorktown-hulled stand-in freighter cruises at 4: the cap reads 3.
    expect(unitSpeedCap(a)).toBe(3)
    a.order = { ...a.order, speed: 'cruise', exactSpeed: 5 }
    expect(orderedSpeed(a)).toBe(3)
    expect(() =>
      resolvePhase(ctxOf(file), file.state, {
        round: file.state.round,
        phase: file.state.phase,
        side: 'A',
        interventions: [
          { type: 'set-order', unitId: 'a-1', order: { ...a.order, speed: 'cruise', exactSpeed: 5 } },
        ],
      }),
    ).toThrow(/civilian hulls run/)
  })

  it('an exact speed moves exactly that many hexes a round', () => {
    const file = opsFile()
    const a = file.state.units.find((u) => u.id === 'a-1')!
    const start = { ...a.hex }
    a.order = { ...a.order, speed: 'cruise', exactSpeed: 2, waypoints: [{ q: 20, r: 4 }] }
    passRound(file)
    const moved = file.state.units.find((u) => u.id === 'a-1')!
    expect(hexDistance(start, moved.hex)).toBe(2)
  })
})
