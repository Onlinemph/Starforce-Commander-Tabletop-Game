/**
 * Small procedural textures shared across the 3D layers, drawn once on a
 * canvas and cached. No image files: everything here is a gradient or noise
 * the view can make for itself, so the lazy 3D chunk carries no assets.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

const cache = new Map<string, Texture>()

function canvasTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): Texture {
  const hit = cache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  draw(canvas.getContext('2d')!, size)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.userData.shared = true
  cache.set(key, tex)
  return tex
}

/** A soft round glow, white at the centre and gone at the rim. For sprites. */
export function glowTexture(): Texture {
  return canvasTexture('glow', 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.18, 'rgba(255,255,255,0.85)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.25)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
  })
}

/** A four-point star flare, for the few bright stars and for muzzle flashes. */
export function flareTexture(): Texture {
  return canvasTexture('flare', 128, (ctx, s) => {
    const c = s / 2
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.5)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
    ctx.globalCompositeOperation = 'lighter'
    for (const [w, h] of [
      [s, 3],
      [3, s],
    ]) {
      const lg = ctx.createLinearGradient(c - w / 2, c - h / 2, c + w / 2, c + h / 2)
      lg.addColorStop(0, 'rgba(255,255,255,0)')
      lg.addColorStop(0.5, 'rgba(255,255,255,0.9)')
      lg.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = lg
      ctx.fillRect(c - w / 2, c - h / 2, w, h)
    }
  })
}

/**
 * Soft cloudy noise, tileable enough for nebula and gas-cloud billboards:
 * layered blurred blobs rather than true Perlin noise, which is plenty for
 * something that is only ever seen through additive blending.
 */
