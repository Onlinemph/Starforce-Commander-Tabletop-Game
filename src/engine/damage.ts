import { DAMAGE_DECK, HIT_LABELS, PRECISION_SECTION, type PrecisionSection } from '../data/damageDeck'
import { Rng, rollForSpecial } from './dice'
import {
  armorRemaining,
  blueShieldRemaining,
  damageControlRating,
  greenShieldRemaining,
  markStructure,
  mountIsDamaged,
  shieldGeneratorRating,
  SHIELD_SIDES,
  structureRemaining,
  undamagedSystemBoxes,
  type ShipState,
} from './shipState'
import type { Arc, DamageCard, DamageHit, ShieldSide, SystemKind } from './types'

// ---------------------------------------------------------------------------
// Deck (A2.6, E7.1.3)
// ---------------------------------------------------------------------------

export interface DeckState {
  draw: DamageCard[]
  discard: DamageCard[]
}

export function newDeck(rng: Rng): DeckState {
  return { draw: rng.shuffle([...DAMAGE_DECK]), discard: [] }
}

/** "Reshuffle the deck after every volley that damages a ship." (A2.6, E7.1.3) */
export function reshuffle(deck: DeckState, rng: Rng): void {
  deck.draw = rng.shuffle([...deck.draw, ...deck.discard])
  deck.discard = []
}

export function drawCard(deck: DeckState, rng: Rng): DamageCard {
  if (deck.draw.length === 0) reshuffle(deck, rng)
  const card = deck.draw.pop()!
  deck.discard.push(card)
  return card
}

// ---------------------------------------------------------------------------
// Player choices
// ---------------------------------------------------------------------------

/**
 * Damage cards routinely hand the *defender* a choice (E8.3.2, E8.4.1, E8.2.2).
 * The engine defers to this provider so the UI can prompt, while tests and the
 * default hot-seat flow use `autoChoices`, which plays a sensible defence.
 */
export interface DamageChoices {
  /** E8.4.1 Any Hit — defender picks any system box. */
  anyHit(ship: ShipState): DamageHit
  /** E8.3.2 / E8.3.3 / E8.3.4 — defender picks which mount takes the hit. */
  weaponMount(
    ship: ShipState,
    filter: { facingArcs?: Arc[]; heavyOnly?: boolean },
  ): { weaponId: string; index: number } | null
  /** E8.3.5 — defender picks a powered mount to lose its charge. */
  weaponToDischarge(ship: ShipState): { weaponId: string; index: number } | null
  /** E8.2.2 — defender picks which shield loses three boxes. */
  shieldPowerLoss(ship: ShipState): ShieldSide | null
  /** E8.5.3 — defender picks which battery is damaged. */
  battery(ship: ShipState): number | null
  /** E8.5.10 — defender picks which main reactor takes the alternate hit. */
  mainReactor(ship: ShipState): string | null
}

function reactorGroupsFor(ship: ShipState, kinds: string[]): string[] {
  return ship.form.reactors
    .filter((g) => kinds.includes(g.hitKind))
    .filter((g) => (ship.reactorDamage[g.id] ?? []).some((d, i) => d < g.points[i].boxes))
    .map((g) => g.id)
}

/**
 * A competent defender: soak hits on systems that matter least first, and keep
 * weapons and reactors alive as long as possible.
 */
