import { describe, expect, it } from 'vitest'
import { blankScenario, loadCampaign, newCampaign, replayCampaign, saveCampaign } from './file'
import { hexDistance, terrainAt } from './hexmap'
import { resolvePhase, type DetectionContext } from './turn'
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

const ctxOf = (file: CampaignFile): DetectionContext => ({ map: file.map, scenario: file.scenario })

/** Journal one uneventful phase for whoever is up. */
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

describe('the campaign file', () => {
  it('replay-from-phase-one equals the stored state — the permanent test', () => {
    const file = newCampaign(scenario(), 'c-test-1')
    // A round and a half of moves, with a real order change in the middle.
    file.state = resolvePhase(ctxOf(file), file.state, {
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
    for (let i = 0; i < 21; i++) pass(file)

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

  it('a save from before a state field existed loads, upgraded, while a doctored value is still refused', () => {
    const file = newCampaign(scenario(), 'c-test-2b')
    for (let i = 0; i < 5; i++) pass(file)
    // An older build's save: no sensor log, no dispatches, no spotters.
    const older = JSON.parse(saveCampaign(file))
    delete older.state.sensorLog
    delete older.state.events
    for (const c of older.state.contacts) delete c.spotters
    const loaded = loadCampaign(JSON.stringify(older))
    expect(typeof loaded).not.toBe('string')
    // The loaded file carries the CURRENT replay, fields restored.
    expect(JSON.stringify((loaded as CampaignFile).state)).toBe(JSON.stringify(file.state))

    // Missing fields are forgiven; wrong values are not.
    const doctored = JSON.parse(saveCampaign(file))
    delete doctored.state.sensorLog
    doctored.state.vp.A += 5
    expect(typeof loadCampaign(JSON.stringify(doctored))).toBe('string')
    // Nor is an array that lost an element.
    const shortened = JSON.parse(saveCampaign(file))
    shortened.state.units.pop()
    expect(typeof loadCampaign(JSON.stringify(shortened))).toBe('string')
  })

  it('unknown fields ride through save and load untouched (Part 9)', () => {
    const file = newCampaign(scenario(), 'c-test-3') as CampaignFile & { futureField?: unknown }
    file.futureField = { fromVersion: 9, note: 'round-trips' }
    const back = loadCampaign(saveCampaign(file)) as CampaignFile & { futureField?: unknown }
    expect(typeof back).not.toBe('string')
    expect(back.futureField).toEqual({ fromVersion: 9, note: 'round-trips' })
  })

  it('a unit steps toward its waypoint on its scheduled phases, and only then', () => {
    const file = newCampaign(scenario(), 'c-test-4')
    const start: Hex = { q: 5, r: 10 }
    // Cruise 4 (FTL 3 + 1) moves in own phases 2/4/6/8 — table phases
    // 3/7/11/15 for side A. Phase 1 belongs to speed-8 sprinters only.
    file.state = resolvePhase(ctxOf(file), file.state, {
      round: 1,
      phase: 1,
      side: 'A',
      interventions: [{ type: 'set-waypoints', unitId: 'a-patrol', waypoints: [{ q: 9, r: 8 }] }],
    })
    expect(file.state.units.find((u) => u.id === 'a-patrol')!.hex).toEqual(start)

    // B's phase does not move A's unit either.
    file.state = resolvePhase(ctxOf(file), file.state, { round: 1, phase: 2, side: 'B', interventions: [] })
    expect(file.state.units.find((u) => u.id === 'a-patrol')!.hex).toEqual(start)

    // Phase 3 is a cruise phase: one hex closer.
    file.state = resolvePhase(ctxOf(file), file.state, { round: 1, phase: 3, side: 'A', interventions: [] })
    const after3 = file.state.units.find((u) => u.id === 'a-patrol')!
    expect(hexDistance(after3.hex, { q: 9, r: 8 })).toBe(hexDistance(start, { q: 9, r: 8 }) - 1)
  })

  it('nebula and dust cost two movement credits per hex (2.2)', () => {
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
    // Phases 1–3: the cruise phase at 3 spends its credit entering the nebula
    // and owes the second (2.2).
    file.state = resolvePhase(ctxOf(file), file.state, {
      round: 1,
      phase: 1,
      side: 'A',
      interventions: [{ type: 'set-waypoints', unitId: 'a-patrol', waypoints: [{ q: slow.q, r: slow.r }] }],
    })
    file.state = resolvePhase(ctxOf(file), file.state, { round: 1, phase: 2, side: 'B', interventions: [] })
    file.state = resolvePhase(ctxOf(file), file.state, { round: 1, phase: 3, side: 'A', interventions: [] })
    let at = file.state.units.find((u) => u.id === 'a-patrol')!
    expect(at.hex).toEqual({ q: slow.q, r: slow.r })
    expect(at.moveDebt).toBe(1)

    // Its next movement phase (7) is spent paying the debt, not moving on.
    for (const phase of [4, 5, 6, 7]) {
      file.state = resolvePhase(ctxOf(file), file.state, {
        round: 1,
        phase,
        side: sideToMove(phase),
        interventions:
          phase === 7
            ? [{ type: 'set-waypoints', unitId: 'a-patrol', waypoints: [{ q: slow.q + 2, r: slow.r }] }]
            : [],
      })
    }
    at = file.state.units.find((u) => u.id === 'a-patrol')!
    expect(at.hex).toEqual({ q: slow.q, r: slow.r })
    expect(at.moveDebt).toBe(0)
  })

  it('refuses out-of-order moves and the wrong side', () => {
    const file = newCampaign(scenario(), 'c-test-6')
    expect(() =>
      resolvePhase(ctxOf(file), file.state, { round: 1, phase: 2, side: 'B', interventions: [] }),
    ).toThrow(/Expected round 1 phase 1/)
    expect(() =>
      resolvePhase(ctxOf(file), file.state, { round: 1, phase: 1, side: 'B', interventions: [] }),
    ).toThrow(/A's to move/)
    expect(() =>
      resolvePhase(ctxOf(file), file.state, {
        round: 1,
        phase: 1,
        side: 'A',
        interventions: [{ type: 'set-waypoints', unitId: 'b-raider', waypoints: [] }],
      }),
    ).toThrow(/not A's unit/)
  })

  it('the clock ends the campaign at the round limit', () => {
    const file = newCampaign(blankScenario({ rounds: 1, forces: { A: [], B: [] } }), 'c-test-7')
    for (let i = 0; i < 16; i++) pass(file)
    expect(file.state.finished).toBe(true)
    expect(() =>
      resolvePhase(ctxOf(file), file.state, { round: 2, phase: 1, side: 'A', interventions: [] }),
    ).toThrow(/over/)
  })
})
