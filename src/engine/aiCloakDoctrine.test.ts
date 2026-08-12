import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { cloakStrength, isCloaked } from './cloaking'
import { activeShips, cloakOf, type GameState } from './game'

/**
 * Cloak doctrine, both ends of it.
 *
 * The rules make this unusually sharp. A cloaked ship's jamming *is* its cloak
 * strength (`cloakStrength` reads the figure straight off the card), and a
 * searcher whose targeting is below it may not attempt a search at all
 * (H6.10.2) — equal targeting rolls one die, and only targeting above it rolls
 * in numbers. Meanwhile a cloaked ship cannot fire at all (H6.4.2).
 *
 * So the captain has two jobs it used to fail: while dark, put the sensor line
 * into jamming and come out for the shot rather than hiding through it; while
 * hunting, outbid the ghost's jamming or do not bother searching.
 *
 * Measured before this doctrine, an INVICTUS I against a YORKTOWN V spent 68%
 * of its command segments cloaked, fired 1.7 volleys a game and killed 4
 * opponents in 24. The same hull with its cloak *removed* killed 15. The AI
 * was using the cloak as armour.
 */

function fight(scenario: string, seed: number, sides: string[], rounds = 10) {
  const game: GameState = startScenario(scenario, { seed })
  const memo = createAiMemo()
  const journal: GameAction[] = []
  const drive = (closing: boolean) => {
    for (let guard = 0; guard < 300; guard++) {
      const batch = aiNextActions(game, sides, memo, closing, 'admiral')
      if (batch.length === 0) return
      for (const a of batch) {
        applyAction(game, a)
        journal.push(a)
      }
      closing = false
    }
    throw new Error('the captains never settled')
  }
  drive(false)
  for (let step = 0; step < 400; step++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > rounds) break
    drive(true)
    applyAction(game, { type: 'advance-segment' })
    journal.push({ type: 'advance-segment' })
    drive(false)
  }
  return { game, journal }
}

describe('a cloaked captain', () => {
  it('puts the sensor line into jamming, because jamming is the cloak', () => {
    const { game } = fight('exp5-aurelian-raid', 1, ['Blue Force', 'Aurelian Empire'])
    const dark = game.ships.filter((s) => {
      const c = cloakOf(game, s)
      return c && isCloaked(c)
    })
    // Whatever else it spent, a hidden ship's jamming is not zero — that is
    // the number a hunter has to beat before it may roll at all.
    for (const s of dark) expect(cloakStrength(s), s.name).toBeGreaterThan(0)
  })

  it('comes out of the dark to shoot rather than hiding through the battle', () => {
    const { game, journal } = fight('exp5-aurelian-raid', 1, ['Blue Force', 'Aurelian Empire'])
    const types = journal.map((a) => a.type)
    expect(types).toContain('engage-cloak')
    expect(types).toContain('decloak')
    // The point of decloaking: something is fired afterwards. A cloak that
    // never leads to a volley is armour, which is what this doctrine fixed.
    const shots = game.log.filter((e) => / fires on | launches /.test(e.message))
    expect(shots.length).toBeGreaterThan(0)
  })
})

describe('a captain hunting a ghost', () => {
  it('bids its targeting above the ghost it is hunting', () => {
    /*
     * Sampled through the battle rather than at the end. Sensors are replotted
     * every Command Segment, so the final card says nothing about what the
     * hunters did while there was actually something to hunt — the first
     * version of this test read the end state and failed the moment an
     * unrelated change altered which phase the battle stopped on.
     */
    const game: GameState = startScenario('exp5-aurelian-raid', { seed: 1 })
    const memo = createAiMemo()
    const sides = ['Blue Force', 'Aurelian Empire']
    const drive = (closing: boolean) => {
      for (let guard = 0; guard < 300; guard++) {
        const batch = aiNextActions(game, sides, memo, closing, 'admiral')
        if (batch.length === 0) return
        for (const a of batch) applyAction(game, a)
        closing = false
      }
      throw new Error('the captains never settled')
    }
    let sawGhost = false
    let outbid = false
    drive(false)
    for (let step = 0; step < 400; step++) {
      if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > 10) break
      drive(true)
      const ghosts = game.ships.filter((s) => {
        const c = cloakOf(game, s)
        return c && isCloaked(c)
      })
      if (ghosts.length > 0) {
        sawGhost = true
        const bid = Math.max(...ghosts.map((g) => cloakStrength(g)))
        const hunters = activeShips(game).filter((s) => s.side !== ghosts[0].side)
        // H6.10.2: below the ghost's jamming a hunter may not search at all,
        // so meeting the bid is the whole job.
        if (hunters.some((h) => h.sensors.targeting >= bid)) outbid = true
      }
      applyAction(game, { type: 'advance-segment' })
      drive(false)
    }
    expect(sawGhost, 'nobody cloaked this battle').toBe(true)
    expect(outbid, 'no hunter ever met the ghost’s jamming').toBe(true)
  })
})

