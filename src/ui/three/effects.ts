/**
 * Weapon fire and damage flashes, from the same `BattleFx` stream the 2D map
 * draws (see `../fx.ts` — every effect is a pure reading of an already-
 * journaled action, so the same fire renders for the local player, the AI,
 * a remote opponent and a replay, all from the one derivation).
 *
 * Each `BattleFx` carries an id and a `delay` in milliseconds after the
 * batch that produced it lands; this layer spawns an object for an id the
 * moment it first sees it, in `update`, then animates and finally disposes
 * it once its own clock — started at `update`'s `now` plus its delay — runs
 * out, entirely inside `tick`. Ids are remembered forever so a still-visible
 * volley never respawns while it scrubs past in a replay.
 *
 * A volley can be ten to twenty shots and impacts at once, so nothing here
 * compiles a new shader per instance: every shape (the beam's unit
 * cylinder, the projectile's cone, the fireball's sprite, a spark's point)
 * is one shared `BufferGeometry`, and only the handful of cheap
 * `MeshBasicMaterial`/`PointsMaterial` wrappers that need their own fade are
 * cloned from a shared template.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Points,
  PointsMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three'
import type { BattleFx, WeaponFx } from '../fx'
import { disposeTree, type FrameContext, type Layer, type LayerContext } from './layer'
import { HULL_ALTITUDE, WEAPON_COLOR, toWorld } from './space'
import { glowTexture } from './textures'

/** How long a travelling shot takes to cross the board — fx.ts's own TRAVEL, so a beam's or torpedo's flight lands exactly when its impact flashes. */
const SHOT_DURATION = 380
/** How long an impact's burst plays before it is gone. Comfortably under the 1.2s the brief allows. */
const IMPACT_DURATION = 620
/** A reduced-motion shot is a flash at the target rather than a race across the board. */
const REDUCED_SHOT_DURATION = 220
const REDUCED_IMPACT_DURATION = 260

/** At most this many hull impacts may be lighting the scene at once — a point light is the one part of this layer that is not free. */
const MAX_LIVE_LIGHTS = 4

const UP = new Vector3(0, 1, 0)
const scratchA = new Vector3()
const scratchB = new Vector3()

/** Point, position and stretch a unit-cylinder mesh so it spans `from`→`to`. */
function orientBetween(mesh: Mesh, from: Vector3, to: Vector3, radius: number): void {
  scratchA.subVectors(to, from)
  const len = Math.max(0.001, scratchA.length())
  mesh.position.copy(from).addScaledVector(scratchA, 0.5)
  mesh.scale.set(radius, len, radius)
  scratchA.normalize()
  mesh.quaternion.setFromUnitVectors(UP, scratchA)
}

// ---------------------------------------------------------------------------
// Shared geometry
// ---------------------------------------------------------------------------

/** A unit cylinder along +Y — every beam and every torpedo trail is this, stretched. */
function beamGeometry(): CylinderGeometry {
  const geo = new CylinderGeometry(1, 1, 1, 7, 1, true)
  geo.userData.shared = true
  return geo
}

/** A short tapered blade, tip at the origin, base trailing toward +z — a torpedo's wake. */
function trailGeometry(): BufferGeometry {
  const shape = new Shape()
  shape.moveTo(0.05, 0)
  shape.lineTo(-0.05, 0)
  shape.lineTo(0, -0.55)
  shape.closePath()
  const geo = new ShapeGeometry(shape)
  geo.rotateX(-Math.PI / 2)
  geo.userData.shared = true
  return geo
}

// A torpedo's own projectile — module-scoped like textures.ts's cached
// textures, so it outlives any one BattleScene and is never disposed here.
const projectileGeo = (() => {
  const geo = new ConeGeometry(0.07, 0.3, 8)
  geo.rotateX(-Math.PI / 2)
  geo.userData.shared = true
  return geo
})()

/** How wide a beam reads, by weapon — a torpedo has no beam, so it is unused for that key. */
const BEAM_RADIUS: Record<WeaponFx, number> = { phaser: 0.022, disruptor: 0.024, generic: 0.018, torpedo: 0.03 }

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

