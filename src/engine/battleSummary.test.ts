import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { battleSummary } from './battleSummary'
import { defaultCommandCard, type GameState } from './game'
import { arcTo, canBearOn } from './geometry'
import { SHIELD_SIDES, type ShipState } from './shipState'
import { woundToFraction } from './testWounds'

/**
 * The end-of-battle summary. Its deeds are mined from the battle log, so the
 * tests fire a real volley through the engine — if the log's wording drifts,
 * the mining regexes must drift with it, and this is where that shows.
 */

function armedDuel(seed = 12): { game: GameState; blue: ShipState; red: ShipState } {
  const game = startScenario('s3.1-the-duel', { seed })
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
  // The attacker fires alone, so the volley lands immediately (no H2.4.2 tie).
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

function fire(game: GameState, attacker: ShipState, target: ShipState) {
  const arcs = arcTo(attacker.placement.position, attacker.placement.heading, target.placement.position)
  const mounts = attacker.form.weapons.flatMap((weapon) =>
    weapon.mounts.flatMap((mount, mountIndex) => {
      if (attacker.mounts[weapon.id][mountIndex].armed < mount.armingCircles) return []
      if (!canBearOn(mount.arcs, arcs)) return []
      return [{ weaponId: weapon.id, mountIndex }]
    }),
  )
  return applyAction(game, {
    type: 'fire-volley',
    attackerId: attacker.id,
    targetId: target.id,
    mounts,
    mode: 'standard',
    degraded: false,
  })
}

describe('the deeds, mined from the log', () => {
  it('counts a real volley and the cards it drew, in the engine’s own words', () => {
    const { game, blue, red } = armedDuel()
    const outcome = fire(game, red, blue)
    expect(outcome.volley?.ok).toBe(true)

    const summary = battleSummary(game)
    const karnath = summary.sides
      .find((s) => s.side === 'Red Force')!
      .ships.find((s) => s.id === red.id)!
    const yorktown = summary.sides
      .find((s) => s.side === 'Blue Force')!
      .ships.find((s) => s.id === blue.id)!

    expect(karnath.volleys).toBe(1)
    expect(karnath.damageRolled).toBeGreaterThan(0)
    expect(summary.biggestVolley).toEqual({
      attacker: red.name,
      target: blue.name,
      damage: karnath.damageRolled,
    })
    // Bare hull: the whole volley went to cards, and the log said so.
    expect(yorktown.cardsTaken).toBeGreaterThan(0)
    expect(summary.totalVolleys).toBe(1)
    expect(summary.totalCards).toBe(yorktown.cardsTaken)
  })
})

describe('the verdict', () => {
  it('is “in progress” while both sides still have something to fight with', () => {
    const { game } = armedDuel()
    const summary = battleSummary(game)
    expect(summary.over).toBe(false)
    expect(summary.outcome).toMatch(/in progress/)
  })

  it('hands the field to the side left standing', () => {
    const { game, blue, red } = armedDuel()
    fire(game, red, blue)
    blue.destroyed = true
    const summary = battleSummary(game)
    expect(summary.over).toBe(true)
    // Red wrecked the only Blue hull: the field and the points agree.
    expect(summary.outcome).toBe('Red Force holds the field.')
  })

  it('counts a derelict out of the fight, and never as "destroyed damage"', () => {
    // The Aurelian Raid report that found this: the Nocturne drifted at zero
    // structure as a derelict, the forces list read "destroyed damage", and
    // the summary said the battle was still in progress against a hulk.
    const { game, red } = armedDuel()
    red.derelict = true
    const summary = battleSummary(game)
    const nocturne = summary.sides.find((s) => s.side === 'Red Force')!.ships[0]
    expect(nocturne.status).toBe('derelict')
    expect(summary.over).toBe(true)
    expect(summary.outcome).toBe('Blue Force holds the field.')
  })

  it('calls mutual destruction what it is', () => {
    const { game } = armedDuel()
    for (const ship of game.ships) ship.destroyed = true
    expect(battleSummary(game).outcome).toMatch(/Mutual destruction/)
  })

  it('separates holding the field from winning on points', () => {
    const { game, blue, red } = armedDuel()
    // Blue leaves badly mauled; Red stays but has given up more points —
    // the disengaged hull is worth less than the wrecked-in-place points
    // Red's own damage yielded. Contrive it directly: Red crippled in hit
    // points (90% of its value conceded), Blue disengaged lightly hurt (50%).
    woundToFraction(red, 0.95)
    blue.disengaged = true
    const summary = battleSummary(game)
    expect(summary.over).toBe(true)
    const bluePoints = summary.sides.find((s) => s.side === 'Blue Force')!.points
    const redPoints = summary.sides.find((s) => s.side === 'Red Force')!.points
    expect(bluePoints).toBeGreaterThan(redPoints)
    expect(summary.outcome).toBe('Red Force holds the field — but Blue Force wins on points.')
  })
})
