import { describe, expect, it } from 'vitest'
import { findShipForm, VALLARI_CRUISER } from '../data/ships'
import { THE_DUEL } from '../data/scenarios'
import { applyAction } from './actions'
import { engageCloak } from './cloaking'
import {
  advanceSegment,
  cloakOf,
  createGame,
  damageContext,
  damageRevealsCloak,
  defaultCommandCard,
  performScan,
  performTransport,
  attemptTractorLock,
  setShieldDown,
  shipIsCloaked,
  repositionCloaked,
  type GameState,
} from './game'
import { applyVolley } from './damage'
import { createShip, blueShieldRemaining, type ShipState } from './shipState'

/**
 * What a running cloak actually costs (H6.4), and the events that give a
 * cloaked ship away (H6.15).
 *
 * The rules for the cloak itself were modelled from the start; these are the
 * places where the rest of the game had to be told about it. Every one of them
 * used to let a cloaked ship do something the rulebook forbids.
 */

const PASSER = findShipForm('PASSER I-class Frigate')!
const VALLARI = VALLARI_CRUISER

function ship(id: string, side: string, form: typeof PASSER, x = 0, y = 0): ShipState {
  return createShip({
    id,
    side,
    name: id.toUpperCase(),
    form,
    placement: { position: { x, y }, heading: 0 },
    speed: 2,
  })
}

function battle(): { game: GameState; ghost: ShipState; hunter: ShipState } {
  const ghost = ship('ghost', 'Blue', PASSER, 20, 20)
  // Eight inches off: inside the cruiser's search range of ten (two SCNC
  // boxes at five inches each, H6.9.1).
  const hunter = ship('hunter', 'Red', VALLARI, 20, 28)
  const game = createGame({ scenario: THE_DUEL, ships: [ghost, hunter], seed: 12 })
  return { game, ghost, hunter }
}

/** Fill the CLOAK line and engage, out of everyone's range 8 (H6.3.1, H6.6.3). */
function cloak(game: GameState, s: ShipState): void {
  const line = s.form.functions.find((l) => l.label === 'CLOAK')!
  s.allocation[line.id] = line.steps.length
  engageCloak(s, cloakOf(game, s)!, [])
}

describe('shields while cloaked (H6.4.1)', () => {
  it('lets damage from any source straight through, not just weapon fire', () => {
    const { game, ghost } = battle()
    const before = blueShieldRemaining(ghost, 'F')
    expect(before).toBeGreaterThan(0)

    cloak(game, ghost)
    // A volley that says nothing about shields — terrain, an exploding
    // neighbour, anything that never went through a firing solution.
    const outcome = applyVolley(
      ghost,
      { standard: 3, leak: 0, structurePenetration: 0, side: 'F' },
      damageContext(game),
    )
    expect(outcome.greenAbsorbed + outcome.blueAbsorbed).toBe(0)
    expect(blueShieldRemaining(ghost, 'F')).toBe(before)
  })

  it('still lets an uncloaked ship use its shields', () => {
    const { game, hunter } = battle()
    const outcome = applyVolley(
      hunter,
      { standard: 3, leak: 0, structurePenetration: 0, side: 'F' },
      damageContext(game),
    )
    expect(outcome.blueAbsorbed).toBeGreaterThan(0)
  })

  it('refuses to raise a shield while the cloak runs', () => {
    const { game, ghost } = battle()
    ghost.shieldsDown.F = true
    cloak(game, ghost)
    expect(setShieldDown(game, ghost, 'F', false)).toMatch(/cannot raise shields/)
    expect(ghost.shieldsDown.F).toBe(true)
  })

  it('lets a ship lower one, which costs nothing it still has', () => {
    const { game, ghost } = battle()
    cloak(game, ghost)
    expect(setShieldDown(game, ghost, 'F', true)).toBeNull()
  })
})

