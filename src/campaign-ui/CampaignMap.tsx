/**
 * The per-side campaign map — an SVG rendering of one SideView and NOTHING
 * else. The component's props are the wall's shape: it cannot draw what the
 * view does not carry. Nothing here reads campaign truth, derives a sensor
 * range, or infers what has not been seen; ignorance is shown by absence.
 *
 * ── The direction (docs/campaign-plot.md) ─────────────────────────────────
 * The plot is the same photograph of space the battle map takes, a thousand
 * times further out, with an instrument reticle laid over the glass. Two
 * layers, kept apart:
 *
 *  - The ATMOSPHERE layer is soft and approximate. Nebulae bleed past their
 *    hexes, coronae spill across three, dust belts smear and swallow the stars
 *    behind them. It is a picture and it carries no rule.
 *  - The INSTRUMENT layer is exact and thin: mesh, terrain rims, grid fixes,
 *    the frontier, the counters. Every rules-bearing fact lives here,
 *    hairline-sharp, drawn ABOVE the vignette so it never fades.
 *
 * Luminance is information: nothing is bright unless it is a map fact, and the
 * ground is radially symmetric about the plot, so every asymmetry the eye finds
 * is terrain the generator actually wrote.
 *
 * Colour rules are frozen. Side identity is --blue/--red; a contact takes the
 * OPPOSING side's colour because a contact is the other commander; engagements
 * are --lc-orange; your plan is --lc-sand. The dome highlight is white/black
 * only — a value overlay, never a new hue.
 *
 * ── Two rules the click model rides on ────────────────────────────────────
 * 1. NO ancestor <g> of the plot may carry a `transform`. The root onClick
 *    inverts getScreenCTM() and calls pixelToHex; a transformed wrapper around
 *    the plot layers silently breaks every map click. Legend and counter-local
 *    transforms are fine — they sit above the click resolution, not around it.
 * 2. The ground rect must stay hit-testable. The 660 per-hex polygons carried
 *    no interaction (clicks always resolved at the root), which is what pays
 *    for replacing them with paths — but it means the bled ground rect is now
 *    the painted target that makes a click on empty space bubble to the root.
 *    It must NOT carry pointer-events="none". Everything else below the
 *    counters must, so mousemove never hit-tests a 2,000-segment path.
 */

import { memo, useMemo, type ReactNode } from 'react'
import { allHexes, hexDistance, hexKey, inBounds } from '../campaign/hexmap'
import type { CampaignMap as CampaignMapData, Hex, Side, SpeedTier } from '../campaign/types'
import type { SideView, ViewedContact } from '../campaign/views'
import { Rng } from '../engine/dice'
import { labelHalfWidth, stackLabels, type LabelBox, type LabelObstacle } from '../ui/mapLabels'
import { hexCenter, hexPoints, pixelToHex } from './helpers'
import {
  COL,
  HEX,
  IN_R,
  ROW,
  components,
  dot,
  hexNoise,
  hexesWithin,
  mapSeed,
  meshPaths,
  regionPath,
  smooth,
  type P,
} from './plot'

/** How far ground, starfield and vignette bleed past the viewBox, so the
    letterbox fills with real space rather than flat CSS. */
const BLEED = 160

/** Legend column pitch, and the on-plot type floor. 10 is the floor. */
const LEG_STEP = 78
const TEXT = 10

/** Every piece of on-plot text takes a ground-coloured casing painted before
    the fill: guaranteed legibility over a star or a nebula core, zero extra
    nodes, zero filters. The app's own idiom (.mission-label). */
const HALO = {
  paintOrder: 'stroke',
  stroke: '#03050b',
  strokeWidth: 2.4,
  strokeLinejoin: 'round' as const,
}

/* Dust's own two values, named because the legend must quote the map and not
   approximate it. The rim is a dull ochre chosen to be neither --lc-orange
   (the engagement hue, which terrain may not borrow) nor --lc-sand (your
   plan); the body is a near-black hole that reads as occlusion at any radius
   of the ground gradient. */
const DUST_BODY = '#030201'
const DUST_RIM = '#b08a60'

const INFRA_GLYPH: Record<string, string> = {
  'fleet-base': '⬢',
  // Not ◆: a foe-coloured diamond is what a CONTACT is, and an enemy holding
  // is drawn in the foe's colour too.
  outpost: '▲',
  colony: '●',
  'listening-post': '◉',
  'jump-beacon': '✦',
}

const INFRA_NAME: Record<string, string> = {
  'fleet-base': 'Fleet base',
  outpost: 'Outpost',
  colony: 'Colony',
  'listening-post': 'Listening post',
  'jump-beacon': 'Jump beacon',
}

const SPEED_TIER: Record<SpeedTier, number> = {
  hold: 0,
  cruise: 1,
  'max-cruise': 2,
  maximum: 3,
  emergency: 4,
}

/* ══ Scenery ═══════════════════════════════════════════════════════════════
   Layers 1–10. They depend ONLY on view.map, which is structurally constant
   for a whole campaign — but they cannot be memoised on view.map itself,
   because viewFor() does `map: structuredClone(map)` and hands out a fresh
   object every render. Keyed on the FNV-1a signature instead, which doubles as
   the sky's seed and costs ~660 integer ops. */

interface SceneryProps {
  sig: string
  map: CampaignMapData
  side: Side
}