interface ShotEntry {
  id: number
  kind: 'shot'
  start: number
  duration: number
  reduced: boolean
  weapon: WeaponFx
  from: Vector3
  to: Vector3
  root: Group
  beam: Mesh | null
  projectile: Mesh | null
  glow: Sprite | null
  trail: Mesh | null
}

// ---------------------------------------------------------------------------
// Impacts
// ---------------------------------------------------------------------------

interface SparkBurst {
  points: Points<BufferGeometry, PointsMaterial>
  /** The same typed array backing the geometry's position attribute — mutated in place, then flagged `needsUpdate`. */
  positions: Float32Array
  velocities: Float32Array
}

interface ImpactEntry {
  id: number
  kind: 'impact'
  start: number
  duration: number
  reduced: boolean
  impact: 'shield' | 'hull'
  root: Group
  bubble: Mesh | null
  fireball: Sprite | null
  sparks: SparkBurst | null
  light: PointLight | null
}

type FxEntry = ShotEntry | ImpactEntry

export class EffectsLayer implements Layer {
  readonly group = new Group()
  private seen = new Set<number>()
  private active: FxEntry[] = []
  private reducedMotion = false
  private liveLights = 0

  // Shared geometry.
  private beamGeo = beamGeometry()
  private trailGeo = trailGeometry()
  private shieldGeo = new SphereGeometry(1, 20, 14)

  // One template material per weapon/impact kind; cloned per instance so
  // each fx can fade on its own clock without minting a new shader.
  private beamTemplates = new Map<WeaponFx, MeshBasicMaterial>()
  private glowTemplate: SpriteMaterial
  private trailTemplate: MeshBasicMaterial
  private shieldTemplate: MeshBasicMaterial
  private fireballTemplate: SpriteMaterial
  private sparkTemplate: PointsMaterial

