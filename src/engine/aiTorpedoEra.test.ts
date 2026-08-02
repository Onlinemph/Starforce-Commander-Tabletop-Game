import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo, postureOf } from './ai'
import { activeShips, victoryPoints, type GameState } from './game'
import { impactShield, isHoming } from './homing'
import { type AiMemo } from './ai'
import { type ShipState } from './shipState'

/**
 * The fleet fights the torpedo era: point defense splits across the incoming
 * wave, homing strikes go into the table's public shield record, the optional
 * H4 step machine is played rather than passed, the repair queue answers to
 * the posture, and a temperament reads the same scoreboard differently.
 */

function wound(ship: ShipState, fraction: number): void {
  ship.structureDamaged = ship.structureDamaged.map(
    (_, i, all) => i < Math.ceil(all.length * fraction),
  )
}

function armEverything(ship: ShipState): void {
  for (const weapon of ship.form.weapons) {
    weapon.mounts.forEach((mount, i) => {
      ship.mounts[weapon.id][i].armed = mount.armingCircles
    })
  }
}

/** Aurelian raid, torpedoes staged mid-flight against the lead Union hull. */
function torpedoRaid(seed = 6): {
  game: GameState
  raider: ShipState
  prey: ShipState
  weaponId: string
} {
  const game = startScenario('exp5-aurelian-raid', { seed })
  const raider = game.ships.find(
    (s) =>
      s.side === 'Aurelian Empire' &&
      s.form.weapons.some((w) => isHoming(w) && w.mounts.length >= 2),
  )!
  const weapon = raider.form.weapons.find((w) => isHoming(w) && w.mounts.length >= 2)!
  const prey = game.ships.find((s) => s.side === 'Blue Force')!
  raider.placement = { position: { x: 8, y: 18 }, heading: 90 }
  prey.placement = { position: { x: 22, y: 18 }, heading: 270 } // bow to the west, arcs on the wave
  armEverything(raider)
  armEverything(prey)
  game.phase = 'combat-1'
  game.segment = 'combat'
  for (let i = 0; i < 2; i++) {
    const refused = applyAction(game, {
      type: 'launch-homing',
      shipId: raider.id,
      weaponId: weapon.id,
      mountIndex: i,
      targetId: prey.id,
    })
    expect(refused.message).toBeNull()
  }
  // Both counters have flown a leg and hang mid-flight, inside their next
  // leg's reach — the wave that will land, which is the wave worth shooting.
  for (const [i, hw] of game.homing.entries()) {
    hw.phasesFlown = 1
    hw.position = { x: 17.5, y: 18 + (i === 0 ? -0.5 : 0.5) }
  }
  return { game, raider, prey, weaponId: weapon.id }
}

describe('the fleet splits its point defense across the wave', () => {
  it('intercepts in flight, one shot per counter before any counter draws two', () => {
    const { game, prey } = torpedoRaid()
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'captain')
    const shots = actions.filter((a) => a.type === 'fire-small-target')
    expect(shots.length).toBe(2)
    expect(new Set(shots.map((s) => 'targetId' in s && s.targetId)).size).toBe(2)
    for (const shot of shots) {
      expect('attackerId' in shot && shot.attackerId).toBe(prey.id)
    }
    // And the shots are real: the engine accepts them and rolls dice.
    for (const shot of shots) {
      applyAction(game, shot)
    }
    expect(game.log.some((l) => /puts \d+ into/.test(l.message))).toBe(true)
  })

  it('the ensign has no point-defense doctrine at all', () => {
    const { game } = torpedoRaid()
    const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'ensign')
    expect(actions.some((a) => a.type === 'fire-small-target')).toBe(false)
  })
})

describe('homing strikes feed the public shield record', () => {
  it('a resolved impact records its absorbed damage by struck side', () => {
    const { game, prey } = torpedoRaid(9)
    // The wave arrives: both counters at the hull, flagged impacted.
    for (const hw of game.homing) {
      hw.impacted = true
      hw.phasesFlown = 2
      hw.position = { x: prey.placement.position.x - 1, y: prey.placement.position.y }
    }
    const side = impactShield(game.homing[0], prey)
    applyAction(game, { type: 'resolve-homing-impacts', shipId: prey.id, pointDefense: {} })
    expect(game.homing).toHaveLength(0)
    expect(game.shieldHitsSeen[prey.id]?.[side]).toBeGreaterThan(0)
  })
})

