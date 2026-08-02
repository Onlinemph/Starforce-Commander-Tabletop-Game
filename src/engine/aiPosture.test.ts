import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { aiNextActions, createAiMemo, postureOf } from './ai'
import { defaultCommandCard, pushLog, victoryPoints, type GameState, type Terrain } from './game'
import { isHoming } from './homing'
import { type ShipState } from './shipState'

/**
 * The AI plays the game, not just the phase: the scoreboard sets its appetite
 * for risk, terrain is sought as armor, the notebook of what the enemy has
 * shown revises the book, a round with nothing in reach funds the long game,
 * and torpedoes go out in waves instead of dribbles.
 */

function duel(seed = 7): { game: GameState; blue: ShipState; red: ShipState } {
  const game = startScenario('s3.1-the-duel', { seed })
  const blue = game.ships.find((s) => s.side === 'Blue Force')!
  const red = game.ships.find((s) => s.side === 'Red Force')!
  return { game, blue, red }
}

/** Mark the leading fraction of structure boxes damaged. */
function wound(ship: ShipState, fraction: number): void {
  ship.structureDamaged = ship.structureDamaged.map(
    (_, i, all) => i < Math.ceil(all.length * fraction),
  )
}

/** The longest reach of any battery the ship carries. */
function reachOf(ship: ShipState): number {
  return Math.max(0, ...ship.form.weapons.flatMap((w) => w.brackets.map((b) => b.max)))
}

describe('posture reads the public scoreboard', () => {
  it('an untroubled board is played balanced, and the ensign always is', () => {
    const { game, blue } = duel()
    expect(postureOf(game, blue, 'captain')).toBe('balanced')
    wound(blue, 0.8)
    expect(postureOf(game, blue, 'ensign')).toBe('balanced')
  })

  it('ahead and hurt protects the lead; ahead and whole keeps playing', () => {
    const { game, blue, red } = duel()
    red.destroyed = true
    const score = victoryPoints(game)
    expect(score['Blue Force'] - score['Red Force']).toBeGreaterThan(3)
    expect(postureOf(game, blue, 'captain')).toBe('balanced')
    wound(blue, 0.5)
    expect(postureOf(game, blue, 'captain')).toBe('protect')
  })

  it('behind on points presses', () => {
    const { game, blue } = duel()
    wound(blue, 0.8)
    const score = victoryPoints(game)
    expect(score['Blue Force'] - score['Red Force']).toBeLessThan(-3)
    expect(postureOf(game, blue, 'captain')).toBe('press')
  })
})

describe('press loosens the trigger', () => {
  function longShotBoard(): { game: GameState; blue: ShipState; red: ShipState } {
    const { game, blue, red } = duel(9)
    // Range 12: the phasers' red band, past nothing else. The torpedoes stay
    // unarmed — a slow-arming heavy never joins a red volley anyway.
    blue.placement = { position: { x: 2, y: 18 }, heading: 90 }
    red.placement = { position: { x: 14, y: 18 }, heading: 270 }
    for (const weapon of blue.form.weapons) {
      if (weapon.mounts.some((m) => (m.roundGates ?? []).some(Boolean))) continue
      weapon.mounts.forEach((mount, i) => {
        blue.mounts[weapon.id][i].armed = mount.armingCircles
      })
    }
    blue.sensors = { targeting: 0, jamming: 0, tacticalScan: 0 }
    red.sensors = { targeting: 0, jamming: 0, tacticalScan: 0 }
    game.phase = 'combat-1'
    game.segment = 'combat'
    return { game, blue, red }
  }

  it('a level board holds the all-red volley; a losing one fires it', () => {
    const held = longShotBoard()
    const heldActions = aiNextActions(held.game, ['Blue Force'], createAiMemo(), false, 'captain')
    expect(heldActions.some((a) => a.type === 'fire-volley')).toBe(false)

    const pressed = longShotBoard()
    wound(pressed.blue, 0.8) // behind on points now — any dice beat none
    const pressActions = aiNextActions(
      pressed.game,
      ['Blue Force'],
      createAiMemo(),
      false,
      'captain',
    )
    expect(pressActions.some((a) => a.type === 'fire-volley')).toBe(true)
  })
})

