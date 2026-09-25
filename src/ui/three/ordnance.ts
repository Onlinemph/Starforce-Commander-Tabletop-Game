/**
 * Everything smaller than a starship: fighter flights (E12.4), homing weapons
 * in flight (E5.1.9), shuttles and probes (J7, J8), escape pods (E11.6.4),
 * cloak datums (H6.2.2) and tractor beam links (J3).
 *
 * One `Layer` covers all of it because these things share a size and a
 * lifecycle: cheap, numerous, transient counters that come and go every
 * phase, as opposed to the handful of hulls `ShipsLayer` tends carefully.
 * Every kind below keeps its own `Map<id, Entry>`, diffed the same way
 * `ShipsLayer` diffs hulls — built once, restyled in place, removed when the
 * table stops mentioning it — and every mesh a kind draws in bulk (a
 * fighter's delta, a torpedo's teardrop, a shuttle's box) shares one
 * geometry and, per side colour, one material.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LineDashedMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three'
import type { EscapePod } from '../../engine/abandonShip'
import { positionIsHidden } from '../../engine/cloaking'
import type { Flight } from '../../engine/fighters'
import type { GameState } from '../../engine/game'
import type { HomingWeapon } from '../../engine/homing'
import type { SmallCraft, SmallCraftKind } from '../../engine/smallCraft'
import type { TractorLink } from '../../engine/tractor'
import { makeLabel, setLabel, type CSS2DObject } from './labels'
import { disposeTree, setTooltip, type FrameContext, type Layer, type LayerContext } from './layer'
import { HULL_ALTITUDE, SIDE_COLOR, headingToYaw, sideColorOf, type SideColor } from './space'
import { beamTexture, glowTexture } from './textures'

/** A point in board inches (world X and Z — see space.ts). */
type Flat = { x: number; z: number }

// ---------------------------------------------------------------------------
// Small pure helpers — layout and bearing maths, kept free of three.js so
// they can be unit tested in node (ordnance.test.ts).
// ---------------------------------------------------------------------------

/**
 * Nudge overlapping flight counters apart so a player can count them.
 *
 * Copied from `MapView.tsx`'s own `fannedFlights` (it is not exported, and
 * the two views must agree on where a stacked wing gets drawn without one
 * importing the other's internals). The flight's real position — what every
 * range in the engine is measured from — is untouched; only the drawing
 * moves, a third of an inch, well inside the half-inch the tape ever cares
 * about.
 */
export function fannedFlights(flights: Flight[]): { flight: Flight; at: Point2 }[] {
  const seen = new Map<string, number>()
  return flights.map((flight) => {
    const cell = `${Math.round(flight.position.x * 2)}:${Math.round(flight.position.y * 2)}`
    const nth = seen.get(cell) ?? 0
    seen.set(cell, nth + 1)
    if (nth === 0) return { flight, at: flight.position }
    const angle = ((nth - 1) % 6) * (Math.PI / 3)
    return {
      flight,
      at: {
        x: flight.position.x + Math.cos(angle) * 0.34,
        y: flight.position.y + Math.sin(angle) * 0.34,
      },
    }
  })
}

type Point2 = { x: number; y: number }

/** A flight counter's label: the card's short name and how many are left. */
function flightLabelText(flight: Flight): string {
  return `${flight.cardId.slice(0, 4).toUpperCase()} ×${flight.members}`
}

/**
 * Seats for up to `n` fighters in a tight V behind the flight's own position
 * — a leader up front and pairs fanning out behind, hull-local inches with
 * the nose toward −z. Pure layout maths, exported for its unit test.
 */
export function formationSeats(n: number): Flat[] {
  const seats: Flat[] = [{ x: 0, z: 0 }]
  for (let row = 1; seats.length < n; row++) {
    seats.push({ x: -row * 0.17, z: row * 0.22 })
    if (seats.length < n) seats.push({ x: row * 0.17, z: row * 0.22 })
  }
  return seats.slice(0, Math.max(1, n))
}

/** Compass bearing from `a` to `b` (board degrees, 0 = north), motion.ts's own convention. */
export function bearingDeg(a: Flat, b: Flat): number {
  return (Math.atan2(b.x - a.x, a.z - b.z) * 180) / Math.PI
}

const shortestTurn = (from: number, to: number) => ((to - from + 540) % 360) - 180

// ---------------------------------------------------------------------------
// Shared geometry builders — one shape each, reused by every instance.
// ---------------------------------------------------------------------------

