import { useMemo, useRef, useState } from 'react'
import { positionIsHidden } from '../engine/cloaking'
import { Rng } from '../engine/dice'
import { formationOf } from '../engine/formation'
import { ARC_ORDER, ARC_START, actualRange, headingVector } from '../engine/geometry'
import type { GameState, TerrainKind } from '../engine/game'
import { plannedMovement } from '../engine/navigation'
import {
  blueShieldRemaining,
  damageLevel,
  greenShieldRemaining,
  type ShipState,
} from '../engine/shipState'
import { adjustedSpeed, isLinked } from '../engine/tractor'
import type { Arc } from '../engine/types'

/**
 * The play surface (A2.9). Rendered at 1 inch = `SCALE` pixels so every
 * measurement on screen matches the rulebook's inches directly.
 */

const SCALE = 20

/**
 * A margin of space drawn outside the play area, in pixels. It carries no
 * rules meaning — the board edge is still drawn, and still where the scenario
 * bounds say it is — but a ship sitting on the boundary can now show its name
 * and shield readouts instead of having them clipped away.
 */
const MARGIN = 16

/**
 * The starfield is decoration, but it must not crawl about between renders or
 * the map stops reading as a fixed place. Seeding the engine's own RNG from the
 * board size pins every star for a given scenario.
 */
const STARFIELD_SEED = 0x5f0cd1

interface Star {
  x: number
  y: number
  r: number
  o: number
}

function useStarfield(w: number, h: number): { dust: Star[]; bright: Star[] } {
  return useMemo(() => {
    const rng = new Rng(STARFIELD_SEED ^ (w * 73856093) ^ (h * 19349663))
    const dust: Star[] = []
    const bright: Star[] = []
    // One star per ~1,300 square pixels: dense enough to read as deep space,
    // sparse enough that counters and range rings stay the loudest thing here.
    const count = Math.round((w * h) / 1300)
    for (let i = 0; i < count; i++) {
      const size = rng.next()
      const star = {
        x: Math.round(rng.next() * w),
        y: Math.round(rng.next() * h),
        // Cubed so the great majority are pinpricks and only a few have body.
        r: 0.3 + size * size * size * 1.9,
        o: 0.15 + rng.next() * 0.65,
      }
      if (star.r > 1.5 && bright.length < 14) bright.push(star)
      else dust.push(star)
    }
    return { dust, bright }
  }, [w, h])
}

/** Planets and moons are both solid lit bodies, and are drawn the same way. */
function isWorld(kind: TerrainKind): boolean {
  return kind === 'planet' || kind === 'moon'
}

/** Faint gas banks well behind the action, for depth (purely cosmetic). */
function useNebulae(w: number, h: number) {
  return useMemo(() => {
    const rng = new Rng((STARFIELD_SEED ^ 0x9e37) + w + h * 31)
    const tints = ['url(#neb-a)', 'url(#neb-b)', 'url(#neb-c)']
    return tints.map((fill, i) => ({
      fill,
      cx: (0.12 + rng.next() * 0.76) * w,
      cy: (0.12 + rng.next() * 0.76) * h,
      rx: (0.22 + rng.next() * 0.24) * w,
      ry: (0.18 + rng.next() * 0.2) * h,
      rotate: rng.next() * 180,
      key: i,
    }))
  }, [w, h])
}

/** Keep the visible window on the board as zoom and pan change. */
function clampView(
  v: { x: number; y: number; zoom: number },
  fullW: number,
  fullH: number,
): { x: number; y: number; zoom: number } {
  const maxX = fullW - fullW / v.zoom
  const maxY = fullH - fullH / v.zoom
  return {
    zoom: v.zoom,
    x: Math.min(maxX, Math.max(0, v.x)),
    y: Math.min(maxY, Math.max(0, v.y)),
  }
}

interface Props {
  game: GameState
  selectedId: string | null
  targetId: string | null
  onSelect: (id: string) => void
  /** Draw the eight 45-degree arcs around the selected ship (E2.2). */
  showArcs: boolean
  /** Range rings for the selected ship's weapons (E1.2). */
  rangeRings: RangeRing[]
  /**
   * The side whose player is looking (B1.9), or null for the open table.
   * A side view sees its own cloaked ships ghosted, and enemy counters
   * redacted down to what the physical table would show.
   */
  viewSide: string | null
}

