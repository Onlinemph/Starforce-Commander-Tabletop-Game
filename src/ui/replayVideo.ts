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
 * wall clock, so the file takes as long to make as it does to watch. That is
 * why what the recorder *stops at* matters more than how fast it draws, and
 * where all the time went: a battle is mostly bookkeeping — power allocations,
 * segment advances — and filming every one of them films nothing.
 *
 * Three changes, measured on two AI battles (72" board, admiral):
 *
 *   246-action duel      117s → 35s   (26s on highlights only)
 *   854-action squadron  412s → 116s  (95s on highlights only)
 *
 *  - Runs of quiet steps collapse to their last one — the state is the same
 *    when the run ends, so only the end of it is worth a stop.
 *  - The glide is shortened for the length of the recording, and the hold
 *    shrinks with it: the same movement at the same frame rate, arriving
 *    sooner.
 *  - `highlightsOnly` drops the bookkeeping altogether. That changes what is
 *    in the film, not just how long it takes, so it is the caller's choice.
 *
 * The estimate the caller is told is the tab-capture figure. Where the browser
 * has to draw every frame by hand it runs somewhat over — 44s against a 35s
 * estimate on the duel above — because rasterising the map can cost more than
 * the frame budget.
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
  /**
   * Film only the narrated moments, dropping the bookkeeping between them
   * entirely. Changes what is in the video, not just how long it takes to
   * make, so it is never a default.
   */
  highlightsOnly?: boolean
  /**
   * How fast the map glides while filming. The live board eases ships over
   * 900ms, which is right to watch and is the whole reason a held step had to
   * be 1100ms. Recording overrides it: the same movement, read at the same
   * frame rate, simply arrives sooner — so the hold shrinks with it and the
   * file takes a third of the time to make with nothing missing from it.
   */
  glideMs?: number
  /** Set false to redraw every frame by hand rather than ask to film the tab. */
  preferTabCapture?: boolean
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export const DEFAULT_RECORD: RecordOptions = {
  /*
   * The hold has to outlast the glide or the camera cuts away mid-move, which
   * is what made the old files feel jerky. It used to be 1100ms because the
   * live board glides for 900. Recording now shortens the glide to 240, so the
   * hold comes down with it — the same movement, the same frame rate, over a
   * third of the wall clock.
   *
   * The quiet hold stays above the glide on purpose: a collapsed run of
   * bookkeeping is exactly where a ship's movement lands, and a stop shorter
   * than the glide would cut away mid-move.
   */
  glideMs: 240,
  holdMs: 420,
  quietMs: 260,
  fps: 30,
  maxEdge: 1280,
}

/**
 * Force the map to glide at the recording's pace, and hand back the undo.
 *
 * A style element rather than a class, because the rule it is overriding lives
 * in the app's stylesheet and this has to win without either file knowing
 * about the other.
 */
function holdGlide(ms: number | undefined): () => void {
  if (!ms) return () => {}
  const style = document.createElement('style')
  style.dataset.recording = 'glide'
  style.textContent = `.map-mover { transition-duration: ${ms}ms !important; }`
  document.head.append(style)
  return () => style.remove()
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

/**
 * How long the recorder will actually take, given the steps it will stop at.
 *
 * The older estimate above counts every quiet step, which is what the recorder
 * used to do; this one asks `recordingStops` and so tracks the collapsing and
 * the highlights option without having to know how either works.
 */
export function estimateRecording(steps: number, options: RecordOptions = DEFAULT_RECORD): number {
  const stops = recordingStops(steps, options)
  const narrated = (i: number) => options.narrated?.(i) ?? true
  const total =
    stops.reduce((ms, i) => ms + (narrated(i) ? options.holdMs : options.quietMs), 0) +
    options.holdMs
  return Math.round(total / 1000)
}

/** The board-sized viewBox, falling back to whatever the map is showing now. */
function fullViewBox(svg: SVGSVGElement): string {
  return svg.getAttribute('data-full-viewbox') ?? svg.getAttribute('viewBox') ?? '0 0 1000 1000'
}

/**
 * Drive the playhead through the battle, holding each step for as long as it
 * deserves, and call `tick` as often as it will run while a step is held.
 *
 * Both recorders share this: the difference between them is only what happens
 * on a tick — one has to photograph the map, the other has nothing to do
 * because the browser is already filming it.
 */
/**
 * The steps the recording will actually stop at.
 *
 * Filming every action films the bookkeeping. A twelve-round squadron battle
 * is 778 actions of which 569 are quiet — power allocations, plots, segment
 * advances — and holding each of those for a quarter second spent nearly two
 * and a half minutes of video on a map that was not changing. So a run of
 * consecutive quiet steps is collapsed to its last one: the game state it
 * lands on is identical either way, because the intervening steps are simply
 * applied without being photographed, and anything that did move glides into
 * place from where it was.
 *
 * `highlightsOnly` goes further and keeps just the moments — volleys, kills,
 * the starts of rounds. That one changes what is in the film rather than only
 * how long it takes to make, so it is the caller's choice, never a default.
 */
export function recordingStops(steps: number, options: RecordOptions): number[] {
  const narrated = (i: number) => options.narrated?.(i) ?? true
  const stops: number[] = []
  for (let index = 0; index <= steps; index++) {
    if (options.highlightsOnly && !narrated(index) && index !== steps) continue
    // Keep a quiet step only when it is the last of its run.
    if (!narrated(index) && index !== steps && !narrated(index + 1)) continue
    stops.push(index)
  }
  return stops
}

async function playThrough(
  steps: number,
  showStep: (index: number) => Promise<void>,
  options: RecordOptions,
  tick?: () => Promise<void>,
): Promise<void> {
  const frameMs = 1000 / options.fps
  const stops = recordingStops(steps, options)

  for (const [position, index] of stops.entries()) {
    if (options.signal?.aborted) break
    await showStep(index)
    const hold = (options.narrated?.(index) ?? true) ? options.holdMs : options.quietMs
    const until = performance.now() + hold
    let ticks = 0
    while (ticks === 0 || performance.now() < until) {
      if (options.signal?.aborted) break
      const started = performance.now()
      if (tick) await tick()
      ticks++
      const spare = frameMs - (performance.now() - started)
      if (spare > 1) await wait(spare)
    }
    options.onProgress?.(position + 1, stops.length)
  }
  // A held final frame keeps players from missing the last volley.
  await wait(options.holdMs)
}

// ---------------------------------------------------------------------------
// The easy way: let the browser film its own tab
// ---------------------------------------------------------------------------

/**
 * Chrome's Region Capture, which is the whole trick. Tab capture on its own
 * would film the theater, the narration column and the browser's own
 * furniture; cropping the track to the map element means the stream *is* the
 * map, at whatever frame rate the compositor is already running at.
 */
interface CropTargetApi {
  fromElement(element: Element): Promise<unknown>
}
type CroppableTrack = MediaStreamTrack & { cropTo?: (target: unknown) => Promise<void> }

function cropTargetApi(): CropTargetApi | null {
  const api = (globalThis as { CropTarget?: CropTargetApi }).CropTarget
  return api && typeof api.fromElement === 'function' ? api : null
}

/** Whether this browser can film the map directly instead of redrawing it. */
export function canCaptureTab(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    cropTargetApi() !== null
  )
}

/** Which way a recording will be made here — the UI says so before asking. */
export function recordMethod(): 'tab' | 'canvas' {
  return canCaptureTab() ? 'tab' : 'canvas'
}

/**
 * Ask for the tab, crop the track to the map, and hand back the stream.
 *
 * Null on any refusal — the picker dismissed, a different window chosen, an
 * older browser — and the caller falls back to drawing frames by hand. The
 * crop is not optional: without it the file would contain the whole page, and
 * recording the UI around the map is precisely what nobody wants.
 *
 * Must be called before anything else awaits, or the click that got us here
 * will no longer count as the gesture the permission prompt requires.
 */
async function captureMapStream(element: Element): Promise<MediaStream | null> {
  const api = cropTargetApi()
  if (!api) return null
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
      // Chrome-only hints: offer this tab first, and do not let the capture
      // wander to another surface half way through the battle.
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
    } as DisplayMediaStreamOptions)
  } catch {
    return null
  }
  const track = stream.getVideoTracks()[0] as CroppableTrack | undefined
  try {
    if (!track?.cropTo) throw new Error('no crop')
    await track.cropTo(await api.fromElement(element))
    return stream
  } catch {
    // Whatever was picked, it is not this tab's map. Leave it alone.
    for (const t of stream.getTracks()) t.stop()
    return null
  }
}

