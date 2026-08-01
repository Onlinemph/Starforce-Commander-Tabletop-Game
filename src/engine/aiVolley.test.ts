import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { aiNextActions, createAiMemo } from './ai'
import { type GameState } from './game'
import { shieldsFacing } from './geometry'
import { type ShipState } from './shipState'

/**
 * Volley craft: the trained captain does not just pull every trigger — it
 * lands damage on the weak shield, keeps slow-arming heavies out of red
 * brackets, and (as the admiral) takes the scalpel to broken ships.
 */

function armEverything(ship: ShipState): void {
  for (const weapon of ship.form.weapons) {
    weapon.mounts.forEach((mount, i) => {
      ship.mounts[weapon.id][i].armed = mount.armingCircles
    })
  }
}

function combatDuel(seed = 5): GameState {
  const game = startScenario('s3.1-the-duel', { seed })
  game.phase = 'combat-1'
  game.segment = 'combat'
  for (const ship of game.ships) {
    armEverything(ship)
    ship.sensors = { targeting: 0, jamming: 0, tacticalScan: 0 }
  }
  return game
}

function fireActions(game: GameState, side: string, difficulty: 'ensign' | 'captain' | 'admiral') {
  const actions = []
  const memo = createAiMemo()
  for (let guard = 0; guard < 10; guard++) {
    const batch = aiNextActions(game, [side], memo, true, difficulty)
    if (batch.length === 0) break
    actions.push(...batch)
    break // plan only — do not apply, we inspect the volley
  }
  return actions
}

describe('weak-shield nomination (E6.2 Step 4)', () => {
  it('on an arc boundary the captain names the printed-weaker shield', () => {
    const game = combatDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    // Attacker exactly on the target's F/S shield boundary (45° off its bow).
    red.placement = { position: { x: 15, y: 15 }, heading: 0 }
    blue.placement = { position: { x: 19, y: 11 }, heading: 225 }

    const options = shieldsFacing(blue.placement.position, red.placement.position, red.placement.heading)
    expect(options.length, 'the fixture must sit on a boundary').toBeGreaterThan(1)
    const printed = (side: (typeof options)[number]) =>
      red.form.shields.blue[side] + red.form.shields.green[side]
    const weaker = [...options].sort((a, b) => printed(a) - printed(b))[0]
    expect(printed(weaker), 'the fixture needs asymmetric printed shields').toBeLessThan(
      Math.max(...options.map(printed)),
    )

    const volley = fireActions(game, 'Blue Force', 'captain').find((a) => a.type === 'fire-volley')
    expect(volley).toBeDefined()
    expect(volley && 'chosenShield' in volley && volley.chosenShield).toBe(weaker)
  })

  it('the ensign takes whatever the table gives it', () => {
    const game = combatDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    red.placement = { position: { x: 15, y: 15 }, heading: 0 }
    blue.placement = { position: { x: 19, y: 11 }, heading: 225 }
    const volley = fireActions(game, 'Blue Force', 'ensign').find((a) => a.type === 'fire-volley')
    expect(volley && 'chosenShield' in volley && volley.chosenShield).toBeUndefined()
  })
})

describe('slow-arm holdback', () => {
  it('a diamond-gated heavy stays out of a red-bracket volley', () => {
    const game = combatDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    const torpedo = blue.form.weapons.find((w) => w.weaponClass === 'a-mat-torpedo')!
    // Make the torpedoes slow-arming heavies for this fixture.
    for (const mount of torpedo.mounts) mount.roundGates = [true]
    // Deep red for everything: near the far edge of the charts.
    const redMax = Math.max(...blue.form.weapons.flatMap((w) => w.brackets.map((b) => b.max)))
    red.placement = { position: { x: 15, y: 15 }, heading: 0 }
    blue.placement = { position: { x: 15, y: 15 + Math.min(redMax - 1, 15) }, heading: 0 }

    const volley = fireActions(game, 'Blue Force', 'captain').find((a) => a.type === 'fire-volley')
    if (volley && 'mounts' in volley) {
      // If anything fires at all, the gated torpedoes are not part of it.
      expect(volley.mounts.every((m) => m.weaponId !== torpedo.id)).toBe(true)
    }
    // The ensign, meanwhile, empties everything it has.
    const eager = fireActions(game, 'Blue Force', 'ensign').find((a) => a.type === 'fire-volley')
    expect(eager && 'mounts' in eager && eager.mounts.some((m) => m.weaponId === torpedo.id)).toBe(
      true,
    )
  })
})

describe('the admiral’s scalpel (E9)', () => {
  it('precision-fires the weapons section of a broken ship at knife range', () => {
    const game = combatDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    red.placement = { position: { x: 15, y: 12 }, heading: 0 }
    blue.placement = { position: { x: 15, y: 16 }, heading: 0 }
    // Broken target, and only the PREC phasers armed — no mixing (E9.2.1).
    red.structureDamaged = red.structureDamaged.map((_, i, all) => i < all.length * 0.8)
    const torpedo = blue.form.weapons.find((w) => w.weaponClass === 'a-mat-torpedo')!
    torpedo.mounts.forEach((_, i) => {
      blue.mounts[torpedo.id][i].armed = 0
    })

    const volley = fireActions(game, 'Blue Force', 'admiral').find((a) => a.type === 'fire-volley')
    expect(volley).toBeDefined()
    expect(volley && 'mode' in volley && volley.mode).toBe('precision')
    expect(volley && 'precisionSection' in volley && volley.precisionSection).toBe('weapons')
  })
})