describe('terrain is a tool', () => {
  it('a hurt ship with a lead steers for the rerolls, not just around the rocks', () => {
    // The same small field sits one move ahead; only its printed cover value
    // changes between the two runs, so any plan difference is the AI valuing
    // the rerolls themselves (K2.1.8) — not the pre-existing rock avoidance.
    const plansFor = (cover: number): string => {
      const game = startScenario('exp2-squadron-engagement', { seed: 12 })
      const blues = game.ships.filter((s) => s.side === 'Blue Force')
      const reds = game.ships.filter((s) => s.side === 'Red Force')
      const me = blues[0]
      // Ahead on points (enemies down), hurt — the protect posture.
      for (const r of reds.slice(1)) r.destroyed = true
      wound(me, 0.5)
      me.placement = { position: { x: 18, y: 24 }, heading: 0 }
      me.speed = 2
      reds[0].placement = { position: { x: 18, y: 10 }, heading: 180 }
      for (const other of blues.slice(1)) other.placement = { position: { x: 32, y: 32 }, heading: 0 }
      const field: Terrain = {
        id: 'cover-field',
        kind: 'asteroid-field',
        name: 'Test Field',
        center: { x: 18, y: 21 },
        radius: 0.5,
        safeSpeed: 4,
        damageDie: 'green',
        cover,
        density: 'medium',
      }
      game.scenario = { ...game.scenario, terrain: [field] }
      game.phase = 'combat-1'
      game.segment = 'command'
      for (const ship of game.ships) game.orders[ship.id] = defaultCommandCard(ship)
      return JSON.stringify(
        aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'captain').filter(
          (a) =>
            'shipId' in a &&
            a.shipId === me.id &&
            (a.type === 'plot-maneuver' || a.type === 'plot-accel'),
        ),
      )
    }

    expect(plansFor(6)).not.toBe(plansFor(0))
  })
})

describe('the notebook revises the book', () => {
  it('remembers the highest scan an enemy side has shown', () => {
    const { game, red } = duel()
    const memo = createAiMemo()
    red.sensors = { targeting: 0, jamming: 0, tacticalScan: 3 }
    aiNextActions(game, ['Blue Force'], memo, false, 'captain')
    expect(memo.scanSeen.get('Red Force')).toBe(3)
    red.sensors = { targeting: 0, jamming: 0, tacticalScan: 0 }
    aiNextActions(game, ['Blue Force'], memo, false, 'captain')
    expect(memo.scanSeen.get('Red Force')).toBe(3)
  })

  it('counts consecutive under-powered volleys, and a full-strength one clears the count', () => {
    const { game, red } = duel()
    const memo = createAiMemo()
    pushLog(game, `${red.name} fires on Nobody at effective range 8 (F shield). Dice: 1 1 → 0 damage`)
    pushLog(game, `${red.name} fires on Nobody at effective range 8 (F shield). Dice: 1 1 → 0 damage`)
    aiNextActions(game, ['Blue Force'], memo, false, 'captain')
    expect(memo.underPowered.get(red.id)).toBe(2)
    pushLog(game, `${red.name} fires on Nobody at effective range 8 (F shield). Dice: 6 6 → 99 damage`)
    aiNextActions(game, ['Blue Force'], memo, false, 'captain')
    expect(memo.underPowered.get(red.id)).toBe(0)
  })
})

