import { useMemo } from 'react'
import { formationOf } from '../engine/formation'
import { ARC_ORDER, ARC_START, actualRange, headingVector } from '../engine/geometry'
import type { GameState } from '../engine/game'
import { blueShieldRemaining, greenShieldRemaining, type ShipState } from '../engine/shipState'
import type { Arc } from '../engine/types'

/**
 * The play surface (A2.9). Rendered at 1 inch = `SCALE` pixels so every
 * measurement on screen matches the rulebook's inches directly.
 */

const SCALE = 20

interface Props {
  game: GameState
  selectedId: string | null
  targetId: string | null
  onSelect: (id: string) => void
  /** Draw the eight 45-degree arcs around the selected ship (E2.2). */
  showArcs: boolean
  /** Range rings for the selected ship's weapons (E1.2). */
  rangeRings: RangeRing[]
}

export interface RangeRing {
  range: number
  label: string
  band: 'green' | 'max'
}

export function MapView({ game, selectedId, targetId, onSelect, showArcs, rangeRings }: Props) {
  const { width, height } = game.scenario.bounds
  const w = width * SCALE
  const h = height * SCALE

  const selected = game.ships.find((s) => s.id === selectedId) ?? null
  const target = game.ships.find((s) => s.id === targetId) ?? null

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

  return (
    <svg className="map" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Play surface">
      <rect x={0} y={0} width={w} height={h} className="map-bg" />
      {grid}

      {/* Terrain (Section K) */}
      {game.scenario.terrain.map((feature) => (
        <g key={feature.id}>
          <circle
            cx={feature.center.x * SCALE}
            cy={feature.center.y * SCALE}
            r={feature.radius * SCALE}
            className={`terrain terrain-${feature.kind}`}
          />
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

      {/*
        Only the lead ship's counter stays on the map when ships fly in
        formation (C5.1.3), so members are drawn as a strength badge on the
        lead rather than as counters stacked in the same square.
      */}
      {game.ships
        .filter((ship) => {
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
            onSelect={onSelect}
          />
        ))}
    </svg>
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
 * A ship counter: 1.5 inches square (A2.1), with the bow marked and a shield
 * strength readout on each facing.
 */
function ShipToken({
  ship,
  selected,
  targeted,
  formationSize,
  onSelect,
}: {
  ship: ShipState
  selected: boolean
  targeted: boolean
  /** Ships sharing this counter, including the lead (C5.1.3). */
  formationSize: number
  onSelect: (id: string) => void
}) {
  if (ship.destroyed || ship.disengaged) return null

  const size = 1.5 * SCALE
  const cx = ship.placement.position.x * SCALE
  const cy = ship.placement.position.y * SCALE
  const sideClass = ship.side.startsWith('Blue') ? 'blue' : 'red'

  const shieldLabel = (side: 'F' | 'S' | 'A' | 'P') => {
    const green = greenShieldRemaining(ship, side)
    const blue = blueShieldRemaining(ship, side)
    if (ship.shieldsDown[side]) return '—'
    return green > 0 ? `${blue}+${green}` : `${blue}`
  }

  return (
    <g
      className={`ship ship-${sideClass}${selected ? ' is-selected' : ''}${targeted ? ' is-targeted' : ''}`}
      transform={`translate(${cx} ${cy}) rotate(${ship.placement.heading})`}
      onClick={() => onSelect(ship.id)}
      role="button"
      tabIndex={0}
      aria-label={`${ship.name}, speed ${ship.speed}`}
    >
      <rect x={-size / 2} y={-size / 2} width={size} height={size} className="ship-base" />
      {/* Bow marker */}
      <path d={`M 0 ${-size / 2 - 6} L ${-5} ${-size / 2 + 2} L 5 ${-size / 2 + 2} Z`} className="ship-bow" />

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
        <text y={size / 2 + 30} className="ship-name" textAnchor="middle">
          {ship.name} · spd {ship.speed}
          {formationSize > 1 ? ` · formation of ${formationSize}` : ''}
          {ship.stressMarkers > 0 ? ` · ${ship.stressMarkers} stress` : ''}
          {ship.derelict ? ' · DERELICT' : ''}
        </text>
      </g>
    </g>
  )
}
