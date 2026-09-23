import { describe, expect, it } from 'vitest'
import { findShipForm, VALLARI_CRUISER } from '../data/ships'
import { THE_DUEL } from '../data/scenarios'
import { applyAction } from './actions'
import { resolveVolley } from './combat'
import { engageCloak, mayDecloak } from './cloaking'
import {
  advanceSegment,
  cloakModifiers,
  cloakOf,
  cloudModifiers,
  createGame,
  damageContext,
  dockShuttle,
  recoverShuttle,
  shipIsCloaked,
  type GameState,
} from './game'
import { createShip, type ShipState } from './shipState'
import type { SmallCraft } from './smallCraft'

/**
 * Rules-audit fixes: cloaking (H6), sensors and scout sensors (H1–H3).
 *
 * Each `describe` below is one finding from the audit's H.md. The rule cited
 * in the title is the one the engine was getting wrong; see the fix itself
 * (cited inline) for the mechanism.
 *
 * Every fix here tightens what the engine accepts or changes an outcome, so
 * each one is gated behind `rulesVersion >= 3` (see `CURRENT_RULES_VERSION`
 * in `src/data/savedGame.ts`) — a battle journal is a record of actions,
 * including refused ones, and it must keep replaying exactly as it was
 * fought. Games below are stamped `rulesVersion: 3` to exercise the fix; the
 * final `describe` checks the gate holds for an unstamped (reading 1) game.
 */

const PASSER = findShipForm('PASSER I-class Frigate')!
const VALLARI = VALLARI_CRUISER

function ship(args: {
  id: string
  side?: string
  form?: typeof PASSER
  x?: number
  y?: number
  heading?: number
}): ShipState {
  return createShip({
    id: args.id,
    side: args.side ?? 'Blue',
    name: args.id.toUpperCase(),
    form: args.form ?? PASSER,
    placement: { position: { x: args.x ?? 0, y: args.y ?? 0 }, heading: args.heading ?? 0 },
    speed: 2,
  })
}

/** Fill the CLOAK line and engage, with no enemies to seed a free Contact. */
function cloak(game: GameState, s: ShipState): void {
  const line = s.form.functions.find((l) => l.label === 'CLOAK')!
  s.allocation[line.id] = line.steps.length
  engageCloak(s, cloakOf(game, s)!, [], game.rulesVersion)
}

/** Walk the sequence of play until the predicate holds. */
function runTo(game: GameState, predicate: (g: GameState) => boolean, limit = 300): void {
  let steps = 0
  while (!predicate(game) && steps++ < limit) advanceSegment(game)
  if (steps >= limit) throw new Error('sequence did not reach the target state')
}

// ---------------------------------------------------------------------------
// H6.6.7 / H6.7.7 — minimum cloak and uncloak time is two phase-ticks
// ---------------------------------------------------------------------------

