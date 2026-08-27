/**
 * Price the Expansion 7 hulls with the design-tool point model.
 *
 * The draft book has no Master Ship List, and only two printed prices (the
 * MAERSK's "(PV6)" and the BASTION's "(Point Value 100)"). Every other hull
 * is priced by the same model the ship builders use, rounded to the half
 * point — the aurelian Ship Book 5 precedent. Two-pass: run
 * `python3 generate_ships.py`, then `npx vite-node tools/price_exp7.ts`,
 * then generate again so the victory tables are computed from the final
 * prices.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pointValue } from '../src/engine/shipBuilder'
import type { ShipForm } from '../src/engine/types'

const here = dirname(fileURLToPath(import.meta.url))
const ships = JSON.parse(readFileSync(join(here, 'ships_final.json'), 'utf8')) as (ShipForm & {
  shipBook?: string
})[]

const prices: Record<string, number> = {}
for (const form of ships) {
  if (form.shipBook !== 'exp7') continue
  const modeled = Math.round(pointValue(form).points * 2) / 2
  if (form.pointValue > 0) {
    console.log(`${form.name}: printed ${form.pointValue} (model would say ${modeled})`)
    continue
  }
  prices[form.name] = modeled
  console.log(`${form.name}: ${modeled}`)
}
writeFileSync(join(here, 'exp7_pv.json'), JSON.stringify(prices, null, 1))
console.log(`wrote ${Object.keys(prices).length} prices to exp7_pv.json`)
