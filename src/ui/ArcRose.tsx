import { ARC_ORDER, ARC_START, headingVector } from '../engine/geometry'
import type { Arc } from '../engine/types'

/**
 * A mount's firing arcs as a compass rose: the ship's eight 45° arcs (E2.2.1)
 * drawn bow-up, with the arcs this mount covers lit. The same geometry the
 * map's arc overlay uses, so the little rose and the big fan always agree.
 * The letters live on in the tooltip for anyone reading the printed form.
 */
export function ArcRose({ arcs, size = 18 }: { arcs: readonly Arc[]; size?: number }) {
  const c = size / 2
  const r = c - 1

  const point = (deg: number, radius: number) => {
    const v = headingVector(deg)
    return { x: c + v.x * radius, y: c + v.y * radius }
  }

  return (
    <svg
      className="arc-rose"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Arcs: ${arcs.join(', ')}`}
    >
      <title>Arcs: {arcs.join(', ')}</title>
      {ARC_ORDER.map((arc) => {
        const p0 = point(ARC_START[arc], r)
        const p1 = point(ARC_START[arc] + 45, r)
        return (
          <path
            key={arc}
            className={`rose-arc${arcs.includes(arc) ? ' is-on' : ''}`}
            d={`M ${c} ${c} L ${p0.x} ${p0.y} A ${r} ${r} 0 0 1 ${p1.x} ${p1.y} Z`}
          />
        )
      })}
      {/* The bow, so "up" reads as forward at a glance. */}
      <path className="rose-bow" d={`M ${c} 0 L ${c - 2} 3.5 L ${c + 2} 3.5 Z`} />
    </svg>
  )
}