/**
 * H6.13 — shaking a search that has found you.
 *
 * One blue die per enemy holding a Contact, Track or Target Lock, and an 'M'
 * drops that enemy a level. It matters most at Track, which is the level where
 * the ship can be fired on at all (H6.14.3), so dropping back to Contact puts
 * it out of reach of the guns again.
 *
 * H6.13.2 allows the attempt once, at Step E of the Operations Segment. The
 * engine did not enforce that — it was an unlimited reroll for anyone willing
 * to ask twice, and would have hung any captain taught to try until it worked.
 */
describe('a cloaked ship that has been found', () => {
  it('may only try to shake its hunters once a segment (H6.13.2)', () => {
    const game = startScenario('exp5-aurelian-raid', { seed: 2 })
    const ship = game.ships.find((s) => cloakOf(game, s))!
    const cloak = cloakOf(game, ship)!
    cloak.engaged = true
    cloak.detection = { 'blue-1': 2 }
    cloak.evadedThisSegment = false

    const first = applyAction(game, { type: 'reduce-detection', shipId: ship.id })
    expect(first.message).toBeNull()
    expect(cloak.evadedThisSegment).toBe(true)

    const second = applyAction(game, { type: 'reduce-detection', shipId: ship.id })
    expect(second.message).toContain('H6.13.2')
  })
})

/**
 * The other half of the cycle, and the half that was missing until a
 * playtester watched an Aurelian squadron fight: they cloaked once at the
 * start, came out to shoot, and then stayed visible for the rest of the
 * battle. Hiding was only ever worth it when hurt or far away, and a ship
 * that has just emptied its tubes is neither.
 *
 * A plasma torpedo takes two or three rounds to arm (F5.1.3), and H6.4.2
 * costs a cloaked ship weapons it does not currently have. So the reload is
 * exactly when the cloak is free — charge in the dark, surface for the
 * volley, vanish while the next one builds.
 */
describe('the Aurelian cycle: reload in the dark', () => {
  /** An Aurelian cruiser, uncloaked, with its cloak line fully powered. */
  function raider(seed = 5) {
    const game = startScenario('exp5-aurelian-raid', { seed })
    const ship = game.ships.find((s) => s.side === 'Aurelian Empire')!
    const foe = game.ships.find((s) => s.side !== 'Aurelian Empire')!
    // Within reach of each other, so neither is simply "far".
    foe.placement = {
      position: { x: ship.placement.position.x + 10, y: ship.placement.position.y },
      heading: 270,
    }
    const line = ship.form.functions.find((l) => l.label === 'CLOAK')!
    ship.allocation[line.id] = line.steps.length
    game.phase = 'combat-1'
    game.segment = 'operations'
    return { game, ship, foe, line }
  }

  /** Every mount either emptied, or filled to the brim. */
  function setCharge(ship: (typeof startScenario extends never ? never : ReturnType<typeof raider>)['ship'], full: boolean) {
    for (const weapon of ship.form.weapons) {
      weapon.mounts.forEach((mount, i) => {
        ship.mounts[weapon.id][i].armed = full ? mount.armingCircles : 0
      })
    }
  }

  const asks = (game: ReturnType<typeof raider>['game'], shipId: string, type: string) =>
    aiNextActions(game, ['Aurelian Empire'], createAiMemo(), false, 'admiral').some(
      (a) => a.type === type && 'shipId' in a && a.shipId === shipId,
    )

  it('goes dark to reload, because a cloak costs nothing it is not already missing', () => {
    const { game, ship } = raider()
    setCharge(ship, false)
    expect(asks(game, ship.id, 'engage-cloak')).toBe(true)
  })

  it('stays visible with the tubes full and a target in reach (H6.4.2)', () => {
    const { game, ship } = raider()
    setCharge(ship, true)
    expect(asks(game, ship.id, 'engage-cloak')).toBe(false)
  })

  it('counts a part-charged tube as empty, not as a shot (E4.2.3)', () => {
    // The bug this pins: a plasma tube four circles into a six-circle arming
    // read as a firing solution, so the ship neither hid to finish the
    // reload nor could legally fire. Half-charge everything and it should
    // still take the cloak.
    const { game, ship } = raider()
    for (const weapon of ship.form.weapons) {
      weapon.mounts.forEach((mount, i) => {
        ship.mounts[weapon.id][i].armed = Math.max(0, mount.armingCircles - 1)
      })
    }
    expect(asks(game, ship.id, 'engage-cloak')).toBe(true)
  })
})