export interface RangeRing {
  range: number
  label: string
  band: 'green' | 'max'
}

export function MapView({ game, selectedId, targetId, onSelect, showArcs, rangeRings, viewSide }: Props) {
  const { width, height } = game.scenario.bounds
  const w = width * SCALE
  const h = height * SCALE

  const selected = game.ships.find((s) => s.id === selectedId) ?? null
  const target = game.ships.find((s) => s.id === targetId) ?? null

  /**
   * Zoom and pan, as a plain viewBox transform. Wheel zooms about the cursor,
   * dragging empty space pans, double-click resets. The 1" = 20px drawing
   * scale is untouched — zoom changes how much of the board the window shows,
   * never where anything is.
   */
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const fullW = w + MARGIN * 2
  const fullH = h + MARGIN * 2
  const viewBox = `${-MARGIN + view.x} ${-MARGIN + view.y} ${fullW / view.zoom} ${fullH / view.zoom}`

  /** Map a pointer event to board coordinates under the current view. */
  const toBoard = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: -MARGIN + view.x + ((e.clientX - rect.left) / rect.width) * (fullW / view.zoom),
      y: -MARGIN + view.y + ((e.clientY - rect.top) / rect.height) * (fullH / view.zoom),
    }
  }

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const at = toBoard(e)
    setView((v) => {
      const zoom = Math.min(8, Math.max(1, v.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))
      if (zoom === v.zoom) return v
      // Keep the point under the cursor stationary through the zoom.
      const x = at.x - (at.x - (-MARGIN + v.x)) * (v.zoom / zoom) + MARGIN
      const y = at.y - (at.y - (-MARGIN + v.y)) * (v.zoom / zoom) + MARGIN
      return clampView({ x, y, zoom }, fullW, fullH)
    })
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (view.zoom === 1) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const rect = svgRef.current!.getBoundingClientRect()
    const dx = ((e.clientX - d.x) / rect.width) * (fullW / view.zoom)
    const dy = ((e.clientY - d.y) / rect.height) * (fullH / view.zoom)
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true
    drag.current = { x: e.clientX, y: e.clientY, moved: d.moved }
    setView((v) => clampView({ x: v.x - dx, y: v.y - dy, zoom: v.zoom }, fullW, fullH))
  }
  const onPointerUp = () => {
    // A drag that moved should not also read as a ship click.
    if (drag.current?.moved) suppressClick.current = true
    drag.current = null
  }
  const suppressClick = useRef(false)
  const select = (id: string) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    onSelect(id)
  }

  const grid = useMemo(() => {
    const lines: React.ReactElement[] = []
    for (let i = 3; i < width; i += 3) {
      lines.push(<line key={`v${i}`} x1={i * SCALE} y1={0} x2={i * SCALE} y2={h} className="grid" />)
    }
    for (let i = 3; i < height; i += 3) {
      lines.push(<line key={`h${i}`} x1={0} y1={i * SCALE} x2={w} y2={i * SCALE} className="grid" />)
    }
    return lines
  }, [width, height, w, h])

  const { dust, bright } = useStarfield(w, h)
  const nebulae = useNebulae(w, h)

  return (
    <svg
      className={`map${view.zoom > 1 ? ' is-zoomed' : ''}`}
      ref={svgRef}
      viewBox={viewBox}
      role="img"
      aria-label="Play surface"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => setView({ x: 0, y: 0, zoom: 1 })}
    >
      <SpaceDefs />

      {/* ── Deep space ──────────────────────────────────────────────────── */}
      <rect
        x={-MARGIN}
        y={-MARGIN}
        width={w + MARGIN * 2}
        height={h + MARGIN * 2}
        className={`map-bg${game.scenario.nebula ? ' is-nebula' : ''}`}
      />

      {/* Gas banks first, so stars burn through them. */}
      <g className="nebula-field">
        {nebulae.map((n) => (
          <ellipse
            key={n.key}
            cx={n.cx}
            cy={n.cy}
            rx={n.rx}
            ry={n.ry}
            fill={n.fill}
            transform={`rotate(${n.rotate} ${n.cx} ${n.cy})`}
          />
        ))}
      </g>

      <g className="starfield">
        {dust.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#dce6ff" opacity={s.o} />
        ))}
        {bright.map((s, i) => (
          <g key={`b${i}`} className="star-bright">
            {/* A four-point flare reads as a nearby star rather than a speck. */}
            <path
              d={`M ${s.x - s.r * 5} ${s.y} H ${s.x + s.r * 5} M ${s.x} ${s.y - s.r * 5} V ${s.y + s.r * 5}`}
              stroke="#cfe0ff"
              strokeWidth={0.6}
              opacity={0.35}
            />
            <circle cx={s.x} cy={s.y} r={s.r} fill="#ffffff" opacity={0.9} />
          </g>
        ))}
      </g>

      {grid}

      {/* The edge of the play area (A2.9): leaving it is disengagement (J9), so
          it has to stay visible now that space is drawn beyond it. */}
      <rect x={0} y={0} width={w} height={h} className="map-edge" />

      {/* Terrain (Section K) */}
      {game.scenario.terrain.map((feature) => (
        <g key={feature.id} className={`terrain-group terrain-group-${feature.kind}`}>
          {isWorld(feature.kind) && (
            /* A halo of scattered light, so a world reads as lit from a star
               rather than as a flat disc. */
            <circle
              cx={feature.center.x * SCALE}
              cy={feature.center.y * SCALE}
              r={feature.radius * SCALE * 1.22}
              className="planet-halo"
            />
          )}
          <circle
            cx={feature.center.x * SCALE}
            cy={feature.center.y * SCALE}
            r={feature.radius * SCALE}
            className={`terrain terrain-${feature.kind}`}
          />
          {isWorld(feature.kind) && (
            /* The night side. Offset the same way for every world so the whole
               map is lit from one direction. */
            <circle
              cx={feature.center.x * SCALE}
              cy={feature.center.y * SCALE}
              r={feature.radius * SCALE}
              className="planet-terminator"
            />
          )}
          {feature.kind === 'asteroid-field' && (
            <AsteroidScatter
              cx={feature.center.x * SCALE}
              cy={feature.center.y * SCALE}
              r={feature.radius * SCALE}
              seed={feature.id}
            />
          )}
          <text
            x={feature.center.x * SCALE}
            y={feature.center.y * SCALE}
            className="terrain-label"
            textAnchor="middle"
          >
            {feature.name}
          </text>
        </g>
      ))}

      {/* Range rings from the selected ship's weapon brackets (E1.2) */}
      {selected &&
        rangeRings.map((ring) => (
          <g key={`${ring.label}-${ring.range}`}>
            <circle
              cx={selected.placement.position.x * SCALE}
              cy={selected.placement.position.y * SCALE}
              r={ring.range * SCALE}
              className={`range-ring range-ring-${ring.band}`}
            />
            <text
              x={selected.placement.position.x * SCALE}
              y={selected.placement.position.y * SCALE - ring.range * SCALE - 3}
              className="range-ring-label"
              textAnchor="middle"
            >
              {ring.label}
            </text>
          </g>
        ))}

      {/* Firing arcs of the selected ship (E2.2.3) */}
      {selected && showArcs && <ArcOverlay ship={selected} />}

      {/* Line of sight to the current target (E2.3.1) */}
      {selected && target && selected !== target && (
        <g>
          <line
            x1={selected.placement.position.x * SCALE}
            y1={selected.placement.position.y * SCALE}
            x2={target.placement.position.x * SCALE}
            y2={target.placement.position.y * SCALE}
            className="los"
          />
          <text
            x={((selected.placement.position.x + target.placement.position.x) / 2) * SCALE}
            y={((selected.placement.position.y + target.placement.position.y) / 2) * SCALE - 6}
            className="los-label"
            textAnchor="middle"
          >
            {actualRange(selected.placement.position, target.placement.position)}&quot;
          </text>
        </g>
      )}

      {/* Homing weapons in flight (E5.1.9) — 3/4-inch counters. */}
      {game.homing.map((hw) => (
        <g key={hw.id} className={`homing homing-${hw.side === game.ships[0]?.side ? 'blue' : 'red'}`}>
          <rect
            x={hw.position.x * SCALE - (0.375 * SCALE)}
            y={hw.position.y * SCALE - (0.375 * SCALE)}
            width={0.75 * SCALE}
            height={0.75 * SCALE}
            className="homing-counter"
          />
          {/* The white dot is the counter's position for range and movement. */}
          <circle cx={hw.position.x * SCALE} cy={hw.position.y * SCALE} r={1.5} className="homing-dot" />
        </g>
      ))}

      {/*
        A cloaked, undetected ship leaves only a datum behind — the spot it was
        last seen (H6.2.2).
      */}
      {Object.entries(game.cloaks).map(([id, cloak]) => {
        if (!positionIsHidden(cloak)) return null
        const ship = game.ships.find((s) => s.id === id)
        if (!ship || ship.destroyed || ship.disengaged) return null
        return (
          <g key={`datum-${id}`} className="datum">
            <circle
              cx={cloak.datum.position.x * SCALE}
              cy={cloak.datum.position.y * SCALE}
              r={0.75 * SCALE}
              className="datum-ring"
            />
            <text
              x={cloak.datum.position.x * SCALE}
              y={cloak.datum.position.y * SCALE + 4}
              className="datum-label"
              textAnchor="middle"
            >
              DATUM
            </text>
          </g>
        )
      })}

      {/* Tractor beam links (J3) — a line between the beam and what it holds. */}
      {game.ops.links.map((link) => {
        const source = game.ships.find((s) => s.id === link.sourceId)
        const target =
          game.ships.find((s) => s.id === link.targetId)?.placement.position ??
          game.smallCraft.find((c) => c.id === link.targetId)?.position
        if (!source || !target) return null
        return (
          <line
            key={link.id}
            x1={source.placement.position.x * SCALE}
            y1={source.placement.position.y * SCALE}
            x2={target.x * SCALE}
            y2={target.y * SCALE}
            className="tractor-link"
          />
        )
      })}

      {/* Shuttles and probes (E12, J7, J8) — half-inch counters. */}
      {game.smallCraft.map((craft) => (
        <g key={craft.id} className={`small-craft small-craft-${craft.kind}`}>
          {craft.kind === 'probe' ? (
            <circle
              cx={craft.position.x * SCALE}
              cy={craft.position.y * SCALE}
              r={0.25 * SCALE}
              className="craft-counter"
            />
          ) : (
            <rect
              x={craft.position.x * SCALE - 0.25 * SCALE}
              y={craft.position.y * SCALE - 0.25 * SCALE}
              width={0.5 * SCALE}
              height={0.5 * SCALE}
              className="craft-counter"
            />
          )}
          <text
            x={craft.position.x * SCALE}
            y={craft.position.y * SCALE + 0.25 * SCALE + 9}
            className="craft-label"
            textAnchor="middle"
          >
            {craft.kind === 'probe' ? 'PROBE' : craft.kind === 'jamming-shuttle' ? 'JAM' : 'SHTL'}
          </text>
        </g>
      ))}

      {/*
        Only the lead ship's counter stays on the map when ships fly in
        formation (C5.1.3), so members are drawn as a strength badge on the
        lead rather than as counters stacked in the same square. A cloaked ship
        that has not been detected is not drawn at all (H6.2.2).
      */}
      {game.ships
        .filter((ship) => {
          const cloak = game.cloaks[ship.id]
          // A cloaked, undetected ship is off the table (H6.2.2) — except to
          // its own commander, who tracks it in secret. The open table hides
          // it from everyone, since both players share that screen.
          if (cloak && positionIsHidden(cloak) && ship.side !== viewSide) return false
          const formation = formationOf(game.formations, ship.id)
          return !formation || formation.leadId === ship.id
        })
        .map((ship) => (
          <ShipToken
            key={ship.id}
            ship={ship}
            selected={ship.id === selectedId}
            targeted={ship.id === targetId}
            formationSize={
              (formationOf(game.formations, ship.id)?.memberIds.length ?? 0) + 1
            }
            cloaked={Boolean(game.cloaks[ship.id] && positionIsHidden(game.cloaks[ship.id]))}
            redacted={viewSide !== null && ship.side !== viewSide}
            onSelect={select}
          />
        ))}

      {/*
        Plot preview: while orders are being written, the selected ship shows
        where its current card will put it when the Navigation Segment reveals
        the plots — computed by the same code that will move it (C1, C2).
        Only the ship whose card is on screen is previewed, so nothing an
        opponent has plotted leaks onto the shared map.
      */}
      {game.segment === 'command' &&
        selected &&
        !selected.destroyed &&
        !selected.disengaged &&
        (viewSide === null || selected.side === viewSide) && (
          <PlotPreview game={game} ship={selected} />
        )}

      {/* Corner falloff, drawn last and click-through, to seat the board in
          the surrounding chrome. */}
      <rect
        x={-MARGIN}
        y={-MARGIN}
        width={w + MARGIN * 2}
        height={h + MARGIN * 2}
        className="map-vignette"
      />
    </svg>
  )
}