describe('the H4 step machine is played, not passed', () => {
  function h4Squadron(seed = 3): { game: GameState; blues: ShipState[]; reds: ShipState[] } {
    const game = startScenario('exp2-squadron-engagement', { seed, coordinatedFire: true })
    const blues = game.ships.filter((s) => s.side === 'Blue Force')
    const reds = game.ships.filter((s) => s.side === 'Red Force')
    return { game, blues, reds }
  }

  it('a scan-2 pair holds its individual step and coordinates on the focus target', () => {
    const { game, blues, reds } = h4Squadron()
    const [a, b] = blues
    for (const other of blues.slice(2)) other.destroyed = true
    a.placement = { position: { x: 14, y: 20 }, heading: 0 }
    b.placement = { position: { x: 22, y: 20 }, heading: 0 }
    reds[0].placement = { position: { x: 18, y: 12 }, heading: 180 }
    for (const other of reds.slice(1)) other.destroyed = true
    wound(reds[0], 0.5) // the obvious focus kill
    armEverything(a)
    armEverything(b)
    a.sensors = { targeting: 0, jamming: 0, tacticalScan: 2 }
    b.sensors = { targeting: 0, jamming: 0, tacticalScan: 2 }
    game.phase = 'combat-1'
    game.segment = 'combat'

    const memo = createAiMemo()
    // Walk the clock to step 4 (Individual, scan 2): the pair holds its fire.
    while (game.firingStepIndex < 3) applyAction(game, { type: 'advance-firing-step' })
    const onIndividual = aiNextActions(game, ['Blue Force'], memo, false, 'captain')
    expect(onIndividual.some((x) => x.type === 'fire-volley')).toBe(false)

    // Step 7 (Coordinated, scan 2): the group is declared, then fires together.
    while (game.firingStepIndex < 6) applyAction(game, { type: 'advance-firing-step' })
    const declared = aiNextActions(game, ['Blue Force'], memo, false, 'captain')
    const decl = declared.find((x) => x.type === 'declare-coordinated')
    expect(decl).toBeDefined()
    expect(decl && 'targetId' in decl && decl.targetId).toBe(reds[0].id)
    expect(decl && 'shipIds' in decl && [...decl.shipIds].sort()).toEqual([a.id, b.id].sort())
    expect(applyAction(game, decl!).message).toBeNull()

    const volleys: GameAction[] = []
    for (let guard = 0; guard < 10; guard++) {
      const batch = aiNextActions(game, ['Blue Force'], memo, false, 'captain')
      if (batch.length === 0) break
      for (const action of batch) {
        applyAction(game, action)
        volleys.push(action)
      }
    }
    const fired = volleys.filter((x) => x.type === 'fire-volley')
    expect(fired).toHaveLength(2)
    for (const volley of fired) {
      expect('targetId' in volley && volley.targetId).toBe(reds[0].id)
      expect('mode' in volley && volley.mode).not.toBe('precision') // H4.6.2
    }
  })

  it('individual fire spreads across targets: one attack per faction per hull (H4.3.1)', () => {
    const { game, blues, reds } = h4Squadron(5)
    const [a, b] = blues
    for (const other of blues.slice(2)) other.destroyed = true
    for (const other of reds.slice(2)) other.destroyed = true
    a.placement = { position: { x: 14, y: 20 }, heading: 0 }
    b.placement = { position: { x: 22, y: 20 }, heading: 0 }
    reds[0].placement = { position: { x: 14, y: 12 }, heading: 180 }
    reds[1].placement = { position: { x: 22, y: 12 }, heading: 180 }
    armEverything(a)
    armEverything(b)
    // Scan 0: individual step 6 only — no coordinated option exists (H4.5.1).
    a.sensors = { targeting: 0, jamming: 0, tacticalScan: 0 }
    b.sensors = { targeting: 0, jamming: 0, tacticalScan: 0 }
    game.phase = 'combat-1'
    game.segment = 'combat'
    while (game.firingStepIndex < 5) applyAction(game, { type: 'advance-firing-step' })

    const memo = createAiMemo()
    const fired: GameAction[] = []
    for (let guard = 0; guard < 10; guard++) {
      const batch = aiNextActions(game, ['Blue Force'], memo, false, 'captain')
      if (batch.length === 0) break
      for (const action of batch) {
        applyAction(game, action)
        if (action.type === 'fire-volley') fired.push(action)
      }
    }
    expect(fired).toHaveLength(2)
    const targets = fired.map((v) => ('targetId' in v ? v.targetId : ''))
    expect(new Set(targets).size).toBe(2)
  })

  it('an AI that owns the whole table drives the step clock and the battle still fights', () => {
    const game = startScenario('exp2-squadron-engagement', { seed: 7, coordinatedFire: true })
    const memo: AiMemo = createAiMemo()
    const journal: GameAction[] = []
    const sides = ['Blue Force', 'Red Force']
    const drive = (closing: boolean) => {
      let c = closing
      for (let guard = 0; guard < 400; guard++) {
        const batch = aiNextActions(game, sides, memo, c, 'captain')
        if (batch.length === 0) return
        for (const action of batch) {
          applyAction(game, action)
          journal.push(action)
        }
        c = false
      }
      throw new Error('H4 self-play did not settle')
    }
    drive(false)
    for (let steps = 0; steps < 300; steps++) {
      const alive = new Set(activeShips(game).map((s) => s.side))
      if (alive.size <= 1 || game.round > 6) break
      drive(true)
      applyAction(game, { type: 'advance-segment' })
      journal.push({ type: 'advance-segment' })
      drive(false)
    }
    const types = new Set(journal.map((a) => a.type))
    expect(game.round).toBeGreaterThan(1)
    expect(types.has('advance-firing-step')).toBe(true)
    expect(types.has('fire-volley')).toBe(true)
    // Somebody drew blood under the step machine.
    expect(Math.max(...Object.values(victoryPoints(game)))).toBeGreaterThan(0)
  })
})

