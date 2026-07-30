import { createGame, type GameState, type Scenario } from '../engine/game'
import { createShip, type ShipState } from '../engine/shipState'
import type { ShipForm } from '../engine/types'
import { shipFormById, VALLARI_CRUISER, YORKTOWN } from './ships'

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
// Squadron Engagement (Expansions 1 and 2)
// ---------------------------------------------------------------------------

/**
 * A three-a-side fleet action.
 *
 * Neither expansion prints a scenario of its own, and their four rules —
 * Formation Maneuvering (C5), Scouting Sensors (H3), Coordinated Fire (H4) and
 * Command Systems (H5) — only bite once several ships of a faction are fighting
 * together. So this is a plain Standard Placement setup (S2.4.1) built to
 * exercise them: a command cruiser, a line ship and a scout per side, entering
 * in close order so they may form up at once.
 */
export const SQUADRON_ENGAGEMENT: Scenario = {
  id: 'exp2-squadron-engagement',
  name: 'Squadron Engagement (Expansions 1–2)',
  background:
    'Two squadrons meet in open space, each led by a command cruiser and screened by a scout. ' +
    'The flagship lends tactical scan points to its consorts; the scout illuminates targets and ' +
    'jams for the force. A setup for the fleet rules of Expansions 1 and 2.',
  bounds: { width: 36, height: 36, fixed: true },
  terrain: [],
  objectives: {
    [BLUE]: 'Break the Red squadron while keeping the flagship intact.',
    [RED]: 'Break the Blue squadron while keeping the flagship intact.',
  },
  specialRules: [
    'Each flagship carries CMND boxes and may lend one tactical scan point per box, ' +
      'out to 36 inches, while its GEN SYS line is set to MAX (H5.1).',
    'Each squadron includes a scout. Its scouting sensors can illuminate a target for the ' +
      'whole force, blanket friendly ships in area jamming, or run long-range scans (H3).',
    'Ships within range 1 at matching speed and heading may fly in formation on one ' +
      'counter, plotting a single set of helm orders (C5).',
    'Switch on Coordinated Fire to fight the Combat Segment through the ten firing steps ' +
      'of H4.2.3 instead of the single Tactical Scan pass of H2.4.',
  ],
  victory: 'Victory points are earned from damage levels inflicted (S2.8.4).',
}

// ---------------------------------------------------------------------------
// Nebula Patrol (Expansion 3)
// ---------------------------------------------------------------------------

/**
 * A knife fight inside a nebula.
 *
 * K4.1.1 puts the nebula over the whole play area, and K4.1.2 lets other
 * terrain sit inside it, so this adds two gas clouds as denser patches. With
 * main shields down (K4.2.1), a safe speed of 2 (K4.2.2) and every shot on
 * degraded fire control (K4.2.6), it is a very different battle from open
 * space — which is exactly what Expansion 3's terrain chapter is for.
 */