/**
 * Gradients and filters for the play surface. Cosmetic only — nothing here
 * carries rules meaning, and none of it changes the 1 inch = 20 px scale.
 */
function SpaceDefs() {
  return (
    <defs>
      <radialGradient id="neb-a" cx="50%" cy="50%">
        <stop offset="0%" stopColor="#3d2a6b" stopOpacity="0.55" />
        <stop offset="55%" stopColor="#241a45" stopOpacity="0.26" />
        <stop offset="100%" stopColor="#0a0a18" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="neb-b" cx="50%" cy="50%">
        <stop offset="0%" stopColor="#0f4a63" stopOpacity="0.45" />
        <stop offset="60%" stopColor="#0a2c40" stopOpacity="0.2" />
        <stop offset="100%" stopColor="#05121c" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="neb-c" cx="50%" cy="50%">
        <stop offset="0%" stopColor="#5a2440" stopOpacity="0.34" />
        <stop offset="60%" stopColor="#2c1226" stopOpacity="0.16" />
        <stop offset="100%" stopColor="#0d0611" stopOpacity="0" />
      </radialGradient>

      {/* Lit from the upper left, consistently across the board. */}
      <radialGradient id="planet-lit" cx="34%" cy="30%" r="78%">
        <stop offset="0%" stopColor="#7ea8d8" />
        <stop offset="45%" stopColor="#33587f" />
        <stop offset="100%" stopColor="#0e1d30" />
      </radialGradient>
      <radialGradient id="planet-night" cx="34%" cy="30%" r="72%">
        <stop offset="55%" stopColor="#000000" stopOpacity="0" />
        <stop offset="100%" stopColor="#01030a" stopOpacity="0.85" />
      </radialGradient>
      <radialGradient id="planet-glow" cx="50%" cy="50%">
        <stop offset="70%" stopColor="#5f9fd4" stopOpacity="0" />
        <stop offset="88%" stopColor="#5f9fd4" stopOpacity="0.16" />
        <stop offset="100%" stopColor="#5f9fd4" stopOpacity="0" />
      </radialGradient>

      <radialGradient id="cloud-fill" cx="50%" cy="50%">
        <stop offset="0%" stopColor="#6b5cc4" stopOpacity="0.5" />
        <stop offset="70%" stopColor="#40357e" stopOpacity="0.32" />
        <stop offset="100%" stopColor="#2a2258" stopOpacity="0.05" />
      </radialGradient>

      <radialGradient id="map-falloff" cx="50%" cy="50%" r="72%">
        <stop offset="60%" stopColor="#000000" stopOpacity="0" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0.55" />
      </radialGradient>
    </defs>
  )
}

