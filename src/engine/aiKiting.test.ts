import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { aiNextActions, createAiMemo, kiteBand } from './ai'
import { type GameState } from './game'
import { type ShipState } from './shipState'
import { woundToFraction } from './testWounds'

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

describe('refusing the hopeless battle', () => {
  it('at triple strength the admiral declines whole — the captain stands and dies', () => {
    // Measured to the bone before this existed: at these odds no doctrine
    // wins or even escapes once engaged. Refusing concedes half value
    // (S2.8.4); standing conceded nearly all of it, 24 sorties in 24.
    // Hopelessness is weighed in points, so it is the light cruiser staring
    // down two heavy cruisers that leaves.
    const stage = (difficulty: 'captain' | 'admiral') => {
      const game = startScenario('s3.1-the-duel', {
        seed: 3,
        fleets: { 'Blue Force': [COVENTRY], 'Red Force': Array(2).fill(YORKTOWN_III) },
      })
      const little = game.ships.find((s) => s.side === 'Blue Force')!
      const ftlLine = little.form.functions.find((l) => l.kind === 'ftl-drive')!
      little.allocation[ftlLine.id] = ftlLine.steps.length
      game.segment = 'disengagement'
      return aiNextActions(game, ['Blue Force'], createAiMemo(), false, difficulty).some(
        (a) => a.type === 'disengage',
      )
    }
    expect(stage('admiral')).toBe(true)
    expect(stage('captain')).toBe(false)
  })

  it('does not flee a swarm it outguns: three frigate-weights are not "three to one"', () => {
    // The gate used to count hulls, and the point-calibration sweep caught a
    // dreadnought conceding half its value to three frigates worth a third
    // of its price — a fight it wins every single time it stays. Strength is
    // what the odds are made of.
    const game = startScenario('s3.1-the-duel', {
      seed: 3,
      fleets: { 'Blue Force': [YORKTOWN_III], 'Red Force': Array(3).fill(COVENTRY) },
    })
    const big = game.ships.find((s) => s.side === 'Blue Force')!
    const ftlLine = big.form.functions.find((l) => l.kind === 'ftl-drive')!
    big.allocation[ftlLine.id] = ftlLine.steps.length
    game.segment = 'disengagement'
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'admiral')
    expect(actions.some((a) => a.type === 'disengage')).toBe(false)
  })

  it('the "AI may retreat" switch pins every hull to its post — even a cripple', () => {
    const game = startScenario('s3.1-the-duel', {
      seed: 3,
      fleets: { 'Blue Force': [YORKTOWN_III], 'Red Force': Array(3).fill(COVENTRY) },
    })
    const big = game.ships.find((s) => s.side === 'Blue Force')!
    woundToFraction(big, 0.92) // crippled, in the hit points the ledger counts
    const ftlLine = big.form.functions.find((l) => l.kind === 'ftl-drive')!
    big.allocation[ftlLine.id] = ftlLine.steps.length
    game.segment = 'disengagement'
    const stays = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'admiral', 'steady', false)
    expect(stays.some((a) => a.type === 'disengage')).toBe(false)
    const leaves = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'admiral', 'steady', true)
    expect(leaves.some((a) => a.type === 'disengage')).toBe(true)
  })
})

describe('cutting losses', () => {
  const KURSK = 'union-kursk-i-class-battlecruiser'

  /** A heavy-damaged cruiser staring down better than twice its strength. */
  function heavyAndOvermatched(): { game: GameState; big: ShipState } {
    const game = startScenario('s3.1-the-duel', {
      seed: 5,
      fleets: { 'Blue Force': [YORKTOWN_III], 'Red Force': Array(2).fill(KURSK) },
    })
    const big = game.ships.find((s) => s.side === 'Blue Force')!
    woundToFraction(big, 0.8) // heavy damage, in the hit points the ledger counts
    return { game, big }
  }

  it('a leaver funds the drive that leaves during Resource Allocation (J9.1.3)', () => {
    // The leaver here is the admiral declining hopeless strength while whole
    // — a light cruiser against two heavy cruisers, no wounds. Under the
    // hit-point damage levels a hull at *heavy* damage has spent most of its
    // reactor boxes getting there, so "badly hurt but with power to fund the
    // drive" is no longer a state a fixture can stage honestly.
    const game = startScenario('s3.1-the-duel', {
      seed: 5,
      fleets: { 'Blue Force': [COVENTRY], 'Red Force': Array(2).fill(YORKTOWN_III) },
    })
    const little = game.ships.find((s) => s.side === 'Blue Force')!
    game.segment = 'resource-allocation'
    const ftlLine = little.form.functions.find((l) => l.kind === 'ftl-drive')!
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'admiral')
    const funded = actions.find(
      (a) => a.type === 'allocate' && a.shipId === little.id && a.lineId === ftlLine.id,
    )
    expect(funded).toBeDefined()
    expect(funded && 'circles' in funded && funded.circles).toBe(ftlLine.steps.length)
  })

  it('a heavy hull facing twice its strength disengages under the admiral, fights on under the captain', () => {
    const stage = (difficulty: 'captain' | 'admiral') => {
      const { game, big } = heavyAndOvermatched()
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

describe('deep space (mapScale)', () => {
  it('doubles bounds and opening range together; default stays bit-identical', () => {
    const printed = startScenario('s3.1-the-duel', { seed: 5 })
    const deep = startScenario('s3.1-the-duel', { seed: 5, mapScale: 2 })
    expect(deep.scenario.bounds.width).toBe(printed.scenario.bounds.width * 2)
    expect(deep.scenario.bounds.height).toBe(printed.scenario.bounds.height * 2)
    const gap = (g: typeof printed) => {
      const [a, b] = g.ships
      return Math.hypot(
        a.placement.position.x - b.placement.position.x,
        a.placement.position.y - b.placement.position.y,
      )
    }
    expect(gap(deep)).toBeCloseTo(gap(printed) * 2, 5)
    const control = startScenario('s3.1-the-duel', { seed: 5 })
    expect(JSON.stringify(control.ships.map((s) => s.placement))).toBe(
      JSON.stringify(printed.ships.map((s) => s.placement)),
    )
  })
})
