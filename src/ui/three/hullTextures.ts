/**
 * Surface detail for the hulls: plating panels and lit windows, painted once
 * on canvases and tiled over every ship.
 *
 * The extruded hulls take their UVs straight from the glyph's own units (the
 * caps are planar-mapped by ExtrudeGeometry), so a texture repeated every few
 * dozen glyph units lays a consistent panel grid over the whole fleet: small
 * hulls show a few plates, a dreadnought shows hundreds, which is exactly how
 * scale reads on a model.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

const cache = new Map<string, Texture>()

/** How many glyph units one tile of the hull textures covers. */
export const HULL_TILE = 36

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function tiled(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, srgb: boolean): Texture {
  const hit = cache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  draw(canvas.getContext('2d')!, size)
  const tex = new CanvasTexture(canvas)
  if (srgb) tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.repeat.set(1 / HULL_TILE, 1 / HULL_TILE)
  tex.anisotropy = 4
  tex.userData.shared = true
  cache.set(key, tex)
  return tex
}

/**
 * Hull plating: a grid of plates in slightly different greys, each outlined
 * by a dark seam and a faint highlight on its upper edge, with the odd vent,
 * hatch and access strip. Multiplies the plating colour, so it works for
 * every damage wash.
 */
export function panelTexture(): Texture {
  return tiled(
    'panels',
    512,
    (ctx, s) => {
      const rand = seeded(7)
      ctx.fillStyle = 'rgb(188,192,200)'
      ctx.fillRect(0, 0, s, s)
      // Plates: rows of varying height, each split into plates of varying width.
      let y = 0
      while (y < s) {
        const h = [32, 48, 64][Math.floor(rand() * 3)]
        let x = 0
        while (x < s) {
          const w = [48, 64, 96, 128][Math.floor(rand() * 4)]
          const g = 150 + Math.floor(rand() * 70)
          ctx.fillStyle = `rgb(${g},${g + 2},${g + 6})`
          ctx.fillRect(x + 1, y + 1, Math.min(w, s - x) - 2, Math.min(h, s - y) - 2)
          // Seam shadow and a bevel highlight.
          ctx.fillStyle = 'rgba(20,24,34,0.85)'
          ctx.fillRect(x, y, Math.min(w, s - x), 1.5)
          ctx.fillRect(x, y, 1.5, Math.min(h, s - y))
          ctx.fillStyle = 'rgba(255,255,255,0.18)'
          ctx.fillRect(x + 2, y + 2, Math.min(w, s - x) - 4, 1)
          // Greebles: vents, hatches and bolt rows on some plates.
          const r = rand()
          if (r < 0.18) {
            ctx.fillStyle = 'rgba(30,34,44,0.7)'
            for (let i = 0; i < 5; i++) ctx.fillRect(x + 8 + i * 6, y + h / 2 - 5, 3, 10)
          } else if (r < 0.3) {
            ctx.strokeStyle = 'rgba(30,34,44,0.6)'
            ctx.lineWidth = 1.5
            ctx.strokeRect(x + w * 0.25, y + h * 0.25, w * 0.4, h * 0.5)
          } else if (r < 0.4) {
            ctx.fillStyle = 'rgba(40,44,54,0.55)'
            for (let i = 6; i < w - 6; i += 8) ctx.fillRect(x + i, y + 5, 2, 2)
          }
          x += w
        }
        y += h
      }
      // A few long darker access strips cutting across plates.
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = 'rgba(40,46,60,0.35)'
        ctx.fillRect(0, Math.floor(rand() * s), s, 6)
      }
    },
    true,
  )
}

/**
 * Lit windows and running strips, for the emissive channel: black almost
 * everywhere, with short rows of warm and cool lights. It is what makes a
 * hull read as a ship full of crew rather than a painted block.
 */
export function windowTexture(): Texture {
  return tiled(
    'windows',
    512,
    (ctx, s) => {
      const rand = seeded(19)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, s, s)
      for (let row = 0; row < 26; row++) {
        const y = Math.floor(rand() * s)
        const x0 = Math.floor(rand() * s)
        const n = 3 + Math.floor(rand() * 9)
        const warm = rand() < 0.6
        for (let i = 0; i < n; i++) {
          if (rand() < 0.2) continue
          const a = 0.55 + rand() * 0.45
          ctx.fillStyle = warm ? `rgba(255,214,150,${a})` : `rgba(170,215,255,${a})`
          ctx.fillRect((x0 + i * 6) % s, y, 3, 2)
        }
      }
    },
    true,
  )
}