/**
 * Individual rocks inside an asteroid field's radius (K3). Decoration over the
 * real circle — the circle is still what the rules measure against.
 */
function AsteroidScatter({ cx, cy, r, seed }: { cx: number; cy: number; r: number; seed: string }) {
  const rocks = useMemo(() => {
    let n = 0
    for (let i = 0; i < seed.length; i++) n = (n * 31 + seed.charCodeAt(i)) | 0
    const rng = new Rng(n ^ 0x1d3f)
    return Array.from({ length: Math.max(14, Math.round(r / 3)) }, () => {
      // Square-rooted radius so rocks spread evenly over the area, not bunched
      // at the middle.
      const d = Math.sqrt(rng.next()) * r * 0.92
      const a = rng.next() * Math.PI * 2
      return {
        x: cx + Math.cos(a) * d,
        y: cy + Math.sin(a) * d,
        size: 1 + rng.next() * 2.6,
        o: 0.3 + rng.next() * 0.5,
      }
    })
  }, [cx, cy, r, seed])

  return (
    <g className="asteroid-rocks">
      {rocks.map((rock, i) => (
        <circle key={i} cx={rock.x} cy={rock.y} r={rock.size} opacity={rock.o} />
      ))}
    </g>
  )
}

/**
 * The ghost of a plotted move: the path the ship will fly and the counter
 * outline where it will end up, with the stress the maneuver costs (C3.1.2).
 */
