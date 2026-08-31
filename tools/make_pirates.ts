/**
 * Build the pirate hulls (the designer's "make a few basic pirate ships")
 * and append them to src/data/customShips.json, the bundled custom roster.
 *
 * Pirates fly what pirates can get: converted freighters and stolen
 * transports, armed from whatever fell off a convoy. Each hull is built
 * through the Shipwright's own machinery — a canon chassis stripped of its
 * guns, re-armed from the canon weapon catalog — then re-flagged to the
 * Pirate Clans and priced by the design-tool point model, so they are legal
 * ships by construction, not hand-typed stat blocks.
 *
 * Run: npx vite-node tools/make_pirates.ts   (idempotent — replaces any
 * fan-pirate-* entries already present).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { addCatalogWeapon, buildChassis, weaponCatalog, type CatalogWeapon } from '../src/data/shipwright'
import { pointValue } from '../src/engine/shipBuilder'
import type { ShipForm } from '../src/engine/types'

const here = dirname(fileURLToPath(import.meta.url))
const file = join(here, '..', 'src', 'data', 'customShips.json')

function catalogEntry(fragment: string): CatalogWeapon {
  const entry = weaponCatalog().find((e) => e.key.toUpperCase().includes(fragment.toUpperCase()))
  if (!entry) throw new Error(`No catalog weapon matching "${fragment}"`)
  return entry
}

function pirate(
  donorId: string,
  className: string,
  year: number,
  guns: Array<{ fragment: string; mounts: number; arcs?: 'forward' | 'forward-wide' | 'turret' | 'aft' }>,
): ShipForm {
  const hull = buildChassis(donorId, className)
  if (typeof hull === 'string') throw new Error(`${donorId}: ${hull}`)
  for (const gun of guns) addCatalogWeapon(hull, catalogEntry(gun.fragment), gun.mounts, gun.arcs)
  hull.id = `fan-pirate-${className.split('-')[0].toLowerCase()}`
  hull.faction = 'Pirate Clans'
  hull.year = year
  hull.availability = 'common'
  delete (hull as { provisional?: boolean }).provisional
  hull.pointValue = Math.round(pointValue(hull).points * 2) / 2
  return hull
}

const pirates: ShipForm[] = [
  // A RUNNER freighter with the cargo pods torn out for gun mounts: the
  // bread-and-butter raider that shakes down unescorted merchants.
  pirate('union-runner-class-light-freighter', 'MARAUDER-class Corsair', 3655, [
    { fragment: '27/2 PHASER', mounts: 2, arcs: 'forward-wide' },
    { fragment: 'LNC-127/54', mounts: 1, arcs: 'turret' },
  ]),
  // A stolen V-5H fast transport with its guns kept and doubled: the one
  // that catches you. Fast enough to run from a warship, armed enough to
  // murder a freighter.
  pirate('vallari-v-5h-corsair-class-fast-transport', 'JACKAL-class Raider', 3658, [
    { fragment: 'TYPE-31', mounts: 3, arcs: 'forward-wide' },
    { fragment: 'D-YAGUS', mounts: 1, arcs: 'forward' },
  ]),
  // A HORIZON freighter rebuilt around black-market Vallari disruptors and a
  // Union phaser — the clan flagship that raids colonies, not convoys.
  pirate('union-horizon-class-medium-freighter', 'REAVER-class Heavy Corsair', 3661, [
    { fragment: 'TYPE-29', mounts: 3, arcs: 'forward-wide' },
    { fragment: '27/2 PHASER', mounts: 2, arcs: 'turret' },
  ]),
  /*
   * The designer's second ask: pirates at 15, 25, 50 and 75 points, for
   * scaling the raids from a nuisance to a war. Past the freighter
   * conversions, pirates fly what pirates TAKE — each tier is a captured
   * warship re-armed from the scrapyard, and each configuration was tuned
   * until the point model landed on the requested value exactly.
   */
  // 15 pts — a hijacked Vallari Savage light cruiser, crew spaced, guns
  // swapped for what the clans had crated: the first hull that can stand up
  // to a real escort.
  pirate('vallari-v-6n-savage-class-light-cruiser', 'BRIGAND-class Cruiser', 3663, [
    { fragment: 'TYPE-29', mounts: 4, arcs: 'forward-wide' },
    { fragment: 'D-YAGUS', mounts: 1, arcs: 'forward' },
  ]),
  // 25 pts — a captured Union Yorktown I, torpedo tubes reloaded with stolen
  // ordnance and a scavenged phaser bolted over the stern arc.
  pirate('union-yorktown-i-class-heavy-cruiser', 'CUTTHROAT-class Heavy Cruiser', 3665, [
    { fragment: 'LNC-447 PHASER', mounts: 3, arcs: 'forward-wide' },
    { fragment: 'MK-4', mounts: 2, arcs: 'forward' },
    { fragment: '27/2 PHASER', mounts: 2, arcs: 'turret' },
    { fragment: 'LNC-127/54', mounts: 1, arcs: 'aft' },
  ]),
  // 50 pts — a Union II dreadnought that never came home from a border
  // skirmish: mismatched torpedo tubes because the clans load whatever fits.
  pirate('union-union-ii-class-dreadnought', 'WARLORD-class Dreadnought', 3668, [
    { fragment: 'LNC-500', mounts: 4, arcs: 'forward-wide' },
    { fragment: 'MK-5', mounts: 1, arcs: 'forward' },
    { fragment: 'MK-4', mounts: 1, arcs: 'forward' },
    { fragment: 'LNC-127/54', mounts: 4, arcs: 'turret' },
  ]),
  // 75 pts — the pirate king's own ship: a late-mark Yorktown V rebuilt heavy,
  // six phaser batteries forward and a stinger over the stern. The battle
  // that recovers THIS hull ends a campaign's pirate problem for good.
  pirate('union-yorktown-v-class-heavy-cruiser', 'BLACKFLAG-class Flagship', 3670, [
    { fragment: 'LNC-500', mounts: 6, arcs: 'forward-wide' },
    { fragment: 'MK-6', mounts: 2, arcs: 'forward' },
    { fragment: '27/2 PHASER', mounts: 4, arcs: 'turret' },
    { fragment: 'LNC-27/2', mounts: 1, arcs: 'aft' },
  ]),
]

const existing = (JSON.parse(readFileSync(file, 'utf8')) as ShipForm[]).filter(
  (f) => !f.id.startsWith('fan-pirate-'),
)
writeFileSync(file, JSON.stringify([...existing, ...pirates], null, 1))
for (const p of pirates) {
  console.log(
    `${p.id}: ${p.name} — size ${p.sizeClass}, ${p.pointValue} pts, ` +
      `${p.weapons.map((w) => `${w.mounts.length}x ${w.name}`).join(' + ')}`,
  )
}
console.log(`customShips.json now carries ${existing.length + pirates.length} designs`)
