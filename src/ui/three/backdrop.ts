/**
 * Deep space and the table: a painted skybox and sun, the holographic
 * tactical board with its grid and boundary (A2.9), and — when a scenario
 * calls for it — the haze of a nebula that fills the whole board (K4.1.1).
 *
 * Everything here reads only `game.scenario` (the board's size and whether
 * it is a nebula), never the battle, so it is rebuilt just once per board
 * and left alone after that. The skybox and sun texture are painted once,
 * ever, and cached in `textures.ts`; a board resize only recreates the
 * geometry that wraps them. `tick` keeps the sky centred on the camera (so
 * it never parallaxes), keeps the sun's lens flare on the camera's screen,
 * and adds the smallest amount of life to the rest — a twinkle, a drift, a
 * scan-line sweep — none of it under `reducedMotion`.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from 'three'
import { Rng } from '../../engine/dice'
import { makeLabel } from './labels'
import { disposeTree, type FrameContext, type Layer, type LayerContext } from './layer'
import { DEG, toWorld } from './space'
import { MILKY_WAY_AXIS, cloudTexture, flareTexture, glowTexture, skyboxTexture } from './textures'

/** Pins every star to the board's own size, the same reasoning as MapView's `useStarfield`. */
const STARFIELD_SEED = 0x5f0cd1

/** Just above the board plane, so the edge and its detail never z-fight with the grid the shader paints on the surface itself. */
const EDGE_Y = 0.02
/** The nebula haze plane and its drifting banks sit a hair above the board. */
const HAZE_Y = 1.3

/** The sun's fixed world direction (matches `BattleScene`'s directional light) and the fraction of the sky sphere's radius it sits at. */
const SUN_DIRECTION = new Vector3(-40, 60, -30).normalize()

/**
 * Screen-space lens-flare elements, one line through the sun's projected
 * position and the screen centre. `distance` is the usual lens-flare
 * parameter (0 = at the sun, 0.5 = screen centre, 1 = the mirrored point on
 * the far side); `sizeFrac` is the element's size as a fraction of the
 * viewport's height, so it reads the same on a phone and a desktop.
 */
const FLARE_SPECS: ReadonlyArray<{ distance: number; sizeFrac: number; opacity: number; color: number; tex: 'glow' | 'flare' }> = [
  { distance: 0.22, sizeFrac: 0.05, opacity: 0.09, color: 0xfff0d8, tex: 'glow' },
  { distance: 0.45, sizeFrac: 0.022, opacity: 0.16, color: 0xbcd8ff, tex: 'flare' },
  { distance: 0.68, sizeFrac: 0.07, opacity: 0.07, color: 0xffcf9a, tex: 'glow' },
  { distance: 0.92, sizeFrac: 0.11, opacity: 0.05, color: 0x9fc8ff, tex: 'glow' },
  { distance: 1.2, sizeFrac: 0.03, opacity: 0.09, color: 0xffffff, tex: 'flare' },
]
/** Fixed world-space distance the flare quads are parked at, in front of the camera; only their *angular* size matters, so any value works. */
const FLARE_DISTANCE = 40

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** ~2048×1024 on a desktop, ~1024×512 when the device looks like a phone — the one-time paint cost has to stay well under a phone's frame budget. */
function skyboxSize(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 2048, h: 1024 }
  const dpr = window.devicePixelRatio || 1
  const shortSide = Math.min(window.innerWidth || 1920, window.innerHeight || 1080)
  const phone = dpr >= 2.5 || shortSide <= 480
  return phone ? { w: 1024, h: 512 } : { w: 2048, h: 1024 }
}

/** A uniformly random point on a sphere of the given radius. */
function spherePoint(rng: Rng, radius: number): { x: number; y: number; z: number } {
  const u = rng.next()
  const v = rng.next()
  const theta = 2 * Math.PI * u
  const phi = Math.acos(2 * v - 1)
  const s = radius * Math.sin(phi)
  return { x: s * Math.cos(theta), y: radius * Math.cos(phi), z: s * Math.sin(theta) }
}

