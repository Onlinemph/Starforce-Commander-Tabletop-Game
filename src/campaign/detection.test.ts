import { describe, expect, it } from 'vitest'
import { reckonedHex, trueAttribute, unitProfile } from './detection'
import { blankScenario, newCampaign } from './file'
import { hexDistance } from './hexmap'
import { resolvePhase, PhaseError, type DetectionContext } from './turn'
import { sideToMove, type CampaignFile, type ContactAttribute, type PhaseMove } from './types'

/**
 * Detection under the designer's sensor model (sensorModel.ts, which carries
 * its own §17 validation suite): here the fog itself — track states, the
 * ladder, the lies, the decay, the ghosts — made deterministic by the model's
 * own override dial (10.3): probabilities of always or never instead of
 * chances, a misinformation rate of always or never.
 */

// ---------------------------------------------------------------------------
// The fog in motion: contacts, the ladder, lies, decay
// ---------------------------------------------------------------------------

const BLIND = { detection: 0, retention: 0, reacquisition: 0 }

function duelFile(over: {
  /** Flat probability overrides; unset = certain scans within sensor reach. */
  sensor?: { detection?: number; intelligence?: number; retention?: number; reacquisition?: number }
  falseContacts?: boolean
  misinformation?: number
  aShips?: string[]
  bShips?: string[]
  bHex?: { q: number; r: number }
  aHex?: { q: number; r: number }
  bFormation?: 'close' | 'standard' | 'wide'
}): CampaignFile {
  const scenario = blankScenario({
    mapSeed: 5,
    mapWidth: 20,
    mapHeight: 20,
    forces: {
      A: [
        {
          id: 'a-1',
          kind: 'ship',
          name: 'Picket',
          ships: over.aShips ?? ['union-yorktown-i-class-heavy-cruiser'],
          hex: over.aHex ?? { q: 8, r: 4 },
          order: { speed: 'hold' },
        },
      ],
      B: [
        {
          id: 'b-1',
          kind: over.bShips && over.bShips.length > 1 ? 'group' : 'ship',
          name: 'Raider',
          ships: over.bShips ?? ['vallari-v-6l-savage-class-light-cruiser'],
          hex: over.bHex ?? { q: 10, r: 4 },
          order: { speed: 'hold', formation: over.bFormation ?? 'standard' },
        },
      ],
    },
    tuning: {
      detectionCurve: [],
      misinformationBase: over.misinformation ?? 0,
      falseContacts: over.falseContacts ?? false,
      sensorModel: {
        override: { detection: 1, intelligence: 1, retention: 1, ...over.sensor },
      },
    },
  })
  const file = newCampaign(scenario, 'c-det')
  // Clean space for these tests: the generated map is free to put a nebula
  // under a carefully-chosen range, and terrain's probability effects have
  // their own tests in sensorModel.test.ts.
  file.map.terrain = []
  return file
}

const ctxOf = (file: CampaignFile): DetectionContext => ({ map: file.map, scenario: file.scenario })

function pass(file: CampaignFile): void {
  const move: PhaseMove = {
    round: file.state.round,
    phase: file.state.phase,
    side: sideToMove(file.state.phase),
    interventions: [],
  }
  file.state = resolvePhase(ctxOf(file), file.state, move)
  file.journal.push(move)
}

const contactOf = (file: CampaignFile, side: 'A' | 'B') =>
  file.state.contacts.find((c) => c.side === side)

