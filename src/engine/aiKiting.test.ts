import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { aiNextActions, createAiMemo, kiteBand } from './ai'
import { type GameState } from './game'
import { type ShipState } from './shipState'

/**
 * Anti-swarm doctrine: numbers beat tonnage in close battle, so the
 * outnumbered, longer-reached admiral moves the fight to the band the swarm
 * cannot answer from. Measured: Yorktown-III vs two Coventrys flipped from
 * 3W–21L to 20W–4L. And measured honestly the other way: against five or
 * six hulls the board is too small to hold the band — envelopment beats
 * range — so the doctrine claims the pair fight, not the wall of frigates.
 */

const YORKTOWN_III = 'union-yorktown-iii-class-heavy-cruiser'
const COVENTRY = 'union-coventry-i-class-light-cruiser'

function goliathBoard(reds: number): { game: GameState; big: ShipState; lights: ShipState[] } {
  const game = startScenario('s3.1-the-duel', {
    seed: 5,
    fleets: { 'Blue Force': [YORKTOWN_III], 'Red Force': Array(reds).fill(COVENTRY) },
  })
  const big = game.ships.find((s) => s.side === 'Blue Force')!
  const lights = game.ships.filter((s) => s.side === 'Red Force')
  return { game, big, lights }
}

function armEverything(ship: ShipState): void {
  for (const weapon of ship.form.weapons) {
    weapon.mounts.forEach((mount, i) => {
      ship.mounts[weapon.id][i].armed = mount.armingCircles
    })
  }
}

describe('the kite band', () => {
  it('exists only when outnumbered two to one and out-reaching by a real margin', () => {
    const paired = goliathBoard(2)
    // Yorktown-III reaches 24; the Coventry chart ends at 16. One inch past
    // their farthest bracket, with no sensors bending it either way.
    expect(kiteBand(paired.game, paired.big, paired.lights)).toBe(17)

    const single = goliathBoard(1)
    expect(kiteBand(single.game, single.big, single.lights)).toBeNull()
  })

  it('jamming lets the ship stand closer; enemy targeting pushes it further out', () => {
    const { game, big, lights } = goliathBoard(2)
    big.sensors = { targeting: 0, jamming: 2, tacticalScan: 0 }
    expect(kiteBand(game, big, lights)).toBe(15)
    for (const light of lights) light.sensors = { targeting: 2, jamming: 0, tacticalScan: 0 }
    expect(kiteBand(game, big, lights)).toBe(17)
  })

  it('offers nothing when the swarm matches the reach', () => {
    const game = startScenario('s3.1-the-duel', {
      seed: 5,
      fleets: {
        'Blue Force': ['vallari-v-11a-predator-class-dreadnought'],
        'Red Force': Array(3).fill('vallari-v-5k-corsair-class-destroyer'),
      },
    })
    const big = game.ships.find((s) => s.side === 'Blue Force')!
    const reds = game.ships.filter((s) => s.side === 'Red Force')
    expect(kiteBand(game, big, reds)).toBeNull()
  })
})

describe('untouchable fire discipline inverts', () => {
  function stagedAtRange(): GameState {
    const { game, big, lights } = goliathBoard(2)
    big.placement = { position: { x: 18, y: 30 }, heading: 0 }
    lights[0].placement = { position: { x: 16, y: 11 }, heading: 180 }
    lights[1].placement = { position: { x: 20, y: 11 }, heading: 180 }
    armEverything(big)
    big.sensors = { targeting: 0, jamming: 0, tacticalScan: 0 }
    game.phase = 'combat-1'
    game.segment = 'combat'
    return game
  }

  it('the admiral fires its slow-armed heavies from the band no answer comes from', () => {
    const game = stagedAtRange()
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'admiral')
    const volley = actions.find((a) => a.type === 'fire-volley')
    expect(volley).toBeDefined()
  })

  it('the captain, with no kiting doctrine, holds the same red volley', () => {
    const game = stagedAtRange()
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'captain')
    expect(actions.some((a) => a.type === 'fire-volley')).toBe(false)
  })
})

describe('cutting losses', () => {
  function heavyAndOutnumbered(): { game: GameState; big: ShipState } {
    const { game, big } = goliathBoard(2)
    big.structureDamaged = big.structureDamaged.map((_, i, all) => i < Math.ceil(all.length * 0.8))
    return { game, big }
  }

  it('a leaver funds the drive that leaves during Resource Allocation (J9.1.3)', () => {
    const { game, big } = heavyAndOutnumbered()
    game.segment = 'resource-allocation'
    const ftlLine = big.form.functions.find((l) => l.kind === 'ftl-drive')!
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'admiral')
    const funded = actions.find(
      (a) => a.type === 'allocate' && a.shipId === big.id && a.lineId === ftlLine.id,
    )
    expect(funded).toBeDefined()
    expect(funded && 'circles' in funded && funded.circles).toBe(ftlLine.steps.length)
  })

  it('a heavy hull facing twice its numbers disengages under the admiral, fights on under the captain', () => {
    const stage = (difficulty: 'captain' | 'admiral') => {
      const { game, big } = heavyAndOutnumbered()
      const ftlLine = big.form.functions.find((l) => l.kind === 'ftl-drive')!
      big.allocation[ftlLine.id] = ftlLine.steps.length // the drive is lit
      game.segment = 'disengagement'
      return aiNextActions(game, ['Blue Force'], createAiMemo(), false, difficulty).some(
        (a) => a.type === 'disengage',
      )
    }
    expect(stage('admiral')).toBe(true)
    expect(stage('captain')).toBe(false)
  })
})