describe('the systems a cloak switches off (H6.4)', () => {
  it('stops information scans (H6.4.3)', () => {
    const { game, ghost, hunter } = battle()
    cloak(game, ghost)
    expect(performScan(game, ghost, hunter.id).refusal).toMatch(/H6\.4\.3/)
  })

  it('stops tractor beams in both directions (H6.4.7)', () => {
    const { game, ghost, hunter } = battle()
    cloak(game, ghost)
    expect(attemptTractorLock(game, ghost, hunter.id, 1).refusal).toMatch(/H6\.4\.7/)
    expect(attemptTractorLock(game, hunter, ghost.id, 1).refusal).toMatch(/H6\.4\.7/)
  })

  it('stops transporters in both directions (H6.4.8)', () => {
    const { game, ghost, hunter } = battle()
    cloak(game, ghost)
    expect(performTransport(game, ghost, hunter, 1).refusal).toMatch(/H6\.4\.8/)
    expect(performTransport(game, hunter, ghost, 1).refusal).toMatch(/H6\.4\.8/)
  })

  it('stops a cloaked flagship lending tactical scan points (H6.4.10)', () => {
    const ghost = ship('ghost', 'Blue', PASSER, 20, 20)
    const friend = ship('friend', 'Blue', VALLARI, 22, 20)
    const game = createGame({ scenario: THE_DUEL, ships: [ghost, friend], seed: 3 })
    applyAction(game, { type: 'set-command-ship', side: 'Blue', shipId: ghost.id })
    cloak(game, ghost)
    const refused = applyAction(game, {
      type: 'assign-command',
      side: 'Blue',
      targetId: friend.id,
      points: 1,
    })
    expect(refused.message).toMatch(/H6\.4\.10/)
  })
})

describe('a cloak does not hunt (H6.9.5)', () => {
  it('refuses a cloaked ship the search it would otherwise be allowed', () => {
    const { game, ghost, hunter } = battle()
    // Both sides in the dark: the rulebook calls this a submarine engagement
    // and declines to model it.
    cloak(game, ghost)
    const line = hunter.form.functions.find((l) => l.label === 'CLOAK')
    if (line) {
      hunter.allocation[line.id] = line.steps.length
      engageCloak(hunter, cloakOf(game, hunter)!, [])
      const refused = applyAction(game, {
        type: 'cloak-search',
        shipId: hunter.id,
        ghostId: ghost.id,
      })
      expect(refused.message).toMatch(/H6\.9\.5/)
    }
  })

  it('lets an uncloaked hunter search as normal', () => {
    const { game, ghost, hunter } = battle()
    cloak(game, ghost)
    const out = applyAction(game, { type: 'cloak-search', shipId: hunter.id, ghostId: ghost.id })
    // Hit or miss, the roll was allowed to happen.
    expect(out.message ?? '').not.toContain('H6.9.5')
    expect(game.log.some((l) => l.message.includes('searches for'))).toBe(true)
  })
})

describe('minimum cloak time (H6.6.7)', () => {
  it('is enforced by the engine, not just greyed out in the panel', () => {
    const { game, ghost } = battle()
    cloak(game, ghost)
    const early = applyAction(game, { type: 'decloak', shipId: ghost.id })
    expect(early.message).toMatch(/full phase/)
    expect(shipIsCloaked(game, ghost)).toBe(true)

    // A phase later it comes off without argument.
    for (let i = 0; i < 40 && cloakOf(game, ghost)!.phasesCloaked < 1; i++) advanceSegment(game)
    expect(applyAction(game, { type: 'decloak', shipId: ghost.id }).message).toBeNull()
    expect(shipIsCloaked(game, ghost)).toBe(false)
  })
})

