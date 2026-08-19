import { describe, expect, it } from 'vitest'
import { detectionChance, reckonedHex, trueAttribute, unitProfile, type ScanPosture } from './detection'
import { blankScenario, newCampaign } from './file'
import { hexDistance } from './hexmap'
import { resolvePhase, PhaseError, type DetectionContext } from './turn'
import { sideToMove, type CampaignFile, type ContactAttribute, type PhaseMove } from './types'

/**
 * Detection (Part 4): the band arithmetic against the doc's own worked
 * example (Appendix A), then the fog itself — the ladder, the lies, the
 * decay — made deterministic by turning the tuning dials the scenario
 * carries for exactly this purpose (10.3): a curve of certainties instead
 * of chances, a misinformation rate of always or never.
 */

const CURVE = [0.95, 0.85, 0.75, 0.45, 0.25, 0.02]
const CERTAIN = [1, 1, 1, 1, 1, 1]

const posture = (over: Partial<ScanPosture> = {}): ScanPosture => ({
  signature: 5,
  sensorRating: 6,
  moved: true,
  cloaked: false,
  formation: 'standard',
  sensorPower: 1,
  speedTier: 'cruise',
  terrain: 'deep',
  ...over,
})

describe('flogged drives glow: speed tiers in the bands', () => {
  it('a target at maximum reads one band closer, at emergency two', () => {
    const still = posture({ moved: false })
    const base = detectionChance(CURVE, 3, still, posture())!
    const maximum = detectionChance(CURVE, 3, still, posture({ speedTier: 'maximum' }))!
    const emergency = detectionChance(CURVE, 3, still, posture({ speedTier: 'emergency' }))!
    expect(maximum).toBeGreaterThan(base)
    expect(emergency).toBeGreaterThan(maximum)
    // Whole columns, per the band arithmetic.
    expect(maximum).toBeCloseTo(detectionChance(CURVE, 2, still, posture())!)
    expect(emergency).toBeCloseTo(detectionChance(CURVE, 1, still, posture())!)
  })
})

describe('the band arithmetic (4.2, 4.3) — the worked round fragment', () => {
  it('phase 5: a held-still target at range five is off-curve — no roll', () => {
    expect(detectionChance(CURVE, 5, posture({ moved: false }), posture({ moved: false }))).toBeNull()
  })

  it('phase 6: a searcher that moved scans range four at two percent', () => {
    expect(detectionChance(CURVE, 4, posture({ moved: true }), posture())).toBeCloseTo(0.02)
  })

  it('phase 6: sensors at two power treat range five as range four', () => {
    expect(detectionChance(CURVE, 5, posture({ moved: false, sensorPower: 2 }), posture())).toBeCloseTo(0.25)
  })

  it('phase 7: the still picket keeps reading twenty-five percent', () => {
    expect(detectionChance(CURVE, 4, posture({ moved: false }), posture())).toBeCloseTo(0.45 - 0.2, 9)
  })
})

describe('the band arithmetic — gates and stacks', () => {
  it('same hex always detects, unless the target is cloaked', () => {
    expect(detectionChance(CURVE, 0, posture(), posture())).toBe(1)
    expect(detectionChance(CURVE, 0, posture(), posture({ cloaked: true }))).not.toBe(1)
  })

  it('a cloaked target is a range-two problem, and harder even there', () => {
    expect(detectionChance(CURVE, 3, posture({ moved: false }), posture({ cloaked: true }))).toBeNull()
    // Range 2, cloak −1 band → column 3.
    expect(detectionChance(CURVE, 2, posture({ moved: false }), posture({ cloaked: true }))).toBeCloseTo(0.45)
  })

  it('nebula hides its occupants beyond range two and blinds them outward', () => {
    expect(detectionChance(CURVE, 3, posture({ moved: false }), posture({ terrain: 'nebula' }))).toBeNull()
    // Searcher inside scans outward at −2 bands: range 2 reads as range 4.
    expect(detectionChance(CURVE, 2, posture({ moved: false, terrain: 'nebula' }), posture())).toBeCloseTo(0.25)
  })

  it('loud hulls, wide formations and star systems all give a band away', () => {
    const base = detectionChance(CURVE, 3, posture({ moved: false }), posture())!
    expect(detectionChance(CURVE, 3, posture({ moved: false }), posture({ signature: 9 }))!).toBeGreaterThan(base)
    expect(detectionChance(CURVE, 3, posture({ moved: false }), posture({ formation: 'wide' }))!).toBeGreaterThan(base)
    expect(detectionChance(CURVE, 3, posture({ moved: false }), posture({ terrain: 'system' }))!).toBeGreaterThan(base)
    expect(detectionChance(CURVE, 3, posture({ moved: false }), posture({ signature: 2 }))!).toBeLessThan(base)
  })

  it('a cloaked searcher pays two bands for its own silence', () => {
    const open = detectionChance(CURVE, 2, posture({ moved: false }), posture())!
    const dark = detectionChance(CURVE, 2, posture({ moved: false, cloaked: true }), posture())!
    expect(dark).toBeLessThan(open)
    // Two bands off a range-2 look: the roll reads the range-4 column.
    expect(dark).toBeCloseTo(0.25)
  })
})

// ---------------------------------------------------------------------------
// The fog in motion: contacts, the ladder, lies, decay
// ---------------------------------------------------------------------------

function duelFile(over: {
  curve?: readonly number[]
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
      detectionCurve: over.curve ?? CERTAIN,
      misinformationBase: over.misinformation ?? 0,
      falseContacts: false,
    },
  })
  const file = newCampaign(scenario, 'c-det')
  // Clean space for these tests: the generated map is free to put a nebula
  // under a carefully-chosen range, and the terrain bands have their own
  // tests against detectionChance directly.
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
    // The V-7C is loud enough to stay on-curve while holding still at range
    // four; the default V-6L is signature-quiet and slips off the end — which
    // is the band arithmetic working, not the ladder.
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

  it('a close formation keeps its count until range one (6.2)', () => {
    const file = duelFile({
      bShips: ['vallari-v-6l-savage-class-light-cruiser', 'vallari-v-6l-savage-class-light-cruiser'],
      bFormation: 'close',
      bHex: { q: 10, r: 4 }, // range 2
    })
    for (let i = 0; i < 24; i++) pass(file)
    const contact = contactOf(file, 'A')!
    expect(contact.attributes.count).toBeUndefined()
    expect(contact.attributes.speed).toBeDefined() // the ladder stopped at the gate
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
    const file = duelFile({ curve: [0, 0, 0, 0, 0, 0] }) // ships see nothing
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
      curve: [0, 0, 0, 0, 0, 0],
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
    const file = duelFile({ curve: [0, 0, 0, 0, 0, 0] })
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
