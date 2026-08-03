/**
 * Recording a replay as a video file.
 *
 * The map is live SVG styled by the app's stylesheet, which a browser will
 * not rasterise directly: an SVG loaded as an image is its own little
 * document, with no access to the page's CSS or to any file it references. So
 * each frame is made self-contained first — the stylesheet folded in as a
 * <style> element, every referenced image swapped for a data URL — and only
 * then drawn onto a canvas. A MediaRecorder over that canvas turns the
 * sequence into a WebM (or MP4 where that is what the browser offers).
 *
 * Two things make the difference between a slideshow and a video:
 *
 *  - **Frames are sampled continuously, not once per action.** The map glides
 *    ships to their new positions over most of a second and throws beams and
 *    fireballs on top of that; a single snapshot per step throws all of it
 *    away. So the recorder keeps re-photographing the live map for as long as
 *    the step is held, at the frame rate it is recording.
 *  - **Animated values are baked in.** A CSS transition animates what is
 *    *rendered*, while the element's inline style still holds the value it is
 *    travelling towards — serialise the DOM mid-glide and you get the
 *    destination, not the position. So every frame copies the computed
 *    transform, opacity and stroke of anything that moves onto the clone, and
 *    turns animation off inside the frame so those values are what render.
 *
 * Framing is fixed to the whole board for the length of the recording, taken
 * from the map's own `data-full-viewbox`. Zooming and panning while a replay
 * records is looking around, not directing — it stays out of the file.
 *
 * Recording is real-time by nature: MediaRecorder timestamps frames by the
 * wall clock, so the file takes as long to make as it does to watch. The
 * caller is told the estimate up front.
 */

export interface RecordOptions {
  /** How long a narrated moment is held — long enough to cover the glide. */
  holdMs: number
  /** How long a step nobody narrates is held. */
  quietMs: number
  /** Frames per second the recorder samples the canvas at. */
  fps: number
  /** Longest edge of the video, in pixels. */
  maxEdge: number
  /** Whether the step at this index is a narrated moment. Default: all are. */
  narrated?: (index: number) => boolean
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export const DEFAULT_RECORD: RecordOptions = {
  // The Navigation reveal glides for 900ms (see .map-mover); anything shorter
  // cuts away mid-move, which is exactly what made the old files feel jerky.
  holdMs: 1100,
  quietMs: 260,
  fps: 30,
  maxEdge: 1280,
}

/** The recording formats a browser might offer, best first. */
const FORMATS = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1',
  'video/mp4',
]

function pickFormat(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return FORMATS.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

/** Whether this browser can record at all. */
export function canRecordVideo(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    pickFormat() !== null
  )
}

export function videoExtension(): string {
  return pickFormat()?.includes('mp4') ? 'mp4' : 'webm'
}

/**
 * Every CSS rule the page carries, as text. Same-origin sheets only — a
 * cross-origin one throws on access and is simply skipped, since nothing the
 * map depends on comes from elsewhere.
 *
 * This is the fallback path. Normally a frame carries no stylesheet at all
 * (see `bakeComputedStyle`); the sheet is only folded in if the two trees
 * somehow fail to line up, so a frame that cannot be measured still renders.
 */
function collectCss(): string {
  const parts: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) parts.push(rule.cssText)
    } catch {
      // Cross-origin stylesheet: not ours, not needed.
    }
  }
  parts.push('*{animation:none!important;transition:none!important}')
  return parts.join('\n')
}

const dataUrlCache = new Map<string, string>()

/** Fetch a referenced asset and return it as a data URL the SVG can carry. */
async function toDataUrl(url: string): Promise<string> {
  const cached = dataUrlCache.get(url)
  if (cached) return cached
  const response = await fetch(url)
  const blob = await response.blob()
  const encoded = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  dataUrlCache.set(url, encoded)
  return encoded
}

/**
 * Everything that decides how a piece of the map looks: paint, stroke, the
 * filters that make things glow, and the text properties the labels need.
 * Geometry is deliberately absent — it is already in the attributes, and
 * writing a computed `width` onto the root would overrule the frame size.
 */