describe('minimum cloak and uncloak time (H6.6.7, H6.7.7)', () => {
  function battle(): { game: GameState; ghost: ShipState } {
    const ghost = ship({ id: 'ghost' })
    const hunter = ship({ id: 'hunter', side: 'Red', form: VALLARI, y: -30 })
    const game = createGame({ scenario: THE_DUEL, ships: [ghost, hunter], seed: 21, rulesVersion: 3 })
    const line = ghost.form.functions.find((l) => l.label === 'CLOAK')!
    ghost.allocation[line.id] = line.steps.length
    return { game, ghost }
  }

  /**
   * The rulebook's own worked example: engaged in Phase 3, the cloak must
   * hold through all of Phase 1 of the next round, and the earliest it may
   * come off is Phase 2 — two phase-boundary ticks of `phasesCloaked`, not
   * one that the engine used to require.
   */
  it('engaged in Phase 3 cannot come off until Phase 2 of the next round', () => {
    const { game, ghost } = battle()
    runTo(game, (g) => g.round === 1 && g.phase === 'combat-3')
    engageCloak(ghost, cloakOf(game, ghost)!, [], game.rulesVersion)

    runTo(game, (g) => g.round === 2 && g.phase === 'combat-1' && g.segment === 'command')
    expect(mayDecloak(cloakOf(game, ghost)!, game.rulesVersion)).toBe(false)
    expect(applyAction(game, { type: 'decloak', shipId: ghost.id }).message).toMatch(/H6\.6\.7/)

    runTo(game, (g) => g.round === 2 && g.phase === 'combat-2' && g.segment === 'command')
    expect(mayDecloak(cloakOf(game, ghost)!, game.rulesVersion)).toBe(true)
    expect(applyAction(game, { type: 'decloak', shipId: ghost.id }).message).toBeNull()
  })

  /**
   * The symmetric worked example: switched off in Phase 1, it must stay off
   * through Phase 2 and may only come back on in Phase 3.
   */
  it('switched off in Phase 1 cannot re-engage until Phase 3', () => {
    const { game, ghost } = battle()
    // Two ticks served by the top of the next round's Phase 1, so the
    // decloak below lands cleanly.
    runTo(game, (g) => g.round === 1 && g.phase === 'combat-2')
    engageCloak(ghost, cloakOf(game, ghost)!, [], game.rulesVersion)

    runTo(game, (g) => g.round === 2 && g.phase === 'combat-1' && g.segment === 'command')
    expect(applyAction(game, { type: 'decloak', shipId: ghost.id }).message).toBeNull()

    runTo(game, (g) => g.round === 2 && g.phase === 'combat-2' && g.segment === 'command')
    expect(engageCloak(ghost, cloakOf(game, ghost)!, [], game.rulesVersion).reason).toMatch(/H6\.7\.7/)

    runTo(game, (g) => g.round === 2 && g.phase === 'combat-3' && g.segment === 'command')
    expect(engageCloak(ghost, cloakOf(game, ghost)!, [], game.rulesVersion).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// H6.4.5 / H6.14.4 — a cloaked target's jamming no longer reduces range
// ---------------------------------------------------------------------------

describe("a cloaked target's jamming stops padding the attacker's effective range (H6.4.5, H6.14.4)", () => {
  const DISRUPTOR_ID = 'type-41-gravitic-disruptor-2'

  /** Attacker at (0,0) firing on a cloaked target 10" away, holding `detection`. */
  function fire(detection: 2 | 3) {
    const hunter = ship({ id: 'hunter', side: 'Red', form: VALLARI })
    const ghost = ship({ id: 'ghost', y: -10 })
    hunter.sensors.targeting = 3
    ghost.sensors.jamming = 6
    const game = createGame({ scenario: THE_DUEL, ships: [hunter, ghost], seed: 8, rulesVersion: 3 })
    cloak(game, ghost)
    cloakOf(game, ghost)!.detection[hunter.id] = detection

    const weapon = hunter.form.weapons.find((w) => w.id === DISRUPTOR_ID)!
    hunter.mounts[weapon.id][0].armed = weapon.mounts[0].armingCircles

    return resolveVolley(
      {
        attacker: hunter,
        target: ghost,
        mounts: [{ weaponId: weapon.id, mountIndex: 0 }],
        mode: 'standard',
        ...cloakModifiers(game, hunter, ghost),
        ...cloudModifiers(game, hunter, ghost),
      },
      damageContext(game),
      game.rng,
    )
  }

  it('gives a degraded Track shot the true range, not range plus jamming (H6.4.5)', () => {
    const result = fire(2)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Degraded fire control already zeroes the attacker's targeting
    // (H6.14.3); before this fix the target's jamming of 6 would have pushed
    // this to 16" — off the weapon's chart entirely.
    expect(result.effectiveRange).toBe(10)
  })

  it('gives a Target Lock shot "no firing penalties", not a jammed range band (H6.14.4)', () => {
    const result = fire(3)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 10" actual minus 3 targeting, with the jamming zeroed; before this fix
    // it would have been 10 + 6 - 3 = 13", a worse bracket on the same chart.
    expect(result.effectiveRange).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// H6.9.2 — one search attempt per phase belongs to the searcher
// ---------------------------------------------------------------------------

describe('one search attempt per phase is a searcher budget, not a per-target one (H6.9.2)', () => {
  it('refuses a second cloaked ship once the searcher has already rolled this phase', () => {
    const hunter = ship({ id: 'hunter', side: 'Red', form: VALLARI })
    const ghost1 = ship({ id: 'ghost1', y: -8 })
    const ghost2 = ship({ id: 'ghost2', y: 8 })
    const game = createGame({ scenario: THE_DUEL, ships: [hunter, ghost1, ghost2], seed: 6, rulesVersion: 3 })
    cloak(game, ghost1)
    cloak(game, ghost2)

    const first = applyAction(game, { type: 'cloak-search', shipId: hunter.id, ghostId: ghost1.id })
    expect(first.message).not.toMatch(/H6\.9\.2/)
    expect(game.log.some((l) => l.message.includes('searches for'))).toBe(true)

    const second = applyAction(game, { type: 'cloak-search', shipId: hunter.id, ghostId: ghost2.id })
    expect(second.message).toMatch(/H6\.9\.2/)
  })

  it('frees the budget again the following phase', () => {
    const hunter = ship({ id: 'hunter', side: 'Red', form: VALLARI })
    const ghost1 = ship({ id: 'ghost1', y: -8 })
    const ghost2 = ship({ id: 'ghost2', y: 8 })
    const game = createGame({ scenario: THE_DUEL, ships: [hunter, ghost1, ghost2], seed: 6, rulesVersion: 3 })
    cloak(game, ghost1)
    cloak(game, ghost2)

    applyAction(game, { type: 'cloak-search', shipId: hunter.id, ghostId: ghost1.id })
    expect(game.ops.cloakSearchedThisPhase.has(hunter.id)).toBe(true)

    // The budget clears with the phase (H6.9.2), at the next Delayed Action
    // segment — reached once the game has moved into the following phase.
    runTo(game, (g) => g.phase === 'combat-2', 30)
    expect(game.ops.cloakSearchedThisPhase.has(hunter.id)).toBe(false)
    const again = applyAction(game, { type: 'cloak-search', shipId: hunter.id, ghostId: ghost2.id })
    expect(again.message).not.toMatch(/H6\.9\.2/)
  })
})

// ---------------------------------------------------------------------------
// H6.4.9 — small craft cannot land on a cloaked ship
// ---------------------------------------------------------------------------

describe('small craft cannot land on a cloaked ship (H6.4.9)', () => {
  function shuttle(side: string, motherId: string, near: ShipState): SmallCraft {
    return {
      id: 'craft-1',
      kind: 'shuttle',
      side,
      motherId,
      position: { ...near.placement.position },
      damage: 0,
      activated: false,
    }
  }

  it('refuses a friendly shuttle trying to land in the cloaked bay', () => {
    const ghost = ship({ id: 'ghost' })
    const game = createGame({ scenario: THE_DUEL, ships: [ghost], seed: 2, rulesVersion: 3 })
    cloak(game, ghost)
    const craft = shuttle('Blue', ghost.id, ghost)
    game.smallCraft.push(craft)

    expect(recoverShuttle(game, craft.id, ghost)).toMatch(/H6\.4\.9/)
  })

  it('refuses an enemy shuttle trying to board the cloaked ship', () => {
    const ghost = ship({ id: 'ghost' })
    const game = createGame({ scenario: THE_DUEL, ships: [ghost], seed: 2, rulesVersion: 3 })
    cloak(game, ghost)
    const craft = shuttle('Red', 'someone-else', ghost)
    game.smallCraft.push(craft)

    expect(dockShuttle(game, craft.id, ghost)).toMatch(/H6\.4\.9/)
  })

  it('still lets a shuttle land once the ship decloaks', () => {
    const ghost = ship({ id: 'ghost' })
    const game = createGame({ scenario: THE_DUEL, ships: [ghost], seed: 2, rulesVersion: 3 })
    cloak(game, ghost)
    const craft = shuttle('Blue', ghost.id, ghost)
    game.smallCraft.push(craft)
    // Serve the minimum and come off the cloak.
    cloakOf(game, ghost)!.phasesCloaked = 2
    applyAction(game, { type: 'decloak', shipId: ghost.id })
    expect(shipIsCloaked(game, ghost)).toBe(false)

    expect(recoverShuttle(game, craft.id, ghost)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// H6.9.4 — a search needs line of sight to the datum or contact
// ---------------------------------------------------------------------------

describe('a search attempt needs line of sight to the datum (H6.9.4)', () => {
  function setup() {
    const hunter = ship({ id: 'hunter', side: 'Red', form: VALLARI })
    const ghost = ship({ id: 'ghost', y: -10 })
    const game = createGame({ scenario: THE_DUEL, ships: [hunter, ghost], seed: 9, rulesVersion: 3 })
    cloak(game, ghost)
    return { game, hunter, ghost }
  }

  it('lets a search through when nothing is in the way', () => {
    const { game, hunter, ghost } = setup()
    const out = applyAction(game, { type: 'cloak-search', shipId: hunter.id, ghostId: ghost.id })
    expect(out.message).not.toMatch(/H6\.9\.4/)
    expect(game.log.some((l) => l.message.includes('searches for'))).toBe(true)
  })

  it('refuses the same search through a planet blocking the datum', () => {
    const { game, hunter, ghost } = setup()
    // Sitting on the straight line from the hunter to the ghost's datum.
    game.scenario = {
      ...game.scenario,
      terrain: [
        ...game.scenario.terrain,
        { id: 'p', kind: 'planet', name: 'Occluder', center: { x: 0, y: -5 }, radius: 2 },
      ],
    }
    const out = applyAction(game, { type: 'cloak-search', shipId: hunter.id, ghostId: ghost.id })
    expect(out.message).toMatch(/H6\.9\.4/)
    expect(game.log.some((l) => l.message.includes('searches for'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The gate itself: an unstamped (reading 1) journal keeps the old behaviour
// ---------------------------------------------------------------------------

describe('every fix above is gated behind rules reading 3', () => {
  it('keeps the one-tick cloak minimum for a reading-1 game (H6.6.7)', () => {
    const ghost = ship({ id: 'ghost' })
    // No `rulesVersion`, so this defaults to reading 1 — exactly an old,
    // unstamped save.
    const game = createGame({ scenario: THE_DUEL, ships: [ghost], seed: 5 })
    expect(game.rulesVersion).toBe(1)
    cloak(game, ghost)
    cloakOf(game, ghost)!.phasesCloaked = 1
    expect(mayDecloak(cloakOf(game, ghost)!, game.rulesVersion)).toBe(true)
  })

  it('keeps the per-ghost search budget for a reading-1 game (H6.9.2)', () => {
    const hunter = ship({ id: 'hunter', side: 'Red', form: VALLARI })
    const ghost1 = ship({ id: 'ghost1', y: -8 })
    const ghost2 = ship({ id: 'ghost2', y: 8 })
    const game = createGame({ scenario: THE_DUEL, ships: [hunter, ghost1, ghost2], seed: 6 })
    cloak(game, ghost1)
    cloak(game, ghost2)

    applyAction(game, { type: 'cloak-search', shipId: hunter.id, ghostId: ghost1.id })
    const second = applyAction(game, { type: 'cloak-search', shipId: hunter.id, ghostId: ghost2.id })
    expect(second.message).not.toMatch(/H6\.9\.2/)
  })

  it('still lets small craft land on a cloaked ship for a reading-1 game (H6.4.9)', () => {
    const ghost = ship({ id: 'ghost' })
    const game = createGame({ scenario: THE_DUEL, ships: [ghost], seed: 2 })
    cloak(game, ghost)
    const craft: SmallCraft = {
      id: 'craft-1', kind: 'shuttle', side: 'Blue', motherId: ghost.id,
      position: { ...ghost.placement.position }, damage: 0, activated: false,
    }
    game.smallCraft.push(craft)
    expect(recoverShuttle(game, craft.id, ghost)).toBeNull()
  })

  it('still lets a cloaked target’s jamming pad the attacker’s range for a reading-1 game (H6.4.5)', () => {
    const hunter = ship({ id: 'hunter', side: 'Red', form: VALLARI })
    const ghost = ship({ id: 'ghost', y: -10 })
    ghost.sensors.jamming = 6
    const game = createGame({ scenario: THE_DUEL, ships: [hunter, ghost], seed: 8 })
    cloak(game, ghost)
    cloakOf(game, ghost)!.detection[hunter.id] = 3

    const modifiers = cloakModifiers(game, hunter, ghost)
    expect(modifiers.targetJammingOverride).toBeUndefined()
  })
})
