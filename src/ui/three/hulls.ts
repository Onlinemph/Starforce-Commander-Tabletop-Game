/**
 * Ship hulls for the 3D view, built from the very glyphs the 2D map draws.
 *
 * The map's silhouettes are the designer's own counter art, traced to SVG
 * paths, plus the hull-kind dressing (flight decks, freighter pods, station
 * rings, command flags). Rather than model a second fleet by hand, this
 * renders `ShipGlyph` to SVG markup, parses it with three's SVGLoader, and
 * extrudes each part: the hull plating deep and bevelled, a flight deck as a
 * slab on top, trim and canopies as lit inlays. A Union cruiser in 3D is the
 * same shape as its counter, which is the point — a player should recognise
 * a ship across the switch without reading its name.
 *
 * A warship is built up in tiers — the silhouette as the lower hull, a
 * smaller copy of it as the superstructure, and on bigger hulls a bridge
 * tower — so it reads as a model from any angle rather than a cut-out. The
 * plating is panelled and dotted with lit windows (hullTextures.ts); drives
 * burn with plumes whose length is the ship's speed; running lights blink
 * red to port and green to starboard; and a badly hurt hull burns.
 *
 * Geometry is cached per (faction, role, hull kind, command, size) and
 * shared by every ship of that shape; materials are per ship, because
 * damage washes and cloaks change them.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import type { ShipForm } from '../../engine/types'
import { ShipGlyph, hullKindFor, hullRoleFor, isCommandHull, type HullKind } from '../MapView'
import { DAMAGE_TINT, SHIP_SIZE, SIDE_COLOR, hullDepth, hullScale, type SideColor } from './space'
import { HULL_TILE, panelTexture, windowTexture } from './hullTextures'
import { cloudTexture, glowTexture } from './textures'

type Silhouette = 'union' | 'vallari' | 'aurelian' | 'generic'
type Role = ReturnType<typeof hullRoleFor>

function silhouetteFor(faction: string): Silhouette {
  if (/union/i.test(faction)) return 'union'
  if (/vallari/i.test(faction)) return 'vallari'
  if (/aurelian/i.test(faction)) return 'aurelian'
  return 'generic'
}

/** The glyph's parts, as flat shapes in glyph units (nose toward −y). */
interface GlyphParts {
  hull: Shape[]
  deck: Shape[]
  trim: Shape[]
  glass: Shape[]
}

function glyphParts(kind: Silhouette, role: Role, hull: HullKind, command: boolean): GlyphParts {
  const markup = renderToStaticMarkup(
    createElement(
      'svg',
      { xmlns: 'http://www.w3.org/2000/svg', viewBox: '-50 -50 100 100' },
      createElement(ShipGlyph, { kind, role, hull, command }),
    ),
  )
  const data = new SVGLoader().parse(markup)
  const parts: GlyphParts = { hull: [], deck: [], trim: [], glass: [] }
  for (const path of data.paths) {
    const node = path.userData?.node as Element | undefined
    const cls = node?.getAttribute('class') ?? ''
    // Lines (deck landing line, pylons) have no area to extrude.
    if (node?.tagName.toLowerCase() === 'line') continue
    const shapes = path.toShapes()
    if (cls.includes('glyph-deck')) parts.deck.push(...shapes)
    else if (cls.includes('glyph-hull')) parts.hull.push(...shapes)
    else if (cls.includes('glyph-trim')) parts.trim.push(...shapes)
    else if (cls.includes('glyph-glass')) parts.glass.push(...shapes)
  }
  return parts
}