  constructor() {
    this.group.name = 'effects'
    this.beamGeo.userData.shared = true
    this.trailGeo.userData.shared = true
    this.shieldGeo.userData.shared = true

    for (const weapon of Object.keys(WEAPON_COLOR) as WeaponFx[]) {
      const mat = new MeshBasicMaterial({
        color: new Color(WEAPON_COLOR[weapon]).multiplyScalar(1.25),
        transparent: true,
        opacity: 0,
        toneMapped: false,
        depthWrite: false,
        blending: AdditiveBlending,
      })
      this.beamTemplates.set(weapon, mat)
    }

    this.glowTemplate = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0xffe3b0).multiplyScalar(1.3),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    this.trailTemplate = new MeshBasicMaterial({
      color: new Color(0xffcf8a).multiplyScalar(1.1),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      toneMapped: false,
      blending: AdditiveBlending,
    })
    this.shieldTemplate = new MeshBasicMaterial({
      color: new Color(0x9fd8ff).multiplyScalar(1.3),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      blending: AdditiveBlending,
    })
    this.fireballTemplate = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0xffb060).multiplyScalar(1.6),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    this.sparkTemplate = new PointsMaterial({
      size: 0.05,
      color: new Color(0xffd9a0).multiplyScalar(1.4),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    })
  }

  update({ view, now }: LayerContext): void {
    for (const fx of view.fx) {
      if (this.seen.has(fx.id)) continue
      this.seen.add(fx.id)
      const start = now + fx.delay
      if (fx.kind === 'shot') this.spawnShot(fx, start)
      else this.spawnImpact(fx, start)
    }
  }

  tick(frame: FrameContext): void {
    this.reducedMotion = frame.reducedMotion
    for (let i = this.active.length - 1; i >= 0; i--) {
      const entry = this.active[i]
      const elapsed = frame.now - entry.start
      if (elapsed < 0) {
        entry.root.visible = false
        continue
      }
      if (elapsed >= entry.duration) {
        this.retire(entry)
        this.active.splice(i, 1)
        continue
      }
      entry.root.visible = true
      const t = elapsed / entry.duration
      if (entry.kind === 'shot') this.animateShot(entry, t, frame)
      else this.animateImpact(entry, t, frame)
    }
  }

  // ── Shots ────────────────────────────────────────────────────────────────

  private spawnShot(fx: Extract<BattleFx, { kind: 'shot' }>, start: number): void {
    const from = toWorld(fx.from, HULL_ALTITUDE)
    const to = toWorld(fx.to, HULL_ALTITUDE)
    const root = new Group()
    const reduced = this.reducedMotion
    const duration = reduced ? REDUCED_SHOT_DURATION : SHOT_DURATION

    if (fx.weapon === 'torpedo') {
      // A projectile is lit the same warm way as its glow sprite, not a
      // physically-shaded solid — it is meant to read as pure energy.
      const flame = new MeshBasicMaterial({
        color: new Color(0xffcf8a).multiplyScalar(1.25),
        transparent: true,
        toneMapped: false,
      })
      const projectile = new Mesh(projectileGeo, flame)
      const material = this.trailTemplate.clone()
      const glow = new Sprite(this.glowTemplate.clone())
      glow.scale.setScalar(0.34)
      const trail = new Mesh(this.trailGeo, material)
      trail.scale.set(1, 1, 1.1)
      root.add(projectile, glow, trail)
      this.group.add(root)
      this.active.push({
        id: fx.id,
        kind: 'shot',
        start,
        duration,
        reduced,
        weapon: fx.weapon,
        from,
        to,
        root,
        beam: null,
        projectile,
        glow,
        trail,
      })
      return
    }

    const template = this.beamTemplates.get(fx.weapon) ?? this.beamTemplates.get('generic')!
    const beam = new Mesh(this.beamGeo, template.clone())
    root.add(beam)
    this.group.add(root)
    this.active.push({
      id: fx.id,
      kind: 'shot',
      start,
      duration,
      reduced,
      weapon: fx.weapon,
      from,
      to,
      root,
      beam,
      projectile: null,
      glow: null,
      trail: null,
    })
  }

  private animateShot(s: ShotEntry, t: number, frame: FrameContext): void {
    if (s.weapon === 'torpedo') {
      const at = s.reduced ? scratchB.copy(s.to) : scratchB.lerpVectors(s.from, s.to, t)
      s.root.position.copy(at)
      const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3
      const flame = s.projectile!.material as MeshBasicMaterial
      flame.opacity = fade
      const pulse = 0.85 + 0.25 * Math.sin(frame.now / 55)
      s.projectile!.scale.setScalar((s.reduced ? 1 : pulse) * fade)
      s.glow!.material.opacity = 0.8 * fade
      s.glow!.scale.setScalar(0.34 * (s.reduced ? 1 : pulse))
      const trailMat = s.trail!.material as MeshBasicMaterial
      if (!s.reduced) {
        const yaw = Math.atan2(s.to.x - s.from.x, s.from.z - s.to.z)
        s.root.rotation.y = yaw
        trailMat.opacity = 0.5 * fade * Math.min(1, t * 6)
      } else {
        trailMat.opacity = 0
      }
      return
    }

    // A beam races out, holds at full length, then fades — or, reduced
    // motion, simply appears at full length and fades: a flash, not a flight.
    const RACE = s.reduced ? 0 : 0.32
    const FADE_FROM = s.reduced ? 0.35 : 0.62
    const raceT = RACE > 0 ? Math.min(1, t / RACE) : 1
    scratchB.lerpVectors(s.from, s.to, raceT)
    orientBetween(s.beam!, s.from, scratchB, BEAM_RADIUS[s.weapon])
    const fade = t <= FADE_FROM ? 1 : Math.max(0, 1 - (t - FADE_FROM) / (1 - FADE_FROM))
    const mat = s.beam!.material as MeshBasicMaterial
    const pulse = s.weapon === 'disruptor' && !s.reduced ? 0.55 + 0.45 * Math.abs(Math.sin(frame.now / 60)) : 1
    mat.opacity = 0.7 * fade * pulse
  }

  // ── Impacts ──────────────────────────────────────────────────────────────

  private spawnImpact(fx: Extract<BattleFx, { kind: 'impact' }>, start: number): void {
    const at = toWorld(fx.at, HULL_ALTITUDE)
    const root = new Group()
    root.position.copy(at)
    const reduced = this.reducedMotion
    const duration = reduced ? REDUCED_IMPACT_DURATION : IMPACT_DURATION

    if (fx.impact === 'shield') {
      const bubble = new Mesh(this.shieldGeo, this.shieldTemplate.clone())
      bubble.scale.setScalar(0.24)
      root.add(bubble)
      this.group.add(root)
      this.active.push({
        id: fx.id,
        kind: 'impact',
        start,
        duration,
        reduced,
        impact: 'shield',
        root,
        bubble,
        fireball: null,
        sparks: null,
        light: null,
      })
      return
    }

    const fireball = new Sprite(this.fireballTemplate.clone())
    fireball.scale.setScalar(0.2)
    root.add(fireball)

    const sparks = this.buildSparks()
    root.add(sparks.points)

    let light: PointLight | null = null
    if (this.liveLights < MAX_LIVE_LIGHTS) {
      light = new PointLight(0xffb060, 0, 6, 2)
      root.add(light)
      this.liveLights++
    }

    this.group.add(root)
    this.active.push({
      id: fx.id,
      kind: 'impact',
      start,
      duration,
      reduced,
      impact: 'hull',
      root,
      bubble: null,
      fireball,
      sparks,
      light,
    })
  }

  private buildSparks(count = 12): SparkBurst {
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const speed = 0.9 + Math.random() * 1.6
      velocities[i * 3] = Math.cos(a) * speed
      velocities[i * 3 + 1] = (Math.random() - 0.3) * speed * 0.6
      velocities[i * 3 + 2] = Math.sin(a) * speed
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    const points = new Points(geo, this.sparkTemplate.clone())
    return { points, positions, velocities }
  }

  private animateImpact(e: ImpactEntry, t: number, frame: FrameContext): void {
    if (e.impact === 'shield') {
      // A bubble that blooms outward and thins as it goes — the screens took
      // it, so nothing punches through.
      const grow = e.reduced ? 1 : 0.35 + 0.65 * Math.min(1, t / 0.35)
      e.bubble!.scale.setScalar(0.24 + grow * 0.24)
      const fade = e.reduced ? 1 - t : Math.max(0, 1 - Math.max(0, t - 0.25) / 0.75)
      const mat = e.bubble!.material as MeshBasicMaterial
      mat.opacity = 0.38 * fade
      return
    }

    // Hull: a bright flash that blooms then a lingering ember, sparks flying
    // out on their own paths, and — budget allowing — a brief flicker of
    // light on the hull nearby.
    const bloom = e.reduced ? 1 : Math.min(1, t / 0.12)
    const decay = Math.max(0, 1 - Math.max(0, t - 0.12) / 0.88)
    const size = 0.16 + bloom * 0.5 * (1 - t * 0.4)
    e.fireball!.scale.setScalar(size)
    const fmat = e.fireball!.material as SpriteMaterial
    fmat.opacity = bloom * decay

    if (e.sparks) {
      if (!e.reduced) {
        const dt = frame.dt
        const pos = e.sparks.positions
        const vel = e.sparks.velocities
        for (let i = 0; i < vel.length; i += 3) {
          pos[i] += vel[i] * dt
          pos[i + 1] += vel[i + 1] * dt
          pos[i + 2] += vel[i + 2] * dt
          vel[i + 1] -= dt * 1.4 // a little gravity, so the burst settles rather than floating forever
        }
        e.sparks.points.geometry.attributes.position.needsUpdate = true
      }
      const smat = e.sparks.points.material
      smat.opacity = e.reduced ? 0 : Math.max(0, 1 - t * 1.3)
    }

    if (e.light) {
      e.light.intensity = e.reduced ? 0 : Math.max(0, 3.2 * (1 - t * 1.6))
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  private retire(entry: FxEntry): void {
    this.group.remove(entry.root)
    if (entry.kind === 'impact' && entry.light) this.liveLights--
    disposeTree(entry.root)
  }

  dispose(): void {
    for (const entry of this.active) disposeTree(entry.root)
    this.active = []
    this.liveLights = 0
    disposeTree(this.group)
    this.beamGeo.dispose()
    this.trailGeo.dispose()
    this.shieldGeo.dispose()
    for (const m of this.beamTemplates.values()) m.dispose()
    this.glowTemplate.dispose()
    this.trailTemplate.dispose()
    this.shieldTemplate.dispose()
    this.fireballTemplate.dispose()
    this.sparkTemplate.dispose()
  }
}