describe('the repair queue answers to the posture', () => {
  it('protecting a lead fixes the umbrella before the guns; level boards fix guns first', () => {
    const stage = (protect: boolean) => {
      const game = startScenario('s3.1-the-duel', { seed: 4 })
      const blue = game.ships.find((s) => s.side === 'Blue Force')!
      const red = game.ships.find((s) => s.side === 'Red Force')!
      if (protect) {
        red.destroyed = true // well ahead on points…
        wound(blue, 0.5) // …and hurt: the protect posture
      }
      // Both a gun and the shield generator need the crews.
      const weapon = blue.form.weapons[0]
      blue.mounts[weapon.id][0].damage = weapon.mounts[0].hitBoxes
      blue.shieldGeneratorDamage = 1
      game.segment = 'damage-control'
      const actions = aiNextActions(game, ['Blue Force'], createAiMemo(), false, 'captain')
      const dc = actions.find((a) => a.type === 'damage-control' && a.shipId === blue.id)
      expect(dc).toBeDefined()
      return dc && 'assignments' in dc ? dc.assignments[0].category : null
    }
    expect(stage(false)).toBe('weapons')
    expect(stage(true)).not.toBe('weapons')
  })
})

describe('temperament reads the same scoreboard differently', () => {
  it('aggressive presses a level board; cautious protects it; steady plays it straight', () => {
    const game = startScenario('s3.1-the-duel', { seed: 2 })
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    // Both hulls equally battered: the scoreboard is level and blue is hurt.
    wound(blue, 0.5)
    wound(red, 0.5)
    // Different hulls print different victory tables, so "level" is a band.
    const score = victoryPoints(game)
    expect(Math.abs(score['Blue Force'] - score['Red Force'])).toBeLessThanOrEqual(3)
    expect(postureOf(game, blue, 'captain', 'steady')).toBe('balanced')
    expect(postureOf(game, blue, 'captain', 'aggressive')).toBe('press')
    expect(postureOf(game, blue, 'captain', 'cautious')).toBe('protect')
  })
})
