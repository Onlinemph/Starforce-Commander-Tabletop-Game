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
 * Recording is real-time by nature: MediaRecorder timestamps frames by the
 * wall clock, so a battle of 200 actions held for a third of a second each
 * takes about a minute to record. The caller is told the estimate up front.
 */

export interface RecordOptions {
  /** How long each action is held on screen, in milliseconds. */
  holdMs: number
  /** Frames per second the recorder samples the canvas at. */
  fps: number
  /** Longest edge of the video, in pixels. */
  maxEdge: number
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export const DEFAULT_RECORD: RecordOptions = { holdMs: 340, fps: 30, maxEdge: 1280 }

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

/** A standalone copy of the live map: styles folded in, assets embedded. */
async function selfContainedSvg(svg: SVGSVGElement, css: string, width: number, height: number): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = css
  clone.insertBefore(style, clone.firstChild)

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
export function estimateSeconds(steps: number, options: RecordOptions = DEFAULT_RECORD): number {
  return Math.round(((steps + 1) * options.holdMs) / 1000)
}

/**
 * Play the replay through, capturing every step, and return the finished video.
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

  const box = first.getBoundingClientRect()
  const scale = Math.min(options.maxEdge / Math.max(box.width, box.height), 2)
  const width = Math.max(2, Math.round(box.width * scale))
  const height = Math.max(2, Math.round(box.height * scale))

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
  const recorder = new MediaRecorder(stream, { mimeType: format, videoBitsPerSecond: 6_000_000 })
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: format }))
  })

  recorder.start()
  try {
    for (let index = 0; index <= steps; index++) {
      if (options.signal?.aborted) break
      await showStep(index)
      const svg = getSvg()
      if (svg) {
        const markup = await selfContainedSvg(svg, css, width, height)
        const image = await loadImage(
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`,
        )
        context.fillStyle = '#05070d'
        context.fillRect(0, 0, width, height)
        context.drawImage(image, 0, 0, width, height)
      }
      options.onProgress?.(index, steps)
      await wait(options.holdMs)
    }
  } finally {
    // A held final frame keeps players from missing the last volley.
    await wait(options.holdMs)
    recorder.stop()
    for (const track of stream.getTracks()) track.stop()
  }

  return finished
}
