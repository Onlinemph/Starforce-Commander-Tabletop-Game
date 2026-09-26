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
 * geometry and, per side colour, one material — even the plasma ball's
 * `ShaderMaterial`, whose only per-frame cost is one shared `uTime` uniform.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
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
  PointLight,
  ShaderMaterial,
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

/**
 * A sleek swept-wing fighter, nose toward −z, with a tailfin at the back —
 * the same extruded-slab technique hulls.ts uses, just a slimmer silhouette
 * than a plain delta so a close-up flight still reads as a fighter and not
 * a paper dart.
 */
function fighterGeometry(): BufferGeometry {
  const shape = new Shape()
  shape.moveTo(0, -0.27)
  shape.lineTo(0.045, -0.1)
  shape.lineTo(0.155, 0.08)
  shape.lineTo(0.095, 0.11)
  shape.lineTo(0.03, 0.065)
  shape.lineTo(0.03, 0.15)
  shape.lineTo(-0.03, 0.15)
  shape.lineTo(-0.03, 0.065)
  shape.lineTo(-0.095, 0.11)
  shape.lineTo(-0.155, 0.08)
  shape.lineTo(-0.045, -0.1)
  shape.closePath()
  const geo = new ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.006, bevelSegments: 1, curveSegments: 3 })
  geo.rotateX(Math.PI / 2)
  geo.translate(0, 0.022, 0)
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

/**
 * A unit tube along +Y, tapered from a wide mouth to a narrower far end so a
 * tractor beam (the only user) reads as a volumetric cone rather than a
 * drinking straw once `orientBetween` stretches and points it.
 */
