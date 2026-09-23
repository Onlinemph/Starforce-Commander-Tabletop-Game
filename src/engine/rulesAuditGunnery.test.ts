import { describe, expect, it } from 'vitest'
import { VALLARI_CRUISER, YORKTOWN } from '../data/ships'
import { startScenario } from '../data/scenarios'
import { buildGame, type GameSetup } from '../data/savedGame'
import { applyAction, type GameAction } from './actions'
import { resolveVolley } from './combat'
import { autoChoices, newDeck, setDestructionOptions, STANDARD_DESTRUCTION, type DamageContext } from './damage'
import { Rng } from './dice'
import { FIRING_STEPS, validateCoordinatedFire } from './coordinatedFire'
import { defaultCommandCard, repeatTargetRefusal, type GameState } from './game'
import { arcTo, canBearOn } from './geometry'
import { createShip, type ShipState } from './shipState'
import { playBattle } from './selfPlay'
import type { ShipForm } from './types'

/**
 * Rules-audit fixes: direct-fire gunnery and coordinated fire.
 *
 * - E7.1.1 / E3.3.8 — everything a ship sends at one target in a phase is a
 *   single volley; a split opportunity (E6.2 Step 6) may only divide fire
 *   across OTHER targets, never declare a second volley at the same one.
 * - E3.4.2 — low-power fire is barred on a mount that needs two or more
 *   rounds to arm, whatever its dice count in the bracket used.
 * - H4.2.3 step 10 — the "Up to Five Ships" cap applies like steps 7-9.
 */

setDestructionOptions(STANDARD_DESTRUCTION)

const phaser = YORKTOWN.weapons.find((w) => w.weaponClass === 'phaser')!

function ctx(seed = 99): DamageContext {
  const rng = new Rng(seed)
  return { deck: newDeck(rng), rng, choices: autoChoices, log: () => {} }
}

function pair(distanceInches: number): { attacker: ShipState; target: ShipState } {
  const attacker = createShip({
    id: 'a',
    side: 'Blue',
    name: 'Attacker',
    form: YORKTOWN,
    placement: { position: { x: 0, y: 0 }, heading: 0 },
    speed: 4,
  })
  const target = createShip({
    id: 'b',
    side: 'Red',
    name: 'Target',
    form: VALLARI_CRUISER,
    placement: { position: { x: 0, y: -distanceInches }, heading: 0 },
    speed: 4,
  })
  return { attacker, target }
}

describe('E3.4.2 — low power fire on a slow-arming mount', () => {
  it('refuses even when the bracket dice count matches the arming circles', () => {
    // Clone the phaser with a slow-arming diamond added to its mount, without
    // touching the shared YORKTOWN fixture other tests read.
    const slowPhaser = structuredClone(phaser)
    slowPhaser.mounts[0].roundGates = [true]
    const slowForm: ShipForm = {
      ...YORKTOWN,
      weapons: YORKTOWN.weapons.map((w) => (w.id === phaser.id ? slowPhaser : w)),
    }
    const attacker = createShip({
      id: 'a',
      side: 'Blue',
      name: 'Attacker',
      form: slowForm,
      placement: { position: { x: 0, y: 0 }, heading: 0 },
      speed: 4,
    })
    const target = createShip({
      id: 'b',
      side: 'Red',
      name: 'Target',
      form: VALLARI_CRUISER,
      placement: { position: { x: 0, y: -7 }, heading: 0 },
      speed: 4,
    })
    attacker.mounts[phaser.id][0].armed = 2
    const result = resolveVolley(
      { attacker, target, mounts: [{ weaponId: phaser.id, mountIndex: 0, lowPowerDice: 1 }], mode: 'standard' },
      ctx(),
      new Rng(4),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/E3\.4\.2/)
  })

  it('still allows low power on an ordinary one-round mount (regression, E3.4.3)', () => {
    const { attacker, target } = pair(7)
    attacker.mounts[phaser.id][0].armed = 2
    const result = resolveVolley(
      { attacker, target, mounts: [{ weaponId: phaser.id, mountIndex: 0, lowPowerDice: 1 }], mode: 'standard' },
      ctx(),
      new Rng(4),
    )
    expect(result.ok).toBe(true)
  })
})

