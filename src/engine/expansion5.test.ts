import { beforeEach, describe, expect, it } from 'vitest'
import { findShipForm, VALLARI_CRUISER, YORKTOWN } from '../data/ships'
import {
  attemptSearch,
  bestDetection,
  bonusSearch,
  CLOAK_NEAR_ENEMY_RANGE,
  cloakEffects,
  cloakFullyPowered,
  cloakOperational,
  cloakStrength,
  damageSearchDice,
  detectionBy,
  disengageCloak,
  engageCloak,
  firingPermission,
  freePlacementLegal,
  hasCloak,
  isCloaked,
  mayDecloak,
  maneuverAllowedWhileCloaked,
  mayFreePlace,
  newCloakState,
  positionIsHidden,
  precisionAllowed,
  reduceDetection,
  revealOrder,
  searchDice,
  searchRange,
  speedSearchDice,
  withinSearchRange,
  type CloakState,
} from './cloaking'
import { Rng } from './dice'
import {
  applyDefensiveFire,
  bracketForImpact,
  defendingArcs,
  endurance,
  impactShield,
  isHeadOn,
  isHoming,
  isMissile,
  isParticle,
  jammingPenalty,
  launchHomingWeapon,
  missileHitPoints,
  moveHomingWeapon,
  nextLegDistance,
  overflies,
  overflightShield,
  resetHomingIds,
  resolveHomingVolley,
  speedInPhase,
  tractorHomingWeapon,
  type HomingWeapon,
} from './homing'
import { canBearOn, translate } from './geometry'
import { THE_DUEL } from '../data/scenarios'
import { resolveVolley } from './combat'
import { autoChoices, newDeck } from './damage'
import {
  advanceSegment,
  cloakModifiers,
  cloakOf,
  cloudModifiers,
  createGame,
  displayPlacement,
  fireAtSmallTarget,
  impactingHoming,
  launchHoming,
  PHASE_SEGMENTS,
  resolveHomingImpacts,
  resolveUnansweredImpacts,
  shipIsCloaked,
  smallTargetsFor,
  type GameState,
} from './game'
import { createShip, type ShipState } from './shipState'
import type { WeaponSystemDef } from './types'

/** Walk the sequence of play until the predicate holds. */
function runTo(game: GameState, predicate: (g: GameState) => boolean, limit = 200): void {
  let steps = 0
  while (!predicate(game) && steps++ < limit) advanceSegment(game)
  if (steps >= limit) throw new Error('sequence did not reach the target state')
}

/**
 * Expansion 5: Cloaking Systems (H6) and Homing Weapons (E5), plus the missile
 * and particle weapon traits they lean on (F1.13, F1.16).
 */

const PASSER = findShipForm('PASSER I-class Frigate')!
const INVICTUS = findShipForm('INVICTUS I-class Dreadnought')!
const PLASMA = PASSER.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!

function ship(args: {
  id: string
  side?: string
  form?: typeof YORKTOWN
  x?: number
  y?: number
  heading?: number
  speed?: number
}): ShipState {
  return createShip({
    id: args.id,
    side: args.side ?? 'Blue',
    name: args.id.toUpperCase(),
    form: args.form ?? YORKTOWN,
    placement: { position: { x: args.x ?? 0, y: args.y ?? 0 }, heading: args.heading ?? 0 },
    speed: args.speed ?? 2,
  })
}

/** Fill every circle on the CLOAK line, which is what engaging needs (H6.3.1). */
function powerCloak(s: ShipState, fraction = 1): void {
  const line = s.form.functions.find((l) => l.label === 'CLOAK')!
  s.allocation[line.id] = Math.floor(line.steps.length * fraction)
}

beforeEach(() => resetHomingIds())

// ---------------------------------------------------------------------------
// H6.1 – H6.3 general
// ---------------------------------------------------------------------------

describe('cloaking systems (H6.1 – H6.3)', () => {
  it('finds cloaking systems on the ship form (H6.1.4)', () => {
    expect(hasCloak(ship({ id: 'a', form: PASSER }))).toBe(true)
    expect(hasCloak(ship({ id: 'b' }))).toBe(false)
  })

  it('stops working when a Special System hit lands on it (H6.1.4)', () => {
    const s = ship({ id: 'a', form: PASSER })
    expect(cloakOperational(s)).toBe(true)
    s.systemDamage['CLOAK'] = 1
    expect(cloakOperational(s)).toBe(false)
  })

  it('needs every circle on the CLOAK line filled (H6.3.1)', () => {
    const s = ship({ id: 'a', form: PASSER })
    expect(cloakFullyPowered(s)).toBe(false)
    powerCloak(s, 0.5)
    expect(cloakFullyPowered(s)).toBe(false)
    powerCloak(s)
    expect(cloakFullyPowered(s)).toBe(true)
  })

  it('refuses to engage on partial power or a damaged cloak', () => {
    const s = ship({ id: 'a', form: PASSER })
    const state = newCloakState(s.placement)
    expect(engageCloak(s, state, []).reason).toMatch(/partial power/)

    powerCloak(s)
    s.systemDamage['CLOAK'] = 1
    expect(engageCloak(s, state, []).reason).toMatch(/damaged/)
  })
})

// ---------------------------------------------------------------------------
// H6.4 effects
// ---------------------------------------------------------------------------

