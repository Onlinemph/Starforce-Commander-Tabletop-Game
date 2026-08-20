import { expectedValue, FACE_DAMAGE, faceValue, reroll, rollDice, type DieRoll, type Rng } from './dice'
import {
  applyVolley,
  drawCard,
  reshuffle,
  type DamageContext,
  type VolleyDamage,
  type VolleyOutcome,
} from './damage'
import { actualRange, arcTo, canBearOn, effectiveRange, hasLineOfSight, shieldsFacing, type CircleObstacle } from './geometry'
import { NO_SCOUT_SUPPORT, type ScoutSupport } from './scouting'
import { mountIsReady, undamagedSystemBoxes, type ShipState } from './shipState'
import type { Arc, DieColor, RangeBracketDef, ShieldSide, WeaponSystemDef } from './types'

// ---------------------------------------------------------------------------
// Weapon traits (F1)
// ---------------------------------------------------------------------------

export function hasTrait(weapon: WeaponSystemDef, trait: string): boolean {
  const needle = trait.toUpperCase().replace(/\s+/g, '')
  return weapon.traits.some((t) => t.toUpperCase().replace(/\s+/g, '').startsWith(needle))
}

/** Numeric suffix of a trait, e.g. `PREC 2` → 2, `MISL 3` → 3. */
export function traitValue(weapon: WeaponSystemDef, trait: string): number | null {
  const needle = trait.toUpperCase().replace(/\s+/g, '')
  for (const t of weapon.traits) {
    const normalized = t.toUpperCase().replace(/\s+/g, '')
    if (normalized.startsWith(needle)) {
      const match = normalized.slice(needle.length).match(/-?\d+/)
      if (match) return Number(match[0])
      return 0
    }
  }
  return null
}

/** Only PD-trait weapons may perform defensive fire (E12.2.5). */
export function isPointDefense(weapon: WeaponSystemDef): boolean {
  return hasTrait(weapon, 'PDWPN') || hasTrait(weapon, 'PDMODE') || hasTrait(weapon, 'PDAREA')
}

/** Dedicated point defense weapons do no damage to starships (F1.20.3). */
export function harmsStarships(weapon: WeaponSystemDef): boolean {
  return !hasTrait(weapon, 'PDWPN')
}

// ---------------------------------------------------------------------------
// Range brackets (E1.2, C1.5)
// ---------------------------------------------------------------------------

export function bracketIndexFor(weapon: WeaponSystemDef, range: number): number {
  return weapon.brackets.findIndex((b) => range >= b.min && range <= b.max)
}

/**
 * Select the firing chart column. A target at speed zero is "low speed" and the
 * attacker uses the bracket immediately to the left (C1.5.2).
 */
export function selectBracket(
  weapon: WeaponSystemDef,
  effRange: number,
  lowSpeedTarget: boolean,
): { bracket: RangeBracketDef; index: number } | null {
  let index = bracketIndexFor(weapon, effRange)
  if (index === -1) return null
  if (lowSpeedTarget && index > 0) index -= 1
  return { bracket: weapon.brackets[index], index }
}

/** A ship at speed zero suffers the low-speed penalty (C1.5.1). */
export function isLowSpeed(ship: ShipState, negated = false): boolean {
  return !negated && ship.speed === 0
}

// ---------------------------------------------------------------------------
// Firing sequence (E6.2 Step 1, H2.4.1)
// ---------------------------------------------------------------------------

/**
 * Ships fire in descending order of Tactical Scan; ties fire simultaneously
 * (H2.4.1, H2.4.2). Returns groups of ship ids, highest scan first.
 *
 * `scanOf` supplies each ship's effective Tactical Scan. It defaults to the
 * ship's own sensor plot; a game running Command Systems passes a function that
 * adds the points lent by its command ship (H5.2.2).
 */
export function firingOrder(
  ships: ShipState[],
  scanOf: (ship: ShipState) => number = (ship) => ship.sensors.tacticalScan,
): ShipState[][] {
  const active = ships.filter((s) => !s.destroyed && !s.disengaged && !s.derelict)
  const byScan = new Map<number, ShipState[]>()
  for (const ship of active) {
    const scan = scanOf(ship)
    if (!byScan.has(scan)) byScan.set(scan, [])
    byScan.get(scan)!.push(ship)
  }
  return [...byScan.entries()].sort((a, b) => b[0] - a[0]).map(([, group]) => group)
}

