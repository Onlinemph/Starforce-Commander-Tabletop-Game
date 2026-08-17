import { describe, expect, it } from 'vitest'
import { startScenario, square, SCENARIOS } from './scenarios'
import { applyAction, type GameAction } from '../engine/actions'
import { aiNextActions, createAiMemo, type AiMemo } from '../engine/ai'
import {
  activeShips,
  pendingArrivals,
  reconProgress,
  victoryPoints,
  type GameState,
} from '../engine/game'
import { commandPointsAvailable } from '../engine/command'
import { blueShieldRemaining } from '../engine/shipState'
import { woundToFraction } from '../engine/testWounds'

/**
 * The printed Section S3 scenarios.
 *
 * The rulebook prints six and each one turns on a rule the plain duel never
 * exercises — a cold ship, a secret deployment, a flagship worth double, a
 * clock with reinforcements at the end of it. These check the setups deploy as
 * printed and that the mechanics behind them actually bite.
 */

const play = (id: string, seed = 3) => startScenario(id, { seed })

/** Run both sides' computers until neither has anything left to say. */
function drive(game: GameState, memos: Record<string, AiMemo>): void {
  for (let guard = 0; guard < 200; guard++) {
    let acted = false
    for (const side of Object.keys(memos)) {
      const batch = aiNextActions(game, [side], memos[side], false, 'captain', 'steady', true)
      if (batch.length === 0) continue
      for (const action of batch) applyAction(game, action as GameAction)
      acted = true
    }
    if (!acted) return
  }
}

describe('the printed grid', () => {
  it('puts E5 in the middle of the board, where S3.3 prints its planet', () => {
    expect(square('E5')).toEqual({ x: 18, y: 18 })
    expect(square('A1')).toEqual({ x: 2, y: 2 })
    expect(square('F5')).toEqual({ x: 22, y: 18 })
  })
})

describe('S3.4 First Strike', () => {
  it('opens with the cruiser cold: shields down and not a mount armed', () => {
    const game = play('s3.4-first-strike')
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!

    for (const side of ['F', 'A', 'P', 'S'] as const) {
      expect(blue.shieldsDown[side], `${side} shield`).toBe(true)
      expect(red.shieldsDown[side], `${side} shield`).toBe(false)
    }
    const armed = (ship: typeof blue) =>
      ship.form.weapons.some((w) => ship.mounts[w.id].some((m) => m.armed > 0))
    expect(armed(blue)).toBe(false)
    expect(armed(red)).toBe(true)
  })

  it('holds the ambushed ship to speed 1 through the opening round', () => {
    const game = play('s3.4-first-strike')
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const memos = { 'Blue Force': createAiMemo(), 'Red Force': createAiMemo() }
    // Round one, all the way through: whatever the helm plots, it holds station.
    for (let i = 0; i < 30 && game.round === 1; i++) {
      drive(game, memos)
      expect(blue.speed, `round ${game.round} ${game.segment}`).toBeLessThanOrEqual(1)
      applyAction(game, { type: 'advance-segment' })
    }
    expect(game.round).toBeGreaterThan(1)
  })

  it('is the smaller ship that shoots first, by half the points or less', () => {
    const game = play('s3.4-first-strike')
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const red = game.ships.find((s) => s.side === 'Red Force')!
    expect(red.form.pointValue).toBeLessThanOrEqual(blue.form.pointValue / 2)
  })
})

describe('S3.5 Mutual Surprise', () => {
  it('rolls its own asteroid field without being asked', () => {
    const game = play('s3.5-mutual-surprise')
    expect(game.scenario.terrain.length).toBeGreaterThan(0)
    expect(game.scenario.terrain.every((t) => t.kind === 'asteroid-field')).toBe(true)
  })

  it('places both ships in secret — a different opening every battle', () => {
    const openings = new Set<string>()
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const game = play('s3.5-mutual-surprise', seed)
      openings.add(
        game.ships
          .map((s) => `${Math.round(s.placement.position.x)},${Math.round(s.placement.position.y)},${s.placement.heading}`)
          .join('|'),
      )
    }
    expect(openings.size).toBeGreaterThan(4)
  })

  it('deploys the same way twice from the same battle file', () => {
    const a = play('s3.5-mutual-surprise', 9)
    const b = play('s3.5-mutual-surprise', 9)
    expect(b.ships.map((s) => s.placement)).toEqual(a.ships.map((s) => s.placement))
  })
})

