import { MAX_SHIPS_PER_SIDE } from '../engine/fleet'
import { createGame, type GameState, type Scenario, type Terrain } from '../engine/game'
import { DIE_FACES, Rng } from '../engine/dice'
import { ASTEROID_COUNTERS, DENSITY_STATS } from './terrainCounters'
import type { MapBounds } from '../engine/navigation'
import { createShip, type ShipState } from '../engine/shipState'
import type { Point, ShipForm } from '../engine/types'
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
// Aurelian Raid (Expansion 5)
// ---------------------------------------------------------------------------

export const AURELIAN = 'Aurelian Empire'

/**
 * A cloaked Aurelian strike against a Union patrol.
 *
 * Expansion 5 prints no scenario, and its two rules pull in opposite
 * directions: the Aurelian ships open cloaked and unseen (H6), while their
 * plasma torpedoes are slow homing weapons the Union can shoot down on the way
 * in (E5). The Aurelian has to decloak to shoot at all (H6.4.2), so the whole
 * battle turns on picking the moment.
 */
export const AURELIAN_RAID: Scenario = {
  id: 'exp5-aurelian-raid',
  name: 'Aurelian Raid (Expansion 5)',
  background:
    'An Aurelian pair slides toward a Union patrol under cloak. Their plasma torpedoes hit ' +
    'hard but take phases to arrive, and a cloaked ship cannot fire at all — so the raiders ' +
    'must uncloak inside knife range and accept the answering broadside.',
  bounds: { width: 36, height: 36, fixed: true },
  terrain: [],
  objectives: {
    [BLUE]: 'Find the raiders before their torpedoes are in the air, and destroy them.',
    [AURELIAN]: 'Close under cloak, decloak, and break the patrol.',
  },
  specialRules: [
    'Aurelian ships may engage their cloaks in Operations step 2A. While cloaked they cannot ' +
      'fire, their shields are down, and their position is unknown — only a datum marks where ' +
      'they were last seen (H6.2.2, H6.4).',
    'Union ships search in Operations step 2E, climbing Contact → Track → Target Lock. A Track ' +
      'allows degraded fire, a Lock allows normal fire (H6.14).',
    'Plasma torpedoes are homing particle weapons: they fly one leg per phase and can be worn ' +
      'down by point defense on the way in, one point of damage for every three (E5, F1.16).',
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
  /**
   * A single ship form id per side — the quick pick that swaps a scenario's
   * flagship without changing the rest of the printed force.
   */
  forms?: Partial<Record<string, string>>
  /**
   * A whole force per side, as one form id per hull, in the order they deploy.
   * Overrides `forms` and the scenario's printed force (S2.5.1).
   */
  fleets?: Partial<Record<string, string[]>>
  /**
   * Random asteroid terrain (K1.1): 'roll' rolls the yellow die on the K1.1
   * chart, a number places exactly that many counters. Fields are drawn from
   * the 26 printed counters and placed at least 3 inches apart (K1.2.2),
   * deterministically from the seed — so a save or a remote peer rebuilds the
   * same field.
   */
  terrain?: 'roll' | number
  /**
   * Battlefield multiplier: 1 fights on the printed map, 2 doubles it in both
   * directions (36" → 72"). More room favors reach, speed and repair over
   * envelopment.
   */
  mapScale?: number
  /**
   * Every weapon fully armed on turn one (a house rule, not S-section).
   *
   * The printed game opens cold: batteries fill their arming circles from a
   * round's power, and a slow-arming heavy takes several rounds to charge
   * (E4.2.8), so the first exchanges are a scramble of half-loaded guns.
   * That ramp is the point in a campaign and a chore in a one-off, so this
   * hands every mount its circles at deployment. Power is not spent for
   * them — the fleets simply arrive loaded for bear.
   */
  armedStart?: boolean
  /**
   * Optional batteries (B2.5): stored power may be spent mid-round, during a
   * combat phase's Command Segment, instead of only at Resource Allocation.
   */
  optionalBatteries?: boolean
  /** Online matches: both sides must signal ready before a segment closes. */
  readyGate?: boolean
}

/**
 * Where one side sets up, and how a force of any size fits into its zone
 * (S2.5.2, S2.5.3).
 *
 * `pattern` holds the exact offsets the scenario prints for its own force, so
 * a battle fought as written deploys exactly as written. Ships beyond that —
 * which only happens when a player composes their own force — continue from
 * the last printed ship along `spread`, staying inside the map.
 */
interface SideSetup {
  side: string
  /** Compass facing (S2.5.2). */
  facing: number
  speed: number
  anchor: Point
  pattern: Point[]
  spread: Point
  names: string[]
  /** The force the scenario prints. */
  defaults: () => ShipForm[]
}

/** Vessel names for the ships players field, so the log reads like a battle. */
const BLUE_NAMES = [
  'U.S.S. Yorktown',
  'U.S.S. Endeavour',
  'U.S.S. Hood',
  'U.S.S. Valiant',
  'U.S.S. Kearsarge',
  'U.S.S. Intrepid',
  'U.S.S. Resolute',
  'U.S.S. Vanguard',
]
const RED_NAMES = [
  'V.I.S. Karnath',
  'V.I.S. Vashtar',
  'V.I.S. Draketh',
  'V.I.S. Morlach',
  'V.I.S. Tarrus',
  'V.I.S. Zhaggo',
  'V.I.S. Kethra',
  'V.I.S. Ordran',
]
const AURELIAN_NAMES = [
  'A.I.S. Nocturne',
  'A.I.S. Umbra',
  'A.I.S. Vesper',
  'A.I.S. Tenebrae',
  'A.I.S. Aquilo',
  'A.I.S. Silentium',
  'A.I.S. Noctilucent',
  'A.I.S. Penumbra',
]

function pickForm(id: string | undefined, fallback: ShipForm): ShipForm {
  return (id ? shipFormById(id) : undefined) ?? fallback
}

/** The forms this side actually fields, once the player has had their say. */
function forceFor(setup: SideSetup, options: SetupOptions): ShipForm[] {
  const chosen = options.fleets?.[setup.side]
  if (chosen && chosen.length > 0) {
    const forms = chosen.map((id) => shipFormById(id)).filter((f): f is ShipForm => Boolean(f))
    if (forms.length > 0) return forms.slice(0, MAX_SHIPS_PER_SIDE)
  }
  const printed = setup.defaults()
  const pick = options.forms?.[setup.side]
  return pick ? [pickForm(pick, printed[0]), ...printed.slice(1)] : printed
}

/** Counters are 1.5 inches across, so ranks and files are spaced past that. */
const RANK_SPACING = 1.9
/** Keep a ship's centre point this far inside the map edge (S2.5.3). */
const EDGE_MARGIN = 1.5

/**
 * Offset of the `index`-th ship from its side's anchor.
 *
 * Inside the scenario's own pattern this is exact, so a battle fought as
 * written deploys as written. Past it, ships extend the line along `spread`
 * until the line would run off the map, then fold into a second rank behind
 * the first — a setup zone is only so big (S2.5.3).
 */
function offsetFor(setup: SideSetup, index: number, bounds: MapBounds): Point {
  const last = setup.pattern.length - 1
  if (index <= last) return setup.pattern[index]

  const base = setup.pattern[last]
  const onMap = (x: number, y: number) =>
    x >= EDGE_MARGIN &&
    x <= bounds.width - EDGE_MARGIN &&
    y >= EDGE_MARGIN &&
    y <= bounds.height - EDGE_MARGIN

  let columns = 1
  while (
    columns < MAX_SHIPS_PER_SIDE &&
    onMap(
      setup.anchor.x + base.x + setup.spread.x * (columns + 1),
      setup.anchor.y + base.y + setup.spread.y * (columns + 1),
    )
  ) {
    columns += 1
  }

  // Ranks build up behind the line, away from where the side is heading.
  const heading = (facingToHeading(setup.facing) * Math.PI) / 180
  const behind = { x: -Math.sin(heading) * RANK_SPACING, y: Math.cos(heading) * RANK_SPACING }

  const n = index - last
  const column = ((n - 1) % columns) + 1
  const rank = Math.floor((n - 1) / columns)
  return {
    x: base.x + setup.spread.x * column + behind.x * rank,
    y: base.y + setup.spread.y * column + behind.y * rank,
  }
}

/**
 * Fill every arming circle on every mount (the `armedStart` option).
 *
 * Deliberately blunt: it writes the circles rather than buying them, so the
 * round's power is still free for shields, sensors and the drive. A mount
 * whose weapon is out of ammunition or already wrecked is untouched — being
 * armed is not the same as being able to fire (E4.2.3).
 */
function armEveryMount(ships: ShipState[]): void {
  for (const ship of ships) {
    for (const weapon of ship.form.weapons) {
      weapon.mounts.forEach((mount, index) => {
        const state = ship.mounts[weapon.id]?.[index]
        if (!state || state.damage >= mount.hitBoxes) return
        state.armed = mount.armingCircles
      })
    }
  }
}

function deploy(setups: SideSetup[], bounds: MapBounds, options: SetupOptions): ShipState[] {
  const ships: ShipState[] = []
  const clamp = (v: number, max: number) =>
    Math.min(max - EDGE_MARGIN, Math.max(EDGE_MARGIN, v))
  for (const setup of setups) {
    const prefix = setup.side.split(' ')[0].toLowerCase()
    forceFor(setup, options).forEach((form, i) => {
      const offset = offsetFor(setup, i, bounds)
      ships.push(
        createShip({
          id: `${prefix}-${i + 1}`,
          side: setup.side,
          name: setup.names[i] ?? `${setup.names[0]} ${i + 1}`,
          form,
          placement: {
            position: {
              x: clamp(setup.anchor.x + offset.x, bounds.width),
              y: clamp(setup.anchor.y + offset.y, bounds.height),
            },
            heading: facingToHeading(setup.facing),
          },
          speed: setup.speed,
        }),
      )
    })
  }
  return ships
}

const O = (x: number, y: number): Point => ({ x, y })

// S3.1 — Blue faces 6 (west) from the eastern edge, Red faces 2 from the west.
const DUEL_SIDES: SideSetup[] = [
  {
    side: BLUE,
    facing: 6,
    speed: 4,
    anchor: O(33, 18),
    pattern: [O(0, 0)],
    spread: O(0, 2),
    names: BLUE_NAMES,
    defaults: () => [YORKTOWN],
  },
  {
    side: RED,
    facing: 2,
    speed: 4,
    anchor: O(3, 18),
    pattern: [O(0, 0)],
    spread: O(0, 2),
    names: RED_NAMES,
    defaults: () => [VALLARI_CRUISER],
  },
]

// S3.3 — Blue is in orbit north of the colony coasting south; Red comes around
// the far side of the planet on an intercept.
const AMBUSH_SIDES: SideSetup[] = [
  {
    side: BLUE,
    facing: 4,
    speed: 1,
    anchor: O(18, 8),
    pattern: [O(0, 0)],
    spread: O(2, 0),
    names: BLUE_NAMES,
    defaults: () => [YORKTOWN],
  },
  {
    side: RED,
    facing: 8,
    speed: 4,
    anchor: O(18, 28),
    pattern: [O(0, 0)],
    spread: O(2, 0),
    names: RED_NAMES,
    defaults: () => [VALLARI_CRUISER],
  },
]

/**
 * Flagship at the point, the other two trailing off each quarter. Every pair is
 * inside the 2-inch joining range of C5.1.2, so whichever ship the turn rate
 * picks as lead (C5.1.1), the rest can join it.
 */
const SQUADRON_SIDES: SideSetup[] = [
  {
    side: BLUE,
    facing: 6,
    speed: 4,
    anchor: O(32, 18),
    pattern: [O(0, 0), O(1.5, -0.8), O(1.5, 0.8)],
    spread: O(0, 1.8),
    names: BLUE_NAMES,
    defaults: () => [
      shipFormById('union-yorktown-iiic-class-command-cruiser') ?? YORKTOWN,
      YORKTOWN,
      shipFormById('union-hermes-i-class-scout') ?? YORKTOWN,
    ],
  },
  {
    side: RED,
    facing: 2,
    speed: 4,
    anchor: O(4, 18),
    pattern: [O(0, 0), O(-1.5, -0.8), O(-1.5, 0.8)],
    spread: O(0, 1.8),
    names: RED_NAMES,
    defaults: () => [
      shipFormById('vallari-v-7e-raider-class-command-cruiser') ?? VALLARI_CRUISER,
      VALLARI_CRUISER,
      shipFormById('vallari-v-5q-spectra-class-heavy-scout') ?? VALLARI_CRUISER,
    ],
  },
]

/** Two ships a side, entering the nebula at the safe speed of 2 (K4.2.2). */
const NEBULA_SIDES: SideSetup[] = [
  {
    side: BLUE,
    facing: 5,
    speed: 2,
    anchor: O(31, 8),
    pattern: [O(0, 0), O(2, 4)],
    spread: O(0, 2.6),
    names: BLUE_NAMES,
    defaults: () => [YORKTOWN, YORKTOWN],
  },
  {
    side: RED,
    facing: 1,
    speed: 2,
    anchor: O(5, 28),
    pattern: [O(0, 0), O(-2, -4)],
    spread: O(0, -2.6),
    names: RED_NAMES,
    defaults: () => [VALLARI_CRUISER, VALLARI_CRUISER],
  },
]

/** A Union patrol against a cloaked Aurelian pair. */
const AURELIAN_SIDES: SideSetup[] = [
  {
    side: BLUE,
    facing: 6,
    speed: 3,
    anchor: O(30, 16),
    pattern: [O(0, 0), O(2, 5)],
    spread: O(0, 2.6),
    names: BLUE_NAMES,
    defaults: () => [YORKTOWN, YORKTOWN],
  },
  {
    side: AURELIAN,
    // Cloaked ships crawl: speed 2 or less, or they give themselves away
    // (H6.4.6, H6.15.2).
    facing: 2,
    speed: 2,
    anchor: O(6, 14),
    pattern: [O(0, 0), O(-2, 9)],
    spread: O(0, 2.6),
    names: AURELIAN_NAMES,
    defaults: () => [
      shipFormById('aurelian-tonitrus-i-class-heavy-cruiser') ?? VALLARI_CRUISER,
      shipFormById('aurelian-acipter-i-class-destroyer') ?? VALLARI_CRUISER,
    ],
  },
]

export const SCENARIOS: Array<{ scenario: Scenario; sides: SideSetup[] }> = [
  { scenario: THE_DUEL, sides: DUEL_SIDES },
  { scenario: ORBITAL_AMBUSH, sides: AMBUSH_SIDES },
  { scenario: SQUADRON_ENGAGEMENT, sides: SQUADRON_SIDES },
  { scenario: NEBULA_PATROL, sides: NEBULA_SIDES },
  { scenario: AURELIAN_RAID, sides: AURELIAN_SIDES },
]

// ---------------------------------------------------------------------------
// Custom scenarios (the scenario designer's output)
// ---------------------------------------------------------------------------

/**
 * A scenario as data, with none of the printed set's closures — everything a
 * battle file can carry, so a save that references a designed scenario
 * replays on a machine that has never seen it.
 */
export interface CustomScenario {
  id: string
  name: string
  background: string
  victory: string
  specialRules?: string[]
  bounds: MapBounds
  /** The whole play area is inside a nebula (K4.1.1). */
  nebula?: boolean
  terrain: Terrain[]
  sides: Array<{
    side: string
    objective: string
    /** Compass facing 1–8 (S2.5.2): 8 is north, 2 east, 4 south, 6 west. */
    facing: number
    /** Announced deployment speed (S2.4.1). */
    speed: number
    /** Where the first ship sets up; the rest extend along `spread`. */
    anchor: Point
    spread: Point
    /** The printed force, as form ids (S2.5.1). */
    force: string[]
  }>
}

/** Ship-name pools by deployment order, so the log reads like a battle. */
const NAME_POOLS = [BLUE_NAMES, RED_NAMES, AURELIAN_NAMES]

/** Give a designed scenario the same shape the printed ones have. */
export function toScenarioEntry(custom: CustomScenario): { scenario: Scenario; sides: SideSetup[] } {
  const scenario: Scenario = {
    id: custom.id,
    name: custom.name,
    background: custom.background,
    bounds: custom.bounds,
    terrain: custom.terrain,
    objectives: Object.fromEntries(custom.sides.map((s) => [s.side, s.objective])),
    specialRules: custom.specialRules?.length ? custom.specialRules : undefined,
    victory: custom.victory,
    nebula: custom.nebula || undefined,
  }
  const sides: SideSetup[] = custom.sides.map((s, i) => ({
    side: s.side,
    facing: s.facing,
    speed: s.speed,
    anchor: s.anchor,
    pattern: [{ x: 0, y: 0 }],
    spread: s.spread,
    names: NAME_POOLS[i % NAME_POOLS.length],
    defaults: () => s.force.map((id) => shipFormById(id)).filter((f): f is ShipForm => Boolean(f)),
  }))
  return { scenario, sides }
}

/** Designed scenarios from the designer's store (file plus local drafts). */
const CUSTOM_ENTRIES: Array<{ scenario: Scenario; sides: SideSetup[] }> = []
const CUSTOM_SOURCES: CustomScenario[] = []

export function registerCustomScenarios(customs: CustomScenario[]): void {
  CUSTOM_SOURCES.splice(0, CUSTOM_SOURCES.length, ...customs)
  CUSTOM_ENTRIES.splice(0, CUSTOM_ENTRIES.length, ...customs.map(toScenarioEntry))
}

export function customScenarioById(id: string): CustomScenario | undefined {
  return EMBEDDED_SOURCE?.id === id ? EMBEDDED_SOURCE : CUSTOM_SOURCES.find((c) => c.id === id)
}

/**
 * The scenario riding inside a loaded battle file. It wins the lookup for its
 * id, so a local draft with the same name cannot quietly change a battle
 * already underway — exactly the embedded-forms rule.
 */
let EMBEDDED_SOURCE: CustomScenario | null = null
let EMBEDDED_ENTRY: { scenario: Scenario; sides: SideSetup[] } | null = null

export function setEmbeddedScenario(custom: CustomScenario | null): void {
  EMBEDDED_SOURCE = custom
  EMBEDDED_ENTRY = custom ? toScenarioEntry(custom) : null
}

function entryFor(scenarioId: string): { scenario: Scenario; sides: SideSetup[] } {
  if (EMBEDDED_ENTRY && EMBEDDED_ENTRY.scenario.id === scenarioId) return EMBEDDED_ENTRY
  return (
    SCENARIOS.find((s) => s.scenario.id === scenarioId) ??
    CUSTOM_ENTRIES.find((s) => s.scenario.id === scenarioId) ??
    SCENARIOS[0]
  )
}

/** Every scenario a player can pick: the printed set, then the designed ones. */
export function allScenarioEntries(): Array<{ scenario: Scenario; sides: SideSetup[] }> {
  return [...SCENARIOS, ...CUSTOM_ENTRIES]
}

/** The sides a scenario is fought between, in deployment order. */
export function scenarioSides(scenarioId: string): string[] {
  return entryFor(scenarioId).sides.map((s) => s.side)
}

/** The force a scenario prints for a side, as form ids (S2.5.1). */
export function printedForce(scenarioId: string, side: string): string[] {
  const setup = entryFor(scenarioId).sides.find((s) => s.side === side)
  return setup ? setup.defaults().map((f) => f.id) : []
}

export function startScenario(scenarioId: string, options: SetupOptions = {}): GameState {
  const entry = entryFor(scenarioId)
  /**
   * A map scale of 2 doubles the battlefield in both directions — deep-space
   * room to turn, repair and reload. Bounds, printed terrain and deployment
   * anchors all scale together, so the sides open proportionally further
   * apart while each side's own formation keeps its printed shape.
   */
  const scale = Math.max(1, options.mapScale ?? 1)
  const bounds: MapBounds = {
    ...entry.scenario.bounds,
    width: entry.scenario.bounds.width * scale,
    height: entry.scenario.bounds.height * scale,
  }
  const scaledScenario: Scenario = {
    ...entry.scenario,
    bounds,
    terrain: entry.scenario.terrain.map((t) => ({
      ...t,
      center: { x: t.center.x * scale, y: t.center.y * scale },
    })),
  }
  const sides =
    scale === 1
      ? entry.sides
      : entry.sides.map((s) => ({
          ...s,
          anchor: { x: s.anchor.x * scale, y: s.anchor.y * scale },
        }))
  // The scenario is cloned so generated terrain never leaks into the module's
  // shared definition — and the game's own RNG is left untouched, so a battle
  // with terrain rolls the same combat dice as one without.
  const scenario: Scenario = {
    ...scaledScenario,
    terrain: [
      ...scaledScenario.terrain,
      ...rollAsteroidTerrain(scaledScenario, options.terrain, options.seed ?? 0),
    ],
  }
  const ships = deploy(sides, scenario.bounds, options)
  if (options.armedStart) armEveryMount(ships)

  return createGame({
    scenario,
    ships,
    seed: options.seed,
    coordinatedFire: options.coordinatedFire ?? false,
    optionalBatteries: options.optionalBatteries ?? false,
    readyGate: options.readyGate ?? false,
    options: {
      derelicts: options.derelicts ?? false,
      explosions: options.explosions ?? false,
    },
  })
}

/**
 * Random asteroid terrain (K1.1, K1.2), from the printed counter set.
 *
 * K1.1 rolls one yellow die: Miss — none, Light — 4, Medium — 6, Heavy — 8
 * counters. The tabletop game then has players alternate placing them by hand
 * (K1.2.1); here placement is drawn from the setup seed instead, honouring
 * the 3-inch separation (K1.2.2) and keeping out of the deployment bands.
 */
function rollAsteroidTerrain(
  scenario: Scenario,
  choice: 'roll' | number | undefined,
  seed: number,
): Terrain[] {
  if (choice === undefined || choice === 0) return []
  const rng = new Rng((seed ^ 0x7e22a1) >>> 0)

  let count: number
  if (choice === 'roll') {
    const face = DIE_FACES.yellow[rng.int(6)]
    count = face === '-' ? 0 : face === 'L' ? 4 : face === 'M' ? 6 : 8
  } else {
    count = Math.max(0, Math.min(12, Math.floor(choice)))
  }
  if (count === 0) return []

  const counters = rng.shuffle([...ASTEROID_COUNTERS]).slice(0, count)
  const { width, height } = scenario.bounds
  const placed: Terrain[] = []

  for (const counter of counters) {
    const stats = DENSITY_STATS[counter.density]
    let radius = 1.8 + rng.next() * 0.9
    let spot: Point | null = null
    // Two passes: at full size within the middle band first; if the board is
    // too crowded for that, once more smaller and with a wider band, so the
    // K1.1 count is honoured whenever the geometry allows it at all.
    for (let pass = 0; pass < 2 && !spot; pass++) {
      if (pass === 1) radius = 1.5
      // Keep clear of the deployment bands along the north and south edges.
      const xMin = radius + 2
      const xMax = width - radius - 2
      const yMin = radius + (pass === 0 ? 7 : 5)
      const yMax = height - radius - (pass === 0 ? 7 : 5)
      for (let attempt = 0; attempt < 300 && !spot; attempt++) {
        const p = { x: xMin + rng.next() * (xMax - xMin), y: yMin + rng.next() * (yMax - yMin) }
        const clear = [...scenario.terrain, ...placed].every(
          (t) => Math.hypot(p.x - t.center.x, p.y - t.center.y) >= t.radius + radius + 3,
        )
        if (clear) spot = p
      }
    }
    // A board genuinely too crowded to satisfy K1.2.2 takes fewer counters.
    if (!spot) continue

    placed.push({
      id: `asteroid-${counter.id}`,
      kind: 'asteroid-field',
      name: `Asteroids #${counter.id}`,
      center: spot,
      radius,
      density: counter.density,
      safeSpeed: stats.spd,
      damageDie: stats.dmgDie,
      cover: stats.cover,
      scan: stats.scan,
    })
  }
  return placed
}