export function cloudTexture(seed = 1): Texture {
  return canvasTexture(`cloud${seed}`, 256, (ctx, s) => {
    let x = seed * 9301 + 49297
    const rand = () => {
      x = (x * 9301 + 49297) % 233280
      return x / 233280
    }
    ctx.clearRect(0, 0, s, s)
    for (let i = 0; i < 70; i++) {
      const r = s * (0.06 + rand() * 0.22)
      const cx = s * (0.2 + rand() * 0.6)
      const cy = s * (0.2 + rand() * 0.6)
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      const a = 0.05 + rand() * 0.1
      g.addColorStop(0, `rgba(255,255,255,${a})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
    }
    // Fade the square's edges out so billboards never show a hard border.
    const edge = ctx.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2)
    edge.addColorStop(0, 'rgba(0,0,0,0)')
    edge.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = edge
    ctx.fillRect(0, 0, s, s)
  })
}

// ── Terrain (Section K) ──────────────────────────────────────────────────
// Planet and moon surfaces. A small local generator, independent of the
// game's own seeded `Rng` (engine/dice.ts), so this stays a pure rendering
// file with no engine imports — terrain.ts feeds it a seed from the
// feature's id and hands the result to a sphere as its `map`.

function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h) % 360}, ${Math.round(s)}%, ${Math.round(l)}%)`
}

/**
 * A world's surface: grey and cratered for a moon, banded (a gas giant) or
 * blotched with continents (a rocky world) for a planet — the choice and
 * every hue seeded from the feature's own id, so the same scenario always
 * looks the same. Equirectangular (2:1) so it wraps a sphere with no seam.
 */
export function worldTexture(seed: number, kind: 'planet' | 'moon'): Texture {
  const key = `world-${kind}-${seed}`
  const hit = cache.get(key)
  if (hit) return hit
  const w = 256
  const h = 128
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const rand = seededRandom(seed)

  if (kind === 'moon') {
    ctx.fillStyle = hsl(220, 6, 46)
    ctx.fillRect(0, 0, w, h)
    // Mottled ground: soft grey blobs, some lighter, some darker.
    for (let i = 0; i < 50; i++) {
      const r = 6 + rand() * 22
      const cx = rand() * w
      const cy = rand() * h
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      g.addColorStop(0, hsl(220, 5, 30 + rand() * 30))
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    // Craters: a dark bowl and a bright rim, the cheapest way to say "moon".
    for (let i = 0; i < 40; i++) {
      const r = 2 + rand() * 9
      const cx = rand() * w
      const cy = rand() * h
      ctx.beginPath()
      ctx.fillStyle = `rgba(10,10,14,${0.25 + rand() * 0.25})`
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.strokeStyle = `rgba(220,220,225,${0.15 + rand() * 0.2})`
      ctx.lineWidth = Math.max(0.6, r * 0.18)
      ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2)
      ctx.stroke()
    }
  } else {
    const hue = rand() * 360
    if (rand() > 0.5) {
      // A gas giant: horizontal bands, each a jitter off the base hue.
      let y = 0
      while (y < h) {
        const bandH = 4 + rand() * 14
        ctx.fillStyle = hsl(hue + (rand() - 0.5) * 40, 35 + rand() * 25, 30 + rand() * 30)
        ctx.fillRect(0, y, w, bandH)
        y += bandH
      }
      // A soft turbulent overlay so the bands do not read as a barcode.
      for (let i = 0; i < 18; i++) {
        const cy = rand() * h
        ctx.strokeStyle = `hsla(${Math.round(hue)}, 40%, 80%, ${0.04 + rand() * 0.06})`
        ctx.lineWidth = 3 + rand() * 6
        ctx.beginPath()
        ctx.moveTo(0, cy)
        for (let x = 0; x <= w; x += 16) ctx.lineTo(x, cy + Math.sin(x * 0.05 + i) * 6)
        ctx.stroke()
      }
    } else {
      // A rocky world: an ocean base with a scatter of smaller continents.
      ctx.fillStyle = hsl(hue, 40, 26)
      ctx.fillRect(0, 0, w, h)
      const land = hsl(hue + 40, 28, 36)
      for (let i = 0; i < 12; i++) {
        const cx = rand() * w
        const cy = h * 0.12 + rand() * h * 0.76
        ctx.fillStyle = land
        ctx.beginPath()
        const points = 6 + Math.floor(rand() * 4)
        for (let p = 0; p < points; p++) {
          const a = (p / points) * Math.PI * 2
          const rr = (6 + rand() * 13) * (0.7 + 0.3 * Math.sin(a * 3 + i))
          const px = cx + Math.cos(a) * rr
          const py = cy + Math.sin(a) * rr * 0.6
          if (p === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.fill()
      }
    }
    // Polar caps, the same on every world so the lighting reads consistently.
    const caps = ctx.createLinearGradient(0, 0, 0, h)
    caps.addColorStop(0, 'rgba(235,240,250,0.55)')
    caps.addColorStop(0.12, 'rgba(235,240,250,0)')
    caps.addColorStop(0.88, 'rgba(235,240,250,0)')
    caps.addColorStop(1, 'rgba(235,240,250,0.55)')
    ctx.fillStyle = caps
    ctx.fillRect(0, 0, w, h)
  }

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.userData.shared = true
  cache.set(key, tex)
  return tex
}

/**
 * A vertical energy band, bright along its centre and dark at both edges,
 * with a few brighter rungs running across it — a tractor beam's current,
 * not just its glow. Tiles along its length; animate `texture.offset.y` to
 * scroll it (J3).
 */
export function beamTexture(): Texture {
  const tex = canvasTexture('beam', 64, (ctx, s) => {
    const across = ctx.createLinearGradient(0, 0, s, 0)
    across.addColorStop(0, 'rgba(255,255,255,0)')
    across.addColorStop(0.5, 'rgba(255,255,255,1)')
    across.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = across
    ctx.fillRect(0, 0, s, s)
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 4; i++) {
      const y = (i / 4) * s
      const rung = ctx.createLinearGradient(0, 0, s, 0)
      rung.addColorStop(0, 'rgba(255,255,255,0)')
      rung.addColorStop(0.5, 'rgba(255,255,255,0.55)')
      rung.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = rung
      ctx.fillRect(0, y, s, s * 0.16)
    }
  })
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.repeat.set(1, 3)
  return tex
}
