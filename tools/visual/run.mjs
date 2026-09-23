/**
 * Screenshot regression tests for the battle map.
 *
 *   npm run test:visual            compare every fixture to its baseline
 *   npm run test:visual -- --update  rewrite the baselines from the current map
 *   npm run test:visual -- duel-open carrier-strike   only these fixtures
 *
 * Starts the Vite dev server, opens `visual.html?fixture=<name>` for each map
 * fixture in src/visual/fixtures.ts, photographs the map, and compares it with
 * tests/visual/<name>.png pixel by pixel. A pixel counts as changed when any
 * channel moves by more than CHANNEL_TOLERANCE; a fixture fails when more than
 * PIXEL_TOLERANCE of its pixels changed. Failures write the new picture and a
 * red-on-grey diff to tests/visual/__out__/ for a person to look at.
 *
 * No image library: the comparison runs in the browser, on two canvases, which
 * keeps the dependency list as it was.
 *
 * Baselines are only meaningful on the machine class that made them — font
 * hinting and anti-aliasing differ between systems — so this is a local check
 * for UI work rather than a CI gate.
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHANNEL_TOLERANCE = 24
const PIXEL_TOLERANCE = 0.002

const args = process.argv.slice(2)
const update = args.includes('--update')
const only = args.filter((a) => !a.startsWith('--'))
const dir = 'tests/visual'
const out = join(dir, '__out__')
mkdirSync(dir, { recursive: true })
rmSync(out, { recursive: true, force: true })

/** Playwright's own browser if it has one, else the image the environment ships. */
function chromiumPath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  if (!existsSync(root)) return undefined
  const found = readdirSync(root)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse()
    .map((d) => join(root, d, 'chrome-linux', 'chrome'))
    .find((p) => existsSync(p))
  return found
}

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls.local[0]

const browser = await chromium.launch({ executablePath: chromiumPath() })
const page = await browser.newPage({ viewport: { width: 1216, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const open = async (fixture) => {
  await page.goto(`${base}visual.html?fixture=${fixture}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('body[data-ready]', { timeout: 30000 })
  const state = await page.evaluate(() => document.body.dataset.ready)
  if (state !== '1') throw new Error(await page.evaluate(() => document.body.textContent))
}

await open('list')
const all = JSON.parse(await page.evaluate(() => document.getElementById('root').textContent))
const fixtures = only.length > 0 ? all.filter((f) => only.includes(f)) : all

/** Compare two PNGs (base64) in the page; returns changed-pixel share and a diff PNG. */
const compare = (a, b) =>
  page.evaluate(
    async ({ a, b, tol }) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = reject
          img.src = `data:image/png;base64,${src}`
        })
      const [ia, ib] = await Promise.all([load(a), load(b)])
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { share: 1, size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`, diff: null }
      }
      const pixels = (img) => {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, c.width, c.height)
      }
      const pa = pixels(ia)
      const pb = pixels(ib)
      const c = document.createElement('canvas')
      c.width = ia.width
      c.height = ia.height
      const ctx = c.getContext('2d')
      const d = ctx.createImageData(c.width, c.height)
      let changed = 0
      for (let i = 0; i < pa.data.length; i += 4) {
        const moved =
          Math.abs(pa.data[i] - pb.data[i]) > tol ||
          Math.abs(pa.data[i + 1] - pb.data[i + 1]) > tol ||
          Math.abs(pa.data[i + 2] - pb.data[i + 2]) > tol
        const grey = (pa.data[i] + pa.data[i + 1] + pa.data[i + 2]) / 12
        d.data[i] = moved ? 255 : grey
        d.data[i + 1] = moved ? 0 : grey
        d.data[i + 2] = moved ? 0 : grey
        d.data[i + 3] = 255
        if (moved) changed++
      }
      ctx.putImageData(d, 0, 0)
      return { share: changed / (pa.data.length / 4), diff: c.toDataURL('image/png').split(',')[1] }
    },
    { a, b, tol: CHANNEL_TOLERANCE },
  )

let failed = 0
for (const fixture of fixtures) {
  try {
    await open(fixture)
    const shot = await page.locator('svg.map').screenshot({ animations: 'disabled' })
    const baseline = join(dir, `${fixture}.png`)
    if (update || !existsSync(baseline)) {
      writeFileSync(baseline, shot)
      console.log(`${update ? 'updated' : 'created'}  ${fixture}`)
      continue
    }
    const result = await compare(readFileSync(baseline).toString('base64'), shot.toString('base64'))
    const pct = (result.share * 100).toFixed(3)
    if (result.share > PIXEL_TOLERANCE) {
      failed++
      mkdirSync(out, { recursive: true })
      writeFileSync(join(out, `${fixture}.actual.png`), shot)
      if (result.diff) writeFileSync(join(out, `${fixture}.diff.png`), Buffer.from(result.diff, 'base64'))
      console.log(`FAIL     ${fixture}: ${result.size ?? `${pct}% of pixels changed`} — see ${out}/`)
    } else {
      console.log(`ok       ${fixture} (${pct}% changed)`)
    }
  } catch (e) {
    failed++
    console.log(`ERROR    ${fixture}: ${e.message.split('\n')[0]}`)
  }
}
/*
 * Motion: a still cannot show that a turning ship flies forward and then
 * pivots, so this samples the counter's transform through a plotted turn.
 * Mid-leg it must have moved but kept its heading; at rest it must have
 * turned. (The duel-plot fixture plots a standard turn with acceleration.)
 */
if (only.length === 0 || only.includes('motion')) {
  try {
    await open('duel-plot')
    const read = () =>
      page.evaluate(() => {
        const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('g.ship')).transform)
        return { x: m.e, angle: Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI) }
      })
    const start = await read()
    await page.evaluate(() => window.__navigate())
    await page.waitForTimeout(300)
    const mid = await read()
    await page.waitForTimeout(1800)
    const rest = await read()
    const flew = mid.x !== start.x && mid.x !== rest.x && mid.angle === start.angle && rest.angle !== start.angle
    if (flew) console.log('ok       motion (forward, then pivot)')
    else {
      failed++
      console.log(`FAIL     motion: start ${JSON.stringify(start)} mid ${JSON.stringify(mid)} rest ${JSON.stringify(rest)}`)
    }
  } catch (e) {
    failed++
    console.log(`ERROR    motion: ${e.message.split('\n')[0]}`)
  }
}

if (errors.length > 0) {
  failed++
  console.log(`Page errors:\n  ${[...new Set(errors)].join('\n  ')}`)
}

await browser.close()
await server.close()
console.log(failed === 0 ? `\n${fixtures.length} map fixture(s) match.` : `\n${failed} problem(s).`)
process.exit(failed === 0 ? 0 : 1)
