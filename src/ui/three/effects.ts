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
 * cylinder, the projectile's cone, the fireball's sprite, a spark's point,
 * the shield's shell) is one shared `BufferGeometry`, and every material —
 * even the shield's `ShaderMaterial` — is a handful of templates built once
 * and cloned per instance, which shares the compiled program and only pays
 * for a fresh uniforms/parameters object.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Points,
  PointsMaterial,
  RingGeometry,
  ShaderMaterial,
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
import { cloudTexture, flareTexture, glowTexture } from './textures'

/** How long a travelling shot takes to cross the board — fx.ts's own TRAVEL, so a beam's or torpedo's flight lands exactly when its impact flashes. */
const SHOT_DURATION = 380
/** How long an impact's burst plays before it is gone. Comfortably under the 1.2s the brief allows. */
const IMPACT_DURATION = 620
/** A reduced-motion shot is a flash at the target rather than a race across the board. */
const REDUCED_SHOT_DURATION = 220
const REDUCED_IMPACT_DURATION = 260

/** At most this many hull impacts may be lighting the scene at once — a point light is the one part of this layer that is not free. */
const MAX_LIVE_LIGHTS = 3

const UP = new Vector3(0, 1, 0)
const scratchA = new Vector3()
const scratchB = new Vector3()
const scratchRight = new Vector3()
const scratchUp = new Vector3()

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

/** A unit cylinder along +Y — every beam, its white-hot core, and every torpedo trail is this, stretched. */
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

/** A flat ring, unit outer radius — a hull impact's shockwave, laid on the deck and scaled up. */
function shockGeometry(): RingGeometry {
  const geo = new RingGeometry(0.55, 1, 28)
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

/** How wide a beam's coloured sheath reads, by weapon — a torpedo has no beam, so it is unused for that key. */
const BEAM_RADIUS: Record<WeaponFx, number> = { phaser: 0.022, disruptor: 0.024, generic: 0.018, torpedo: 0.03 }
/** The white-hot core inside the sheath is always a slim fraction of it — the coloured glow is the sleeve, not the filament. */
const CORE_FRACTION = 0.3

// ---------------------------------------------------------------------------
// Shield ripple shader
// ---------------------------------------------------------------------------

/**
 * The energy ripple on a shield hit: a hex lattice laid tangent to a pole —
 * `uDir` — that only lights up behind a ring sweeping outward from it as
 * `uProgress` runs 0→1, plus a fresnel rim so the shell still reads as a
 * shape and not a flat decal. `fx.ts` carries no surface normal for an
 * impact, so the pole is picked per hit (see `spawnImpact`) rather than
 * derived from the shot that caused it — a volley's hits still ripple from
 * different angles instead of all lighting the same seam.
 */
function shieldRippleMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(0x9fe0ff) },
      uDir: { value: new Vector3(0, 0, 1) },
      uRight: { value: new Vector3(1, 0, 0) },
      uUp: { value: new Vector3(0, 1, 0) },
      uProgress: { value: 0 },
      uOpacity: { value: 0 },
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
      uniform vec3 uColor;
      uniform vec3 uDir;
      uniform vec3 uRight;
      uniform vec3 uUp;
      uniform float uProgress;
      uniform float uOpacity;
      uniform float uTime;
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec3 vView;

      // Two rectangular lattices, offset by half a cell, interleave into a
      // true hexagon tiling: hexOffset picks the nearer cell's centre and
      // returns the offset from it, so both the cell id (for a flicker) and
      // the distance to its border (hexEdge) fall out of the same point.
      vec2 hexOffset(vec2 p) {
        vec2 r = vec2(1.0, 1.7320508);
        vec2 h = r * 0.5;
        vec2 a = mod(p, r) - h;
        vec2 b = mod(p - h, r) - h;
        return dot(a, a) < dot(b, b) ? a : b;
      }
      float hexEdge(vec2 gv) {
        vec2 p = abs(gv);
        return 0.5 - max(dot(p, vec2(0.5, 0.8660254)), p.x);
      }
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
      }

      void main() {
        vec3 n = normalize(vPos);
        float along = clamp(dot(n, uDir), -1.0, 1.0);
        float ang = acos(along);

        // Project onto the tangent plane at the pole for the hex lattice.
        vec2 tangentUv = vec2(dot(n, uRight), dot(n, uUp)) * 7.0;
        vec2 gv = hexOffset(tangentUv);
        vec2 id = tangentUv - gv;
        float edge = smoothstep(0.0, 0.05, hexEdge(gv));
        float cellPulse = 0.4 + 0.6 * sin(uTime * 3.1 + hash(id) * 6.283);
        // Light lives on the lattice lines; the cells themselves stay nearly
        // clear, or the struck ship vanishes behind a milky ball.
        float hexGlow = (1.0 - edge) * 1.3 + edge * cellPulse * 0.07;

        // A band of charged hex cells sweeping outward from the pole; cells
        // the wave has not reached yet stay dark.
        float bandCenter = uProgress * 2.3;
        float ring = 1.0 - smoothstep(0.0, 0.55, abs(ang - bandCenter));
        float behind = 1.0 - smoothstep(bandCenter, bandCenter + 0.06, ang);
        float rim = pow(1.0 - max(dot(n, vView), 0.0), 2.2);

        float energy = hexGlow * (0.06 + ring * 1.8) * behind;
        vec3 col = uColor * energy + uColor * rim * 0.45;
        float alpha = uOpacity * clamp(energy * 0.85 + rim * 0.22, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })
}

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
  muzzle: Sprite | null
  // Beams.
  sheath: Mesh | null
  core: Mesh | null
  tip: Sprite | null
  // Torpedoes.
  projectile: Mesh | null
  hot: Sprite | null
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

