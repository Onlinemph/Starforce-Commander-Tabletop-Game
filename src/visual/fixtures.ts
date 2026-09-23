/**
 * Map fixtures for the screenshot tests (`npm run test:visual`).
 *
 * Each fixture builds a battle state from a printed scenario and a fixed seed,
 * then arranges it by hand — ships placed, flights launched, a torpedo in the
 * air, a cloak engaged — rather than by letting the AI play. That is on
 * purpose: a baseline should change when the *drawing* changes, not every
 * time the computer captain learns a new habit. If a fixture here starts to
 * fail, look at the map before you look at the engine.
 */
import { registerCustomScenarios, startScenario } from '../data/scenarios'
import { FILE_FORMS, registerCustomForms } from '../data/ships'
import { applyAction } from '../engine/actions'
import { launchFlight, launchHoming, type GameState } from '../engine/game'
import type { RangeRing } from '../ui/MapView'

registerCustomForms(FILE_FORMS)

export interface MapFixture {
  game: GameState
  selectedId: string | null
  targetId: string | null
  showArcs: boolean
  rangeRings: RangeRing[]
  viewSide: string | null
}

const RINGS: RangeRing[] = [
  { range: 8, label: 'green 0-8', band: 'green' },
  { range: 16, label: 'max 16', band: 'max' },
]

/** Arm every mount of a ship to full, so launchers and PD are live. */
function armAll(game: GameState, shipId: string): void {
  const ship = game.ships.find((s) => s.id === shipId)!
  for (const weapon of ship.form.weapons) {
    ship.mounts[weapon.id].forEach((m, i) => {
      m.armed = weapon.mounts[i].armingCircles
    })
  }
}

function place(game: GameState, shipId: string, x: number, y: number, heading: number): void {
  const ship = game.ships.find((s) => s.id === shipId)!
  ship.placement = { position: { x, y }, heading }
}

registerCustomScenarios([
  {
    id: 'visual-carrier-strike',
    name: 'Visual fixture: carrier strike',
    background: '',
    victory: 'destruction',
    bounds: { width: 36, height: 24, fixed: true },
    terrain: [],
    sides: [
      {
        side: 'Alpha Fleet',
        objective: 'destroy',
        facing: 2,
        speed: 4,
        anchor: { x: 6, y: 12 },
        spread: { x: 0, y: 5 },
        force: ['fan-union-ark-royal-fleet-carrier', 'union-yorktown-iii-class-heavy-cruiser'],
      },
      {
        side: 'Beta Fleet',
        objective: 'destroy',
        facing: 6,
        speed: 4,
        anchor: { x: 30, y: 12 },
        spread: { x: 0, y: 5 },
        force: ['vallari-v-11b-predator-class-dreadnought'],
      },
    ],
  },
])

export const FIXTURES: Record<string, () => MapFixture> = {
  /** The printed duel as it opens: two hulls, grid, starfield, arcs and rings on the selected ship. */
  'duel-open': () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    const ship = game.ships[0]
    return { game, selectedId: ship.id, targetId: game.ships[1].id, showArcs: true, rangeRings: RINGS, viewSide: null }
  },

  /** A plotted hard turn with acceleration, so the movement ghost is drawn. */
  'duel-plot': () => {
    const game = startScenario('s3.1-the-duel', { seed: 1 })
    while (game.segment !== 'command') applyAction(game, { type: 'advance-segment' })
    const ship = game.ships[0]
    applyAction(game, { type: 'plot-maneuver', shipId: ship.id, maneuver: 'standard', direction: 'left' })
    applyAction(game, { type: 'plot-accel', shipId: ship.id, delta: 1 })
    return { game, selectedId: ship.id, targetId: null, showArcs: false, rangeRings: [], viewSide: null }
  },

  /** Planet, moon and the rest of the printed terrain. */
  'terrain-orbital': () => {
    const game = startScenario('s3.3-orbital-ambush', { seed: 2 })
    return { game, selectedId: null, targetId: null, showArcs: false, rangeRings: [], viewSide: null }
  },

  /** A nebula tints the whole board (K4.1.1). */
  'terrain-nebula': () => {
    const game = startScenario('exp3-nebula-patrol', { seed: 3 })
    return { game, selectedId: null, targetId: null, showArcs: false, rangeRings: [], viewSide: null }
  },

  /** A carrier's whole wing spread around a dreadnought's facings, as the planner flies it. */
  'carrier-strike': () => {
    const game = startScenario('visual-carrier-strike', { seed: 4 })
    const [carrier, cruiser, predator] = game.ships
    place(game, carrier.id, 8, 12, 90)
    place(game, cruiser.id, 10, 17, 90)
    place(game, predator.id, 24, 12, 270)
    game.phase = 'combat-1'
    game.segment = 'flight-operations'
    for (let i = 0; i < 4; i++) {
      // Two launch bays: open a fresh phase's allowance for each pair.
      game.ops.flightsLaunchedThisPhase = {}
      launchFlight(game, carrier, 'sabre', 'strike', 6 - i)
    }
    const berths = [
      { x: 22.4, y: 12 },
      { x: 24, y: 10.4 },
      { x: 24, y: 13.6 },
      { x: 19.5, y: 12.5 },
    ]
    game.flights.forEach((f, i) => (f.position = berths[i]))
    return { game, selectedId: predator.id, targetId: carrier.id, showArcs: false, rangeRings: [], viewSide: null }
  },

  /** A plasma torpedo in flight: only the Aurelians carry homing weapons in the printed roster. */
  'plasma-inbound': () => {
    const game = startScenario('exp5-aurelian-raid', { seed: 6 })
    const aurelian = game.ships.find((s) => s.form.weapons.some((w) => /PLASMA/i.test(w.name)))!
    const target = game.ships.find((s) => s.side !== aurelian.side)!
    // Nose on to the target, so a forward launcher bears.
    const dx = target.placement.position.x - aurelian.placement.position.x
    const dy = target.placement.position.y - aurelian.placement.position.y
    aurelian.placement = { ...aurelian.placement, heading: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360 }
    armAll(game, aurelian.id)
    game.phase = 'combat-1'
    game.segment = 'combat'
    const tube = aurelian.form.weapons.find((w) => /PLASMA/i.test(w.name))!
    const refusal = launchHoming(game, aurelian, tube, 0, target)
    if (refusal) throw new Error(`plasma-inbound: ${refusal}`)
    // A third of the way there, and flown a leg, so it draws as a live counter.
    for (const hw of game.homing) {
      hw.position = {
        x: aurelian.placement.position.x + dx / 3,
        y: aurelian.placement.position.y + dy / 3,
      }
      hw.phasesFlown = 1
    }
    return { game, selectedId: target.id, targetId: aurelian.id, showArcs: false, rangeRings: [], viewSide: null }
  },

  /** An Aurelian ship gone dark, seen from the other side: the datum is all there is. */
  'cloak-datum': () => {
    const game = startScenario('exp5-aurelian-raid', { seed: 5 })
    const aurelian = game.ships.find((s) => game.cloaks[s.id])!
    const cloak = game.cloaks[aurelian.id]!
    cloak.engaged = true
    cloak.phasesCloaked = 2
    cloak.datum = { position: { ...aurelian.placement.position }, heading: aurelian.placement.heading }
    aurelian.placement = {
      position: { x: aurelian.placement.position.x + 4, y: aurelian.placement.position.y + 3 },
      heading: aurelian.placement.heading,
    }
    const viewer = game.ships.find((s) => s.side !== aurelian.side)!
    return { game, selectedId: viewer.id, targetId: null, showArcs: false, rangeRings: [], viewSide: viewer.side }
  },
}