export const autoChoices: DamageChoices = {
  anyHit(ship) {
    // Prefer free hits, then non-combat systems, then combat systems. Structure
    // is only legal when nothing else is (E8.4.1).
    const order: Array<[SystemKind, DamageHit]> = [
      ['QTRS', 'quarters'],
      ['CRGO', 'quarters'],
      ['SHTL', 'shuttle-bay'],
      ['PROB', 'special-system'],
      ['SPCL', 'special-system'],
      ['TRAN', 'transporter'],
      ['TRAC', 'tractor-beam'],
      ['SCNC', 'sciences'],
      // Command systems go before sensors: losing a lent tactical scan point
      // (H5.1.4) hurts less than losing targeting and jamming outright.
      ['CMND', 'special-system'],
      ['SENS', 'sensors'],
    ]
    for (const [kind, hit] of order) {
      if (undamagedSystemBoxes(ship, kind) > 0) return hit
    }
    if (shieldGeneratorRating(ship) > 0) return 'shield-generator'
    if (this.weaponMount(ship, {})) return 'any-weapon'
    const reactor = reactorGroupsFor(ship, ['aux', 'sublight-reactor'])
    if (reactor.length > 0) return 'aux-reactor'
    return 'structure'
  },

  weaponMount(ship, filter) {
    const candidates: Array<{ weaponId: string; index: number; score: number }> = []
    for (const weapon of ship.form.weapons) {
      if (filter.heavyOnly) {
        const usesRed = weapon.brackets.some((b) => b.dice.includes('red'))
        const usesYellow = weapon.brackets.some((b) => b.dice.includes('yellow'))
        if (!usesRed && !usesYellow) continue
      }
      const states = ship.mounts[weapon.id] ?? []
      states.forEach((state, index) => {
        if (mountIsDamaged(weapon, index, state)) return
        if (filter.facingArcs && filter.facingArcs.length > 0) {
          const arcs = weapon.mounts[index].arcs
          if (!filter.facingArcs.some((a) => arcs.includes(a))) return
        }
        // Sacrifice unarmed mounts, and mounts with spare damage boxes, first.
        const score = state.armed * 10 + (weapon.mounts[index].hitBoxes - state.damage)
        candidates.push({ weaponId: weapon.id, index, score })
      })
    }
    if (candidates.length === 0) return null
    const best = candidates.reduce((a, b) => (a.score <= b.score ? a : b))
    return { weaponId: best.weaponId, index: best.index }
  },

  weaponToDischarge(ship) {
    // Losing a partial charge costs least (E8.3.5).
    const candidates: Array<{ weaponId: string; index: number; armed: number }> = []
    for (const weapon of ship.form.weapons) {
      const states = ship.mounts[weapon.id] ?? []
      states.forEach((state, index) => {
        if (state.armed === 0 || mountIsDamaged(weapon, index, state)) return
        candidates.push({ weaponId: weapon.id, index, armed: state.armed })
      })
    }
    if (candidates.length === 0) return null
    const best = candidates.reduce((a, b) => (a.armed <= b.armed ? a : b))
    return { weaponId: best.weaponId, index: best.index }
  },

  shieldPowerLoss(ship) {
    // Prefer a shield with at least three boxes left (E8.2.2).
    const withThree = SHIELD_SIDES.filter((s) => blueShieldRemaining(ship, s) >= 3)
    const pool = withThree.length > 0 ? withThree : SHIELD_SIDES.filter((s) => blueShieldRemaining(ship, s) > 0)
    if (pool.length === 0) return null
    // Spend the strongest shield, keeping weak ones intact for repair.
    return pool.reduce((a, b) => (blueShieldRemaining(ship, a) >= blueShieldRemaining(ship, b) ? a : b))
  },

  battery(ship) {
    const empty = ship.batteryDamaged.findIndex((d, i) => !d && !ship.batteryCharged[i])
    if (empty !== -1) return empty
    const any = ship.batteryDamaged.findIndex((d) => !d)
    return any === -1 ? null : any
  },

  mainReactor(ship) {
    const groups = reactorGroupsFor(ship, ['left-main', 'right-main', 'center-main'])
    return groups[0] ?? null
  },
}

// ---------------------------------------------------------------------------
// Damage context
// ---------------------------------------------------------------------------

export interface PrecisionContext {
  section: PrecisionSection
  /** The attacker's separate hand of replacement cards (E9.2.2). */
  hand: DamageCard[]
}

