/**
 * The commander's instruments, drawn on the board: the selected ship's
 * firing arcs (E2.2) and weapon range rings (E1.2), the line of sight to the
 * current target with its range (E1.1, E2.3), a cut-off sightline to every
 * enemy a planet or moon hides from it (E2.3.1), the plotted move while orders
 * are written (C1, C2), and the ruler.
 *
 * All of it lies flat on the board, just above the grid, and follows the
 * selected hull as it flies — so a ring does not jump ahead of a ship that is
 * still playing its Navigation leg.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from 'three'
import { ARC_ORDER, ARC_START, actualRange } from '../../engine/geometry'
import type { GameState, Terrain } from '../../engine/game'
import { plannedMovement } from '../../engine/navigation'
import type { ShipState } from '../../engine/shipState'
import { adjustedSpeed, isLinked } from '../../engine/tractor'
import { makeLabel, setLabel, type CSS2DObject } from './labels'
import { disposeTree, type FrameContext, type Layer, type LayerContext } from './layer'
import { DEG, SHIP_SIZE, headingToYaw } from './space'
import { blockedSightlines, sightlineCut } from './visibility'

/** Just above the grid, so nothing z-fights with it. */
const FLOOR = 0.03

const ARC_RADIUS = 7

/** The colour of a sightline a world cuts off. */
const BLOCKED = 0xff5a5a

/** Half the length of the bar across a cut-off sightline where the world stops it. */
const CUT_BAR = 0.35

type Locator = (id: string) => { x: number; z: number; heading: number } | null

function flatCircle(radius: number, segments = 128): BufferGeometry {
  const points: number[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    points.push(Math.cos(a) * radius, 0, Math.sin(a) * radius)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(points, 3))
  return geo
}

function polyline(points: Array<{ x: number; y: number }>, altitude = FLOOR): BufferGeometry {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(points.flatMap((p) => [p.x, altitude, p.y]), 3))
  return geo
}

export class OverlaysLayer implements Layer {
  readonly group = new Group()
  /** Rides with the selected ship: arcs and rings are built at its origin. */
  private anchor = new Group()
  /** Turns with the selected ship: the arc fan. */
  private arcs = new Group()
  private rings = new Group()
  private los = new Group()
  private blocked = new Group()
  private blockedLines = new Map<
    string,
    { world: Terrain; line: LineSegments<BufferGeometry, LineBasicMaterial>; mark: CSS2DObject }
  >()
  private targetBlockedBy: Terrain | null = null
  private plot = new Group()
  private ruler = new Group()
  private locate: Locator = () => null
  private selectedId: string | null = null
  private targetId: string | null = null
  private arcsFor: string | null = null
  private ringsKey = ''
  private plotKey = ''
  private losLine: Line<BufferGeometry, LineDashedMaterial> | null = null
  private losLabel: CSS2DObject | null = null
  private rulerLabel: CSS2DObject | null = null

  constructor() {
    this.group.name = 'overlays'
    this.anchor.add(this.arcs, this.rings)
    this.group.add(this.anchor, this.los, this.blocked, this.plot, this.ruler)
  }

  setShipPositions(locate: Locator): void {
    this.locate = locate
  }

  update({ game, view }: LayerContext): void {
    this.selectedId = view.selectedId
    this.targetId = view.targetId
    const selected = game.ships.find((s) => s.id === view.selectedId && !s.destroyed && !s.disengaged) ?? null
    const target = game.ships.find((s) => s.id === view.targetId && !s.destroyed && !s.disengaged) ?? null

    // Firing arcs: built once per selected ship, turned with it each frame.
    const wantArcs = selected && view.showArcs ? selected.id : null
    if (wantArcs !== this.arcsFor) {
      this.clear(this.arcs)
      if (wantArcs) this.buildArcs()
      this.arcsFor = wantArcs
    }

    const ringsKey = selected ? `${selected.id}|${view.rangeRings.map((r) => `${r.band}${r.range}`).join(',')}` : ''
    if (ringsKey !== this.ringsKey) {
      this.clear(this.rings)
      if (selected) this.buildRings(view.rangeRings)
      this.ringsKey = ringsKey
    }

    const hidden = blockedSightlines(game, view.selectedId, view.viewSide)
    this.targetBlockedBy = target ? (hidden.get(target.id) ?? null) : null
    this.updateBlocked(hidden)
    this.updateLos(selected, target)
    this.updatePlot(game, selected, view.viewSide)
  }

  private clear(group: Group): void {
    for (const child of [...group.children]) {
      group.remove(child)
      disposeTree(child)
    }
  }

