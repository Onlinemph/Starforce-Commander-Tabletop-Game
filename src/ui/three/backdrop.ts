/**
 * Deep space and the table: the starfield, the far nebula banks, the play
 * surface itself with its grid and boundary (A2.9), and — when a scenario
 * calls for it — the haze of a nebula that fills the whole board (K4.1.1).
 *
 * Everything here reads only `game.scenario` (the board's size and whether
 * it is a nebula), never the battle, so it is rebuilt just once per board
 * and left alone after that. `tick` adds only the smallest amount of life —
 * a slow twinkle, a slower drift — and none of it runs under
 * `reducedMotion`.
 */
import {
  AdditiveBlending,
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
  MeshLambertMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
} from 'three'
import { Rng } from '../../engine/dice'
import { cloudTexture, flareTexture, glowTexture } from './textures'
import { disposeTree, type FrameContext, type Layer, type LayerContext } from './layer'
import { toWorld } from './space'

/** Pins every star to the board's own size, the same reasoning as MapView's `useStarfield`. */
const STARFIELD_SEED = 0x5f0cd1

/** Just above the board plane, so the grid and edge never z-fight with it. */
const GRID_Y = 0.012
const EDGE_Y = 0.02
/** The nebula haze plane and its drifting banks sit a hair above the grid. */
const HAZE_Y = 1.3