describe('E7.1.1 / E3.3.8 — one volley per target per phase', () => {
  const DREADNOUGHT = 'union-union-iii-class-dreadnought'
  const CRUISER = 'union-yorktown-i-class-heavy-cruiser'

  function fleetFight(rulesVersion = 3): { game: GameState; blue: ShipState; red1: ShipState; red2: ShipState } {
    const game = startScenario('s3.1-the-duel', {
      seed: 7,
      rulesVersion,
      derelicts: true,
      fleets: {
        'Blue Force': [DREADNOUGHT],
        'Red Force': [CRUISER, CRUISER],
      },
    })
    const blue = game.ships.find((s) => s.side === 'Blue Force')!
    const [red1, red2] = game.ships.filter((s) => s.side === 'Red Force')
    blue.placement = { position: { x: 15, y: 20 }, heading: 0 }
    red1.placement = { position: { x: 13, y: 15 }, heading: 180 }
    red2.placement = { position: { x: 17, y: 15 }, heading: 180 }
    for (const ship of [blue, red1, red2]) {
      for (const weapon of ship.form.weapons) {
        weapon.mounts.forEach((mount, i) => {
          ship.mounts[weapon.id][i].armed = mount.armingCircles
        })
      }
      game.orders[ship.id] = defaultCommandCard(ship)
    }
    blue.sensors = { targeting: 0, jamming: 0, tacticalScan: 3 }
    red1.sensors = { targeting: 0, jamming: 0, tacticalScan: 2 }
    red2.sensors = { targeting: 0, jamming: 0, tacticalScan: 2 }
    game.phase = 'combat-1'
    game.segment = 'combat'
    return { game, blue, red1, red2 }
  }

  function bearingMounts(attacker: ShipState, target: ShipState) {
    const arcs = arcTo(attacker.placement.position, attacker.placement.heading, target.placement.position)
    return attacker.form.weapons.flatMap((weapon) =>
      weapon.mounts.flatMap((mount, mountIndex) => {
        const state = attacker.mounts[weapon.id][mountIndex]
        if (state.armed === 0 || state.firedSegment) return []
        if (!canBearOn(mount.arcs, arcs)) return []
        return [{ weaponId: weapon.id, mountIndex }]
      }),
    )
  }

  function fire(
    game: GameState,
    attacker: ShipState,
    target: ShipState,
    mounts = bearingMounts(attacker, target),
    mode: 'standard' | 'proximity' = 'standard',
  ) {
    return applyAction(game, {
      type: 'fire-volley',
      attackerId: attacker.id,
      targetId: target.id,
      mounts,
      mode,
      degraded: false,
    })
  }

  it('a second declaration at the same target is refused, not resolved as a second volley', () => {
    const { game, blue, red1 } = fleetFight()
    const first = bearingMounts(blue, red1)
    expect(first.length).toBeGreaterThan(1)

    const opening = fire(game, blue, red1, [first[0]])
    expect(opening.volley?.ok).toBe(true)
    expect(game.openFireShip).toBe(blue.id) // the opportunity is still open…

    // …but a second volley at the SAME target, with the remaining mount, is refused.
    const again = fire(game, blue, red1, [first[1]])
    expect(again.volley).toBeUndefined()
    expect(again.message).toMatch(/already fired on/i)
    expect(again.message).toMatch(/E7\.1\.1/)
    // The refusal must not close the opportunity or spend the mount.
    expect(game.openFireShip).toBe(blue.id)
    expect(blue.mounts[first[1].weaponId][first[1].mountIndex].firedSegment).not.toBe(true)
  })

  it('battles fought under reading 2 replay as they were: the repeat is accepted there', () => {
    const { game, blue, red1 } = fleetFight(2)
    const first = bearingMounts(blue, red1)
    fire(game, blue, red1, [first[0]])
    const again = fire(game, blue, red1, [first[1]])
    expect(again.message).toBeNull()
    expect(again.volley?.ok).toBe(true)
  })

  it('the same refusal applies across modes — a standard shot cannot be followed by a proximity one at the same hull', () => {
    const { game, blue, red1 } = fleetFight()
    const first = bearingMounts(blue, red1)
    fire(game, blue, red1, [first[0]], 'standard')
    const again = fire(game, blue, red1, [first[1]], 'proximity')
    expect(again.message).toMatch(/E3\.3\.8|E7\.1\.1/)
  })

  it('the ship may still split its fire across a DIFFERENT target (regression, E6.2 Step 6)', () => {
    const { game, blue, red1, red2 } = fleetFight()
    const first = bearingMounts(blue, red1)
    fire(game, blue, red1, [first[0]])
    const followup = fire(game, blue, red2)
    expect(followup.message).toBeNull()
    expect(followup.volley?.ok).toBe(true)
  })

  it('the record clears for the next Combat Segment, so re-engaging the same target next phase is legal', () => {
    const { game, blue, red1 } = fleetFight()
    fire(game, blue, red1)
    applyAction(game, { type: 'pass-fire', shipId: blue.id })
    expect(repeatTargetRefusal(game, blue, red1)).not.toBeNull()

    // Close out the Combat Segment and come back around.
    applyAction(game, { type: 'advance-segment' })
    expect(repeatTargetRefusal(game, blue, red1)).toBeNull()
  })
})

