import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { applyAction, type GameAction } from './actions'
import { aiNextActions, createAiMemo } from './ai'
import { activeShips, type GameState } from './game'
import { actualRange, arcTo, canBearOn } from './geometry'
import { isPointDefense } from './combat'
import { mountIsReady, type ShipState } from './shipState'

/**
 * Point defense (E12.4.3), and a filter that made it impossible.
 *
 * A mount was offered to the interception only if *no* enemy sat inside its
 * brackets and arcs — the idea being to spend only guns that had nothing else
 * to do. But a torpedo comes in from the direction of the ship that launched
 * it, so the only mounts the filter ever left were the ones pointing the other
 * way. The result was airtight: across roughly three hundred measured battles
 * `fire-small-target` was never emitted once, and in every sampled phase where
 * a counter was about to land and the defender had ready, idle point defense
 * aboard, the count of those mounts that could bear on the counter was zero.
 *
 * Idle is now a preference — free mounts are spent first — with a budget of
 * half a ship's point defense for mounts taken out of the volley, so a ship
 * cannot win the interception by losing the gunnery duel.
 *
 * The test is deliberately a whole battle rather than a fixture. The bug was
 * not in any one decision; it was that a plausible-looking filter composed
 * with the geometry to produce nothing, and only a real fight shows that.
 */

/**
 * Whether this mount had a shot at a ship to give up. The doctrine's budget
 * only governs these; a mount with nothing in its arcs and brackets costs the
 * volley nothing. Kept in step with `busyWith` in `planPointDefense`.
 */
function hadAShot(game: GameState, ship: ShipState, weaponId: string, mountIndex: number): boolean {
  const weapon = ship.form.weapons.find((w) => w.id === weaponId)!
  const mount = weapon.mounts[mountIndex]
  return game.ships
    .filter((e) => e.side !== ship.side && !e.destroyed)
    .some((enemy) => {
      const range = actualRange(ship.placement.position, enemy.placement.position)
      if (!weapon.brackets.some((b) => range >= b.min && range <= b.max)) return false
      return canBearOn(
        mount.arcs,
        arcTo(ship.placement.position, ship.placement.heading, enemy.placement.position),
      )
    })
}

type Interception = { phase: string; shipId: string; busy: boolean; readyPointDefense: number }

function fight(scenario: string, seed: number, rounds = 12) {
  const game: GameState = startScenario(scenario, { seed, mapScale: 2 })
  const sides = [...new Set(game.ships.map((s) => s.side))]
  const memos = sides.map(() => createAiMemo())
  const journal: GameAction[] = []
  const interceptions: Interception[] = []
  /**
   * Sampled before the action is applied, and off the game rather than off the
   * journal: the round and phase are the only honest bucket, and the mount's
   * circumstances are gone once it has fired.
   */
  const note = (a: GameAction) => {
    if (a.type !== 'fire-small-target') return
    const ship = game.ships.find((s) => s.id === a.attackerId)!
    const ready = ship.form.weapons
      .filter(isPointDefense)
      .reduce(
        (n, w) => n + w.mounts.filter((_, i) => mountIsReady(w, i, ship.mounts[w.id][i])).length,
        0,
      )
    interceptions.push({
      phase: `r${game.round}/${game.phase}`,
      shipId: ship.id,
      busy: hadAShot(game, ship, a.weaponId, a.mountIndex),
      readyPointDefense: ready,
    })
  }
  const drive = (closing: boolean) => {
    for (const [index, side] of sides.entries()) {
      for (let guard = 0; guard < 300; guard++) {
        const batch = aiNextActions(game, [side], memos[index], closing, 'admiral')
        if (batch.length === 0) break
        for (const a of batch) {
          note(a)
          applyAction(game, a)
          journal.push(a)
        }
        if (guard === 299) throw new Error(`${side} never settled in ${game.segment}`)
      }
    }
  }
  drive(false)
  for (let step = 0; step < 400; step++) {
    if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > rounds) break
    drive(true)
    applyAction(game, { type: 'advance-segment' })
    drive(false)
  }
  return { game, journal, interceptions }
}

describe('a fleet under a torpedo wave', () => {
  it('actually shoots at the torpedoes', () => {
    // The Aurelian raid is the scenario built around homing weapons, so it is
    // where an interception that never happens is most visible.
    let shots = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { journal } = fight('exp5-aurelian-raid', seed)
      shots += journal.filter((a) => a.type === 'fire-small-target').length
    }
    expect(shots, 'point defense never fired across six raids').toBeGreaterThan(0)
  })

  it('does not turn its whole battery on the wave', () => {
    /*
     * The budget: at most half a ship's ready point defense may be taken out
     * of the volley in a phase. Without a ceiling, "shoot the torpedoes" is
     * the kind of rule that quietly stops a fleet firing at ships at all.
     *
     * Only mounts that *had* a shot count against it. A mount with no enemy in
     * its arcs and brackets costs the volley nothing, so spending it is free
     * and unlimited — which is the whole reason the doctrine sorts free mounts
     * to the front.
     *
     * Two things this test used to get wrong, both found when the Aurelian
     * launchers were corrected to their printed hit boxes and the longer-lived
     * tubes put more counters in the air. It bucketed by counting
     * `advance-segment` actions in the journal — but the harness applies the
     * segment advance without journalling it, so every "phase" was really most
     * of a battle. And it asserted a flat ceiling of four, a number about the
     * hulls in one scenario rather than about the rule. Sampling the real
     * phase and the real budget tests what the code actually promises.
     */
    const { game, interceptions } = fight('exp5-aurelian-raid', 1)
    const perPhase = new Map<string, { busy: number; ready: number }>()
    for (const shot of interceptions) {
      const key = `${shot.phase}:${shot.shipId}`
      const e = perPhase.get(key) ?? { busy: 0, ready: 0 }
      if (shot.busy) e.busy += 1
      e.ready = Math.max(e.ready, shot.readyPointDefense)
      perPhase.set(key, e)
    }
    expect(perPhase.size, 'no interceptions to judge').toBeGreaterThan(0)
    for (const [key, e] of perPhase) {
      const allowed = Math.max(1, Math.floor(e.ready / 2))
      expect(
        e.busy,
        `${key} pulled ${e.busy} of ${e.ready} ready point-defense mounts out of its volley`,
      ).toBeLessThanOrEqual(allowed)
    }
    // And the ceiling has to bite on something: a ship cannot fire more
    // interceptions than it has point defense aboard.
    for (const shot of interceptions) {
      const ship = game.ships.find((s) => s.id === shot.shipId)!
      expect(shot.readyPointDefense, `${ship.name} intercepted with no ready point defense`).toBeGreaterThan(0)
    }
  })
})