describe('contact records climb the ladder (4.4)', () => {
  it('a certain curve climbs the ladder in order, two rungs for a science ship', () => {
    const file = duelFile({})
    pass(file)
    const first = contactOf(file, 'A')!
    expect(first).toBeDefined()
    // Yorktown carries SCNC 4 → sciences ≥ 3: two rungs per success (4.4),
    // so the very first scan buys existence and the bearing class.
    expect(Object.keys(first.attributes)).toEqual(['exists', 'bearingClass'])
    expect(first.attributes.bearingClass?.value).toBe('military')

    pass(file)
    pass(file)
    const later = contactOf(file, 'A')!
    const resolved = Object.keys(later.attributes)
    expect(resolved).toContain('speed')
    expect(resolved).toContain('faction')
    // Strictly in ladder order: nothing resolved ahead of an unresolved rung.
    expect(resolved).toEqual(['exists', 'bearingClass', 'sizeClass', 'speed', 'count', 'faction'])
  })

  it('identification waits for range three or a scout block (4.4)', () => {
    const far = duelFile({ bHex: { q: 12, r: 4 }, bShips: ['vallari-v-7c-raider-class-battlecruiser'] }) // range 4
    for (let i = 0; i < 24; i++) pass(far)
    const blocked = contactOf(far, 'A')!
    expect(blocked.attributes.shipClass).toBeUndefined()
    expect(blocked.attributes.shipName).toBeUndefined()
    // Everything before the gate resolved long ago.
    expect(blocked.attributes.damage).toBeDefined()

    const near = duelFile({ bHex: { q: 11, r: 4 }, bShips: ['vallari-v-7c-raider-class-battlecruiser'] }) // range 3
    for (let i = 0; i < 24; i++) pass(near)
    expect(contactOf(near, 'A')!.attributes.shipClass?.value).toBe('V-7C RAIDER-class Battlecruiser')
  })

  it("a close formation reads as one target: its count comes only through the 25% peek (6.2)", () => {
    const file = duelFile({
      bShips: ['vallari-v-6l-savage-class-light-cruiser', 'vallari-v-6l-savage-class-light-cruiser'],
      bFormation: 'close',
      bHex: { q: 10, r: 4 }, // range 2
    })
    // Two certain scans climb four rungs — exists, bearing, size, speed —
    // and the ladder now stands at the count gate.
    pass(file)
    pass(file)
    expect(contactOf(file, 'A')!.attributes.speed).toBeDefined()
    expect(contactOf(file, 'A')!.attributes.count).toBeUndefined()

    // The peek is a 25% roll per scan: many more phases and it lands, and
    // the ladder moves on past it.
    for (let i = 0; i < 40; i++) pass(file)
    const contact = contactOf(file, 'A')!
    expect(contact.attributes.count).toBeDefined()
    expect(contact.attributes.count?.value).toBe('2')
    expect(contact.attributes.faction).toBeDefined()
  })

  it('close formation risks a collision — a structure scar on a random hull', () => {
    const file = duelFile({
      bShips: ['vallari-v-6l-savage-class-light-cruiser', 'vallari-v-6l-savage-class-light-cruiser'],
      bFormation: 'close',
    })
    ;(file.scenario.tuning.sensorModel as Record<string, unknown>).closeFormationCollision = 1
    pass(file) // A's phase: B does not roll
    const before = file.state.units.find((u) => u.id === 'b-1')!
    expect(before.ships.every((s) => (s.scars?.structure ?? 0) === 0)).toBe(true)
    pass(file) // B's phase: the certain accident happens
    const b = file.state.units.find((u) => u.id === 'b-1')!
    expect(b.ships.some((s) => (s.scars?.structure ?? 0) > 0)).toBe(true)
  })
})

describe('misinformation (4.5)', () => {
  it('never lies about existence, always lies when the dial says so', () => {
    const file = duelFile({ misinformation: 1 })
    for (let i = 0; i < 8; i++) pass(file)
    const contact = contactOf(file, 'A')!
    expect(contact.attributes.exists?.truthful).toBe(true)
    expect(contact.attributes.bearingClass?.truthful).toBe(false)
    // The lie is plausible: still a legal value of the category.
    expect(['military', 'civilian']).toContain(contact.attributes.bearingClass?.value)
    expect(contact.attributes.bearingClass?.value).not.toBe('military')
  })

  it('a closer look replaces a lie with the truth (4.5)', () => {
    const file = duelFile({
      misinformation: 1,
      bHex: { q: 12, r: 4 },
      bShips: ['vallari-v-7c-raider-class-battlecruiser'],
    }) // range 4
    for (let i = 0; i < 4; i++) pass(file)
    const lied = contactOf(file, 'A')!
    expect(lied.attributes.bearingClass?.truthful).toBe(false)
    const liedAt = lied.attributes.bearingClass!.resolvedAtRange
    expect(liedAt).toBeGreaterThanOrEqual(4)

    // The dial turns honest and the raider closes: the re-roll at closer
    // range replaces the lie.
    file.scenario.tuning.misinformationBase = 0
    const b = file.state.units.find((u) => u.id === 'b-1')!
    b.hex = { q: 10, r: 4 } // range 2 — closer than the lie was bought
    for (let i = 0; i < 4; i++) pass(file)
    const corrected = contactOf(file, 'A')!
    expect(corrected.attributes.bearingClass?.truthful).toBe(true)
    expect(corrected.attributes.bearingClass?.value).toBe('military')
  })
})

