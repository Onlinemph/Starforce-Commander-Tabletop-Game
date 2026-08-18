import { describe, expect, it } from 'vitest'
import { blankScenario, newCampaign } from './file'
import { resolvePhase, type DetectionContext } from './turn'
import { viewFor } from './views'
import { sideToMove, type CampaignFile, type PhaseMove } from './types'

/**
 * The wall (0.3.3). A side's view is the ONLY thing player-facing code ever
 * receives — a UI, a remote payload, a future campaign AI alike — so these
 * tests attack the serialized view the way a cheating client would: grep the
 * bytes for anything the side should not know. If a forbidden string is
 * anywhere in the JSON, it is a leak, whatever field it hides in.
 */

function fogFile(curve: readonly number[]): CampaignFile {
  const scenario = blankScenario({
    mapSeed: 9,
    mapWidth: 20,
    mapHeight: 20,
    forces: {
      A: [
        {
          id: 'a-picket',
          kind: 'ship',
          name: 'USS Watchful',
          ships: ['union-yorktown-i-class-heavy-cruiser'],
          hex: { q: 4, r: 6 },
          order: { speed: 'hold' },
        },
      ],
      B: [
        {
          id: 'b-shadow',
          kind: 'ship',
          name: 'VNS Unseen',
          ships: ['vallari-v-6l-savage-class-light-cruiser'],
          hex: { q: 8, r: 6 },
          order: { speed: 'hold' },
        },
      ],
    },
    infrastructure: [
      { id: 'b-outpost', side: 'B', kind: 'outpost', hex: { q: 16, r: 2 } },
      { id: 'b-ears', side: 'B', kind: 'listening-post', hex: { q: 12, r: 4 } },
    ],
    tuning: { detectionCurve: curve, misinformationBase: 0, falseContacts: false },
  })
  return newCampaign(scenario, 'c-views')
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

describe('what never crosses the wall', () => {
  it('an undetected enemy is absent from the view, bytes and all', () => {
    const file = fogFile([0, 0, 0, 0, 0, 0]) // nobody sees anything
    for (let i = 0; i < 6; i++) pass(file)
    const view = viewFor(file.map, file.state, 'A')
    const bytes = JSON.stringify(view)

    expect(view.contacts).toHaveLength(0)
    expect(view.units.map((u) => u.id)).toEqual(['a-picket'])
    expect(bytes).not.toContain('b-shadow')
    expect(bytes).not.toContain('VNS Unseen')
    expect(bytes).not.toContain('vallari-v-6l')
  })

  it('umpire fields never serialize: no truth flags, no target unit ids', () => {
    const file = fogFile([1, 1, 1, 1, 1, 1]) // everyone sees everything
    for (let i = 0; i < 8; i++) pass(file)
    expect(file.state.contacts.length).toBeGreaterThan(0)
    for (const side of ['A', 'B'] as const) {
      const bytes = JSON.stringify(viewFor(file.map, file.state, side))
      expect(bytes).not.toContain('truthful')
      expect(bytes).not.toContain('targetUnitId')
      expect(bytes).not.toContain('resolvedAtRange')
    }
  })

  it('a contact id is opaque — it does not name the unit it shadows', () => {
    const file = fogFile([1, 1, 1, 1, 1, 1])
    pass(file)
    const view = viewFor(file.map, file.state, 'A')
    expect(view.contacts.length).toBeGreaterThan(0)
    for (const c of view.contacts) {
      expect(c.id).toMatch(/^ct-A-\d+$/)
      expect(c.id).not.toContain('b-shadow')
    }
  })

  it('a lie reads exactly like the truth: same shape, no tell', () => {
    const honest = fogFile([1, 1, 1, 1, 1, 1])
    const lying = fogFile([1, 1, 1, 1, 1, 1])
    lying.scenario.tuning.misinformationBase = 1
    for (let i = 0; i < 6; i++) {
      pass(honest)
      pass(lying)
    }
    const honestContact = viewFor(honest.map, honest.state, 'A').contacts[0]
    const lyingContact = viewFor(lying.map, lying.state, 'A').contacts[0]
    expect(honestContact.attributes.bearingClass).toBeDefined()
    expect(lyingContact.attributes.bearingClass).toBeDefined()
    // The values differ — one is false — but the KEYS are identical, so no
    // client can tell which dossier is poisoned by looking at its shape.
    expect(Object.keys(lyingContact.attributes.bearingClass!).sort()).toEqual(
      Object.keys(honestContact.attributes.bearingClass!).sort(),
    )
  })

  it('enemy infrastructure is on the charts — except listening posts (3.4)', () => {
    const file = fogFile([0, 0, 0, 0, 0, 0])
    const view = viewFor(file.map, file.state, 'A')
    expect(view.knownEnemyInfrastructure.map((i) => i.id)).toEqual(['b-outpost'])
    expect(JSON.stringify(view)).not.toContain('b-ears')
  })

  it('the view is a copy: bending it does not bend the truth', () => {
    const file = fogFile([1, 1, 1, 1, 1, 1])
    pass(file)
    const view = viewFor(file.map, file.state, 'A')
    view.units[0].hex.q = 99
    view.map.terrain.length = 0
    expect(file.state.units[0].hex.q).not.toBe(99)
    expect(file.map.terrain.length).toBeGreaterThan(0)
  })
})

describe('what the wall shows honestly', () => {
  it('a contact scanned this phase sits at its true hex, unflagged', () => {
    const file = fogFile([1, 1, 1, 1, 1, 1])
    // First sighting past range two lands ±1 and estimated (4.4); the second
    // fix is a hard one, so two passes earn the true, unflagged position.
    pass(file)
    pass(file)
    const view = viewFor(file.map, file.state, 'A')
    const contact = view.contacts[0]
    expect(contact.hex).toEqual({ q: 8, r: 6 })
    expect(contact.positionEstimated).toBe(false)
    expect(contact.uncertainty).toBe(0)
  })

  it('an unscanned contact is dead-reckoned along its observed course, flagged', () => {
    const file = fogFile([0, 0, 0, 0, 0, 0])
    file.state.contacts.push({
      id: 'ct-A-1',
      side: 'A',
      targetUnitId: 'b-shadow',
      attributes: { exists: { value: 'yes', truthful: true, resolvedAtRange: 2, stale: false } },
      estimatedHex: { q: 10, r: 2 },
      positionEstimated: false,
      lastScan: { round: 1, phase: 1 },
      unscannedRounds: 0,
      course: { q: 1, r: 0 },
      observedMoving: true,
    })
    // Six table phases later: three own phases of believed cruise.
    for (let i = 0; i < 6; i++) pass(file)
    const view = viewFor(file.map, file.state, 'A')
    const contact = view.contacts.find((c) => c.id === 'ct-A-1')!
    expect(contact.positionEstimated).toBe(true)
    expect(contact.hex.q).toBeGreaterThan(10)
  })

  it('a collapsed contact keeps only its existence (4.4)', () => {
    const file = fogFile([0, 0, 0, 0, 0, 0])
    file.state.contacts.push({
      id: 'ct-A-2',
      side: 'A',
      targetUnitId: 'b-shadow',
      attributes: {
        exists: { value: 'yes', truthful: true, resolvedAtRange: 2, stale: false },
        bearingClass: { value: 'military', truthful: true, resolvedAtRange: 2, stale: true },
        sizeClass: { value: 'medium', truthful: true, resolvedAtRange: 2, stale: true },
      },
      estimatedHex: { q: 10, r: 2 },
      positionEstimated: true,
      lastScan: { round: 1, phase: 1 },
      unscannedRounds: 3,
      course: null,
      observedMoving: false,
    })
    const view = viewFor(file.map, file.state, 'A')
    const marker = view.contacts.find((c) => c.id === 'ct-A-2')!
    expect(marker.collapsed).toBe(true)
    expect(Object.keys(marker.attributes)).toEqual(['exists'])
  })

  it('both sides read the same public scoreboard and the same map', () => {
    const file = fogFile([1, 1, 1, 1, 1, 1])
    pass(file)
    const a = viewFor(file.map, file.state, 'A')
    const b = viewFor(file.map, file.state, 'B')
    expect(a.vp).toEqual(b.vp)
    expect(JSON.stringify(a.map)).toBe(JSON.stringify(b.map))
  })
})
