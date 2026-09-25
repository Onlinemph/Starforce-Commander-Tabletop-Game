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
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
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
import { buildHull, styleHull, type HullModel } from './hulls'
import { makeLabel, setLabel, type CSS2DObject } from './labels'
import { disposeTree, setTooltip, tagPickable, type FrameContext, type Layer, type LayerContext } from './layer'
import { DEG, HULL_ALTITUDE, SHIELD_COLOR, SHIP_SIZE, headingToYaw, shieldBand, sideColorOf } from './space'
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
  selectRing: Mesh<RingGeometry, MeshBasicMaterial>
  targetRing: Mesh<RingGeometry, MeshBasicMaterial>
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
  private ringGeometry = new RingGeometry(RING_RADIUS + 0.1, RING_RADIUS + 0.14, 64)

  constructor() {
    this.group.name = 'ships'
    this.pickGeometry.userData.shared = true
    this.pickMaterial.userData.shared = true
    this.ringGeometry.userData.shared = true
  }

  /** Where a ship is drawn right now (mid-flight included), for the camera and overlays. */
  drawnPosition(id: string): { x: number; z: number; heading: number } | null {
    const e = this.entries.get(id)
    return e ? { x: e.x, z: e.z, heading: e.heading } : null
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
      this.group.remove(entry.root)
      disposeTree(entry.root)
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

    const ringMaterial = (color: number) =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      })
    const selectRing = new Mesh(this.ringGeometry, ringMaterial(0xcfe6ff))
    selectRing.rotation.x = -Math.PI / 2
    selectRing.position.y = 0.012
    const targetRing = new Mesh(this.ringGeometry, ringMaterial(0xffb020))
    targetRing.rotation.x = -Math.PI / 2
    targetRing.position.y = 0.014
    targetRing.scale.setScalar(1.12)
    root.add(selectRing, targetRing)

    return {
      root,
      turn,
      body,
      model,
      shields,
      name,
      badge,
      selectRing,
      targetRing,
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
    }
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

      const selected = id === this.selectedId
      const targeted = id === this.targetId
      const pulse = 0.4 + 0.2 * Math.sin(now / 320)
      e.selectRing.material.opacity = selected ? pulse : this.hovered === id ? 0.22 : 0
      e.targetRing.material.opacity = targeted ? 0.45 + 0.25 * Math.sin(now / 200) : 0
      e.model.materials.edges.color.setHex(selected ? 0xeaf4ff : targeted ? 0xffb020 : e.edgeBase)
    }
  }

  /** Every pickable root, for the raycaster. */
  pickables(): Object3D[] {
    return [...this.entries.values()].map((e) => e.root)
  }

  dispose(): void {
    for (const e of this.entries.values()) disposeTree(e.root)
    this.entries.clear()
    this.pickGeometry.dispose()
    this.pickMaterial.dispose()
    this.ringGeometry.dispose()
  }
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
