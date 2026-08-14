/**
 * What does a flight cost?
 *
 *     npx vite-node tools/fighter_points.ts
 *
 * Q3 in `docs/fighter-questions.md` is the one open question that blocks
 * points-matched play: nothing on a fighter card prices it, and the V41 builder
 * says outright that "the point value of any fighters is not included in the
 * hangar". This works the number out rather than guessing it.
 *
 * The method is the one the rest of this repository uses for anything the
 * printed material does not answer: **derive it from the printed material.**
 *
 *  1. Price the ninety-three printed hulls in two currencies the rules
 *     themselves define — damage points delivered per round, and damage points
 *     required to remove them. Both are computable from a ship form with no
 *     free parameters.
 *  2. Regress their printed point values against those two currencies. That
 *     gives an exchange rate: what one point of firepower and one point of
 *     durability are worth, on the scale the game is actually costed in.
 *  3. Price a flight in the same two currencies. A fighter's output and soak
 *     are computable from a card with no free parameters either, once the
 *     Package A rules are applied — E10.2.3 halving, COA 1 division by
 *     Structure, E10.2.2 jamming, one strike per load.
 *  4. Convert with the exchange rate from step 2.
 *
 * Nothing here is fitted to how fighters play. The only calibration is the
 * printed roster's own prices, which is the point: if the answer agrees with
 * measured play, that agreement is evidence rather than construction.
 */

import { SHIP_FORMS } from '../src/data/ships'
import { SFC_FIGHTERS, FAN_FIGHTERS } from '../src/data/fighters'
import { expectedValue } from '../src/engine/dice'
import {
  flightDamagePerRound as engineDamage,
  flightDogfightPerRound as engineDogfight,
  flightDurability as engineDurability,
  flightPoints as enginePoints,
  loadoutOf,
  soakEfficiency,
  PD_SHARE,
  type FighterCard,
} from '../src/engine/fighters'
import type { ShipForm } from '../src/engine/types'

/*
 * `SHIP_FORMS` deliberately, not `allShipForms()`. The fan designs' point
 * values come out of the V41 model rather than off a printed card, so fitting
 * to them would be fitting to a model — and one of them, the YORKTOWN XXX, is a
 * five-centuries-out thought experiment at 1263 points that dragged the whole
 * curve when it was in the sample.
 */

/** Combat phases in a round (A3.2). Fighters act in every one; guns do not. */
const PHASES_PER_ROUND = 3

// ---------------------------------------------------------------------------
// Currency 1: damage delivered per round
// ---------------------------------------------------------------------------

/**
 * Rounds a mount needs to be ready. Arming circles fill one point per Resource
 * Allocation Segment when the mount is gated by a slow-arming diamond (E4.2.8);
 * ungated, the whole mount fills in one round.
 */
function roundsToArm(circles: number, gates: boolean[] | undefined): number {
  if (!gates || gates.length === 0) return 1
  return 1 + gates.filter(Boolean).length * Math.max(0, circles - 1)
}

/**
 * A ship's expected damage per round, averaged over its own firing chart.
 *
 * Averaging across brackets rather than picking one is deliberate: a weapon's
 * value is the whole chart, and which bracket a battle is fought in is the
 * players' business. It is the same simplification the V41 sheet makes with its
 * bracket weights, without borrowing that sheet's weights — those are tuned to
 * reproduce prices, and reproducing prices is what this is trying to test.
 */
function shipDamagePerRound(form: ShipForm): number {
  let total = 0
  for (const weapon of form.weapons) {
    const special = weapon.special?.damage ?? 0
    const perBracket = weapon.brackets.map((b) =>
      b.dice.reduce((n, die) => n + expectedValue(die, special, b.bonus ?? 0), 0),
    )
    if (perBracket.length === 0) continue
    const mean = perBracket.reduce((a, b) => a + b, 0) / perBracket.length
    for (const mount of weapon.mounts) {
      total += mean / roundsToArm(mount.armingCircles, mount.roundGates)
    }
  }
  return total
}

/**
 * Damage points needed to remove a ship: every box an attacker has to chew
 * through. The same pool `shipBuilder.totalSystemBoxes` counts, plus screens
 * and armour, which is what "hit points" means in that model too.
 */