function PlotPreview({ game, ship }: { game: GameState; ship: ShipState }) {
  const card = game.orders[ship.id]
  if (!card) return null

  const towed = isLinked(ship.id, game.ops.links)
  const planned = plannedMovement(
    ship,
    card,
    towed ? adjustedSpeed(ship, game.ops.links, game.ships, card.speed) : undefined,
  )
  const start = ship.placement
  const unmoved =
    planned.end.position.x === start.position.x &&
    planned.end.position.y === start.position.y &&
    planned.end.heading === start.heading
  if (unmoved) return null

  const size = 1.5 * SCALE
  const ex = planned.end.position.x * SCALE
  const ey = planned.end.position.y * SCALE

  return (
    <g className="plot-preview" aria-hidden="true">
      <polyline
        className="plot-path"
        points={planned.path.map((p) => `${p.x * SCALE},${p.y * SCALE}`).join(' ')}
      />
      <g transform={`translate(${ex} ${ey}) rotate(${planned.end.heading})`}>
        <rect x={-size / 2} y={-size / 2} width={size} height={size} className="plot-ghost" />
        <path d={`M 0 ${-size / 2 - 5} L -4 ${-size / 2 + 2} L 4 ${-size / 2 + 2} Z`} className="plot-ghost-bow" />
      </g>
      <text x={ex} y={ey + size / 2 + 12} className="plot-label" textAnchor="middle">
        spd {planned.speed}
        {planned.stress > 0 ? ` · +${planned.stress} stress` : ''}
        {planned.illegal ? ' · ILLEGAL — goes straight' : ''}
      </text>
    </g>
  )
}