/** A small delta wing, nose toward −z, the same slab technique hulls.ts uses. */
function fighterGeometry(): BufferGeometry {
  const shape = new Shape()
  shape.moveTo(0, -0.22)
  shape.lineTo(0.11, 0.1)
  shape.lineTo(0.035, 0.06)
  shape.lineTo(-0.035, 0.06)
  shape.lineTo(-0.11, 0.1)
  shape.closePath()
  const geo = new ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 4 })
  geo.rotateX(Math.PI / 2)
  geo.translate(0, 0.025, 0)
  geo.userData.shared = true
  return geo
}

/** A fiery teardrop for A/MAT torpedoes and missiles, tip toward −z. */
function teardropGeometry(): BufferGeometry {
  const geo = new ConeGeometry(0.055, 0.24, 8)
  geo.rotateX(-Math.PI / 2)
  geo.userData.shared = true
  return geo
}

/** A short tapered blade trailing behind an object riding hull-local −z-forward. */
function trailGeometry(): BufferGeometry {
  const shape = new Shape()
  shape.moveTo(0.05, 0)
  shape.lineTo(-0.05, 0)
  shape.lineTo(0, -0.6)
  shape.closePath()
  const geo = new ShapeGeometry(shape)
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, -0.02, 0)
  geo.userData.shared = true
  return geo
}

/** The ring drawn at a cloak's datum (H6.2.2): a dashed circle 0.75" in radius. */
function dashedRingGeometry(radius: number, segments = 72): BufferGeometry {
  const points: number[] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    points.push(Math.cos(a) * radius, 0, Math.sin(a) * radius)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(points, 3))
  geo.userData.shared = true
  return geo
}

/** A unit cylinder along +Y, stretched and turned into a beam by `orientBetween`. */
function beamGeometry(): CylinderGeometry {
  const geo = new CylinderGeometry(1, 1, 1, 8, 1, true)
  geo.userData.shared = true
  return geo
}

const UP = new Vector3(0, 1, 0)
const scratchDir = new Vector3()

/** Point, position and stretch a unit-cylinder mesh so it spans `from`→`to`. */
function orientBetween(mesh: Mesh, from: Vector3, to: Vector3, radius: number): void {
  scratchDir.subVectors(to, from)
  const len = Math.max(0.001, scratchDir.length())
  mesh.position.copy(from).addScaledVector(scratchDir, 0.5)
  mesh.scale.set(radius, len, radius)
  scratchDir.normalize()
  mesh.quaternion.setFromUnitVectors(UP, scratchDir)
}

/** Lazily build and cache one value per key, the small-craft-of-kinds pattern every section here uses. */
function cached<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  const hit = map.get(key)
  if (hit) return hit
  const built = make()
  map.set(key, built)
  return built
}

// ---------------------------------------------------------------------------
// Fighter flights (E12.4)
// ---------------------------------------------------------------------------

interface FlightSeat {
  mesh: Mesh
  engine: Sprite
  local: Flat
  phase: number
}

interface FlightEntry {
  root: Group
  turn: Group
  seats: FlightSeat[]
  label: CSS2DObject
  members: number
  side: SideColor
  x: number
  z: number
  heading: number
  desiredHeading: number
  target: Flat
  lastReal: Flat | null
  seen: boolean
  phase: number
}

// ---------------------------------------------------------------------------
// Homing weapons (E5.1.9)
// ---------------------------------------------------------------------------

interface HomingEntry {
  root: Group
  turn: Group
  mesh: Mesh
  halo: Sprite | null
  trail: Mesh
  cage: Mesh
  plasma: boolean
  side: SideColor
  x: number
  z: number
  heading: number
  target: Flat
  targetPoint: Flat | null
  seen: boolean
  phase: number
}

// ---------------------------------------------------------------------------
// Shuttles and probes (J7, J8)
// ---------------------------------------------------------------------------

interface CraftEntry {
  root: Group
  label: CSS2DObject
  kind: SmallCraftKind
  x: number
  z: number
  target: Flat
  seen: boolean
  phase: number
}

// ---------------------------------------------------------------------------
// Escape pods (E11.6.4)
// ---------------------------------------------------------------------------

interface PodEntry {
  root: Group
  bead: Mesh
  halo: Sprite
  label: CSS2DObject
  phase: number
}

// ---------------------------------------------------------------------------
// Cloak datums (H6.2.2)
// ---------------------------------------------------------------------------

interface DatumEntry {
  root: Group
  ring: LineLoop<BufferGeometry, LineDashedMaterial>
  label: CSS2DObject
}