/** Shared geometries for one hull shape, already in inches and nose-north. */
export interface HullGeometry {
  /** Every tier of plating, merged: one draw call. */
  hull: BufferGeometry
  edges: BufferGeometry
  deck: BufferGeometry | null
  trim: BufferGeometry | null
  glass: BufferGeometry | null
  /** Top of the highest tier, in inches above the hull's centre plane. */
  top: number
  /** Top of the lower hull, where fires break out. */
  deckTop: number
  /** Where the drives are: stern points, hull-local inches. */
  engines: Array<{ x: number; y: number; z: number }>
  /** Running lights: port (red), starboard (green) and the stern strobe. */
  lights: { port: Vector3; starboard: Vector3; strobe: Vector3 }
  /** Points on the upper plating where damage fires can break out. */
  hotspots: Vector3[]
  /** Half the hull's length along its keel. */
  halfLength: number
  /** Half its beam. */
  halfBeam: number
}

const cache = new Map<string, HullGeometry>()

/**
 * Extrude flat glyph shapes into a slab `depth` glyph-units thick, lying in
 * the XZ plane with the glyph's −y (the bow) toward world −Z, centred on its
 * own mid-plane and raised by `lift`.
 */
function slab(shapes: Shape[], depth: number, bevel: number, lift: number): BufferGeometry | null {
  if (shapes.length === 0) return null
  const geo = new ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
    curveSegments: 10,
  })
  // Rotate +90° about X: glyph y becomes world z (bow to −Z), extrusion runs
  // downward. Then centre the slab on its own mid-plane and raise it.
  geo.rotateX(Math.PI / 2)
  geo.translate(0, depth / 2 + lift, 0)
  return geo
}

/**
 * A smaller copy of a slab, shrunk toward a point on the keel: the tiered
 * look of a warship's superstructure, built from its own silhouette so it
 * always sits inside the hull it belongs to.
 */
function tier(
  shapes: Shape[],
  depth: number,
  lift: number,
  scale: { x: number; z: number },
  about: { x: number; z: number },
): BufferGeometry | null {
  const geo = slab(shapes, depth, Math.min(1.4, depth * 0.3), lift)
  if (!geo) return null
  geo.translate(-about.x, 0, -about.z)
  geo.scale(scale.x, 1, scale.z)
  geo.translate(about.x, 0, about.z)
  return geo
}

/** Strip geometries down to position, normal and uv so they merge. */
function mergeable(g: BufferGeometry): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name)
  }
  out.clearGroups()
  return out
}