interface SmokePuff {
  sprite: Sprite
  vx: number
  vy: number
  vz: number
}

interface ImpactEntry {
  id: number
  kind: 'impact'
  start: number
  duration: number
  reduced: boolean
  impact: 'shield' | 'hull'
  root: Group
  // Shield.
  bubble: Mesh | null
  flare: Sprite | null
  // Hull.
  fireball: Sprite | null
  core: Sprite | null
  shock: Mesh | null
  sparks: SparkBurst | null
  smoke: SmokePuff[] | null
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
  private shockGeo = shockGeometry()

  // One template material per weapon/impact kind; cloned per instance so
  // each fx can fade, pulse and flicker on its own clock without minting a
  // new shader (a `ShaderMaterial` clone shares the compiled program too —
  // `Material.clone` deep-copies only the uniforms).
  private sheathTemplates = new Map<WeaponFx, MeshBasicMaterial>()
  private coreTemplate: MeshBasicMaterial
  private muzzleTemplates = new Map<WeaponFx, SpriteMaterial>()
  private tipTemplates = new Map<WeaponFx, SpriteMaterial>()
  private glowTemplate: SpriteMaterial
  private trailTemplate: MeshBasicMaterial
  private shieldRippleTemplate: ShaderMaterial
  private shieldFlareTemplate: SpriteMaterial
  private fireballTemplate: SpriteMaterial
  private hullCoreTemplate: SpriteMaterial
  private shockTemplate: MeshBasicMaterial
  private smokeTemplate: SpriteMaterial
  private sparkTemplate: PointsMaterial