  private buildArcs(): void {
    for (const arc of ARC_ORDER) {
      // Board degrees: 0 north, clockwise. The fan lies in the ship's frame,
      // so the anchor's turn takes care of heading.
      const start = ARC_START[arc]
      const geo = new CircleGeometry(ARC_RADIUS, 24, 0, 45 * DEG)
      // CircleGeometry sweeps counter-clockwise from +X in its own XY plane;
      // lay it flat, then turn it so it sweeps from `start` clockwise.
      geo.rotateX(-Math.PI / 2)
      geo.rotateY(-((start - 90) * DEG) - 45 * DEG)
      // The 2D fan's amber: a faint wash with brighter spokes, alternating
      // a touch so neighbouring arcs can be told apart.
      const wedge = new Mesh(
        geo,
        new MeshBasicMaterial({
          color: 0xff9c00,
          transparent: true,
          opacity: ARC_ORDER.indexOf(arc) % 2 === 0 ? 0.03 : 0.016,
          side: DoubleSide,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      )
      wedge.position.y = FLOOR
      const edge = new Line(
        polyline([
          { x: 0, y: 0 },
          {
            x: Math.sin(start * DEG) * ARC_RADIUS,
            y: -Math.cos(start * DEG) * ARC_RADIUS,
          },
        ]),
        new LineBasicMaterial({ color: 0xff9c00, transparent: true, opacity: 0.3 }),
      )
      const mid = (start + 22.5) * DEG
      const label = makeLabel(arc, 'l3d-arc')
      label.position.set(Math.sin(mid) * ARC_RADIUS * 0.78, FLOOR, -Math.cos(mid) * ARC_RADIUS * 0.78)
      this.arcs.add(wedge, edge, label)
    }
  }

  private buildRings(rings: GameStateRing[]): void {
    for (const ring of rings) {
      const color = ring.band === 'green' ? 0x57c46f : 0xff9a3c
      const loop = new LineLoop(
        flatCircle(ring.range),
        new LineBasicMaterial({ color, transparent: true, opacity: 0.65, toneMapped: false }),
      )
      loop.position.y = FLOOR
      const band = new Mesh(
        new RingGeometry(ring.range - 0.04, ring.range + 0.04, 128),
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }),
      )
      band.rotation.x = -Math.PI / 2
      band.position.y = FLOOR
      const label = makeLabel(ring.label, `l3d-ring is-${ring.band}`)
      label.position.set(0, FLOOR, -ring.range)
      this.rings.add(loop, band, label)
    }
  }

  private updateLos(selected: ShipState | null, target: ShipState | null): void {
    if (!selected || !target || selected === target) {
      if (this.losLine) this.losLine.visible = false
      if (this.losLabel) this.losLabel.visible = false
      return
    }
    if (!this.losLine) {
      this.losLine = new Line(
        new BufferGeometry(),
        new LineDashedMaterial({ color: 0xffb020, dashSize: 0.4, gapSize: 0.25, transparent: true, opacity: 0.9, toneMapped: false }),
      )
      this.losLabel = makeLabel('', 'l3d-los')
      this.los.add(this.losLine, this.losLabel)
    }
    this.losLine.visible = true
    this.losLabel!.visible = true
    const range = `${actualRange(selected.placement.position, target.placement.position)}"`
    const by = this.targetBlockedBy
    setLabel(this.losLabel!, by ? `${range} · no line of sight (${by.name})` : range, `l3d-los${by ? ' is-blocked' : ''}`)
    this.losLine.material.color.setHex(by ? BLOCKED : 0xffb020)
  }

  /** One cut-off line per hidden enemy: the target's own line already says it, so it gets none. */
  private updateBlocked(hidden: Map<string, Terrain>): void {
    for (const [id, entry] of this.blockedLines) {
      if (hidden.get(id) === entry.world && id !== this.targetId) continue
      this.blocked.remove(entry.line, entry.mark)
      disposeTree(entry.line)
      disposeTree(entry.mark)
      this.blockedLines.delete(id)
    }
    for (const [id, world] of hidden) {
      if (id === this.targetId || this.blockedLines.has(id)) continue
      const line = new LineSegments(
        new BufferGeometry(),
        new LineBasicMaterial({ color: BLOCKED, transparent: true, opacity: 0.85, toneMapped: false }),
      )
      line.frustumCulled = false
      // Where the world stops the line: a no-entry mark, readable from any angle.
      const mark = makeLabel('⊘', 'l3d-cut')
      this.blocked.add(line, mark)
      this.blockedLines.set(id, { world, line, mark })
    }
  }