export function hullGeometry(form: Pick<ShipForm, 'name' | 'faction' | 'sizeClass'>): HullGeometry {
  const kind = silhouetteFor(form.faction)
  const role = hullRoleFor(form)
  const hull = hullKindFor(form)
  const command = isCommandHull(form)
  const key = `${kind}|${role}|${hull}|${command}|${form.sizeClass}`
  const hit = cache.get(key)
  if (hit) return hit

  const parts = glyphParts(kind, role, hull, command)
  // Glyph units to inches: the counter is 1.5" and the glyph box 100 units.
  const k = (SHIP_SIZE / 100) * hullScale(form.sizeClass)
  const depth = hullDepth(form.sizeClass) / k

  const lower = slab(parts.hull, depth, Math.min(2.2, depth * 0.35), 0)
  lower?.computeBoundingBox()
  const lb = lower?.boundingBox
  const centre = lb ? { x: (lb.min.x + lb.max.x) / 2, z: (lb.min.z + lb.max.z) / 2 } : { x: 0, z: 0 }
  const length = lb ? lb.max.z - lb.min.z : 1

  // Superstructure tiers, for warships only: a carrier's deck, a freighter's
  // pods and a station's rings are already the shape they should be.
  const tiers: BufferGeometry[] = []
  let top = depth / 2
  if (hull === 'warship' && lower) {
    const d2 = depth * 0.55
    const upper = tier(parts.hull, d2, top + d2 / 2 - 0.2, { x: 0.58, z: 0.74 }, { x: centre.x, z: centre.z + length * 0.06 })
    if (upper) {
      tiers.push(upper)
      top += d2 - 0.2
    }
    if (form.sizeClass >= 4) {
      const d3 = depth * 0.45
      const bridge = tier(parts.hull, d3, top + d3 / 2 - 0.2, { x: 0.24, z: 0.3 }, { x: centre.x, z: centre.z + length * 0.14 })
      if (bridge) {
        tiers.push(bridge)
        top += d3 - 0.2
      }
    }
  }
  // A carrier's island: a tower off the starboard edge of its flight deck.
  let island: BufferGeometry | null = null
  if (hull === 'carrier' && lb) {
    const h = depth * 0.9
    island = new BoxGeometry(6, h, length * 0.16)
    island.translate(lb.max.x * 0.55, depth / 2 + h / 2, centre.z + length * 0.08)
  }

  const plating = lower
    ? mergeGeometries([lower, ...tiers, ...(island ? [island] : [])].map(mergeable))
    : new PlaneGeometry(0.01, 0.01)
  const deckLift = depth / 2 + 0.4
  const deckGeo = slab(parts.deck, depth * 0.22, 0.6, deckLift)
  const inlay = hull === 'warship' ? top + 0.05 : depth / 2 + (parts.deck.length ? depth * 0.22 + 0.5 : 0.6)
  const trimGeo = slab(parts.trim, depth * 0.12, 0, inlay)
  const glassGeo = slab(parts.glass, depth * 0.1, 0, inlay + 0.1)

  const toInches = (g: BufferGeometry | null) => {
    if (!g) return null
    g.scale(k, k, k)
    g.userData.shared = true
    return g
  }
  const hullGeo = toInches(plating)!
  hullGeo.computeBoundingBox()
  const box = hullGeo.boundingBox!
  const edges = new EdgesGeometry(hullGeo, 30)
  edges.userData.shared = true

  // Scan the plating for its extremes: the running lights ride the widest
  // points and the stern, and fires break out on the upper surfaces.
  const pos = hullGeo.attributes.position
  let port = new Vector3(0, 0, 0)
  let starboard = new Vector3(0, 0, 0)
  let stern = new Vector3(0, 0, -Infinity)
  const upper: Vector3[] = []
  const lowerTop = (depth / 2) * k
  for (let i = 0; i < pos.count; i++) {
    const v = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
    if (v.x < port.x) port = v
    if (v.x > starboard.x) starboard = v
    if (v.z > stern.z && v.y >= lowerTop * 0.8) stern = v
    if (v.y >= lowerTop * 0.9 && i % 7 === 0) upper.push(v)
  }
  // A handful of hotspots spread along the hull, not bunched at one end.
  upper.sort((a, b) => a.z - b.z)
  const hotspots = [0.2, 0.45, 0.65, 0.85].map((f) => upper[Math.floor(f * (upper.length - 1))]).filter(Boolean)

  const beam = box.max.x - box.min.x
  const sternZ = box.max.z
  const engineY = -lowerTop * 0.1
  const engines =
    hull === 'station'
      ? []
      : beam < 0.35
        ? [{ x: 0, y: engineY, z: sternZ }]
        : beam > 1 && form.sizeClass >= 6
          ? [-0.26, 0, 0.26].map((f) => ({ x: beam * f, y: engineY, z: sternZ }))
          : [-0.17, 0.17].map((f) => ({ x: beam * f, y: engineY, z: sternZ }))

  const geometry: HullGeometry = {
    hull: hullGeo,
    edges,
    deck: toInches(deckGeo),
    trim: toInches(trimGeo),
    glass: toInches(glassGeo),
    top: box.max.y,
    deckTop: lowerTop,
    engines,
    lights: { port, starboard, strobe: isFinite(stern.z) ? stern : new Vector3(0, box.max.y, sternZ) },
    hotspots,
    halfLength: (box.max.z - box.min.z) / 2,
    halfBeam: beam / 2,
  }
  cache.set(key, geometry)
  return geometry
}

// ── Shared parts ──────────────────────────────────────────────────────────

/** An engine plume: an open cone pointing aft, base at the nozzle, length 1. */
const PLUME_GEOMETRY = (() => {
  const g = new ConeGeometry(1, 1, 16, 1, true)
  g.rotateX(Math.PI / 2)
  g.translate(0, 0, 0.5)
  g.userData.shared = true
  return g
})()