// ---------------------------------------------------------------------------
// Tractor beam links (J3)
// ---------------------------------------------------------------------------

interface LinkEntry {
  mesh: Mesh
  from: Flat
  to: Flat
  drawnFrom: Flat
  drawnTo: Flat
  seen: boolean
}

export class OrdnanceLayer implements Layer {
  readonly group = new Group()

  private flights = new Map<string, FlightEntry>()
  private homing = new Map<string, HomingEntry>()
  private craft = new Map<string, CraftEntry>()
  private pods = new Map<string, PodEntry>()
  private datums = new Map<string, DatumEntry>()
  private links = new Map<string, LinkEntry>()

  // Shared geometry, one instance per shape.
  private fighterGeo = fighterGeometry()
  private teardropGeo = teardropGeometry()
  private plasmaGeo = new SphereGeometry(0.1, 14, 10)
  private trailGeo = trailGeometry()
  private cageGeo = new TorusGeometry(0.15, 0.017, 6, 22)
  private craftBoxGeo = new BoxGeometry(0.26, 0.15, 0.38)
  private craftWedgeGeo = new ConeGeometry(0.2, 0.4, 4)
  private probeGeo = new SphereGeometry(0.11, 10, 8)
  private probeMastGeo = new CylinderGeometry(0.007, 0.007, 0.24, 4)
  private podGeo = new SphereGeometry(0.085, 10, 8)
  private datumGeo = dashedRingGeometry(0.75)
  private beamGeo = beamGeometry()

  // Shared materials, cached per side colour (or per weapon kind) so the
  // whole layer keeps a handful of materials no matter how many counters
  // are on the board.
  private fighterMats = new Map<SideColor, MeshStandardMaterial>()
  private engineMat: SpriteMaterial
  private plasmaMats = new Map<SideColor, MeshStandardMaterial>()
  private haloMats = new Map<SideColor, SpriteMaterial>()
  private teardropMat: MeshStandardMaterial
  private trailMats = new Map<string, MeshBasicMaterial>()
  private cageMat: MeshBasicMaterial
  private craftMats = new Map<SideColor, MeshStandardMaterial>()
  private podMats = new Map<SideColor, MeshBasicMaterial>()
  private podHaloMats = new Map<SideColor, SpriteMaterial>()
  private datumMat: LineDashedMaterial
  private beamMat: MeshBasicMaterial

  constructor() {
    this.group.name = 'ordnance'
    for (const g of [
      this.fighterGeo,
      this.teardropGeo,
      this.plasmaGeo,
      this.trailGeo,
      this.cageGeo,
      this.craftBoxGeo,
      this.craftWedgeGeo,
      this.probeGeo,
      this.probeMastGeo,
      this.podGeo,
      this.datumGeo,
      this.beamGeo,
    ]) {
      g.userData.shared = true
    }

    this.engineMat = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0x8fc4ff).multiplyScalar(1.4),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    this.engineMat.userData.shared = true

    // A/MAT torpedoes and missiles are the one fiery flame the base rulebook
    // draws (HOMING_ART.amat) — the same for every launching side, so it is
    // built once rather than cached per side like the plasma sphere is.
    this.teardropMat = new MeshStandardMaterial({
      color: 0x2a1a12,
      emissive: new Color(0xff8a3c).multiplyScalar(1.3),
      metalness: 0.2,
      roughness: 0.5,
    })
    this.teardropMat.userData.shared = true

    this.cageMat = new MeshBasicMaterial({
      color: 0x7ce8ff,
      transparent: true,
      opacity: 0.8,
      toneMapped: false,
      side: DoubleSide,
    })
    this.cageMat.userData.shared = true

    this.datumMat = new LineDashedMaterial({
      color: 0xa87cff,
      dashSize: 0.18,
      gapSize: 0.14,
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
    })
    this.datumMat.userData.shared = true

