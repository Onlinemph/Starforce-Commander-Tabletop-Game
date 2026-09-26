/**
 * The fleets, in 3D: one entry per drawn hull, carrying its model, its four
 * shield arcs, its labels and its selection marks.
 *
 * Everything the 2D counter says, this says too — side colour, damage wash,
 * shield strength per facing (as arcs and as numbers), formation size, the
 * cloak badge, stress and derelict in the name. Hulls fly their Navigation
 * legs the same way the counters do, forward and then pivot, from the same
 * keyframes (motion.ts).
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  TorusGeometry,
  type Object3D,
} from 'three'
import { bestDetection } from '../../engine/cloaking'
import { shipIsCloaked } from '../../engine/game'
import {
  armorRemaining,
  blueShieldRemaining,
  damageLevel,
  greenShieldRemaining,
  type ShipState,
} from '../../engine/shipState'
import { trailDuration, trailIsNewer, trailKeyframes, type MotionKey } from '../motion'
import { animateHull, buildHull, styleHull, type HullModel } from './hulls'
import { glowTexture } from './textures'
import { makeLabel, setLabel, type CSS2DObject } from './labels'
import { disposeTree, setTooltip, tagPickable, type FrameContext, type Layer, type LayerContext } from './layer'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { DEG, HULL_ALTITUDE, SHIELD_COLOR, SHIP_SIZE, SIDE_COLOR, alongHeading, headingToYaw, shieldBand, sideColorOf } from './space'
import { ShieldBubble } from './shieldBubble'
import { Wake } from './wake'
import { drawnShips } from './visibility'

type Facing = 'F' | 'S' | 'A' | 'P'

/** The four shield arcs, in board degrees from +x clockwise — the 2D ring's own numbers. */
const SHIELD_ARCS: ReadonlyArray<readonly [Facing, number, number]> = [
  ['F', -131, -49],
  ['S', -41, 41],
  ['A', 49, 131],
  ['P', 139, 221],
]

/** Where each facing's strength figure sits, hull-local, in inches. */
const FIGURE_AT: Record<Facing, { x: number; z: number }> = {
  F: { x: 0, z: -1.22 },
  A: { x: 0, z: 1.22 },
  S: { x: 1.22, z: 0 },
  P: { x: -1.22, z: 0 },
}

const RING_RADIUS = SHIP_SIZE * 0.62

/** A flat arc of the shield ring, lying on the board, from `start` to `end` board-degrees. */
function arcGeometry(start: number, end: number, tube: number): TorusGeometry {
  const span = Math.max(0.001, end - start)
  const geo = new TorusGeometry(RING_RADIUS, tube, 6, Math.max(4, Math.round(span / 4)), span * DEG)
  geo.rotateX(Math.PI / 2)
  geo.rotateY(-start * DEG)
  return geo
}

function armorOnly(ship: ShipState, side: Facing): boolean {
  return ship.form.shields.blue[side] + ship.form.shields.green[side] === 0 && ship.form.armor[side] > 0
}

interface ShieldArc {
  track: Mesh<TorusGeometry, MeshBasicMaterial>
  fill: Mesh<TorusGeometry, MeshBasicMaterial>
  fraction: number
  figure: CSS2DObject
}

interface Flight {
  keys: MotionKey[]
  start: number
  duration: number
}

interface Entry {
  root: Group
  /** Turns with the hull: model, shield ring and shield figures. */
  turn: Group
  /** Rides the gentle bob, under `turn`. */
  body: Group
  model: HullModel
  shields: Record<Facing, ShieldArc>
  name: CSS2DObject
  badge: CSS2DObject
  /** The holographic selection reticle and the target-lock brackets. */
  reticle: Group
  reticleMaterial: MeshBasicMaterial
  lock: Group
  lockMaterial: MeshBasicMaterial
  /** The ship's speed, which sets how long its drive plumes burn. */
  speed: number
  /** The glowing wake a flying hull leaves behind it. */
  wake: Wake
  /** The shield envelope shown round the selected or hovered hull. */
  bubble: ShieldBubble
  /** Drawn position and unwrapped heading right now. */
  x: number
  z: number
  heading: number
  /** Where the table says the ship is. */
  target: { x: number; z: number; heading: number }
  /** The outline's resting colour, the side colour. */
  edgeBase: number
  flight: Flight | null
  phase: number
  seen: boolean
}