/** Film the map itself, at the frame rate the browser is already drawing it. */
async function recordFromStream(
  stream: MediaStream,
  format: string,
  steps: number,
  showStep: (index: number) => Promise<void>,
  options: RecordOptions,
): Promise<Blob> {
  const recorder = new MediaRecorder(stream, { mimeType: format, videoBitsPerSecond: 8_000_000 })
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: format }))
  })
  const releaseGlide = holdGlide(options.glideMs)
  recorder.start()
  try {
    await playThrough(steps, showStep, options)
  } finally {
    releaseGlide()
    recorder.stop()
    for (const track of stream.getTracks()) track.stop()
  }
  return finished
}

/**
 * Play the replay through, filming it, and return the finished video.
 *
 * `showStep` must set the replay to that step and resolve once the DOM has
 * painted it — the caller owns the React state, so only it can do that.
 *
 * Two ways to do this. Where the browser can film its own tab and crop the
 * stream to the map, it does: the pixels are the ones on screen, at the frame
 * rate the compositor is already running, and there is nothing to redraw. Any
 * other browser — or a declined prompt — falls back to rebuilding every frame
 * by hand, which is slower and dearer but asks nobody's permission.
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

  // Before any other await: the permission prompt needs the click still live.
  const live = options.preferTabCapture === false ? null : await captureMapStream(first)
  if (live) return recordFromStream(live, format, steps, showStep, options)

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

  const releaseGlide = holdGlide(options.glideMs)
  recorder.start()
  try {
    // Photographing the map for as long as each step is held is what turns a
    // glide, a beam and a fireball into motion instead of one frozen instant.
    await playThrough(steps, showStep, options, drawFrame)
  } finally {
    releaseGlide()
    recorder.stop()
    for (const track of stream.getTracks()) track.stop()
  }

  return finished
}