export interface DamageContext {
  deck: DeckState
  rng: Rng
  choices: DamageChoices
  log: (message: string) => void
  /** Arcs of the *target* the attacker occupies, for Facing Weapon (E8.3.3). */
  attackerArcs?: Arc[]
  /** Set during precision targeting (E9). */
  precision?: PrecisionContext
  /**
   * Marine sabotage: structure hits (direct or via alt) become No Effect
   * (J6.2.4).
   */
  marineAttack?: boolean
}

// ---------------------------------------------------------------------------
// Applying a single hit
// ---------------------------------------------------------------------------

/** Systems each hit consumes, for availability checks (E7.3.7). */
const SYSTEM_FOR_HIT: Partial<Record<DamageHit, SystemKind>> = {
  sciences: 'SCNC',
  sensors: 'SENS',
  'tractor-beam': 'TRAC',
  transporter: 'TRAN',
  'shuttle-bay': 'SHTL',
  quarters: 'QTRS',
  'special-system': 'SPCL',
}

/**
 * Groups a hit may fall on when its own group is gone (E8.4.7, E8.4.10).
 *
 * The deck prints no card for probe launchers or command systems, so a Special
 * System hit is the card that marks them off — H4.7 depends on a command ship
 * being able to lose CMND boxes. Quarters hits spill onto cargo and special
 * systems (J11.2.2).
 */
const ALTERNATE_SYSTEMS: Partial<Record<DamageHit, SystemKind[]>> = {
  'special-system': ['PROB', 'CMND'],
  quarters: ['CRGO', 'SPCL'],
}

/** The group a hit will actually mark off, or null when nothing is left. */
function systemTargetFor(ship: ShipState, hit: DamageHit): SystemKind | null {
  const primary = SYSTEM_FOR_HIT[hit]
  if (!primary) return null
  const order = [primary, ...(ALTERNATE_SYSTEMS[hit] ?? [])]
  return order.find((kind) => undamagedSystemBoxes(ship, kind) > 0) ?? null
}

/** Can this hit find an undamaged target on the ship? */
export function hitIsAvailable(ship: ShipState, hit: DamageHit, ctx: DamageContext): boolean {
  if (SYSTEM_FOR_HIT[hit]) return systemTargetFor(ship, hit) !== null

  switch (hit) {
    case 'shield-generator':
      return shieldGeneratorRating(ship) > 0
    case 'shield-power-loss':
      return SHIELD_SIDES.some((s) => blueShieldRemaining(ship, s) > 0)
    case 'any-weapon':
    case 'heavy-weapon':
      return ctx.choices.weaponMount(ship, { heavyOnly: hit === 'heavy-weapon' }) !== null
    case 'facing-weapon':
      return ctx.choices.weaponMount(ship, { facingArcs: ctx.attackerArcs }) !== null
    case 'weapon-power-loss':
      return ctx.choices.weaponToDischarge(ship) !== null
    case 'any-hit':
      return true
    case 'casualties':
      return ship.marineSquads > 0
    case 'sensor-power-loss':
      return (ship.allocation[sensorLineId(ship) ?? ''] ?? 0) > 0
    case 'battery':
      return ship.batteryDamaged.some((d) => !d)
    case 'aux-reactor':
      return reactorGroupsFor(ship, ['aux']).length > 0
    case 'sublight-reactor':
      return reactorGroupsFor(ship, ['sublight-reactor']).length > 0
    case 'left-main-reactor':
      return reactorGroupsFor(ship, ['left-main', 'center-main']).length > 0
    case 'right-main-reactor':
      return reactorGroupsFor(ship, ['right-main', 'center-main']).length > 0
    case 'any-main-reactor':
      return reactorGroupsFor(ship, ['left-main', 'right-main', 'center-main']).length > 0
    case 'sublight-drive':
      return (ship.systemDamage['__sublight'] ?? 0) < ship.form.sublight.driveBoxes
    case 'ftl-drive':
      return ship.ftlDriveDamage < ship.form.ftlDriveBoxes
    case 'sif':
      return true
    case 'structure':
      return true
    case 'derelict':
      return true
    default:
      // Critical (white) hits always resolve or do nothing (E8.6).
      return true
  }
}

