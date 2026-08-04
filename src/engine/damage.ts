import { DAMAGE_DECK, HIT_LABELS, PRECISION_SECTION, type PrecisionSection } from '../data/damageDeck'
import { FACE_DAMAGE, rollDice, Rng, rollForSpecial } from './dice'
import { formationOf, type Formation } from './formation'
import { distance, shieldsFacing } from './geometry'
import { damageScoutSensor, scoutSensorAvailable } from './scouting'
import {
  armorRemaining,
  blueShieldRemaining,
  damageControlRating,
  greenShieldRemaining,
  markStructure,
  mountIsDamaged,
  scoutSensorsIntact,
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
    // A scout gives up a scout sensor only once its ordinary systems are gone
    // (H3.1.1) — they are the reason the ship is on the map.
    if (scoutSensorAvailable(ship)) return 'special-system'
    if (shieldGeneratorRating(ship) > 0) return 'shield-generator'
    if (this.weaponMount(ship, {})) return 'any-weapon'
    const reactor = reactorGroupsFor(ship, ['aux', 'sublight-reactor'])
    if (reactor.length > 0) return 'aux-reactor'
    return 'structure'
  },

  weaponMount(ship, filter) {
    /*
     * E8.3.4 degrades "one of the ship's heaviest remaining weapons", and puts
     * the tiers in order: "First, apply the damage point to a weapon that uses
     * red attack dice. If no undamaged weapons use red dice, choose a weapon
     * that uses yellow dice." Only the pick *inside* a tier is the defender's.
     *
     * A weapon's tier is its heaviest die — the one bracket that rolls red
     * makes it a red weapon, whatever it rolls at the ranges either side.
     * Pooling reds and yellows would let a ship keep its best gun by
     * volunteering a lesser one, which is not a choice the rule offers.
     */
    const heaviestDie = (weapon: (typeof ship.form.weapons)[number]): 'red' | 'yellow' | null =>
      weapon.brackets.some((b) => b.dice.includes('red'))
        ? 'red'
        : weapon.brackets.some((b) => b.dice.includes('yellow'))
          ? 'yellow'
          : null
    const undamagedMount = (weapon: (typeof ship.form.weapons)[number]) =>
      (ship.mounts[weapon.id] ?? []).some((state, i) => !mountIsDamaged(weapon, i, state))
    const heavyTier: 'red' | 'yellow' | null = !filter.heavyOnly
      ? null
      : ship.form.weapons.some((w) => heaviestDie(w) === 'red' && undamagedMount(w))
        ? 'red'
        : 'yellow'

    const candidates: Array<{ weaponId: string; index: number; score: number }> = []
    for (const weapon of ship.form.weapons) {
      if (heavyTier && heaviestDie(weapon) !== heavyTier) continue
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
// Choices a human captain can be asked to make
// ---------------------------------------------------------------------------

/**
 * A decision, written down.
 *
 * `autoChoices` decides in the moment, which is fine for a doctrine and no use
 * at all for a person: a battle is (setup + actions) and nothing else, so a
 * choice a player makes has to survive into the journal or the replay will
 * quietly make a different one. Hence a *script* — the answers, in the order
 * the resolution asks for them, carried in the action stream and consumed as
 * the cards come out.
 */
export type DamageChoice =
  | { kind: 'any-hit'; hit: DamageHit }
  | { kind: 'weapon-mount'; weaponId: string; index: number }
  | { kind: 'weapon-discharge'; weaponId: string; index: number }
  | { kind: 'shield-power-loss'; side: ShieldSide }
  | { kind: 'battery'; index: number }
  | { kind: 'main-reactor'; groupId: string }

export interface DamageOption {
  choice: DamageChoice
  label: string
  /** What the doctrine would have taken, offered as the default. */
  recommended: boolean
}

/** A question to put to a player, with every legal answer already worked out. */
export interface DamageDecision {
  shipId: string
  shipName: string
  kind: DamageChoice['kind']
  prompt: string
  options: DamageOption[]
}

/**
 * The hits a captain may name for an Any Hit (E8.4.1): any general,
 * engineering, weapon, shield-generator or sensor box.
 *
 * Not here, and deliberately: the power-loss hits, which drain a system rather
 * than mark a box; casualties, which are marines; SIF, which is a stress
 * marker; the critical hits, which E8.4.1 forbids outright; and structure,
 * which is only legal when nothing else is and so is added at the end.
 */
const ANY_HIT_BOXES: DamageHit[] = [
  'quarters',
  'shuttle-bay',
  'transporter',
  'tractor-beam',
  'sciences',
  'sensors',
  'special-system',
  'shield-generator',
  'any-weapon',
  'battery',
  'sublight-drive',
  'ftl-drive',
  'aux-reactor',
  'sublight-reactor',
  'left-main-reactor',
  'right-main-reactor',
]

function option(choice: DamageChoice, label: string, recommended: boolean): DamageOption {
  return { choice, label, recommended }
}

/**
 * Working out what is *available* must never itself ask a question — the
 * doctrine answers those, so listing the options cannot recurse into the
 * script or the prompt.
 */
function availabilityContext(): DamageContext {
  return { choices: autoChoices } as DamageContext
}

export interface MountFilter {
  facingArcs?: Arc[]
  heavyOnly?: boolean
}

/** Every legal answer to a decision, the doctrine's own among them. */
export function decisionFor(
  ship: ShipState,
  kind: DamageChoice['kind'],
  filter: MountFilter = {},
): DamageDecision {
  const ctx = availabilityContext()
  const base = { shipId: ship.id, shipName: ship.name, kind }
  switch (kind) {
    case 'any-hit': {
      const auto = autoChoices.anyHit(ship)
      const legal = ANY_HIT_BOXES.filter((hit) => hitIsAvailable(ship, hit, ctx))
      // Structure only when nothing else will take it (E8.4.1).
      const hits = legal.length > 0 ? legal : (['structure'] as DamageHit[])
      return {
        ...base,
        prompt: 'Any Hit — choose the system box to mark as damaged (E8.4.1).',
        options: hits.map((hit) => option({ kind: 'any-hit', hit }, HIT_LABELS[hit], hit === auto)),
      }
    }
    case 'weapon-mount':
    case 'weapon-discharge': {
      const discharge = kind === 'weapon-discharge'
      const auto = discharge
        ? autoChoices.weaponToDischarge(ship)
        : autoChoices.weaponMount(ship, filter)
      /**
       * Heavy Weapon takes the reds before the yellows (E8.3.4), so a captain
       * offered the choice is only offered what the card actually reaches.
       */
      const dieClass = (weapon: (typeof ship.form.weapons)[number], colour: 'red' | 'yellow') =>
        weapon.brackets.some((b) => b.dice.includes(colour))
      const undamaged = (weapon: (typeof ship.form.weapons)[number], index: number) =>
        !mountIsDamaged(weapon, index, (ship.mounts[weapon.id] ?? [])[index])
      const anyRed =
        filter.heavyOnly &&
        ship.form.weapons.some((w) => dieClass(w, 'red') && w.mounts.some((_, i) => undamaged(w, i)))

      const options: DamageOption[] = []
      for (const weapon of ship.form.weapons) {
        if (filter.heavyOnly) {
          const colour = anyRed ? 'red' : 'yellow'
          if (!dieClass(weapon, colour)) continue
        }
        const states = ship.mounts[weapon.id] ?? []
        states.forEach((state, index) => {
          if (mountIsDamaged(weapon, index, state)) return
          if (discharge && state.armed === 0) return
          const arcs = weapon.mounts[index].arcs
          if (filter.facingArcs?.length && !filter.facingArcs.some((a) => arcs.includes(a))) return
          const charge = state.armed > 0 ? ` — ${state.armed} armed` : ' — unarmed'
          options.push(
            option(
              { kind: discharge ? 'weapon-discharge' : 'weapon-mount', weaponId: weapon.id, index },
              `${weapon.name} mount ${index + 1} (${arcs.join('/')})${charge}`,
              auto?.weaponId === weapon.id && auto.index === index,
            ),
          )
        })
      }
      const prompt = discharge
        ? 'Weapon Power Loss — choose the mount to discharge (E8.3.5).'
        : filter.facingArcs?.length
          ? 'Facing Weapon — choose which mount bearing on the attacker takes the hit (E8.3.3).'
          : filter.heavyOnly
            ? 'Heavy Weapon — choose which of the heavy mounts is degraded (E8.3.4).'
            : 'Any Weapon — choose the mount that takes the hit (E8.3.2).'
      return { ...base, prompt, options }
    }
    case 'shield-power-loss': {
      const auto = autoChoices.shieldPowerLoss(ship)
      return {
        ...base,
        prompt: 'Shield Power Loss — choose the shield that loses three boxes (E8.2.2).',
        options: SHIELD_SIDES.filter((side) => blueShieldRemaining(ship, side) > 0).map((side) =>
          option(
            { kind: 'shield-power-loss', side },
            `${side} shield — ${blueShieldRemaining(ship, side)} left`,
            side === auto,
          ),
        ),
      }
    }
    case 'battery': {
      const auto = autoChoices.battery(ship)
      const options: DamageOption[] = []
      ship.batteryDamaged.forEach((damaged, index) => {
        if (damaged) return
        options.push(
          option(
            { kind: 'battery', index },
            `Battery ${index + 1} — ${ship.batteryCharged[index] ? 'charged' : 'empty'}`,
            index === auto,
          ),
        )
      })
      return { ...base, prompt: 'Battery — choose which battery is damaged (E8.5.3).', options }
    }
    case 'main-reactor': {
      const auto = autoChoices.mainReactor(ship)
      return {
        ...base,
        prompt: 'Choose which main reactor takes the hit (E8.5.10).',
        options: reactorGroupsFor(ship, ['left-main', 'right-main', 'center-main']).map((groupId) =>
          option({ kind: 'main-reactor', groupId }, groupId, groupId === auto),
        ),
      }
    }
  }
}

/**
 * A provider that plays a written-down script, and falls back to the doctrine.
 *
 * `onUnscripted` is how the UI discovers what to ask: run the resolution on a
 * throwaway copy of the game with the answers so far, and the first question
 * nobody has answered yet comes back out. Answers are checked against the
 * legal options before they are used, so a hand-edited save cannot mark a box
 * the rules would not allow.
 */
export function scriptedChoices(
  script: DamageChoice[],
  onUnscripted?: (decision: DamageDecision) => never,
): DamageChoices {
  function take<K extends DamageChoice['kind']>(
    ship: ShipState,
    kind: K,
    filter: MountFilter = {},
  ): Extract<DamageChoice, { kind: K }> | null {
    const decision = decisionFor(ship, kind, filter)
    const next = script[0]
    if (next?.kind === kind) {
      script.shift()
      const legal = decision.options.some(
        (o) => JSON.stringify(o.choice) === JSON.stringify(next),
      )
      if (legal) return next as Extract<DamageChoice, { kind: K }>
    }
    if (onUnscripted && decision.options.length > 0) onUnscripted(decision)
    return null
  }

  const provider: DamageChoices = {
    anyHit(ship) {
      return take(ship, 'any-hit')?.hit ?? autoChoices.anyHit(ship)
    },
    weaponMount(ship, filter) {
      // Facing and Heavy narrow the field rather than removing the choice:
      // E8.3.4 says outright that the target player picks among them, and
      // E8.3.3 is silent, which reads the same way beside E8.3.2.
      const picked = take(ship, 'weapon-mount', filter)
      return picked
        ? { weaponId: picked.weaponId, index: picked.index }
        : autoChoices.weaponMount(ship, filter)
    },
    weaponToDischarge(ship) {
      const picked = take(ship, 'weapon-discharge')
      return picked
        ? { weaponId: picked.weaponId, index: picked.index }
        : autoChoices.weaponToDischarge(ship)
    },
    shieldPowerLoss(ship) {
      return take(ship, 'shield-power-loss')?.side ?? autoChoices.shieldPowerLoss(ship)
    },
    battery(ship) {
      const picked = take(ship, 'battery')
      return picked ? picked.index : autoChoices.battery(ship)
    },
    mainReactor(ship) {
      return take(ship, 'main-reactor')?.groupId ?? autoChoices.mainReactor(ship)
    },
  }
  return provider
}

/**
 * A provider installed for the length of one call, ahead of anything the game
 * state carries. The probe uses it to ask the resolution what it wants to know
 * without touching the battle.
 */
let override: DamageChoices | null = null

export function withChoices<T>(provider: DamageChoices, run: () => T): T {
  const previous = override
  override = provider
  try {
    return run()
  } finally {
    override = previous
  }
}

/** The provider a resolution should use: the probe's, or the game's script. */
export function currentChoices(script: DamageChoice[]): DamageChoices {
  return override ?? scriptedChoices(script)
}

/** Thrown to stop a probe the instant it finds a question nobody has answered. */
const ASKED = Symbol('damage-decision')

/**
 * Ask a resolution what it wants to know, without letting it happen.
 *
 * `run` is handed a throwaway copy of the game — the engine is deterministic,
 * so the copy draws exactly the cards the real one will — and stops at the
 * first decision the script does not already answer. Null means the script is
 * complete and the action can be dispatched for real.
 */
export function probeDecision(script: DamageChoice[], run: () => void): DamageDecision | null {
  let asked: DamageDecision | null = null
  const provider = scriptedChoices([...script], (decision) => {
    asked = decision
    throw ASKED
  })
  try {
    withChoices(provider, run)
  } catch (error) {
    if (error !== ASKED) throw error
  }
  return asked
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
  /**
   * Every ship in the battle, so an exploding reactor can reach its neighbours
   * (E11.3.2). Omit to suppress explosion splash entirely.
   */
  ships?: readonly ShipState[]
  /** Formations, which share explosion damage on the aft shield (E11.3.4). */
  formations?: readonly Formation[]
  /**
   * A standing condition that puts a ship's shields out of action whatever the
   * source of the damage — a running cloak (H6.4.1). Distinct from a volley's
   * own `shieldsInoperative`, which describes the shot rather than the ship,
   * and so never reaches damage that skips the firing solution.
   */
  shieldsBypassed?: (ship: ShipState) => boolean
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

/**
 * Scout sensors are marked off by a Special System hit, and a Sensor Hit may be
 * taken on them instead of the normal sensors at the captain's choice (H3.1.1).
 * A competent defender keeps whichever it has more of.
 */
function scoutSoaksHit(ship: ShipState, hit: DamageHit): boolean {
  if (!scoutSensorAvailable(ship)) return false
  if (hit === 'special-system') return true
  if (hit !== 'sensors') return false
  return scoutSensorsIntact(ship) > undamagedSystemBoxes(ship, 'SENS')
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
  if (SYSTEM_FOR_HIT[hit]) {
    if (scoutSoaksHit(ship, hit)) return true
    return systemTargetFor(ship, hit) !== null
  }

  switch (hit) {
    case 'shield-generator':
      return shieldGeneratorRating(ship) > 0
    case 'shield-power-loss':
      return SHIELD_SIDES.some((s) => blueShieldRemaining(ship, s) > 0)
    case 'any-weapon':
    case 'heavy-weapon':
      // Availability is a legality question, never a decision: asking the
      // live provider here would consume a scripted answer — and then the
      // real pick below would consume a second one, for one card.
      return autoChoices.weaponMount(ship, { heavyOnly: hit === 'heavy-weapon' }) !== null
    case 'facing-weapon':
      return autoChoices.weaponMount(ship, { facingArcs: ctx.attackerArcs }) !== null
    case 'weapon-power-loss':
      return autoChoices.weaponToDischarge(ship) !== null
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
    // H3.1.1: scout sensors take Special System hits, and may take Sensor Hits.
    if (scoutSoaksHit(ship, hit) && damageScoutSensor(ship)) {
      ctx.log(`${ship.name}: ${HIT_LABELS[hit]} (scout sensor)`)
      return { extraCards: 0 }
    }
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
      decelerateFromDamage(ship, ctx)
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
  /** Nebula or gas cloud: blue and green shield boxes are ignored (K4.2.1). */
  shieldsInoperative?: boolean
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
  const excessBefore = ship.excessStructureDamage

  const outcome: VolleyOutcome = {
    greenAbsorbed: 0,
    blueAbsorbed: 0,
    armorAbsorbed: 0,
    internal: 0,
    leakCards: volley.leak,
    structureFromSpecial: 0,
  }

  // Derelicts and lowered shields provide no protection (E11.2.5, G1.1.5), and
  // neither do blue or green boxes inside a nebula or gas cloud (K4.2.1). The
  // context's own veto covers a condition of the ship rather than of the
  // volley — a running cloak (H6.4.1) — so it holds for damage that never went
  // through a firing solution: terrain, a neighbour's reactor, anything.
  const shieldsWork =
    !ship.derelict &&
    !ship.shieldsDown[side] &&
    !volley.shieldsInoperative &&
    !ctx.shieldsBypassed?.(ship)

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
  // E11.3.1: the explosion check is made once, after the volley resolves.
  explosionCheck(ship, ship.excessStructureDamage - excessBefore, ctx)
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
  /** E11.4–E11.6 — crews may be got off a dying ship, and are worth points. */
  abandonShip: boolean
  /** C4.2 — drive damage forces a slowdown that costs acceleration and stress. */
  decelerationFromDamage: boolean
}

/** Standard rules: a ship is removed the moment its last structure box is marked. */
export const STANDARD_DESTRUCTION: DestructionOptions = {
  derelicts: false,
  explosions: false,
  abandonShip: false,
  decelerationFromDamage: false,
}

let destructionOptions: DestructionOptions = STANDARD_DESTRUCTION

export function setDestructionOptions(options: DestructionOptions): void {
  destructionOptions = options
}

/**
 * Charge an involuntary slowdown to the round's acceleration track (C4.2.1).
 *
 * The points go on the same /ROUND line voluntary acceleration fills, which is
 * what makes the rule bite: `accelerationStress` already turns everything past
 * the green circles into stress at the Stress Check, so a forced deceleration
 * competes with whatever the captain has already spent this round.
 *
 * The rulebook's example is the test. A ship at speed 6 with two green circles
 * takes three drive hits, dropping its top speed to 2: it decelerates 4, two
 * of those circles are green, and it suffers 2 stress. One more hit the same
 * round drops the top speed to 1 — measured from the original speed 6, so the
 * total deceleration is 5, and the total stress 3.
 */
function chargeDeceleration(
  ship: ShipState,
  points: number,
  ctx: DamageContext,
  why: string,
): void {
  if (!destructionOptions.decelerationFromDamage || points <= 0) return
  ship.accelUsedThisRound += points
  const beyond = Math.max(0, ship.accelUsedThisRound - ship.form.sublight.safeAccelPerRound)
  ctx.log(
    `${ship.name} decelerates ${points} involuntarily ${why} (C4.2.1)` +
      (beyond > 0 ? ` — ${beyond} point(s) past its safe rate, for stress at the check (C4.2.2).` : '.'),
  )
}

/**
 * A drive hit that leaves the ship travelling faster than it now can (C4.2.1).
 * The slowdown is immediate and not optional; the captain's ACC/DEC power buys
 * nothing here, because the ship "will slow down anyway".
 */
function decelerateFromDamage(ship: ShipState, ctx: DamageContext): void {
  if (!destructionOptions.decelerationFromDamage) return
  const hits = ship.systemDamage['__sublight'] ?? 0
  const table = ship.form.sublight.dmgTopSpeed
  const top = hits === 0 ? ship.form.sublight.maxSpeed : (table[Math.min(hits, table.length) - 1] ?? 0)
  // C4.2.4: in reverse the ceiling is half the (already reduced) maximum.
  const ceiling = ship.speed < 0 ? Math.floor(top / 2) : top
  const drop = Math.abs(ship.speed) - ceiling
  if (drop <= 0) return

  ship.speed = Math.sign(ship.speed) * ceiling
  chargeDeceleration(ship, drop, ctx, `as its drive damage caps it at ${ceiling}`)
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
    // E11.2.4 sends a derelict to a standstill, and C4.2.3 makes it pay for
    // the drop like any other involuntary deceleration — which is how a ship
    // ends up tumbling out of control and going up.
    chargeDeceleration(ship, Math.abs(ship.speed), ctx, 'coming to a stop as a derelict')
    ship.speed = 0
    ctx.log(`${ship.name} is a derelict.`)
  }
  // E11.2.3: excess damage equal to the size class breaks the ship apart.
  if (ship.excessStructureDamage >= ship.form.sizeClass) {
    ship.destroyed = true
    ctx.log(`${ship.name} comes apart from excess structural damage.`)
  }
}

// ---------------------------------------------------------------------------
// Ship explosions (E11.3, optional)
// ---------------------------------------------------------------------------

/** Any ship within range 1 of an exploding ship is caught (E11.3.2). */
export const EXPLOSION_RANGE = 2

/**
 * Half a 1.5-inch counter. E11.3.4 calls units "stacked" when their centre
 * point overlaps any part of the exploding ship's counter — formation members
 * share a counter outright, so they always qualify.
 */
const COUNTER_RADIUS = 0.75

/**
 * Explosion check (E11.3.1): one red die per point of excess structure damage
 * suffered in the volley just resolved. Any `S` blows the main reactor.
 *
 * `chain` carries the ships whose explosions are already being resolved, so a
 * blast that destroys a neighbour cannot recurse back into itself.
 */
export function explosionCheck(
  ship: ShipState,
  excessSustained: number,
  ctx: DamageContext,
  chain: Set<string> = new Set(),
): boolean {
  if (!destructionOptions.explosions) return false
  if (excessSustained <= 0 || chain.has(ship.id)) return false

  const { rolls, success } = rollForSpecial(excessSustained, ctx.rng)
  ctx.log(
    `${ship.name}: explosion check on ${excessSustained} excess damage — ${rolls
      .map((r) => r.face)
      .join(' ')}`,
  )
  if (!success) return false

  ship.destroyed = true
  ctx.log(`${ship.name}'s main reactor explodes.`)
  resolveExplosionDamage(ship, ctx, new Set(chain).add(ship.id))
  return true
}

/**
 * Explosion damage (E11.3.3): every ship within range 1 rolls one blue die per
 * point of the exploding ship's size class and takes the total on the shield
 * facing the blast — or on its aft shield if it was stacked with it (E11.3.4),
 * which is what makes flying in formation a gamble (C5).
 */
export function resolveExplosionDamage(
  exploding: ShipState,
  ctx: DamageContext,
  chain: Set<string> = new Set([exploding.id]),
): void {
  const ships = ctx.ships
  if (!ships) return

  const formation = ctx.formations ? formationOf(ctx.formations, exploding.id) : null

  for (const victim of ships) {
    if (victim.id === exploding.id || victim.destroyed || victim.disengaged) continue
    const gap = distance(exploding.placement.position, victim.placement.position)
    if (gap >= EXPLOSION_RANGE) continue

    const dice = new Array(exploding.form.sizeClass).fill('blue' as const)
    const rolls = rollDice(dice, ctx.rng)
    const total = rolls.reduce((sum, r) => sum + (r.face === 'S' ? 0 : FACE_DAMAGE[r.face]), 0)
    if (total === 0) continue

    const stacked =
      gap <= COUNTER_RADIUS ||
      (formation !== null && formationOf(ctx.formations!, victim.id)?.id === formation.id)
    const side = stacked
      ? 'A'
      : shieldsFacing(exploding.placement.position, victim.placement.position, victim.placement.heading)[0]

    ctx.log(
      `${victim.name} takes ${total} explosion damage on its ${side} shield` +
        (stacked ? ' (stacked with the wreck, E11.3.4)' : ''),
    )
    const excessBefore = victim.excessStructureDamage
    applyVolley(victim, { standard: total, leak: 0, structurePenetration: 0, side }, ctx)
    // A ship gutted by the blast may go up in turn (E11.3.1).
    explosionCheck(victim, victim.excessStructureDamage - excessBefore, ctx, chain)
  }
}