describe('the closing round funds the long game', () => {
  const lineKind = (ship: ShipState, lineId: string) =>
    ship.form.functions.find((l) => l.id === lineId)

  function allocationsFor(game: GameState, ship: ShipState, difficulty: 'captain' | 'admiral') {
    game.segment = 'resource-allocation'
    const actions = aiNextActions(game, [ship.side], createAiMemo(), false, difficulty)
    return actions.filter(
      (a): a is Extract<typeof a, { type: 'allocate' }> =>
        a.type === 'allocate' && a.shipId === ship.id,
    )
  }

  it('with nothing in reach, slow-arming heavies charge first and the admiral floors the drive', () => {
    const { game, blue, red } = duel(15)
    // The printed duel opens beyond every battery: a closing round.
    const range = Math.hypot(
      blue.placement.position.x - red.placement.position.x,
      blue.placement.position.y - red.placement.position.y,
    )
    expect(range).toBeGreaterThan(reachOf(blue) + 6)

    const allocs = allocationsFor(game, blue, 'admiral')
    const accelIndex = allocs.findIndex((a) => lineKind(blue, a.lineId)?.kind === 'accel')
    expect(accelIndex).toBeGreaterThanOrEqual(0)
    expect(allocs[accelIndex].circles).toBe(2)

    const slowIndex = allocs.findIndex((a) => {
      const line = lineKind(blue, a.lineId)
      if (line?.kind !== 'weapon') return false
      const weapon = blue.form.weapons.find((w) => w.id === line.weaponSystemId)
      return !!weapon?.mounts.some((m) => (m.roundGates ?? []).some(Boolean))
    })
    const fastIndex = allocs.findIndex((a) => {
      const line = lineKind(blue, a.lineId)
      if (line?.kind !== 'weapon') return false
      const weapon = blue.form.weapons.find((w) => w.id === line.weaponSystemId)
      return !weapon?.mounts.some((m) => (m.roundGates ?? []).some(Boolean))
    })
    expect(slowIndex).toBeGreaterThanOrEqual(0)
    expect(fastIndex).toBeGreaterThanOrEqual(0)
    expect(slowIndex).toBeLessThan(fastIndex)
    expect(accelIndex).toBeLessThan(fastIndex)
  })

  it('the captain paces the closing; in reach, everyone takes one drive point first', () => {
    // Racing the merge is admiral doctrine alone — measured: when every rank
    // floors it, closings get so fast the dice swamp the doctrine.
    const far = duel(15)
    const farAllocs = allocationsFor(far.game, far.blue, 'captain')
    const farAccel = farAllocs.find((a) => lineKind(far.blue, a.lineId)?.kind === 'accel')
    expect(farAccel).toBeDefined()
    expect(farAccel!.circles).toBe(1)

    const near = duel(15)
    near.blue.placement = { position: { x: 15, y: 18 }, heading: 90 }
    near.red.placement = { position: { x: 25, y: 18 }, heading: 270 }
    const nearAllocs = allocationsFor(near.game, near.blue, 'admiral')
    const nearAccel = nearAllocs.find((a) => lineKind(near.blue, a.lineId)?.kind === 'accel')
    expect(nearAccel).toBeDefined()
    expect(nearAccel!.circles).toBe(1)
  })
})

describe('torpedoes go out in waves', () => {
  function raidBoard(): {
    game: GameState
    raider: ShipState
    prey: ShipState
    weaponId: string
  } {
    const game = startScenario('exp5-aurelian-raid', { seed: 4 })
    const raider = game.ships.find(
      (s) =>
        s.side === 'Aurelian Empire' &&
        s.form.weapons.some((w) => isHoming(w) && w.mounts.length >= 2),
    )!
    const weapon = raider.form.weapons.find((w) => isHoming(w) && w.mounts.length >= 2)!
    const prey = game.ships.find((s) => s.side === 'Blue Force')!
    raider.placement = { position: { x: 12, y: 18 }, heading: 90 }
    prey.placement = { position: { x: 20, y: 18 }, heading: 270 }
    for (const other of game.ships) {
      if (other !== raider && other !== prey) other.destroyed = true
    }
    game.phase = 'combat-1'
    game.segment = 'combat'
    return { game, raider, prey, weaponId: weapon.id }
  }

  const launchesFrom = (game: GameState, raider: ShipState) =>
    aiNextActions(game, ['Aurelian Empire'], createAiMemo(), false, 'captain').filter(
      (a) => a.type === 'launch-homing' && a.shipId === raider.id,
    )

  it('holds a lone ready torpedo while its wingmate is still arming', () => {
    const { game, raider, weaponId } = raidBoard()
    const mounts = raider.form.weapons.find((w) => w.id === weaponId)!.mounts
    raider.mounts[weaponId][0].armed = mounts[0].armingCircles
    raider.mounts[weaponId][1].armed = 1 // partway — the wave is forming
    expect(launchesFrom(game, raider)).toHaveLength(0)
  })

  it('launches the full wave once both are ready', () => {
    const { game, raider, weaponId } = raidBoard()
    const mounts = raider.form.weapons.find((w) => w.id === weaponId)!.mounts
    raider.mounts[weaponId][0].armed = mounts[0].armingCircles
    raider.mounts[weaponId][1].armed = mounts[1].armingCircles
    expect(launchesFrom(game, raider)).toHaveLength(2)
  })

  it('does not wait on a broken target — any hit might finish it', () => {
    const { game, raider, prey, weaponId } = raidBoard()
    const mounts = raider.form.weapons.find((w) => w.id === weaponId)!.mounts
    raider.mounts[weaponId][0].armed = mounts[0].armingCircles
    raider.mounts[weaponId][1].armed = 1
    wound(prey, 0.8)
    expect(launchesFrom(game, raider)).toHaveLength(1)
  })
})
