/**
 * Terrain (Section K) and the missions (missions.ts): planets and moons that
 * block line of sight, asteroid fields that cost speed and grant cover, gas
 * clouds that hide, and the objectives scenarios drop on top of any of it.
 *
 * Terrain is fixed for the life of a scenario, so `update` builds each
 * feature once (by id) and never again; only the mission markers — whose
 * state changes every round — are refreshed on every call. `tick` gives the
 * board a little life: worlds turn, asteroids tumble, a cargo crate spins,
 * all of it off under `reducedMotion`.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three'
import { Rng } from '../../engine/dice'
import type { GameState, Terrain } from '../../engine/game'
import type { MissionDef, MissionState } from '../../engine/missions'
import { DENSITY_STATS, type AsteroidDensity } from '../../data/terrainCounters'
import { makeLabel, setLabel, type CSS2DObject } from './labels'
import { disposeTree, setTooltip, type FrameContext, type Layer, type LayerContext } from './layer'
import { toWorld } from './space'
import { cloudTexture, glowTexture, worldTexture } from './textures'

/** Just above the board, so nothing here z-fights the grid (overlays.ts uses the same idea). */
const FLOOR = 0.04

/** The printed density colours (K2.1.2), the same ones MapView draws the counter's stroke in. */
const DENSITY_COLOR: Record<AsteroidDensity, number> = {
  light: 0x4aa8ff,
  medium: 0x57c46f,
  high: 0xffb020,
  extreme: 0xff4d4d,
}

/** Rocks per square inch of field, by density — extreme fields read visibly denser than light ones. */
const DENSITY_ROCK_FACTOR: Record<AsteroidDensity, number> = {
  light: 0.55,
  medium: 0.85,
  high: 1.25,
  extreme: 1.75,
}

// ── Pure helpers (tested in terrain.test.ts) ───────────────────────────────

/** A stable, cheap hash from a feature's id to a numeric seed — the same technique MapView's AsteroidScatter uses. */
export function hashId(id: string): number {
  let n = 0
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) | 0
  return n ^ 0x1d3f
}

/** How many rocks an asteroid field's InstancedMesh gets, bounded so a huge field never tanks the frame rate. */
export function rockCountFor(radius: number, density: AsteroidDensity | undefined): number {
  const factor = DENSITY_ROCK_FACTOR[density ?? 'medium']
  const area = Math.PI * radius * radius
  return Math.max(14, Math.min(220, Math.round(area * factor)))
}

/** The 2D map's own terrain label text: the name, plus the safe speed for an asteroid field. */
export function terrainLabelText(feature: Pick<Terrain, 'kind' | 'name' | 'safeSpeed'>): string {
  return feature.name + (feature.kind === 'asteroid-field' && feature.safeSpeed !== undefined ? ` · SPD ${feature.safeSpeed}` : '')
}

/** A deterministic jitter from a vertex's own original position, so duplicated vertices at a shared edge (`IcosahedronGeometry` is non-indexed) still land in the same place and the rock has no cracks. */
function positionHash(x: number, y: number, z: number): number {
  const kx = Math.round(x * 1000)
  const ky = Math.round(y * 1000)
  const kz = Math.round(z * 1000)
  let h = (kx * 374761393 + ky * 668265263 + kz * 69069) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** A handful of shared, pre-jittered rock shapes, reused by every asteroid field in the view. */
function buildRockGeometries(): BufferGeometry[] {
  const variants: BufferGeometry[] = []
  for (let v = 0; v < 3; v++) {
    const geo = v % 2 === 0 ? new IcosahedronGeometry(1, 0) : new DodecahedronGeometry(1, 0)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      const jitter = 0.68 + positionHash(x, y, z) * 0.6
      pos.setXYZ(i, x * jitter, y * jitter, z * jitter)
    }
    geo.computeVertexNormals()
    geo.userData.shared = true
    variants.push(geo)
  }
  return variants
}

const ROCK_GEOMETRIES = buildRockGeometries()
/** One material for every rock everywhere: instance colour carries the size/tone variety (InstancedMesh.setColorAt). */
const ROCK_MATERIAL = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0.06 })
ROCK_MATERIAL.userData.shared = true