function sensorLineId(ship: ShipState): string | undefined {
  return ship.form.functions.find((l) => l.kind === 'sensor')?.id
}

function damageReactor(ship: ShipState, groupId: string): void {
  const group = ship.form.reactors.find((g) => g.id === groupId)
  if (!group) return
  const damage = ship.reactorDamage[groupId]
  // Damage is applied left to right (B1.4.1, E8.5.1).
  for (let i = 0; i < group.points.length; i++) {
    if (damage[i] < group.points[i].boxes) {
      damage[i] += 1
      return
    }
  }
}

function damageSystem(ship: ShipState, kind: SystemKind): void {
  ship.systemDamage[kind] = (ship.systemDamage[kind] ?? 0) + 1
}

/**
 * Apply one point of internal damage from a resolved hit type.
 * Returns extra cards to draw (fires, bridge hits) and structure applied.
 */
function applyHit(ship: ShipState, hit: DamageHit, ctx: DamageContext): { extraCards: number } {
  if (SYSTEM_FOR_HIT[hit]) {
    const target = systemTargetFor(ship, hit)
    if (target) damageSystem(ship, target)
    ctx.log(`${ship.name}: ${HIT_LABELS[hit]}${target && target !== SYSTEM_FOR_HIT[hit] ? ` (${target})` : ''}`)
    return { extraCards: 0 }
  }

  switch (hit) {
    case 'shield-generator':
      ship.shieldGeneratorDamage += 1
      break

    case 'shield-power-loss': {
      // Three blue boxes off one shield of the defender's choice (E8.2.2).
      const side = ctx.choices.shieldPowerLoss(ship)
      if (side) {
        const loss = Math.min(3, blueShieldRemaining(ship, side))
        ship.blueShieldDamage[side] += loss
        ctx.log(`${ship.name}: Shield Power Loss — ${loss} boxes off the ${side} shield`)
        return { extraCards: 0 }
      }
      break
    }

    case 'any-weapon':
    case 'heavy-weapon':
    case 'facing-weapon': {
      const filter =
        hit === 'facing-weapon'
          ? { facingArcs: ctx.attackerArcs }
          : { heavyOnly: hit === 'heavy-weapon' }
      const pick = ctx.choices.weaponMount(ship, filter)
      if (pick) {
        const state = ship.mounts[pick.weaponId][pick.index]
        state.damage += 1
        const def = ship.form.weapons.find((w) => w.id === pick.weaponId)!
        // A fully damaged mount loses all arming points (E8.3.1, E8.3.3).
        if (mountIsDamaged(def, pick.index, state)) state.armed = 0
        ctx.log(`${ship.name}: ${HIT_LABELS[hit]} — ${def.name} mount ${pick.index + 1}`)
        return { extraCards: 0 }
      }
      break
    }

    case 'weapon-power-loss': {
      const pick = ctx.choices.weaponToDischarge(ship)
      if (pick) {
        ship.mounts[pick.weaponId][pick.index].armed = 0
        ctx.log(`${ship.name}: Weapon Power Loss — mount discharged`)
        return { extraCards: 0 }
      }
      break
    }

    case 'any-hit': {
      // Defender chooses a system box; recurse into the concrete hit (E8.4.1).
      const chosen = ctx.choices.anyHit(ship)
      ctx.log(`${ship.name}: Any Hit → ${HIT_LABELS[chosen]}`)
      return applyHit(ship, chosen, ctx)
    }

    case 'casualties':
      // Three marine squads (E8.4.2).
      ship.marineSquads = Math.max(0, ship.marineSquads - 3)
      break

    case 'sensor-power-loss': {
      const lineId = sensorLineId(ship)
      if (lineId && (ship.allocation[lineId] ?? 0) > 0) {
        ship.allocation[lineId] -= 1
        // Sensor point split must immediately be reduced to match (E8.4.5).
        clampSensorAllocation(ship)
      }
      break
    }

    case 'battery': {
      const index = ctx.choices.battery(ship)
      if (index !== null) {
        ship.batteryDamaged[index] = true
        ship.batteryCharged[index] = false // stored power is lost (B2.4.2)
      }
      break
    }

    case 'aux-reactor':
      damageReactor(ship, reactorGroupsFor(ship, ['aux'])[0])
      break
    case 'sublight-reactor':
      damageReactor(ship, reactorGroupsFor(ship, ['sublight-reactor'])[0])
      break
    case 'left-main-reactor':
      damageReactor(ship, reactorGroupsFor(ship, ['left-main', 'center-main'])[0])
      break
    case 'right-main-reactor':
      damageReactor(ship, reactorGroupsFor(ship, ['right-main', 'center-main'])[0])
      break
    case 'any-main-reactor': {
      const group = ctx.choices.mainReactor(ship)
      if (group) damageReactor(ship, group)
      break
    }

    case 'sublight-drive': {
      ship.systemDamage['__sublight'] = (ship.systemDamage['__sublight'] ?? 0) + 1
      if (ship.systemDamage['__sublight'] >= ship.form.sublight.driveBoxes) {
        // Involuntary Emergency Stop (E8.5.4).
        ship.stressMarkers += Math.abs(ship.speed)
        ship.speed = 0
        ship.emergencyStopPhases = 2
        ctx.log(`${ship.name}: sublight drive destroyed — involuntary Emergency Stop`)
      }
      break
    }

    case 'ftl-drive':
      ship.ftlDriveDamage += 1
      break

    case 'sif':
      // Alternate hit: the ship gains a stress marker (E8.5.8).
      ship.stressMarkers += 1
      break

    case 'structure':
      if (ctx.marineAttack) {
        ctx.log(`${ship.name}: Structure Hit ignored (marine sabotage, J6.2.4)`)
        return { extraCards: 0 }
      }
      if (!markStructure(ship)) ship.excessStructureDamage += 1
      break

    case 'derelict':
      if (!markStructure(ship)) ship.excessStructureDamage += 1
      break

    // ── Critical hits (E8.6) ───────────────────────────────────────────
    case 'bridge-hit':
      ctx.log(`${ship.name}: Bridge Hit — draw 2 additional damage cards`)
      return { extraCards: 2 }

    case 'major-fire':
    case 'minor-fire': {
      const extra = hit === 'major-fire' ? 3 : 2
      const dice = damageControlRating(ship)
      const { success } = rollForSpecial(dice, ctx.rng)
      if (success) {
        ctx.log(`${ship.name}: ${HIT_LABELS[hit]} contained by damage control (${dice} dice)`)
        return { extraCards: 0 }
      }
      ctx.log(`${ship.name}: ${HIT_LABELS[hit]} rages — ${extra} additional damage cards`)
      return { extraCards: extra }
    }

    case 'main-engineering-hit':
      // Two stress markers that the SIF may not cancel (E8.6.5).
      ship.stressMarkers += 2
      ctx.log(`${ship.name}: Main Engineering Hit — 2 uncancellable stress`)
      break

    case 'battery-power-loss': {
      const index = ship.batteryCharged.findIndex((c, i) => c && !ship.batteryDamaged[i])
      if (index !== -1) ship.batteryCharged[index] = false
      break
    }

    case 'no-effect':
      break
  }

  ctx.log(`${ship.name}: ${HIT_LABELS[hit]}`)
  return { extraCards: 0 }
}