function shipHitPoints(form: ShipForm): number {
  const sides = ['F', 'S', 'A', 'P'] as const
  const shields = sides.reduce((n, s) => n + form.shields.blue[s] + form.shields.green[s], 0)
  const armor = sides.reduce((n, s) => n + form.armor[s], 0)
  const general = form.systems.reduce((n, g) => n + g.boxes, 0)
  const reactors = form.reactors.reduce((n, g) => n + g.points.reduce((m, p) => m + p.boxes, 0), 0)
  const mounts = form.weapons.reduce(
    (n, w) => n + w.mounts.reduce((m, mt) => m + mt.hitBoxes, 0),
    0,
  )
  const structure = form.structure.filter((e) => e.kind === 'box').length
  return (
    shields +
    armor +
    general +
    reactors +
    form.batteries +
    form.ftlDriveBoxes +
    form.sublight.driveBoxes +
    form.shields.generatorBoxes +
    mounts +
    structure
  )
}

// ---------------------------------------------------------------------------
// Step 2: the exchange rate, from the printed roster
// ---------------------------------------------------------------------------

/**
 * Fit `points = k · (D · H)^gamma` by ordinary least squares on the logs.
 *
 * Two forms were tried first and both failed, in ways worth recording because
 * they are the two obvious things to reach for:
 *
 *  - `points = a·D + b·H` — a linear price for firepower and a linear price for
 *    durability. Firepower and durability are strongly collinear across the
 *    printed roster (big ships have more of both), so with no intercept the fit
 *    handed **firepower a negative price**: every fighter in the table below was
 *    being paid to shoot.
 *  - `points = k · D^alpha · H^beta` — free exponents on each. Same collinearity,
 *    subtler failure: it settled on alpha 0.067 and beta 2.202, meaning firepower
 *    was worth almost nothing and price rose with the *square* of durability.
 *    That prices every small unit at nearly zero, which is exactly the mistake a
 *    fighter model must not make.
 *
 * The fix is to stop asking the data to separate two things it cannot separate,
 * and to constrain the shape instead. **Lanchester's square law** says fighting
 * strength is the product of how hard a unit hits and how long it survives to
 * keep hitting — one quantity, not two — and the V41 sheet reaches for the same
 * shape when it prices offense "twice over", once against the target's outer
 * defences and once against what is underneath. One exponent on the product is
 * identifiable where two on the factors are not.
 */
function fitLanchester(
  rows: Array<{ d: number; h: number; y: number }>,
): { k: number; gamma: number } {
  const xs = rows.map((r) => Math.log(r.d * r.h))
  const ys = rows.map((r) => Math.log(r.y))
  const n = rows.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  const gamma = num / den
  return { k: Math.exp(my - gamma * mx), gamma }
}

/** The printed roster, and only the printed roster. */
const printed = SHIP_FORMS.filter((f) => (f.pointValue ?? 0) > 0)
const rows = printed.map((f) => ({
  name: f.name,
  d: shipDamagePerRound(f),
  h: shipHitPoints(f),
  y: f.pointValue!,
}))
const { k, gamma } = fitLanchester(rows)

/** What the printed roster says a unit with this output and this hull is worth. */
function priceOf(damagePerRound: number, hitPoints: number): number {
  return k * (damagePerRound * hitPoints) ** gamma
}

const residuals = rows.map((r) => ({ name: r.name, actual: r.y, model: priceOf(r.d, r.h) }))
const meanErr =
  residuals.reduce((n, r) => n + Math.abs(r.model - r.actual) / r.actual, 0) / residuals.length

console.log('THE PRINTED ROSTER, FITTED')
console.log(`  points = ${k.toFixed(4)} · (damage per round × damage to destroy)^${gamma.toFixed(3)}`)
console.log(`  mean absolute error across ${rows.length} printed hulls: ${(meanErr * 100).toFixed(1)}%`)
const worst = [...residuals].sort(
  (x, y) => Math.abs(y.model - y.actual) / y.actual - Math.abs(x.model - x.actual) / x.actual,
)
console.log('  worst fits:')
for (const r of worst.slice(0, 3)) {
  console.log(
    `    ${r.name.padEnd(42)} printed ${r.actual.toFixed(0).padStart(4)}  model ${r.model.toFixed(0).padStart(4)}`,
  )
}
const best = worst[worst.length - 1]
console.log(`    best: ${best.name} — printed ${best.actual.toFixed(0)}, model ${best.model.toFixed(0)}`)

// ---------------------------------------------------------------------------
// Step 3: a flight in the same two currencies
// ---------------------------------------------------------------------------