export class ShipsLayer implements Layer {
  readonly group = new Group()
  private entries = new Map<string, Entry>()
  private seenTrails = new Map<string, { round: number; phase: string }>()
  private primed = false
  private hovered: string | null = null
  private selectedId: string | null = null
  private targetId: string | null = null
  private pickGeometry = new CylinderGeometry(SHIP_SIZE / 2, SHIP_SIZE / 2, 0.7, 20)
  private pickMaterial = new MeshBasicMaterial({ visible: false })
  private ringGeometry = new RingGeometry(RING_RADIUS + 0.1, RING_RADIUS + 0.125, 64)
  /** Four short arcs outside the ring, turning slowly: the reticle's ticks. */
  private tickGeometry = mergeGeometries(
    [0, 90, 180, 270].map((deg) => new RingGeometry(RING_RADIUS + 0.2, RING_RADIUS + 0.28, 8, 1, ((deg - 12) * Math.PI) / 180, (24 * Math.PI) / 180)),
  )!
  /** Four corner brackets, the target lock. */
  private bracketGeometry = lockBrackets(RING_RADIUS + 0.42)
  private shadowGeometry = new PlaneGeometry(1, 1)

  constructor() {
    this.group.name = 'ships'
    this.pickGeometry.userData.shared = true
    this.pickMaterial.userData.shared = true
    this.ringGeometry.userData.shared = true
    this.tickGeometry.userData.shared = true
    this.bracketGeometry.userData.shared = true
    this.shadowGeometry.userData.shared = true
  }

  /** Where a ship is drawn right now (mid-flight included), for the camera and overlays. */
  drawnPosition(id: string): { x: number; z: number; heading: number } | null {
    const e = this.entries.get(id)
    return e ? { x: e.x, z: e.z, heading: e.heading } : null
  }