/** A small, subtle inch label just outside the board's edge (A2.9, ruler reading per E1.1). */
function edgeLabel(text: string, x: number, z: number) {
  const label = makeLabel(text, 'l3d-edge')
  label.position.set(x, EDGE_Y + 0.4, z)
  return label
}

interface BrightStar {
  sprite: Sprite
  phase: number
}

interface DriftCloud {
  sprite: Sprite
  baseX: number
  baseZ: number
  phase: number
}

interface FlareSprite {
  sprite: Sprite
  distance: number
  sizeFrac: number
  baseOpacity: number
}

// ── The holographic board shader ────────────────────────────────────────
// One ShaderMaterial paints the whole surface: a near-black navy base with
// a sheen toward the sun, fine 1" and brighter 3" lines (fwidth-antialiased
// so a low camera never sees a moiré mess), a glowing plus at every 3"
// intersection (the rules grid, K-something-adjacent but really just a
// tactical HUD), a faint radial falloff from centre, and a slow scan-line
// sweep. Lines fade with distance from the camera for the same
// moiré-avoidance reason as the antialiasing.

const BOARD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const BOARD_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uScan;
  uniform vec3 uSun;
  uniform vec2 uCenter;
  uniform float uRadius;
  varying vec2 vUv;
  varying vec3 vWorldPos;

  // A line widthPx pixels wide at every multiple of period, measured in
  // grid-cell units so it stays a crisp, constant PIXEL width regardless of
  // period, camera distance or angle (the standard screen-derivative grid
  // technique) — then faded toward 0 (not 1) once several cells collapse
  // into one pixel. Without that fade, a low or distant camera would make
  // the 1" lines closer together than a pixel and the "line" would balloon
  // into a solid wash instead of vanishing the way an unresolvable grid
  // should.
  float gridLine(vec2 p, float period, float widthPx) {
    vec2 g = p / period;
    vec2 cell = fwidth(g);
    vec2 d = abs(fract(g - 0.5) - 0.5) / max(cell * widthPx, 1e-5);
    float line = 1.0 - clamp(min(d.x, d.y), 0.0, 1.0);
    float cellsPerPixel = max(cell.x, cell.y);
    float fade = clamp(1.0 - (cellsPerPixel - 0.5) / 1.5, 0.0, 1.0);
    return line * fade;
  }

  void main() {
    vec2 p = vWorldPos.xz;
    vec2 rel = p - uCenter;

    vec3 base = vec3(0.0018, 0.0038, 0.013);
    vec3 sheenColor = vec3(0.002, 0.003, 0.007);
    vec2 sunXZ = normalize(vec2(uSun.x, uSun.z) + 1e-5);
    float sheen = smoothstep(0.1, 0.95, dot(normalize(rel + vec2(1e-4)), sunXZ) * 0.5 + 0.5);

    float distC = length(rel) / max(uRadius, 1.0);
    float falloff = 1.0 - 0.16 * smoothstep(0.15, 1.15, distC);

    float fine = gridLine(p, 1.0, 0.9);
    float major = gridLine(p, 3.0, 1.25);
    // The major line's own crossing already reads as a line; do not let a
    // coincident fine line double it up into a brighter patch.
    fine *= 1.0 - major;

    // A small "+" at every 3" intersection — the rules grid, lit up. Its own
    // resolvability fade keeps it from smearing into a blob at distance.
    vec2 nearest3 = floor(p / 3.0 + 0.5) * 3.0;
    vec2 d3 = abs(p - nearest3);
    float w3 = max(fwidth(p.x) + fwidth(p.y), 1e-5);
    float armLen = 0.2;
    float armW = 0.03;
    float armX = (1.0 - smoothstep(armW, armW + w3 * 0.5, d3.x)) * (1.0 - smoothstep(armLen, armLen + w3 * 0.5, d3.y));
    float armY = (1.0 - smoothstep(armW, armW + w3 * 0.5, d3.y)) * (1.0 - smoothstep(armLen, armLen + w3 * 0.5, d3.x));
    float plusResolvable = clamp(1.0 - (w3 - 1.2) / 2.4, 0.0, 1.0);
    float plus = clamp(armX + armY, 0.0, 1.0) * plusResolvable;

    // A thin band sweeping the board every ~8s, fading in and out at the
    // ends of each pass rather than snapping. uScan is 0 under reduced
    // motion, killing the whole effect rather than just freezing it.
    float sweepPos = fract(uTime / 8.0);
    float sweepEdge = smoothstep(0.0, 0.06, sweepPos) * smoothstep(1.0, 0.94, sweepPos);
    float sweep = uScan * sweepEdge * (1.0 - smoothstep(0.0, 0.018, abs(vUv.y - sweepPos))) * 0.5;

    // Kept far under the bloom threshold (0.62), and dim: the grid is a
    // measuring surface, not a light source — the hulls, their shields and
    // the gunfire have to be the brightest things on the table. Dozens of long lines
    // covering much of the screen would otherwise smear into a glowing
    // wash the moment bloom got hold of them, which is exactly what a
    // tactical surface must never do to the hulls sitting on it.
    vec3 col = base + sheen * sheenColor;
    col *= falloff;
    col += fine * vec3(0.006, 0.012, 0.024);
    col += major * vec3(0.016, 0.034, 0.07);
    col += plus * vec3(0.05, 0.1, 0.17);
    col += sweep * vec3(0.012, 0.028, 0.055);

    gl_FragColor = vec4(col, 1.0);
  }
