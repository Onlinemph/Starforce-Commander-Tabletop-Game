import { describe, expect, it } from 'vitest'
import { blankScenario, loadCampaign, newCampaign, replayCampaign, saveCampaign } from './file'
import { hexDistance, terrainAt } from './hexmap'
import { resolvePhase } from './turn'
import { sideToMove, type CampaignFile, type Hex, type PhaseMove } from './types'

/**
 * The permanent invariant (0.3.2, Part 9): a campaign is (setup + journal),
 * and replay-from-phase-one equals the stored state — byte for byte, rng call
 * count included.
 */

function scenario() {
  return blankScenario({
    mapSeed: 77,
    forces: {
      A: [{ id: 'a-patrol', kind: 'ship', name: 'FF Escort', ships: ['union-nelson-ii-class-light-frigate'], hex: { q: 5, r: 10 } }],
      B: [{ id: 'b-raider', kind: 'ship', name: 'CL Raider', ships: ['vallari-v-6l-savage-class-light-cruiser'], hex: { q: 30, r: 0 } }],
    },
  })
}

/** Journal one uneventful phase for whoever is up. */
function pass(file: CampaignFile): void {
  const move: PhaseMove = {
    round: file.state.round,
    phase: file.state.phase,
    side: sideToMove(file.state.phase),
    interventions: [],
  }
  file.state = resolvePhase(file.map, file.state, move)
  file.journal.push(move)
}

describe('the campaign file', () => {
  it('replay-from-phase-one equals the stored state — the permanent test', () => {
    const file = newCampaign(scenario(), 'c-test-1')
    // A round and a half of moves, with a real order change in the middle.
    file.state = resolvePhase(file.map, file.state, {
      round: 1,
      phase: 1,
      side: 'A',
      interventions: [{ type: 'set-waypoints', unitId: 'a-patrol', waypoints: [{ q: 12, r: 8 }] }],
    })
    file.journal.push({
      round: 1,
      phase: 1,
      side: 'A',
      interventions: [{ type: 'set-waypoints', unitId: 'a-patrol', waypoints: [{ q: 12, r: 8 }] }],
    })
    for (let i = 0; i < 17; i++) pass(file)

    expect(file.state.round).toBe(2)
    expect(file.state.phase).toBe(7)
    expect(JSON.stringify(replayCampaign(file))).toBe(JSON.stringify(file.state))
  })

  it('save and load round-trip, and load verifies the cache against the journal', () => {
    const file = newCampaign(scenario(), 'c-test-2')
    for (let i = 0; i < 5; i++) pass(file)
    const text = saveCampaign(file)
    const loaded = loadCampaign(text)
    expect(typeof loaded).not.toBe('string')
    expect(JSON.stringify((loaded as CampaignFile).state)).toBe(JSON.stringify(file.state))

    // A doctored cache is refused, not trusted.
    const doctored = JSON.parse(text)
    doctored.state.units[0].hex.q += 1
    expect(typeof loadCampaign(JSON.stringify(doctored))).toBe('string')
  })

  it('unknown fields ride through save and load untouched (Part 9)', () => {
    const file = newCampaign(scenario(), 'c-test-3') as CampaignFile & { futureField?: unknown }
    file.futureField = { fromVersion: 9, note: 'round-trips' }
    const back = loadCampaign(saveCampaign(file)) as CampaignFile & { futureField?: unknown }
    expect(typeof back).not.toBe('string')
    expect(back.futureField).toEqual({ fromVersion: 9, note: 'round-trips' })
  })

  it('a unit auto-steps one hex toward its waypoint each own phase, and only its own', () => {
    const file = newCampaign(scenario(), 'c-test-4')
    const start: Hex = { q: 5, r: 10 }
    file.state = resolvePhase(file.map, file.state, {
      round: 1,
      phase: 1,
      side: 'A',
      interventions: [{ type: 'set-waypoints', unitId: 'a-patrol', waypoints: [{ q: 9, r: 8 }] }],
    })
    const after1 = file.state.units.find((u) => u.id === 'a-patrol')!
    expect(hexDistance(after1.hex, { q: 9, r: 8 })).toBeLessThan(hexDistance(start, { q: 9, r: 8 }))

    // B's phase does not move A's unit.
    const held = structuredClone(after1.hex)
    file.state = resolvePhase(file.map, file.state, { round: 1, phase: 2, side: 'B', interventions: [] })
    expect(file.state.units.find((u) => u.id === 'a-patrol')!.hex).toEqual(held)
  })

  it('nebula and dust cost two phases per hex (2.2)', () => {
    const file = newCampaign(scenario(), 'c-test-5')
    // A nebula hex with a clear doorstep beside it — placing the patrol there
    // by hand and ordering it in isolates the entry cost from pathing.
    const slow = file.map.terrain.find(
      (t) => t.kind === 'nebula' && terrainAt(file.map, { q: t.q + 1, r: t.r }) === 'deep',
    )!
    expect(slow).toBeDefined()
    const unit = file.state.units.find((u) => u.id === 'a-patrol')!
    const doorstep = { q: slow.q + 1, r: slow.r }
    unit.hex = doorstep
    file.state = resolvePhase(file.map, file.state, {
      round: 1,
      phase: 1,
      side: 'A',
      interventions: [{ type: 'set-waypoints', unitId: 'a-patrol', waypoints: [{ q: slow.q, r: slow.r }] }],
    })
    let at = file.state.units.find((u) => u.id === 'a-patrol')!
    expect(at.hex).toEqual({ q: slow.q, r: slow.r })
    expect(at.moveDebt).toBe(1)

    // Its next own phase is spent paying the debt, not moving on.
    file.state = resolvePhase(file.map, file.state, { round: 1, phase: 2, side: 'B', interventions: [] })
    file.state = resolvePhase(file.map, file.state, {
      round: 1,
      phase: 3,
      side: 'A',
      interventions: [{ type: 'set-waypoints', unitId: 'a-patrol', waypoints: [{ q: slow.q + 2, r: slow.r }] }],
    })
    at = file.state.units.find((u) => u.id === 'a-patrol')!
    expect(at.hex).toEqual({ q: slow.q, r: slow.r })
    expect(at.moveDebt).toBe(0)
  })

  it('refuses out-of-order moves and the wrong side', () => {
    const file = newCampaign(scenario(), 'c-test-6')
    expect(() =>
      resolvePhase(file.map, file.state, { round: 1, phase: 2, side: 'B', interventions: [] }),
    ).toThrow(/Expected round 1 phase 1/)
    expect(() =>
      resolvePhase(file.map, file.state, { round: 1, phase: 1, side: 'B', interventions: [] }),
    ).toThrow(/A's to move/)
    expect(() =>
      resolvePhase(file.map, file.state, {
        round: 1,
        phase: 1,
        side: 'A',
        interventions: [{ type: 'set-waypoints', unitId: 'b-raider', waypoints: [] }],
      }),
    ).toThrow(/not A's unit/)
  })

  it('the clock ends the campaign at the round limit', () => {
    const file = newCampaign(blankScenario({ rounds: 1, forces: { A: [], B: [] } }), 'c-test-7')
    for (let i = 0; i < 12; i++) pass(file)
    expect(file.state.finished).toBe(true)
    expect(() =>
      resolvePhase(file.map, file.state, { round: 2, phase: 1, side: 'A', interventions: [] }),
    ).toThrow(/over/)
  })
})