describe('track states (briefing §13)', () => {
  it('a scan gains a track, a held scan keeps it, a failed retention loses it', () => {
    const file = duelFile({})
    pass(file)
    expect(contactOf(file, 'A')!.track).toBe('detected')
    pass(file)
    expect(contactOf(file, 'A')!.track).toBe('tracked')

    // Retention turns impossible: the next sweep drops the track but keeps
    // the record — last-known picture, not amnesia.
    ;(file.scenario.tuning.sensorModel as { override: Record<string, number> }).override.retention = 0
    ;(file.scenario.tuning.sensorModel as { override: Record<string, number> }).override.reacquisition = 0
    pass(file)
    const lost = contactOf(file, 'A')!
    expect(lost.track).toBe('track-lost')
    expect(lost.attributes.exists).toBeDefined()
  })

  it('a lost track is reacquired, not re-detected: detection zero, reacquisition certain', () => {
    const file = duelFile({})
    pass(file)
    ;(file.scenario.tuning.sensorModel as { override: Record<string, number> }).override.retention = 0
    ;(file.scenario.tuning.sensorModel as { override: Record<string, number> }).override.reacquisition = 0
    pass(file)
    expect(contactOf(file, 'A')!.track).toBe('track-lost')

    // Fresh detection stays impossible; only the reacquisition path is open.
    ;(file.scenario.tuning.sensorModel as { override: Record<string, number> }).override.detection = 0
    ;(file.scenario.tuning.sensorModel as { override: Record<string, number> }).override.reacquisition = 1
    pass(file)
    expect(contactOf(file, 'A')!.track).toBe('reacquired')
    pass(file)
    expect(contactOf(file, 'A')!.track).toBe('track-lost') // retention still 0
  })
})

describe('false contacts (briefing §14)', () => {
  it('a certain ghost appears, shadows no unit, and cannot be reacquired', () => {
    const file = duelFile({ falseContacts: true, sensor: BLIND })
    ;(file.scenario.tuning.sensorModel as Record<string, unknown>).falseContactPassive = 1
    pass(file)
    const ghosts = file.state.contacts.filter((c) => c.targetUnitId.startsWith('phantom-'))
    expect(ghosts.length).toBeGreaterThan(0)
    const ghost = ghosts[0]
    expect(ghost.attributes.exists?.value).toBe('yes')
    expect(ghost.attributes.exists?.truthful).toBe(false) // umpire-only marker
    expect(file.state.units.some((u) => u.id === ghost.targetUnitId)).toBe(false)

    // Never scannable again: it goes quiet and collapses like any cold trail.
    ;(file.scenario.tuning.sensorModel as Record<string, unknown>).falseContactPassive = 0
    while (file.state.round < 5) pass(file)
    const faded = file.state.contacts.find((c) => c.id === ghost.id)!
    expect(faded.unscannedRounds).toBeGreaterThanOrEqual(3)
  })

  it('no ghosts when the scenario keeps the dial off', () => {
    const file = duelFile({ falseContacts: false })
    for (let i = 0; i < 16; i++) pass(file)
    expect(file.state.contacts.some((c) => c.targetUnitId.startsWith('phantom-'))).toBe(false)
  })
})