/** A uniformly random point on a sphere of the given radius. */
function spherePoint(rng: Rng, radius: number): { x: number; y: number; z: number } {
  const u = rng.next()
  const v = rng.next()
  const theta = 2 * Math.PI * u
  const phi = Math.acos(2 * v - 1)
  const s = radius * Math.sin(phi)
  return { x: s * Math.cos(theta), y: radius * Math.cos(phi), z: s * Math.sin(theta) }
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

export class BackdropLayer implements Layer {
  readonly group = new Group()
  private stars = new Group()
  private nebulaBanks = new Group()
  private board = new Group()
  private nebulaOverlay = new Group()

  private boardSize = { width: 0, height: 0 }
  private nebulaOn = false

  private dustMaterial: PointsMaterial | null = null
  private midMaterial: PointsMaterial | null = null
  private brightStars: BrightStar[] = []
  private driftClouds: DriftCloud[] = []

  constructor() {
    this.group.name = 'backdrop'
    this.group.add(this.stars, this.nebulaBanks, this.board, this.nebulaOverlay)
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
    this.clear(this.stars)
    this.clear(this.nebulaBanks)
    this.clear(this.board)
    this.clear(this.nebulaOverlay)
    this.brightStars = []
    this.driftClouds = []

    this.buildStarfield(width, height)
    this.buildNebulaBanks(width, height)
    this.buildBoard(width, height)
    this.buildNebulaOverlay(width, height)
    this.nebulaOverlay.visible = this.nebulaOn
  }

  private clear(group: Group): void {
    disposeTree(group)
    group.clear()
  }

  // ── Starfield ────────────────────────────────────────────────────────

  private buildStarfield(width: number, height: number): void {
    const rng = new Rng((STARFIELD_SEED ^ (width * 73856093) ^ (height * 19349663)) >>> 0)
    // Well outside anywhere the camera can dolly to, whatever the board's size.
    const radius = Math.max(240, Math.hypot(width, height) * 5)

    this.dustMaterial = this.buildStarTier(rng, radius, 4200, 1.8, 0.75)
    this.midMaterial = this.buildStarTier(rng, radius, 620, 3.1, 0.9)

    // A handful of bright ones, each a four-point flare with its own material
    // so it can twinkle on its own phase — cheap at this count.
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

  /** One tier of the dust: many points, sizes fixed within the tier, brightness varied per star. */
  private buildStarTier(rng: Rng, radius: number, count: number, size: number, baseOpacity: number): PointsMaterial {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const p = spherePoint(rng, radius)
      positions[i * 3] = p.x
      positions[i * 3 + 1] = p.y
      positions[i * 3 + 2] = p.z
      // Cubed so most stars are dim and only a few in this tier stand out.
      const b = 0.2 + Math.pow(rng.next(), 3) * 0.8
      const warmth = 0.9 + rng.next() * 0.1
      colors[i * 3] = b * warmth
      colors[i * 3 + 1] = b * warmth
      colors[i * 3 + 2] = b
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
    const material = new PointsMaterial({
      size,
      sizeAttenuation: false,
      vertexColors: true,
      map: glowTexture(),
      transparent: true,
      opacity: baseOpacity,
      depthWrite: false,
      toneMapped: false,
    })
    this.stars.add(new Points(geometry, material))
    return material
  }

  // ── Distant nebula banks (decoration, for depth) ────────────────────────

  private buildNebulaBanks(width: number, height: number): void {
    const rng = new Rng(((STARFIELD_SEED ^ 0x51a1) + width * 131 + height * 977) >>> 0)
    const diag = Math.hypot(width, height)
    const center = toWorld({ x: width / 2, y: height / 2 })
    // Purple, blue and teal, echoing the 2D map's neb-a/b/c gradients — but
    // far below the board and barely visible, so depth never becomes wash.
    const tints = [0x4a3a8a, 0x1f6fa0, 0x1f8f82]
    tints.forEach((tint, i) => {
      const material = new SpriteMaterial({
        map: cloudTexture(1 + i),
        color: new Color(tint),
        transparent: true,
        opacity: 0.045 + rng.next() * 0.03,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      })
      const sprite = new Sprite(material)
      const size = diag * (1.6 + rng.next() * 1.3)
      sprite.scale.set(size, size, 1)
      const angle = rng.next() * Math.PI * 2
      const spread = diag * (0.4 + rng.next() * 0.6)
      sprite.position.set(
        center.x + Math.cos(angle) * spread,
        -diag * (0.4 + rng.next() * 0.5),
        center.z + Math.sin(angle) * spread,
      )
      this.nebulaBanks.add(sprite)
    })
  }

  // ── The board ────────────────────────────────────────────────────────

  private buildBoard(width: number, height: number): void {
    const plane = new Mesh(
      new PlaneGeometry(width, height),
      // Lambert, not Standard: a physically based surface always keeps a
      // few percent of specular, and the warm sun spread that across the
      // whole table as a brown sheen. Deep space stays deep space.
      new MeshLambertMaterial({ color: 0x0b1224 }),
    )
    plane.rotation.x = -Math.PI / 2
    plane.position.copy(toWorld({ x: width / 2, y: height / 2 }))
    this.board.add(plane, this.buildGrid(width, height), this.buildEdge(width, height))
  }

  /** Grid lines every 3", coloured brighter near the board's centre and fading toward the edge. */
  private buildGrid(width: number, height: number): LineSegments {
    const positions: number[] = []
    const colors: number[] = []
    const base = new Color(0x2a3a5e)
    const cx = width / 2
    const cy = height / 2
    const maxDist = Math.max(1, Math.hypot(cx, cy))
    const step = 2
    const pushSegment = (x1: number, y1: number, x2: number, y2: number) => {
      const len = Math.hypot(x2 - x1, y2 - y1)
      const steps = Math.max(1, Math.round(len / step))
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps
        const t1 = (i + 1) / steps
        const ax = x1 + (x2 - x1) * t0
        const ay = y1 + (y2 - y1) * t0
        const bx = x1 + (x2 - x1) * t1
        const by = y1 + (y2 - y1) * t1
        positions.push(ax, GRID_Y, ay, bx, GRID_Y, by)
        const fa = 1 - Math.min(1, Math.hypot(ax - cx, ay - cy) / maxDist) * 0.82
        const fb = 1 - Math.min(1, Math.hypot(bx - cx, by - cy) / maxDist) * 0.82
        colors.push(base.r * fa, base.g * fa, base.b * fa, base.r * fb, base.g * fb, base.b * fb)
      }
    }
    for (let i = 3; i < width; i += 3) pushSegment(i, 0, i, height)
    for (let i = 3; i < height; i += 3) pushSegment(0, i, width, i)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
    return new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, toneMapped: false }))
  }

  /**
   * The play area's edge (A2.9): leaving it is disengagement (J9), so it has
   * to read from across the table. A dashed plum line with a soft additive
   * twin underneath, for the glow without a second bloom-defeating haze.
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
    group.add(dashed, glow)
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

  tick({ now, reducedMotion }: FrameContext): void {
    if (reducedMotion) return
    const t = now / 1000
    if (this.dustMaterial) this.dustMaterial.opacity = 0.7 + Math.sin(t * 0.15) * 0.08
    if (this.midMaterial) this.midMaterial.opacity = 0.85 + Math.sin(t * 0.12 + 1.4) * 0.08
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

  dispose(): void {
    disposeTree(this.group)
    this.dustMaterial = null
    this.midMaterial = null
    this.brightStars = []
    this.driftClouds = []
  }
}
