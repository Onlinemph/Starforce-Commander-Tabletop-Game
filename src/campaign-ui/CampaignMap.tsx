/**
 * The per-side campaign map — an SVG rendering of one SideView and NOTHING
 * else. The component's props are the wall's shape: it cannot draw what the
 * view does not carry.
 */

import { allHexes } from '../campaign/hexmap'
import type { Hex } from '../campaign/types'
import type { SideView } from '../campaign/views'
import { hexCenter, hexPoints, pixelToHex } from './helpers'

const HEX = 16

const TERRAIN_FILL: Record<string, string> = {
  system: 'rgba(255, 214, 90, 0.35)',
  nebula: 'rgba(170, 90, 240, 0.30)',
  dust: 'rgba(200, 140, 80, 0.30)',
}

const INFRA_GLYPH: Record<string, string> = {
  'fleet-base': '⬢',
  outpost: '◆',
  colony: '●',
  'listening-post': '◉',
  'jump-beacon': '✦',
}

interface Props {
  view: SideView
  selectedUnitId: string | null
  selectedContactId: string | null
  /** Hexes the staged orders would path through, for the selected unit. */
  plannedWaypoints: Hex[]
  onClickHex: (hex: Hex) => void
  onClickUnit: (unitId: string) => void
  onClickContact: (contactId: string) => void
}

export function CampaignMap({
  view,
  selectedUnitId,
  selectedContactId,
  plannedWaypoints,
  onClickHex,
  onClickUnit,
  onClickContact,
}: Props) {
  const hexes = allHexes(view.map.width, view.map.height)
  const last = hexCenter({ q: view.map.width - 1, r: 0 }, HEX)
  const width = last.x + HEX * 2
  const height = view.map.height * HEX * Math.sqrt(3) + HEX * 2
  const own = view.side === 'A' ? '#5fb2ff' : '#ff8a5f'

  return (
    <svg
      className="campaign-map"
      viewBox={`${-HEX} ${-HEX} ${width + HEX} ${height + HEX}`}
      role="img"
      aria-label="Campaign map"
      onClick={(e) => {
        const svg = e.currentTarget
        const point = svg.createSVGPoint()
        point.x = e.clientX
        point.y = e.clientY
        const local = point.matrixTransform(svg.getScreenCTM()!.inverse())
        onClickHex(pixelToHex(local.x, local.y, HEX))
      }}
    >
      {/* The grid, terrain shaded. */}
      {hexes.map((h) => {
        const kind = view.map.terrain.find((t) => t.q === h.q && t.r === h.r)?.kind
        return (
          <polygon
            key={`${h.q},${h.r}`}
            points={hexPoints(h, HEX)}
            fill={kind ? TERRAIN_FILL[kind] : 'transparent'}
            stroke="rgba(140, 160, 190, 0.25)"
            strokeWidth={0.6}
          />
        )
      })}

      {/* The contested border. */}
      {view.map.border.map((h) => (
        <polygon
          key={`b${h.q},${h.r}`}
          points={hexPoints(h, HEX)}
          fill="none"
          stroke="rgba(255, 80, 80, 0.5)"
          strokeWidth={1.4}
          strokeDasharray="3 3"
        />
      ))}

      {/* Infrastructure: yours whole, theirs as the charts show it (3.4). */}
      {[...view.infrastructure, ...view.knownEnemyInfrastructure].map((i) => {
        const c = hexCenter(i.hex, HEX)
        const mine = view.infrastructure.some((x) => x.id === i.id)
        return (
          <text
            key={i.id}
            x={c.x}
            y={c.y + 4}
            textAnchor="middle"
            fontSize={12}
            fill={i.destroyed ? '#666' : mine ? own : '#ccc'}
            opacity={i.destroyed ? 0.4 : 0.9}
          >
            {INFRA_GLYPH[i.kind] ?? '?'}
          </text>
        )
      })}

      {/* The selected unit's planned path. */}
      {plannedWaypoints.length > 0 && selectedUnitId && (
        <polyline
          points={plannedWaypoints.map((h) => {
            const c = hexCenter(h, HEX)
            return `${c.x},${c.y}`
          }).join(' ')}
          fill="none"
          stroke={own}
          strokeWidth={1.2}
          strokeDasharray="4 3"
          opacity={0.7}
        />
      )}

      {/* Contacts: what the fog has yielded — position estimated, going grey. */}
      {view.contacts.map((contact) => {
        const c = hexCenter(contact.hex, HEX)
        const selected = contact.id === selectedContactId
        return (
          <g
            key={contact.id}
            onClick={(e) => {
              e.stopPropagation()
              onClickContact(contact.id)
            }}
            style={{ cursor: 'pointer' }}
          >
            {contact.uncertainty > 0 && (
              <circle
                cx={c.x}
                cy={c.y}
                r={HEX * (0.6 + contact.uncertainty * 0.5)}
                fill="none"
                stroke="#e05555"
                strokeWidth={0.8}
                strokeDasharray="2 3"
                opacity={0.5}
              />
            )}
            <rect
              x={c.x - 6}
              y={c.y - 6}
              width={12}
              height={12}
              transform={`rotate(45 ${c.x} ${c.y})`}
              fill={contact.collapsed ? 'rgba(224,85,85,0.25)' : 'rgba(224,85,85,0.8)'}
              stroke={selected ? '#fff' : '#e05555'}
              strokeWidth={selected ? 2 : 1}
              opacity={contact.positionEstimated ? 0.65 : 1}
            />
            <text x={c.x} y={c.y - 10} textAnchor="middle" fontSize={7} fill="#e08585">
              {contact.collapsed
                ? 'last known'
                : (contact.attributes.shipClass?.value ??
                  contact.attributes.faction?.value ??
                  contact.attributes.sizeClass?.value ??
                  contact.attributes.bearingClass?.value ??
                  'contact')}
            </text>
          </g>
        )
      })}

      {/* Own units, whole. */}
      {view.units.map((unit) => {
        const c = hexCenter(unit.hex, HEX)
        const selected = unit.id === selectedUnitId
        return (
          <g
            key={unit.id}
            onClick={(e) => {
              e.stopPropagation()
              onClickUnit(unit.id)
            }}
            style={{ cursor: 'pointer' }}
          >
            <circle
              cx={c.x}
              cy={c.y}
              r={8}
              fill={own}
              stroke={selected ? '#fff' : 'rgba(0,0,0,0.5)'}
              strokeWidth={selected ? 2.5 : 1}
              opacity={unit.order.cloaked ? 0.5 : 1}
            />
            <text x={c.x} y={c.y + 3} textAnchor="middle" fontSize={8} fill="#04121f" fontWeight={700}>
              {unit.ships.length}
            </text>
            <text x={c.x} y={c.y + 17} textAnchor="middle" fontSize={7} fill={own}>
              {unit.ships[0]?.name ?? unit.id}
            </text>
          </g>
        )
      })}

      {/* Battles waiting on the table. */}
      {view.engagements.map((engagement) => {
        const c = hexCenter(engagement.hex, HEX)
        return (
          <text key={engagement.id} x={c.x} y={c.y - 14} textAnchor="middle" fontSize={13} fill="#ffd166">
            ⚔
          </text>
        )
      })}
    </svg>
  )
}
