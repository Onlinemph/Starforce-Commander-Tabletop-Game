/**
 * Small procedural textures shared across the 3D layers, drawn once on a
 * canvas and cached. No image files: everything here is a gradient or noise
 * the view can make for itself, so the lazy 3D chunk carries no assets.
 */
import { CanvasTexture, SRGBColorSpace, type Texture } from 'three'

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