/** Sensor points may never exceed what the ship can currently power (E8.4.5). */
export function clampSensorAllocation(ship: ShipState): void {
  const line = ship.form.functions.find((l) => l.kind === 'sensor')
  if (!line) return
  const filled = ship.allocation[line.id] ?? 0
  const available = filled === 0 ? line.freeValue : (line.steps[filled - 1]?.value ?? line.freeValue)
  const { sensors } = ship
  let total = sensors.targeting + sensors.jamming + sensors.tacticalScan
  const order: Array<keyof typeof sensors> = ['tacticalScan', 'jamming', 'targeting']
  for (const key of order) {
    while (total > available && sensors[key] > 0) {
      sensors[key] -= 1
      total -= 1
    }
  }
}

// ---------------------------------------------------------------------------
// Resolving a damage card (E7.3.6, E7.3.7)
// ---------------------------------------------------------------------------

/**
 * Resolve one damage card against a ship: primary hit, else alternate hit, else
 * structure (E7.3.7). Precision targeting ignores alternate hits entirely — an
 * unavailable primary simply loses the damage point (E9.1.4).
 */
export function resolveCard(ship: ShipState, card: DamageCard, ctx: DamageContext): number {
  if (ctx.precision) {
    if (card.primary === 'structure') {
      // Structure Hit cards still apply under precision targeting (E9.1.4).
      return applyHit(ship, 'structure', ctx).extraCards
    }
    if (!hitIsAvailable(ship, card.primary, ctx)) {
      ctx.log(`${ship.name}: ${HIT_LABELS[card.primary]} unavailable — damage lost (E9.1.4)`)
      return 0
    }
    return applyHit(ship, card.primary, ctx).extraCards
  }

  if (hitIsAvailable(ship, card.primary, ctx)) {
    return applyHit(ship, card.primary, ctx).extraCards
  }
  if (card.alt && hitIsAvailable(ship, card.alt, ctx)) {
    ctx.log(`${ship.name}: ${HIT_LABELS[card.primary]} unavailable → ALT HIT`)
    return applyHit(ship, card.alt, ctx).extraCards
  }
  return applyHit(ship, 'structure', ctx).extraCards
}

