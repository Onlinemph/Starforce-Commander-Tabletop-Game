import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo, type AiDifficulty } from './ai'
import { batteryPower, lineValue, type ShipState } from './shipState'
import type { GameState } from './game'

/**
 * The computer's reserve-power doctrine (B2.5).
 *
 * Measured before it shipped, one side playing it against a side that does
 * not, mirrored over the same seeds: duel at admiral **39W-23L**, squadron at
 * admiral **29W-18L**, duel at captain even. Ablated, too — holding the
 * battery back at Resource Allocation and never spending it is 32W-32L, dead
 * level, so the win is the spending and not the hoarding.
 */

function battle(optionalBatteries: boolean): { game: GameState; ship: ShipState } {
  const game = startScenario('s3.1-the-duel', { seed: 5, optionalBatteries })
  return { game, ship: game.ships[0] }
}

/** Run the computer through the segments until it stops having anything to say. */
function drive(game: GameState, difficulty: AiDifficulty = 'admiral'): GameAction[] {
  const all: GameAction[] = []
  const memos = { blue: createAiMemo(), red: createAiMemo() }
  for (let guard = 0; guard < 400; guard++) {
    let acted = false
    for (const [side, memo] of [['Blue Force', memos.blue], ['Red Force', memos.red]] as const) {
      const batch = aiNextActions(game, [side], memo, false, difficulty, 'steady', true)
      if (batch.length === 0) continue
      for (const action of batch) {
        applyAction(game, action as GameAction)
        all.push(action as GameAction)
      }
      acted = true
    }
    if (!acted) return all
  }
  throw new Error('no settle')
}

/** Wind the sequence to the first combat phase, letting the computer play it. */
function toCombat(game: GameState, difficulty: AiDifficulty = 'admiral'): GameAction[] {
  const all: GameAction[] = []
  for (let i = 0; i < 12; i++) {
    all.push(...drive(game, difficulty))
    if (game.phase === 'combat-1' && game.segment === 'command') return all
    applyAction(game, { type: 'advance-segment' })
  }
  throw new Error('never reached a combat phase')
}

describe('holding the reserve', () => {
  it('plans the round on reactor power, so a battery survives allocation', () => {
    const optional = battle(true)
    toCombat(optional.game)
    expect(batteryPower(optional.ship)).toBeGreaterThan(0)
  })

  it('spends batteries as ordinary power when the option is off', () => {
    // Without B2.5 a held battery buys nothing later, so nothing is held: the
    // allocation may spend into it exactly as the printed rules intend.
    const printed = battle(false)
    toCombat(printed.game)
    const optional = battle(true)
    toCombat(optional.game)
    const spentUnderPrintedRules = batteryPower(printed.ship) < batteryPower(optional.ship)
    const allocatedMore =
      lineValue(printed.ship, printed.ship.form.functions[0].id) >=
      lineValue(optional.ship, optional.ship.form.functions[0].id)
    expect(spentUnderPrintedRules || allocatedMore).toBe(true)
  })
})

describe('spending the reserve', () => {
  it('never at ensign rank, and never with the option off', () => {
    for (const [optionalBatteries, difficulty] of [
      [false, 'admiral'],
      [true, 'ensign'],
    ] as const) {
      const game = startScenario('s3.1-the-duel', { seed: 5, optionalBatteries })
      const actions = toCombat(game, difficulty).concat(drive(game, difficulty))
      expect(actions.some((a) => a.type === 'spend-battery')).toBe(false)
    }
  })

  it('buys a volley rather than sitting on the power', () => {
    // Played out far enough for the guns to matter, an admiral fleet under the
    // optional rules reaches for the reserve — and what it reaches for first
    // is a weapon, because a mount one circle short fires exactly as often as
    // a broken one.
    const game = startScenario('s3.1-the-duel', { seed: 5, optionalBatteries: true })
    const actions: GameAction[] = []
    for (let i = 0; i < 60; i++) {
      actions.push(...drive(game, 'admiral'))
      applyAction(game, { type: 'advance-segment' })
      if (game.round > 4) break
    }
    const spends = actions.filter((a) => a.type === 'spend-battery')
    expect(spends.length).toBeGreaterThan(0)
    // Every spend lands on a line the rules allow it to land on.
    for (const spend of spends) {
      if (spend.type !== 'spend-battery') continue
      const ship = game.ships.find((s) => s.id === spend.shipId)!
      const line = ship.form.functions.find((l) => l.id === spend.lineId)!
      expect(line.kind).not.toBe('battery-recharge')
      if (line.kind === 'weapon') {
        const weapon = ship.form.weapons.find((w) => w.id === line.weaponSystemId)!
        expect(weapon.traits).not.toContain('NoBAT')
      }
    }
  })

  it('does not reach for the reserve to recharge the reserve', () => {
    // Measured and reported rather than assumed: on these hulls the reactors
    // are fully committed by the guns and the eyes, so the recharge line never
    // gets a point and the reserve is a one-shot. What must never happen is a
    // battery spent on BTY RECH, which is a closed loop with a hole in it.
    const game = startScenario('s3.1-the-duel', { seed: 5, optionalBatteries: true })
    const actions: GameAction[] = []
    for (let i = 0; i < 60; i++) {
      actions.push(...drive(game, 'admiral'))
      applyAction(game, { type: 'advance-segment' })
      if (game.round > 3) break
    }
    for (const action of actions) {
      if (action.type !== 'spend-battery') continue
      const ship = game.ships.find((s) => s.id === action.shipId)!
      const line = ship.form.functions.find((l) => l.id === action.lineId)!
      expect(line.kind).not.toBe('battery-recharge')
    }
  })
})
