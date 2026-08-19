/**
 * Screenshot harness for UI work: drives the built app through the screens
 * that matter and writes PNGs. Usage:
 *   node tools/shots/capture.mjs <outDir> [baseUrl]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const outDir = process.argv[2] ?? 'shots/before'
const base = process.argv[3] ?? 'http://127.0.0.1:4173'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const shot = async (name) => {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${outDir}/${name}.png` })
  console.log('shot', name)
}
const byText = (t) => page.getByText(t, { exact: false }).first()
const clickText = async (t, ms = 5000) => {
  await byText(t).click({ timeout: ms })
  await page.waitForTimeout(400)
}
const clickBtn = async (re, ms = 4000) => {
  await page.getByRole('button', { name: re }).first().click({ timeout: ms })
  await page.waitForTimeout(400)
}
const step = async (name, fn) => {
  try {
    await fn()
  } catch (e) {
    console.log(`SKIP ${name}: ${e.message.split('\n')[0]}`)
  }
}

const fresh = async () => {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
}

await fresh()
await shot('01-title')

// ── The battle screen ──────────────────────────────────────────────────────
await step('battle', async () => {
  await clickText('To the table')
  await shot('02-battle')
})

await step('fleet-picker', async () => {
  await clickBtn(/choose forces/i)
  await shot('03-fleet-picker')
  await clickBtn(/^×$|close/i, 2500)
})

// Advance a few segments so the combat panel and log have content.
await step('battle-underway', async () => {
  for (let i = 0; i < 6; i++) {
    const next = page
      .getByRole('button', { name: /complete |proceed|next segment|→/i })
      .first()
    if (!(await next.isVisible().catch(() => false))) break
    await next.click({ timeout: 2500 }).catch(() => {})
    await page.waitForTimeout(220)
  }
  await shot('04-battle-underway')
})

// Workshop screens, from the title menu.
for (const [name, label] of [
  ['05-ship-builder', /ship builder/i],
  ['06-scenario-designer', /scenario designer/i],
  ['07-library', /^library$/i],
]) {
  await step(name, async () => {
    await fresh()
    await clickBtn(label)
    await shot(name)
  })
}

await step('08-online-panel', async () => {
  await fresh()
  await clickText('Online match')
  await shot('08-online-panel')
})

// ── Border Command ─────────────────────────────────────────────────────────
await step('campaign', async () => {
  await fresh()
  await clickText('Border Command')
  await shot('09-campaign-menu')
  await clickText('The Border Watch')
  await shot('10-campaign-blackout')
  await clickText('Take the console')
  await shot('11-campaign-console')
  // Select a unit so the orders panel is populated.
  await page.locator('.campaign-map g').first().click({ timeout: 3000 }).catch(() => {})
  await shot('12-campaign-orders')
})

// ── Narrow viewport, to prove nothing collapses ───────────────────────────
await step('narrow', async () => {
  await page.setViewportSize({ width: 900, height: 1000 })
  await fresh()
  await shot('13-title-narrow')
  await clickText('To the table')
  await shot('14-battle-narrow')
})

await browser.close()
