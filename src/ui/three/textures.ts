/**
 * Small procedural textures shared across the 3D layers, drawn once on a
 * canvas and cached. No image files: everything here is a gradient or noise
 * the view can make for itself, so the lazy 3D chunk carries no assets.
 */
import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

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
  const w = kind === 'planet' ? 512 : 256
  const h = kind === 'planet' ? 256 : 128
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
    paintPlanet(ctx, w, h, rand)
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

/**
 * Smooth value noise that wraps horizontally with period `wrap`, so a
 * texture made from it closes seamlessly round a sphere.
 */
function wrappedNoise(seed: number, wrap: number): (x: number, y: number) => number {
  const hash = (ix: number, iy: number) => {
    let h = (((ix % wrap) + wrap) % wrap) * 374761393 + iy * 668265263 + seed * 982451653
    h = (h ^ (h >>> 13)) * 1274126177
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const smooth = (t: number) => t * t * (3 - 2 * t)
  return (x, y) => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const fx = smooth(x - ix)
    const fy = smooth(y - iy)
    const a = hash(ix, iy)
    const b = hash(ix + 1, iy)
    const c = hash(ix, iy + 1)
    const d = hash(ix + 1, iy + 1)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
  }
}

/** Fractal noise: octaves of wrapped value noise, 0..1. */
function fbm(noise: Array<(x: number, y: number) => number>, x: number, y: number): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  for (let o = 0; o < noise.length; o++) {
    const f = 1 << o
    sum += noise[o](x * f, y * f) * amp
    norm += amp
    amp *= 0.5
  }
  return sum / norm
}

/**
 * A planet's surface, pixel by pixel from fractal noise: either a gas giant
 * (bands warped by turbulence) or a terrestrial world (oceans, lowlands,
 * highlands and ice by height, under a layer of cloud). Seeded, so the same
 * feature id always makes the same world.
 */
function paintPlanet(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number): void {
  const seed = Math.floor(rand() * 1e6)
  const period = 8
  const octaves = (s0: number) => [0, 1, 2, 3, 4].map((o) => wrappedNoise(s0 + o * 17, period << o))
  const ground = octaves(seed)
  const cloud = octaves(seed + 101)
  const img = ctx.createImageData(w, h)
  const hue = rand()
  const giant = rand() > 0.5
  const tmp = new Color()
  const base = new Color().setHSL(hue, 0.5, 0.3)
  const alt = new Color().setHSL((hue + 0.08) % 1, 0.35, 0.52)
  const deep = new Color().setHSL(0.58 + (hue - 0.5) * 0.1, 0.55, 0.16)
  const shallow = new Color().setHSL(0.55, 0.5, 0.3)
  const low = new Color().setHSL(0.25 + hue * 0.12, 0.35, 0.3)
  const high = new Color().setHSL(0.08 + hue * 0.05, 0.3, 0.38)
  const sea = 0.47 + rand() * 0.08

  for (let py = 0; py < h; py++) {
    const v = py / h
    const lat = Math.abs(v - 0.5) * 2
    for (let px = 0; px < w; px++) {
      const x = (px / w) * period
      const y = v * period * 0.5
      if (giant) {
        const turb = fbm(ground, x, y)
        const band = 0.5 + 0.5 * Math.sin(v * Math.PI * (9 + hue * 8) + turb * 5)
        tmp.copy(base).lerp(alt, band * 0.85)
        tmp.multiplyScalar(0.85 + turb * 0.3)
      } else {
        const height = fbm(ground, x, y)
        if (height < sea) tmp.copy(deep).lerp(shallow, Math.max(0, (height - sea + 0.12) / 0.12))
        else if (height < sea + 0.08) tmp.copy(low)
        else tmp.copy(low).lerp(high, Math.min(1, (height - sea - 0.08) / 0.14))
        // Ice at the poles and on the highest peaks.
        if (lat > 0.82 || height > sea + 0.26) tmp.lerp(new Color(0.9, 0.93, 0.97), 0.8)
        const c = fbm(cloud, x * 1.3, y * 1.3)
        if (c > 0.55) tmp.lerp(new Color(0.95, 0.96, 1), Math.min(0.85, (c - 0.55) * 4))
      }
      const k = (py * w + px) * 4
      img.data[k] = Math.round(Math.min(1, tmp.r) * 255)
      img.data[k + 1] = Math.round(Math.min(1, tmp.g) * 255)
      img.data[k + 2] = Math.round(Math.min(1, tmp.b) * 255)
      img.data[k + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}