describe('cloaking effects (H6.4)', () => {
  it('shuts down shields, weapons, scans, tractors and command systems', () => {
    const on = cloakEffects({ engaged: true } as CloakState)
    expect(on).toEqual({
      shieldsDown: true,
      weaponsLocked: true,
      noScans: true,
      targetingDisabled: true,
      tractorsDisabled: true,
      transportersDisabled: true,
      commandDisabled: true,
    })
    const off = cloakEffects(undefined)
    expect(Object.values(off).every((v) => v === false)).toBe(true)
  })

  it('re-purposes jamming as extra power to the cloak (H6.4.5, H6.5.1)', () => {
    const s = ship({ id: 'a', form: PASSER })
    s.sensors.jamming = 3
    expect(cloakStrength(s)).toBe(3)
  })

  it('bars precision targeting at every detection level (H6.4.11)', () => {
    const state = newCloakState(ship({ id: 'a', form: PASSER }).placement)
    state.engaged = true
    state.detection['hunter'] = 3
    expect(precisionAllowed(state)).toBe(false)
    state.engaged = false
    expect(precisionAllowed(state)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// H6.6 / H6.7 engaging and disengaging
// ---------------------------------------------------------------------------

describe('engaging and disengaging (H6.6, H6.7)', () => {
  function setup(enemyDistance: number) {
    const s = ship({ id: 'ghost', form: PASSER })
    powerCloak(s)
    const enemy = ship({ id: 'hunter', side: 'Red', form: VALLARI_CRUISER, x: enemyDistance })
    return { s, enemy, state: newCloakState(s.placement) }
  }

  it('drops a datum where the ship was last seen (H6.6.4)', () => {
    const { s, state } = setup(30)
    s.placement = { position: { x: 12, y: 9 }, heading: 45 }
    engageCloak(s, state, [])
    expect(state.datum).toEqual({ position: { x: 12, y: 9 }, heading: 45 })
    expect(isCloaked(state)).toBe(true)
    expect(positionIsHidden(state)).toBe(true)
  })

  it('hands a free Contact to enemies within range 8 (H6.6.3)', () => {
    const near = setup(CLOAK_NEAR_ENEMY_RANGE)
    const result = engageCloak(near.s, near.state, [near.enemy])
    expect(result.ok).toBe(true)
    expect(result.freeContacts).toEqual(['hunter'])
    expect(detectionBy(near.state, 'hunter')).toBe(1)
    expect(positionIsHidden(near.state)).toBe(false)

    const far = setup(CLOAK_NEAR_ENEMY_RANGE + 1)
    expect(engageCloak(far.s, far.state, [far.enemy]).freeContacts).toEqual([])
    expect(detectionBy(far.state, 'hunter')).toBe(0)
  })

  it('holds the cloak on for a full phase before it may come off (H6.6.7)', () => {
    const { s, state } = setup(30)
    engageCloak(s, state, [])
    expect(mayDecloak(state)).toBe(false)
    state.phasesCloaked = 1
    expect(mayDecloak(state)).toBe(true)
  })

  it('holds the cloak off for a phase before it may go on again (H6.7.7)', () => {
    const { s, state } = setup(30)
    engageCloak(s, state, [])
    state.phasesCloaked = 1
    disengageCloak(state)
    expect(engageCloak(s, state, []).reason).toMatch(/full phase before re-engaging/)
    state.phasesUncloaked = 1
    expect(engageCloak(s, state, []).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// H6.9 – H6.12 searching
// ---------------------------------------------------------------------------

describe('searching for a cloaked ship (H6.9 – H6.12)', () => {
  function hunt(opts: { targeting?: number; jamming?: number; distance?: number } = {}) {
    const ghost = ship({ id: 'ghost', form: PASSER })
    ghost.sensors.jamming = opts.jamming ?? 1
    powerCloak(ghost)
    const state = newCloakState(ghost.placement)
    engageCloak(ghost, state, [])

    const hunter = ship({
      id: 'hunter',
      side: 'Red',
      form: VALLARI_CRUISER,
      x: opts.distance ?? 5,
    })
    hunter.sensors.targeting = opts.targeting ?? 3
    return { ghost, hunter, state }
  }

  it('reaches five inches per undamaged SCNC box (H6.9.1)', () => {
    const { hunter } = hunt()
    const boxes = hunter.form.systems.find((g) => g.kind === 'SCNC')!.boxes
    expect(searchRange(hunter)).toBe(boxes * 5)
    hunter.systemDamage['SCNC'] = boxes
    expect(searchRange(hunter)).toBe(0)
  })

  it('measures to the datum while undetected and to the ship once found (H6.9.1)', () => {
    const { ghost, hunter, state } = hunt({ distance: 5 })
    // Move the ship far away; while undetected the search still measures to
    // the datum it left behind.
    ghost.placement.position = { x: 100, y: 100 }
    expect(withinSearchRange(hunter, ghost, state)).toBe(true)
    state.detection['hunter'] = 1
    expect(withinSearchRange(hunter, ghost, state)).toBe(false)
  })

  it('rolls dice from targeting against jamming (H6.10.2)', () => {
    const more = hunt({ targeting: 5, jamming: 1 })
    expect(searchDice(more.hunter, more.ghost, more.state)).toEqual({ count: 4, color: 'green' })

    // Two dice minimum whenever targeting leads.
    const barely = hunt({ targeting: 2, jamming: 1 })
    expect(searchDice(barely.hunter, barely.ghost, barely.state)).toEqual({ count: 2, color: 'green' })

    const equal = hunt({ targeting: 2, jamming: 2 })
    expect(searchDice(equal.hunter, equal.ghost, equal.state)).toEqual({ count: 1, color: 'green' })

    const less = hunt({ targeting: 1, jamming: 3 })
    expect(searchDice(less.hunter, less.ghost, less.state).count).toBe(0)
  })

  it('switches to yellow dice once it holds a Track (H6.12.3, H6.14.3)', () => {
    const { ghost, hunter, state } = hunt()
    expect(searchDice(hunter, ghost, state).color).toBe('green')
    state.detection['hunter'] = 2
    expect(searchDice(hunter, ghost, state).color).toBe('yellow')
  })

  it('climbs exactly one level on any H, however many are rolled (H6.10.3)', () => {
    const { ghost, hunter, state } = hunt({ targeting: 6, jamming: 1 })
    const rng = new Rng(3)
    let climbed = 0
    for (let i = 0; i < 40 && detectionBy(state, 'hunter') < 3; i++) {
      state.raisedThisSegment = []
      state.searchedThisSegment = []
      const out = attemptSearch(hunter, ghost, state, rng)
      if (out.detected) {
        expect(out.to - out.from).toBe(1)
        climbed += 1
      }
    }
    expect(climbed).toBeGreaterThan(0)
    expect(detectionBy(state, 'hunter')).toBe(3)
  })

  it('lets a searcher gain only one level per segment (H6.15.1)', () => {
    const { ghost, hunter, state } = hunt({ targeting: 6, jamming: 1 })
    state.raisedThisSegment = ['hunter']
    const out = attemptSearch(hunter, ghost, state, new Rng(1))
    expect(out.detected).toBe(false)
    expect(out.reason).toMatch(/one detection level per segment/)
  })

  it('rolls its ONE search per phase — a miss cannot simply be rerolled (H6.9.2)', () => {
    const { ghost, hunter, state } = hunt({ targeting: 6, jamming: 1 })
    const first = attemptSearch(hunter, ghost, state, new Rng(1))
    expect(first.faces.length).toBeGreaterThan(0)
    // The playtest exploit: press the button again until it works.
    const second = attemptSearch(hunter, ghost, state, new Rng(2))
    expect(second.faces).toEqual([])
    expect(second.reason).toMatch(/already made its search this phase/)
    // The marker clears with the phase, like the one-level-per-segment one.
    state.searchedThisSegment = []
    state.raisedThisSegment = []
    expect(attemptSearch(hunter, ghost, state, new Rng(3)).faces.length).toBeGreaterThan(0)
  })

  it('refuses a search with less targeting than jamming (H6.10.2)', () => {
    const { ghost, hunter, state } = hunt({ targeting: 1, jamming: 3 })
    expect(attemptSearch(hunter, ghost, state, new Rng(1)).reason).toMatch(/no search may be attempted/)
  })

  it('refuses a search from beyond range (H6.9.1)', () => {
    const { ghost, hunter, state } = hunt({ distance: 60 })
    expect(attemptSearch(hunter, ghost, state, new Rng(1)).reason).toMatch(/search range/)
  })

  it('gives each searching ship its own detection level (H6.9.3)', () => {
    const { ghost, state } = hunt()
    state.detection['a'] = 3
    state.detection['b'] = 1
    expect(detectionBy(state, 'a')).toBe(3)
    expect(detectionBy(state, 'b')).toBe(1)
    expect(detectionBy(state, 'c')).toBe(0)
    expect(bestDetection(state)).toBe(3)
    expect(ghost.name).toBe('GHOST')
  })

  it('counts bonus search dice from speed and damage (H6.15.2, H6.15.3)', () => {
    expect(speedSearchDice(2)).toBe(0)
    expect(speedSearchDice(3)).toBe(1)
    expect(speedSearchDice(6)).toBe(4)
    expect(damageSearchDice(3)).toBe(0)
    expect(damageSearchDice(4)).toBe(1)
    expect(damageSearchDice(11)).toBe(2)
  })

  it('rolls the bonus dice at the searcher’s current colour (H6.15.1)', () => {
    const { ghost, hunter, state } = hunt({ targeting: 4, jamming: 1 })
    const out = bonusSearch(hunter, ghost, state, 4, new Rng(2))
    expect(out.faces).toHaveLength(4)
    if (out.detected) expect(out.to).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// H6.13 reducing detection
// ---------------------------------------------------------------------------

describe('reducing detection (H6.13)', () => {
  it('drops a level on an M, one roll per searcher holding a level', () => {
    const state = newCloakState(ship({ id: 'g', form: PASSER }).placement)
    state.engaged = true
    state.detection = { a: 3, b: 1 }

    const rng = new Rng(7)
    let sawDrop = false
    for (let i = 0; i < 30; i++) {
      const before = { ...state.detection }
      const results = reduceDetection(state, rng)
      expect(results.length).toBe(Object.keys(before).filter((k) => before[k] > 0).length)
      for (const r of results) {
        if (r.reduced) {
          expect(r.face).toBe('M')
          sawDrop = true
        }
      }
      if (Object.keys(state.detection).length === 0) break
    }
    expect(sawDrop).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// H6.14 firing
// ---------------------------------------------------------------------------

describe('firing at a cloaked ship (H6.14)', () => {
  it('gates fire on the detection level', () => {
    const state = newCloakState(ship({ id: 'g', form: PASSER }).placement)
    state.engaged = true

    expect(firingPermission(state, 'h')).toMatchObject({ mayFire: false })
    state.detection['h'] = 1
    expect(firingPermission(state, 'h')).toMatchObject({ mayFire: false })
    state.detection['h'] = 2
    expect(firingPermission(state, 'h')).toEqual({ mayFire: true, degraded: true })
    state.detection['h'] = 3
    expect(firingPermission(state, 'h')).toEqual({ mayFire: true, degraded: false })
  })

  it('imposes nothing on an uncloaked ship', () => {
    const state = newCloakState(ship({ id: 'g', form: PASSER }).placement)
    expect(firingPermission(state, 'h')).toEqual({ mayFire: true, degraded: false })
  })
})

// ---------------------------------------------------------------------------
// H6.8 undetected movement
// ---------------------------------------------------------------------------

describe('undetected movement (H6.8)', () => {
  it('allows only gentle maneuvers while hidden (H6.8.5)', () => {
    for (const m of ['straight', 'slide', 'easy', 'standard']) {
      expect(maneuverAllowedWhileCloaked(m), m).toBe(true)
    }
    for (const m of ['hard', 's-turn', 'snap', 'em-90', 'em-180']) {
      expect(maneuverAllowedWhileCloaked(m), m).toBe(false)
    }
  })

  it('lets a long-cloaked ship reappear near its datum (H6.8.7)', () => {
    const s = ship({ id: 'g', form: PASSER })
    const state = newCloakState(s.placement)
    state.engaged = true
    expect(mayFreePlace(state)).toBe(false)

    state.speedLog = new Array(18).fill(2)
    expect(mayFreePlace(state)).toBe(true)
    expect(freePlacementLegal(state, { position: { x: 10, y: 10 }, heading: 90 }, 2)).toBeNull()
    expect(freePlacementLegal(state, { position: { x: 30, y: 0 }, heading: 0 }, 2)).toMatch(/within 18/)
    expect(freePlacementLegal(state, { position: { x: 1, y: 1 }, heading: 0 }, 4)).toMatch(/speed 0 to 2/)
  })

  it('reveals the ship cloaked for fewest phases first (H6.8.6)', () => {
    const order = revealOrder(
      [
        { id: 'b', phasesCloaked: 6 },
        { id: 'a', phasesCloaked: 4 },
      ],
      new Rng(1),
    )
    expect(order).toEqual(['a', 'b'])
  })
})

// ---------------------------------------------------------------------------
// E5 homing weapons
// ---------------------------------------------------------------------------

describe('homing weapon charts (E5.1.5)', () => {
  it('recognises the traits (F1.10, F1.13, F1.16)', () => {
    expect(isHoming(PLASMA)).toBe(true)
    expect(isParticle(PLASMA)).toBe(true)
    expect(isMissile(PLASMA)).toBe(false)
    const phaser = YORKTOWN.weapons.find((w) => w.weaponClass === 'phaser')!
    expect(isHoming(phaser)).toBe(false)
  })

  it('counts endurance from the red boxes', () => {
    expect(endurance(PLASMA)).toBe(3)
    expect(endurance(YORKTOWN.weapons[0])).toBe(0)
  })

  it('flies the widest bracket of each red box (E5.1.5)', () => {
    expect(speedInPhase(PLASMA, 1)).toBe(3)
    expect(speedInPhase(PLASMA, 2)).toBe(6)
    expect(speedInPhase(PLASMA, 3)).toBe(9)
    expect(speedInPhase(PLASMA, 4)).toBe(0)
  })

  it('picks the impact bracket from inside the current box', () => {
    // The Invictus's heavy torpedo has two brackets in some boxes.
    const heavy = INVICTUS.weapons.find((w) => w.name === 'RP-A HVY PLASMA TORP')!
    const box2 = heavy.brackets.filter((b) => b.endurancePhase === 2)
    expect(box2.length).toBeGreaterThan(0)
    expect(bracketForImpact(PLASMA, 2, 4)!.max).toBe(6)
    expect(bracketForImpact(PLASMA, 1, 9)).toBeNull()
  })
})

describe('launching and moving homing weapons (E5.2, E5.3)', () => {
  function launch(distance: number) {
    const launcher = ship({ id: 'aur', form: PASSER, y: 0, heading: 0 })
    const target = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: -distance })
    const hw = launchHomingWeapon({ launcher, weapon: PLASMA, target, arc: 'FS' })
    return { launcher, target, hw }
  }

  it('places the counter against the launching arc’s side (E5.2.8)', () => {
    const { hw } = launch(20)
    // Launched from a forward arc on a ship facing north, so just ahead of it.
    expect(hw.position.x).toBeCloseTo(0)
    expect(hw.position.y).toBeCloseTo(-0.75)
    expect(hw.phasesFlown).toBe(0)
  })

  it('does not move during the phase it was launched (E5.1.6)', () => {
    const { hw } = launch(20)
    expect(hw.phasesFlown).toBe(0)
  })

  it('flies further each phase as it accelerates (E5.1.5)', () => {
    const { target, hw } = launch(30)
    expect(nextLegDistance(hw, PLASMA)).toBe(3)
    moveHomingWeapon(hw, PLASMA, target)
    expect(nextLegDistance(hw, PLASMA)).toBe(6)
    moveHomingWeapon(hw, PLASMA, target)
    expect(nextLegDistance(hw, PLASMA)).toBe(9)
  })

  it('impacts when the target is inside the leg’s range (E5.4 Step 1)', () => {
    const { target, hw } = launch(3)
    const result = moveHomingWeapon(hw, PLASMA, target)
    expect(result.impact).toBe(true)
    expect(hw.impacted).toBe(true)
    // The launcher sits astern of a target that is also heading north, so the
    // torpedo runs up its wake and strikes the aft shield (E5.4 Step 2).
    expect(result.side).toBe('A')
  })

  it('strikes the shield it approaches from (E5.4 Step 2)', () => {
    const { target, hw } = launch(3)
    // Turn the target about so its bow faces the incoming torpedo.
    target.placement.heading = 180
    const result = moveHomingWeapon(hw, PLASMA, target)
    expect(result.side).toBe('F')
    // The counter finishes flush against the shield it hit, not on top of the
    // ship (E5.4 Step 2).
    expect(hw.position).not.toEqual(target.placement.position)
  })

  it('closes the distance without impacting when it is short (E5.3.4)', () => {
    const { target, hw } = launch(20)
    const result = moveHomingWeapon(hw, PLASMA, target)
    expect(result.impact).toBe(false)
    expect(result.flown).toBe(3)
    // It must end nearer the target than it began (E5.3.4 item 1).
    expect(Math.abs(hw.position.y - target.placement.position.y)).toBeCloseTo(20 - 0.75 - 3)
  })

  it('expires once it runs out of endurance (E5.1.6)', () => {
    const { target, hw } = launch(40)
    for (let i = 0; i < 3; i++) moveHomingWeapon(hw, PLASMA, target)
    expect(hw.phasesFlown).toBe(3)
    const result = moveHomingWeapon(hw, PLASMA, target)
    expect(result.expired).toBe(true)
  })

  it('respects a reduced top speed set at launch (E5.2.5)', () => {
    const launcher = ship({ id: 'aur', form: PASSER })
    const target = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: -30 })
    const hw = launchHomingWeapon({ launcher, weapon: PLASMA, target, arc: 'FS', maxSpeed: 2 })
    expect(nextLegDistance(hw, PLASMA)).toBe(2)
    moveHomingWeapon(hw, PLASMA, target)
    expect(nextLegDistance(hw, PLASMA)).toBe(2)
  })

  it('slows to jamming from the second leg onward (E5.10.1)', () => {
    const { target, hw } = launch(30)
    target.sensors.jamming = 3
    const launcher = ship({ id: 'aur', form: PASSER })
    launcher.sensors.targeting = 1
    const penalty = jammingPenalty(target, launcher)
    expect(penalty).toBe(2)

    // First leg is untouched.
    expect(nextLegDistance(hw, PLASMA, penalty)).toBe(3)
    moveHomingWeapon(hw, PLASMA, target, penalty)
    expect(nextLegDistance(hw, PLASMA, penalty)).toBe(4)
  })
})

describe('homing weapon edge cases (E5.9)', () => {
  it('strikes head-on before the target moves (E5.9.1)', () => {
    const target = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: 0, heading: 0, speed: 5 })
    const launcher = ship({ id: 'aur', form: PASSER, y: -10 })
    const hw = launchHomingWeapon({ launcher, weapon: PLASMA, target, arc: 'FS' })

    // Five inches dead ahead of a ship making speed five.
    hw.position = { x: 0, y: -5 }
    expect(isHeadOn(hw, target)).toBe(true)

    // Six inches ahead and it will not intercept this phase.
    hw.position = { x: 0, y: -6 }
    expect(isHeadOn(hw, target)).toBe(false)

    // Behind the ship is not head-on at all.
    hw.position = { x: 0, y: 3 }
    expect(isHeadOn(hw, target)).toBe(false)
  })

  it('never applies head-on to a stationary target (E5.9.1)', () => {
    const target = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, speed: 0 })
    const launcher = ship({ id: 'aur', form: PASSER })
    const hw = launchHomingWeapon({ launcher, weapon: PLASMA, target, arc: 'FS' })
    hw.position = { x: 0, y: -1 }
    expect(isHeadOn(hw, target)).toBe(false)
  })

  it('uses the aft arc when the target is in reverse (E5.9.1)', () => {
    const target = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, heading: 0, speed: -4 })
    const launcher = ship({ id: 'aur', form: PASSER })
    const hw = launchHomingWeapon({ launcher, weapon: PLASMA, target, arc: 'FS' })
    hw.position = { x: 0, y: 3 } // astern, which is where a reversing ship is going
    expect(isHeadOn(hw, target)).toBe(true)
  })

  it('is hit by a target that flies over it (E5.9.2)', () => {
    const target = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, speed: 4 })
    const launcher = ship({ id: 'aur', form: PASSER })
    const hw = launchHomingWeapon({ launcher, weapon: PLASMA, target, arc: 'FS' })
    hw.position = { x: 0, y: -3 }

    const path = [
      { x: 0, y: 0 },
      { x: 0, y: -2 },
      { x: 0, y: -4 },
    ]
    expect(overflies(path, hw)).toBe(true)
    expect(overflightShield(target)).toBe('F')

    target.speed = -4
    expect(overflightShield(target)).toBe('A')
    expect(overflies([{ x: 20, y: 20 }], hw)).toBe(false)
  })
})

describe('resolving homing impacts (E5.4, F1.13, F1.16)', () => {
  const missileDef: WeaponSystemDef = {
    ...PLASMA,
    id: 'msl',
    name: 'TEST MISSILE',
    traits: ['HOMING 3', 'MISL 4'],
  }

  function flight(count: number, def = PLASMA): HomingWeapon[] {
    const launcher = ship({ id: 'aur', form: PASSER })
    const target = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: -5 })
    return Array.from({ length: count }, () =>
      launchHomingWeapon({ launcher, weapon: def, target, arc: 'FS' }),
    )
  }

  it('reads MISL X as the damage that kills one missile (F13.2)', () => {
    expect(missileHitPoints(missileDef)).toBe(4)
    const weapons = flight(3, missileDef)
    const { destroyed, absorbed } = applyDefensiveFire(weapons, missileDef, 9)
    // Nine points kills two outright and cripples nothing: partial damage does
    // not slow a missile down (F13.2).
    expect(destroyed).toHaveLength(2)
    expect(absorbed).toBe(9)
    expect(weapons[2].damage).toBe(1)
    expect(weapons[2].destroyed).toBe(false)
  })

  it('never destroys a particle weapon outright, only weakens it (F1.16.1)', () => {
    const weapons = flight(2)
    applyDefensiveFire(weapons, PLASMA, 10)
    expect(weapons.some((w) => w.destroyed)).toBe(false)
    expect(weapons[0].damage).toBe(10)
  })

  it('takes a point of damage off a particle volley per three absorbed (F1.16.2)', () => {
    const weapons = flight(1)
    const rng = new Rng(5)
    const clean = resolveHomingVolley(weapons, PLASMA, 'F', 2, 4, rng)

    const hurt = flight(1)
    hurt[0].damage = 10 // 10 / 3 = 3 points off
    const worn = resolveHomingVolley(hurt, PLASMA, 'F', 2, 4, new Rng(5))

    expect(worn.absorbed).toBe(10)
    expect(clean.standard - worn.standard).toBe(3)
  })

  it('eats standard damage, then leak, then structure (F1.16.2 steps 5-7)', () => {
    const weapons = flight(1)
    // Enough absorbed damage to wipe the whole volley out.
    weapons[0].damage = 300
    const volley = resolveHomingVolley(weapons, PLASMA, 'F', 3, 5, new Rng(9))
    expect(volley.standard).toBe(0)
    expect(volley.leak).toBe(0)
    expect(volley.structure).toBe(0)
  })

  it('leaves destroyed and tractored weapons out of the volley (E5.4)', () => {
    const weapons = flight(3, missileDef)
    weapons[0].destroyed = true
    weapons[1].tractored = true
    const volley = resolveHomingVolley(weapons, missileDef, 'F', 1, 2, new Rng(1))
    expect(volley.weapons).toHaveLength(1)
  })

  it('holds a missile with a tractor beam but never a particle weapon (E5.4 Step 6)', () => {
    const [missile] = flight(1, missileDef)
    expect(tractorHomingWeapon(missile, missileDef)).toBeNull()
    expect(missile.tractored).toBe(true)

    const [plasma] = flight(1)
    expect(tractorHomingWeapon(plasma, PLASMA)).toMatch(/may not be used against particle/)
    expect(plasma.tractored).toBe(false)
  })

  it('lets both arcs of the struck shield answer with point defense (E5.4 Step 2)', () => {
    const target = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, heading: 0 })
    const launcher = ship({ id: 'aur', form: PASSER, y: -10 })
    const hw = launchHomingWeapon({ launcher, weapon: PLASMA, target, arc: 'FS' })
    hw.position = { x: 0, y: -4 }
    expect(impactShield(hw, target)).toBe('F')
    expect(defendingArcs(hw, target).sort()).toEqual(['FP', 'FS'])
  })
})

// ---------------------------------------------------------------------------
// Wiring into the sequence of play
// ---------------------------------------------------------------------------

describe('cloaks and homing weapons in play', () => {
  function battle() {
    const ghost = ship({ id: 'ghost', form: PASSER, y: 0 })
    const hunter = ship({ id: 'hunter', side: 'Red', form: VALLARI_CRUISER, y: -20 })
    const game = createGame({ scenario: THE_DUEL, ships: [ghost, hunter], seed: 12 })
    return { game, ghost, hunter }
  }

  it('gives every cloak-carrying ship a hidden track (H6.1)', () => {
    const { game, ghost, hunter } = battle()
    expect(cloakOf(game, ghost)).toBeTruthy()
    expect(cloakOf(game, hunter)).toBeUndefined()
    expect(shipIsCloaked(game, ghost)).toBe(false)
  })

  it('shows the datum instead of the ship while it is undetected (H6.2.2)', () => {
    const { game, ghost } = battle()
    powerCloak(ghost)
    engageCloak(ghost, cloakOf(game, ghost)!, [])
    ghost.placement.position = { x: 15, y: 15 }

    expect(displayPlacement(game, ghost).position).toEqual({ x: 0, y: 0 })
    cloakOf(game, ghost)!.detection['hunter'] = 1
    expect(displayPlacement(game, ghost).position).toEqual({ x: 15, y: 15 })
  })

  it('drops the target’s shields and degrades fire at Track level (H6.4.1, H6.14.3)', () => {
    const { game, ghost, hunter } = battle()
    powerCloak(ghost)
    engageCloak(ghost, cloakOf(game, ghost)!, [])
    cloakOf(game, ghost)!.detection['hunter'] = 2

    const mods = cloudModifiers(game, hunter, ghost)
    expect(mods.targetShieldsInoperative).toBe(true)
    expect(mods.degradedFireControl).toBe(true)

    // A Target Lock fires normally, but the shields stay down.
    cloakOf(game, ghost)!.detection['hunter'] = 3
    const locked = cloudModifiers(game, hunter, ghost)
    expect(locked.degradedFireControl).toBe(false)
    expect(locked.targetShieldsInoperative).toBe(true)
  })

  it('refuses fire at an undetected or Contact-level ship (H6.14.1, H6.14.2)', () => {
    const { game, ghost, hunter } = battle()
    powerCloak(ghost)
    engageCloak(ghost, cloakOf(game, ghost)!, [])

    expect(cloakModifiers(game, hunter, ghost).targetUnshootable).toMatch(/undetected/)
    cloakOf(game, ghost)!.detection['hunter'] = 1
    expect(cloakModifiers(game, hunter, ghost).targetUnshootable).toMatch(/Contact/)
    cloakOf(game, ghost)!.detection['hunter'] = 2
    expect(cloakModifiers(game, hunter, ghost).targetUnshootable).toBeUndefined()
  })

  it('locks a cloaked ship’s own weapons (H6.4.2)', () => {
    const { game, ghost, hunter } = battle()
    powerCloak(ghost)
    engageCloak(ghost, cloakOf(game, ghost)!, [])

    const disruptor = ghost.form.weapons.find((w) => w.weaponClass === 'disruptor')!
    ghost.mounts[disruptor.id][0].armed = disruptor.mounts[0].armingCircles
    const result = resolveVolley(
      {
        attacker: ghost,
        target: hunter,
        mounts: [{ weaponId: disruptor.id, mountIndex: 0 }],
        mode: 'standard',
        ...cloakModifiers(game, ghost, hunter),
      },
      { deck: newDeck(new Rng(1)), rng: new Rng(1), choices: autoChoices, log: () => {} },
      new Rng(1),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/cloaked and may not fire/)
  })

  it('logs the speed of a hidden ship each phase (H6.5.4)', () => {
    const { game, ghost } = battle()
    powerCloak(ghost)
    engageCloak(ghost, cloakOf(game, ghost)!, [])
    ghost.speed = 2

    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'navigation')
    advanceSegment(game)
    expect(cloakOf(game, ghost)!.speedLog).toEqual([2])
  })

  it('ticks the minimum cloak and uncloak timers each phase (H6.6.7, H6.7.7)', () => {
    const { game, ghost } = battle()
    powerCloak(ghost)
    engageCloak(ghost, cloakOf(game, ghost)!, [])
    expect(mayDecloak(cloakOf(game, ghost)!)).toBe(false)

    runTo(game, (g) => g.phase === 'combat-2' && g.segment === 'command')
    expect(cloakOf(game, ghost)!.phasesCloaked).toBeGreaterThanOrEqual(1)
    expect(mayDecloak(cloakOf(game, ghost)!)).toBe(true)
  })

  it('launches, flies and strikes over successive phases (E5.2 – E5.4)', () => {
    const ghost = ship({ id: 'ghost', form: PASSER, y: 0, heading: 180 })
    // Three inches ahead: inside the torpedo's first-phase range of 3 (E5.1.5).
    const foe = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: 3, heading: 0 })
    const game = createGame({ scenario: THE_DUEL, ships: [ghost, foe], seed: 4 })

    const torp = ghost.form.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!
    ghost.mounts[torp.id][0].armed = torp.mounts[0].armingCircles
    expect(launchHoming(game, ghost, torp, 0, foe)).toBeNull()
    expect(game.homing).toHaveLength(1)
    // The launch phase costs no endurance (E5.1.6).
    expect(game.homing[0].phasesFlown).toBe(0)
    // Firing discharges the mount (E6.2 Step 6).
    expect(ghost.mounts[torp.id][0].armed).toBe(0)

    // Hold both ships still and walk a navigation segment; the torpedo closes.
    ghost.speed = 0
    foe.speed = 0
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'navigation')
    advanceSegment(game)
    expect(game.homing[0].phasesFlown).toBe(1)
    expect(game.homing[0].impacted).toBe(true)

    const before = foe.blueShieldDamage.F + foe.armorDamage.F + foe.structureDamaged.filter(Boolean).length
    resolveHomingImpacts(game, foe)
    const after = foe.blueShieldDamage.F + foe.armorDamage.F + foe.structureDamaged.filter(Boolean).length
    expect(after).toBeGreaterThan(before)
    // Resolved weapons come off the map.
    expect(game.homing).toHaveLength(0)
  })

  it('refuses a launch from a cloaked ship or at an undetected one (H6.4.2, E5.2.2)', () => {
    const { game, ghost, hunter } = battle()
    const torp = ghost.form.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!
    ghost.mounts[torp.id][0].armed = torp.mounts[0].armingCircles
    powerCloak(ghost)
    engageCloak(ghost, cloakOf(game, ghost)!, [])
    expect(launchHoming(game, ghost, torp, 0, hunter)).toMatch(/cloaked and may not launch/)

    disengageCloak(cloakOf(game, ghost)!)
    // Now hide the *target* instead.
    game.cloaks['hunter'] = newCloakState(hunter.placement)
    game.cloaks['hunter'].engaged = true
    expect(launchHoming(game, ghost, torp, 0, hunter)).toMatch(/no Track or Lock/)
  })

  it('point defense destroys missiles before they strike (E5.4 Steps 4-5)', () => {
    const ghost = ship({ id: 'ghost', form: PASSER, y: 0, heading: 180 })
    const foe = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: 3, heading: 0 })
    const game = createGame({ scenario: THE_DUEL, ships: [ghost, foe], seed: 8 })

    const torp = ghost.form.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!
    ghost.mounts[torp.id][0].armed = torp.mounts[0].armingCircles
    launchHoming(game, ghost, torp, 0, foe)
    ghost.speed = 0
    foe.speed = 0
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'navigation')
    advanceSegment(game)

    // A plasma torpedo is a particle weapon: heavy point defense does not stop
    // it, but it arrives much weaker (F1.16).
    const struck = impactingHoming(game, foe)
    expect(struck).toHaveLength(1)
    resolveHomingImpacts(game, foe, { F: 30 })
    expect(game.log.some((e) => /worn down to nothing|reduced by 30 points/.test(e.message))).toBe(true)
  })

  /**
   * Point defense at the moment of impact used to be the one attack in the
   * game the table rolled for itself: the panel asked the defender for a
   * number and trusted it. Everything needed to play it as a shot was already
   * there — `fire-small-target` picks a mount, checks the arc, rolls the
   * bracket and records the damage on the counter — it simply refused to aim
   * at a counter that had arrived.
   *
   * So a counter that has arrived is now a target for the ship it arrived at,
   * and nobody else: E5.4 Step 4 is that ship's defensive fire, and a
   * bystander shooting a warhead already on someone else's hull is not a
   * thing the sequence of play has a place for.
   */
  function underFire() {
    const ghost = ship({ id: 'ghost', form: PASSER, y: 0, heading: 180 })
    const foe = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: 3, heading: 0 })
    const game = createGame({ scenario: THE_DUEL, ships: [ghost, foe], seed: 8 })
    const torp = ghost.form.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!
    ghost.mounts[torp.id][0].armed = torp.mounts[0].armingCircles
    launchHoming(game, ghost, torp, 0, foe)
    ghost.speed = 0
    foe.speed = 0
    runTo(game, (g) => g.phase === 'combat-1' && g.segment === 'navigation')
    advanceSegment(game)
    return { game, ghost, foe, counter: impactingHoming(game, foe)[0] }
  }

  it('lets the ship being struck shoot the counter on its doorstep, and nobody else', () => {
    const { game, ghost, foe, counter } = underFire()
    expect(counter.impacted).toBe(true)
    expect(smallTargetsFor(game, foe).map((t) => t.id)).toContain(counter.id)
    // The launcher does not get to shoot its own torpedo off the target, and
    // neither would an escort: it has arrived.
    expect(smallTargetsFor(game, ghost).map((t) => t.id)).not.toContain(counter.id)
  })

  it('rolls the defensive fire instead of taking a number for it (E5.4 Step 4)', () => {
    const { game, foe, counter } = underFire()
    // Whichever point-defense mounts make up the struck shield's two arcs
    // (E5.4 Step 2) — armed, because arming is not what is under test.
    const answering = defendingArcs(counter, foe)
    const bearing = foe.form.weapons.flatMap((weapon) =>
      weapon.mounts.flatMap((mount, index) =>
        canBearOn(mount.arcs, answering) ? [{ weapon, index }] : [],
      ),
    )
    expect(bearing.length, 'no mount bears on the impact').toBeGreaterThan(0)
    for (const { weapon, index } of bearing) {
      foe.mounts[weapon.id][index].armed = weapon.mounts[index].armingCircles
    }

    const { weapon, index } = bearing[0]
    const result = fireAtSmallTarget(game, foe, counter.id, weapon.id, index)
    expect(result.refusal).toBeNull()
    // The roll landed on the counter, which is where `resolveHomingVolley`
    // reads it back off — the same place the typed-in number used to go.
    expect(counter.damage).toBe(result.volley!.damage)
    expect(foe.mounts[weapon.id][index].armed, 'firing discharges the mount').toBe(0)

    const before = counter.damage
    resolveHomingImpacts(game, foe)
    expect(before, 'the shot has to have put something into it to be worth asserting on').toBeGreaterThan(0)
    expect(
      game.log.some((e) => /reduced by \d+ points of defensive fire|worn down to nothing/.test(e.message)),
    ).toBe(true)
  })

  it('says so in the log when an unanswered impact was shot at anyway', () => {
    const { game, counter } = underFire()
    counter.damage = 6
    resolveUnansweredImpacts(game)
    expect(game.log.some((e) => /defensive fire already put into it/.test(e.message))).toBe(true)
    expect(game.log.some((e) => /offers no point defense/.test(e.message))).toBe(false)
  })
})