  /** The board rectangle the drawn hulls occupy, or null with none drawn. */
  extent(): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
    if (this.entries.size === 0) return null
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const e of this.entries.values()) {
      minX = Math.min(minX, e.target.x)
      maxX = Math.max(maxX, e.target.x)
      minZ = Math.min(minZ, e.target.z)
      maxZ = Math.max(maxZ, e.target.z)
    }
    return { minX, maxX, minZ, maxZ }
  }

  setHovered(id: string | null): void {
    this.hovered = id
  }

  update({ game, view, now }: LayerContext): void {
    this.selectedId = view.selectedId
    this.targetId = view.targetId
    const drawn = drawnShips(game, view.viewSide)
    const live = new Set<string>()

    for (const { ship, formationSize, ghosted } of drawn) {
      live.add(ship.id)
      let entry = this.entries.get(ship.id)
      if (!entry) {
        entry = this.create(ship)
        this.entries.set(ship.id, entry)
        this.group.add(entry.root)
      }

      // Movement playback: a leg newer than the last one shown flies once.
      const trail = game.trails?.[ship.id]
      if (trail) {
        const newer = trailIsNewer(trail, this.seenTrails.get(ship.id))
        this.seenTrails.set(ship.id, { round: trail.round, phase: trail.phase })
        if (newer && this.primed && entry.seen) {
          const keys = trailKeyframes(trail, ship.placement, entry.heading)
          if (keys.length >= 2) entry.flight = { keys, start: now, duration: trailDuration(keys) }
        }
      }
      entry.target = { x: ship.placement.position.x, z: ship.placement.position.y, heading: ship.placement.heading }
      entry.speed = ship.speed
      if (!entry.seen) {
        // First sight: appear where the table says, no flight.
        entry.x = entry.target.x
        entry.z = entry.target.z
        entry.heading = entry.target.heading
        entry.seen = true
      }

      const cloak = game.cloaks[ship.id]
      const running = shipIsCloaked(game, ship)
      styleHull(entry.model, {
        damage: damageLevel(ship),
        derelict: ship.derelict && !ship.destroyed,
        ghosted,
        cloaked: running,
      })
      this.updateShields(entry, ship, running)

      const label =
        `${ship.name} · spd ${ship.speed}` +
        (formationSize > 1 ? ` · formation of ${formationSize}` : '') +
        (ship.stressMarkers > 0 ? ` · ${ship.stressMarkers} stress` : '') +
        (ship.derelict ? ' · DERELICT' : '')
      setLabel(entry.name, label, `l3d-name l3d-${sideColorOf(ship.side)}${ghosted ? ' is-ghost' : ''}`)

      const badge = cloak?.engaged
        ? bestDetection(cloak) === 0
          ? 'CLK'
          : `CLK-${['', 'C', 'T', 'L'][bestDetection(cloak)]}`
        : formationSize > 1
          ? `×${formationSize}`
          : ''
      setLabel(entry.badge, badge, `l3d-badge${cloak?.engaged ? ' is-cloak' : ''}`)
      entry.badge.visible = badge !== ''

      setTooltip(
        entry.root,
        `${ship.name} — ${ship.form.name}\n` +
          `speed ${ship.speed} · heading ${Math.round(ship.placement.heading)}° · ` +
          `${ship.derelict && !ship.destroyed ? 'derelict' : damageLevel(ship)}\n` +
          `stress ${ship.stressMarkers}` +
          (view.viewSide !== null && ship.side !== view.viewSide ? '' : ` · marines ${ship.marineSquads}`) +
          (ghosted ? '\nCLOAKED — visible only to you' : '') +
          (ship.derelict ? '\nDERELICT' : '') +
          (ship.capturedBy ? `\ncaptured by ${ship.capturedBy}` : ''),
      )
    }

    for (const [id, entry] of this.entries) {
      if (live.has(id)) continue
      this.group.remove(entry.root, entry.wake.mesh)
      disposeTree(entry.root)
      entry.wake.dispose()
      entry.bubble.dispose()
      this.entries.delete(id)
    }
    this.primed = true
  }

  private create(ship: ShipState): Entry {
    const root = new Group()
    root.name = `ship:${ship.id}`
    tagPickable(root, { kind: 'ship', id: ship.id })
    const turn = new Group()
    const body = new Group()
    root.add(turn)
    turn.add(body)

    const model = buildHull(ship.form, sideColorOf(ship.side))
    body.add(model.group)

    const hit = new Mesh(this.pickGeometry, this.pickMaterial)
    hit.position.y = HULL_ALTITUDE
    root.add(hit)

    const shields = {} as Record<Facing, ShieldArc>
    for (const [side, start, end] of SHIELD_ARCS) {
      const track = new Mesh(
        arcGeometry(start, end, 0.022),
        new MeshBasicMaterial({ color: 0x96b4dc, transparent: true, opacity: 0.18, depthWrite: false }),
      )
      const fill = new Mesh(
        arcGeometry(start, end, 0.03),
        new MeshBasicMaterial({ color: SHIELD_COLOR.strong, toneMapped: false, transparent: true, opacity: 0.95 }),
      )
      track.position.y = HULL_ALTITUDE * 0.35
      fill.position.y = HULL_ALTITUDE * 0.35
      turn.add(track, fill)
      const figure = makeLabel('', 'l3d-shield')
      figure.position.set(FIGURE_AT[side].x, HULL_ALTITUDE * 0.35, FIGURE_AT[side].z)
      turn.add(figure)
      shields[side] = { track, fill, fraction: 1, figure }
    }

    const name = makeLabel(ship.name, 'l3d-name')
    name.center.set(0.5, 0)
    name.position.set(0, 0, RING_RADIUS + 0.62)
    root.add(name)

    const badge = makeLabel('', 'l3d-badge')
    badge.position.set(0, HULL_ALTITUDE + 0.2, -(RING_RADIUS + 0.55))
    root.add(badge)

    // Grounding: a soft dark shadow on the board under the hull, and a pool
    // of the side's colour around it, so ships sit on the table and their
    // allegiance reads even from far off.
    const shadow = new Mesh(
      this.shadowGeometry,
      new MeshBasicMaterial({ color: 0x000000, map: glowTexture(), transparent: true, opacity: 0.8, depthWrite: false }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.011
    shadow.scale.set(model.geometry.halfBeam * 3.2, model.geometry.halfLength * 2.9, 1)
    const pool = new Mesh(
      this.shadowGeometry,
      new MeshBasicMaterial({
        color: new Color(SIDE_COLOR[sideColorOf(ship.side)]),
        map: glowTexture(),
        transparent: true,
        opacity: 0.22,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    )
    pool.rotation.x = -Math.PI / 2
    pool.position.y = 0.012
    pool.scale.setScalar(SHIP_SIZE * 1.35)
    turn.add(shadow)
    root.add(pool)

    const reticleMaterial = new MeshBasicMaterial({
      color: 0xcfe6ff,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    })
    const reticle = new Group()
    reticle.add(new Mesh(this.ringGeometry, reticleMaterial), new Mesh(this.tickGeometry, reticleMaterial))
    reticle.rotation.x = -Math.PI / 2
    reticle.position.y = 0.014
    const lockMaterial = new MeshBasicMaterial({
      color: new Color(0xffb020).multiplyScalar(1.4),
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: DoubleSide,
    })
    const lock = new Group()
    lock.add(new Mesh(this.bracketGeometry, lockMaterial))
    lock.rotation.x = -Math.PI / 2
    lock.position.y = 0.016
    root.add(reticle, lock)

    // The wake lives in world space, in the layer's own group, since it
    // traces where the hull has been rather than riding along with it.
    const wake = new Wake(0x6fb4ff, Math.max(0.08, model.geometry.halfBeam * 0.55))
    this.group.add(wake.mesh)

    const bubble = new ShieldBubble(model.geometry.halfBeam, model.geometry.halfLength, Math.max(0.32, model.geometry.top * 2.2))
    body.add(bubble.mesh)

    return {
      root,
      turn,
      body,
      model,
      shields,
      name,
      badge,
      reticle,
      reticleMaterial,
      lock,
      lockMaterial,
      speed: ship.speed,
      wake,
      bubble,
      x: ship.placement.position.x,
      z: ship.placement.position.y,
      heading: ship.placement.heading,
      target: { x: ship.placement.position.x, z: ship.placement.position.y, heading: ship.placement.heading },
      edgeBase: model.materials.edges.color.getHex(),
      flight: null,
      phase: (ship.id.length * 1.7) % (Math.PI * 2),
      seen: false,
    }
  }

  private updateShields(entry: Entry, ship: ShipState, cloakRunning: boolean): void {
    const facings = {} as Record<Facing, { color: number; fraction: number }>
    for (const [side, start, end] of SHIELD_ARCS) {
      const arc = entry.shields[side]
      const armor = armorOnly(ship, side)
      const printed = armor ? ship.form.armor[side] : ship.form.shields.blue[side] + ship.form.shields.green[side]
      // Armour cannot be lowered and a cloak does not switch it off.
      const down = !armor && (ship.shieldsDown[side] || cloakRunning)
      const remaining = armor
        ? armorRemaining(ship, side)
        : blueShieldRemaining(ship, side) + greenShieldRemaining(ship, side)
      const fraction = printed > 0 ? Math.min(1, remaining / printed) : 0
      const band = shieldBand(fraction)

      if (Math.abs(fraction - arc.fraction) > 1e-3) {
        arc.fill.geometry.dispose()
        arc.fill.geometry = arcGeometry(start, start + (end - start) * Math.max(fraction, 0.001), 0.03)
        arc.fraction = fraction
      }
      arc.fill.visible = !down && fraction > 0
      arc.fill.material.color.setHex(armor && band === 'strong' ? SHIELD_COLOR.armor : SHIELD_COLOR[band])
      const dead = down || fraction <= 0
      arc.track.material.color.setHex(dead ? 0xff6b4a : armor ? 0xbec4d0 : 0x96b4dc)
      arc.track.material.opacity = dead ? 0.42 : 0.18

      // The printed figure: blue+green, armour for an armour facing, a dash
      // for a lowered or cloaked shield.
      const green = greenShieldRemaining(ship, side)
      const blue = blueShieldRemaining(ship, side)
      const text = armor
        ? `${armorRemaining(ship, side)}`
        : down
          ? '—'
          : green > 0
            ? `${blue}+${green}`
            : `${blue}`
      setLabel(arc.figure, text, `l3d-shield is-${dead ? 'gone' : band}`)
      // Armour is plate, not energy: it has no place in the bubble.
      facings[side] = { color: SHIELD_COLOR[band === 'gone' ? 'weak' : band], fraction: armor || dead ? 0 : Math.max(0.15, fraction) }
    }
    entry.bubble.setFacings(facings)
  }

  tick({ now, dt, reducedMotion }: FrameContext): void {
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
    for (const [id, e] of this.entries) {
      if (e.flight && !reducedMotion) {
        const t = Math.min(1, (now - e.flight.start) / e.flight.duration)
        const k = sampleKeys(e.flight.keys, ease(t))
        e.x = k.x
        e.z = k.y
        e.heading = k.heading
        if (t >= 1) e.flight = null
      } else {
        e.flight = null
        // Anything else that moves a counter (a replay scrub, a tractor tow)
        // glides there the way the 2D counter's CSS transition does.
        const a = reducedMotion ? 1 : 1 - Math.exp(-dt * 10)
        e.x += (e.target.x - e.x) * a
        e.z += (e.target.z - e.z) * a
        const delta = ((e.target.heading - e.heading + 540) % 360) - 180
        e.heading += delta * a
      }
      e.root.position.set(e.x, 0, e.z)
      e.turn.rotation.y = headingToYaw(e.heading)
      const bob = reducedMotion ? 0 : Math.sin(now / 1100 + e.phase) * 0.025
      e.body.position.y = HULL_ALTITUDE + bob
      e.body.rotation.z = reducedMotion ? 0 : Math.sin(now / 1700 + e.phase) * 0.02

      animateHull(e.model, now, dt, e.speed, reducedMotion)
      e.bubble.tick(id === this.selectedId ? 1 : this.hovered === id ? 0.55 : 0, now, dt)
      if (!reducedMotion) {
        const stern = alongHeading({ x: e.x, z: e.z }, e.heading, -e.model.geometry.halfLength)
        e.wake.update(stern, HULL_ALTITUDE * 0.7, e.flight !== null, now, dt)
      }

      const selected = id === this.selectedId
      const targeted = id === this.targetId
      const pulse = 0.55 + 0.2 * Math.sin(now / 320)
      e.reticleMaterial.opacity = selected ? pulse : this.hovered === id ? 0.25 : 0
      e.reticle.visible = e.reticleMaterial.opacity > 0
      if (!reducedMotion) e.reticle.rotation.z = now / 4000
      e.lockMaterial.opacity = targeted ? 0.6 + 0.3 * Math.sin(now / 180) : 0
      e.lock.visible = targeted
      if (targeted && !reducedMotion) {
        e.lock.rotation.z = -now / 2500
        e.lock.scale.setScalar(1 + 0.04 * Math.sin(now / 260))
      }
      e.model.materials.edges.color.setHex(selected ? 0xeaf4ff : targeted ? 0xffb020 : e.edgeBase)
    }
  }

  /** Every pickable root, for the raycaster. */
  pickables(): Object3D[] {
    return [...this.entries.values()].map((e) => e.root)
  }

  dispose(): void {
    for (const e of this.entries.values()) {
      disposeTree(e.root)
      e.wake.dispose()
      e.bubble.dispose()
    }
    this.entries.clear()
    this.pickGeometry.dispose()
    this.pickMaterial.dispose()
    this.ringGeometry.dispose()
    this.tickGeometry.dispose()
    this.bracketGeometry.dispose()
    this.shadowGeometry.dispose()
  }
}

/** Four L-shaped corner brackets around a square of half-size `r`, flat in XY. */
function lockBrackets(r: number): BufferGeometry {
  const arm = r * 0.32
  const w = 0.05
  const corner = (sx: number, sy: number) => {
    const shape = new Shape()
    shape.moveTo(sx * r, sy * r)
    shape.lineTo(sx * (r - arm), sy * r)
    shape.lineTo(sx * (r - arm), sy * (r - w))
    shape.lineTo(sx * (r - w), sy * (r - w))
    shape.lineTo(sx * (r - w), sy * (r - arm))
    shape.lineTo(sx * r, sy * (r - arm))
    shape.closePath()
    return shape
  }
  return new ShapeGeometry([corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)])
}

/** Position and heading at `t` (0..1) along keyframes with offsets. */
export function sampleKeys(keys: readonly MotionKey[], t: number): MotionKey {
  if (t <= keys[0].offset) return keys[0]
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]
    if (t <= b.offset) {
      const a = keys[i - 1]
      const span = b.offset - a.offset || 1
      const u = (t - a.offset) / span
      return {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        heading: a.heading + (b.heading - a.heading) * u,
        offset: t,
      }
    }
  }
  return keys[keys.length - 1]
}
