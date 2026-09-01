import { describe, expect, it } from 'vitest'
import { newCampaign } from './file'
import { quickResolve } from './quickResolve'
import { borderWatch, raidOnDeltaVideus } from './scenarios'
import { soloOrders } from './solo'
import { resolvePhase, type DetectionContext } from './turn'
import { viewFor } from './views'
import { sideToMove, type CampaignFile, type PhaseMove } from './types'

/**
 * The solo opponent plans under the fog (Part 11). The strongest leak proof
 * in the module is `soloOrders`' signature — it TAKES a SideView, so the
 * compiler forbids it the umpire's truth — and these tests add the runtime
 * half: it plays whole campaigns through the same resolver as a human, it
 * only ever orders its own units, and it steers by contact ids it was shown.
 */

const ctxOf = (file: CampaignFile): DetectionContext => ({ map: file.map, scenario: file.scenario })

/** Drive both sides with the solo doctrine, quick-resolving what it starts. */
function soloPhase(file: CampaignFile): void {
  const side = sideToMove(file.state.phase)
  const battles: PhaseMove['battles'] = []
  for (const pending of file.state.pendingBattles) {
    const quick = quickResolve(ctxOf(file), file.state, file.campaignId, pending, {
      difficulty: 'captain',
      rounds: 8,
    })
    if (typeof quick === 'string') throw new Error(quick)
    battles.push(quick.record)
  }
  const view = viewFor(file.map, file.state, side)
  const move: PhaseMove = {
    round: file.state.round,
    phase: file.state.phase,
    side,
    interventions: soloOrders(view),
    ...(battles.length > 0 ? { battles } : {}),
  }
  file.state = resolvePhase(ctxOf(file), file.state, move)
  file.journal.push(move)
}

describe('the solo opponent', () => {
  it('plays a whole opening against itself: legal every phase, fog and all', () => {
    const file = newCampaign(borderWatch(), 'c-solo')
    // Four rounds of double-blind self-play: every intervention must pass the
    // same resolver a human's would, or resolvePhase throws and this fails.
    for (let i = 0; i < 48 && !file.state.finished; i++) soloPhase(file)
    expect(file.state.round).toBeGreaterThan(1)
    // The doctrine actually moved people: somebody left their starting hex.
    const scenario = borderWatch()
    const moved = file.state.units.some((u) => {
      const spec = [...scenario.forces.A, ...scenario.forces.B].find((f) => f.id === u.id)
      return spec && (spec.hex.q !== u.hex.q || spec.hex.r !== u.hex.r)
    })
    expect(moved).toBe(true)
  })

  it('orders only the units its view shows — which are only its own', () => {
    const file = newCampaign(borderWatch(), 'c-solo-2')
    for (const side of ['A', 'B'] as const) {
      const view = viewFor(file.map, file.state, side)
      const ownIds = new Set(view.units.map((u) => u.id))
      for (const order of soloOrders(view)) {
        expect(ownIds.has(order.unitId)).toBe(true)
      }
    }
  })

  it('hunts by contact id, never by enemy unit id', () => {
    const file = newCampaign(borderWatch(), 'c-solo-3')
    // Hand side A a contact the honest way is slow; the umpire pencils one in.
    file.state.contacts.push({
      id: 'ct-A-9',
      side: 'A',
      targetUnitId: 'b-cruiser',
      attributes: { exists: { value: 'yes', truthful: true, resolvedAtRange: 2, stale: false } },
      estimatedHex: { q: 20, r: 4 },
      positionEstimated: false,
      lastScan: { round: 1, phase: 1 },
      unscannedRounds: 0,
      course: null,
      observedMoving: false,
    })
    const view = viewFor(file.map, file.state, 'A')
    const orders = soloOrders(view)
    const hunting = orders.filter(
      (o) => o.type === 'set-order' && o.order.mission?.type === 'intercept',
    )
    expect(hunting.length).toBeGreaterThan(0)
    for (const order of hunting) {
      if (order.type !== 'set-order') continue
      const mission = order.order.mission!
      if (mission.type !== 'intercept') continue
      expect(mission.contactId).toBe('ct-A-9')
      expect(JSON.stringify(order)).not.toContain('b-cruiser')
    }
  })

  it('sends its convoys out under Avoid Contact with orders to run', () => {
    const file = newCampaign(raidOnDeltaVideus(), 'c-solo-5')
    const orders = soloOrders(viewFor(file.map, file.state, 'A'))
    const convoy = orders.find((o) => o.unitId === 'a-convoy')
    expect(convoy?.type).toBe('set-order')
    if (convoy?.type !== 'set-order') return
    expect(convoy.order.avoidContact).toBe(true)
    expect(convoy.order.engagement).toBe('withdraw')
    // The schedule itself is untouched: the route still runs to the colony.
    expect(convoy.order.waypoints.length).toBeGreaterThan(0)
  })

  it('carries the war to a known enemy station when the scope is empty', () => {
    const file = newCampaign(borderWatch(), 'c-solo-6')
    // Side B's charts show A's outpost (3.4); half its idle warships go for it.
    const orders = soloOrders(viewFor(file.map, file.state, 'B'))
    const strikes = orders.filter(
      (o) => o.type === 'set-order' && o.order.mission?.type === 'assault',
    )
    expect(strikes.length).toBeGreaterThan(0)
    for (const strike of strikes) {
      if (strike.type !== 'set-order' || strike.order.mission?.type !== 'assault') continue
      expect(strike.order.mission.stationId).toBe('a-outpost')
    }
  })

  it('a warship low on endurance heads for the nearest depot before anything else', () => {
    const file = newCampaign(borderWatch(), 'c-solo-7')
    const cruiser = file.state.units.find((u) => u.id === 'b-cruiser')!
    cruiser.endurance = 1 // of a full tank: LOW
    const orders = soloOrders(viewFor(file.map, file.state, 'B'))
    const order = orders.find((o) => o.unitId === 'b-cruiser')
    expect(order?.type).toBe('set-order')
    if (order?.type !== 'set-order') return
    expect(order.order.mission).toBeUndefined()
    expect(order.order.waypoints).toEqual([{ q: 26, r: 2 }]) // b-outpost
  })

  it('is deterministic: the same view yields the same orders', () => {
    const file = newCampaign(borderWatch(), 'c-solo-4')
    const view1 = viewFor(file.map, file.state, 'B')
    const view2 = viewFor(file.map, file.state, 'B')
    expect(JSON.stringify(soloOrders(view1))).toBe(JSON.stringify(soloOrders(view2)))
  })
})