/** A flat ring lying on the board, for a terrain footprint or a mission zone. */
function flatRing(radius: number, color: number, opacity: number, segments = 96): LineLoop {
  const points: number[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    points.push(Math.cos(a) * radius, FLOOR, Math.sin(a) * radius)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(points, 3))
  return new LineLoop(geo, new LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false }))
}

// ── Terrain entries ─────────────────────────────────────────────────────

interface WorldEntry {
  root: Group
  sphere: Mesh
  spin: number
}

interface RockInstance {
  mesh: InstancedMesh
  index: number
  position: Vector3
  scale: Vector3
  axis: Vector3
  rate: number
  quat: Quaternion
}

interface FieldEntry {
  root: Group
  meshes: InstancedMesh[]
  rocks: RockInstance[]
}

interface CloudEntry {
  root: Group
}

// ── Mission entries ──────────────────────────────────────────────────────

interface HoldEntry {
  root: Group
}

interface CargoEntry {
  root: Group
  mesh: Mesh
}

interface RescueEntry {
  root: Group
  beam: Mesh<CylinderGeometry, MeshBasicMaterial>
  pulse: Mesh<RingGeometry, MeshBasicMaterial>
  label: CSS2DObject
}

export class TerrainLayer implements Layer {
  readonly group = new Group()
  private features = new Group()
  private missions = new Group()

  private worlds = new Map<string, WorldEntry>()
  private fields = new Map<string, FieldEntry>()
  private clouds = new Map<string, CloudEntry>()
  private holds = new Map<string, HoldEntry>()
  private cargos = new Map<string, CargoEntry>()
  private rescues = new Map<string, RescueEntry>()

  // Reused every frame so tumbling asteroids allocate nothing.
  private tmpDelta = new Quaternion()
  private tmpMatrix = new Matrix4()

  constructor() {
    this.group.name = 'terrain'
    this.group.add(this.features, this.missions)
  }

  update({ game }: LayerContext): void {
    this.updateTerrain(game.scenario.terrain)
    this.updateMissions(game)
  }

  // ── Terrain (built once per id, never rebuilt) ─────────────────────────

  private updateTerrain(terrain: Terrain[]): void {
    const liveWorlds = new Set<string>()
    const liveFields = new Set<string>()
    const liveClouds = new Set<string>()
    for (const feature of terrain) {
      if (feature.kind === 'planet' || feature.kind === 'moon') {
        liveWorlds.add(feature.id)
        if (!this.worlds.has(feature.id)) this.worlds.set(feature.id, this.buildWorld(feature))
      } else if (feature.kind === 'asteroid-field') {
        liveFields.add(feature.id)
        if (!this.fields.has(feature.id)) this.fields.set(feature.id, this.buildField(feature))
      } else {
        liveClouds.add(feature.id)
        if (!this.clouds.has(feature.id)) this.clouds.set(feature.id, this.buildCloud(feature))
      }
    }
    this.prune(this.worlds, liveWorlds)
    this.prune(this.fields, liveFields)
    this.prune(this.clouds, liveClouds)
  }

  private prune<T extends { root: Group }>(map: Map<string, T>, live: Set<string>): void {
    for (const [id, entry] of map) {
      if (live.has(id)) continue
      this.features.remove(entry.root)
      disposeTree(entry.root)
      map.delete(id)
    }
  }

  /** A lit, procedurally-textured sphere whose radius is the rules circle (E2.3): it blocks line of sight for real. */
  private buildWorld(feature: Terrain): WorldEntry {
    const root = new Group()
    root.name = `terrain:${feature.id}`
    const at = toWorld(feature.center)
    root.position.set(at.x, 0, at.z)

    const seed = hashId(feature.id)
    const isPlanet = feature.kind === 'planet'
    const sphere = new Mesh(
      new SphereGeometry(feature.radius, 40, 26),
      new MeshStandardMaterial({
        map: worldTexture(seed, feature.kind as 'planet' | 'moon'),
        roughness: isPlanet ? 0.75 : 0.96,
        metalness: isPlanet ? 0.08 : 0.02,
      }),
    )
    sphere.name = 'body'
    root.add(sphere)

    if (isPlanet) {
      // Atmosphere: a soft additive halo, sunlit the same way the sphere
      // itself is (the scene's own upper-left sun) — cheap and consistent
      // with the codebase's other glows (hulls.ts's engine flares).
      const rng = new Rng((seed ^ 0x9a3) >>> 0)
      const tint = new Color().setHSL((rng.next() + 0.55) % 1, 0.55, 0.62).multiplyScalar(1.5)
      const halo = new Sprite(
        new SpriteMaterial({
          map: glowTexture(),
          color: tint,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: AdditiveBlending,
          toneMapped: false,
        }),
      )
      const size = feature.radius * 2.6
      halo.scale.set(size, size, size)
      root.add(halo)
    }

    const label = makeLabel(terrainLabelText(feature), 'l3d-terrain')
    label.position.set(0, feature.radius + 0.6, 0)
    root.add(label)
    setTooltip(root, feature.name)

    this.features.add(root)
    // A stable, slow spin — pure decoration, no rules meaning.
    const spin = 0.02 + (hashId(feature.id + 'spin') >>> 0) % 100 * 0.0006
    return { root, sphere, spin }
  }