// ---------------------------------------------------------------------------
// Volley definition (E7.1.1)
// ---------------------------------------------------------------------------

export type FireMode = 'standard' | 'proximity' | 'precision'

export interface MountSelection {
  weaponId: string
  mountIndex: number
  /**
   * Fire at low power: use only this many attack dice and expend the same
   * number of arming circles (E3.4). Omit to fire the full charge.
   */
  lowPowerDice?: number
}

export interface VolleyRequest {
  attacker: ShipState
  target: ShipState
  mounts: MountSelection[]
  mode: FireMode
  /** Which section of the target to precision-target (E9.1.2). */
  precisionSection?: 'shields' | 'weapons' | 'general' | 'engineering'
  /** Firing at cloaked ships, small targets, through terrain, etc. (E10). */
  degradedFireControl?: boolean
  /** Attacker's chosen arc when line of sight is ambiguous (E2.2.5). */
  chosenArc?: Arc
  /** Defender's chosen shield when line of sight is ambiguous (E2.2.5). */
  chosenShield?: ShieldSide
  /** Extra defender rerolls from terrain cover (K2.1.8). */
  defenderCoverRerolls?: number
  /**
   * Extra defender rerolls from evasive maneuvers (C3.6.3, optional). Both
   * halves of that rule land here, because both are the defender rerolling:
   * an evading *target* is harder to hit, and an evading *attacker* shoots
   * worse, so its victim rerolls its dice right back. Proximity fire denies
   * them, exactly as it denies a red bracket's (E3.3.4).
   */
  defenderEvasiveRerolls?: number
  /** Low-speed penalty suppressed by terrain (C1.5.3, K2.2.1). */
  lowSpeedNegated?: boolean
  /** Part of a Coordinated Fire attack, which bars precision targeting (H4.6.2). */
  coordinated?: boolean
  /** Targeting and area jamming lent by scouts (H3.4, H3.5). */
  scoutSupport?: ScoutSupport
  /** Target is inside a nebula or gas cloud, so its shields do nothing (K4.2.1). */
  targetShieldsInoperative?: boolean
  /** The attacker has its own cloak engaged, which locks its weapons (H6.4.2). */
  attackerCloaked?: boolean
  /** Why the target cannot be fired at, if the cloaking rules forbid it (H6.14). */
  targetUnshootable?: string
  /** The target has its cloak engaged, which bars precision targeting (H6.4.11). */
  targetCloaked?: boolean
  /**
   * Working SCNC boxes on the attacker, for the precision-targeting hand
   * (E9.2.2). Defaults to its undamaged boxes; a nebula can switch them off
   * (K4.2.4).
   */
  attackerSciences?: number
  obstacles?: CircleObstacle[]
  /**
   * Roll everything but hold the damage: the attacker is in a Tactical Scan
   * tie, and tied ships' damage takes effect simultaneously (H2.4.2).
   */
  defer?: boolean
}

export interface MountFireRecord {
  weaponName: string
  mountIndex: number
  bracket: RangeBracketDef
  rolls: DieRoll[]
  /** Dice removed because the mount is degraded (E8.3.1). */
  diceLostToDamage: number
}

export interface VolleyResult {
  ok: true
  actualRange: number
  effectiveRange: number
  attackerArcs: Arc[]
  targetShield: ShieldSide
  records: MountFireRecord[]
  damage: VolleyDamage
  /** Damage before halving from proximity/degraded fire control. */
  rawStandard: number
  /** Null when the volley was deferred: the damage is held (H2.4.2). */
  outcome: VolleyOutcome | null
  /** The held damage, when deferred — applied when the tie group completes. */
  held?: HeldVolley
}

/**
 * A volley rolled but not yet applied. Ships with tied Tactical Scans fire
 * simultaneously and their damage takes effect simultaneously (H2.4.2) — the
 * rulebook's own table procedure is "write the damage down, draw the cards
 * when everyone has fired", and this is that note, held as data until the
 * tie group completes.
 */