/**
 * What a battery keeps of its expected damage when the target's jamming is
 * added to the actual range (E10.2.2).
 *
 * Measured on the printed charts rather than assumed: walk every weapon in the
 * roster across every range on its own chart, look up the bracket the volley
 * would actually be resolved in once jamming is added, and total the expected
 * damage both ways. Off the end of the chart is the whole volley lost. This is
 * the derivation behind `JAMMING_PENALTY` in the engine.
 */
function jammingPenalty(jamming: number): number {
  let withJam = 0
  let without = 0
  for (const form of printed) {
    for (const weapon of form.weapons) {
      const special = weapon.special?.damage ?? 0
      const value = (i: number) => {
        const b = weapon.brackets[i]
        return b ? b.dice.reduce((n, d) => n + expectedValue(d, special, b.bonus ?? 0), 0) : 0
      }
      const maxRange = Math.max(...weapon.brackets.map((b) => b.max))
      for (let range = 0; range <= maxRange; range++) {
        const here = weapon.brackets.findIndex((b) => range >= b.min && range <= b.max)
        if (here < 0) continue
        const there = weapon.brackets.findIndex(
          (b) => range + jamming >= b.min && range + jamming <= b.max,
        )
        without += value(here)
        withJam += there < 0 ? 0 : value(there)
      }
    }
  }
  return without === 0 ? 1 : withJam / without
}

/**
 * The share of the fire aimed at a flight that is point defense rather than
 * battery — the weight between "lands whole" (E12.4.3) and "halved and pushed
 * down the chart" (E10.2.3, E10.2.2). Read off the printed roster as the share
 * of expected damage per round coming from mounts that carry PD MODE. This is
 * the derivation behind `PD_SHARE` in the engine.
 */
function pointDefenseShare(): number {
  let pd = 0
  let all = 0
  for (const form of printed) {
    for (const weapon of form.weapons) {
      const isPd = weapon.traits.some((t) => /^PD/i.test(t.replace(/\s+/g, '')))
      const special = weapon.special?.damage ?? 0
      const mean =
        weapon.brackets.reduce(
          (n, b) => n + b.dice.reduce((m, d) => m + expectedValue(d, special, b.bonus ?? 0), 0),
          0,
        ) / Math.max(1, weapon.brackets.length)
      for (const mount of weapon.mounts) {
        const rate = mean / roundsToArm(mount.armingCircles, mount.roundGates)
        all += rate
        if (isPd) pd += rate
      }
    }
  }
  return all === 0 ? 0.5 : pd / all
}

/** Fighters in the flight this prices. */
const FLIGHT = 6

/**
 * The dogfight, priced in the same damage currency as everything else.
 *
 * A flight's guns remove `N × DFR/6 × (1 − Dodge/6)` enemy fighters a phase.
 * The temptation is to price that in *points* — a kill is worth what a fighter
 * is worth — and that was the second thing tried here. It does not work: the
 * value of a fighter then appears on both sides of its own equation with a gain
 * near one, so the iteration walks off instead of settling. Sixty passes gave
 * 22.78 points a fighter and flights costing more than a dreadnought.
 *
 * The fix is to stop converting into points twice. **A dogfight kill is worth
 * the damage a starship would have had to land to do the same job** — the same
 * currency the anti-ship term is already in, finite, and not self-referential.
 */
function typicalFighterSoak(): number {
  const cards = [...SFC_FIGHTERS, ...FAN_FIGHTERS]
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  return mean(cards.map((c) => c.structure)) / soakEfficiency(mean(cards.map((c) => c.jamming)))
}

const ALL = [...SFC_FIGHTERS, ...FAN_FIGHTERS]
const KINDS = ['strike', 'space-superiority', 'basic'] as const

console.log(`\nWHAT THE PACKAGE A RULES DO TO A FLIGHT'S DURABILITY`)
const derivedPdShare = pointDefenseShare()
console.log(
  `  point defense is ${(derivedPdShare * 100).toFixed(0)}% of the printed roster's fire and ignores jamming (E12.4.3)` +
    ` — the engine carries ${(PD_SHARE * 100).toFixed(0)}%`,
)
console.log(`  everything else is halved (E10.2.3) and pushed down the chart by jamming (E10.2.2):`)
for (const j of [5, 6, 7, 8]) {
  console.log(
    `    jamming ${j} → a battery keeps ${(jammingPenalty(j) * 100).toFixed(0)}% of its expected damage; ` +
      `a flight soaks ${(1 / soakEfficiency(j)).toFixed(2)}× its printed Structure`,
  )
}
console.log(`  a typical fighter therefore costs ${typicalFighterSoak().toFixed(1)} damage points to shoot down`)

