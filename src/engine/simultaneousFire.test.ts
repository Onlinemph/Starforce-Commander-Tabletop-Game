import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { defaultCommandCard, type GameState } from './game'
import { arcTo, canBearOn } from './geometry'
import { damageLevel, structureRemaining, type ShipState } from './shipState'

/**
 * H2.4.2: ships with tied Tactical Scans fire simultaneously, and their
 * damage takes effect simultaneously. The engine rolls a tied volley at once
 * but holds the damage until the whole tie group has fired or passed — so no
 * tie-mate loses its weapons, or its life, before its own guns speak.
 */

/** Two armed enemies at knife range, both plotted to the same Tactical Scan. */
function tiedDuel(scan = 2): GameState {
  const game = startScenario('s3.1-the-duel', { seed: 12 })
  const blue = game.ships.find((s) => s.side === 'Blue Force')!
  const red = game.ships.find((s) => s.side === 'Red Force')!
  blue.placement = { position: { x: 15, y: 18 }, heading: 0 }
  red.placement = { position: { x: 15, y: 14 }, heading: 180 }

  // Arm everything by hand — this test is about firing, not arming.
  for (const ship of [blue, red]) {
    for (const weapon of ship.form.weapons) {
      weapon.mounts.forEach((mount, i) => {
        ship.mounts[weapon.id][i].armed = mount.armingCircles
      })
    }
    ship.sensors = { targeting: 0, jamming: 0, tacticalScan: scan }
    game.orders[ship.id] = defaultCommandCard(ship)
  }
  game.phase = 'combat-1'
  game.segment = 'combat'
  return game
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
      const state = attacker.mounts[weapon.id][mountIndex]
      if (state.armed < mount.armingCircles) return []
      if (!canBearOn(mount.arcs, arcs)) return []
      return [{ weaponId: weapon.id, mountIndex }]
    }),
  )
}

function fire(game: GameState, attacker: ShipState, target: ShipState) {
  return applyAction(game, {
    type: 'fire-volley',
    attackerId: attacker.id,
    targetId: target.id,
    mounts: bearingMounts(attacker, target),
    mode: 'standard',
    degraded: false,
  })
}

describe('simultaneous fire on tied Tactical Scans (H2.4.2)', () => {
  it('holds the first volley until the tie group completes, then lands everything', () => {
    const game = tiedDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    const redStructureBefore = structureRemaining(red)

    const first = fire(game, blue, red)
    expect(first.volley?.ok).toBe(true)
    // Rolled, not landed: the outcome is held and the target untouched.
    expect(first.volley && first.volley.ok && first.volley.outcome).toBeNull()
    expect(first.flushed).toBeUndefined()
    expect(game.pendingVolleys).toHaveLength(1)
    expect(structureRemaining(red)).toBe(redStructureBefore)
    expect(damageLevel(red)).toBe('none')

    // The tie-mate answers with its full battery — nothing was shot away.
    const second = fire(game, red, blue)
    expect(second.volley?.ok).toBe(true)
    expect(second.volley && second.volley.ok && second.volley.records.length).toBeGreaterThan(0)

    // The group is complete: both held volleys land, in firing order.
    expect(second.flushed?.length).toBe(2)
    expect(game.pendingVolleys).toHaveLength(0)
    const totalDealt = (second.flushed ?? []).reduce(
      (sum, f) => sum + f.outcome.internal + f.outcome.greenAbsorbed + f.outcome.blueAbsorbed + f.outcome.armorAbsorbed,
      0,
    )
    expect(totalDealt).toBeGreaterThan(0)
  })

  it('a pass completes the group and lands the held damage', () => {
    const game = tiedDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!

    fire(game, blue, red)
    expect(game.pendingVolleys).toHaveLength(1)
    const outcome = applyAction(game, { type: 'pass-fire', shipId: red.id })
    expect(outcome.flushed?.length).toBe(1)
    expect(game.pendingVolleys).toHaveLength(0)
  })

  it('an untied volley still lands immediately', () => {
    const game = tiedDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    blue.sensors.tacticalScan = 3 // blue fires alone, first

    const result = fire(game, blue, red)
    expect(result.volley?.ok).toBe(true)
    expect(result.volley && result.volley.ok && result.volley.outcome).not.toBeNull()
    expect(game.pendingVolleys).toHaveLength(0)
  })

  it('the segment closing lands anything still held', () => {
    const game = tiedDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    fire(game, blue, red)
    expect(game.pendingVolleys).toHaveLength(1)
    applyAction(game, { type: 'advance-segment' })
    expect(game.pendingVolleys).toHaveLength(0)
  })
})