  constructor() {
    this.group.name = 'effects'
    this.beamGeo.userData.shared = true
    this.trailGeo.userData.shared = true
    this.shieldGeo.userData.shared = true
    this.shockGeo.userData.shared = true

    for (const weapon of Object.keys(WEAPON_COLOR) as WeaponFx[]) {
      const tint = new Color(WEAPON_COLOR[weapon])
      this.sheathTemplates.set(
        weapon,
        new MeshBasicMaterial({
          color: tint.clone().multiplyScalar(1.7),
          transparent: true,
          opacity: 0,
          toneMapped: false,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      )
      this.muzzleTemplates.set(
        weapon,
        new SpriteMaterial({
          map: flareTexture(),
          color: tint.clone().lerp(new Color(0xffffff), 0.35).multiplyScalar(2.4),
          blending: AdditiveBlending,
          depthWrite: false,
          transparent: true,
          toneMapped: false,
          opacity: 0,
        }),
      )
      this.tipTemplates.set(
        weapon,
        new SpriteMaterial({
          map: glowTexture(),
          color: tint.clone().lerp(new Color(0xffffff), 0.65).multiplyScalar(1.9),
          blending: AdditiveBlending,
          depthWrite: false,
          transparent: true,
          toneMapped: false,
          opacity: 0,
        }),
      )
    }

    // The filament every beam shares, regardless of weapon colour: a beam is
    // a white-hot core inside a coloured glow sheath, not a coloured rod.
    this.coreTemplate = new MeshBasicMaterial({
      color: new Color(0xffffff).multiplyScalar(1.7),
      transparent: true,
      opacity: 0,
      toneMapped: false,
      depthWrite: false,
      blending: AdditiveBlending,
    })

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
    this.shieldRippleTemplate = shieldRippleMaterial()
    this.shieldFlareTemplate = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0xd8f0ff).multiplyScalar(2.2),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
      opacity: 0,
    })
    this.fireballTemplate = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0xffb060).multiplyScalar(1.6),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    this.hullCoreTemplate = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0xfff3d6).multiplyScalar(2.4),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    this.shockTemplate = new MeshBasicMaterial({
      color: new Color(0xffc98a).multiplyScalar(1.4),
      transparent: true,
      opacity: 0,
      toneMapped: false,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    this.smokeTemplate = new SpriteMaterial({
      map: cloudTexture(1),
      color: new Color(0x2a2a30),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: true,
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

    // Every shot pops off with a muzzle flash at the firing end — a single
    // bright frame, kept even in reduced motion since it costs no travel.
    const muzzleTemplate = this.muzzleTemplates.get(fx.weapon) ?? this.muzzleTemplates.get('generic')!
    const muzzle = new Sprite(muzzleTemplate.clone())
    muzzle.position.copy(from)
    root.add(muzzle)

    if (fx.weapon === 'torpedo') {
      // A projectile is lit the same warm way as its glow sprite, not a
      // physically-shaded solid — it is meant to read as pure energy — with
      // a small white-hot pinpoint riding inside it, the same filament idea
      // as a beam's core.
      const flame = new MeshBasicMaterial({
        color: new Color(0xffcf8a).multiplyScalar(1.25),
        transparent: true,
        toneMapped: false,
      })
      const projectile = new Mesh(projectileGeo, flame)
      const hot = new Sprite((this.tipTemplates.get('torpedo') ?? this.tipTemplates.get('generic')!).clone())
      hot.scale.setScalar(0.12)
      const material = this.trailTemplate.clone()
      const glow = new Sprite(this.glowTemplate.clone())
      glow.scale.setScalar(0.34)
      const trail = new Mesh(this.trailGeo, material)
      trail.scale.set(1, 1, 1.1)
      root.add(projectile, hot, glow, trail)
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
        muzzle,
        sheath: null,
        core: null,
        tip: null,
        projectile,
        hot,
        glow,
        trail,
      })
      return
    }

    const sheath = new Mesh(this.beamGeo, (this.sheathTemplates.get(fx.weapon) ?? this.sheathTemplates.get('generic')!).clone())
    const core = new Mesh(this.beamGeo, this.coreTemplate.clone())
    root.add(sheath, core)
    // The hot tip only exists while the beam is racing out; reduced motion
    // skips the race entirely, so there is nothing for it to lead.
    let tip: Sprite | null = null
    if (!reduced) {
      tip = new Sprite((this.tipTemplates.get(fx.weapon) ?? this.tipTemplates.get('generic')!).clone())
      root.add(tip)
    }
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
      muzzle,
      sheath,
      core,
      tip,
      projectile: null,
      hot: null,
      glow: null,
      trail: null,
    })
  }

  private animateShot(s: ShotEntry, t: number, frame: FrameContext): void {
    // The muzzle flash: a hard pop that is gone well before the shot lands.
    if (s.muzzle) {
      const mt = Math.min(1, t / (s.reduced ? 0.45 : 0.16))
      const mfade = (1 - mt) ** 2
      s.muzzle.material.opacity = mfade
      s.muzzle.scale.setScalar(0.1 + 0.22 * (1 - mfade * 0.5))
    }

    if (s.weapon === 'torpedo') {
      const at = s.reduced ? scratchB.copy(s.to) : scratchB.lerpVectors(s.from, s.to, t)
      s.root.position.copy(at)
      const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3
      const flame = s.projectile!.material as MeshBasicMaterial
      flame.opacity = fade
      const pulse = 0.85 + 0.25 * Math.sin(frame.now / 55)
      s.projectile!.scale.setScalar((s.reduced ? 1 : pulse) * fade)
      s.hot!.material.opacity = 0.85 * fade
      s.hot!.scale.setScalar(0.1 * (s.reduced ? 1 : pulse))
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

    // A beam races out, holds at full length, then fades in a last flicker —
    // or, reduced motion, simply appears at full length and fades: a flash,
    // not a flight.
    const RACE = s.reduced ? 0 : 0.32
    const FADE_FROM = s.reduced ? 0.35 : 0.62
    const raceT = RACE > 0 ? Math.min(1, t / RACE) : 1
    scratchB.lerpVectors(s.from, s.to, raceT)
    orientBetween(s.sheath!, s.from, scratchB, BEAM_RADIUS[s.weapon])
    orientBetween(s.core!, s.from, scratchB, BEAM_RADIUS[s.weapon] * CORE_FRACTION)
    const fade = t <= FADE_FROM ? 1 : Math.max(0, 1 - (t - FADE_FROM) / (1 - FADE_FROM))
    // A dying beam flickers rather than fading smoothly; a live one only
    // does, by weapon, for the "pulsed generic white-blue" and the
    // disruptor's harsher chatter — a phaser stays a clean, steady beam.
    const dying = fade < 1 && !s.reduced ? 0.78 + 0.22 * Math.sin(frame.now / 24) : 1
    const pulse = s.reduced
      ? 1
      : s.weapon === 'disruptor'
        ? 0.55 + 0.45 * Math.abs(Math.sin(frame.now / 60))
        : s.weapon === 'generic'
          ? 0.62 + 0.38 * Math.abs(Math.sin(frame.now / 85))
          : 1
    const sheathMat = s.sheath!.material as MeshBasicMaterial
    sheathMat.opacity = 0.7 * fade * pulse * dying
    const coreMat = s.core!.material as MeshBasicMaterial
    coreMat.opacity = 0.95 * fade * dying

    if (s.tip) {
      if (raceT < 1) {
        s.tip.visible = true
        s.tip.position.copy(scratchB)
        s.tip.scale.setScalar(0.16 * (0.8 + 0.3 * Math.sin(frame.now / 40)))
        s.tip.material.opacity = 0.9
      } else {
        s.tip.visible = false
      }
    }
  }

  // ── Impacts ──────────────────────────────────────────────────────────────

  private spawnImpact(fx: Extract<BattleFx, { kind: 'impact' }>, start: number): void {
    const at = toWorld(fx.at, HULL_ALTITUDE)
    const root = new Group()
    root.position.copy(at)
    const reduced = this.reducedMotion
    const duration = reduced ? REDUCED_IMPACT_DURATION : IMPACT_DURATION

    if (fx.impact === 'shield') {
      const mat = this.shieldRippleTemplate.clone()
      // `fx.ts` gives an impact only a point, no surface normal, so the
      // ripple's pole is picked per hit — a volley's hits then sweep from
      // different angles instead of all lighting the same seam.
      const dir = scratchA.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().clone()
      const helper = Math.abs(dir.y) < 0.9 ? UP : scratchRight.set(1, 0, 0)
      const right = scratchRight.crossVectors(helper, dir).normalize().clone()
      const up = scratchUp.crossVectors(dir, right).normalize().clone()
      mat.uniforms.uDir.value.copy(dir)
      mat.uniforms.uRight.value.copy(right)
      mat.uniforms.uUp.value.copy(up)
      const bubble = new Mesh(this.shieldGeo, mat)
      bubble.scale.set(0.22, 0.18, 0.22)
      root.add(bubble)
      const flare = new Sprite(this.shieldFlareTemplate.clone())
      root.add(flare)
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
        flare,
        fireball: null,
        core: null,
        shock: null,
        sparks: null,
        smoke: null,
        light: null,
      })
      return
    }

    const fireball = new Sprite(this.fireballTemplate.clone())
    root.add(fireball)
    const core = new Sprite(this.hullCoreTemplate.clone())
    root.add(core)

    const shock = new Mesh(this.shockGeo, this.shockTemplate.clone())
    shock.rotation.x = -Math.PI / 2
    shock.scale.setScalar(0.001)
    root.add(shock)

    const sparks = this.buildSparks()
    root.add(sparks.points)

    const smoke = this.buildSmoke()
    for (const puff of smoke) root.add(puff.sprite)

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
      flare: null,
      fireball,
      core,
      shock,
      sparks,
      smoke,
      light,
    })
  }

  private buildSparks(count = 16): SparkBurst {
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const speed = 1.1 + Math.random() * 1.9
      velocities[i * 3] = Math.cos(a) * speed
      velocities[i * 3 + 1] = (Math.random() - 0.15) * speed * 0.7
      velocities[i * 3 + 2] = Math.sin(a) * speed
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    const points = new Points(geo, this.sparkTemplate.clone())
    return { points, positions, velocities }
  }

  /** A few soft puffs that drift up and out from a hull hit — not additive: smoke should darken the flash behind it, not add to it. */
  private buildSmoke(count = 3): SmokePuff[] {
    const puffs: SmokePuff[] = []
    for (let i = 0; i < count; i++) {
      const sprite = new Sprite(this.smokeTemplate.clone())
      sprite.position.set((Math.random() - 0.5) * 0.1, 0.02, (Math.random() - 0.5) * 0.1)
      puffs.push({
        sprite,
        vx: (Math.random() - 0.5) * 0.2,
        vy: 0.3 + Math.random() * 0.25,
        vz: (Math.random() - 0.5) * 0.2,
      })
    }
    return puffs
  }

  private animateImpact(e: ImpactEntry, t: number, frame: FrameContext): void {
    if (e.impact === 'shield') {
      // The shell blooms outward and thins as it goes — a squashed ellipsoid
      // hugging the hull it guards, not a perfect soap bubble.
      const grow = e.reduced ? 1 : 0.35 + 0.65 * Math.min(1, t / 0.3)
      const size = 0.22 + grow * 0.32
      e.bubble!.scale.set(size, size * 0.82, size)
      const mat = e.bubble!.material as ShaderMaterial
      mat.uniforms.uProgress.value = e.reduced ? 1 : Math.min(1, t / 0.85)
      mat.uniforms.uOpacity.value = e.reduced ? 0.55 * (1 - t) : Math.max(0, 1 - Math.max(0, t - 0.2) / 0.8)
      mat.uniforms.uTime.value = frame.now / 1000
      if (e.flare) {
        const ft = Math.min(1, t / (e.reduced ? 0.6 : 0.14))
        const flareFade = e.reduced ? 1 - t : 1 - ft
        e.flare.material.opacity = 0.95 * flareFade
        e.flare.scale.setScalar(0.06 + 0.24 * (1 - flareFade * 0.4))
      }
      return
    }

    // Hull: a bright flash that blooms then a lingering ember, a shockwave
    // ring spreading across the deck, sparks flying out on their own paths,
    // smoke drifting off the wound, and — budget allowing — a brief flicker
    // of light on the hull nearby.
    const bloom = e.reduced ? 1 : Math.min(1, t / 0.1)
    const decay = Math.max(0, 1 - Math.max(0, t - 0.1) / 0.9)
    const size = 0.18 + bloom * 0.56 * (1 - t * 0.35)
    e.fireball!.scale.setScalar(size)
    const fmat = e.fireball!.material as SpriteMaterial
    fmat.opacity = bloom * decay

    const coreDecay = Math.max(0, 1 - t / 0.28)
    e.core!.scale.setScalar(size * 0.42)
    ;(e.core!.material as SpriteMaterial).opacity = bloom * coreDecay

    if (e.shock) {
      const grow = e.reduced ? 1 : Math.min(1, t / 0.55)
      e.shock.scale.setScalar(0.04 + grow * 0.95)
      const shockFade = Math.max(0, 1 - t * 1.25)
      ;(e.shock.material as MeshBasicMaterial).opacity = e.reduced ? 0 : 0.5 * shockFade
    }

    if (e.sparks) {
      if (!e.reduced) {
        const dt = frame.dt
        const pos = e.sparks.positions
        const vel = e.sparks.velocities
        // Gravity-free drag: the burst slows itself down rather than falling.
        const drag = Math.exp(-dt * 2.2)
        for (let i = 0; i < vel.length; i += 3) {
          pos[i] += vel[i] * dt
          pos[i + 1] += vel[i + 1] * dt
          pos[i + 2] += vel[i + 2] * dt
          vel[i] *= drag
          vel[i + 1] *= drag
          vel[i + 2] *= drag
        }
        e.sparks.points.geometry.attributes.position.needsUpdate = true
      }
      const smat = e.sparks.points.material
      smat.opacity = e.reduced ? 0 : Math.max(0, 1 - t * 1.3)
    }

    if (e.smoke) {
      const fade = e.reduced ? 0 : t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.85)
      for (const puff of e.smoke) {
        if (!e.reduced) {
          puff.sprite.position.x += puff.vx * frame.dt * 0.5
          puff.sprite.position.y += puff.vy * frame.dt
          puff.sprite.position.z += puff.vz * frame.dt * 0.5
        }
        puff.sprite.scale.setScalar(0.14 + t * 0.55)
        ;(puff.sprite.material as SpriteMaterial).opacity = 0.34 * fade
      }
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
    this.shockGeo.dispose()
    for (const m of this.sheathTemplates.values()) m.dispose()
    this.coreTemplate.dispose()
    for (const m of this.muzzleTemplates.values()) m.dispose()
    for (const m of this.tipTemplates.values()) m.dispose()
    this.glowTemplate.dispose()
    this.trailTemplate.dispose()
    this.shieldRippleTemplate.dispose()
    this.shieldFlareTemplate.dispose()
    this.fireballTemplate.dispose()
    this.hullCoreTemplate.dispose()
    this.shockTemplate.dispose()
    this.smokeTemplate.dispose()
    this.sparkTemplate.dispose()
  }
}