const PAINTED = [
  'transform',
  'transform-origin',
  'transform-box',
  'opacity',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'filter',
  'clip-path',
  'mask',
  'mix-blend-mode',
  'paint-order',
  'vector-effect',
  'shape-rendering',
  'display',
  'visibility',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'text-transform',
  'dominant-baseline',
] as const

/**
 * A reference to something in the frame's own defs, kept relative. Chrome
 * hands back absolute URLs for `filter: url(#glow)` and friends, and an
 * absolute URL is a reference to a *different document* once the frame is on
 * its own — which is a glow that silently stops rendering.
 */
export function localiseRefs(value: string): string {
  return value.includes('url(') ? value.replace(/url\((["']?)[^"')]*#/g, 'url($1#') : value
}

/**
 * Write onto the clone what the browser is *currently rendering*, and return
 * whether every node was accounted for.
 *
 * This is what makes a frame both accurate and cheap. Accurate, because a CSS
 * transition animates the rendered value while the element's own style still
 * holds the value it is travelling towards — serialise the DOM mid-glide and
 * you get the destination, not the position. Cheap, because once every value
 * is stated outright the frame needs no stylesheet: 59KB of CSS, re-parsed for
 * every frame, was costing more than rasterising the picture.
 *
 * The live and cloned node lists are the same tree, so they line up index for
 * index; a mismatch means the caller should fall back to shipping the sheet.
 */
function bakeComputedStyle(live: SVGSVGElement, clone: SVGSVGElement, liveNodes: string): boolean {
  const from = live.querySelectorAll(liveNodes)
  const to = clone.querySelectorAll('*')
  if (from.length !== to.length) return false
  for (let i = 0; i < from.length; i++) {
    const computed = getComputedStyle(from[i])
    const target = to[i] as SVGElement
    for (const property of PAINTED) {
      const value = computed.getPropertyValue(property)
      if (value) target.style.setProperty(property, localiseRefs(value))
    }
  }
  return true
}

/** The live counterparts of the nodes each layer keeps, in document order. */
const LIVE_NODES = {
  action: ':not(.map-backdrop):not(.map-backdrop *)',
  backdrop: 'defs, defs *, .map-backdrop, .map-backdrop *',
  all: '*',
} as const

/**
 * A standalone copy of the live map: styles folded in, assets embedded.
 *
 * `layer` splits the map in two. The backdrop — starfield, nebulae, grid,
 * board edge — is hundreds of nodes that never change, so it is drawn once and
 * kept; every frame after that only rasterises the ships, the terrain and the
 * gunfire, over the top of it.
 */
async function selfContainedSvg(
  svg: SVGSVGElement,
  css: string,
  viewBox: string,
  width: number,
  height: number,
  layer: 'backdrop' | 'action' | 'all' = 'all',
): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  if (layer !== 'all') {
    const backdrop = clone.querySelector('.map-backdrop')
    if (backdrop) {
      if (layer === 'action') backdrop.remove()
      else for (const node of Array.from(clone.children)) {
        // Keep the defs — gradients and filters the backdrop paints with.
        if (node !== backdrop && node.tagName !== 'defs') node.remove()
      }
    }
  }
  // Measured before the frame is dressed up, while the trees still match.
  const measured = bakeComputedStyle(svg, clone, LIVE_NODES[layer])

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  // The whole board every frame, whatever the viewer is looking at.
  clone.setAttribute('viewBox', viewBox)

  if (!measured) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = css
    clone.insertBefore(style, clone.firstChild)
  }

  // Terrain counters and any other artwork ride along as data URLs.
  const images = Array.from(clone.querySelectorAll('image'))
  await Promise.all(
    images.map(async (image) => {
      const href = image.getAttribute('href') ?? image.getAttribute('xlink:href')
      if (!href || href.startsWith('data:')) return
      try {
        const encoded = await toDataUrl(new URL(href, location.href).toString())
        image.setAttribute('href', encoded)
        image.removeAttribute('xlink:href')
      } catch {
        // An asset that will not load is better skipped than fatal.
        image.remove()
      }
    }),
  )

  return new XMLSerializer().serializeToString(clone)
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('A frame of the replay could not be drawn.'))
    image.src = source
  })
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** How long a recording will take, so the caller can say so before starting. */
export function estimateSeconds(
  narratedSteps: number,
  quietSteps = 0,
  options: RecordOptions = DEFAULT_RECORD,
): number {
  const total = (narratedSteps + 1) * options.holdMs + quietSteps * options.quietMs
  return Math.round(total / 1000)
}

/** The board-sized viewBox, falling back to whatever the map is showing now. */
function fullViewBox(svg: SVGSVGElement): string {
  return svg.getAttribute('data-full-viewbox') ?? svg.getAttribute('viewBox') ?? '0 0 1000 1000'
}

/**
 * Play the replay through, filming it, and return the finished video.
 *
 * `showStep` must set the replay to that step and resolve once the DOM has
 * painted it — the caller owns the React state, so only it can do that.
 */
export async function recordReplay(
  getSvg: () => SVGSVGElement | null,
  steps: number,
  showStep: (index: number) => Promise<void>,
  options: RecordOptions = DEFAULT_RECORD,
): Promise<Blob> {
  const format = pickFormat()
  if (!format) throw new Error('This browser cannot record video.')

  const first = getSvg()
  if (!first) throw new Error('The map is not on screen.')

  // Frame on the board, at the board's own proportions — so neither zooming
  // nor resizing the window mid-recording changes the shape of the picture.
  const viewBox = fullViewBox(first)
  const [, , boardW, boardH] = viewBox.split(/\s+/).map(Number)
  const aspect = boardW > 0 && boardH > 0 ? boardW / boardH : 1
  const width = Math.max(2, Math.round(aspect >= 1 ? options.maxEdge : options.maxEdge * aspect))
  const height = Math.max(2, Math.round(aspect >= 1 ? options.maxEdge / aspect : options.maxEdge))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot draw the replay.')
  // Space is black, and a transparent video would come out worse.
  context.fillStyle = '#05070d'
  context.fillRect(0, 0, width, height)

  const css = collectCss()
  const stream = canvas.captureStream(options.fps)
  const recorder = new MediaRecorder(stream, { mimeType: format, videoBitsPerSecond: 8_000_000 })
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: format }))
  })

  /** Rasterise one layer of the map as it looks right now. */
  const shoot = async (svg: SVGSVGElement, layer: 'backdrop' | 'action'): Promise<HTMLImageElement> => {
    const markup = await selfContainedSvg(svg, css, viewBox, width, height, layer)
    // A blob URL rather than a data URL: percent-encoding a whole stylesheet
    // thirty times a second is real work, and this skips all of it.
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
    try {
      return await loadImage(url)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  // The scenery, once.
  let backdrop: HTMLImageElement | null = null
  try {
    backdrop = await shoot(first, 'backdrop')
  } catch {
    // No backdrop is a black sky, which is survivable; the action still films.
  }

  /** Photograph the map exactly as it looks at this instant. */
  const drawFrame = async (): Promise<void> => {
    const svg = getSvg()
    if (!svg) return
    const image = await shoot(svg, 'action')
    context.fillStyle = '#05070d'
    context.fillRect(0, 0, width, height)
    if (backdrop) context.drawImage(backdrop, 0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
  }

  const frameMs = 1000 / options.fps
  recorder.start()
  try {
    for (let index = 0; index <= steps; index++) {
      if (options.signal?.aborted) break
      await showStep(index)
      const hold = (options.narrated?.(index) ?? true) ? options.holdMs : options.quietMs
      const until = performance.now() + hold
      // Keep filming for as long as the step is held: this is where a glide,
      // a beam and a fireball become motion instead of one frozen instant.
      let taken = 0
      while (taken === 0 || performance.now() < until) {
        if (options.signal?.aborted) break
        const started = performance.now()
        await drawFrame()
        taken++
        // No point running ahead of the frame rate being recorded.
        const spare = frameMs - (performance.now() - started)
        if (spare > 1) await wait(spare)
      }
      options.onProgress?.(index, steps)
    }
  } finally {
    // A held final frame keeps players from missing the last volley.
    await wait(options.holdMs)
    recorder.stop()
    for (const track of stream.getTracks()) track.stop()
  }

  return finished
}
