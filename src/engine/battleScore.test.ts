import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { health } from './battleScore'
import { markStructure, structureRemaining } from './shipState'
import type { GameState } from './game'

/**
 * The season harness's scoring function, which is the instrument every balance
 * claim in this project is made with — so it gets tests like engine code does.
 *
 * It has been wrong twice in ways that changed conclusions. It summed raw
 * structure boxes, which cannot compare two hulls with different track lengths;
 * and it scored a ship that left the battle at zero, which cannot tell a
 * retreat from a hull sailing over the edge of a small map. Together those made
 * a UNION III read as losing to a ship costing two thirds less, while it was in
 * fact destroying that ship eleven times in forty and never dying once.
 */

const BLUE = 'Blue Force'
const RED = 'Red Force'

function duel(): GameState {
  return startScenario('s3.1-the-duel', { seed: 1 })
}

const shipOn = (game: GameState, side: string) => game.ships.find((s) => s.side === side)!

describe('the season’s health metric', () => {
  it('reads a hull against its own structure, not against the other ship’s', () => {
    const game = duel()
    const blue = shipOn(game, BLUE)
    const red = shipOn(game, RED)
    // Give them different track lengths, then hurt them equally in proportion.
    const blueBoxes = blue.form.structure.filter((e) => e.kind === 'box').length
    const redBoxes = red.form.structure.filter((e) => e.kind === 'box').length
    expect(blueBoxes).not.toBe(redBoxes)

    for (let i = 0; i < Math.round(blueBoxes / 2); i++) markStructure(blue)
    for (let i = 0; i < Math.round(redBoxes / 2); i++) markStructure(red)

    // Both are half wrecked, so neither is ahead — whatever their hull sizes.
    expect(health(game, BLUE)).toBeCloseTo(health(game, RED), 1)
  })

  it('scores an untouched side at 1 and a destroyed one at -1', () => {
    const game = duel()
    expect(health(game, BLUE)).toBeCloseTo(1, 6)
    shipOn(game, RED).destroyed = true
    expect(health(game, RED)).toBeCloseTo(-1, 6)
  })

  /*
   * The case that mattered. A ship that leaves has not won, but it has not
   * been killed either, and the old zero made those two the same thing.
   */
  it('gives a hull that left the battle half of what it still had', () => {
    const game = duel()
    const blue = shipOn(game, BLUE)
    const intact = health(game, BLUE)
    blue.disengaged = true
    expect(health(game, BLUE)).toBeCloseTo(intact / 2, 6)
  })

  it('still ranks a departure above a wreck, and below standing your ground', () => {
    const game = duel()
    const blue = shipOn(game, BLUE)
    const standing = health(game, BLUE)

    blue.disengaged = true
    const left = health(game, BLUE)
    blue.disengaged = false
    blue.destroyed = true
    const dead = health(game, BLUE)

    expect(standing).toBeGreaterThan(left)
    expect(left).toBeGreaterThan(dead)
  })

  /*
   * A kill has to outweigh paintwork. Otherwise a ship that destroyed its
   * opponent can be scored the loser for having been scratched doing it, which
   * is the shape of the bug this function shipped with.
   */
  it('lets destruction decide against any amount of damage taken', () => {
    const game = duel()
    const blue = shipOn(game, BLUE)
    const red = shipOn(game, RED)

    // Blue is battered down to its last box; Red is dead.
    while (structureRemaining(blue) > 1) markStructure(blue)
    red.destroyed = true

    expect(health(game, BLUE)).toBeGreaterThan(health(game, RED))
  })

  it('averages a fleet rather than rewarding whoever brought more hulls', () => {
    const game = startScenario('exp2-squadron-engagement', { seed: 1 })
    const sides = [...new Set(game.ships.map((s) => s.side))]
    for (const side of sides) {
      // An untouched fleet scores 1 however many ships are in it.
      expect(health(game, side)).toBeCloseTo(1, 6)
    }
  })
})