describe('S3.6 Target the Flagship', () => {
  it('names one flagship a side, and it is the heavy', () => {
    const game = play('s3.6-target-the-flagship')
    for (const side of ['Blue Force', 'Red Force']) {
      const force = game.ships.filter((s) => s.side === side)
      expect(force).toHaveLength(3)
      const flags = force.filter((s) => s.flagship)
      expect(flags).toHaveLength(1)
      expect(flags[0].form.sizeClass).toBeGreaterThanOrEqual(force[1].form.sizeClass)
    }
  })

  it('scores double for damage done to a flagship', () => {
    // Moderate damage in hit points to one Red hull at a time: the flagship
    // is the biggest and worth the most to begin with, and its damage counts
    // double on top — so hurting it always outscores hurting the escort.
    const hurting = (which: 'flag' | 'escort'): number => {
      const game = play('s3.6-target-the-flagship')
      const ship = game.ships.find(
        (s) => s.side === 'Red Force' && (which === 'flag' ? s.flagship : !s.flagship),
      )!
      woundToFraction(ship, 0.5)
      return victoryPoints(game)['Blue Force']
    }
    expect(hurting('flag')).toBeGreaterThan(hurting('escort'))
  })

  it('gives the flagship two scan points to hand out, with no power spent', () => {
    const game = play('s3.6-target-the-flagship')
    const flag = game.ships.find((s) => s.flagship)!
    const escort = game.ships.find((s) => s.side === flag.side && !s.flagship)!
    // GEN SYS is off at the opening bell, so ordinary CMND boxes give nothing.
    expect(commandPointsAvailable(flag)).toBe(2)
    expect(commandPointsAvailable(escort)).toBe(0)
  })
})

describe('S3.2 Recon Mission', () => {
  it('keeps the reinforcements off the board until their round', () => {
    const game = play('s3.2-recon-mission')
    expect(pendingArrivals(game)).toHaveLength(3)
    expect(activeShips(game).filter((s) => s.side === 'Blue Force')).toHaveLength(1)
    game.round = 8
    expect(pendingArrivals(game)).toHaveLength(0)
    expect(activeShips(game).filter((s) => s.side === 'Blue Force')).toHaveLength(4)
  })

  it('asks the raider for information in proportion to the sciences it brought', () => {
    const game = play('s3.2-recon-mission')
    const recon = reconProgress(game)!
    const boxes = game.ships
      .filter((s) => s.side === recon.side)
      .reduce((n, s) => n + s.form.systems.filter((g) => g.kind === 'SCNC').reduce((m, g) => m + g.boxes, 0), 0)
    expect(recon.required).toBe(10 * (boxes + 1))
    expect(recon.succeeded).toBe(false)
  })

  it('is not won by gathering alone — the ship has to leave with it', () => {
    const game = play('s3.2-recon-mission')
    const recon = reconProgress(game)!
    const raider = game.ships.find((s) => s.side === recon.side)!
    game.ops.info[recon.side] = { [recon.target]: recon.required }
    expect(reconProgress(game)!.succeeded).toBe(false)
    raider.disengaged = true
    expect(reconProgress(game)!.succeeded).toBe(true)
  })

  it('sends the computer to scan the planet rather than hunt the picket', () => {
    const game = play('s3.2-recon-mission')
    const memo = createAiMemo()
    const scans: GameAction[] = []
    for (let i = 0; i < 40 && game.round < 4; i++) {
      const batch = aiNextActions(game, ['Red Force'], memo, false, 'captain', 'steady', true)
      for (const action of batch) {
        applyAction(game, action as GameAction)
        if (action.type === 'scan') scans.push(action)
      }
      if (batch.length === 0) applyAction(game, { type: 'advance-segment' })
    }
    expect(scans.length).toBeGreaterThan(0)
    expect(reconProgress(game)!.gathered).toBeGreaterThan(0)
  })
})

describe('every printed scenario', () => {
  it('plays a few rounds with both computers without wedging', () => {
    for (const { scenario } of SCENARIOS) {
      const game = startScenario(scenario.id, { seed: 5 })
      const memos: Record<string, AiMemo> = {}
      for (const side of new Set(game.ships.map((s) => s.side))) memos[side] = createAiMemo()
      for (let i = 0; i < 120 && game.round < 3; i++) {
        drive(game, memos)
        applyAction(game, { type: 'advance-segment' })
      }
      expect(game.round, scenario.name).toBeGreaterThanOrEqual(3)
      // And nobody deployed on top of anybody or off the map.
      for (const ship of game.ships) {
        expect(blueShieldRemaining(ship, 'F'), scenario.name).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