describe('unusual situations, played out (E5.9.1, E5.9.2)', () => {
  /**
   * Both rules existed as tested helpers that the sequence of play never
   * called, so a torpedo the ship drove straight into still chased it down and
   * hit the aft shield — the exact outcome E5.9.1's designer note calls
   * unrealistic and the rule exists to prevent.
   */
  function closing(speed: number, gap: number) {
    resetHomingIds()
    // A Union cruiser bearing down on an Aurelian torpedo dead ahead of it.
    const runner = ship({ id: 'runner', form: VALLARI_CRUISER, y: 0, heading: 0, speed })
    const shooter = ship({ id: 'shooter', side: 'Red', form: PASSER, y: -30, heading: 180 })
    const game = createGame({ scenario: THE_DUEL, ships: [runner, shooter], seed: 11 })
    const torp = shooter.form.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!
    shooter.mounts[torp.id][0].armed = torp.mounts[0].armingCircles
    expect(launchHoming(game, shooter, torp, 0, runner)).toBeNull()
    // Park it exactly `gap` inches along the runner's own heading.
    game.homing[0].position = translate(runner.placement.position, runner.placement.heading, gap)
    return { game, runner }
  }

  it('strikes the leading shield before the ship can move (E5.9.1)', () => {
    const { game, runner } = closing(5, 4)
    runTo(game, (g) => g.segment === 'navigation')
    const where = { ...runner.placement.position }

    advanceSegment(game)
    const hw = game.homing[0]
    expect(hw?.impacted ?? true).toBe(true)
    // The rule fixes *which shield*, not whether the ship moves: the strike is
    // resolved from where the ship was, and then it carries on.
    if (hw) {
      expect(hw.forcedShield).toBe('F')
      expect(hw.position).toEqual(where)
    }
    const line = game.log.find((l) => l.message.includes('E5.9.1'))!
    expect(line.message).toContain('F shield')
    expect(runner.placement.position).not.toEqual(where)
  })

  it('leaves a weapon further off than the ship is fast alone (E5.9.1 step 2)', () => {
    const { game } = closing(2, 9)
    runTo(game, (g) => g.segment === 'navigation')
    advanceSegment(game)
    expect(game.log.some((l) => l.message.includes('E5.9.1'))).toBe(false)
  })

  it('hits the front shield when the ship drives over it (E5.9.2)', () => {
    // Far enough ahead that the head-on check passes it by, close enough that
    // the ship's own movement runs it down.
    const { game } = closing(6, 7)
    runTo(game, (g) => g.segment === 'navigation')
    advanceSegment(game)

    const struck = game.log.find((l) => l.message.includes('E5.9.2'))
    if (struck) {
      expect(struck.message).toContain('F shield')
      expect(game.homing[0]?.forcedShield ?? 'F').toBe('F')
    }
  })

  it('names the aft shield for a ship running in reverse', () => {
    const s = ship({ id: 'r', form: PASSER, speed: -3 })
    expect(overflightShield(s)).toBe('A')
    s.speed = 3
    expect(overflightShield(s)).toBe('F')
  })
})