describe('H4.2.3 step 10 — coordinated fire group size', () => {
  function entries(scans: number[]) {
    return scans.map((scan, i) => ({
      ship: { id: `s${i}`, side: 'Blue', name: `Ship ${i}` } as ShipState,
      scan,
    }))
  }

  it('caps the highest coordinated step at five ships, same as steps 7-9', () => {
    const step10 = FIRING_STEPS[9]
    expect(step10.maxShips).toBe(5)
    // Five ships at scan 5 satisfy both the count and the per-ship scan floor.
    expect(validateCoordinatedFire(entries([5, 5, 5, 5, 5]), step10)).toBeNull()
    // A command ship can lend Tactical Scan with no upper bound (H5.2.2), so
    // six ships can clear the scan-per-ship math and must still be refused on
    // the printed ship count.
    expect(validateCoordinatedFire(entries([6, 6, 6, 6, 6, 6]), step10)).toMatch(/at most 5 ships/)
  })
})

describe('AI volley planning combines mounts into one volley, never splits one target (regression)', () => {
  /**
   * `bestVolley` (ai.ts) always gathers every ready, bearing mount against
   * its ONE chosen target into a single `fire-volley` action — it never
   * proposes a second declaration at a target it already fired on. Replaying
   * a driven battle's whole journal from scratch is the check that matters:
   * if the AI ever did emit a repeat, this replay would hit the E7.1.1
   * refusal added above and the volley would come back refused.
   */
  it('a driven multi-ship battle never has a fire-volley action refused on replay', () => {
    for (const seed of [1, 2, 3]) {
      const setup: GameSetup = {
        scenarioId: 's3.1-the-duel',
        seed,
        rulesVersion: 3,
        derelicts: true,
        fleets: {
          'Blue Force': ['union-union-iii-class-dreadnought'],
          'Red Force': [
            'union-yorktown-i-class-heavy-cruiser',
            'union-yorktown-i-class-heavy-cruiser',
            'union-yorktown-i-class-heavy-cruiser',
          ],
        },
      }
      const played = playBattle(setup, { rounds: 6 })

      const replay = buildGame(setup)
      let fireVolleys = 0
      for (const action of played.actions) {
        const outcome = applyAction(replay, action as GameAction)
        if ((action as GameAction).type === 'fire-volley') {
          fireVolleys++
          expect(outcome.message, `refused on replay: ${outcome.message}`).toBeNull()
        }
      }
      // The scenario must actually have exercised fire-volley for this to be
      // a meaningful check, not a vacuous pass.
      expect(fireVolleys).toBeGreaterThan(0)
    }
  })
})