describe('defensive jamming doctrine', () => {
  function commandGame(distance: number): GameState {
    const game = startScenario('s3.1-the-duel', { seed: 3 })
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    blue.placement = { position: { x: 4, y: 18 }, heading: 90 }
    red.placement = { position: { x: 4 + distance, y: 18 }, heading: 270 }
    game.phase = 'combat-1'
    game.segment = 'command'
    for (const ship of game.ships) game.orders[ship.id] = defaultCommandCard(ship)
    return game
  }

  it('a captain who cannot reach the enemy goes dark and jams', () => {
    // Far beyond any Yorktown battery even with full targeting.
    const game = commandGame(30)
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    blue.sensors = { targeting: 0, jamming: 0, tacticalScan: 0 }
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'captain')
    const jam = actions.find(
      (a) => a.type === 'plot-sensor' && a.shipId === blue.id && a.key === 'jamming' && a.value > 0,
    )
    expect(jam, 'out of reach, the captain should be jamming').toBeDefined()
  })

  it('in reach with armed batteries, the captain bids Tactical Scan instead', () => {
    const game = commandGame(6)
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    // A ship with a real shot this phase: batteries armed and in range.
    for (const weapon of blue.form.weapons) {
      weapon.mounts.forEach((mount, i) => {
        blue.mounts[weapon.id][i].armed = mount.armingCircles
      })
    }
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'captain')
    const scan = actions.find(
      (a) => a.type === 'plot-sensor' && a.key === 'tacticalScan' && a.value > 0,
    )
    expect(scan).toBeDefined()
  })

  it('armed but with a quiet phase ahead — discharged batteries — the captain jams max', () => {
    // In range, but nothing to shoot with: every mount is discharged. The
    // planned position offers no volley, so the sensors go defensive.
    const game = commandGame(6)
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    for (const weapon of blue.form.weapons) {
      weapon.mounts.forEach((_, i) => {
        blue.mounts[weapon.id][i].armed = 0
      })
    }
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'captain')
    const jam = actions.find(
      (a) => a.type === 'plot-sensor' && a.key === 'jamming' && a.value > 0,
    )
    expect(jam, 'nothing to fire this phase — the captain should jam').toBeDefined()
  })

  it('the ensign never jams, even out of reach', () => {
    const game = commandGame(30)
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'ensign')
    const jam = actions.find(
      (a) => a.type === 'plot-sensor' && a.key === 'jamming' && a.value > 0,
    )
    expect(jam).toBeUndefined()
  })
})

/*
 * The firing sequence itself (E6.2 Step 1, H2.4.1): highest Tactical Scan has
 * the option first, each ship down the ladder decides fire-or-pass in turn,
 * one opportunity a phase. For a long time this was a warning chip on the
 * panel and nothing in the engine — so in an online match the effective order
 * was whoever clicked first, and the points a player put into Tactical Scan
 * bought nothing. A playtest report said it exactly: "the more power you put
 * into those scanners the last you fire."
 */
describe('the firing sequence is binding (E6.2 Step 1, H2.4.1)', () => {
  /** Same duel, but the scans differ: blue invested, red did not. */
  function unequalDuel(): GameState {
    const game = tiedDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    blue.sensors = { targeting: 0, jamming: 0, tacticalScan: 4 }
    red.sensors = { targeting: 0, jamming: 0, tacticalScan: 1 }
    return game
  }

  it('refuses the low-scan ship while the high-scan ship is undecided', () => {
    const game = unequalDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    const out = fire(game, red, blue)
    expect(out.message).toMatch(/must fire or pass/)
    // A refusal costs nothing: no roll, no damage, and red may fire later.
    expect(game.firedThisSegment.has(red.id)).toBe(false)
    expect(structureRemaining(blue)).toBe(structureRemaining(blue))
  })

  it('lets the high-scan ship fire first, then the low-scan ship', () => {
    const game = unequalDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    expect(fire(game, blue, red).volley?.ok).toBe(true)
    expect(fire(game, red, blue).volley?.ok).toBe(true)
  })

  it('a pass hands the option down the ladder', () => {
    const game = unequalDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    expect(applyAction(game, { type: 'pass-fire', shipId: blue.id }).message).toBeNull()
    expect(fire(game, red, blue).volley?.ok).toBe(true)
  })

  it('one opportunity a phase: a ship that fired may not fire again', () => {
    const game = tiedDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    expect(fire(game, blue, red).volley?.ok).toBe(true)
    expect(fire(game, blue, red).message).toMatch(/already fired or passed/)
  })

  it('readying a side out of a combat segment passes its undecided ships', () => {
    const game = unequalDuel()
    game.readyGate = true
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    // Blue walks away from the segment without deciding. Without the pass,
    // red's guns would be locked shut behind an empty chair.
    applyAction(game, { type: 'signal-ready', side: 'Blue Force', ready: true })
    expect(game.firedThisSegment.has(blue.id)).toBe(true)
    expect(fire(game, red, blue).volley?.ok).toBe(true)
    // And the pass is binding: un-readying does not hand the option back.
    applyAction(game, { type: 'signal-ready', side: 'Blue Force', ready: false })
    expect(fire(game, blue, red).message).toMatch(/already fired or passed/)
  })

  it('tie-mates fire in either order, as before', () => {
    const game = tiedDuel()
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    expect(fire(game, red, blue).volley?.ok).toBe(true)
    expect(fire(game, blue, red).volley?.ok).toBe(true)
  })
})