    this.beamMat = new MeshBasicMaterial({
      color: 0x7ce8ff,
      map: beamTexture(),
      transparent: true,
      opacity: 0.6,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: DoubleSide,
    })
    this.beamMat.userData.shared = true
  }

  update(ctx: LayerContext): void {
    this.updateFlights(ctx)
    this.updateHoming(ctx)
    this.updateCraft(ctx)
    this.updatePods(ctx)
    this.updateDatums(ctx)
    this.updateLinks(ctx)
  }

  tick(frame: FrameContext): void {
    this.tickFlights(frame)
    this.tickHoming(frame)
    this.tickCraft(frame)
    this.tickPods(frame)
    this.tickDatums(frame)
    this.tickLinks(frame)
  }

  // ── Fighter flights ─────────────────────────────────────────────────────

  private updateFlights({ game }: LayerContext): void {
    const live = new Set<string>()
    const fanned = fannedFlights(game.flights.filter((f) => !f.dockedTo && f.members > 0))
    for (const { flight, at } of fanned) {
      live.add(flight.id)
      let entry = this.flights.get(flight.id)
      if (!entry) {
        entry = this.createFlight(flight)
        this.flights.set(flight.id, entry)
        this.group.add(entry.root)
      }
      if (entry.lastReal && Math.hypot(entry.lastReal.x - at.x, entry.lastReal.z - at.y) > 0.02) {
        entry.desiredHeading = bearingDeg(entry.lastReal, { x: at.x, z: at.y })
      }
      entry.lastReal = { x: at.x, z: at.y }
      entry.target = { x: at.x, z: at.y }
      if (!entry.seen) {
        entry.x = at.x
        entry.z = at.y
        entry.heading = entry.desiredHeading
        entry.seen = true
      }
      this.restyleFlight(entry, flight)
    }
    for (const [id, entry] of this.flights) {
      if (live.has(id)) continue
      this.group.remove(entry.root)
      disposeTree(entry.root)
      this.flights.delete(id)
    }
  }

  private createFlight(flight: Flight): FlightEntry {
    const root = new Group()
    root.name = `flight:${flight.id}`
    const turn = new Group()
    root.add(turn)
    const label = makeLabel(flightLabelText(flight), 'l3d-craft')
    label.position.set(0, 0.34, 0)
    root.add(label)
    return {
      root,
      turn,
      seats: [],
      label,
      members: 0,
      side: sideColorOf(flight.side),
      x: flight.position.x,
      z: flight.position.y,
      heading: 0,
      desiredHeading: 0,
      target: { x: flight.position.x, z: flight.position.y },
      lastReal: null,
      seen: false,
      phase: (flight.id.length * 2.3) % (Math.PI * 2),
    }
  }

  /** Rebuild the flight's seats only when its member count or side actually changed. */
  private restyleFlight(entry: FlightEntry, flight: Flight): void {
    const side = sideColorOf(flight.side)
    if (entry.members !== flight.members || entry.side !== side || entry.seats.length === 0) {
      for (const seat of entry.seats) {
        entry.turn.remove(seat.mesh, seat.engine)
        // Meshes reuse shared geometry/material; only the seat objects themselves are ours.
      }
      entry.seats = this.buildSeats(entry.turn, flight.members, side)
      entry.members = flight.members
      entry.side = side
    }
    setLabel(entry.label, flightLabelText(flight), `l3d-craft l3d-${side}`)
    setTooltip(
      entry.root,
      `${flight.cardId.toUpperCase()} — ${flight.members} fighter(s)\n` +
        `${flight.spent ? 'BASIC (ordnance expended)' : flight.config}`,
    )
  }

  private buildSeats(turn: Group, members: number, side: SideColor): FlightSeat[] {
    const material = cached(
      this.fighterMats,
      side,
      () =>
        new MeshStandardMaterial({
          color: SIDE_COLOR[side],
          metalness: 0.4,
          roughness: 0.45,
          emissive: new Color(SIDE_COLOR[side]).multiplyScalar(0.35),
        }),
    )
    const seats = formationSeats(members)
    return seats.map((local, i) => {
      const mesh = new Mesh(this.fighterGeo, material)
      mesh.position.set(local.x, 0, local.z)
      turn.add(mesh)
      const engine = new Sprite(this.engineMat)
      engine.scale.setScalar(0.1)
      engine.position.set(local.x, 0.01, local.z + 0.11)
      turn.add(engine)
      return { mesh, engine, local, phase: i * 1.9 }
    })
  }

  private tickFlights({ now, dt, reducedMotion }: FrameContext): void {
    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 8)
    for (const e of this.flights.values()) {
      e.x += (e.target.x - e.x) * ease
      e.z += (e.target.z - e.z) * ease
      e.heading += shortestTurn(e.heading, e.desiredHeading) * (reducedMotion ? 1 : Math.min(1, dt * 5))
      e.root.position.set(e.x, HULL_ALTITUDE * 0.7, e.z)
      e.turn.rotation.y = headingToYaw(e.heading)
      for (const seat of e.seats) {
        const weave = reducedMotion ? 0 : Math.sin(now / 480 + e.phase + seat.phase) * 0.03
        seat.mesh.position.y = weave
        seat.mesh.rotation.z = reducedMotion ? 0 : Math.sin(now / 620 + e.phase + seat.phase) * 0.12
        const flicker = reducedMotion ? 1 : 0.75 + 0.35 * Math.abs(Math.sin(now / 90 + seat.phase * 3))
        seat.engine.material.opacity = 0.85 * flicker
      }
    }
  }

  // ── Homing weapons ──────────────────────────────────────────────────────

  private updateHoming({ game }: LayerContext): void {
    const live = new Set<string>()
    for (const hw of game.homing) {
      live.add(hw.id)
      const owner = game.ships.find((s) => s.id === hw.ownerId)
      const weapon = owner?.form.weapons.find((w) => w.id === hw.weaponId)
      const plasma = weapon?.weaponClass === 'plasma-torpedo'
      const side = sideColorOf(hw.side)
      let entry = this.homing.get(hw.id)
      if (entry && (entry.plasma !== plasma || entry.side !== side)) {
        this.group.remove(entry.root)
        disposeTree(entry.root)
        entry = undefined
      }
      if (!entry) {
        entry = this.createHoming(hw, plasma, side)
        this.homing.set(hw.id, entry)
        this.group.add(entry.root)
      }
      entry.target = { x: hw.position.x, z: hw.position.y }
      if (!entry.seen) {
        entry.x = entry.target.x
        entry.z = entry.target.z
        entry.seen = true
      }
      const targetShip = game.ships.find((s) => s.id === hw.targetId)
      entry.targetPoint = targetShip
        ? { x: targetShip.placement.position.x, z: targetShip.placement.position.y }
        : null
      entry.cage.visible = hw.tractored
      setTooltip(
        entry.root,
        `${hw.weaponName}\n` +
          `${hw.phasesFlown} phase${hw.phasesFlown === 1 ? '' : 's'} flown` +
          (targetShip ? ` · chasing ${targetShip.name}` : '') +
          (hw.tractored ? '\nheld in a tractor beam (E5.4 Step 6)' : ''),
      )
    }
    for (const [id, entry] of this.homing) {
      if (live.has(id)) continue
      this.group.remove(entry.root)
      disposeTree(entry.root)
      this.homing.delete(id)
    }
  }

  private createHoming(hw: HomingWeapon, plasma: boolean, side: SideColor): HomingEntry {
    const root = new Group()
    root.name = `homing:${hw.id}`
    const turn = new Group()
    root.add(turn)

    const mesh = plasma
      ? new Mesh(this.plasmaGeo, cached(this.plasmaMats, side, () => this.buildPlasmaMaterial(side)))
      : new Mesh(this.teardropGeo, this.teardropMat)
    turn.add(mesh)

    let halo: Sprite | null = null
    if (plasma) {
      halo = new Sprite(cached(this.haloMats, side, () => this.buildHaloMaterial(side)))
      halo.scale.setScalar(0.22)
      turn.add(halo)
    }

    const trailKey = `${side}:${plasma}` as const
    const trail = new Mesh(this.trailGeo, cached(this.trailMats, trailKey, () => this.buildTrailMaterial(side, plasma)))
    trail.scale.set(1, 1, plasma ? 0.7 : 1)
    turn.add(trail)

    const cage = new Mesh(this.cageGeo, this.cageMat)
    cage.rotation.x = Math.PI / 2
    cage.visible = false
    root.add(cage)

    return {
      root,
      turn,
      mesh,
      halo,
      trail,
      cage,
      plasma,
      side,
      x: hw.position.x,
      z: hw.position.y,
      heading: 0,
      target: { x: hw.position.x, z: hw.position.y },
      targetPoint: null,
      seen: false,
      phase: (hw.id.length * 3.1) % (Math.PI * 2),
    }
  }

  private buildPlasmaMaterial(side: SideColor): MeshStandardMaterial {
    // Reactor plasma in containment (F5.1): green-white, tinted faintly by
    // the launching side so a glance still tells whose it is. The sphere
    // itself is lit like any solid shape (space.ts's own rule — glow is for
    // small hot accents, not a filled disc of raw colour that would read as
    // a flat white coin under bloom); the halo sprite alongside it carries
    // the actual bloom.
    const tint = new Color(0xbdffcf).lerp(new Color(SIDE_COLOR[side]), 0.2)
    const mat = new MeshStandardMaterial({
      color: tint.clone().multiplyScalar(0.5),
      emissive: tint,
      emissiveIntensity: 0.9,
      roughness: 0.3,
      metalness: 0,
    })
    mat.userData.shared = true
    return mat
  }

  private buildHaloMaterial(side: SideColor): SpriteMaterial {
    const mat = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0xbdffcf).lerp(new Color(SIDE_COLOR[side]), 0.25).multiplyScalar(0.95),
      opacity: 0.38,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    mat.userData.shared = true
    return mat
  }

  /** The trail behind a homing weapon: plasma green-white, flame amber, both lifted a touch toward the launching side's colour. */
  private buildTrailMaterial(side: SideColor, plasma: boolean): MeshBasicMaterial {
    const base = plasma ? new Color(0xbdffcf) : new Color(0xffb15c)
    const color = base.lerp(new Color(SIDE_COLOR[side]), 0.2)
    const mat = new MeshBasicMaterial({
      color: color.multiplyScalar(0.9),
      transparent: true,
      opacity: 0.3,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: DoubleSide,
    })
    mat.userData.shared = true
    return mat
  }

  private tickHoming({ now, dt, reducedMotion }: FrameContext): void {
    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 9)
    for (const e of this.homing.values()) {
      e.x += (e.target.x - e.x) * ease
      e.z += (e.target.z - e.z) * ease
      e.root.position.set(e.x, HULL_ALTITUDE, e.z)
      const bearing = e.targetPoint ? bearingDeg({ x: e.x, z: e.z }, e.targetPoint) : e.heading
      e.heading += shortestTurn(e.heading, bearing) * (reducedMotion ? 1 : Math.min(1, dt * 7))
      e.turn.rotation.y = headingToYaw(e.heading)

      const pulse = reducedMotion ? 1 : 0.82 + 0.22 * Math.sin(now / 210 + e.phase)
      e.mesh.scale.setScalar(pulse)
      if (e.halo) e.halo.scale.setScalar(0.22 * (0.85 + pulse * 0.3))
      if (e.cage.visible && !reducedMotion) e.cage.rotation.z += dt * 1.6
    }
  }

  // ── Shuttles and probes ─────────────────────────────────────────────────

  private updateCraft({ game }: LayerContext): void {
    const live = new Set<string>()
    for (const c of game.smallCraft) {
      live.add(c.id)
      let entry = this.craft.get(c.id)
      if (!entry) {
        entry = this.createCraft(c)
        this.craft.set(c.id, entry)
        this.group.add(entry.root)
      }
      entry.target = { x: c.position.x, z: c.position.y }
      if (!entry.seen) {
        entry.x = entry.target.x
        entry.z = entry.target.z
        entry.seen = true
      }
      const label = c.kind === 'probe' ? 'PROBE' : c.kind === 'jamming-shuttle' ? 'JAM' : 'SHTL'
      setLabel(entry.label, label, `l3d-craft l3d-${sideColorOf(c.side)}`)
      setTooltip(
        entry.root,
        `${label}${c.marines ? ` · ${c.marines} marine squad(s)` : ''}${c.dockedTo ? '\ndocked' : ''}${
          c.transmitting ? '\ntransmitting' : ''
        }`,
      )
    }
    for (const [id, entry] of this.craft) {
      if (live.has(id)) continue
      this.group.remove(entry.root)
      disposeTree(entry.root)
      this.craft.delete(id)
    }
  }

  private createCraft(c: SmallCraft): CraftEntry {
    const root = new Group()
    root.name = `craft:${c.id}`
    const side = sideColorOf(c.side)
    const material = cached(
      this.craftMats,
      side,
      () =>
        new MeshStandardMaterial({
          color: 0x39435e,
          emissive: new Color(SIDE_COLOR[side]).multiplyScalar(0.5),
          metalness: 0.35,
          roughness: 0.5,
        }),
    )
    if (c.kind === 'probe') {
      const body = new Mesh(this.probeGeo, material)
      const mast = new Mesh(this.probeMastGeo, material)
      mast.position.y = 0.16
      root.add(body, mast)
    } else if (c.kind === 'jamming-shuttle') {
      const wedge = new Mesh(this.craftWedgeGeo, material)
      wedge.rotation.x = Math.PI / 2
      root.add(wedge)
    } else {
      root.add(new Mesh(this.craftBoxGeo, material))
    }
    const label = makeLabel('', 'l3d-craft')
    label.position.set(0, 0.24, 0)
    root.add(label)
    return {
      root,
      label,
      kind: c.kind,
      x: c.position.x,
      z: c.position.y,
      target: { x: c.position.x, z: c.position.y },
      seen: false,
      phase: (c.id.length * 1.3) % (Math.PI * 2),
    }
  }

  private tickCraft({ now, dt, reducedMotion }: FrameContext): void {
    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 9)
    for (const e of this.craft.values()) {
      e.x += (e.target.x - e.x) * ease
      e.z += (e.target.z - e.z) * ease
      const bob = reducedMotion ? 0 : Math.sin(now / 700 + e.phase) * 0.015
      e.root.position.set(e.x, HULL_ALTITUDE * 0.55 + bob, e.z)
    }
  }

  // ── Escape pods ──────────────────────────────────────────────────────────

  private updatePods({ game }: LayerContext): void {
    const live = new Set<string>()
    for (const pod of game.escapePods) {
      live.add(pod.id)
      let entry = this.pods.get(pod.id)
      if (!entry) {
        entry = this.createPod(pod)
        this.pods.set(pod.id, entry)
        this.group.add(entry.root)
        entry.root.position.set(pod.position.x, HULL_ALTITUDE * 0.3, pod.position.y)
      }
      setLabel(entry.label, `PODS ×${pod.crew}`, `l3d-craft l3d-${sideColorOf(pod.side)}`)
      setTooltip(
        entry.root,
        `${pod.fromShipName} — escape pods\n${pod.crew} crew unit(s) aboard\n` +
          'Land on a stopped ship within 1", or beam them across (E11.6.5)',
      )
    }
    for (const [id, entry] of this.pods) {
      if (live.has(id)) continue
      this.group.remove(entry.root)
      disposeTree(entry.root)
      this.pods.delete(id)
    }
  }

  private createPod(pod: EscapePod): PodEntry {
    const root = new Group()
    root.name = `pod:${pod.id}`
    const side = sideColorOf(pod.side)
    const bead = new Mesh(this.podGeo, cached(this.podMats, side, () => this.buildPodMaterial(side)))
    const halo = new Sprite(cached(this.podHaloMats, side, () => this.buildPodHaloMaterial(side)))
    halo.scale.setScalar(0.32)
    root.add(bead, halo)
    const label = makeLabel(`PODS ×${pod.crew}`, 'l3d-craft')
    label.position.set(0, 0.2, 0)
    root.add(label)
    return { root, bead, halo, label, phase: (pod.id.length * 1.7) % (Math.PI * 2) }
  }

  private buildPodMaterial(side: SideColor): MeshBasicMaterial {
    const mat = new MeshBasicMaterial({ color: new Color(SIDE_COLOR[side]).multiplyScalar(1.8), toneMapped: false })
    mat.userData.shared = true
    return mat
  }

  private buildPodHaloMaterial(side: SideColor): SpriteMaterial {
    const mat = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(SIDE_COLOR[side]).multiplyScalar(1.4),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    mat.userData.shared = true
    return mat
  }

  private tickPods({ now, reducedMotion }: FrameContext): void {
    for (const e of this.pods.values()) {
      // A slow, defenceless beacon (E11.6.4): a blink, not a pulse — it has
      // nowhere to be and nothing to do but wait to be found.
      const on = reducedMotion ? 1 : (Math.sin(now / 450 + e.phase) + 1) / 2
      const blink = 0.35 + 0.75 * Math.max(0, on - 0.15)
      e.bead.scale.setScalar(0.7 + blink * 0.5)
      e.halo.material.opacity = 0.5 * blink
    }
  }

  // ── Cloak datums ─────────────────────────────────────────────────────────

  private updateDatums({ game }: LayerContext): void {
    const live = new Set<string>()
    for (const [id, cloak] of Object.entries(game.cloaks)) {
      if (!positionIsHidden(cloak)) continue
      const ship = game.ships.find((s) => s.id === id)
      if (!ship || ship.destroyed || ship.disengaged) continue
      live.add(id)
      let entry = this.datums.get(id)
      if (!entry) {
        entry = this.createDatum()
        this.datums.set(id, entry)
        this.group.add(entry.root)
      }
      entry.root.position.set(cloak.datum.position.x, 0.02, cloak.datum.position.y)
    }
    for (const [id, entry] of this.datums) {
      if (live.has(id)) continue
      this.group.remove(entry.root)
      disposeTree(entry.root)
      this.datums.delete(id)
    }
  }

  private createDatum(): DatumEntry {
    const root = new Group()
    const ring = new LineLoop(this.datumGeo, this.datumMat)
    ring.computeLineDistances()
    root.add(ring)
    const label = makeLabel('DATUM', 'l3d-datum')
    label.position.set(0, 0.05, 0.9)
    root.add(label)
    return { root, ring, label }
  }

  private tickDatums({ dt, reducedMotion }: FrameContext): void {
    if (reducedMotion) return
    for (const e of this.datums.values()) e.ring.rotation.y += dt * 0.35
  }

  // ── Tractor beam links ───────────────────────────────────────────────────

  private updateLinks({ game }: LayerContext): void {
    const live = new Set<string>()
    for (const link of game.ops.links) {
      const at = linkEndpoints(game, link)
      if (!at) continue
      live.add(link.id)
      let entry = this.links.get(link.id)
      if (!entry) {
        entry = this.createLink()
        this.links.set(link.id, entry)
        this.group.add(entry.mesh)
      }
      entry.from = at.from
      entry.to = at.to
      if (!entry.seen) {
        entry.drawnFrom = { ...at.from }
        entry.drawnTo = { ...at.to }
        entry.seen = true
      }
    }
    for (const [id, entry] of this.links) {
      if (live.has(id)) continue
      this.group.remove(entry.mesh)
      this.links.delete(id)
    }
  }

  private createLink(): LinkEntry {
    const mesh = new Mesh(this.beamGeo, this.beamMat)
    return { mesh, from: { x: 0, z: 0 }, to: { x: 0, z: 0 }, drawnFrom: { x: 0, z: 0 }, drawnTo: { x: 0, z: 0 }, seen: false }
  }

  private tickLinks({ now, dt, reducedMotion }: FrameContext): void {
    // One shared material carries every beam's pulse and scroll, so J3's
    // links can multiply without the layer minting a material each time.
    this.beamMat.opacity = reducedMotion ? 0.55 : 0.45 + 0.3 * Math.sin(now / 190)
    const map = this.beamMat.map
    if (map && !reducedMotion) map.offset.y = (map.offset.y - dt * 1.1) % 1

    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 8)
    const from = new Vector3()
    const to = new Vector3()
    for (const e of this.links.values()) {
      e.drawnFrom.x += (e.from.x - e.drawnFrom.x) * ease
      e.drawnFrom.z += (e.from.z - e.drawnFrom.z) * ease
      e.drawnTo.x += (e.to.x - e.drawnTo.x) * ease
      e.drawnTo.z += (e.to.z - e.drawnTo.z) * ease
      from.set(e.drawnFrom.x, HULL_ALTITUDE, e.drawnFrom.z)
      to.set(e.drawnTo.x, HULL_ALTITUDE, e.drawnTo.z)
      orientBetween(e.mesh, from, to, 0.032)
    }
  }

  dispose(): void {
    disposeTree(this.group)
    for (const g of [
      this.fighterGeo,
      this.teardropGeo,
      this.plasmaGeo,
      this.trailGeo,
      this.cageGeo,
      this.craftBoxGeo,
      this.craftWedgeGeo,
      this.probeGeo,
      this.probeMastGeo,
      this.podGeo,
      this.datumGeo,
      this.beamGeo,
    ]) {
      g.dispose()
    }
    this.engineMat.dispose()
    this.teardropMat.dispose()
    this.cageMat.dispose()
    this.datumMat.dispose()
    this.beamMat.dispose()
    for (const mats of [
      this.fighterMats,
      this.plasmaMats,
      this.haloMats,
      this.craftMats,
      this.podMats,
      this.podHaloMats,
    ] as Array<Map<SideColor, Material>>) {
      for (const m of mats.values()) m.dispose()
      mats.clear()
    }
    for (const m of this.trailMats.values()) m.dispose()
    this.trailMats.clear()
  }
}

/** Board point for the ship or small craft a link holds, per E5.4/J3 (game.ships[].placement is the source of truth). */
function linkEndpoints(game: GameState, link: TractorLink): { from: Flat; to: Flat } | null {
  const source = game.ships.find((s) => s.id === link.sourceId)
  if (!source) return null
  const targetShip = game.ships.find((s) => s.id === link.targetId)
  const targetPos = targetShip?.placement.position ?? game.smallCraft.find((c) => c.id === link.targetId)?.position
  if (!targetPos) return null
  return {
    from: { x: source.placement.position.x, z: source.placement.position.y },
    to: { x: targetPos.x, z: targetPos.y },
  }
}