describe('contact decay (4.4)', () => {
  it('an unscanned contact goes stale, drifts, and collapses after three rounds', () => {
    const file = duelFile({})
    pass(file)
    expect(contactOf(file, 'A')).toBeDefined()

    // The raider leaves the map's corner of the war entirely.
    const b = file.state.units.find((u) => u.id === 'b-1')!
    b.hex = { q: 19, r: 0 }
    const before = file.journal.length
    while (file.state.round < 5) pass(file)
    expect(file.journal.length).toBeGreaterThan(before)

    const contact = contactOf(file, 'A')!
    expect(contact.unscannedRounds).toBeGreaterThanOrEqual(3)
  })
})

describe('infrastructure sensors (3.4)', () => {
  it('a fleet base auto-contacts anything uncloaked within four hexes', () => {
    const file = duelFile({ sensor: BLIND }) // ships see nothing
    file.state.infrastructure.push({
      id: 'base-a',
      side: 'A',
      kind: 'fleet-base',
      hex: { q: 9, r: 4 },
      destroyed: false,
    })
    pass(file)
    const contact = contactOf(file, 'A')!
    expect(contact).toBeDefined()
    expect(contact.attributes.exists?.value).toBe('yes')
    expect(contact.positionEstimated).toBe(false)
    // Radar certainty carries no dossier and tells no lies.
    expect(Object.keys(contact.attributes)).toEqual(['exists'])
  })

  it('a cloaked hull slips the radar picket', () => {
    const file = duelFile({
      sensor: BLIND,
      bShips: ['aurelian-corvus-i-class-destroyer'],
    })
    file.state.units.find((u) => u.id === 'b-1')!.order.cloaked = true
    file.state.infrastructure.push({
      id: 'base-a',
      side: 'A',
      kind: 'fleet-base',
      hex: { q: 9, r: 4 },
      destroyed: false,
    })
    pass(file)
    expect(contactOf(file, 'A')).toBeUndefined()
  })
})

describe('orders the engine refuses identically for every actor', () => {
  it('cloaking a hull with no cloak', () => {
    const file = duelFile({})
    expect(() =>
      resolvePhase(ctxOf(file), file.state, {
        round: 1,
        phase: 1,
        side: 'A',
        interventions: [
          {
            type: 'set-order',
            unitId: 'a-1',
            order: { waypoints: [], speed: 'hold', sensorPower: 1, cloaked: true, formation: 'standard' },
          },
        ],
      }),
    ).toThrow(PhaseError)
  })

  it('a mission aimed at a contact the side does not hold steers nothing', () => {
    const file = duelFile({})
    pass(file) // A phase 1: A now holds a contact on the raider
    pass(file) // B phase 2: B holds one too
    const bContact = contactOf(file, 'B')!
    // A tries to intercept B's OWN contact record — not A's to steer by. The
    // order is accepted but the mission is CLEARED (a contact can also die to
    // a battle result in this very move, so refusal would crash honest play);
    // either way the foreign id buys no steering.
    file.state = resolvePhase(ctxOf(file), file.state, {
      round: 1,
      phase: 3,
      side: 'A',
      interventions: [
        {
          type: 'set-order',
          unitId: 'a-1',
          order: {
            waypoints: [],
            speed: 'cruise',
            sensorPower: 1,
            cloaked: false,
            formation: 'standard',
            mission: { type: 'intercept', contactId: bContact.id },
          },
        },
      ],
    })
    const a = file.state.units.find((u) => u.id === 'a-1')!
    expect(a.order.mission).toBeUndefined()
    expect(a.hex).toEqual({ q: 8, r: 4 }) // no waypoints, no mission: it held
  })
})