/**
 * Draw and resolve `count` damage cards, honouring cascades from fires and
 * bridge hits (E7.3.4, E7.3.5, E8.6).
 */
export function drawAndResolve(ship: ShipState, count: number, ctx: DamageContext): void {
  let remaining = count
  let guard = 0
  while (remaining > 0 && guard++ < 200) {
    if (ship.destroyed) return
    let card = drawCard(ctx.deck, ctx.rng)

    // Precision targeting: the attacker may swap in a card from their hand if
    // its primary hit matches the section being targeted (E9.2.3).
    if (ctx.precision) {
      const idx = ctx.precision.hand.findIndex(
        (c) => PRECISION_SECTION[c.primary] === ctx.precision!.section,
      )
      if (idx !== -1) {
        const replacement = ctx.precision.hand.splice(idx, 1)[0]
        ctx.log(
          `Precision targeting: ${HIT_LABELS[card.primary]} replaced with ${HIT_LABELS[replacement.primary]}`,
        )
        card = replacement
      }
    }

    remaining -= 1
    remaining += resolveCard(ship, card, ctx)
    checkDestruction(ship, ctx)
  }
}

// ---------------------------------------------------------------------------
// Volley damage (E7.3, G1.2, G2.2)
// ---------------------------------------------------------------------------

export interface VolleyDamage {
  /** Total standard damage after rerolls, bonuses and modifiers (E7.3.1). */
  standard: number
  /** One point per `H` result plus any `LEAK +X` (E7.2.6, F1.42). */
  leak: number
  /** `STR +X` from special hits, applied only on penetration (F1.43). */
  structurePenetration: number
  /** Which shield the volley strikes (E6.2 Step 4). */
  side: ShieldSide
}

export interface VolleyOutcome {
  greenAbsorbed: number
  blueAbsorbed: number
  armorAbsorbed: number
  internal: number
  leakCards: number
  structureFromSpecial: number
}