describe('maneuvering in the dark (H6.8.5)', () => {
  it('refuses anything sharper than a standard turn while undetected', () => {
    const { game, ghost } = battle()
    game.orders[ghost.id] = defaultCommandCard(ghost)
    cloak(game, ghost)

    const hard = applyAction(game, {
      type: 'plot-maneuver',
      shipId: ghost.id,
      maneuver: 'hard',
      direction: 'left',
    })
    expect(hard.message).toMatch(/H6\.8\.5/)
    expect(game.orders[ghost.id].maneuver).not.toBe('hard')

    for (const maneuver of ['straight', 'slide', 'easy', 'standard'] as const) {
      expect(
        applyAction(game, { type: 'plot-maneuver', shipId: ghost.id, maneuver, direction: 'right' })
          .message,
      ).toBeNull()
    }
  })

  it('gives up a turn plotted before the cloak engaged', () => {
    const { game, ghost } = battle()
    // The card is written in the Command Segment and the cloak goes on in
    // Operations, which is after it — so a hard turn can reach Navigation on
    // a ship that is by then invisible.
    while (game.segment !== 'navigation') advanceSegment(game)
    game.orders[ghost.id] = { ...defaultCommandCard(ghost), maneuver: 'hard', direction: 'left' }
    cloak(game, ghost)

    advanceSegment(game)
    expect(game.log.some((l) => l.message.includes('H6.8.5'))).toBe(true)
    expect(game.orders[ghost.id].maneuver).toBe('straight')
  })

  it('leaves an uncloaked helm alone', () => {
    const { game, hunter } = battle()
    game.orders[hunter.id] = defaultCommandCard(hunter)
    expect(
      applyAction(game, {
        type: 'plot-maneuver',
        shipId: hunter.id,
        maneuver: 'hard',
        direction: 'left',
      }).message,
    ).toBeNull()
  })
})

describe('events that give a cloaked ship away (H6.15)', () => {
  it('hands every hunter in range a roll when the ship runs above speed 2 (H6.15.2)', () => {
    const { game, ghost } = battle()
    game.orders[ghost.id] = defaultCommandCard(ghost)
    cloak(game, ghost)
    ghost.speed = 5

    while (game.segment !== 'navigation') advanceSegment(game)
    advanceSegment(game)
    expect(game.log.some((l) => l.message.includes('speed 5'))).toBe(true)
  })

  it('says nothing at all when the ship keeps to speed 2', () => {
    const { game, ghost } = battle()
    game.orders[ghost.id] = defaultCommandCard(ghost)
    cloak(game, ghost)
    ghost.speed = 2

    while (game.segment !== 'navigation') advanceSegment(game)
    advanceSegment(game)
    expect(game.log.some((l) => l.message.includes('H6.15'))).toBe(false)
  })

  it('hands out a roll for every four points of damage taken (H6.15.3)', () => {
    const { game, ghost } = battle()
    cloak(game, ghost)
    damageRevealsCloak(game, ghost, 8)
    const line = game.log.find((l) => l.message.includes('8 damage taken'))
    expect(line).toBeTruthy()
    expect(line!.message).toContain('H6.15')
  })

  it('says nothing for a scratch under four points', () => {
    const { game, ghost } = battle()
    cloak(game, ghost)
    damageRevealsCloak(game, ghost, 3)
    expect(game.log.some((l) => l.message.includes('damage taken'))).toBe(false)
  })

  it('says nothing about a ship that is not cloaked at all', () => {
    const { game, hunter } = battle()
    damageRevealsCloak(game, hunter, 12)
    expect(game.log.some((l) => l.message.includes('H6.15'))).toBe(false)
  })
})

describe('the long approach (H6.8.7)', () => {
  it('refuses a ship that has not been cloaked long enough', () => {
    const { game, ghost } = battle()
    cloak(game, ghost)
    expect(
      repositionCloaked(game, ghost, { position: { x: 25, y: 25 }, heading: 90 }, 2),
    ).toMatch(/18 phases/)
  })

  it('lets an eighteen-phase ship appear within 18 inches of its datum, and decloak doing it', () => {
    const { game, ghost } = battle()
    cloak(game, ghost)
    cloakOf(game, ghost)!.speedLog = new Array(18).fill(2)

    expect(
      repositionCloaked(game, ghost, { position: { x: 28, y: 26 }, heading: 90 }, 2),
    ).toBeNull()
    expect(ghost.placement.position).toEqual({ x: 28, y: 26 })
    expect(ghost.speed).toBe(2)
    expect(shipIsCloaked(game, ghost)).toBe(false)
  })

  it('holds it to the circle and to speed 2', () => {
    const { game, ghost } = battle()
    cloak(game, ghost)
    cloakOf(game, ghost)!.speedLog = new Array(18).fill(2)

    expect(
      repositionCloaked(game, ghost, { position: { x: 90, y: 90 }, heading: 0 }, 2),
    ).toMatch(/18" of the datum/)
    expect(
      repositionCloaked(game, ghost, { position: { x: 22, y: 22 }, heading: 0 }, 5),
    ).toMatch(/speed 0 to 2/)
  })
})