describe('dead reckoning stays on the chart', () => {
  it('a reckoning never sails off the board, however long the silence', () => {
    const map = { width: 12, height: 10, terrain: [], border: [] }
    const state = { round: 9, phase: 1 } as never
    const contact = {
      id: 'ct-A-1',
      side: 'A' as const,
      targetUnitId: 'b-x',
      attributes: {},
      estimatedHex: { q: 10, r: 2 },
      positionEstimated: true,
      lastScan: { round: 1, phase: 1 },
      unscannedRounds: 2,
      course: { q: 1, r: 1 }, // south-east, straight at the corner
      observedMoving: true,
    }
    const believed = reckonedHex(map, contact, state)
    expect(believed.q).toBeLessThanOrEqual(11)
    const rMin = -Math.floor(believed.q / 2)
    expect(believed.r).toBeGreaterThanOrEqual(rMin)
    expect(believed.r).toBeLessThan(rMin + 10)
  })
})

describe('missions steer by the estimate, never the truth (5.3)', () => {
  it('an intercept closes on where the contact was believed to be', () => {
    const file = duelFile({ sensor: BLIND })
    // The umpire pencils in a contact whose estimate is WRONG on purpose:
    // the raider is east, the estimate is south-west.
    const believed = { q: 4, r: 8 }
    file.state.contacts.push({
      id: 'ct-A-99',
      side: 'A',
      targetUnitId: 'b-1',
      attributes: { exists: { value: 'yes', truthful: true, resolvedAtRange: 3, stale: false } },
      estimatedHex: believed,
      positionEstimated: true,
      lastScan: { round: 1, phase: 1 },
      unscannedRounds: 0,
      course: null,
      observedMoving: false,
    })
    file.state = resolvePhase(ctxOf(file), file.state, {
      round: 1,
      phase: 1,
      side: 'A',
      interventions: [
        {
          type: 'set-order',
          unitId: 'a-1',
          order: {
            waypoints: [],
            speed: 'cruise',
            sensorPower: 1,
            cloaked: false,
            formation: 'standard',
            mission: { type: 'intercept', contactId: 'ct-A-99' },
          },
        },
      ],
    })
    // Cruise moves in own phases 2/4/6/8 — table phase 3 is the hunter's
    // first scheduled step (schedule.ts).
    file.state = resolvePhase(ctxOf(file), file.state, { round: 1, phase: 2, side: 'B', interventions: [] })
    file.state = resolvePhase(ctxOf(file), file.state, { round: 1, phase: 3, side: 'A', interventions: [] })
    const hunter = file.state.units.find((u) => u.id === 'a-1')!
    const truth = file.state.units.find((u) => u.id === 'b-1')!.hex
    expect(hexDistance(hunter.hex, believed)).toBeLessThan(hexDistance({ q: 8, r: 4 }, believed))
    expect(hexDistance(hunter.hex, truth)).toBeGreaterThanOrEqual(hexDistance({ q: 8, r: 4 }, truth))
  })
})

describe('profiles and truths', () => {
  it('a unit is as loud as its loudest ship and cloaks only whole', () => {
    const file = duelFile({
      bShips: ['aurelian-corvus-i-class-destroyer', 'aurelian-tonitrus-i-class-heavy-cruiser'],
    })
    const b = file.state.units.find((u) => u.id === 'b-1')!
    const p = unitProfile(b)
    expect(p.cloakCapable).toBe(true)
    const mixed = { ...b, ships: [b.ships[0], { id: 'x', formId: 'union-yorktown-i-class-heavy-cruiser', name: 'x' }] }
    expect(unitProfile(mixed).cloakCapable).toBe(false)
    expect(unitProfile(mixed).signature).toBeGreaterThanOrEqual(p.signature)
  })

  it('true attributes read what a scan would eventually learn', () => {
    const file = duelFile({
      bShips: ['vallari-v-6l-savage-class-light-cruiser', 'vallari-v-11c-predator-class-dreadnought'],
    })
    const b = file.state.units.find((u) => u.id === 'b-1')!
    const read = (a: ContactAttribute) => trueAttribute(b, a)
    expect(read('bearingClass')).toBe('military')
    expect(read('count')).toBe('2')
    expect(read('faction')).toBe('Vallari Imperium')
    expect(read('shipClass')).toBe('V-11C PREDATOR-class Dreadnought')
  })
})