function beamGeometry(): CylinderGeometry {
  const geo = new CylinderGeometry(1, 0.4, 1, 10, 1, true)
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
// A small, reusable value-noise turbulence — the plasma ball's roil. Cheap
// hash-based value noise rather than true Perlin, same trade-off textures.ts
// makes for its canvas clouds, just written for a shader instead of a
// canvas: three octaves is plenty for something the size of a counter.
// ---------------------------------------------------------------------------
const NOISE_GLSL = `
  float sfcNoiseHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float sfcValueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = sfcNoiseHash(i + vec3(0.0, 0.0, 0.0));
    float n100 = sfcNoiseHash(i + vec3(1.0, 0.0, 0.0));
    float n010 = sfcNoiseHash(i + vec3(0.0, 1.0, 0.0));
    float n110 = sfcNoiseHash(i + vec3(1.0, 1.0, 0.0));
    float n001 = sfcNoiseHash(i + vec3(0.0, 0.0, 1.0));
    float n101 = sfcNoiseHash(i + vec3(1.0, 0.0, 1.0));
    float n011 = sfcNoiseHash(i + vec3(0.0, 1.0, 1.0));
    float n111 = sfcNoiseHash(i + vec3(1.0, 1.0, 1.0));
    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);
    return mix(nxy0, nxy1, f.z);
  }
  float sfcTurbulence(vec3 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
      v += amp * sfcValueNoise(p);
      p *= 2.05;
      amp *= 0.5;
    }
    return v;
  }
`

// ---------------------------------------------------------------------------
// Fighter flights (E12.4)
// ---------------------------------------------------------------------------

interface FlightSeat {
  mesh: Mesh
  engine: Sprite
  engineCore: Sprite
  canopy: Sprite
  trail: Mesh
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
  hot: Sprite | null
  trail: Mesh
  trailOuter: Mesh | null
  cage: Mesh
  light: PointLight | null
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
  haze: Mesh
  label: CSS2DObject
  phase: number
}

// ---------------------------------------------------------------------------
// Tractor beam links (J3)
// ---------------------------------------------------------------------------

interface LinkEntry {
  sheath: Mesh
  core: Mesh
  glowFrom: Sprite
  glowTo: Sprite
  from: Flat
  to: Flat
  drawnFrom: Flat
  drawnTo: Flat
  seen: boolean
}

/** At most this many plasma torpedoes may carry their own point light at once — the one part of this layer that is not free. */
const MAX_PLASMA_LIGHTS = 3

export class OrdnanceLayer implements Layer {
  readonly group = new Group()

  private flights = new Map<string, FlightEntry>()
  private homing = new Map<string, HomingEntry>()
  private craft = new Map<string, CraftEntry>()
  private pods = new Map<string, PodEntry>()
  private datums = new Map<string, DatumEntry>()
  private links = new Map<string, LinkEntry>()
  private liveLights = 0

  // Shared geometry, one instance per shape.
  private fighterGeo = fighterGeometry()
  private teardropGeo = teardropGeometry()
  private plasmaGeo = new SphereGeometry(0.1, 16, 12)
  private trailGeo = trailGeometry()
  private cageGeo = new TorusGeometry(0.15, 0.017, 6, 22)
  private craftBoxGeo = new BoxGeometry(0.26, 0.15, 0.38)
  private craftWedgeGeo = new ConeGeometry(0.2, 0.4, 4)
  private probeGeo = new SphereGeometry(0.11, 10, 8)
  private probeMastGeo = new CylinderGeometry(0.007, 0.007, 0.24, 4)
  private podGeo = new SphereGeometry(0.085, 10, 8)
  private datumGeo = dashedRingGeometry(0.75)
  private datumHazeGeo = (() => {
    // Flat and lying on the board, not billboarded like a Sprite — a
    // Sprite here would stand up facing the camera and dip its lower half
    // through the board plane, clipping against the backdrop's grid.
    const geo = new CircleGeometry(0.85, 28)
    geo.rotateX(-Math.PI / 2)
    geo.userData.shared = true
    return geo
  })()
  private beamGeo = beamGeometry()

  // Shared materials, cached per side colour (or per weapon kind) so the
  // whole layer keeps a handful of materials no matter how many counters
  // are on the board.
  private fighterMats = new Map<SideColor, MeshStandardMaterial>()
  private engineMat: SpriteMaterial
  private engineCoreMat: SpriteMaterial
  private canopyMat: SpriteMaterial
  private fighterTrailMats = new Map<SideColor, MeshBasicMaterial>()
  private plasmaMats = new Map<SideColor, ShaderMaterial>()
  private haloMats = new Map<SideColor, SpriteMaterial>()
  private teardropMat: MeshStandardMaterial
  private amatHotMat: SpriteMaterial
  private trailMats = new Map<string, MeshBasicMaterial>()
  private trailOuterMats = new Map<SideColor, MeshBasicMaterial>()
  private cageMat: MeshBasicMaterial
  private craftMats = new Map<SideColor, MeshStandardMaterial>()
  private podMats = new Map<SideColor, MeshBasicMaterial>()
  private podHaloMats = new Map<SideColor, SpriteMaterial>()
  private datumMat: LineDashedMaterial
  private datumHazeMat: MeshBasicMaterial
  private beamMat: MeshBasicMaterial
  private beamCoreMat: MeshBasicMaterial
  private beamEndMat: SpriteMaterial

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

    // A tiny, very bright pinpoint nested inside the engine glow — the same
    // white-hot-filament-in-a-coloured-sheath idea effects.ts uses for beams,
    // so an engine reads as a real exhaust rather than a flat blue dot.
    this.engineCoreMat = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0xffffff).multiplyScalar(1.8),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    this.engineCoreMat.userData.shared = true

    // A single bright dot standing in for a canopy's glint — cheap enough to
    // give every fighter one without ever minting a material per seat.
    this.canopyMat = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0xdcefff).multiplyScalar(1.6),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
      opacity: 0.85,
    })
    this.canopyMat.userData.shared = true

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

    this.amatHotMat = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0xffd9a0).multiplyScalar(1.7),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    this.amatHotMat.userData.shared = true

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

    // A soft, low haze under the ring — the "hologram" half of the datum's
    // distortion, a projection with no substance rather than a solid marker.
    // A flat mesh, not a sprite: it lies on the board like the ring's own
    // shadow rather than standing up to face the camera.
    this.datumHazeMat = new MeshBasicMaterial({
      map: glowTexture(),
      color: new Color(0xa87cff).multiplyScalar(1.1),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
      opacity: 0.16,
    })
    this.datumHazeMat.userData.shared = true

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

    // A slim, textureless thread down the middle of the tractor tube — the
    // same white-core-in-a-coloured-sheath nesting as everything else here,
    // so the beam reads as a volume of energy rather than a printed ribbon.
    this.beamCoreMat = new MeshBasicMaterial({
      color: new Color(0xeaffff).multiplyScalar(1.5),
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.beamCoreMat.userData.shared = true

    this.beamEndMat = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0x9fe8ff).multiplyScalar(1.6),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    this.beamEndMat.userData.shared = true
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
        entry.turn.remove(seat.mesh, seat.engine, seat.engineCore, seat.canopy, seat.trail)
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
    const trailMat = cached(this.fighterTrailMats, side, () => this.buildFighterTrailMaterial(side))
    const seats = formationSeats(members)
    return seats.map((local, i) => {
      const mesh = new Mesh(this.fighterGeo, material)
      mesh.position.set(local.x, 0, local.z)
      turn.add(mesh)

      const canopy = new Sprite(this.canopyMat)
      canopy.scale.setScalar(0.05)
      canopy.position.set(local.x, 0.028, local.z - 0.12)
      turn.add(canopy)

      const engine = new Sprite(this.engineMat)
      engine.scale.setScalar(0.1)
      engine.position.set(local.x, 0.01, local.z + 0.13)
      turn.add(engine)

      const engineCore = new Sprite(this.engineCoreMat)
      engineCore.scale.setScalar(0.04)
      engineCore.position.copy(engine.position)
      turn.add(engineCore)

      // The trail fades in behind the engine only once the fighter is
      // actually moving (see tickFlights) — a thin fading ribbon, not a
      // permanent streamer.
      const trail = new Mesh(this.trailGeo, trailMat)
      trail.position.set(local.x, 0.008, local.z + 0.14)
      trail.scale.set(0.4, 1, 0.001)
      turn.add(trail)

      return { mesh, engine, engineCore, canopy, trail, local, phase: i * 1.9 }
    })
  }

  /** A fighter's engine wash: blue-white, nudged toward the side's own colour so a wing still reads as whose it is from behind. */
  private buildFighterTrailMaterial(side: SideColor): MeshBasicMaterial {
    const color = new Color(0xaee0ff).lerp(new Color(SIDE_COLOR[side]), 0.18)
    const mat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    mat.userData.shared = true
    return mat
  }

  private tickFlights({ now, dt, reducedMotion }: FrameContext): void {
    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 8)
    const safeDt = Math.max(dt, 1 / 240)
    for (const e of this.flights.values()) {
      const stepX = (e.target.x - e.x) * ease
      const stepZ = (e.target.z - e.z) * ease
      e.x += stepX
      e.z += stepZ
      // A rough instantaneous speed from this frame's own step — enough to
      // decide whether a trail should be showing at all, not a real physics
      // velocity.
      const speed = reducedMotion ? 0 : Math.hypot(stepX, stepZ) / safeDt
      e.heading += shortestTurn(e.heading, e.desiredHeading) * (reducedMotion ? 1 : Math.min(1, dt * 5))
      e.root.position.set(e.x, HULL_ALTITUDE * 0.7, e.z)
      e.turn.rotation.y = headingToYaw(e.heading)
      const trailLen = Math.min(2.4, speed * 1.1)
      const trailOpacity = Math.min(0.6, speed * 0.55)
      for (const seat of e.seats) {
        // A small weave: bob and roll in place, plus a lateral jink so a
        // flight reads as jockeying in formation rather than gliding on
        // rails — all idle motion, so reduced-motion drops it entirely.
        const bob = reducedMotion ? 0 : Math.sin(now / 480 + e.phase + seat.phase) * 0.03
        const jink = reducedMotion ? 0 : Math.sin(now / 900 + e.phase + seat.phase * 1.3) * 0.028
        seat.mesh.position.y = bob
        seat.mesh.position.x = seat.local.x + jink
        seat.mesh.rotation.z = reducedMotion ? 0 : Math.sin(now / 620 + e.phase + seat.phase) * 0.14
        seat.mesh.rotation.y = reducedMotion ? 0 : jink * 0.6
        seat.canopy.position.x = seat.mesh.position.x
        seat.canopy.position.y = 0.028 + bob
        const flicker = reducedMotion ? 1 : 0.75 + 0.35 * Math.abs(Math.sin(now / 90 + seat.phase * 3))
        seat.engine.material.opacity = 0.85 * flicker
        seat.engineCore.material.opacity = 0.8 * flicker
        seat.engineCore.position.x = seat.mesh.position.x
        seat.engineCore.position.y = seat.mesh.position.y + 0.01

        seat.trail.visible = !reducedMotion && trailLen > 0.05
        if (seat.trail.visible) {
          seat.trail.position.x = seat.mesh.position.x
          seat.trail.scale.set(0.4, 1, 0.12 + trailLen)
          const tmat = seat.trail.material as MeshBasicMaterial
          tmat.opacity = trailOpacity * flicker
        }
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
        if (entry.light) this.liveLights--
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
      if (entry.light) this.liveLights--
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
    let hot: Sprite | null = null
    let trailOuter: Mesh | null = null
    let light: PointLight | null = null
    if (plasma) {
      // The outer corona: a soft, bigger bloom around the containment shell.
      halo = new Sprite(cached(this.haloMats, side, () => this.buildHaloMaterial(side)))
      halo.scale.setScalar(0.2)
      turn.add(halo)

      // A faint light, pooled like a hull impact's: only a few plasma
      // torpedoes in flight at once actually get to cast one.
      if (this.liveLights < MAX_PLASMA_LIGHTS) {
        const tint = new Color(0xbdffcf).lerp(new Color(SIDE_COLOR[side]), 0.2)
        light = new PointLight(tint, 0, 3.2, 2)
        root.add(light)
        this.liveLights++
      }
    } else {
      // A/MAT and missiles: a small hot pinpoint riding at the nose.
      hot = new Sprite(this.amatHotMat)
      hot.scale.setScalar(0.09)
      turn.add(hot)
    }

    const trailKey = `${side}:${plasma}` as const
    const trail = new Mesh(this.trailGeo, cached(this.trailMats, trailKey, () => this.buildTrailMaterial(side, plasma)))
    trail.scale.set(1, 1, plasma ? 0.8 : 1.7)
    turn.add(trail)

    if (plasma) {
      // A second, wider and softer blade behind the bright one — a comet's
      // coma around its tail, not just a brighter core.
      trailOuter = new Mesh(this.trailGeo, cached(this.trailOuterMats, side, () => this.buildTrailGlowMaterial(side)))
      trailOuter.scale.set(2.1, 1, 1.9)
      turn.add(trailOuter)
    }

    const cage = new Mesh(this.cageGeo, this.cageMat)
    cage.rotation.x = Math.PI / 2
    cage.visible = false
    root.add(cage)

    return {
      root,
      turn,
      mesh,
      halo,
      hot,
      trail,
      trailOuter,
      cage,
      light,
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

  /**
   * Reactor plasma in containment (F5.1): a roiling energy ball rather than a
   * flat-lit sphere — a noise-driven shader, green-white and tinted faintly
   * by the launching side, still `toneMapped` and opaque like any solid
   * shape (space.ts's own rule: glow is for small hot accents, and the halo
   * sprite alongside carries the actual bloom, not this sphere itself).
   */
  private buildPlasmaMaterial(side: SideColor): ShaderMaterial {
    const tint = new Color(0xbdffcf).lerp(new Color(SIDE_COLOR[side]), 0.2)
    const mat = new ShaderMaterial({
      uniforms: {
        uColorA: { value: tint.clone().multiplyScalar(0.16) },
        uColorB: { value: tint.clone().multiplyScalar(1.8) },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vPos;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vPos = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uTime;
        varying vec3 vPos;
        varying vec3 vNormal;
        varying vec3 vView;
        ${NOISE_GLSL}
        void main() {
          vec3 n = normalize(vNormal);
          float turb = sfcTurbulence(vPos * 4.5 + vec3(0.0, 0.0, uTime * 1.4));
          float rim = pow(1.0 - max(dot(n, vView), 0.0), 2.0);
          vec3 col = mix(uColorA, uColorB, clamp(turb * 1.9 - 0.35, 0.0, 1.0));
          col += uColorB * rim * 0.5;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
    mat.userData.shared = true
    return mat
  }

  private buildHaloMaterial(side: SideColor): SpriteMaterial {
    const mat = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0xbdffcf).lerp(new Color(SIDE_COLOR[side]), 0.25).multiplyScalar(0.85),
      opacity: 0.3,
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

  /** A wider, dimmer echo of the plasma trail — the coma around a comet's tail. */
  private buildTrailGlowMaterial(side: SideColor): MeshBasicMaterial {
    const color = new Color(0xbdffcf).lerp(new Color(SIDE_COLOR[side]), 0.2)
    const mat = new MeshBasicMaterial({
      color: color.multiplyScalar(0.6),
      transparent: true,
      opacity: 0.14,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: DoubleSide,
    })
    mat.userData.shared = true
    return mat
  }

  private tickHoming({ now, dt, reducedMotion }: FrameContext): void {
    if (!reducedMotion) {
      // One shared uniform per side colour animates every plasma ball of
      // that colour at once — a handful of writes, however many are in
      // flight.
      for (const mat of this.plasmaMats.values()) mat.uniforms.uTime.value = now / 1000
    }
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
      if (e.halo) e.halo.scale.setScalar(0.2 * (0.85 + pulse * 0.3))
      if (e.hot) {
        const flicker = reducedMotion ? 1 : 0.8 + 0.3 * Math.abs(Math.sin(now / 70 + e.phase * 2))
        e.hot.material.opacity = flicker
        e.hot.scale.setScalar(0.09 * (0.85 + flicker * 0.25))
      }
      if (e.trailOuter && !reducedMotion) {
        const breathe = 0.9 + 0.15 * Math.sin(now / 260 + e.phase)
        e.trailOuter.scale.x = 2.1 * breathe
      }
      if (e.light) e.light.intensity = reducedMotion ? 0 : 1.1 * (0.8 + 0.2 * pulse)
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
        entry = this.createDatum(id)
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

  private createDatum(id: string): DatumEntry {
    const root = new Group()
    const ring = new LineLoop(this.datumGeo, this.datumMat)
    ring.computeLineDistances()
    root.add(ring)
    // A soft flat haze under the ring: the "hologram" reads as a faint
    // projection sitting on the board, not a hard marker.
    const haze = new Mesh(this.datumHazeGeo, this.datumHazeMat)
    haze.position.y = 0.005
    root.add(haze)
    const label = makeLabel('DATUM', 'l3d-datum')
    label.position.set(0, 0.05, 0.9)
    root.add(label)
    return { root, ring, haze, label, phase: (id.length * 1.4) % (Math.PI * 2) }
  }

  private tickDatums({ now, dt, reducedMotion }: FrameContext): void {
    for (const e of this.datums.values()) {
      if (reducedMotion) continue
      e.ring.rotation.y += dt * 0.35
      // A subtle, asymmetric wobble in the ring's own radius — a distortion
      // in the projection, not a rigid spinning hoop.
      e.ring.scale.set(1 + Math.sin(now / 700 + e.phase) * 0.025, 1, 1 + Math.cos(now / 540 + e.phase) * 0.025)
      const flicker = 0.7 + 0.3 * Math.sin(now / 260 + e.phase * 2)
      ;(e.haze.material as MeshBasicMaterial).opacity = 0.14 * flicker
    }
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
        this.group.add(entry.sheath, entry.core, entry.glowFrom, entry.glowTo)
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
      this.group.remove(entry.sheath, entry.core, entry.glowFrom, entry.glowTo)
      this.links.delete(id)
    }
  }

  private createLink(): LinkEntry {
    const sheath = new Mesh(this.beamGeo, this.beamMat)
    const core = new Mesh(this.beamGeo, this.beamCoreMat)
    const glowFrom = new Sprite(this.beamEndMat)
    const glowTo = new Sprite(this.beamEndMat)
    glowFrom.scale.setScalar(0.16)
    glowTo.scale.setScalar(0.16)
    return {
      sheath,
      core,
      glowFrom,
      glowTo,
      from: { x: 0, z: 0 },
      to: { x: 0, z: 0 },
      drawnFrom: { x: 0, z: 0 },
      drawnTo: { x: 0, z: 0 },
      seen: false,
    }
  }

  private tickLinks({ now, dt, reducedMotion }: FrameContext): void {
    // One shared material carries every beam's pulse and scroll, so J3's
    // links can multiply without the layer minting a material each time.
    this.beamMat.opacity = reducedMotion ? 0.55 : 0.45 + 0.3 * Math.sin(now / 190)
    this.beamCoreMat.opacity = reducedMotion ? 0.4 : 0.45 + 0.25 * Math.sin(now / 190 + 0.6)
    const map = this.beamMat.map
    if (map && !reducedMotion) map.offset.y = (map.offset.y - dt * 1.1) % 1
    const endPulse = reducedMotion ? 0.7 : 0.6 + 0.4 * Math.abs(Math.sin(now / 260))
    this.beamEndMat.opacity = endPulse

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
      orientBetween(e.sheath, from, to, 0.034)
      orientBetween(e.core, from, to, 0.013)
      e.glowFrom.position.copy(from)
      e.glowTo.position.copy(to)
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
      this.datumHazeGeo,
      this.beamGeo,
    ]) {
      g.dispose()
    }
    this.engineMat.dispose()
    this.engineCoreMat.dispose()
    this.canopyMat.dispose()
    this.teardropMat.dispose()
    this.amatHotMat.dispose()
    this.cageMat.dispose()
    this.datumMat.dispose()
    this.datumHazeMat.dispose()
    this.beamMat.dispose()
    this.beamCoreMat.dispose()
    this.beamEndMat.dispose()
    for (const mats of [
      this.fighterMats,
      this.plasmaMats,
      this.haloMats,
      this.craftMats,
      this.podMats,
      this.podHaloMats,
      this.fighterTrailMats,
      this.trailOuterMats,
    ] as Array<Map<SideColor, Material>>) {
      for (const m of mats.values()) m.dispose()
      mats.clear()
    }
    for (const m of this.trailMats.values()) m.dispose()
    this.trailMats.clear()
    this.liveLights = 0
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
