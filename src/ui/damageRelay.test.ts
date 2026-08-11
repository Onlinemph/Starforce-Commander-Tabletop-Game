import { beforeEach, describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from '../engine/actions'
import { defaultCommandCard, type GameState } from '../engine/game'
import { arcTo, canBearOn } from '../engine/geometry'
import { SHIELD_SIDES, type ShipState } from '../engine/shipState'
import { stateHash } from '../engine/stateHash'
import {
  answerDamageDecision,
  currentSave,
  dispatch,
  dispatchWithChoices,
  getGame,
  newGame,
  pendingDamageDecision,
  setMatchPresence,
  setMatchSide,
  undoRefusal,
} from './store'

/**
 * The damage-choice relay (playtest report 7).
 *
 * The cards hand their choices to the defender (E8.4.1), but the console that
 * resolves a volley is the attacker's — in an online match it cannot stop
 * mid-resolution to ask a browser on the other side of the wire. Report 7 is
 * what happened without a relay: the Yorktown took two choice cards from the
 * Karnath's return fire and its own captain was never asked, because the
 * volley resolved on the other console and doctrine answered for them.
 *
 * The relay stages the action in the journal with the answers gathered so
 * far; the defending console prompts its own player and lands it. These tests
 * pin the hold (nothing moves mid-relay), the handoff (the defender's console
 * is the one asked), and that the relayed journal replays exactly.
 */

// ---------------------------------------------------------------------------
// The engine's half: the stage as a game state
// ---------------------------------------------------------------------------

function duel(seed = 5): GameState {
  return startScenario('s3.1-the-duel', { seed })
}

describe('a staged action holds the battle', () => {
  const stage = (game: GameState): ReturnType<typeof applyAction> =>
    applyAction(game, {
      type: 'stage-damage-action',
      action: { type: 'pass-fire', shipId: game.ships[0].id },
      choices: [],
      awaiting: 'Blue Force',
    })

  it('refuses every other action until the answers land', () => {
    const game = duel()
    stage(game)
    expect(game.stagedAction).not.toBeNull()

    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const refused = applyAction(game, { type: 'rename-ship', shipId: blue.id, name: 'Held' })
    expect(refused.message).toMatch(/choosing where the damage falls/)
    expect(blue.name).not.toBe('Held')
    // The sequence of play is held too, ready signals included.
    expect(
      applyAction(game, { type: 'signal-ready', side: 'Blue Force', ready: true }).message,
    ).toMatch(/choosing where the damage falls/)
  })

  it('lands the inner action, with the script, when resolved', () => {
    const game = duel()
    stage(game)
    const resolved = applyAction(game, { type: 'resolve-staged-action', choices: [] })
    expect(resolved.message).toBeNull()
    expect(game.stagedAction).toBeNull()
    // The inner pass-fire genuinely applied.
    expect(game.firedThisSegment.has(game.ships[0].id)).toBe(true)
  })

  it('refuses a resolve with nothing staged, and an envelope inside an envelope', () => {
    const game = duel()
    expect(applyAction(game, { type: 'resolve-staged-action', choices: [] }).message).toMatch(
      /No held action/,
    )
    const nested: GameAction = {
      type: 'stage-damage-action',
      action: { type: 'resolve-staged-action', choices: [] },
      choices: [],
      awaiting: 'Blue Force',
    }
    expect(applyAction(game, nested).message).toMatch(/cannot be staged/)
    expect(game.stagedAction).toBeNull()
  })

  it('holds one action at a time — a second volley cannot clobber the first', () => {
    const game = duel()
    stage(game)
    const first = game.stagedAction
    // Two consoles fired in the same instant; the second stage arrives
    // carrying a different action. Refused — the first held volley stands.
    const rival: GameAction = {
      type: 'stage-damage-action',
      action: { type: 'pass-fire', shipId: game.ships[1].id },
      choices: [],
      awaiting: 'Red Force',
    }
    expect(applyAction(game, rival).message).toMatch(/choosing where the damage falls/)
    expect(game.stagedAction).toBe(first)
    // The relay extending its own script is not a rival: same action, longer
    // script, passes.
    const extension: GameAction = {
      type: 'stage-damage-action',
      action: { type: 'pass-fire', shipId: game.ships[0].id },
      choices: [{ kind: 'any-hit', hit: 'sensors' }],
      awaiting: 'Blue Force',
    }
    expect(applyAction(game, extension).message).toMatch(/Waiting for Blue Force/)
    expect(game.stagedAction?.choices).toHaveLength(1)
  })

  it('narrates the hold and each handoff, not every extension', () => {
    const game = duel()
    stage(game)
    const holds = () =>
      game.log.filter((l) => l.message.includes('choosing where the damage falls')).length
    expect(holds()).toBe(1)
    // Same side answers more cards: the script grows, the log does not.
    applyAction(game, {
      type: 'stage-damage-action',
      action: { type: 'pass-fire', shipId: game.ships[0].id },
      choices: [{ kind: 'any-hit', hit: 'sensors' }],
      awaiting: 'Blue Force',
    })
    expect(holds()).toBe(1)
    // The cards bounce the choice across the table: that is worth a line.
    applyAction(game, {
      type: 'stage-damage-action',
      action: { type: 'pass-fire', shipId: game.ships[0].id },
      choices: [{ kind: 'any-hit', hit: 'sensors' }],
      awaiting: 'Red Force',
    })
    expect(holds()).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// The store's half: the relay between consoles
// ---------------------------------------------------------------------------

/**
 * The report's battle, restaged: attacker at knife range, every mount armed,
 * and the defender's shields and armor already gone so the volley goes
 * straight to damage cards — the cards are where the choices live.
 */
function stageableDuel(seed: number): { blue: ShipState; red: ShipState } {
  newGame({ scenarioId: 's3.1-the-duel', seed })
  const game = getGame()
  const blue = game.ships.find((s) => s.side === 'Blue Force')!
  const red = game.ships.find((s) => s.side === 'Red Force')!
  blue.placement = { position: { x: 15, y: 18 }, heading: 0 }
  red.placement = { position: { x: 15, y: 14 }, heading: 180 }
  for (const ship of [blue, red]) {
    for (const weapon of ship.form.weapons) {
      weapon.mounts.forEach((mount, i) => {
        ship.mounts[weapon.id][i].armed = mount.armingCircles
      })
    }
    game.orders[ship.id] = defaultCommandCard(ship)
  }
  // The attacker fires alone — no H2.4.2 tie to hold the volley.
  red.sensors = { targeting: 0, jamming: 0, tacticalScan: 3 }
  blue.sensors = { targeting: 0, jamming: 0, tacticalScan: 1 }
  for (const side of SHIELD_SIDES) {
    blue.blueShieldDamage[side] = 99
    blue.armorDamage[side] = 99
  }
  game.phase = 'combat-1'
  game.segment = 'combat'
  return { blue, red }
}

/** Every armed mount that can actually bear on the target from here. */
function bearingMounts(attacker: ShipState, target: ShipState) {
  const arcs = arcTo(
    attacker.placement.position,
    attacker.placement.heading,
    target.placement.position,
  )
  return attacker.form.weapons.flatMap((weapon) =>
    weapon.mounts.flatMap((mount, mountIndex) => {
      if (attacker.mounts[weapon.id][mountIndex].armed < mount.armingCircles) return []
      if (!canBearOn(mount.arcs, arcs)) return []
      return [{ weaponId: weapon.id, mountIndex }]
    }),
  )
}

const fireOn = (attacker: ShipState, target: ShipState) =>
  dispatchWithChoices({
    type: 'fire-volley',
    attackerId: attacker.id,
    targetId: target.id,
    mounts: bearingMounts(attacker, target),
    mode: 'standard',
    degraded: false,
  })

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Internal damage actually marked on the sheet — zero until a card lands. */
const marks = (ship: ShipState) =>
  Object.values(ship.systemDamage).reduce((a, b) => a + b, 0) +
  ship.structureDamaged.filter(Boolean).length

describe('the relay between consoles', () => {
  beforeEach(() => {
    setMatchSide(null)
    setMatchPresence([], false)
  })

  it('stages the volley instead of answering for the other player, then asks them', async () => {
    const { blue, red } = stageableDuel(12)
    setMatchPresence(['Blue Force', 'Red Force'], false)
    setMatchSide('Red Force')

    // ── The attacker's console ──
    const outcome = await fireOn(red, blue)
    const game = getGame()
    expect(outcome.message).toMatch(/Waiting for Blue Force/)
    expect(game.stagedAction?.awaiting).toBe('Blue Force')
    // Nothing landed: the defender is untouched and the volley rolled no dice
    // anyone has seen.
    expect(outcome.volley).toBeUndefined()
    expect(marks(blue)).toBe(0)
    // And the battle holds — the attacker cannot act while the cards wait.
    expect(dispatch({ type: 'pass-fire', shipId: red.id }).message).toMatch(
      /choosing where the damage falls/,
    )
    expect(undoRefusal()).toMatch(/Damage is being allocated/)

    // ── The defender's console ── (same store, side swapped: the journal
    // carried the stage across, and claiming the side picks the relay up.)
    setMatchSide('Blue Force')
    let answered = 0
    for (let guard = 0; guard < 40 && getGame().stagedAction; guard++) {
      await tick()
      const decision = pendingDamageDecision()
      if (!decision) continue
      // Every question put at this console is about this console's own ship.
      expect(decision.shipId).toBe(blue.id)
      const pick = decision.options.find((o) => o.recommended) ?? decision.options[0]
      answerDamageDecision(pick.choice)
      answered += 1
    }
    expect(getGame().stagedAction).toBeNull()
    expect(answered).toBeGreaterThan(0)
    // The volley landed, on the defender's answers.
    expect(marks(blue)).toBeGreaterThan(0)
    const journal = currentSave().actions
    expect(journal.some((a) => a.type === 'stage-damage-action')).toBe(true)
    expect(journal.at(-1)?.type).toBe('resolve-staged-action')

    setMatchSide(null)
  })

  it('applies the relayed actions identically on every console', () => {
    // Two consoles, same journal: the guest does not re-decide anything, it
    // applies the same stage and the same resolve — and lands the same battle,
    // dice, cards and answers included.
    const build = () => {
      const game = startScenario('s3.1-the-duel', { seed: 12 })
      const blue = game.ships.find((s) => s.side === 'Blue Force')!
      const red = game.ships.find((s) => s.side === 'Red Force')!
      blue.placement = { position: { x: 15, y: 18 }, heading: 0 }
      red.placement = { position: { x: 15, y: 14 }, heading: 180 }
      for (const ship of [blue, red]) {
        for (const weapon of ship.form.weapons) {
          weapon.mounts.forEach((mount, i) => {
            ship.mounts[weapon.id][i].armed = mount.armingCircles
          })
        }
        game.orders[ship.id] = defaultCommandCard(ship)
      }
      red.sensors = { targeting: 0, jamming: 0, tacticalScan: 3 }
      blue.sensors = { targeting: 0, jamming: 0, tacticalScan: 1 }
      for (const side of SHIELD_SIDES) {
        blue.blueShieldDamage[side] = 99
        blue.armorDamage[side] = 99
      }
      game.phase = 'combat-1'
      game.segment = 'combat'
      return { game, blue, red }
    }

    const host = build()
    const guest = build()
    const relay: GameAction[] = [
      {
        type: 'stage-damage-action',
        action: {
          type: 'fire-volley',
          attackerId: host.red.id,
          targetId: host.blue.id,
          mounts: bearingMounts(host.red, host.blue),
          mode: 'standard',
          degraded: false,
        },
        choices: [],
        awaiting: 'Blue Force',
      },
      // A racing action refused during the hold — refused identically on both.
      { type: 'pass-fire', shipId: host.red.id },
      { type: 'resolve-staged-action', choices: [{ kind: 'any-hit', hit: 'sensors' }] },
    ]
    for (const action of relay) applyAction(host.game, structuredClone(action))
    for (const action of relay) applyAction(guest.game, structuredClone(action))
    expect(host.game.stagedAction).toBeNull()
    expect(stateHash(host.game)).toBe(stateHash(guest.game))
    expect(marks(host.blue)).toBeGreaterThan(0)
  })

  it('lets the creator cover a chooser whose chair is empty', async () => {
    const { blue, red } = stageableDuel(12)
    // Blue is connected when the volley fires, so it stages…
    setMatchPresence(['Blue Force', 'Red Force'], true)
    setMatchSide('Red Force')
    await fireOn(red, blue)
    expect(getGame().stagedAction?.awaiting).toBe('Blue Force')

    // …and then Blue's tab closes. The creator's console answers by doctrine
    // rather than freezing the battle forever — the same cover it gives the
    // ready gate's empty chairs.
    setMatchPresence(['Red Force'], true)
    for (let guard = 0; guard < 10 && getGame().stagedAction; guard++) await tick()
    expect(getGame().stagedAction).toBeNull()
    expect(marks(blue)).toBeGreaterThan(0)
    setMatchSide(null)
  })

  it('settles locally after leaving a match mid-relay, instead of bricking the battle', async () => {
    const { blue, red } = stageableDuel(12)
    setMatchPresence(['Blue Force', 'Red Force'], false)
    setMatchSide('Red Force')
    await fireOn(red, blue)
    expect(getGame().stagedAction?.awaiting).toBe('Blue Force')

    // The player leaves the match with the cards still in the air. Nobody is
    // coming to answer, and every action is refused until somebody does — so
    // the console settles it as the solo game it now is, prompting for the
    // human ships the way hot-seat play always has.
    setMatchPresence([], false)
    setMatchSide(null)
    for (let guard = 0; guard < 40 && getGame().stagedAction; guard++) {
      await tick()
      const decision = pendingDamageDecision()
      if (decision) answerDamageDecision(decision.options[0].choice)
    }
    expect(getGame().stagedAction).toBeNull()
    expect(marks(blue)).toBeGreaterThan(0)
  })

  it('answers by doctrine outright when the defender was never connected', async () => {
    const { blue, red } = stageableDuel(12)
    // Only the attacker is present — hot-seat testing a match alone, or the
    // opponent yet to join. Staging would wait on nobody; doctrine answers.
    setMatchPresence(['Red Force'], true)
    setMatchSide('Red Force')
    const outcome = await fireOn(red, blue)
    expect(getGame().stagedAction).toBeNull()
    expect(outcome.volley).toBeDefined()
    expect(marks(blue)).toBeGreaterThan(0)
    setMatchSide(null)
  })
})
