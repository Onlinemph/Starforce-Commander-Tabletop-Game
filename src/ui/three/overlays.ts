/**
 * The commander's instruments, drawn on the board: the selected ship's
 * firing arcs (E2.2) and weapon range rings (E1.2), the line of sight to the
 * current target with its range (E1.1, E2.3), the plotted move while orders
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
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from 'three'
import { ARC_ORDER, ARC_START, actualRange } from '../../engine/geometry'
import type { GameState } from '../../engine/game'
import { plannedMovement } from '../../engine/navigation'
import type { ShipState } from '../../engine/shipState'
import { adjustedSpeed, isLinked } from '../../engine/tractor'
import { makeLabel, setLabel, type CSS2DObject } from './labels'
import { disposeTree, type FrameContext, type Layer, type LayerContext } from './layer'
import { DEG, SHIP_SIZE, headingToYaw } from './space'

/** Just above the grid, so nothing z-fights with it. */
const FLOOR = 0.03

const ARC_RADIUS = 7

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
    this.group.add(this.anchor, this.los, this.plot, this.ruler)
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
      const shade = arc.includes('F') ? 0x4a86ff : arc.includes('A') ? 0xff7a4a : 0x9a7dff
      const wedge = new Mesh(
        geo,
        new MeshBasicMaterial({
          color: shade,
          transparent: true,
          opacity: 0.035,
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
        new LineBasicMaterial({ color: 0x8aa6ff, transparent: true, opacity: 0.35 }),
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
    setLabel(this.losLabel!, `${actualRange(selected.placement.position, target.placement.position)}"`)
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