/**
 * Drive exhaust: hot and white at the nozzle, fading through the drive's
 * colour to nothing, with a quick flicker. Additive, so plumes only add
 * light; one shared material animated by a clock uniform.
 */
const PLUME_MATERIAL = new ShaderMaterial({
  uniforms: { time: { value: 0 }, tint: { value: new Color(0x5fa8ff) } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float time;
    uniform vec3 tint;
    varying vec2 vUv;
    void main() {
      // uv.y runs from the tip (0) to the nozzle (1) on a ConeGeometry.
      float along = vUv.y;
      float flicker = 0.85 + 0.15 * sin(time * 31.0 + vUv.x * 12.0) * sin(time * 17.0);
      float fade = pow(along, 2.2) * flicker;
      vec3 hot = mix(tint, vec3(1.0, 0.97, 0.92), pow(along, 6.0));
      gl_FragColor = vec4(hot * fade * 1.1, fade);
    }
  `,
  transparent: true,
  blending: AdditiveBlending,
  depthWrite: false,
  side: DoubleSide,
})
PLUME_MATERIAL.userData.shared = true

/**
 * Running-light materials, made on first use: they need a canvas texture,
 * and the module has to load in node for the pure tests.
 */
let navMaterials: { red: SpriteMaterial; green: SpriteMaterial; white: SpriteMaterial } | null = null
function nav() {
  if (navMaterials) return navMaterials
  const make = (color: Color) => {
    const m = new SpriteMaterial({
      map: glowTexture(),
      color,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    m.userData.shared = true
    return m
  }
  navMaterials = {
    red: make(new Color(0xff3030).multiplyScalar(2)),
    green: make(new Color(0x30ff70).multiplyScalar(2)),
    white: make(new Color(0xffffff).multiplyScalar(2.4)),
  }
  return navMaterials
}

/** The per-ship materials a hull wears, so damage and cloaks can restyle it. */
export interface HullMaterials {
  plating: MeshStandardMaterial
  deck: MeshStandardMaterial
  trim: MeshBasicMaterial
  glass: MeshBasicMaterial
  edges: LineBasicMaterial
  engines: SpriteMaterial
}

interface Fire {
  flame: Sprite
  smoke: Sprite[]
  phase: number
}

export interface HullModel {
  group: Group
  materials: HullMaterials
  geometry: HullGeometry
  plumes: Mesh[]
  cores: Sprite[]
  navLights: { port: Sprite; starboard: Sprite; strobe: Sprite }
  fires: Fire[]
  /** How many fires are burning (0 when intact), set by styleHull. */
  burning: number
  /** Drives dark (derelict). */
  dead: boolean
  /** Current plume length, eased toward the speed's. */
  plume: number
  phase: number
}

/**
 * A ship's hull model: tiered, panelled plating with lit windows, deck,
 * trim, canopy glass, a side-coloured outline, drive plumes and running
 * lights. Positioned hull-local — the caller places and turns the group.
 */
export function buildHull(form: ShipForm, side: SideColor): HullModel {
  const geometry = hullGeometry(form)
  const sideColor = new Color(SIDE_COLOR[side])
  const materials: HullMaterials = {
    plating: new MeshStandardMaterial({
      color: DAMAGE_TINT.none,
      map: panelTexture(),
      metalness: 0.6,
      roughness: 0.48,
      roughnessMap: panelTexture(),
      emissive: new Color(1, 1, 1),
      emissiveMap: windowTexture(),
      emissiveIntensity: 0.9,
      // Pushed back a hair so the outline drawn on its edges never z-fights.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    deck: new MeshStandardMaterial({ color: 0x323a4d, map: panelTexture(), metalness: 0.3, roughness: 0.7 }),
    trim: new MeshBasicMaterial({ color: sideColor.clone().multiplyScalar(1.05), toneMapped: false }),
    glass: new MeshBasicMaterial({ color: new Color(0xcfe3ff).multiplyScalar(0.95), toneMapped: false }),
    edges: new LineBasicMaterial({ color: sideColor, transparent: true, opacity: 0.55 }),
    engines: new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0x9fd0ff).multiplyScalar(1.1),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    }),
  }

  const group = new Group()
  group.name = 'hull'
  group.add(new Mesh(geometry.hull, materials.plating))
  group.add(new LineSegments(geometry.edges, materials.edges))
  if (geometry.deck) group.add(new Mesh(geometry.deck, materials.deck))
  if (geometry.trim) group.add(new Mesh(geometry.trim, materials.trim))
  if (geometry.glass) group.add(new Mesh(geometry.glass, materials.glass))

  // Drives: a hot core at each nozzle and a plume streaming aft.
  const nozzle = 0.045 + form.sizeClass * 0.009
  const plumes: Mesh[] = []
  const cores: Sprite[] = []
  for (const e of geometry.engines) {
    const core = new Sprite(materials.engines)
    core.position.set(e.x, e.y, e.z + 0.01)
    core.scale.setScalar(nozzle * 2.2)
    group.add(core)
    cores.push(core)
    const plume = new Mesh(PLUME_GEOMETRY, PLUME_MATERIAL)
    plume.position.set(e.x, e.y, e.z)
    plume.scale.set(nozzle, nozzle, 0.2)
    group.add(plume)
    plumes.push(plume)
  }

  const light = (m: SpriteMaterial, at: Vector3) => {
    const s = new Sprite(m)
    s.position.copy(at)
    s.scale.setScalar(0.09)
    group.add(s)
    return s
  }
  const navLights = {
    port: light(nav().red, geometry.lights.port),
    starboard: light(nav().green, geometry.lights.starboard),
    strobe: light(nav().white, geometry.lights.strobe),
  }

  // Fires, built dark and lit by styleHull as the damage mounts.
  const fires: Fire[] = geometry.hotspots.map((at, i) => {
    const flame = new Sprite(
      new SpriteMaterial({
        map: glowTexture(),
        color: new Color(1.0, 0.45, 0.12).multiplyScalar(2),
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
      }),
    )
    flame.position.copy(at).setY(at.y + 0.03)
    flame.visible = false
    group.add(flame)
    const smoke = [0, 1, 2].map(() => {
      const puff = new Sprite(
        new SpriteMaterial({ map: cloudTexture(3), color: 0x2a2624, transparent: true, depthWrite: false, opacity: 0 }),
      )
      puff.visible = false
      group.add(puff)
      return puff
    })
    return { flame, smoke, phase: i * 1.7 }
  })

  if (form.art) group.add(artDecal(form.art, form.sizeClass, geometry.top))
  return {
    group,
    materials,
    geometry,
    plumes,
    cores,
    navLights,
    fires,
    burning: 0,
    dead: false,
    plume: 0.2,
    phase: (form.name.length * 0.37) % 1,
  }
}

/**
 * Builder art (ShipForm.art) laid on top of the hull like a decal: the
 * player's own picture where the 2D map would show it, over the class shape
 * that stands in if the image never loads.
 */
function artDecal(art: string, sizeClass: number, top: number): Mesh {
  const safe = /^data:image\/(png|jpeg|webp);base64,/.test(art) || /^https:\/\//.test(art)
  const size = SHIP_SIZE * hullScale(sizeClass)
  const material = new MeshBasicMaterial({ transparent: true, side: DoubleSide, depthWrite: false })
  if (safe) {
    new TextureLoader().load(art, (tex) => {
      tex.colorSpace = SRGBColorSpace
      material.map = tex
      material.needsUpdate = true
    })
  } else {
    material.visible = false
  }
  const plane = new Mesh(new PlaneGeometry(size, size), material)
  plane.rotation.x = -Math.PI / 2
  plane.position.y = top + 0.02
  plane.name = 'art'
  return plane
}

/** Fires burning at each damage level: none until the hull is badly hurt. */
const FIRES_AT: Record<string, number> = { heavy: 1, crippled: 3, destroyed: 4 }

/**
 * Restyle a hull for its state: damage washes the plating toward heat and
 * sets fires on the decks, a derelict goes dark and its drives die, a cloak
 * turns it to a ghost that only its own commander sees.
 */
export function styleHull(
  model: HullModel,
  state: { damage: string; derelict: boolean; ghosted: boolean; cloaked: boolean },
): void {
  const { materials } = model
  const tint = state.derelict ? DAMAGE_TINT.derelict : (DAMAGE_TINT[state.damage] ?? DAMAGE_TINT.none)
  materials.plating.color.setHex(tint)
  const heat = state.damage === 'crippled' ? 0.35 : state.damage === 'heavy' ? 0.18 : 0
  materials.plating.emissive.setRGB(1 + heat * 2, 1 + heat * 0.4, 1)
  // Windows go out as a ship dies: a derelict is dark from end to end.
  materials.plating.emissiveIntensity = state.derelict ? 0 : state.damage === 'crippled' ? 0.35 : 0.9
  materials.engines.opacity = state.derelict ? 0 : 1
  model.dead = state.derelict
  model.burning = state.ghosted || state.cloaked ? 0 : (FIRES_AT[state.damage] ?? 0)

  const ghost = state.ghosted || state.cloaked
  for (const m of [materials.plating, materials.deck, materials.trim, materials.glass] as const) {
    m.transparent = ghost
    m.opacity = ghost ? 0.28 : 1
    m.depthWrite = !ghost
  }
  materials.edges.opacity = ghost ? 0.4 : 0.55
  for (const l of Object.values(model.navLights)) l.visible = !ghost && !state.derelict
  for (const p of model.plumes) p.visible = !state.derelict
}

/**
 * One frame of a hull's life: plumes stretch toward the ship's speed, the
 * running lights blink, fires flicker and trail smoke. `speed` is the
 * ship's current speed in inches per phase.
 */
export function animateHull(model: HullModel, now: number, dt: number, speed: number, reducedMotion: boolean): void {
  PLUME_MATERIAL.uniforms.time.value = now / 1000
  const want = model.dead ? 0 : 0.25 + Math.min(Math.abs(speed), 12) * 0.12
  model.plume += (want - model.plume) * (1 - Math.exp(-dt * 3))
  for (const p of model.plumes) p.scale.z = model.plume

  const t = now / 1000 + model.phase * 10
  // Port and starboard lights pulse together; the strobe double-flashes.
  const beat = t % 2
  const nav = reducedMotion ? 0.9 : beat < 0.5 ? 1 : 0.25
  model.navLights.port.material.opacity = nav
  model.navLights.starboard.material.opacity = nav
  model.navLights.strobe.visible = model.navLights.port.visible && (reducedMotion || beat < 0.08 || (beat > 0.2 && beat < 0.28))

  for (let i = 0; i < model.fires.length; i++) {
    const fire = model.fires[i]
    const lit = i < model.burning
    fire.flame.visible = lit
    for (const puff of fire.smoke) puff.visible = lit && !reducedMotion
    if (!lit) continue
    const f = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(t * 23 + fire.phase) * Math.sin(t * 7.3 + fire.phase)
    fire.flame.scale.setScalar(0.16 * f + 0.04)
    ;(fire.flame.material as SpriteMaterial).opacity = 0.6 + 0.4 * f
    if (reducedMotion) continue
    fire.smoke.forEach((puff, j) => {
      const cycle = (t * 0.45 + j / fire.smoke.length + fire.phase) % 1
      puff.position.set(
        fire.flame.position.x + cycle * 0.05,
        fire.flame.position.y + cycle * 0.55,
        fire.flame.position.z + cycle * 0.25,
      )
      puff.scale.setScalar(0.12 + cycle * 0.35)
      ;(puff.material as SpriteMaterial).opacity = 0.55 * (1 - cycle) * Math.min(1, cycle * 6)
    })
  }
}

/** The texture tile in glyph units, re-exported for anyone matching the panel grid. */
export { HULL_TILE }