export const NEBULA_PATROL: Scenario = {
  id: 'exp3-nebula-patrol',
  name: 'Nebula Patrol (Expansion 3)',
  background:
    'Two patrols grope for each other deep inside a nebula. Shields are useless in the ionised ' +
    'gas, sensors barely reach, and anything faster than a crawl tears at the hull. Denser ' +
    'clouds drift across the battle, worse in every respect.',
  bounds: { width: 36, height: 36, fixed: true },
  nebula: true,
  terrain: [
    {
      id: 'cloud-1',
      kind: 'gas-cloud',
      name: 'Gas cloud 1',
      center: { x: 13, y: 14 },
      radius: 4,
      // Information points needed to find a hidden unit inside (K5.2.3).
      scan: 3,
    },
    {
      id: 'cloud-2',
      kind: 'gas-cloud',
      name: 'Gas cloud 2',
      center: { x: 24, y: 23 },
      radius: 5,
      scan: 4,
    },
  ],
  objectives: {
    [BLUE]: 'Find the Vallari patrol in the murk and destroy it.',
    [RED]: 'Find the Union patrol in the murk and destroy it.',
  },
  specialRules: [
    'The nebula covers the whole map (K4.1.1). Blue and green shield boxes are ignored; damage ' +
      'strikes armor and then goes internal (K4.2.1).',
    'Safe speed is 2 — one blue damage die per point above it, every Navigation Segment ' +
      '(K4.2.2). Inside a gas cloud the limit drops to 1 (K5.2.1).',
    'All weapon fire uses Degraded Fire Control, and slow targets gain no low-speed penalty ' +
      '(K4.2.6, K4.2.3).',
    'SCNC, TRAN and TRAC only work with GEN SYS at MAX (K4.2.4), and no ship may use FTL ' +
      '(K4.2.7).',
  ],
  victory: 'Victory points are earned from damage levels inflicted (S2.8.4).',
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export interface SetupOptions {
  seed?: number
  /** Play with the optional Coordinated Fire rules (H4.1). */
  coordinatedFire?: boolean
  /** E11.2 / E11.3 optional rules, off by default in the Standard game. */
  derelicts?: boolean
  explosions?: boolean
  /** Ship form ids to field, keyed by side — lets players pick from the roster. */
  forms?: Partial<Record<string, string>>
}

/** Vessel names for the ships players field, so the log reads like a battle. */
const BLUE_NAMES = ['U.S.S. Yorktown', 'U.S.S. Endeavour', 'U.S.S. Hood']
const RED_NAMES = ['V.I.S. Karnath', 'V.I.S. Vashtar', 'V.I.S. Draketh']

function pickForm(id: string | undefined, fallback: ShipForm): ShipForm {
  return (id ? shipFormById(id) : undefined) ?? fallback
}

function duelShips(options: SetupOptions): ShipState[] {
  return [
    createShip({
      id: 'blue-1',
      side: BLUE,
      name: BLUE_NAMES[0],
      form: pickForm(options.forms?.[BLUE], YORKTOWN),
      // FAC 6 is west, so Blue's setup zone is the eastern edge (S3.1).
      placement: { position: { x: 33, y: 18 }, heading: facingToHeading(6) },
      speed: 4,
    }),
    createShip({
      id: 'red-1',
      side: RED,
      name: RED_NAMES[0],
      form: pickForm(options.forms?.[RED], VALLARI_CRUISER),
      // FAC 2 is east, so Red's setup zone is the western edge (S3.1).
      placement: { position: { x: 3, y: 18 }, heading: facingToHeading(2) },
      speed: 4,
    }),
  ]
}

function ambushShips(options: SetupOptions): ShipState[] {
  return [
    createShip({
      id: 'blue-1',
      side: BLUE,
      name: BLUE_NAMES[0],
      form: pickForm(options.forms?.[BLUE], YORKTOWN),
      // In orbit north of the colony, coasting south (facing 4) at low speed.
      placement: { position: { x: 18, y: 8 }, heading: facingToHeading(4) },
      speed: 1,
    }),
    createShip({
      id: 'red-1',
      side: RED,
      name: RED_NAMES[0],
      form: pickForm(options.forms?.[RED], VALLARI_CRUISER),
      // Coming around the far side of the planet on an intercept (facing 8).
      placement: { position: { x: 18, y: 28 }, heading: facingToHeading(8) },
      speed: 4,
    }),
  ]
}

/**
 * Flagship at the point, the other two trailing off each quarter. Every pair is
 * inside the 2-inch joining range of C5.1.2, so whichever ship the turn rate
 * picks as lead (C5.1.1), the rest can join it.
 */
const SQUADRON_VEE = [
  { back: 0, side: 0 },
  { back: 1.5, side: -0.8 },
  { back: 1.5, side: 0.8 },
]

/**
 * Three ships a side — flagship, line ship, scout. The player's picked form is
 * used for the flagship; the rest keep the printed squadron.
 */
function squadronShips(options: SetupOptions): ShipState[] {
  const blueFlag = shipFormById('union-yorktown-iiic-class-command-cruiser') ?? YORKTOWN
  const redFlag = shipFormById('vallari-v-7e-raider-class-command-cruiser') ?? VALLARI_CRUISER
  const blueScout = shipFormById('union-hermes-i-class-scout') ?? YORKTOWN
  const redScout = shipFormById('vallari-v-5q-spectra-class-heavy-scout') ?? VALLARI_CRUISER

  const ships: ShipState[] = []
  // Blue enters from the east on facing 6, Red from the west on facing 2, as in
  // the neutral setup of S3.1.
  const blueForms = [pickForm(options.forms?.[BLUE], blueFlag), YORKTOWN, blueScout]
  const redForms = [pickForm(options.forms?.[RED], redFlag), VALLARI_CRUISER, redScout]

  blueForms.forEach((form, i) => {
    ships.push(
      createShip({
        id: `blue-${i + 1}`,
        side: BLUE,
        name: BLUE_NAMES[i],
        form,
        // A tight vee, every ship within range 1 of every other, so the
        // squadron may form up in the first Command Segment (C5.1.2).
        placement: {
          position: { x: 32 + SQUADRON_VEE[i].back, y: 18 + SQUADRON_VEE[i].side },
          heading: facingToHeading(6),
        },
        speed: 4,
      }),
    )
  })
  redForms.forEach((form, i) => {
    ships.push(
      createShip({
        id: `red-${i + 1}`,
        side: RED,
        name: RED_NAMES[i],
        form,
        placement: {
          position: { x: 4 - SQUADRON_VEE[i].back, y: 18 + SQUADRON_VEE[i].side },
          heading: facingToHeading(2),
        },
        speed: 4,
      }),
    )
  })
  return ships
}

export const SCENARIOS: Array<{
  scenario: Scenario
  makeShips: (options: SetupOptions) => ShipState[]
}> = [
  { scenario: THE_DUEL, makeShips: duelShips },
  { scenario: ORBITAL_AMBUSH, makeShips: ambushShips },
  { scenario: SQUADRON_ENGAGEMENT, makeShips: squadronShips },
  { scenario: NEBULA_PATROL, makeShips: nebulaShips },
]

/** Two ships a side, entering the nebula at the safe speed of 2 (K4.2.2). */
function nebulaShips(options: SetupOptions): ShipState[] {
  return [
    createShip({
      id: 'blue-1',
      side: BLUE,
      name: BLUE_NAMES[0],
      form: pickForm(options.forms?.[BLUE], YORKTOWN),
      placement: { position: { x: 31, y: 8 }, heading: facingToHeading(5) },
      speed: 2,
    }),
    createShip({
      id: 'blue-2',
      side: BLUE,
      name: BLUE_NAMES[1],
      form: YORKTOWN,
      placement: { position: { x: 33, y: 12 }, heading: facingToHeading(5) },
      speed: 2,
    }),
    createShip({
      id: 'red-1',
      side: RED,
      name: RED_NAMES[0],
      form: pickForm(options.forms?.[RED], VALLARI_CRUISER),
      placement: { position: { x: 5, y: 28 }, heading: facingToHeading(1) },
      speed: 2,
    }),
    createShip({
      id: 'red-2',
      side: RED,
      name: RED_NAMES[1],
      form: VALLARI_CRUISER,
      placement: { position: { x: 3, y: 24 }, heading: facingToHeading(1) },
      speed: 2,
    }),
  ]
}

export function startScenario(scenarioId: string, options: SetupOptions = {}): GameState {
  const entry = SCENARIOS.find((s) => s.scenario.id === scenarioId) ?? SCENARIOS[0]
  return createGame({
    scenario: entry.scenario,
    ships: entry.makeShips(options),
    seed: options.seed,
    coordinatedFire: options.coordinatedFire ?? false,
    options: {
      derelicts: options.derelicts ?? false,
      explosions: options.explosions ?? false,
    },
  })
}
