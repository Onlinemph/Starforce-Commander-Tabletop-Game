import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { crewIsArmed, damageLevel } from './shipState'
import { shieldsAllDown, transportCapacity, transporterRange } from './operations'
import { type GameState } from './game'
import { actualRange } from './geometry'

/**
 * Marines (J6), and the awkward truth about them.
 *
 * Boarding is unreachable against an unwilling enemy. J5.1.3 requires the
 * shields down at *both* ends of a transport and J8.2.6 step 5 requires at
 * least one down before a shuttle may dock — and `shieldsDown` is a voluntary
 * order, never a consequence of damage. So no captain, human or otherwise,
 * boards a ship that does not agree to be boarded. Measured across 32 AI-vs-AI
 * battles: not one marine squad left its own hull.
 *
 * That is the printed game, not a gap in the engine, and it is why none of
 * this can be argued with a season. What it can be argued with is the fixture
 * below: when a boarding *is* under way — a scenario that starts one, a human
 * who drops shields to beam a party across — the captain now has doctrine for
 * both ends of it instead of rolling dice until somebody dies.
 */

function boarded(seed = 3): { game: GameState; targetId: string; attacker: string } {
  const game = startScenario('s3.1-the-duel', { seed, mapScale: 2 })
  const [target, enemy] = game.ships
  game.segment = 'boarding-combat'
  game.phase = 'final'
  return { game, targetId: target.id, attacker: enemy.side }
}

describe('a captain whose ship has been boarded', () => {
  it('arms the crew when the marines can no longer hold (J6.3)', () => {
    const { game, targetId, attacker } = boarded()
    const target = game.ships.find((s) => s.id === targetId)!
    target.marineSquads = 2
    target.boarders[attacker] = 4

    const batch = aiNextActions(game, [target.side], createAiMemo(), false, 'admiral')
    const armed = batch.filter((a) => a.type === 'arm-crew')
    expect(armed).toHaveLength(1)
    applyAction(game, armed[0])
    // J6.3.1 — two improvised squads per size class, on top of what is left.
    expect(target.marineSquads).toBe(2 + 2 * target.form.sizeClass)
    expect(crewIsArmed(target)).toBe(true)
  })

  it('does not pay J6.3.4’s bill while the marines are still winning', () => {
    /*
     * Twenty rounds of no damage control, two points less power and firing
     * last is a heavy price for a fight that is already going the ship's way.
     */
    const { game, targetId, attacker } = boarded()
    const target = game.ships.find((s) => s.id === targetId)!
    target.marineSquads = 6
    target.boarders[attacker] = 2

    const batch = aiNextActions(game, [target.side], createAiMemo(), false, 'admiral')
    expect(batch.filter((a) => a.type === 'arm-crew')).toHaveLength(0)
  })
})

describe('a captain whose marines are aboard an enemy', () => {
  it('sends the squads tight quarters have no room for at the ship (J6.2.4)', () => {
    /*
     * J6.2.3 caps a side's dice at twice the enemy's squads, so with eight
     * boarders against two defenders, four of them are standing in a corridor
     * with nothing to roll. Those four attack the ship instead.
     */
    const { game, targetId, attacker } = boarded()
    const target = game.ships.find((s) => s.id === targetId)!
    target.marineSquads = 2
    target.boarders[attacker] = 8

    const batch = aiNextActions(game, [attacker], createAiMemo(), false, 'admiral')
    const sabotage = batch.find((a) => a.type === 'set-sabotage')
    expect(sabotage).toBeDefined()
    expect(sabotage!.type === 'set-sabotage' && sabotage!.squads).toBe(4)
    // And the fight itself still happens, in the same batch and after it.
    expect(batch.map((a) => a.type)).toContain('fight-boarders')
  })

  it('wrecks what it cannot take when the boarding is already lost', () => {
    const { game, targetId, attacker } = boarded()
    const target = game.ships.find((s) => s.id === targetId)!
    target.marineSquads = 8
    target.boarders[attacker] = 2

    const batch = aiNextActions(game, [attacker], createAiMemo(), false, 'admiral')
    const sabotage = batch.find((a) => a.type === 'set-sabotage')
    expect(sabotage!.type === 'set-sabotage' && sabotage!.squads).toBe(2)
  })

  it('keeps every squad in the melee while capture is still on the table', () => {
    const { game, targetId, attacker } = boarded()
    const target = game.ships.find((s) => s.id === targetId)!
    target.marineSquads = 3
    target.boarders[attacker] = 4

    const batch = aiNextActions(game, [attacker], createAiMemo(), false, 'admiral')
    expect(batch.filter((a) => a.type === 'set-sabotage')).toHaveLength(0)
  })
})