/**
 * Apply a volley to a ship: shields, then armor, then internal damage cards
 * (E7.3.3 – E7.3.5). Leak damage bypasses both (E7.2.6, G2.2.1).
 */
export function applyVolley(
  ship: ShipState,
  volley: VolleyDamage,
  ctx: DamageContext,
): VolleyOutcome {
  const side = volley.side
  let remaining = volley.standard

  const outcome: VolleyOutcome = {
    greenAbsorbed: 0,
    blueAbsorbed: 0,
    armorAbsorbed: 0,
    internal: 0,
    leakCards: volley.leak,
    structureFromSpecial: 0,
  }

  // Derelicts and lowered shields provide no protection (E11.2.5, G1.1.5).
  const shieldsWork = !ship.derelict && !ship.shieldsDown[side]

  if (shieldsWork) {
    // Reinforcement absorbs before the blue boxes (G1.3.2).
    const green = Math.min(remaining, greenShieldRemaining(ship, side))
    ship.greenShieldDamage[side] += green
    remaining -= green
    outcome.greenAbsorbed = green

    const blue = Math.min(remaining, blueShieldRemaining(ship, side))
    ship.blueShieldDamage[side] += blue
    remaining -= blue
    outcome.blueAbsorbed = blue
  }

  // Armor still applies when the shield is down (G1.1.5, G2.2.1).
  const armor = Math.min(remaining, armorRemaining(ship, side))
  ship.armorDamage[side] += armor
  remaining -= armor
  outcome.armorAbsorbed = armor

  const penetrated =
    (!shieldsWork || (blueShieldRemaining(ship, side) === 0 && greenShieldRemaining(ship, side) === 0)) &&
    armorRemaining(ship, side) === 0

  // STR +X lands before any damage cards are drawn (F1.43).
  if (penetrated && volley.structurePenetration > 0) {
    for (let i = 0; i < volley.structurePenetration; i++) {
      if (!markStructure(ship)) ship.excessStructureDamage += 1
    }
    outcome.structureFromSpecial = volley.structurePenetration
    ctx.log(`${ship.name}: ${volley.structurePenetration} structure damage from special hits (STR+X)`)
    checkDestruction(ship, ctx)
  }

  outcome.internal = remaining
  const cards = remaining + volley.leak
  if (cards > 0) {
    ctx.log(
      `${ship.name}: ${remaining} internal + ${volley.leak} leak = ${cards} damage card${cards === 1 ? '' : 's'}`,
    )
    drawAndResolve(ship, cards, ctx)
  }

  checkDestruction(ship, ctx)
  return outcome
}

// ---------------------------------------------------------------------------
// Destruction (E11)
// ---------------------------------------------------------------------------

export interface DestructionOptions {
  /** E11.2 — ships linger as derelicts instead of vanishing. */
  derelicts: boolean
  /** E11.3 — derelicts may explode. */
  explosions: boolean
}

/** Standard rules: a ship is removed the moment its last structure box is marked. */
export const STANDARD_DESTRUCTION: DestructionOptions = { derelicts: false, explosions: false }

let destructionOptions: DestructionOptions = STANDARD_DESTRUCTION

export function setDestructionOptions(options: DestructionOptions): void {
  destructionOptions = options
}

export function checkDestruction(ship: ShipState, ctx: DamageContext): void {
  if (ship.destroyed) return
  if (structureRemaining(ship) > 0) return

  if (!destructionOptions.derelicts) {
    // E11.1: removed from play immediately.
    ship.destroyed = true
    ctx.log(`${ship.name} is destroyed.`)
    return
  }

  if (!ship.derelict) {
    ship.derelict = true
    ship.speed = 0
    ctx.log(`${ship.name} is a derelict.`)
  }
  // E11.2.3: excess damage equal to the size class breaks the ship apart.
  if (ship.excessStructureDamage >= ship.form.sizeClass) {
    ship.destroyed = true
    ctx.log(`${ship.name} comes apart from excess structural damage.`)
  }
}
