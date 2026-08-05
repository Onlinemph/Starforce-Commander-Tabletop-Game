import { isCombatPhase, type GameState } from '../engine/game'
import { mountIsReady, type ShipState } from '../engine/shipState'

/**
 * A guided first battle.
 *
 * StarForce Commander asks a lot of a new player before anything happens: five
 * phases to a round, a command card plotted before anyone moves, power spent a
 * segment before the guns that need it can fire. The per-segment help already
 * says what a segment is *for*; this says what to do next, in order, once.
 *
 * Every step is finished by the *state of the game*, never by a click. That is
 * the whole design. A player who wanders off to read a ship form, undoes a
 * plot, or does the steps in a different order than the script imagined is
 * still exactly where the script thinks they are, because the script is asking
 * the game rather than watching the mouse. It also means the tutorial cannot
 * strand someone: if a step's condition is already true when it arrives, it is
 * already done, and the tutorial moves on.
 */

export interface TutorialStep {
  id: string
  title: string
  /** What to do, and the rule it comes from. Two sentences at most. */
  body: string
  /**
   * True once the player has done the thing. Called with the live game after
   * every dispatch — must be cheap and must not throw on a half-built battle.
   */
  done: (game: GameState, ship: ShipState | null) => boolean
  /**
   * A hint shown when the player is in the wrong segment for this step, so a
   * mis-click never leaves them staring at an instruction they cannot follow.
   */
  where?: string
}

/** The ship the tutorial is teaching with: the player's first hull. */
export function tutorialShip(game: GameState, side: string | null): ShipState | null {
  const mine = game.ships.filter((s) => !s.destroyed && (side === null || s.side === side))
  return mine[0] ?? null
}

const anyPowerSpent = (ship: ShipState | null) =>
  ship !== null && Object.values(ship.allocation).some((n) => n > 0)

const anyMountArmed = (ship: ShipState | null) =>
  ship !== null &&
  Object.entries(ship.mounts).some(([weaponId, states]) => {
    const weapon = ship.form.weapons.find((w) => w.id === weaponId)
    return weapon ? states.some((state, i) => mountIsReady(weapon, i, state)) : false
  })

/** Has this ship's card been changed from the default it was issued with? */
function cardPlotted(game: GameState, ship: ShipState | null): boolean {
  if (!ship) return false
  const card = game.orders[ship.id]
  if (!card) return false
  return card.maneuver !== 'straight' || card.accel !== 0 || card.speed !== ship.speed
}

function sensorsAllocated(game: GameState, ship: ShipState | null): boolean {
  if (!ship) return false
  const card = game.orders[ship.id]
  if (!card) return false
  return card.sensors.targeting + card.sensors.jamming + card.sensors.tacticalScan > 0
}

/** Anyone fired yet — the log is the record, and it is public (B1.9). */
const shotsFired = (game: GameState) => game.log.some((e) => / fires on /.test(e.message))

export const TUTORIAL: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Your first battle',
    body:
      'One cruiser each, and a round runs through five phases: Engineering, then three Combat Phases, then Final. ' +
      'Work down the right-hand panel, and press the big button at the top right when a segment is finished.',
    /*
     * Anything at all counts, including spending power — which is what most
     * people try first. Completing only on a segment advance left a player who
     * had already started allocating still being told hello.
     */
    done: (game, ship) =>
      anyPowerSpent(ship) ||
      game.round > 1 ||
      game.phase !== 'engineering' ||
      game.segment !== 'resource-allocation',
  },
  {
    id: 'power',
    title: 'Spend your reactor',
    body:
      'Everything costs power, and you allocate it before you know what the enemy will do (B2). ' +
      'Click a numbered circle on any FUNCTIONS line in the ship form — SENSOR and your weapon lines matter most.',
    where: 'Engineering phase, Resource Allocation',
    done: (_game, ship) => anyPowerSpent(ship),
  },
  {
    id: 'arm',
    title: 'Charge a weapon',
    body:
      'Power on a weapon line becomes arming points, and those go onto individual mounts under WEAPONS. ' +
      'Unspent arming points are lost when the segment ends (E4.2.10), so spend them.',
    where: 'Engineering phase, Resource Allocation',
    done: (_game, ship) => anyMountArmed(ship),
  },
  {
    id: 'plot',
    title: 'Plot the card, then move',
    body:
      'This is the heart of the game: you write your move before anyone moves, and both ships then move at once (C1). ' +
      'Pick a maneuver — STRAIGHT, a turn, a slide — and set a speed.',
    where: 'a Combat Phase, Command Segment',
    done: (game, ship) => cardPlotted(game, ship) || game.round > 1,
  },
  {
    id: 'sensors',
    title: 'Split your sensors',
    body:
      'Sensor points divide between Targeting, which shortens the range you fire at, and Jamming, which lengthens the ' +
      'range they fire at you (H2.3). Put a point somewhere and see what it does.',
    where: 'a Combat Phase, Command Segment',
    done: (game, ship) => sensorsAllocated(game, ship) || game.round > 1,
  },
  {
    id: 'navigate',
    title: 'Watch the plots resolve',
    body:
      'Complete the segments until Navigation. Both ships move along the courses they wrote, and whatever you guessed ' +
      'about theirs is now settled.',
    where: 'a Combat Phase',
    done: (game) => game.round > 1 || (isCombatPhase(game.phase) && game.segment === 'combat'),
  },
  {
    id: 'fire',
    title: 'Take the shot',
    body:
      'Select the enemy to target it, choose the mounts that bear, and fire. Range is measured to the shield facing ' +
      'you hit, and your firing chart says which dice that range is worth (E6).',
    where: 'a Combat Phase, Combat Segment',
    done: (game) => shotsFired(game),
  },
  {
    id: 'damage',
    title: 'Read the damage',
    body:
      'Damage goes to shields, then armour, then draws damage cards for whatever is left (E7). The battle log under ' +
      'the map has every die and every card — it is the whole story of the fight.',
    done: (game) => game.round > 1,
  },
  {
    id: 'done',
    title: 'You have the shape of it',
    body:
      'Allocate, plot, move, shoot, repair, repeat. Everything else is detail you can read in the panel when it comes ' +
      'up. Close this and finish the battle — or start a fresh one from Choose Forces.',
    done: () => false,
  },
]

/**
 * The step the player is on: the first one they have not finished.
 *
 * Scanning from the top rather than remembering an index is what makes undo
 * safe — rewind the battle and the tutorial rewinds with it, because the
 * answer was never stored anywhere.
 */
export function currentStep(game: GameState, ship: ShipState | null): number {
  for (let i = 0; i < TUTORIAL.length; i++) {
    if (!TUTORIAL[i].done(game, ship)) return i
  }
  return TUTORIAL.length - 1
}

const SEEN_KEY = 'sfc.tutorial.seen.v1'

export function tutorialSeen(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // A browser that refuses storage should not be nagged every load.
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* nothing to do — the offer simply reappears next time */
  }
}
