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
 * Geometry is cached per (faction, role, hull kind, command) and shared by
 * every ship of that shape; materials are per ship, because damage washes
 * and cloaks change them.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
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
  SpriteMaterial,
  Sprite,
  SRGBColorSpace,
  TextureLoader,
  DoubleSide,
} from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import type { ShipForm } from '../../engine/types'
import { ShipGlyph, hullKindFor, hullRoleFor, isCommandHull, type HullKind } from '../MapView'
import { DAMAGE_TINT, SHIP_SIZE, SIDE_COLOR, hullDepth, hullScale, type SideColor } from './space'
import { glowTexture } from './textures'

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
  hull: BufferGeometry
  edges: BufferGeometry
  deck: BufferGeometry | null
  trim: BufferGeometry | null
  glass: BufferGeometry | null
  /** Top of the plating, in inches above the hull's centre plane. */
  top: number
  /** Where the drive glows go: stern points, in inches, hull-local. */
  engines: Array<{ x: number; z: number }>
  /** Half the hull's length along its keel, for placing things fore and aft. */
  halfLength: number
}

const cache = new Map<string, HullGeometry>()

/**
 * Extrude flat glyph shapes into a slab `depth` glyph-units thick, lying in
 * the XZ plane with the glyph's −y (the bow) toward world −Z.
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

  const hullGeo = slab(parts.hull, depth, Math.min(2.2, depth * 0.35), 0)
  const deckGeo = slab(parts.deck, depth * 0.22, 0.6, depth / 2 + 0.4)
  const trimGeo = slab(parts.trim, depth * 0.12, 0, depth / 2 + (parts.deck.length ? depth * 0.22 + 0.5 : 0.6))
  const glassGeo = slab(parts.glass, depth * 0.1, 0, depth / 2 + 0.7)

  const scaleAll = (g: BufferGeometry | null) => {
    if (!g) return null
    g.scale(k, k, k)
    g.userData.shared = true
    return g
  }
  const hullScaled = scaleAll(hullGeo) ?? new PlaneGeometry(0.01, 0.01)
  hullScaled.computeBoundingBox()
  const box = hullScaled.boundingBox!
  const edges = new EdgesGeometry(hullScaled, 28)
  edges.userData.shared = true

  // Drive glows sit on the stern: the aftmost tenth of the hull, spread across
  // its beam there. Two for most hulls, one for slim ones.
  const beam = box.max.x - box.min.x
  const engines =
    hull === 'station'
      ? []
      : beam < 0.35
        ? [{ x: 0, z: box.max.z }]
        : [
            { x: -beam * 0.18, z: box.max.z },
            { x: beam * 0.18, z: box.max.z },
          ]

  const geometry: HullGeometry = {
    hull: hullScaled,
    edges,
    deck: scaleAll(deckGeo),
    trim: scaleAll(trimGeo),
    glass: scaleAll(glassGeo),
    top: box.max.y,
    engines,
    halfLength: (box.max.z - box.min.z) / 2,
  }
  cache.set(key, geometry)
  return geometry
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

export interface HullModel {
  group: Group
  materials: HullMaterials
  geometry: HullGeometry
}

/**
 * A ship's hull model: plating, deck, trim, canopy glass, glowing outline in
 * the side colour and drive flares. Positioned hull-local — the caller places
 * and turns the returned group.
 */
export function buildHull(form: ShipForm, side: SideColor): HullModel {
  const geometry = hullGeometry(form)
  const sideColor = new Color(SIDE_COLOR[side])
  const materials: HullMaterials = {
    plating: new MeshStandardMaterial({
      color: DAMAGE_TINT.none,
      metalness: 0.55,
      roughness: 0.42,
      emissive: sideColor.clone().multiplyScalar(0.05),
      // Pushed back a hair so the outline drawn on its edges never z-fights.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    deck: new MeshStandardMaterial({ color: 0x3a4766, metalness: 0.3, roughness: 0.6 }),
    trim: new MeshBasicMaterial({ color: sideColor.clone().multiplyScalar(1.05), toneMapped: false }),
    glass: new MeshBasicMaterial({ color: new Color(0xcfe3ff).multiplyScalar(0.95), toneMapped: false }),
    edges: new LineBasicMaterial({ color: sideColor, transparent: true, opacity: 0.7 }),
    engines: new SpriteMaterial({
      map: glowTexture(),
      color: new Color(0x6fb4ff).multiplyScalar(1.3),
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
  for (const e of geometry.engines) {
    const flare = new Sprite(materials.engines)
    flare.position.set(e.x, 0, e.z + 0.02)
    const size = 0.09 + form.sizeClass * 0.014
    flare.scale.set(size, size, size)
    flare.name = 'engine'
    group.add(flare)
  }

  if (form.art) group.add(artDecal(form.art, form.sizeClass, geometry.top))
  for (const child of group.children) {
    child.castShadow = false
    child.receiveShadow = false
  }
  return { group, materials, geometry }
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

/**
 * Restyle a hull for its state: damage washes the plating toward heat, a
 * derelict goes dark and its drives die, a cloak turns it to a ghost that
 * only its own commander sees.
 */
export function styleHull(
  model: HullModel,
  state: { damage: string; derelict: boolean; ghosted: boolean; cloaked: boolean },
): void {
  const { materials } = model
  const tint = state.derelict ? DAMAGE_TINT.derelict : (DAMAGE_TINT[state.damage] ?? DAMAGE_TINT.none)
  materials.plating.color.setHex(tint)
  const heat = state.damage === 'crippled' ? 0.35 : state.damage === 'heavy' ? 0.18 : 0
  materials.plating.emissive.setRGB(heat * 0.9, heat * 0.25, heat * 0.1)
  materials.engines.opacity = state.derelict ? 0 : 1

  const ghost = state.ghosted || state.cloaked
  for (const m of [materials.plating, materials.deck, materials.trim, materials.glass] as const) {
    m.transparent = ghost
    m.opacity = ghost ? 0.28 : 1
    m.depthWrite = !ghost
  }
  materials.edges.opacity = ghost ? 0.4 : 0.7
}