  /** An InstancedMesh field of jittered rocks, sized and coloured to the printed density (K2.1.2). */
  private buildField(feature: Terrain): FieldEntry {
    const root = new Group()
    root.name = `terrain:${feature.id}`
    const at = toWorld(feature.center)
    root.position.set(at.x, 0, at.z)

    const rng = new Rng(hashId(feature.id) >>> 0)
    const total = rockCountFor(feature.radius, feature.density)
    const meshes: InstancedMesh[] = []
    const rocks: RockInstance[] = []

    const perVariant = ROCK_GEOMETRIES.map((_, i) => Math.floor(total / ROCK_GEOMETRIES.length) + (i < total % ROCK_GEOMETRIES.length ? 1 : 0))
    ROCK_GEOMETRIES.forEach((geo, vi) => {
      const count = perVariant[vi]
      if (count === 0) return
      const mesh = new InstancedMesh(geo, ROCK_MATERIAL, count)
      for (let i = 0; i < count; i++) {
        // Square-rooted radius so rocks spread evenly over the area (as MapView's own AsteroidScatter does).
        const d = Math.sqrt(rng.next()) * feature.radius * 0.94
        const a = rng.next() * Math.PI * 2
        const position = new Vector3(Math.cos(a) * d, 0.05 + rng.next() * Math.min(1.1, feature.radius * 0.14), Math.sin(a) * d)
        const size = feature.radius * (0.05 + rng.next() * 0.1)
        const scale = new Vector3(
          size * (0.75 + rng.next() * 0.5),
          size * (0.75 + rng.next() * 0.5),
          size * (0.75 + rng.next() * 0.5),
        )
        const quat = new Quaternion().random()
        this.tmpMatrix.compose(position, quat, scale)
        mesh.setMatrixAt(i, this.tmpMatrix)
        const tone = 0.8 + rng.next() * 0.35
        mesh.setColorAt(i, new Color(0.5 * tone, 0.42 * tone, 0.34 * tone))
        rocks.push({
          mesh,
          index: i,
          position,
          scale,
          axis: new Vector3(rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5).normalize(),
          rate: 0.12 + rng.next() * 0.3,
          quat,
        })
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      root.add(mesh)
      meshes.push(mesh)
    })

    const density = feature.density ?? 'medium'
    root.add(flatRing(feature.radius, DENSITY_COLOR[density], 0.55))

    const label = makeLabel(terrainLabelText(feature), 'l3d-terrain')
    label.position.set(0, feature.radius * 0.4 + 1, 0)
    root.add(label)

    const stats = feature.density ? DENSITY_STATS[feature.density] : undefined
    setTooltip(
      root,
      feature.safeSpeed !== undefined
        ? `${feature.name} — ${stats ? stats.label + ' density' : 'asteroid field'}\n` +
            `SPD ${feature.safeSpeed} · DMG ${feature.damageDie ?? '—'} die · ` +
            `CVR ${feature.cover ?? 0} · SCAN ${feature.scan ?? '—'}`
        : feature.name,
    )

    this.features.add(root)
    return { root, meshes, rocks }
  }

  /** A soft, greenish-teal billboard cloud (K5): several additive puffs plus a faint boundary ring. */
  private buildCloud(feature: Terrain): CloudEntry {
    const root = new Group()
    root.name = `terrain:${feature.id}`
    const at = toWorld(feature.center)
    root.position.set(at.x, 0, at.z)

    const rng = new Rng(hashId(feature.id) >>> 0)
    const puffCount = Math.max(6, Math.min(16, Math.round(feature.radius * 1.5)))
    for (let i = 0; i < puffCount; i++) {
      const sprite = new Sprite(
        new SpriteMaterial({
          map: cloudTexture(1 + ((hashId(feature.id) + i) % 5)),
          color: new Color(0x2fd9bd),
          transparent: true,
          opacity: 0.13 + rng.next() * 0.09,
          depthWrite: false,
          blending: AdditiveBlending,
          toneMapped: false,
        }),
      )
      const d = Math.sqrt(rng.next()) * feature.radius * 0.8
      const a = rng.next() * Math.PI * 2
      const size = feature.radius * (0.55 + rng.next() * 0.6)
      sprite.scale.set(size, size, 1)
      sprite.position.set(Math.cos(a) * d, 0.3 + rng.next() * 2.2, Math.sin(a) * d)
      root.add(sprite)
    }

    root.add(flatRing(feature.radius, 0x2fd9bd, 0.4))

    const label = makeLabel(terrainLabelText(feature), 'l3d-terrain')
    label.position.set(0, feature.radius * 0.35 + 1, 0)
    root.add(label)
    setTooltip(root, feature.scan !== undefined ? `${feature.name} — SCAN ${feature.scan}` : feature.name)

    this.features.add(root)
    return { root }
  }

  // ── Missions ──────────────────────────────────────────────────────────

  private updateMissions(game: GameState): void {
    const defs = game.scenario.missions ?? []
    const liveHold = new Set<string>()
    const liveCargo = new Set<string>()
    const liveRescue = new Set<string>()

    defs.forEach((def, i) => {
      const state: MissionState | undefined = game.missions[i]
      if (def.kind === 'hold') {
        liveHold.add(def.id)
        if (!this.holds.has(def.id)) this.holds.set(def.id, this.buildHold(def))
      } else if (def.kind === 'cargo') {
        liveCargo.add(def.id)
        let entry = this.cargos.get(def.id)
        if (!entry) {
          entry = this.buildCargo(def)
          this.cargos.set(def.id, entry)
        }
        this.updateCargo(entry, def, game, state)
      } else {
        liveRescue.add(def.id)
        let entry = this.rescues.get(def.id)
        if (!entry) {
          entry = this.buildRescue(def)
          this.rescues.set(def.id, entry)
        }
        this.updateRescue(entry, def, state)
      }
    })

    this.prune(this.holds, liveHold)
    this.prune(this.cargos, liveCargo)
    this.prune(this.rescues, liveRescue)
  }

  /** A hold zone (missions.ts 'hold'): a glowing disc and ring, worth points each round nobody else stands in it. */
  private buildHold(def: Extract<MissionDef, { kind: 'hold' }>): HoldEntry {
    const root = new Group()
    const at = toWorld(def.center)
    root.position.set(at.x, 0, at.z)

    const disc = new Mesh(
      new CircleGeometry(def.radius, 48),
      new MeshBasicMaterial({ color: 0x7ac7ff, transparent: true, opacity: 0.045, depthWrite: false, side: DoubleSide }),
    )
    disc.rotation.x = -Math.PI / 2
    disc.position.y = FLOOR
    const ring = new Mesh(
      new RingGeometry(def.radius - 0.08, def.radius, 96),
      new MeshBasicMaterial({ color: new Color(0x7ac7ff).multiplyScalar(1.6), transparent: true, opacity: 0.55, toneMapped: false, side: DoubleSide }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = FLOOR + 0.002

    const label = makeLabel(def.name, 'l3d-mission')
    label.position.set(0, FLOOR, -def.radius - 0.5)

    root.add(disc, ring, label)
    setTooltip(root, `${def.name} — hold alone at round's end for ${def.pointsPerRound} VP/round`)
    this.missions.add(root)
    return { root }
  }

  /** A cargo run (missions.ts 'cargo'): a rotating diamond that rides the ship carrying it, gone once delivered. */
  private buildCargo(def: Extract<MissionDef, { kind: 'cargo' }>): CargoEntry {
    const root = new Group()
    const mesh = new Mesh(
      new OctahedronGeometry(0.42, 0),
      new MeshStandardMaterial({ color: 0xffd65a, emissive: new Color(0xffb020).multiplyScalar(0.35), metalness: 0.35, roughness: 0.4 }),
    )
    mesh.position.y = 0.6
    const label = makeLabel(def.name, 'l3d-mission')
    label.position.set(0, 1.15, 0)
    root.add(mesh, label)
    this.missions.add(root)
    return { root, mesh }
  }

  private updateCargo(entry: CargoEntry, def: Extract<MissionDef, { kind: 'cargo' }>, game: GameState, state: MissionState | undefined): void {
    const carrier = state?.carrierId ? game.ships.find((s) => s.id === state.carrierId) : undefined
    const at = state?.position ?? carrier?.placement.position
    const delivered = state?.delivered ?? false
    entry.root.visible = !delivered && at !== undefined
    if (at) {
      const w = toWorld(at)
      entry.root.position.set(w.x, 0, w.z)
    }
    setTooltip(entry.root, `${def.name} — carry it off the map for ${def.points} VP${carrier ? ' (aboard)' : ''}`)
  }

  /** A beacon (missions.ts 'rescue'): souls waiting on a transporter pickup. */
  private buildRescue(def: Extract<MissionDef, { kind: 'rescue' }>): RescueEntry {
    const root = new Group()
    const at = toWorld(def.position)
    root.position.set(at.x, 0, at.z)
    const green = new Color(0x63ffb0)

    const beam = new Mesh(
      new CylinderGeometry(0.07, 0.07, 3, 8),
      new MeshBasicMaterial({ color: green.clone().multiplyScalar(2), transparent: true, opacity: 0.5, toneMapped: false, blending: AdditiveBlending, depthWrite: false }),
    )
    beam.position.y = 1.5
    const pulse = new Mesh(
      new RingGeometry(0.3, 0.4, 32),
      new MeshBasicMaterial({ color: green.clone().multiplyScalar(1.6), transparent: true, opacity: 0.6, toneMapped: false, side: DoubleSide }),
    )
    pulse.rotation.x = -Math.PI / 2
    pulse.position.y = FLOOR

    const label = makeLabel(def.name, 'l3d-mission')
    label.position.set(0, 1, 0)

    root.add(beam, pulse, label)
    this.missions.add(root)
    return { root, beam, pulse, label }
  }

  private updateRescue(entry: RescueEntry, def: Extract<MissionDef, { kind: 'rescue' }>, state: MissionState | undefined): void {
    const soulsLeft = state?.soulsLeft ?? def.souls
    entry.root.visible = soulsLeft > 0
    setLabel(entry.label, `${def.name} (${soulsLeft})`)
    setTooltip(entry.root, `${def.name} — ${soulsLeft} souls, ${def.pointsPerSoul} VP each by transporter`)
  }

  // ── Life ─────────────────────────────────────────────────────────────

  tick({ now, dt, reducedMotion }: FrameContext): void {
    if (reducedMotion) return
    for (const world of this.worlds.values()) world.sphere.rotation.y += dt * world.spin
    for (const field of this.fields.values()) this.tumbleField(field, dt)
    for (const cargo of this.cargos.values()) cargo.mesh.rotation.y += dt * 0.6
    for (const rescue of this.rescues.values()) this.pulseRescue(rescue, now)
  }

  private tumbleField(field: FieldEntry, dt: number): void {
    for (const rock of field.rocks) {
      this.tmpDelta.setFromAxisAngle(rock.axis, rock.rate * dt)
      rock.quat.premultiply(this.tmpDelta)
      this.tmpMatrix.compose(rock.position, rock.quat, rock.scale)
      rock.mesh.setMatrixAt(rock.index, this.tmpMatrix)
    }
    for (const mesh of field.meshes) mesh.instanceMatrix.needsUpdate = true
  }

  private pulseRescue(entry: RescueEntry, now: number): void {
    const t = (now / 1400) % 1
    entry.pulse.material.opacity = 0.6 * (1 - t)
    const s = 1 + t * 3.2
    entry.pulse.scale.set(s, s, 1)
    entry.beam.material.opacity = 0.4 + Math.sin(now / 480) * 0.15
  }

  dispose(): void {
    disposeTree(this.group)
    this.worlds.clear()
    this.fields.clear()
    this.clouds.clear()
    this.holds.clear()
    this.cargos.clear()
    this.rescues.clear()
  }
}
