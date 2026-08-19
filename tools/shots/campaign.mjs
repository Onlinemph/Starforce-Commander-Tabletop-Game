/**
 * One-command render check for the Border Command plot.
 *
 * Serves ./dist itself (no vite preview to babysit), drives the campaign
 * console, and writes a full view plus a zoomed crop of the plot — the crop is
 * the one that matters for terrain and counter work.
 *
 *   npx vite build && node tools/shots/campaign.mjs shots/iter
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const outDir = process.argv[2] ?? 'shots/iter'
mkdirSync(outDir, { recursive: true })

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
}
const root = 'dist'
const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = join(root, normalize(url).replace(/^(\.\.[/\\])+/, ''))
    if (url === '/' || !extname(file)) file = join(root, 'index.html')
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.goto(base, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.goto(base, { waitUntil: 'networkidle' })
await page.getByText('Border Command', { exact: false }).first().click()
await page.waitForTimeout(350)
await page.getByText('The Border Watch', { exact: false }).first().click()
await page.waitForTimeout(350)
await page.getByText('Take the console', { exact: false }).first().click()
await page.waitForTimeout(800)

await page.screenshot({ path: `${outDir}/console.png` })
console.log('shot console')

// A zoomed crop of the plot: terrain, mesh, counters and border at real size.
const box = await page.locator('.campaign-map').boundingBox()
if (box) {
  await page.screenshot({
    path: `${outDir}/plot-crop.png`,
    clip: { x: box.x + 40, y: box.y + 20, width: Math.min(760, box.width - 60), height: Math.min(520, box.height - 40) },
  })
  console.log('shot plot-crop')
}

/* Select a unit so the planned-route and selection states render too.

   Click the COUNTER at real coordinates, not the group and not a located
   element. A unit group's box also spans its stacked name, so the group's
   centre is the gap between the two and lands on the ground rect — a click on
   empty space, exactly as it would be for a player. And a located click on the
   plate is refused by actionability, because the ship-count numeral is painted
   over it; that numeral is inside the same group and a player clicking it does
   select the unit, so the check is wrong about this map and a real mouse click
   at the plate's centre is what a player actually does. */
const plate = await page.locator('.campaign-map g[data-unit]').first().locator('circle').first().boundingBox()
if (plate) await page.mouse.click(plate.x + plate.width / 2, plate.y + plate.height / 2)
await page.waitForTimeout(500)
await page.screenshot({ path: `${outDir}/selected.png` })
console.log('shot selected')

await browser.close()
server.close()