// ---------------------------------------------------------------------------
// Impacts nobody answered (the frozen-torpedo report)
// ---------------------------------------------------------------------------

describe('impacts nobody answered (E5.4)', () => {
  /**
   * The playtest that found this: plasma torpedoes impacted the Yorktown,
   * the player never pressed Resolve Impacts, and the counters froze on the
   * map with their warheads unspent — forever. The impact question expires
   * with the Combat Segment; the warheads must not.
   */
  function impactedBattle() {
    const aur = ship({ id: 'aur', form: PASSER })
    const foe = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, y: -5 })
    const game = createGame({ scenario: THE_DUEL, ships: [aur, foe], seed: 7 })
    for (let i = 0; i < 2; i++) {
      const hw = launchHomingWeapon({ launcher: aur, weapon: PLASMA, target: foe, arc: 'FS' })
      hw.impacted = true
      hw.position = { ...foe.placement.position }
      hw.phasesFlown = 1
      game.homing.push(hw)
    }
    game.phase = 'combat-1'
    game.segment = 'combat'
    return { game, foe }
  }

  const marks = (s: ShipState) =>
    Object.values(s.blueShieldDamage).reduce((a, b) => a + b, 0) +
    s.structureDamaged.filter(Boolean).length +
    Object.values(s.systemDamage).reduce((a, b) => a + b, 0)

  it('sets the warheads off when the Combat Segment closes, with no point defense', () => {
    const { game, foe } = impactedBattle()
    expect(marks(foe)).toBe(0)
    advanceSegment(game)
    expect(game.homing).toHaveLength(0)
    expect(game.log.some((l) => l.message.includes('offers no point defense'))).toBe(true)
    expect(marks(foe)).toBeGreaterThan(0)
  })

  it('catches anything left at the round boundary too', () => {
    const { game, foe } = impactedBattle()
    game.phase = 'final'
    game.segment = PHASE_SEGMENTS.final[PHASE_SEGMENTS.final.length - 1]
    advanceSegment(game)
    expect(game.round).toBe(2)
    expect(game.homing).toHaveLength(0)
    expect(marks(foe)).toBeGreaterThan(0)
  })

  it('sweeps counters aimed at a ship that is already gone', () => {
    const { game, foe } = impactedBattle()
    foe.destroyed = true
    advanceSegment(game)
    expect(game.homing).toHaveLength(0)
    expect(marks(foe)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Launchers bear like any other mount (E2.2, E5.2)
// ---------------------------------------------------------------------------

describe('a launcher obeys its firing arcs (E2.2, E5.2)', () => {
  /**
   * Reported from a live game: an Aurelian cruiser threw a plasma torpedo at
   * a ship its tubes could not possibly point at. Nothing in the launch path
   * consulted the mount's arcs — the engine checked arming, cloaks and line
   * of sight and then fired regardless of where the target was.
   */
  const CORVUS = findShipForm('CORVUS I-class Destroyer')!
  const LUPUS = findShipForm('LUPUS I-class Cruiser')!

  /** A launcher facing north, and a target placed on some bearing from it. */
  function setup(form: typeof PASSER, dx: number, dy: number) {
    const launcher = ship({ id: 'aur', form, x: 20, y: 20, heading: 0 })
    const foe = ship({ id: 'foe', side: 'Red', form: VALLARI_CRUISER, x: 20 + dx, y: 20 + dy })
    const game = createGame({ scenario: THE_DUEL, ships: [launcher, foe], seed: 4 })
    const torp = form.weapons.find((w) => w.weaponClass === 'plasma-torpedo')!
    torp.mounts.forEach((m, i) => {
      launcher.mounts[torp.id][i].armed = m.armingCircles
    })
    return { game, launcher, foe, torp }
  }

  it('refuses a target astern of a forward tube', () => {
    // Heading north (0), so a target to the south sits in the aft arcs.
    const { game, launcher, foe, torp } = setup(PASSER, 0, 12)
    expect(torp.mounts[0].arcs).toEqual(['FS', 'FP'])
    expect(launchHoming(game, launcher, torp, 0, foe)).toMatch(/cannot bear/)
    expect(game.homing).toHaveLength(0)
    // The mount keeps its charge: a refused launch spends nothing.
    expect(launcher.mounts[torp.id][0].armed).toBe(torp.mounts[0].armingCircles)
  })

  it('allows the same shot from the mount that does bear', () => {
    // The CORVUS carries a forward tube and an aft one.
    const { game, launcher, foe, torp } = setup(CORVUS, 0, 12)
    expect(launchHoming(game, launcher, torp, 0, foe)).toMatch(/cannot bear/)
    expect(launchHoming(game, launcher, torp, 1, foe)).toBeNull()
    expect(game.homing).toHaveLength(1)
    // E5.2.8: placed against the side the firing arc covers — astern of a
    // ship heading north is below it on the map.
    expect(game.homing[0].position.y).toBeGreaterThan(launcher.placement.position.y)
  })

  it('launches through the arc the target is in, not the first one listed', () => {
    // The LUPUS's second tube covers FS and SF; a target abeam to starboard
    // is in SF, so the counter belongs on the starboard side. Taking the
    // first listed arc would have put it out in front of the ship.
    const { game, launcher, foe, torp } = setup(LUPUS, 12, 0)
    expect(torp.mounts[1].arcs).toEqual(['FS', 'SF'])
    expect(launchHoming(game, launcher, torp, 1, foe)).toBeNull()
    const hw = game.homing[0]
    expect(hw.position.x).toBeGreaterThan(launcher.placement.position.x)
    expect(hw.position.y).toBeCloseTo(launcher.placement.position.y)
  })

  it('refuses a launch from a ship using evasive maneuvers (E5.2.3)', () => {
    const { game, launcher, foe, torp } = setup(PASSER, 0, -12)
    // In arc and armed: only the weaving stops it.
    launcher.evasive = 2
    expect(launchHoming(game, launcher, torp, 0, foe)).toMatch(/evasive/)
    launcher.evasive = 0
    expect(launchHoming(game, launcher, torp, 0, foe)).toBeNull()
  })
})