/*
 * From here the *engine's* own functions do the pricing, not this file's. The
 * constants below were fitted here and pasted into `src/engine/fighters.ts`, so
 * running the numbers back through that module is what proves the two have not
 * drifted — a table computed twice in two places would only prove this file
 * agrees with itself.
 */
console.log('\nA FLIGHT OF SIX (priced by src/engine/fighters.ts)')
console.log('  card        loadout            dmg/rnd  dogfight   soak   STRIKE ONLY   ALL ROLES')
const table: Array<{ card: FighterCard; kind: string; strikeOnly: number; total: number }> = []
for (const card of ALL) {
  for (const kind of KINDS) {
    if (!loadoutOf(card, kind)) continue
    const dmg = engineDamage(card, kind, FLIGHT)
    const dog = engineDogfight(card, kind, FLIGHT)
    const soak = engineDurability(card, kind, FLIGHT)
    const strikeOnly = enginePoints(card, kind, FLIGHT, 'strike')
    const total = enginePoints(card, kind, FLIGHT, 'all')
    table.push({ card, kind, strikeOnly, total })
    console.log(
      `${card.fan ? '*' : ' '} ${card.name.padEnd(11)} ${kind.padEnd(18)} ` +
        `${dmg.toFixed(1).padStart(6)} ${dog.toFixed(1).padStart(9)} ` +
        `${soak.toFixed(0).padStart(6)} ${strikeOnly.toFixed(0).padStart(12)} ` +
        `${total.toFixed(0).padStart(11)}`,
    )
  }
}
console.log('  (* = Babylon 5 calibration set)')

const totals = table.map((t) => t.total).sort((x, y) => x - y)
const strikes = table.map((t) => t.strikeOnly).sort((x, y) => x - y)
const median = (xs: number[]) => xs[Math.floor(xs.length / 2)]
console.log('\nTHE ANSWER')
console.log(
  `  A flight of six: ${totals[0].toFixed(0)} to ${totals[totals.length - 1].toFixed(0)} points, ` +
    `median ${median(totals).toFixed(0)}.`,
)
console.log(
  `  Against a fleet with no fighters in it: ${strikes[0].toFixed(0)} to ` +
    `${strikes[strikes.length - 1].toFixed(0)}, median ${median(strikes).toFixed(0)}.`,
)
console.log(`  Per fighter: ${(median(totals) / FLIGHT).toFixed(1)} points.`)

/*
 * The independent check. `docs/fighters.md` records a measurement made before
 * any of this existed: the ARK ROYAL's 47.3-point hull, flying 24 fighters,
 * fought dead even with a 100-point EXETER II — so the wing was worth about 53
 * points, or 13 for a flight of six. That measurement was made against a fleet
 * with no fighters in it, so the STRIKE ONLY column is the one it should be
 * compared to, and only the strike loadouts were flown.
 */
const strikeLoads = table.filter((t) => t.kind === 'strike').map((t) => t.strikeOnly)
const modelled = strikeLoads.reduce((a, b) => a + b, 0) / strikeLoads.length
console.log('\nAGAINST THE ONE MEASUREMENT WE HAVE')
console.log(`  measured (ARK ROYAL vs EXETER II, 16 games): ~13 points a flight`)
console.log(`  this model, strike loadouts, no enemy fighters: ${modelled.toFixed(0)} points a flight`)

// ---------------------------------------------------------------------------
// The constants, for `src/engine/fighters.ts`
// ---------------------------------------------------------------------------

/*
 * `fighterPoints` has to run in the browser without the printed roster's
 * regression in front of it, so the fitted figures are baked in there and this
 * is where they come from. Re-run this tool after any change to the roster or
 * to the Package A rules and paste the block below across; the test in
 * `fighters.test.ts` checks the two agree.
 */
console.log('\nCONSTANTS FOR src/engine/fighters.ts')
console.log(`  export const PRICE_SCALE = ${k.toFixed(6)}`)
console.log(`  export const PRICE_EXPONENT = ${gamma.toFixed(6)}`)
console.log(`  export const PD_SHARE = ${PD_SHARE.toFixed(6)}`)
console.log(`  export const TYPICAL_FIGHTER_SOAK = ${typicalFighterSoak().toFixed(6)}`)
console.log(
  `  export const JAMMING_PENALTY = [${Array.from({ length: 13 }, (_, j) => jammingPenalty(j).toFixed(4)).join(', ')}]`,
)