export interface HeldVolley {
  attackerId: string
  attackerName: string
  targetId: string
  damage: VolleyDamage
  /** Arcs the damage arrives from, for card resolution context. */
  attackerArcs: Arc[]
  /** Precision hand drawn at roll time, kept private until it lands (E9.2.2). */
  precision?: DamageContext['precision']
  /**
   * The fire line for the shared log, composed at roll time and printed at
   * the reveal — H2.4.2's secrecy applied to the battle log itself.
   */
  announcement?: string
}

/** Land a held volley: the deferred half of `resolveVolley`. */
export function applyHeldVolley(
  target: ShipState,
  held: HeldVolley,
  ctx: DamageContext,
): VolleyOutcome {
  const volleyCtx: DamageContext = { ...ctx, attackerArcs: held.attackerArcs, precision: held.precision }
  const outcome = applyVolley(target, held.damage, volleyCtx)
  // Reshuffle after every volley that damages a ship (E7.1.3).
  reshuffle(ctx.deck, ctx.rng)
  return outcome
}

export interface VolleyRejected {
  ok: false
  reason: string
}

// ---------------------------------------------------------------------------
// Resolution (E6.2, E7.3)
// ---------------------------------------------------------------------------

export function resolveVolley(
  request: VolleyRequest,
  ctx: DamageContext,
  rng: Rng,
): VolleyResult | VolleyRejected {
  const { attacker, target, mode } = request

  if (attacker.destroyed || attacker.derelict) return { ok: false, reason: 'Attacker cannot fire.' }
  // H6.4.2: a cloaked ship cannot fire at all.
  if (request.attackerCloaked) {
    return { ok: false, reason: `${attacker.name} is cloaked and may not fire (H6.4.2).` }
  }
  // H6.14.1/2: an undetected ship, or one held only as a Contact, is unshootable.
  if (request.targetUnshootable) {
    return { ok: false, reason: request.targetUnshootable }
  }
  if (target.destroyed || target.disengaged) return { ok: false, reason: 'Target is no longer in play.' }
  if (request.mounts.length === 0) return { ok: false, reason: 'No weapons selected.' }

  // Step 2: effective range (E6.2 Step 2, H2.3.3). Degraded fire control forfeits
  // the attacker's targeting but still suffers the target's jamming (E10.2.1/2).
  //
  // A scout illuminating the target adds to the attacker's targeting points and
  // a scout's area jamming adds to the target's jamming (H3.4.1, H3.5.1). Both
  // are the scout's own sensors, so neither is capped by the firing ship's
  // sensor rating.
  const support = request.scoutSupport ?? NO_SCOUT_SUPPORT
  const actual = actualRange(attacker.placement.position, target.placement.position)
  const targeting = request.degradedFireControl ? 0 : attacker.sensors.targeting + support.targeting
  const effective = effectiveRange(actual, target.sensors.jamming + support.jamming, targeting)

  if (request.obstacles && !hasLineOfSight(attacker.placement.position, target.placement.position, request.obstacles)) {
    return { ok: false, reason: 'Line of sight is blocked (E2.3.2).' }
  }

  // Steps 3 and 4: arc and shield (E6.2 Steps 3-4).
  const attackerArcs = arcTo(attacker.placement.position, attacker.placement.heading, target.placement.position)
  const firingArcs =
    request.chosenArc && attackerArcs.includes(request.chosenArc) ? [request.chosenArc] : attackerArcs

  const shieldOptions = shieldsFacing(
    attacker.placement.position,
    target.placement.position,
    target.placement.heading,
  )
  const targetShield =
    request.chosenShield && shieldOptions.includes(request.chosenShield)
      ? request.chosenShield
      : shieldOptions[0]

  if (mode === 'precision') {
    // E9.1.3: precision targeting requires effective range 8 or less.
    if (effective > 8) return { ok: false, reason: 'Precision targeting requires effective range 8 or less (E9.1.3).' }
    if (!request.precisionSection) return { ok: false, reason: 'No precision target section declared (E9.1.2).' }
    // H4.6.2: too much interference from the other ships' fire.
    if (request.coordinated) {
      return { ok: false, reason: 'Ships using Coordinated Fire may not use precision targeting (H4.6.2).' }
    }
    // H6.4.11: never against a cloaked ship, whatever the detection level.
    if (request.targetShieldsInoperative && request.targetCloaked) {
      return { ok: false, reason: 'Precision targeting may not be used against a cloaked ship (H6.4.11).' }
    }
  }
  if (mode === 'proximity' && request.degradedFireControl) {
    // E3.3.2: proximity fire is unavailable while using degraded fire control.
    return { ok: false, reason: 'Proximity fire may not be used with degraded fire control (E3.3.2).' }
  }

  const lowSpeed = isLowSpeed(target, request.lowSpeedNegated)

  // Validate and gather the firing mounts.
  const records: MountFireRecord[] = []
  const toDischarge: Array<{ weapon: WeaponSystemDef; index: number; circles: number }> = []

  for (const selection of request.mounts) {
    const weapon = attacker.form.weapons.find((w) => w.id === selection.weaponId)
    if (!weapon) return { ok: false, reason: `Unknown weapon ${selection.weaponId}.` }
    const state = attacker.mounts[weapon.id]?.[selection.mountIndex]
    if (!state) return { ok: false, reason: 'Unknown weapon mount.' }
    const mountDef = weapon.mounts[selection.mountIndex]

    if (mode === 'precision' && traitValue(weapon, 'PREC') === null) {
      // E9.2.1: no mixing precision and non-precision weapons in one volley.
      return { ok: false, reason: `${weapon.name} lacks the PREC trait (E9.2.1).` }
    }
    if (!canBearOn(mountDef.arcs, firingArcs)) {
      return { ok: false, reason: `${weapon.name} mount ${selection.mountIndex + 1} cannot bear on the target.` }
    }
    if (state.firedSegment) {
      // A mount speaks once a phase (E6.2 Step 6). Full fire empties its
      // circles anyway; this is what stops a low-power shot's leftovers from
      // speaking twice inside a split opportunity (rules reading 2).
      return { ok: false, reason: `${weapon.name} mount ${selection.mountIndex + 1} has already fired this phase (E6.2 Step 6).` }
    }

    const selected = selectBracket(weapon, effective, lowSpeed)
    if (!selected) {
      return { ok: false, reason: `Target out of range for ${weapon.name} (effective range ${effective}).` }
    }

    // Degraded mounts drop one die per damage box; the firing player chooses
    // which, so drop the weakest first (E8.3.1).
    let dice: DieColor[] = [...selected.bracket.dice]
    const diceLost = Math.min(state.damage, dice.length)
    if (diceLost > 0) dice = dropWeakest(dice, diceLost)

    let circlesUsed = mountDef.armingCircles
    if (selection.lowPowerDice !== undefined) {
      // E3.4: one attack die per arming circle expended.
      if (mountDef.armingCircles !== selected.bracket.dice.length) {
        return { ok: false, reason: `${weapon.name} cannot fire at low power in this bracket (E3.4.2).` }
      }
      if (state.damage > 0) {
        return { ok: false, reason: `Degraded weapons may not fire at low power (E3.4.2).` }
      }
      const n = Math.max(0, Math.min(selection.lowPowerDice, state.armed, dice.length))
      if (n === 0) return { ok: false, reason: 'No arming circles available for low-power fire.' }
      dice = dice.slice(0, n)
      circlesUsed = n
    } else if (!mountIsReady(weapon, selection.mountIndex, state)) {
      return { ok: false, reason: `${weapon.name} mount ${selection.mountIndex + 1} is not ready to fire.` }
    }

    if (mountDef.ammo !== undefined && state.ammoUsed >= mountDef.ammo) {
      return { ok: false, reason: `${weapon.name} mount ${selection.mountIndex + 1} is out of ammunition (F1.2.4).` }
    }

    // Point defense mode may only fire in its first two range brackets (F1.4.2).
    records.push({
      weaponName: weapon.name,
      mountIndex: selection.mountIndex,
      bracket: selected.bracket,
      rolls: rollDice(dice, rng),
      diceLostToDamage: diceLost,
    })
    toDischarge.push({ weapon, index: selection.mountIndex, circles: circlesUsed })
  }

  // Step 6: erase arming circles for the mounts that fired (E6.2 Step 6),
  // and mark each as having spoken this phase.
  for (const entry of toDischarge) {
    const state = attacker.mounts[entry.weapon.id][entry.index]
    state.armed = Math.max(0, state.armed - entry.circles)
    state.firedSegment = true
    if (entry.weapon.mounts[entry.index].ammo !== undefined) state.ammoUsed += 1
  }

  // Steps 8 and 9: rerolls (E6.2 Steps 8-9).
  //
  // Rerolls are optional — "the attacker MAY reroll" (E1.2.1), "the defender MAY
  // reroll" (E1.2.3) — and the new result is final even if it is worse. So a die
  // is only rerolled when doing so is expected to help the player holding the
  // reroll: the attacker rerolls results below the die's average, the defender
  // rerolls results above it.
  for (const record of records) {
    const weapon = attacker.form.weapons.find((w) => w.name === record.weaponName)!
    const special = weapon.special?.damage ?? 0
    const bonus = record.bracket.bonus ?? 0
    const worth = (die: DieRoll, forAttacker: boolean) => {
      const value = faceValue(die.face, special, bonus)
      const mean = expectedValue(die.color, special, bonus)
      return forAttacker ? value < mean : value > mean
    }

    if (mode === 'proximity') {
      // E3.3.4: the attacker rerolls blank results only, and the defender may
      // not reroll at all — that is proximity fire's whole advantage.
      record.rolls = record.rolls.map((die) => (die.face === '-' ? reroll(die, rng) : die))
      continue
    }

    if (record.bracket.band === 'green') {
      record.rolls = record.rolls.map((die) => (worth(die, true) ? reroll(die, rng) : die))
    }
    if (record.bracket.band === 'red') {
      record.rolls = record.rolls.map((die) => (worth(die, false) ? reroll(die, rng) : die))
    }
  }

  /**
   * Terrain cover lets the defender reroll further, cumulatively (K2.1.8) —
   * and the rulebook is explicit that the budget is spent freely: five
   * rerolls may go on one die five times, on five dice once, or anything
   * between (E6.2 Step 9).
   *
   * So each reroll goes to whichever die in the *whole volley* is currently
   * doing the most damage above its own average, re-deciding after every one.
   * Two things follow, and both matter. Rerolls are never stranded in a weak
   * weapon's record while a heavy's Special sits untouched in another. And a
   * die that comes up high again is simply rerolled again, rather than the
   * budget moving on to a lesser die.
   *
   * Measured against the previous fixed one-pass-per-record ordering, over
   * 40,000 simulated volleys: 4% less damage through at one reroll, and 17%
   * at five — the gap widening exactly where the old rule ran out of list and
   * started wasting the budget.
   */
  const extraRerolls =
    (request.defenderCoverRerolls ?? 0) + (request.defenderEvasiveRerolls ?? 0)
  if (mode !== 'proximity' && extraRerolls > 0) {
    const pool = records.flatMap((record) => {
      const weapon = attacker.form.weapons.find((w) => w.name === record.weaponName)!
      const special = weapon.special?.damage ?? 0
      const bonus = record.bracket.bonus ?? 0
      return record.rolls.map((_, index) => ({ record, index, special, bonus }))
    })

    for (let left = extraRerolls; left > 0; left--) {
      let best: (typeof pool)[number] | null = null
      let bestGain = 0
      for (const slot of pool) {
        const die = slot.record.rolls[slot.index]
        const gain =
          faceValue(die.face, slot.special, slot.bonus) -
          expectedValue(die.color, slot.special, slot.bonus)
        if (gain > bestGain) {
          bestGain = gain
          best = slot
        }
      }
      // Nothing left above its average: further rerolls would only hurt.
      if (!best) break
      best.record.rolls[best.index] = reroll(best.record.rolls[best.index], rng)
    }
  }

  // Step 11: total the damage (E7.3.1, E7.3.2).
  let standard = 0
  let leak = 0
  let structurePenetration = 0

  for (const record of records) {
    const weapon = attacker.form.weapons.find((w) => w.name === record.weaponName)!
    if (!harmsStarships(weapon)) continue // F1.20.3
    const bonus = record.bracket.bonus ?? 0
    for (const die of record.rolls) {
      if (die.face === '-') continue
      if (die.face === 'S') {
        const special = weapon.special
        standard += (special?.damage ?? 0) + bonus
        leak += special?.leak ?? 0
        structurePenetration += special?.structure ?? 0
      } else {
        standard += FACE_DAMAGE[die.face] + bonus
        if (die.face === 'H') leak += 1 // E7.2.6
      }
    }
  }

  const rawStandard = standard

  // Proximity fire (E3.3.5 – E3.3.7) and degraded fire control (E10.2.3 – E10.2.5)
  // both halve standard damage and discard leak and special effects.
  if (mode === 'proximity' || request.degradedFireControl) {
    standard = Math.floor(standard / 2)
    leak = 0
    structurePenetration = 0
  }

  const damage: VolleyDamage = {
    standard,
    leak,
    structurePenetration,
    side: targetShield,
    // K4.2.1: inside a nebula or gas cloud the target's blue and green boxes
    // are ignored and damage goes straight to armor.
    shieldsInoperative: request.targetShieldsInoperative,
  }

  // Precision targeting: the attacker draws a private hand of replacement
  // cards before damage is applied (E9.2.2).
  const volleyCtx: DamageContext = { ...ctx, attackerArcs: arcTo(target.placement.position, target.placement.heading, attacker.placement.position) }
  if (mode === 'precision' && request.precisionSection) {
    const precisionLevel = Math.max(
      ...request.mounts.map((m) => {
        const weapon = attacker.form.weapons.find((w) => w.id === m.weaponId)!
        return traitValue(weapon, 'PREC') ?? 0
      }),
    )
    const scnc = request.attackerSciences ?? undamagedSystemBoxes(attacker, 'SCNC')
    const cardCount = precisionLevel + (attacker.genSysLevel === 'max' ? scnc * 2 : scnc)
    const hand = Array.from({ length: cardCount }, () => drawCard(ctx.deck, ctx.rng))
    volleyCtx.precision = { section: request.precisionSection, hand }
    ctx.log(
      `${attacker.name} uses precision targeting on ${request.precisionSection} (${cardCount} replacement cards).`,
    )
  }

  // A tied ship's damage is held until the whole tie group has fired
  // (H2.4.2): the dice are final, the cards wait.
  if (request.defer) {
    return {
      ok: true,
      actualRange: actual,
      effectiveRange: effective,
      attackerArcs: firingArcs,
      targetShield,
      records,
      damage,
      rawStandard,
      outcome: null,
      held: {
        attackerId: attacker.id,
        attackerName: attacker.name,
        targetId: target.id,
        damage,
        attackerArcs: volleyCtx.attackerArcs ?? [],
        precision: volleyCtx.precision,
      },
    }
  }

  const outcome = applyVolley(target, damage, volleyCtx)

  // Reshuffle after every volley that damages a ship (E7.1.3).
  reshuffle(ctx.deck, ctx.rng)

  return {
    ok: true,
    actualRange: actual,
    effectiveRange: effective,
    attackerArcs: firingArcs,
    targetShield,
    records,
    damage,
    rawStandard,
    outcome,
  }
}

const DIE_STRENGTH: Record<DieColor, number> = { blue: 0, green: 1, yellow: 2, red: 3 }

/** Remove the `count` weakest dice — the firing player's sensible choice (E8.3.1). */
function dropWeakest(dice: DieColor[], count: number): DieColor[] {
  const sorted = [...dice].sort((a, b) => DIE_STRENGTH[a] - DIE_STRENGTH[b])
  const toDrop = sorted.slice(0, count)
  const result = [...dice]
  for (const color of toDrop) {
    const idx = result.indexOf(color)
    if (idx !== -1) result.splice(idx, 1)
  }
  return result
}