describe('boarding combat is fought once a round', () => {
  it('does not resolve a second time when the segment closes (J6.2.1)', () => {
    const { game, targetId, attacker } = boarded()
    const target = game.ships.find((s) => s.id === targetId)!
    target.marineSquads = 6
    target.boarders[attacker] = 6

    applyAction(game, { type: 'fight-boarders', targetId, side: attacker })
    const afterOne = { defenders: target.marineSquads, boarders: target.boarders[attacker] }
    // The guard is only interesting if a round was actually fought and the
    // action is still live — six against six settles nothing in one round.
    expect(game.log.some((e) => /boarding combat/.test(e.message))).toBe(true)
    expect(afterOne.defenders).toBeGreaterThan(0)
    expect(afterOne.boarders).toBeGreaterThan(0)
    applyAction(game, { type: 'advance-segment' })
    expect(target.marineSquads).toBe(afterOne.defenders)
    expect(target.boarders[attacker] ?? 0).toBe(afterOne.boarders)
  })
})

describe('the transporter boarding party', () => {
  it('keeps its shields up for a beam J5.1.3 would refuse', () => {
    /*
     * The old plan dropped all four of its own shields whenever a crippled
     * enemy came inside transporter range, then asked for a transport the
     * rule was always going to turn down because the *target's* shields were
     * up. It stood there naked for a phase to be told no.
     */
    const game = startScenario('s3.1-the-duel', { seed: 3, mapScale: 2 })
    const [attacker, cripple] = game.ships
    game.segment = 'operations'
    cripple.placement.position = { ...attacker.placement.position }
    cripple.structureDamaged = cripple.structureDamaged.map((_, i) => i < cripple.structureDamaged.length - 1)
    attacker.marineSquads = Math.max(attacker.marineSquads, 4)
    for (const side of ['F', 'A', 'P', 'S'] as const) cripple.shieldsDown[side] = false

    // Everything the old plan looked at is true: a crippled enemy, alongside,
    // and a transporter with marines to put across. Only the far end's shields
    // stop it — which is the whole point.
    expect(damageLevel(cripple)).toBe('crippled')
    expect(transportCapacity(attacker)).toBeGreaterThan(0)
    expect(actualRange(attacker.placement.position, cripple.placement.position)).toBeLessThanOrEqual(
      transporterRange(attacker, null),
    )
    expect(shieldsAllDown(cripple)).toBe(false)

    const batch = aiNextActions(game, [attacker.side], createAiMemo(), false, 'admiral')
    const dropped = batch.filter((a) => a.type === 'set-shield-down' && a.down)
    expect(dropped).toHaveLength(0)
    expect(batch.filter((a) => a.type === 'transport')).toHaveLength(0)

    // And the far end's shields really are the only thing holding it back: drop
    // them, and the boarding party goes across.
    for (const side of ['F', 'A', 'P', 'S'] as const) cripple.shieldsDown[side] = true
    const willing = aiNextActions(game, [attacker.side], createAiMemo(), false, 'admiral')
    expect(willing.filter((a) => a.type === 'transport')).toHaveLength(1)
  })
})