  private updatePlot(game: GameState, selected: ShipState | null, viewSide: string | null): void {
    const card = selected ? game.orders[selected.id] : undefined
    const show =
      game.segment === 'command' && selected && card && (viewSide === null || selected.side === viewSide)
    if (!show || !selected || !card) {
      if (this.plotKey) this.clear(this.plot)
      this.plotKey = ''
      return
    }
    const towed = isLinked(selected.id, game.ops.links)
    const planned = plannedMovement(
      selected,
      card,
      towed ? adjustedSpeed(selected, game.ops.links, game.ships, card.speed) : undefined,
    )
    const start = selected.placement
    const key = JSON.stringify([planned.path, planned.end, planned.speed, planned.stress, planned.illegal])
    if (key === this.plotKey) return
    this.clear(this.plot)
    this.plotKey = key
    const unmoved =
      planned.end.position.x === start.position.x &&
      planned.end.position.y === start.position.y &&
      planned.end.heading === start.heading
    if (unmoved) return

    const path = new Line(
      polyline(planned.path, FLOOR + 0.01),
      new LineDashedMaterial({ color: 0x9fd0ff, dashSize: 0.3, gapSize: 0.2, toneMapped: false }),
    )
    path.computeLineDistances()
    // The ghost: the footprint the ship is about to occupy, with a bow mark.
    const ghost = new Group()
    ghost.position.set(planned.end.position.x, FLOOR, planned.end.position.y)
    ghost.rotation.y = headingToYaw(planned.end.heading)
    const disc = new Mesh(
      new RingGeometry(SHIP_SIZE / 2 - 0.05, SHIP_SIZE / 2, 48),
      new MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.7, toneMapped: false, side: DoubleSide }),
    )
    disc.rotation.x = -Math.PI / 2
    const bow = new Mesh(
      new CircleGeometry(0.16, 3),
      new MeshBasicMaterial({ color: 0x9fd0ff, toneMapped: false, side: DoubleSide }),
    )
    bow.rotation.x = -Math.PI / 2
    bow.rotation.z = Math.PI / 2
    bow.position.z = -SHIP_SIZE / 2 - 0.12
    ghost.add(disc, bow)
    const label = makeLabel(
      `spd ${planned.speed}` +
        (planned.stress > 0 ? ` · +${planned.stress} stress` : '') +
        (planned.illegal ? ' · ILLEGAL — goes straight' : ''),
      `l3d-plot${planned.illegal ? ' is-illegal' : ''}`,
    )
    label.center.set(0.5, 0)
    label.position.set(planned.end.position.x, FLOOR, planned.end.position.y + SHIP_SIZE / 2 + 0.3)
    this.plot.add(path, ghost, label)
  }

  /** Show, move or clear the ruler. Board inches. */
  setRuler(line: { from: { x: number; y: number }; to: { x: number; y: number } } | null): void {
    this.clear(this.ruler)
    this.rulerLabel = null
    if (!line) return
    const geo = polyline([line.from, line.to], FLOOR + 0.02)
    const stroke = new Line(geo, new LineBasicMaterial({ color: 0xffe08a, toneMapped: false }))
    const ends = [line.from, line.to].map((p) => {
      const dot = new Mesh(new CircleGeometry(0.12, 16), new MeshBasicMaterial({ color: 0xffe08a, toneMapped: false }))
      dot.rotation.x = -Math.PI / 2
      dot.position.set(p.x, FLOOR + 0.02, p.y)
      return dot
    })
    const inches = Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y)
    this.rulerLabel = makeLabel(`${Math.floor(inches)}" (${inches.toFixed(1)})`, 'l3d-ruler')
    this.rulerLabel.position.set((line.from.x + line.to.x) / 2, FLOOR, (line.from.y + line.to.y) / 2)
    this.ruler.add(stroke, ...ends, this.rulerLabel)
  }

  tick(_frame: FrameContext): void {
    const at = this.selectedId ? this.locate(this.selectedId) : null
    for (const [id, { world, line, mark }] of this.blockedLines) {
      const to = this.locate(id)
      // Drawn from where the hulls are right now, so the line stays on them
      // while a leg plays; a frame where the flight clears the world skips it.
      const t = at && to ? sightlineCut({ x: at.x, y: at.z }, { x: to.x, y: to.z }, world) : null
      line.visible = t !== null
      mark.visible = t !== null
      if (!at || !to || t === null) continue
      const cx = at.x + (to.x - at.x) * t
      const cz = at.z + (to.z - at.z) * t
      const len = Math.hypot(to.x - at.x, to.z - at.z) || 1
      const nx = (-(to.z - at.z) / len) * CUT_BAR
      const nz = ((to.x - at.x) / len) * CUT_BAR
      const y = FLOOR + 0.05
      mark.position.set(cx, y, cz)
      line.geometry.setFromPoints([
        new Vector3(at.x, y, at.z),
        new Vector3(cx, y, cz),
        new Vector3(cx - nx, y, cz - nz),
        new Vector3(cx + nx, y, cz + nz),
      ])
    }
    this.anchor.visible = at !== null
    if (at) {
      this.anchor.position.set(at.x, 0, at.z)
      this.arcs.rotation.y = headingToYaw(at.heading)
    }
    if (this.losLine?.visible && this.selectedId && this.targetId) {
      const a = this.locate(this.selectedId)
      const b = this.locate(this.targetId)
      if (a && b) {
        const pts = [new Vector3(a.x, FLOOR + 0.05, a.z), new Vector3(b.x, FLOOR + 0.05, b.z)]
        this.losLine.geometry.setFromPoints(pts)
        this.losLine.computeLineDistances()
        this.losLabel!.position.set((a.x + b.x) / 2, 0.4, (a.z + b.z) / 2)
      } else {
        this.losLine.visible = false
        this.losLabel!.visible = false
      }
    }
  }

  dispose(): void {
    disposeTree(this.group)
  }
}

type GameStateRing = { range: number; label: string; band: 'green' | 'max' }
