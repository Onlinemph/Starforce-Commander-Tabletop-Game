import { createGame, type GameState, type Scenario } from '../engine/game'
import { createShip, type ShipState } from '../engine/shipState'
import { VALLARI_CRUISER, YORKTOWN } from './ships'

/**
 * Scenarios from Section S. Setup follows S2.4.1 Standard Placement: forces are
 * placed within their coloured setup zones on a 36 × 36 inch map (S2.5.3).
 *
 * Facings use the scenario compass rose, where direction 8 is the top of the
 * map (S2.5.2) — so facing 8 is heading 0°, facing 2 is 90°, facing 4 is 180°,
 * facing 6 is 270°.
 */

export const BLUE = 'Blue Force'
export const RED = 'Red Force'

/**
 * Convert a scenario compass facing (1-8) to a heading in degrees.
 *
 * S2.5.2 fixes only one point on the rose: "direction 8 will always be at the
 * top of the map". Taking the remaining points clockwise in 45-degree steps
 * gives 1 = NE, 2 = E, 3 = SE, 4 = S, 5 = SW, 6 = W, 7 = NW — which is what
 * makes S3.1's printed facings (Blue 6, Red 2) a converging head-on setup.
 */
export function facingToHeading(facing: number): number {
  return ((facing - 8) * 45 + 360) % 360
}

// ---------------------------------------------------------------------------
// S3.1 The Duel
// ---------------------------------------------------------------------------

export const THE_DUEL: Scenario = {
  id: 's3.1-the-duel',
  name: 'S3.1 The Duel',
  background:
    'A basic space superiority mission to control this area of space. Two opposing vessels of ' +
    'similar capability begin on opposite sides of the map in a neutral setup.',
  bounds: { width: 36, height: 36, fixed: true },
  terrain: [],
  objectives: {
    [BLUE]: 'Destroy the Red Force cruiser or force it to disengage.',
    [RED]: 'Destroy the Blue Force cruiser or force it to disengage.',
  },
  specialRules: ['There are no special rules for this mission.'],
  victory:
    'The winner is the last player remaining on the map. Each player earns victory points based ' +
    'on the damage level inflicted on the enemy vessel (S2.8.4).',
}

// ---------------------------------------------------------------------------
// S3.3 Orbital Ambush
// ---------------------------------------------------------------------------

export const ORBITAL_AMBUSH: Scenario = {
  id: 's3.3-orbital-ambush',
  name: 'S3.3 Orbital Ambush',
  background:
    'A Blue Force ship in orbit around a colony fails to detect a Red Force raider approaching ' +
    'from the far side of the planet. Neither captain knows quite what is waiting for them.',
  bounds: { width: 36, height: 36, fixed: true },
  terrain: [
    {
      id: 'colony',
      kind: 'planet',
      name: 'Colony world',
      center: { x: 18, y: 18 },
      radius: 5,
    },
  ],
  objectives: {
    [BLUE]: 'Survive the ambush and drive off the raider.',
    [RED]: 'Cripple the defending ship, then disengage.',
  },
  specialRules: [
    'The planet blocks line of sight between ships that do not overlap it (K3.1.3).',
    'Ships do not collide with the planet; they pass over or under it (K3.1.2).',
  ],
  victory: 'Victory points are earned from damage levels inflicted (S2.8.4).',
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export interface SetupOptions {
  seed?: number
  /** E11.2 / E11.3 optional rules, off by default in the Standard game. */
  derelicts?: boolean
  explosions?: boolean
}

function duelShips(): ShipState[] {
  return [
    createShip({
      id: 'blue-1',
      side: BLUE,
      name: 'U.S.S. Yorktown',
      form: YORKTOWN,
      // FAC 6 is west, so Blue's setup zone is the eastern edge (S3.1).
      placement: { position: { x: 33, y: 18 }, heading: facingToHeading(6) },
      speed: 4,
    }),
    createShip({
      id: 'red-1',
      side: RED,
      name: 'V.I.S. Karnath',
      form: VALLARI_CRUISER,
      // FAC 2 is east, so Red's setup zone is the western edge (S3.1).
      placement: { position: { x: 3, y: 18 }, heading: facingToHeading(2) },
      speed: 4,
    }),
  ]
}

function ambushShips(): ShipState[] {
  return [
    createShip({
      id: 'blue-1',
      side: BLUE,
      name: 'U.S.S. Yorktown',
      form: YORKTOWN,
      // In orbit north of the colony, coasting south (facing 4) at low speed.
      placement: { position: { x: 18, y: 8 }, heading: facingToHeading(4) },
      speed: 1,
    }),
    createShip({
      id: 'red-1',
      side: RED,
      name: 'V.I.S. Karnath',
      form: VALLARI_CRUISER,
      // Coming around the far side of the planet on an intercept (facing 8).
      placement: { position: { x: 18, y: 28 }, heading: facingToHeading(8) },
      speed: 4,
    }),
  ]
}

export const SCENARIOS: Array<{ scenario: Scenario; makeShips: () => ShipState[] }> = [
  { scenario: THE_DUEL, makeShips: duelShips },
  { scenario: ORBITAL_AMBUSH, makeShips: ambushShips },
]

export function startScenario(scenarioId: string, options: SetupOptions = {}): GameState {
  const entry = SCENARIOS.find((s) => s.scenario.id === scenarioId) ?? SCENARIOS[0]
  return createGame({
    scenario: entry.scenario,
    ships: entry.makeShips(),
    seed: options.seed,
    options: {
      derelicts: options.derelicts ?? false,
      explosions: options.explosions ?? false,
    },
  })
}