function DeepspaceImpl({ map, side }: SceneryProps) {
  const s = useMemo(() => {
    const w = map.width
    const h = map.height
    const rng = new Rng(mapSeed(map))

    /* Ink extents and the plot's optical centre. Every ground gradient is
       centred HERE, on the plot, not on the element — the old CSS wash was
       centred on the element while the plot is centred on the letterboxed
       viewBox, and that mismatch was the "odd bright patch top left". */
    const inkL = -HEX
    const inkR = COL * (w - 1) + HEX
    const inkT = -IN_R
    const inkB = ROW * (h - 0.5) + IN_R
    const cx = (inkL + inkR) / 2
    const cy = (inkT + inkB) / 2
    const rMaj = Math.hypot(inkR - cx, inkB - cy)
    const boxW = COL * (w - 1) + HEX * 3
    const boxH = ROW * h + HEX * 2
    const space = {
      x: -HEX - BLEED,
      y: -HEX - BLEED,
      width: boxW + HEX + 2 * BLEED,
      height: boxH + HEX + 2 * BLEED,
    }

    // ── Terrain, merged into regions ──────────────────────────────────────
    const systems: Hex[] = []
    const nebulaHexes: Hex[] = []
    const dustHexes: Hex[] = []
    for (const t of map.terrain) {
      if (t.kind === 'system') systems.push({ q: t.q, r: t.r })
      else if (t.kind === 'nebula') nebulaHexes.push({ q: t.q, r: t.r })
      else if (t.kind === 'dust') dustHexes.push({ q: t.q, r: t.r })
    }
    const nebulae = components(nebulaHexes).map((m) => ({ m, d: regionPath(m) }))
    const dust = components(dustHexes).map((m) => ({ m, d: regionPath(m) }))

    // ── The starfield: ~430 stars in five <path> nodes ────────────────────
    const count = Math.round((space.width * space.height) / 2400)
    const tiers = ['', '', '', '', '']
    const all: { x: number; y: number; r: number }[] = []
    for (let i = 0; i < count; i++) {
      const x = space.x + rng.next() * space.width
      const y = space.y + rng.next() * space.height
      const u = rng.next()
      // Cubed, so the great majority are pinpricks — the same curve the
      // tactical map's useStarfield draws, for the same reason.
      const r = 0.35 + u * u * u * 1.25
      const c = rng.next()
      const tier = c < 0.04 ? 3 : c < 0.08 ? 4 : r >= 1.32 ? 2 : r >= 0.66 ? 1 : 0
      tiers[tier] += dot(x, y, r)
      all.push({ x, y, r })
    }
    const bright = all
      .map((star, i) => ({ ...star, i }))
      .sort((a, b) => b.r - a.r || a.i - b.i)
      .slice(0, 10)

    // ── Knots and clumps: what stops a blur reading as a smoothed sausage ──
    const knots = nebulae.map(({ m }) => {
      const n = 2 + rng.int(3)
      const out: { x: number; y: number; r: number }[] = []
      for (let i = 0; i < n; i++) {
        const p = hexCenter(m[rng.int(m.length)], HEX)
        out.push({ x: p.x, y: p.y, r: 9 + rng.next() * 9 })
      }
      return out
    })
    const clumps = dust.map(({ m }) => {
      const n = 3 + rng.int(3)
      const out: { x: number; y: number; r: number }[] = []
      for (let i = 0; i < n; i++) {
        const p = hexCenter(m[rng.int(m.length)], HEX)
        out.push({ x: p.x, y: p.y, r: 6 + rng.next() * 8 })
      }
      return out
    })

    /* ── The mesh, each edge emitted exactly once ──────────────────────────
       Terrain is a REGION and the merged rim is what states it. A full-weight
       cool hairline across every shared edge inside one restates the cells
       instead, and that — not the tint — is what made a belt read as blocky
       staining. Those interior edges come back as `veiled` and are drawn at a
       fifth of the weight: the reticle is still there, obscured by what it is
       looking through, which is also the true picture. */
    const mesh = meshPaths(
      w,
      h,
      new Set(systems.map(hexKey)),
      new Set([...dustHexes, ...nebulaHexes].map(hexKey)),
    )
    /* The plot edge, chained into closed loops rather than ~100 loose edge
       segments. SVG restarts strokeDasharray at every subpath, so the loose
       form re-started "8 6" on each 16-unit edge and came out as a comb with
       the dashes bunched at every corner. .map-edge on the tactical board is
       one continuous polygon, which is why the same values read as a rule
       there and as a fence here. */
    const rim = regionPath(allHexes(w, h))

    // ── The frontier: map.border is a jagged LINE, so draw a line ─────────
    const ordered = [...map.border].sort(
      (a, b) => hexCenter(a, HEX).y - hexCenter(b, HEX).y || a.q - b.q,
    )
    const centres = ordered.map((hx) => hexCenter(hx, HEX))
    const runs: P[][] = []
    for (let i = 0; i < centres.length; i++) {
      // A neighbour step is 27.71 units; the generator's ±1 column jog is 48.0
      // because bq changes while r advances a row. 3.4·HEX admits both and
      // breaks only on a genuine gap.
      if (i === 0 || Math.hypot(centres[i].x - centres[i - 1].x, centres[i].y - centres[i - 1].y) > HEX * 3.4)
        runs.push([])
      runs[runs.length - 1].push(centres[i])
    }
    /* A frontier has no ends inside a plot: run the first and last off the
       chart. Off the CHART, not off the component — inkB is exactly legendTop
       (ROW·(h−0.5) + IN_R reduces to ROW·h), so the old `inkB + HEX` licensed a
       full hex of red into the band reserved for the caption, where a 7-wide
       round-capped glow with no dash terminated as a solid lozenge. Both ends
       now overshoot deliberately and the group is clipped to the ink, so each
       one leaves the plot mid-stroke the way a frontier should. */
    if (runs.length > 0) {
      const first = runs[0]
      if (first.length > 1) {
        const a = first[0]
        const b = first[1]
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
        first.unshift({
          x: a.x - ((b.x - a.x) / len) * HEX * 1.4,
          y: Math.max(inkT - HEX, a.y - ((b.y - a.y) / len) * HEX * 1.4),
        })
      }
      const last = runs[runs.length - 1]
      if (last.length > 1) {
        const a = last[last.length - 1]
        const b = last[last.length - 2]
        const len = Math.hypot(a.x - b.x, a.y - b.y) || 1
        last.push({
          x: a.x + ((a.x - b.x) / len) * HEX * 1.4,
          y: a.y + ((a.y - b.y) / len) * HEX * 1.4,
        })
      }
    }
    const frontier = runs.map((run) => smooth(run)).join('')
    // Hachures from the hex centres, never by sampling the curve: getTotalLength
    // is a DOM measurement and this component renders from data alone.
    // They start OUTSIDE the 7-wide glow band (±3.5) and run to 12, so the
    // whole tick is on clear ground: at 4.5 from the centre the entire hachure
    // lived inside the glow and the second channel was not delivered at all.
    const sign = side === 'A' ? -1 : 1
    let ticks = ''
    for (let i = 0; i < centres.length; i += 2) {
      const prev = centres[i - 1] ?? centres[i]
      const next = centres[i + 1] ?? centres[i]
      const tx = next.x - prev.x
      const ty = next.y - prev.y
      const len = Math.hypot(tx, ty) || 1
      const nx = (ty / len) * sign
      const ny = (-tx / len) * sign
      const p = centres[i]
      ticks +=
        `M${(p.x + nx * 4).toFixed(2)},${(p.y + ny * 4).toFixed(2)}` +
        `L${(p.x + nx * 11.5).toFixed(2)},${(p.y + ny * 11.5).toFixed(2)}`
    }
    const corridor = regionPath(map.border)

    return {
      w,
      h,
      cx,
      cy,
      inkB,
      rMaj,
      space,
      systems,
      nebulae,
      dust,
      knots,
      clumps,
      tiers,
      bright,
      mesh,
      rim,
      frontier,
      ticks,
      corridor,
    }
  }, [map, side])

  return (
    <>
      <defs>
        {/* Ground, plot-centred — userSpaceOnUse so the light is on the PLOT. */}
        <radialGradient id="cm-void" gradientUnits="userSpaceOnUse" cx={s.cx} cy={s.cy} r={s.rMaj * 0.86}>
          <stop offset="0" stopColor="#0b0d1c" />
          <stop offset="0.46" stopColor="#06080f" />
          <stop offset="1" stopColor="#010206" />
        </radialGradient>

        <radialGradient id="cm-falloff" gradientUnits="userSpaceOnUse" cx={s.cx} cy={s.cy} r={s.rMaj * 0.8}>
          <stop offset="0.55" stopColor="#000000" stopOpacity="0" />
          <stop offset="0.86" stopColor="#000000" stopOpacity="0.3" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.62" />
        </radialGradient>

        <radialGradient id="cm-mesh-fade" gradientUnits="userSpaceOnUse" cx={s.cx} cy={s.cy} r={s.rMaj * 0.78}>
          <stop offset="0" stopColor="#a3b9e0" stopOpacity="0.2" />
          <stop offset="0.7" stopColor="#a3b9e0" stopOpacity="0.14" />
          <stop offset="1" stopColor="#a3b9e0" stopOpacity="0.09" />
        </radialGradient>

        <radialGradient id="cm-star-halo">
          <stop offset="0" stopColor="#eaf0ff" stopOpacity="0.55" />
          <stop offset="0.4" stopColor="#9fb6e8" stopOpacity="0.16" />
          <stop offset="1" stopColor="#9fb6e8" stopOpacity="0" />
        </radialGradient>

        {/* --yellow → --lc-orange */}
        <radialGradient id="cm-corona">
          <stop offset="0" stopColor="#fff6de" stopOpacity="0.95" />
          <stop offset="0.16" stopColor="#ffc94a" stopOpacity="0.45" />
          <stop offset="0.44" stopColor="#ff9c00" stopOpacity="0.15" />
          <stop offset="1" stopColor="#ff9c00" stopOpacity="0" />
        </radialGradient>

        {/* --lc-plum ramp. var() resolves against the STOP's own inherited
            colour, and these stops inherit from <svg> where :root's tokens are
            in scope, so the token is usable here and the literal is not needed. */}
        <radialGradient id="cm-neb-core" cx="50%" cy="46%" r="64%">
          <stop offset="0" stopColor="var(--lc-plum)" stopOpacity="0.36" />
          <stop offset="0.55" stopColor="#6a4a96" stopOpacity="0.2" />
          <stop offset="1" stopColor="var(--lc-plum-deep)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cm-neb-knot">
          <stop offset="0" stopColor="#b48ee0" stopOpacity="0.2" />
          <stop offset="1" stopColor="#b48ee0" stopOpacity="0" />
        </radialGradient>

        {/* Dust grain: a 19×19 tile of thirteen fixed dots at deliberately
            non-lattice positions, rotated OFF the mesh angle so the texture can
            never align with a hex edge. A pattern rasterises one tile and blits
            it — the cheapest texture in SVG, and the reason feTurbulence is
            refused. A 12-unit tile of evenly spread dots read as a halftone
            lattice; the longer period and the uneven spread are what turn it
            back into grit.

            It is painted UNFILTERED, above the blurred body: at stdDeviation
            4.5 a 12-unit period is gone, and what came back was a flat warm
            wash — the brown stain the brief names. Unblurred it stays grit, and
            it needs no soft edge of its own because a 9%-coverage dot field has
            no continuous silhouette to give the region a hard hex facet. */}
        <pattern id="cm-grain" patternUnits="userSpaceOnUse" width="19" height="19" patternTransform="rotate(24)">
          <circle cx="2.1" cy="3.4" r="0.95" fill="#8a7052" fillOpacity="0.38" />
          <circle cx="7.6" cy="1.2" r="0.45" fill="#8a7052" fillOpacity="0.28" />
          <circle cx="12.4" cy="5.1" r="0.8" fill="#8a7052" fillOpacity="0.34" />
          <circle cx="17.1" cy="2.6" r="0.4" fill="#8a7052" fillOpacity="0.26" />
          <circle cx="4.3" cy="8.7" r="0.6" fill="#8a7052" fillOpacity="0.3" />
          <circle cx="9.9" cy="10.3" r="1" fill="#8a7052" fillOpacity="0.38" />
          <circle cx="15.2" cy="9" r="0.5" fill="#8a7052" fillOpacity="0.26" />
          <circle cx="1.2" cy="13.6" r="0.75" fill="#8a7052" fillOpacity="0.32" />
          <circle cx="6.4" cy="16.2" r="0.42" fill="#8a7052" fillOpacity="0.24" />
          <circle cx="11.3" cy="14.1" r="0.62" fill="#8a7052" fillOpacity="0.3" />
          <circle cx="16.8" cy="15.4" r="0.9" fill="#8a7052" fillOpacity="0.36" />
          <circle cx="13.9" cy="18" r="0.5" fill="#8a7052" fillOpacity="0.26" />
          <circle cx="3.7" cy="17.9" r="0.38" fill="#8a7052" fillOpacity="0.24" />
        </pattern>

        {/* The ink band. The frontier runs off both ends of the chart and is cut
            here, so no run-off can reach the caption band. */}
        <clipPath id="cm-plot-clip">
          <rect x={s.space.x} y={s.space.y} width={s.space.width} height={s.inkB - s.space.y} />
        </clipPath>

        {/* Counters — objectBoundingBox, so ONE def serves every mark. */}
        <radialGradient id="cm-plate">
          <stop offset="0" stopColor="#03050b" stopOpacity="0.86" />
          <stop offset="0.62" stopColor="#03050b" stopOpacity="0.7" />
          <stop offset="1" stopColor="#03050b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cm-dome" cx="36%" cy="30%" r="76%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.34" />
          <stop offset="0.42" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="0.7" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.3" />
        </radialGradient>
        {/* Two defs for two side hues: a stop resolves var() against ITS OWN
            inherited colour — the stop lives in <defs> — not the referencing
            element's, so one def cannot serve both sides. */}
        <radialGradient id="cm-hold-blue">
          <stop offset="0" stopColor="var(--blue)" stopOpacity="0.14" />
          <stop offset="0.6" stopColor="var(--blue)" stopOpacity="0.05" />
          <stop offset="1" stopColor="var(--blue)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cm-hold-red">
          <stop offset="0" stopColor="var(--red)" stopOpacity="0.14" />
          <stop offset="0.6" stopColor="var(--red)" stopOpacity="0.05" />
          <stop offset="1" stopColor="var(--red)" stopOpacity="0" />
        </radialGradient>

        {/* THE ONLY TWO FILTERS IN THE FILE, applied per component and never to
            a group holding all of them — a group's filter region is the union
            bounding box, which for scattered blobs is most of the map. The
            region is a percentage of that ONE component's box, so it is bounded
            by construction; the old `component.length > 24 ? undefined` guard
            never fired (300 generated 30×22 maps top out at 19 dust and 14
            nebula cells) and its failure mode was inverted — the biggest, most
            visible region was the one that would have lost its blur and come
            back as hard hex facets. colorInterpolationFilters="sRGB" is
            load-bearing: the SVG default is linearRGB, which turns dark blurred
            plum into washed grey smoke. */}
        <filter id="cm-neb" x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id="cm-dust" x="-28%" y="-28%" width="156%" height="156%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="4.5" />
        </filter>
      </defs>

      {/* 1 · Ground. THE CLICK TARGET — no pointer-events:none here. */}
      <rect x={s.space.x} y={s.space.y} width={s.space.width} height={s.space.height} fill="url(#cm-void)" />

      {/* 2 · Starfield: ~430 stars in five paths, plus ten with a flare. */}
      <g pointerEvents="none">
        <path d={s.tiers[0]} fill="#aab6d8" fillOpacity={0.34} />
        <path d={s.tiers[1]} fill="#ccd6f2" fillOpacity={0.55} />
        <path d={s.tiers[2]} fill="#eef2ff" fillOpacity={0.85} />
        <path d={s.tiers[3]} fill="#ffd9b0" fillOpacity={0.5} />
        <path d={s.tiers[4]} fill="#bcd8ff" fillOpacity={0.5} />
        {s.bright.map((b) => (
          <g key={`bs${b.i}`}>
            <circle cx={b.x} cy={b.y} r={b.r * 4.5} fill="url(#cm-star-halo)" />
            <path
              d={`M${b.x - b.r * 5},${b.y}H${b.x + b.r * 5}M${b.x},${b.y - b.r * 5}V${b.y + b.r * 5}`}
              stroke="#cfe0ff"
              strokeWidth={0.5}
              opacity={0.3}
            />
            <circle cx={b.x} cy={b.y} r={b.r} fill="#ffffff" opacity={0.9} />
          </g>
        ))}
      </g>

      {/* 3 · Nebulae: translucent gas the stars still shine through. The blur
             dissolves the union's hex facets, because a nebula's edge is not a
             hex edge. */}
      {s.nebulae.map((n, i) => (
        <g key={`neb${i}`} filter="url(#cm-neb)" pointerEvents="none">
          <path d={n.d} fill="var(--lc-plum)" fillOpacity={0.18} fillRule="evenodd" />
          <path d={n.d} fill="url(#cm-neb-core)" fillRule="evenodd" />
          {s.knots[i].map((k, j) => (
            <circle key={j} cx={k.x} cy={k.y} r={k.r} fill="url(#cm-neb-knot)" />
          ))}
        </g>
      ))}

      {/* 4 · Dust: a dark granular hole that EATS the stars behind it.
             The body must be darker than the ground EVERYWHERE, not only near
             the plot's optical centre. #100c07 at .96 measured (14,12,7) against
             a (2,4,9) void — three times brighter than its surround and warm,
             which is a brown stain, the exact reading the brief names. The body
             is now a near-black hole (#030201) that sits under the darkest stop
             of cm-void, so occlusion does the work at every radius: no mask, no
             compositing, just paint order, and a second channel that survives
             greyscale absolutely. The colour of dust is carried by the grain
             above it, which is the only warm ink left in the belt. */}
      {s.dust.map((n, i) => (
        <g key={`dust${i}`} filter="url(#cm-dust)" pointerEvents="none">
          <path d={n.d} fill={DUST_BODY} fillOpacity={0.88} fillRule="evenodd" />
          {s.clumps[i].map((c, j) => (
            <circle key={j} cx={c.x} cy={c.y} r={c.r} fill="#000000" fillOpacity={0.6} />
          ))}
        </g>
      ))}
      {/* The grain is its own pass, outside the blurred groups: a filter applies
          to a whole subtree, so grain drawn inside the body group came out as a
          flat wash. Components never overlap, so a second pass over all of them
          costs one path each and nothing in paint order. */}
      {s.dust.map((n, i) => (
        <path key={`grain${i}`} d={n.d} fill="url(#cm-grain)" fillRule="evenodd" pointerEvents="none" />
      ))}

      {/* 5 · Star systems: a point of light, never an area fill. Sized by a
             positional hash, so no two are the same stamp and each is pinned to
             its coordinates forever. */}
      <g pointerEvents="none">
        {s.systems.map((hx) => {
          const c = hexCenter(hx, HEX)
          const coreR = 1.7 + hexNoise(hx, 0x51) * 0.9
          const coronaR = 10 + hexNoise(hx, 0x52) * 5
          const flare = coronaR * (0.5 + hexNoise(hx, 0x53) * 0.24)
          return (
            <g key={`sys${hx.q},${hx.r}`}>
              <circle cx={c.x} cy={c.y} r={coronaR} fill="url(#cm-corona)" />
              <path
                d={`M${c.x - flare},${c.y}H${c.x + flare}M${c.x},${c.y - flare}V${c.y + flare}`}
                stroke="#ffe9b8"
                strokeWidth={0.7}
                opacity={0.45}
              />
              <circle cx={c.x} cy={c.y} r={coreR} fill="#fff6de" />
            </g>
          )
        })}
      </g>

      {/* 6 · THE VIGNETTE — under every counter, every rule and every terrain
             rim, and over every depiction of space. Space falls away at the
             edges; the instrument does not. */}
      <rect
        x={s.space.x}
        y={s.space.y}
        width={s.space.width}
        height={s.space.height}
        fill="url(#cm-falloff)"
        pointerEvents="none"
      />

      {/* 7 · The mesh — an illuminated reticle dissolving into the dark. */}
      <path
        d={s.mesh.grid}
        fill="none"
        stroke="url(#cm-mesh-fade)"
        strokeWidth={0.6}
        shapeRendering="geometricPrecision"
        pointerEvents="none"
      />
      {/* The reticle inside a terrain region: at full weight a cool hairline
          across every shared edge was the highest-contrast feature in a dust
          belt, and it is what made a smear read as a stack of tiles. */}
      <path
        d={s.mesh.veiled}
        fill="none"
        stroke="url(#cm-mesh-fade)"
        strokeOpacity={0.18}
        strokeWidth={0.6}
        shapeRendering="geometricPrecision"
        pointerEvents="none"
      />
      {/* A system hex, stated BROKEN: a tick centred on each of the six edges
          (period 16 = one edge, so "3.5 12.5" at −6.25 lands each tick mid-edge).
          A continuous gold hexagon was the selection frame in a lower key —
          same shape, same weight, same family — and it also put an outlined
          TILE back around a mark whose whole point is that it is a point of
          light. Broken vs continuous is the channel that separates them. */}
      <path
        d={s.mesh.lit}
        fill="none"
        stroke="#ffe9b8"
        strokeOpacity={0.28}
        strokeWidth={0.8}
        strokeDasharray="3.5 12.5"
        strokeDashoffset={-6.25}
        strokeLinecap="round"
        pointerEvents="none"
      />
      {/* The plot edge is the tactical map's .map-edge, value for value — and
          now, like .map-edge, ONE continuous outline, so "8 6" runs instead of
          restarting on each 16-unit edge into a 100-tooth comb. */}
      <path
        d={s.rim}
        fill="none"
        stroke="rgba(125,91,166,0.55)"
        strokeWidth={1}
        strokeDasharray="8 6"
        pointerEvents="none"
      />

      {/* 8 · Terrain rims: the exact statement of which hexes cost 2 to enter,
             on a MERGED outline, so no internal edge survives to be seen.
             The two rims part on SHAPE, not only hue: gas is a fine stipple,
             dust is a dot chain. And dust is no longer drawn in --lc-orange —
             that hue is the engagement's, and lending it to terrain put a
             battle chit, a star and a dust belt in one warm family. */}
      <path
        d={s.nebulae.map((n) => n.d).join('')}
        fill="none"
        stroke="var(--lc-plum)"
        strokeOpacity={0.3}
        strokeWidth={0.8}
        strokeDasharray="2.5 3.5"
        pointerEvents="none"
      />
      <path
        d={s.dust.map((n) => n.d).join('')}
        fill="none"
        stroke={DUST_RIM}
        strokeOpacity={0.45}
        strokeWidth={1}
        strokeDasharray="0.1 3.8"
        strokeLinecap="round"
        pointerEvents="none"
      />

      {/* 10 · The frontier — was the loudest thing on the map. One smoothed
              hachured line over a merged corridor silhouette; red ink down
              roughly 80% from 22 dashed rings. The corridor carries WHICH HEXES
              are contested — a fact the smoothed centre-line cannot state, and
              which at 0.12/0.5 under a 7-wide glow was not on the plot at all.
              It is a 7% WASH inside one merged outline — a band. The outline
              stays a whisper on purpose: a border list is one hex wide, so its
              merged silhouette zigzags around every cell, and any weight on it
              at all brings back the chain of red rings this pass removed. */}
      <g
        pointerEvents="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        clipPath="url(#cm-plot-clip)"
      >
        <path
          d={s.corridor}
          fill="var(--red)"
          fillOpacity={0.07}
          fillRule="evenodd"
          stroke="var(--red)"
          strokeOpacity={0.11}
          strokeWidth={0.6}
        />
        <path d={s.frontier} stroke="var(--red)" strokeWidth={7} opacity={0.07} />
        <path d={s.frontier} stroke="var(--red)" strokeWidth={1.1} opacity={0.5} strokeDasharray="7 5" />
        <path d={s.ticks} stroke="var(--red)" strokeWidth={1} opacity={0.5} />
      </g>
    </>
  )
}

const Deepspace = memo(DeepspaceImpl, (a, b) => a.sig === b.sig && a.side === b.side)

/* ══ The component ═════════════════════════════════════════════════════════ */

interface Props {
  view: SideView
  selectedUnitId: string | null
  selectedContactId: string | null
  /**
   * `[unit.hex, ...order.waypoints]` for the selected unit — the unit's hex
   * plus the ORDERED waypoints, not the resolved path. Legs are therefore
   * multi-hex and each leg's hexDistance is real information.
   */
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
  const last = hexCenter({ q: view.map.width - 1, r: 0 }, HEX)
  const width = last.x + HEX * 2
  const height = view.map.height * HEX * Math.sqrt(3) + HEX * 2
  const own = view.side === 'A' ? 'var(--blue)' : 'var(--red)'
  const foe = view.side === 'A' ? 'var(--red)' : 'var(--blue)'
  const holdId = view.side === 'A' ? 'cm-hold-blue' : 'cm-hold-red'
  /* The first clear scanline under the lowest hex. The viewBox runs 32 units
     past it, which is where the legend goes. */
  const legendTop = height - HEX * 2
  const legendLeft = -HEX
  /* The caption is right-aligned in the same band as the legend's fourth
     column, so its guard has to be the actual collision and not a round number:
     labelHalfWidth is the estimator the label stacker already trusts, and the
     10-unit pad covers the 0.1em tracking it does not model. */
  const caption = `PLOT ${view.map.width} × ${view.map.height} HEXES`
  const captionFits =
    width - 4 - 2 * labelHalfWidth(caption) - 10 >
    legendLeft + LEG_STEP * 3 + 16 + 2 * labelHalfWidth('FRONTIER')

  const sig = useMemo(() => mapSeed(view.map).toString(16), [view.map])

  /* The star systems, which are map data and therefore view-legal. They are
     obstacles for two different layers below — a grid fix on a star core, and
     a unit's name through a star — so they are gathered once. */
  const systemHexes = useMemo(
    () => view.map.terrain.filter((t) => t.kind === 'system').map((t) => ({ q: t.q, r: t.r })),
    [view.map.terrain],
  )
  const holdings = useMemo(
    () => [...view.infrastructure, ...view.knownEnemyInfrastructure],
    [view.infrastructure, view.knownEnemyInfrastructure],
  )

  /* Counters occupy hexes; a grid fix that lands under one is noise. So does a
     star, and so does an installation — a fix's cross was being swallowed by a
     star core, which is the same defect as landing under a counter and was
     missed because this set only knew about counters. ≤ 60 entries, rebuilt
     per render, trivial. */
  const occupied = useMemo(() => {
    const set = new Set<string>()
    const mark = (hx: Hex): void => {
      set.add(hexKey(hx))
      for (const d of hexesWithin(hx, 1)) set.add(hexKey(d))
    }
    for (const u of view.units) mark(u.hex)
    for (const c of view.contacts) mark(c.hex)
    for (const e of view.engagements) mark(e.hex)
    // A corona spills a hex, a plate is r=13 — the hex itself is enough here,
    // and the neighbours' fixes sit a full 27.7 units away.
    for (const hx of systemHexes) set.add(hexKey(hx))
    for (const i of holdings) set.add(hexKey(i.hex))
    return set
  }, [view.units, view.contacts, view.engagements, systemHexes, holdings])

  const fixes = useMemo(() => {
    const out: { hex: Hex; x: number; y: number; lx: number; ly: number }[] = []
    for (const hx of allHexes(view.map.width, view.map.height)) {
      if (hx.q % 5 !== 0 || hx.r % 5 !== 0) continue
      const c = hexCenter(hx, HEX)
      /* The cross marks the centre; the LABEL is what straddles the plot edge —
         a column-0 fix is centred on x=0 and the rim runs through x=−8, and a
         top-row fix's baseline at y−4.5 sits above the ink entirely. Nudge the
         label inboard rather than dropping it: the edge is exactly where a
         coordinate is wanted. */
      const onLeft = hx.q === 0
      const onRight = hx.q === view.map.width - 1
      const onTop = hx.r === -Math.floor(hx.q / 2)
      out.push({
        hex: hx,
        x: c.x,
        y: c.y,
        lx: c.x + (onLeft ? 10 : onRight ? -10 : 0),
        ly: c.y + (onTop ? 12.5 : -4.5),
      })
    }
    return out
  }, [view.map.width, view.map.height])

  /* Two units in one hex are one counter to anyone looking, so they fan —
     drawing only; nothing in the view moves. */
  const fan = useMemo(() => {
    const byHex = new Map<string, string[]>()
    for (const u of [...view.units].sort((a, b) => a.id.localeCompare(b.id))) {
      const k = hexKey(u.hex)
      const list = byHex.get(k)
      if (list) list.push(u.id)
      else byHex.set(k, [u.id])
    }
    const out: Record<string, number> = {}
    for (const ids of byHex.values()) {
      ids.forEach((id, i) => {
        out[id] = (i - (ids.length - 1) / 2) * 14
      })
    }
    return out
  }, [view.units])

  /* Names stack clear of one another and of every counter — the same pure
     helper the tactical map uses, with the same stable ordering. */
  const shifts = useMemo(() => {
    const boxes: LabelBox[] = view.units.map((u) => {
      const c = hexCenter(u.hex, HEX)
      const name = u.ships[0]?.name ?? u.id
      return { id: u.id, x: c.x, y: c.y + (fan[u.id] ?? 0) + 19, halfWidth: labelHalfWidth(name) + 8 }
    })
    const obstacles: LabelObstacle[] = []
    for (const u of view.units) {
      const c = hexCenter(u.hex, HEX)
      const dy = fan[u.id] ?? 0
      obstacles.push({ x1: c.x - 13, x2: c.x + 13, y1: c.y + dy - 13, y2: c.y + dy + 13 })
    }
    for (const c of view.contacts) {
      const p = hexCenter(c.hex, HEX)
      obstacles.push({ x1: p.x - 12, x2: p.x + 12, y1: p.y - 12, y2: p.y + 12 })
    }
    for (const e of view.engagements) {
      const p = hexCenter(e.hex, HEX)
      obstacles.push({ x1: p.x - 13, x2: p.x + 13, y1: p.y - 32, y2: p.y - 5 })
    }
    /* Terrain is an obstacle too. A name plus its 2.4-wide ground casing drawn
       straight through a star erases the star AND the hex it names, and the
       obstacle list knowing only about counters is why it happened. The boxes
       are the HARD parts only — a star's core and flare inside ±9, a holding's
       ring at r=8 — not the soft corona or the plate: a haloed name crossing
       diffuse light is legible, and boxing the whole corona costs a name two
       stacked lines and pulls it away from the counter it belongs to. */
    for (const hx of systemHexes) {
      const p = hexCenter(hx, HEX)
      obstacles.push({ x1: p.x - 9, x2: p.x + 9, y1: p.y - 9, y2: p.y + 9 })
    }
    for (const i of holdings) {
      const p = hexCenter(i.hex, HEX)
      obstacles.push({ x1: p.x - 10, x2: p.x + 10, y1: p.y - 10, y2: p.y + 10 })
    }
    return stackLabels(boxes, obstacles)
  }, [view.units, view.contacts, view.engagements, fan, systemHexes, holdings])

  /* A fix is the FIRST thing to give way. It is a redundant convenience — the
     sidebar prints the same axial pair — so where a placed unit name lands on
     one, the fix goes rather than the name: the alternative is feeding fixes
     into the stacker as obstacles, which pushes a name further from the counter
     it belongs to in order to protect the less important mark. Runs after
     `shifts`, over ~30 × ~4 rectangles. */
  const fixHidden = useMemo(() => {
    const hidden = new Set<string>()
    const names = view.units.map((u) => {
      const c = hexCenter(u.hex, HEX)
      const name = (u.ships[0]?.name ?? u.id).toUpperCase()
      const y = c.y + (fan[u.id] ?? 0) + 19 + (shifts[u.id] ?? 0)
      const hw = labelHalfWidth(name) + 4
      return { x1: c.x - hw, x2: c.x + hw, y1: y - 9, y2: y + 3 }
    })
    for (const f of fixes) {
      const hw = labelHalfWidth(`${f.hex.q},${f.hex.r}`)
      const b = { x1: f.lx - hw, x2: f.lx + hw, y1: f.ly - 9, y2: Math.max(f.ly + 3, f.y + 3) }
      for (const n of names) {
        if (b.x1 < n.x2 && b.x2 > n.x1 && b.y1 < n.y2 && b.y2 > n.y1) {
          hidden.add(hexKey(f.hex))
          break
        }
      }
    }
    return hidden
  }, [fixes, view.units, fan, shifts])
  const fixVisible = (f: { hex: Hex }): boolean =>
    !occupied.has(hexKey(f.hex)) && !fixHidden.has(hexKey(f.hex))

  const routePts = plannedWaypoints.map((hx) => hexCenter(hx, HEX))
  const routeTotal = plannedWaypoints.reduce(
    (sum, hx, i) => (i === 0 ? 0 : sum + hexDistance(plannedWaypoints[i - 1], hx)),
    0,
  )

  return (
    <svg
      className="campaign-map"
      viewBox={`${-HEX} ${-HEX} ${width + HEX} ${height + HEX}`}
      role="img"
      style={{ fontFamily: 'var(--font-lcars)' }}
      aria-label={
        `Campaign plot, ${view.map.width} by ${view.map.height} hexes. ` +
        `${view.units.length} of your units, ${view.contacts.length} contacts, ` +
        `${view.engagements.length} battles waiting.`
      }
      onClick={(e) => {
        const svg = e.currentTarget
        const point = svg.createSVGPoint()
        point.x = e.clientX
        point.y = e.clientY
        const local = point.matrixTransform(svg.getScreenCTM()!.inverse())
        const hex = pixelToHex(local.x, local.y, HEX)
        // Bounds guard: without it a click in the legend band appends an
        // off-map waypoint to the selected unit's order.
        if (inBounds(hex, view.map.width, view.map.height)) onClickHex(hex)
      }}
    >
      <Deepspace sig={sig} map={view.map} side={view.side} />

      {/* 9 · Grid fixes. A skew grid defeats edge rulers (rMin = −floor(q/2), so
             a left-edge r scale is literally true only for column 0), and the
             sidebar prints raw axial pairs like "eng-3 at 14,2". These are those
             pairs, on the plot, for a quarter of a ruler's ink.

             They are ink at 4.9:1, not 1.5:1. A fix is the substitute for a
             coordinate ruler the skew grid makes impossible, so it is
             information and it has to be legible on the panels this ships to;
             what made the earlier, brighter version compete with unit names was
             that it had no casing, not that it was bright. The casing is the
             fix, and it is thinner than a counter's so the numerals stay light. */}
      <g pointerEvents="none" aria-hidden="true">
        <path
          d={fixes
            .filter(fixVisible)
            .map((f) => `M${f.x - 2.4},${f.y}h4.8M${f.x},${f.y - 2.4}v4.8`)
            .join('')}
          stroke="rgba(150,172,208,0.55)"
          strokeWidth={0.7}
          fill="none"
        />
        {view.map.width >= 12 &&
          fixes
            .filter(fixVisible)
            .map((f) => (
              <text
                key={`fx${f.hex.q},${f.hex.r}`}
                x={f.lx}
                y={f.ly}
                textAnchor="middle"
                fontSize={TEXT}
                fill="rgba(150,172,208,0.78)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
                {...HALO}
                strokeWidth={2}
              >
                {`${f.hex.q},${f.hex.r}`}
              </text>
            ))}
      </g>

      {/* 11 · Infrastructure: yours whole, theirs as the charts show it. The
              glyph is on-map ink; ownership is the ring around it, dashed when
              the holding is the enemy's and therefore reported rather than seen.
              Destroyed is a STRIKE at full opacity — opacity below 1 means
              "unavailable" and nothing else.

              An enemy holding used to be a DASHED ring in the foe's colour —
              which is the contact's own sentence — around a diamond glyph,
              which is the contact's own shape. Two channels of one vocabulary
              said two unrelated things. A reported holding now takes a
              DOT-DASH, the surveyor's line for a boundary taken from a report,
              which no contact uses; an outpost is a triangle, which no contact
              is; and a holding never moves, so its label vocabulary must not be
              borrowable by something that does.

              The plate carries the <title>: the group is pointer-events:none so
              that a 660-hex mousemove never hit-tests it and so that a click
              still resolves to a hex at the root, and a title on an untestable
              element is a tooltip that can never open. The plate is under the
              counters in paint order, so a unit sharing the hex still wins. */}
      {holdings.map((i) => {
        const c = hexCenter(i.hex, HEX)
        const mine = view.infrastructure.some((x) => x.id === i.id)
        return (
          <g key={i.id} pointerEvents="none">
            {mine && !i.destroyed && <circle cx={c.x} cy={c.y} r={11} fill={`url(#${holdId})`} />}
            <circle cx={c.x} cy={c.y} r={13} fill="url(#cm-plate)" opacity={0.55} pointerEvents="auto">
              <title>
                {`${INFRA_NAME[i.kind] ?? i.kind} · ${mine ? 'yours' : 'enemy, reported'}${
                  i.destroyed ? ' · destroyed' : ''
                } · at ${i.hex.q},${i.hex.r}`}
              </title>
            </circle>
            <circle
              cx={c.x}
              cy={c.y}
              r={8}
              fill="none"
              stroke={mine ? own : foe}
              strokeWidth={1}
              strokeDasharray={mine ? undefined : '5 2 1 2'}
              opacity={0.7}
            />
            <text
              x={c.x}
              y={c.y + 4}
              textAnchor="middle"
              fontSize={12}
              fill={i.destroyed ? 'var(--ink-mute)' : 'var(--ink-dim)'}
              {...HALO}
            >
              {INFRA_GLYPH[i.kind] ?? '?'}
            </text>
            {i.destroyed && (
              <path
                d={`M${c.x - 6},${c.y - 6}L${c.x + 6},${c.y + 6}`}
                stroke="var(--danger)"
                strokeWidth={1.2}
                opacity={0.85}
              />
            )}
          </g>
        )
      })}

      {/* 12 · The selected unit's planned route. Straight segments: the legs
              join arbitrary ordered waypoints and smoothing would lie about
              which hexes they cross. Sand throughout — sand is "your plan and
              where you are" and must not read as a second friendly force. */}
      {routePts.length > 0 && selectedUnitId && (
        <g pointerEvents="none">
          <polyline
            points={routePts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#03050b"
            strokeWidth={3.2}
            opacity={0.6}
          />
          <polyline
            points={routePts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="var(--lc-sand)"
            strokeWidth={1.2}
            strokeDasharray="5 3.5"
            opacity={0.85}
            strokeLinecap="round"
          />
          <circle
            cx={routePts[0].x}
            cy={routePts[0].y}
            r={3}
            fill="none"
            stroke="var(--lc-sand)"
            strokeWidth={1.2}
            opacity={0.85}
          />
          {routePts.slice(1).map((p, i) => {
            const a = plannedWaypoints[i]
            const b = plannedWaypoints[i + 1]
            const legs = hexDistance(a, b)
            const mid = { x: (routePts[i].x + p.x) / 2, y: (routePts[i].y + p.y) / 2 }
            return (
              <g key={`wp${i}`}>
                {/* A plotted order is a RECORD, so the waypoint mark has radius
                    0. The LAST waypoint gets the arrowhead instead — an order
                    ends in a hex, and two marks on one point read as neither. */}
                {i !== routePts.length - 2 && (
                  <rect
                    x={p.x - 2.5}
                    y={p.y - 2.5}
                    width={5}
                    height={5}
                    fill="none"
                    stroke="var(--lc-sand)"
                    strokeWidth={1.2}
                  />
                )}
                <text x={p.x + 9} y={p.y - 6} fontSize={TEXT} fill="var(--lc-sand)" opacity={0.9} {...HALO}>
                  {i + 1}
                </text>
                {legs >= 2 && (
                  <text
                    x={mid.x}
                    y={mid.y - 3}
                    textAnchor="middle"
                    fontSize={TEXT}
                    fill="var(--lc-sand)"
                    opacity={0.75}
                    {...HALO}
                  >
                    {legs}
                  </text>
                )}
              </g>
            )
          })}
          {routePts.length > 1 &&
            (() => {
              const end = routePts[routePts.length - 1]
              const prev = routePts[routePts.length - 2]
              const a = (Math.atan2(end.y - prev.y, end.x - prev.x) * 180) / Math.PI
              return (
                <g>
                  <polygon
                    points="0,0 -7,-2.5 -7,2.5"
                    fill="var(--lc-sand)"
                    transform={`translate(${end.x} ${end.y}) rotate(${a})`}
                  />
                  <polygon
                    points={hexPoints(plannedWaypoints[plannedWaypoints.length - 1], HEX)}
                    fill="none"
                    stroke="var(--lc-sand)"
                    strokeWidth={1}
                    opacity={0.55}
                  />
                  <text
                    x={end.x}
                    y={end.y + 26}
                    textAnchor="middle"
                    fontSize={TEXT}
                    fill="var(--lc-sand)"
                    opacity={0.85}
                    letterSpacing="0.08em"
                    {...HALO}
                  >
                    {/* Not "PLOT n HEX": the caption band already calls the
                        map's extent PLOT, and one word naming both the chart
                        and a distance along it teaches neither. */}
                    {`COURSE ${routeTotal} HEX`}
                  </text>
                </g>
              )
            })()}
        </g>
      )}

      {/* 13 · Contacts — marks on the glass, never objects on the table. A
              weaker plate, no dome, hollow AND dashed: withheld identity must
              LOOK withheld, and less substantial than the thing you own. */}
      {view.contacts.map((contact) => (
        <ContactMark
          key={contact.id}
          contact={contact}
          foe={foe}
          round={view.round}
          selected={contact.id === selectedContactId}
          width={view.map.width}
          height={view.map.height}
          onSelect={onClickContact}
        />
      ))}

      {/* 14 · Own units — objects on the table: plate, dome, hard rim. */}
      {view.units.map((unit) => {
        const base = hexCenter(unit.hex, HEX)
        const dy = fan[unit.id] ?? 0
        const c = { x: base.x, y: base.y + dy }
        const selected = unit.id === selectedUnitId
        const cloaked = unit.order.cloaked
        const name = (unit.ships[0]?.name ?? unit.id).toUpperCase()
        const tier = SPEED_TIER[unit.order.speed] ?? 0
        const codes = unitCodes(unit)
        // Heading, from unit.course (a Hex delta the view carries whole).
        let leader: ReactNode = null
        if (unit.course && tier > 0) {
          const dx = COL * unit.course.q
          const dyy = ROW * (unit.course.r + unit.course.q / 2)
          const a = (Math.atan2(dyy, dx) * 180) / Math.PI
          const len = 9 + 3.5 * tier
          leader = (
            <g transform={`translate(${c.x} ${c.y}) rotate(${a})`} opacity={0.85}>
              <path
                d={`M13,0H${13 + len}`}
                stroke={own}
                strokeWidth={1.2}
                fill="none"
                paintOrder="stroke"
                strokeLinecap="round"
              />
              <polygon
                points={`${13 + len + 5},0 ${13 + len},-2.8 ${13 + len},2.8`}
                fill={unit.movedLastOwnPhase ? own : 'none'}
                stroke={own}
                strokeWidth={0.9}
              />
              {Array.from({ length: tier }, (_, k) => (
                <path
                  key={k}
                  d={`M${15 + k * 3.4},-3.5L${15 + k * 3.4},3.5`}
                  stroke={k === 3 ? 'var(--warn)' : own}
                  strokeWidth={1}
                />
              ))}
            </g>
          )
        }
        return (
          <g
            key={unit.id}
            data-unit={unit.id}
            onClick={(e) => {
              e.stopPropagation()
              onClickUnit(unit.id)
            }}
            style={{ cursor: 'pointer' }}
          >
            {/* The leader sits BEHIND the counter so it never crosses the numeral. */}
            {leader}
            <circle cx={c.x} cy={c.y} r={13} fill="url(#cm-plate)" />
            <circle cx={c.x} cy={c.y} r={8} fill={own} opacity={cloaked ? 0.5 : 1} />
            {/* A colour-agnostic white→black value overlay laid OVER the
                untouched side fill: --blue is still literally painted there,
                with light on it. The 30% rim darkening is the load-bearing
                half — a flat disc loses its silhouette against a starfield. */}
            {!cloaked && <circle cx={c.x} cy={c.y} r={8} fill="url(#cm-dome)" />}
            <circle
              cx={c.x}
              cy={c.y}
              r={8}
              fill="none"
              stroke={selected ? 'var(--lc-sand)' : 'rgba(0,0,0,0.65)'}
              strokeWidth={selected ? 2.5 : 1}
              strokeDasharray={cloaked ? '2 2' : undefined}
            />
            {/* The selection frame is CONTINUOUS, and a system hex's is not:
                the two were a gold hexagon each, at one weight, differing only
                in brightness. Solid vs broken is the channel that tells them
                apart, and it is the one that survives on a dim panel. */}
            {selected && (
              <polygon
                points={hexPoints(unit.hex, HEX)}
                fill="none"
                stroke="var(--lc-sand)"
                strokeWidth={1.4}
                opacity={0.8}
              />
            )}
            <text
              x={c.x}
              y={c.y + 3.6}
              textAnchor="middle"
              fontSize={TEXT}
              fontWeight={700}
              fill="var(--ink-on-fill)"
            >
              {unit.ships.length}
            </text>
            <text
              x={c.x}
              y={c.y + 19 + (shifts[unit.id] ?? 0)}
              textAnchor="middle"
              fontSize={TEXT}
              letterSpacing="0.05em"
              {...HALO}
            >
              <tspan fill={own}>{name}</tspan>
              {codes && <tspan fill="var(--ink-dim)">{` · ${codes}`}</tspan>}
            </text>
            <title>
              {`${unit.ships[0]?.name ?? unit.id} · ${unit.kind} · ${unit.ships.length} hull${
                unit.ships.length === 1 ? '' : 's'
              } · ${unit.order.speed}${unit.order.cloaked ? ' · cloaked' : ''} · endurance ${unit.endurance}/${
                unit.enduranceMax
              } · at ${unit.hex.q},${unit.hex.r}`}
            </title>
          </g>
        )
      })}

      {/* 15 · Battles waiting on the table. Orange, and the only orange on this
              screen besides the frame and the End-phase control. A stem and a
              filled hex tie the marker to its hex; it is a domed chit like a
              unit, because a battle waiting is an object on the table. */}
      {view.engagements.map((engagement) => {
        const c = hexCenter(engagement.hex, HEX)
        const tag = engagement.youAmbush
          ? 'AMBUSH'
          : engagement.youWereCaughtRetreating
            ? 'CAUGHT'
            : `R${engagement.round}·P${engagement.phase}`
        return (
          <g key={engagement.id} pointerEvents="none">
            <polygon
              points={hexPoints(engagement.hex, HEX)}
              fill="var(--lc-orange)"
              fillOpacity={0.12}
              stroke="var(--lc-orange)"
              strokeOpacity={0.7}
              strokeWidth={1.4}
            />
            <path d={`M${c.x},${c.y}V${c.y - 10}`} stroke="var(--lc-orange)" strokeWidth={1} opacity={0.7} />
            <circle cx={c.x} cy={c.y - 18.5} r={13} fill="url(#cm-plate)" />
            {/* The chit disc carries the <title>: with the group at
                pointer-events:none nothing here could be hovered, so a battle
                waiting had no discoverable detail at all. Only the DISC opts
                back in — the hex polygon must not, or a click meant for a unit
                standing in the engagement's hex would be swallowed by it. */}
            <circle
              cx={c.x}
              cy={c.y - 18.5}
              r={8.5}
              fill="var(--lc-orange)"
              stroke="rgba(0,0,0,0.65)"
              strokeWidth={1}
              pointerEvents="auto"
            >
              <title>
                {`Battle waiting at ${engagement.hex.q},${engagement.hex.r} · round ${engagement.round} phase ${
                  engagement.phase
                } · ${engagement.yourUnitIds.length} of your units${
                  engagement.youAmbush ? ' · you have the ambush' : ''
                }${engagement.youWereCaughtRetreating ? ' · caught retreating' : ''}`}
              </title>
            </circle>
            <circle cx={c.x} cy={c.y - 18.5} r={8.5} fill="url(#cm-dome)" />
            <text x={c.x} y={c.y - 14} textAnchor="middle" fontSize={13} fill="var(--ink-on-fill)">
              ⚔
            </text>
            <text
              x={c.x}
              y={c.y - 31}
              textAnchor="middle"
              fontSize={TEXT}
              fill="var(--lc-orange)"
              letterSpacing="0.06em"
              {...HALO}
            >
              {tag}
            </text>
          </g>
        )
      })}

      {/* ── 16 · Legend ───────────────────────────────────────────────────────
          Drawn in the clear band the viewBox already reserved under the lowest
          hex, so it costs the plot nothing. Every swatch is built from the same
          defs the map uses — an approximated swatch teaches the wrong reading —
          and no swatch is hex-shaped, because a tinted tile is exactly the
          reading this pass removes. */}
      <g
        fontSize={TEXT}
        letterSpacing="0.1em"
        fill="var(--ink-dim)"
        aria-hidden="true"
        pointerEvents="none"
      >
        <g transform={`translate(${legendLeft} ${legendTop})`}>
          <circle cx={5.5} cy={8} r={5.5} fill="url(#cm-corona)" />
          <circle cx={5.5} cy={8} r={1.4} fill="#fff6de" />
          <text x={16} y={12}>
            SYSTEM
          </text>
        </g>
        <g transform={`translate(${legendLeft + LEG_STEP} ${legendTop})`}>
          <circle cx={5.5} cy={8} r={6} fill="url(#cm-neb-core)" />
          <circle
            cx={5.5}
            cy={8}
            r={5}
            fill="none"
            stroke="var(--lc-plum)"
            strokeOpacity={0.3}
            strokeWidth={0.8}
            strokeDasharray="2.5 3.5"
          />
          <text x={16} y={12}>
            NEBULA
          </text>
        </g>
        {/* Dust's swatch is a HOLE with grit in it, which is what the map now
            paints: the body value, the same grain pattern, the same dot rim.
            The old swatch quoted a body colour the map had stopped using. */}
        <g transform={`translate(${legendLeft + LEG_STEP * 2} ${legendTop})`}>
          <rect x={0} y={2.5} width={11} height={11} fill={DUST_BODY} fillOpacity={0.88} />
          <rect x={0} y={2.5} width={11} height={11} fill="url(#cm-grain)" />
          <rect
            x={0}
            y={2.5}
            width={11}
            height={11}
            fill="none"
            stroke={DUST_RIM}
            strokeOpacity={0.45}
            strokeWidth={1}
            strokeDasharray="0.1 3.8"
            strokeLinecap="round"
          />
          <text x={16} y={12}>
            DUST
          </text>
        </g>
        <g transform={`translate(${legendLeft + LEG_STEP * 3} ${legendTop})`}>
          <path d="M2,14L6,2" stroke="var(--red)" strokeWidth={1.1} opacity={0.5} strokeDasharray="7 5" />
          {/* Hachures at the length the map draws them, on your side of the
              line — the legend was advertising a mark the plot did not show. */}
          <path d="M4.4,9.3L11.5,11.6M5.7,4.4L12.8,6.7" stroke="var(--red)" strokeWidth={1} opacity={0.5} />
          <text x={16} y={12}>
            FRONTIER
          </text>
        </g>

        {/* The map's own extent, so the mesh has a stated scale rather than
            being an unlabelled grid. Suppressed when it would land on the
            FRONTIER column — the old guard was set at a plot width of 300,
            which is a 13-hex map, and the collision starts at 420. */}
        {captionFits && (
          <text x={width - 4} y={legendTop + 12} textAnchor="end">
            {caption}
          </text>
        )}

        <g transform={`translate(${legendLeft} ${legendTop + 15})`}>
          <circle cx={5.5} cy={8} r={5.5} fill={own} />
          <circle cx={5.5} cy={8} r={5.5} fill="url(#cm-dome)" />
          <circle cx={5.5} cy={8} r={5.5} fill="none" stroke="rgba(0,0,0,0.65)" strokeWidth={1} />
          <path d="M11,8H17" stroke={own} strokeWidth={1} opacity={0.75} />
          <path d="M13,5.5V10.5" stroke={own} strokeWidth={1} opacity={0.75} />
          <text x={22} y={12}>
            YOURS
          </text>
        </g>

        <g transform={`translate(${legendLeft + LEG_STEP} ${legendTop + 15})`}>
          <rect
            x={1}
            y={3.5}
            width={9}
            height={9}
            transform="rotate(45 5.5 8)"
            fill={foe}
            fillOpacity={0.18}
            stroke={foe}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <text x={16} y={12}>
            CONTACT
          </text>
        </g>

        <g transform={`translate(${legendLeft + LEG_STEP * 2} ${legendTop + 15})`}>
          <circle cx={5.5} cy={8} r={5.5} fill="var(--lc-orange)" />
          <circle cx={5.5} cy={8} r={5.5} fill="url(#cm-dome)" />
          <text x={16} y={12}>
            BATTLE
          </text>
        </g>

        {/* At the 10px floor, like every other glyph on this plot. */}
        <g transform={`translate(${legendLeft + LEG_STEP * 3} ${legendTop + 15})`}>
          <circle cx={5.5} cy={8} r={7} fill="none" stroke={own} strokeWidth={1} opacity={0.7} />
          <text x={5.5} y={11.5} textAnchor="middle" fontSize={TEXT} fill="var(--ink-dim)">
            ⬢
          </text>
          <text x={16} y={12}>
            INFRA
          </text>
        </g>
      </g>
    </svg>
  )
}

/* ══ A contact ═════════════════════════════════════════════════════════════ */

function ContactMark({
  contact,
  foe,
  round,
  selected,
  width,
  height,
  onSelect,
}: {
  contact: ViewedContact
  foe: string
  round: number
  selected: boolean
  width: number
  height: number
  onSelect: (id: string) => void
}) {
  const c = hexCenter(contact.hex, HEX)
  const age = Math.max(0, round - contact.lastScan.round)
  const dash = contact.collapsed ? '1 4' : age <= 0 ? '3 3' : age === 1 ? '2 4' : '1 5'
  const band = contact.attributes.sizeClass?.value
  const hw = band === 'small' ? 5 : band === 'medium' ? 6.5 : band === 'large' ? 8 : 6
  const attr =
    contact.attributes.shipClass ??
    contact.attributes.faction ??
    contact.attributes.sizeClass ??
    contact.attributes.bearingClass
  const label = contact.collapsed ? 'LAST KNOWN' : (attr?.value ?? 'contact').toUpperCase()
  // Uncertainty in the units the game is played in: "somewhere in these 19
  // hexes", not a fuzzy circle. The wash is FLAT — drift is uniform per
  // unscanned round, so a bright centre would imply a peak the rules do not
  // model. Capped at 3, which is already 37 hexes.
  const u = Math.min(contact.uncertainty, 3)
  /* 37 hexes × 6 edge tests plus the chain and the string building — the only
     uncached geometry left in the hot path, and it ran on every state change
     for every contact. It depends on four numbers. */
  const cloud = useMemo(
    () =>
      u > 0 ? regionPath(hexesWithin(contact.hex, u).filter((hx) => inBounds(hx, width, height))) : '',
    [contact.hex.q, contact.hex.r, u, width, height],
  )
  return (
    <g
      data-contact={contact.id}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(contact.id)
      }}
      style={{ cursor: 'pointer' }}
    >
      {/* The cloud is DEPICTION, not the handle: at u=3 it covers 37 hexes, and
          a painted fill hit-tests, so leaving it in the group would swallow
          every map click — and every waypoint — inside that region. The plate,
          the diamond and the label are the contact's click target. */}
      {cloud && (
        <path
          pointerEvents="none"
          d={cloud}
          fill={foe}
          fillOpacity={contact.collapsed ? 0.02 : 0.04}
          stroke={foe}
          strokeOpacity={contact.collapsed ? 0.2 : 0.3}
          strokeWidth={0.8}
          strokeDasharray={contact.collapsed ? '1 4' : '3 4'}
          fillRule="evenodd"
        />
      )}
      <circle cx={c.x} cy={c.y} r={12} fill="url(#cm-plate)" opacity={0.55} />
      <rect
        x={c.x - hw}
        y={c.y - hw}
        width={hw * 2}
        height={hw * 2}
        transform={`rotate(45 ${c.x} ${c.y})`}
        fill={foe}
        fillOpacity={contact.collapsed ? 0 : 0.18}
        stroke={foe}
        strokeWidth={1}
        strokeDasharray={dash}
      />
      {contact.positionEstimated ? (
        // Reckoning brackets — a mark, not a fade. Opacity is not a record state.
        <path
          d={`M${c.x - hw - 3},${c.y - 6}h-3v12h3M${c.x + hw + 3},${c.y - 6}h3v12h-3`}
          fill="none"
          stroke={foe}
          strokeWidth={0.9}
          opacity={0.85}
        />
      ) : (
        <path
          d={`M${c.x - 2.5},${c.y}h5M${c.x},${c.y - 2.5}v5`}
          stroke={foe}
          strokeWidth={0.8}
          opacity={0.9}
        />
      )}
      {selected && (
        <path
          d={`M${c.x - 11},${c.y - 6}v-5h5M${c.x + 11},${c.y - 6}v-5h-5` +
            `M${c.x - 11},${c.y + 6}v5h5M${c.x + 11},${c.y + 6}v5h-5`}
          fill="none"
          stroke="var(--lc-sand)"
          strokeWidth={1.6}
        />
      )}
      <text
        x={c.x}
        y={c.y - 13}
        textAnchor="middle"
        fontSize={TEXT}
        letterSpacing="0.05em"
        fill={attr?.stale && !contact.collapsed ? 'var(--ink-mute)' : foe}
        {...HALO}
      >
        {label}
      </text>
      {age >= 1 && (
        <text x={c.x + hw + 11} y={c.y - 6} fontSize={TEXT} fill="var(--ink-mute)" {...HALO}>
          {`R+${age}`}
        </text>
      )}
      <title>
        {`Contact ${contact.id}${describe(contact)} · last fix round ${contact.lastScan.round} phase ${
          contact.lastScan.phase
        } · ${
          contact.positionEstimated
            ? `position estimated, drift up to ${contact.uncertainty} hex${contact.uncertainty === 1 ? '' : 'es'}`
            : 'position fixed'
        }${contact.collapsed ? ' · gone cold, dossier withheld' : ''}`}
      </title>
    </g>
  )
}

function describe(contact: ViewedContact): string {
  const bits: string[] = []
  for (const key of ['sizeClass', 'faction', 'shipClass', 'speed', 'count'] as const) {
    const a = contact.attributes[key]
    if (a) bits.push(a.stale ? `${a.value} (stale)` : a.value)
  }
  return bits.length > 0 ? ` · ${bits.join(' · ')}` : ''
}

/**
 * At most TWO codes beside a unit's name, in priority order. The rest live in
 * the <title>: at a 24-unit column pitch, a pill plus a gauge plus a leader
 * plus five codes is a bird's nest wherever two units are within two hexes.
 */
function unitCodes(unit: SideView['units'][number]): string {
  const out: string[] = []
  const push = (code: string): void => {
    if (out.length < 2) out.push(code)
  }
  if (unit.order.cloaked) push('CLK')
  if (unit.order.engagement === 'withdraw') push('WDRW')
  else if (unit.order.engagement === 'silent') push('SLNT')
  if (unit.moveDebt > 0) push('SLOW')
  if (unit.order.mission?.type === 'intercept') push('INTC')
  else if (unit.order.mission?.type === 'shadow') push('SHDW')
  if (unit.enduranceMax > 0 && unit.endurance / unit.enduranceMax < 0.25) push('LOW')
  if (unit.kind === 'group') push('GRP')
  else if (unit.kind === 'starwing') push('SW')
  else if (unit.kind === 'convoy') push('CVY')
  return out.join(' ')
}