/** The eight 45-degree firing arcs, drawn as a wedge fan (E2.2.1). */
function ArcOverlay({ ship }: { ship: ShipState }) {
  const cx = ship.placement.position.x * SCALE
  const cy = ship.placement.position.y * SCALE
  const radius = 7 * SCALE

  return (
    <g className="arc-overlay">
      {ARC_ORDER.map((arc: Arc) => {
        const start = ARC_START[arc] + ship.placement.heading
        const end = start + 45
        const p1 = polar(cx, cy, radius, start)
        const p2 = polar(cx, cy, radius, end)
        const mid = polar(cx, cy, radius * 0.75, start + 22.5)
        return (
          <g key={arc}>
            <path d={`M ${cx} ${cy} L ${p1.x} ${p1.y} A ${radius} ${radius} 0 0 1 ${p2.x} ${p2.y} Z`} className="arc" />
            <text x={mid.x} y={mid.y} className="arc-label" textAnchor="middle">
              {arc}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function polar(cx: number, cy: number, r: number, headingDeg: number) {
  const v = headingVector(headingDeg)
  return { x: cx + v.x * r, y: cy + v.y * r }
}

/**
 * Hull silhouettes, one visual language per faction — the printed counters
 * carry ship art, and a square with a triangle was a poor stand-in for it.
 * Every glyph is drawn nose-up in a 100-unit box (−50..50 on both axes) and
 * scaled to the counter, so the bow marks the ship's heading exactly where
 * the old bow triangle did. Purely cosmetic: the counter square below it is
 * still the 1.5-inch footprint the rules move and measure (A2.1).
 */
type Silhouette = 'union' | 'vallari' | 'aurelian' | 'generic'

function silhouetteFor(faction: string): Silhouette {
  if (/union/i.test(faction)) return 'union'
  if (/vallari/i.test(faction)) return 'vallari'
  if (/aurelian/i.test(faction)) return 'aurelian'
  return 'generic'
}

function ShipGlyph({ kind }: { kind: Silhouette }) {
  switch (kind) {
    // Union: saucer forward, engineering hull aft, twin outboard nacelles.
    case 'union':
      return (
        <>
          <path className="glyph-pylon" d="M -7 8 L -19 22 M 7 8 L 19 22" />
          <rect className="glyph-hull" x={-25} y={14} width={9} height={32} rx={4.5} />
          <rect className="glyph-hull" x={16} y={14} width={9} height={32} rx={4.5} />
          <rect className="glyph-trim" x={-24} y={15.5} width={7} height={7} rx={3.5} />
          <rect className="glyph-trim" x={17} y={15.5} width={7} height={7} rx={3.5} />
          <path className="glyph-hull" d="M -6 -8 L 6 -8 L 9 18 Q 0 25 -9 18 Z" />
          <ellipse className="glyph-hull" cx={0} cy={-21} rx={21} ry={18} />
          <circle className="glyph-glass" cx={0} cy={-25} r={4} />
        </>
      )
    // Vallari: a swept-wing raptor, all edges and intent.
    case 'vallari':
      return (
        <>
          <path
            className="glyph-hull"
            d="M 0 -47 L 9 -18 L 40 14 L 32 25 L 10 10 L 8 26 L 15 41 L 0 32 L -15 41 L -8 26 L -10 10 L -32 25 L -40 14 L -9 -18 Z"
          />
          <path className="glyph-trim" d="M 0 -34 L 4 -20 L 0 -12 L -4 -20 Z" />
        </>
      )
    // Aurelian: a smooth crescent dart, built to vanish.
    case 'aurelian':
      return (
        <>
          <path
            className="glyph-hull"
            d="M 0 -46 C 10 -24 16 -2 36 27 C 22 16 10 14 0 19 C -10 14 -22 16 -36 27 C -16 -2 -10 -24 0 -46 Z"
          />
          <path className="glyph-trim" d="M 0 -30 L 3 4 L 0 12 L -3 4 Z" />
        </>
      )
    // Anything from the builder without a known faction: a plain wedge.
    default:
      return (
        <>
          <path className="glyph-hull" d="M 0 -44 L 24 26 L 12 20 L 0 33 L -12 20 L -24 26 Z" />
          <circle className="glyph-glass" cx={0} cy={-14} r={4} />
        </>
      )
  }
}

/**
 * A ship counter: 1.5 inches square (A2.1), with the hull silhouette showing
 * the bow and a shield strength readout on each facing.
 */
function ShipToken({
  ship,
  selected,
  targeted,
  formationSize,
  cloaked,
  redacted,
  onSelect,
}: {
  ship: ShipState
  selected: boolean
  targeted: boolean
  /** Ships sharing this counter, including the lead (C5.1.3). */
  formationSize: number
  /** Cloaked but drawn anyway — only its own commander's view does this. */
  cloaked: boolean
  /** An enemy counter in a side view: hide what the table would not show. */
  redacted: boolean
  onSelect: (id: string) => void
}) {
  if (ship.destroyed || ship.disengaged) return null

  const size = 1.5 * SCALE
  const cx = ship.placement.position.x * SCALE
  const cy = ship.placement.position.y * SCALE
  // The third side of the Aurelian Raid keeps the purple the fleet picker
  // already gives it, so map and picker agree on who is who.
  const sideClass = ship.side.startsWith('Blue')
    ? 'blue'
    : ship.side.startsWith('Aurelian')
      ? 'aurelian'
      : 'red'

  const shieldLabel = (side: 'F' | 'S' | 'A' | 'P') => {
    if (ship.shieldsDown[side]) return '—'
    // Strengths are printed on the hidden form (B1.9); an enemy counter shows
    // only that the shield is up.
    if (redacted) return ''
    const green = greenShieldRemaining(ship, side)
    const blue = blueShieldRemaining(ship, side)
    return green > 0 ? `${blue}+${green}` : `${blue}`
  }

  return (
    <g
      className={`ship ship-${sideClass}${selected ? ' is-selected' : ''}${targeted ? ' is-targeted' : ''}${cloaked ? ' is-cloaked' : ''}`}
      transform={`translate(${cx} ${cy}) rotate(${ship.placement.heading})`}
      onClick={() => onSelect(ship.id)}
      role="button"
      tabIndex={0}
      aria-label={`${ship.name}, speed ${ship.speed}`}
    >
      {/* The browser's native hover tooltip — glanceable state without a click.
          Marine strength is hidden information, so a redacted counter keeps it. */}
      <title>
        {`${ship.name} — ${ship.form.name}\n` +
          `speed ${ship.speed} · heading ${Math.round(ship.placement.heading)}° · ${damageLevel(ship)}\n` +
          `stress ${ship.stressMarkers}` +
          (redacted ? '' : ` · marines ${ship.marineSquads}`) +
          (cloaked ? '\nCLOAKED — visible only to you' : '') +
          (ship.derelict ? '\nDERELICT' : '') +
          (ship.capturedBy ? `\ncaptured by ${ship.capturedBy}` : '')}
      </title>
      <rect x={-size / 2} y={-size / 2} width={size} height={size} className="ship-base" />

      {/*
        The hull, scaled so bigger size classes fill more of their counter —
        a size-7 dreadnought should loom over a size-2 corvette. The glyph's
        nose is the bow, replacing the old bow triangle.
      */}
      <g
        className="ship-glyph"
        transform={`scale(${(size / 100) * Math.min(0.72 + 0.05 * ship.form.sizeClass, 1.05)})`}
      >
        <ShipGlyph kind={silhouetteFor(ship.form.faction)} />
      </g>

      {/*
        Shield strength on each facing, printed just outside the counter. The
        label positions rotate with the hull so each stays attached to its arc
        (G1.1.1), but each label is counter-rotated so it reads upright.
      */}
      {(
        [
          ['F', 0, -size / 2 - 11],
          ['A', 0, size / 2 + 15],
          ['S', size / 2 + 12, 4],
          ['P', -size / 2 - 12, 4],
        ] as const
      ).map(([side, x, y]) => (
        <g key={side} transform={`translate(${x} ${y}) rotate(${-ship.placement.heading})`}>
          <text className="ship-shield" textAnchor="middle">
            {shieldLabel(side)}
          </text>
        </g>
      ))}

      {/* Counter-rotate so labels stay upright regardless of ship heading. */}
      <g transform={`rotate(${-ship.placement.heading})`}>
        {formationSize > 1 && (
          <text x={size / 2 - 3} y={-size / 2 + 11} className="ship-formation" textAnchor="end">
            ×{formationSize}
          </text>
        )}
        {/*
          Just clear of the shield readouts. Those rotate with the hull, so on
          a diagonal heading the aft label swings round to roughly where a name
          set close under the counter would sit; 25px puts the name outside the
          whole ring at any heading, while still staying under its own ship.
        */}
        <text y={size / 2 + 25} className="ship-name" textAnchor="middle">
          {ship.name} · spd {ship.speed}
          {formationSize > 1 ? ` · formation of ${formationSize}` : ''}
          {ship.stressMarkers > 0 ? ` · ${ship.stressMarkers} stress` : ''}
          {ship.derelict ? ' · DERELICT' : ''}
        </text>
      </g>
    </g>
  )
}