`

export class BackdropLayer implements Layer {
  readonly group = new Group()
  /** The skybox sphere plus the sun's disc and corona — all follow the camera in `tick`, so none of it ever parallaxes. */
  private sky = new Group()
  /** The sun's lens-flare elements, placed every frame from the sun's projected screen position. */
  private flares = new Group()
  private stars = new Group()
  private board = new Group()
  private nebulaOverlay = new Group()

  private boardSize = { width: 0, height: 0 }
  private nebulaOn = false

  private skyMesh: Mesh | null = null
  private starPoints: Points[] = []
  private sunCorona: Sprite | null = null
  private sunDisc: Sprite | null = null
  private sunDistance = 0
  private boardMaterial: ShaderMaterial | null = null

  private brightStars: BrightStar[] = []
  private driftClouds: DriftCloud[] = []
  private flareSprites: FlareSprite[] = []

  // Scratch vectors reused every frame — `tick` never allocates.
  private readonly sunWorld = new Vector3()
  private readonly viewPos = new Vector3()
  private readonly ndc = new Vector3()
  private readonly camRight = new Vector3()
  private readonly camUp = new Vector3()
  private readonly camForward = new Vector3()
  private readonly flarePos = new Vector3()

  constructor() {
    this.group.name = 'backdrop'
    // The sky renders first (see `buildSky`'s `renderOrder`), then the
    // flares, twinkling stars, board and nebula haze on top of it.
    this.group.add(this.sky, this.flares, this.stars, this.board, this.nebulaOverlay)
    this.nebulaOverlay.visible = false
  }

  update({ game }: LayerContext): void {
    const { width, height } = game.scenario.bounds
    if (width !== this.boardSize.width || height !== this.boardSize.height) {
      this.boardSize = { width, height }
      this.rebuild(width, height)
    }
    const nebula = game.scenario.nebula === true
    if (nebula !== this.nebulaOn) {
      this.nebulaOn = nebula
      this.nebulaOverlay.visible = nebula
    }
  }

  private rebuild(width: number, height: number): void {
    this.clear(this.sky)
    this.clear(this.flares)
    this.clear(this.stars)
    this.clear(this.board)
    this.clear(this.nebulaOverlay)
    this.brightStars = []
    this.driftClouds = []
    this.flareSprites = []
    this.skyMesh = null
    this.sunCorona = null
    this.sunDisc = null
    this.boardMaterial = null

    this.buildSky(width, height)
    this.buildStarfield(width, height)
    this.buildBoard(width, height)
    this.buildNebulaOverlay(width, height)
    this.nebulaOverlay.visible = this.nebulaOn
  }

  private clear(group: Group): void {
    disposeTree(group)
    group.clear()
  }

  // ── Skybox and sun ───────────────────────────────────────────────────

  /**
   * The skybox: a huge inverted sphere (BackSide, depthWrite off) painted
   * once by `skyboxTexture` and cached there, plus the sun's disc and
   * corona. All three follow the camera in `tick`, so the panorama and the
   * sun never appear to move as the camera dollies — only as it turns.
   */
  /**
   * The stars themselves, as points rather than paint: a pixel or two each
   * whatever the screen, so they stay pin-sharp against the soft nebula.
   * Thousands of faint ones crowd into the Milky Way; a few hundred bright
   * ones scatter everywhere, some faintly blue, some faintly gold.
   */
  private buildStarPoints(radius: number): void {
    const rng = new Rng((STARFIELD_SEED ^ 0x7a11) >>> 0)
    const layer = (count: number, size: number, band: boolean, brightness: [number, number]) => {
      const positions: number[] = []
      const colors: number[] = []
      let placed = 0
      while (placed < count) {
        // Uniform on the sphere, then thinned outside the band if asked.
        const z = rng.next() * 2 - 1
        const a = rng.next() * Math.PI * 2
        const r = Math.sqrt(1 - z * z)
        const x = r * Math.cos(a)
        const y = r * Math.sin(a)
        const inBand = 1 - Math.min(1, Math.abs(x * MILKY_WAY_AXIS.x + z * MILKY_WAY_AXIS.y + y * MILKY_WAY_AXIS.z) / 0.16)
        if (band && rng.next() > 0.12 + inBand * 0.88) continue
        placed++
        positions.push(x * radius, z * radius, y * radius)
        const b = brightness[0] + Math.pow(rng.next(), 2.5) * (brightness[1] - brightness[0])
        const tint = rng.next()
        const c = tint < 0.2 ? [0.75, 0.85, 1] : tint > 0.88 ? [1, 0.88, 0.7] : [1, 1, 1]
        colors.push(c[0] * b, c[1] * b, c[2] * b)
      }
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
      const points = new Points(
        geometry,
        new PointsMaterial({
          size,
          sizeAttenuation: false,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      )
      points.renderOrder = -999
      return points
    }
    this.starPoints = [
      layer(6500, 1.1, true, [0.18, 0.75]),
      layer(2200, 1.4, false, [0.25, 0.9]),
      layer(260, 2.3, false, [0.8, 1.6]),
    ]
    this.sky.add(...this.starPoints)
  }

  private buildSky(width: number, height: number): void {
    const radius = Math.min(1700, Math.max(420, Math.hypot(width, height) * 6))
    const { w, h } = skyboxSize()
    const geometry = new SphereGeometry(radius, 48, 28)
    const material = new MeshBasicMaterial({
      map: skyboxTexture(w, h, SUN_DIRECTION),
      side: BackSide,
      depthWrite: false,
      toneMapped: false,
    })
    this.skyMesh = new Mesh(geometry, material)
    // Rendered before everything else, so it never fights the depth buffer
    // for objects that have not been drawn yet.
    this.skyMesh.renderOrder = -1000
    this.sky.add(this.skyMesh)
    this.buildStarPoints(radius * 0.96)

    this.sunDistance = radius * 0.82
    const sunColor = new Color(0xfff2d8).multiplyScalar(3)
    this.sunCorona = new Sprite(
      new SpriteMaterial({
        map: glowTexture(),
        color: sunColor.clone().multiplyScalar(0.55),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    )
    const coronaSize = radius * 0.11
    this.sunCorona.scale.set(coronaSize, coronaSize, 1)

    this.sunDisc = new Sprite(
      new SpriteMaterial({
        map: glowTexture(),
        color: sunColor,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    )
    const discSize = radius * 0.04
    this.sunDisc.scale.set(discSize, discSize, 1)
    this.sky.add(this.sunCorona, this.sunDisc)

    this.flareSprites = FLARE_SPECS.map((spec) => {
      const material = new SpriteMaterial({
        map: spec.tex === 'flare' ? flareTexture() : glowTexture(),
        color: new Color(spec.color).multiplyScalar(1.6),
        transparent: true,
        opacity: spec.opacity,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        toneMapped: false,
      })
      const sprite = new Sprite(material)
      sprite.visible = false
      this.flares.add(sprite)
      return { sprite, distance: spec.distance, sizeFrac: spec.sizeFrac, baseOpacity: spec.opacity }
    })
  }

  // ── Twinkling stars ──────────────────────────────────────────────────
  // The panorama already paints the bulk of the sky; these few are kept
  // only for the twinkle a flat texture cannot give on its own.

  private buildStarfield(width: number, height: number): void {
    const rng = new Rng((STARFIELD_SEED ^ (width * 73856093) ^ (height * 19349663)) >>> 0)
    const radius = Math.max(240, Math.hypot(width, height) * 5)
    for (let i = 0; i < 10; i++) {
      const p = spherePoint(rng, radius * 0.98)
      const material = new SpriteMaterial({
        map: flareTexture(),
        color: new Color(0xcfe0ff).multiplyScalar(2.2),
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      })
      const sprite = new Sprite(material)
      const size = 3 + rng.next() * 2.6
      sprite.scale.set(size, size, size)
      sprite.position.set(p.x, p.y, p.z)
      this.stars.add(sprite)
      this.brightStars.push({ sprite, phase: rng.next() * Math.PI * 2 })
    }
  }

  // ── The board ────────────────────────────────────────────────────────

  private buildBoard(width: number, height: number): void {
    const diag = Math.hypot(width, height)
    this.boardMaterial = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScan: { value: 1 },
        uSun: { value: SUN_DIRECTION.clone() },
        uCenter: { value: new Vector2(width / 2, height / 2) },
        uRadius: { value: Math.max(1, diag / 2) },
      },
      vertexShader: BOARD_VERTEX,
      fragmentShader: BOARD_FRAGMENT,
    })
    const plane = new Mesh(new PlaneGeometry(width, height), this.boardMaterial)
    plane.rotation.x = -Math.PI / 2
    plane.position.copy(toWorld({ x: width / 2, y: height / 2 }))
    this.board.add(plane, this.buildEdge(width, height))
  }

  /**
   * The play area's edge (A2.9): leaving it is disengagement (J9), so it has
   * to read from across the table. A dashed plum line with a soft additive
   * twin underneath, crisp corner brackets, and ruler ticks with inch
   * labels every 6" (E1.1) so a glance at the edge tells you how far a ship
   * still has to go.
   */
  private buildEdge(width: number, height: number): Group {
    const group = new Group()
    const corners = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
      { x: 0, y: 0 },
    ]
    const positions: number[] = []
    for (const c of corners) positions.push(c.x, EDGE_Y, c.y)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    const plum = new Color(0x7d5ba6).multiplyScalar(1.25)

    const dashed = new Line(
      geometry,
      new LineDashedMaterial({ color: plum, dashSize: 1.1, gapSize: 0.75, transparent: true, opacity: 0.9, toneMapped: false }),
    )
    dashed.computeLineDistances()

    const glow = new Line(
      geometry.clone(),
      new LineBasicMaterial({ color: plum, transparent: true, opacity: 0.28, toneMapped: false, blending: AdditiveBlending }),
    )
    group.add(dashed, glow, this.buildEdgeDetail(width, height))
    return group
  }

  /** Corner brackets, ruler ticks every 3" and inch labels every 6" along the edges — the part of `buildEdge` that reads like a real instrument bezel. */
  private buildEdgeDetail(width: number, height: number): Group {
    const group = new Group()
    const plum = new Color(0x9a78c9).multiplyScalar(1.4)

    // Corner brackets: two short arms per corner, pointing inward.
    const armLen = Math.min(4, Math.min(width, height) * 0.16)
    const corners: Array<[number, number, number, number]> = [
      [0, 0, 1, 1],
      [width, 0, -1, 1],
      [width, height, -1, -1],
      [0, height, 1, -1],
    ]
    const bracketPositions: number[] = []
    for (const [cx, cy, sx, sy] of corners) {
      bracketPositions.push(cx, EDGE_Y, cy, cx + armLen * sx, EDGE_Y, cy)
      bracketPositions.push(cx, EDGE_Y, cy, cx, EDGE_Y, cy + armLen * sy)
    }
    const bracketGeometry = new BufferGeometry()
    bracketGeometry.setAttribute('position', new Float32BufferAttribute(bracketPositions, 3))
    group.add(
      new LineSegments(bracketGeometry, new LineBasicMaterial({ color: plum, transparent: true, opacity: 0.95, toneMapped: false })),
      new LineSegments(
        bracketGeometry.clone(),
        new LineBasicMaterial({ color: plum, transparent: true, opacity: 0.35, blending: AdditiveBlending, toneMapped: false }),
      ),
    )

    // Ruler ticks every 3", inch labels every 6" — skirting clear of the
    // corner brackets so the two never overlap.
    const tickLen = 0.55
    const skirt = 2.4
    const tickPositions: number[] = []
    const addTick = (x1: number, y1: number, x2: number, y2: number) => tickPositions.push(x1, EDGE_Y, y1, x2, EDGE_Y, y2)
    for (let i = 3; i < width; i += 3) {
      if (i < skirt || i > width - skirt) continue
      addTick(i, 0, i, tickLen)
      addTick(i, height, i, height - tickLen)
      if (i % 6 === 0) {
        group.add(edgeLabel(`${i}"`, i, -0.9), edgeLabel(`${i}"`, i, height + 0.9))
      }
    }
    for (let i = 3; i < height; i += 3) {
      if (i < skirt || i > height - skirt) continue
      addTick(0, i, tickLen, i)
      addTick(width, i, width - tickLen, i)
      if (i % 6 === 0) {
        group.add(edgeLabel(`${i}"`, -0.9, i), edgeLabel(`${i}"`, width + 0.9, i))
      }
    }
    const tickGeometry = new BufferGeometry()
    tickGeometry.setAttribute('position', new Float32BufferAttribute(tickPositions, 3))
    group.add(new LineSegments(tickGeometry, new LineBasicMaterial({ color: plum, transparent: true, opacity: 0.55, toneMapped: false })))

    return group
  }

  // ── Nebula scenario (K4.1.1) ─────────────────────────────────────────

  /** A low haze plane over the board plus a few drifting cloud billboards, kept faint so the table stays readable. */
  private buildNebulaOverlay(width: number, height: number): void {
    const center = toWorld({ x: width / 2, y: height / 2 })
    const haze = new Mesh(
      new PlaneGeometry(width * 1.1, height * 1.1),
      new MeshBasicMaterial({ color: 0x241638, transparent: true, opacity: 0.14, depthWrite: false, toneMapped: false }),
    )
    haze.rotation.x = -Math.PI / 2
    haze.position.set(center.x, HAZE_Y, center.z)
    this.nebulaOverlay.add(haze)

    const rng = new Rng(((STARFIELD_SEED ^ 0x9ee1) + width * 7 + height * 13) >>> 0)
    for (let i = 0; i < 6; i++) {
      const material = new SpriteMaterial({
        map: cloudTexture(4 + (i % 3)),
        color: new Color(0x8a5fd6),
        transparent: true,
        opacity: 0.08 + rng.next() * 0.06,
        depthWrite: false,
        // The board would slice each billboard off in a hard line where it
        // dips below the table; a nebula veils everything, ships included.
        depthTest: false,
        blending: AdditiveBlending,
        toneMapped: false,
      })
      const sprite = new Sprite(material)
      const size = Math.max(width, height) * (0.32 + rng.next() * 0.32)
      sprite.scale.set(size, size, 1)
      const x = rng.next() * width
      const z = rng.next() * height
      sprite.position.set(x, HAZE_Y + 0.4 + rng.next() * 2.4, z)
      this.nebulaOverlay.add(sprite)
      this.driftClouds.push({ sprite, baseX: x, baseZ: z, phase: rng.next() * Math.PI * 2 })
    }
  }

  // ── Life ─────────────────────────────────────────────────────────────

  tick({ now, camera, reducedMotion }: FrameContext): void {
    // Structural, not decoration: the sky and sun have to track the camera
    // every frame regardless of `reducedMotion`, or the panorama would
    // visibly slide as the camera dollies.
    if (this.skyMesh) this.skyMesh.position.copy(camera.position)
    for (const p of this.starPoints) p.position.copy(camera.position)
    if (this.sunCorona && this.sunDisc) {
      this.sunWorld.copy(camera.position).addScaledVector(SUN_DIRECTION, this.sunDistance)
      this.sunCorona.position.copy(this.sunWorld)
      this.sunDisc.position.copy(this.sunWorld)
    }
    this.updateFlares(camera as PerspectiveCamera)

    if (this.boardMaterial) {
      this.boardMaterial.uniforms.uScan.value = reducedMotion ? 0 : 1
      if (!reducedMotion) this.boardMaterial.uniforms.uTime.value = now / 1000
    }

    if (reducedMotion) return
    const t = now / 1000
    for (const star of this.brightStars) {
      ;(star.sprite.material as SpriteMaterial).opacity = 0.7 + Math.sin(t * 0.5 + star.phase) * 0.28
    }
    if (this.nebulaOn) {
      for (const cloud of this.driftClouds) {
        cloud.sprite.position.x = cloud.baseX + Math.sin(t / 40 + cloud.phase) * 1.6
        cloud.sprite.position.z = cloud.baseZ + Math.cos(t / 34 + cloud.phase) * 1.6
      }
    }
  }

  /**
   * Places the sun's lens-flare elements from its projected screen
   * position each frame — the standard trick (a line through the sun and
   * the screen centre) done by hand rather than with `Lensflare`, which
   * reads back the framebuffer in a way this scene's multisampled HDR
   * render target does not support cleanly. Hidden outright once the sun
   * is behind the camera or far enough off-screen, so it never distracts
   * when the sun is out of view.
   */
  private updateFlares(camera: PerspectiveCamera): void {
    if (this.flareSprites.length === 0) return
    this.viewPos.copy(this.sunWorld).applyMatrix4(camera.matrixWorldInverse)
    if (this.viewPos.z > -0.5) {
      for (const f of this.flareSprites) f.sprite.visible = false
      return
    }
    this.ndc.copy(this.sunWorld).project(camera)
    const edge = Math.max(Math.abs(this.ndc.x), Math.abs(this.ndc.y))
    const inView = 1 - clamp01((edge - 0.7) / 0.55)
    if (inView <= 0.01) {
      for (const f of this.flareSprites) f.sprite.visible = false
      return
    }
    this.camRight.setFromMatrixColumn(camera.matrixWorld, 0)
    this.camUp.setFromMatrixColumn(camera.matrixWorld, 1)
    this.camForward.setFromMatrixColumn(camera.matrixWorld, 2).multiplyScalar(-1)
    const halfH = FLARE_DISTANCE * Math.tan((camera.fov * DEG) / 2)
    const halfW = halfH * camera.aspect
    for (const f of this.flareSprites) {
      const fx = this.ndc.x * (1 - 2 * f.distance)
      const fy = this.ndc.y * (1 - 2 * f.distance)
      this.flarePos
        .copy(camera.position)
        .addScaledVector(this.camForward, FLARE_DISTANCE)
        .addScaledVector(this.camRight, fx * halfW)
        .addScaledVector(this.camUp, fy * halfH)
      f.sprite.position.copy(this.flarePos)
      f.sprite.visible = true
      ;(f.sprite.material as SpriteMaterial).opacity = f.baseOpacity * inView
      const s = f.sizeFrac * halfH * 2
      f.sprite.scale.set(s, s, 1)
    }
  }

  dispose(): void {
    disposeTree(this.group)
    this.brightStars = []
    this.driftClouds = []
    this.flareSprites = []
    this.skyMesh = null
    this.sunCorona = null
    this.sunDisc = null
    this.boardMaterial = null
  }
}
