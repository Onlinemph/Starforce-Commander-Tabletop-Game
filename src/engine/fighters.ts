import { rollD6, rollsUnder, type Rng } from './dice'
import { distance, translate } from './geometry'
import { undamagedSystemBoxes, type ShipState } from './shipState'
import { smallTargetDamage, type SmallTargetVolley } from './smallCraft'
import type { DieFace, Point } from './types'

/**
 * Fighters (FIGHTERS AND SMALL CRAFT — NOTES AND OUTLINE, Apr 2026).
 *
 * Package A of the playtest options in `docs/fighter-options.html`, which is the
 * set of answers that keeps fighters inside the published rules wherever the
 * published rules already reach:
 *
 *  - **d6 for fighters, coloured dice for ships.** Dogfights, dodges and strike
 *    rolls are plain d6 roll-unders. A starship shooting at a flight is E12.4
 *    small-target fire and stays on the coloured dice.
 *  - **COA 1 for casualties.** Pool the volley, halve it if it is not point
 *    defense (E10.2.3, E12.4.4), divide by the fighter's Structure, remove that
 *    many. E12.4.2 already publishes the pooling: the firer is "not required to
 *    assign specific weapon mounts to a single small target; only the volley or
 *    flight is required".
 *  - **One strike per load.** The counter flips to BASIC after its first strike
 *    (Q4‑A), which is what the double-sided counter in the outline is for.
 *  - **A flight launches as one craft** for the cloak-detection roll of
 *    H6.15.4 (Q12‑A), so a cloaked carrier is not forbidden to operate.
 *  - **Jamming exactly as E10.2.2** — added to the actual range of any
 *    non-point-defense attack, which is a bracket shift, not a to-hit modifier.
 *  - **One flight out per LNCH box, one in per LNDG box**, from the V41
 *    builder's own pricing of those systems.
 *
 * The flight, not the fighter, is the counter on the map (E12.4.2). Its
 * position is the leader's, and everything is measured from and to it.
 */

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

export type FighterConfigKind = 'strike' | 'space-superiority' | 'basic'

export const CONFIG_LABELS: Record<FighterConfigKind, string> = {
  strike: 'STRIKE',
  'space-superiority': 'SPACE SUPERIORITY',
  basic: 'BASIC',
}

/** One loadout block — the lower half of a card. */
export interface FighterLoadout {
  kind: FighterConfigKind
  /** Dogfight rating, hits on a d6 of this or less. 0 is Unarmed. */
  dfr: number
  /** Dodge, saves a dogfight hit on a d6 of this or less. */
  dodge: number
  /** Strike: to-hit range against a starship. */
  strikeHit: number
  /** Strike: damage points per hit. */
  strikeDamage: number
  /** Loadouts that hang ordnance can cost speed and jamming (Starfury, Thunderbolt). */
  speed?: number
  jamming?: number
}

/** One card — the airframe block, plus every loadout printed for it. */
export interface FighterCard {
  id: string
  name: string
  /** Whose air force flies it — a StarForce faction, or the setting it came from. */
  faction: string
  /**
   * Not a StarForce design: the Apr 2026 outline's cards are all Babylon 5
   * craft, carried as a calibration set the way the cross-franchise hulls in
   * `tools/fan_designs.ts` are. Kept out of the default wing.
   */
  fan?: boolean
  /** Where the design comes from, in one line. */
  origin: string
  /** Inches per combat phase. */
  speed: number
  /** Added to the actual range of non-PD fire at this flight (E10.2.2). */
  jamming: number
  /** Damage points that destroy one fighter. */
  structure: number
  /** Information points the flight gathers, against a probe's 1 (J7.3.3). */
  sensor: number
  loadouts: FighterLoadout[]
}

export function loadoutOf(card: FighterCard, kind: FighterConfigKind): FighterLoadout | undefined {
  return card.loadouts.find((l) => l.kind === kind)
}

/** Speed and jamming after the loadout's overrides are applied. */
export function airframeSpeed(card: FighterCard, loadout: FighterLoadout | undefined): number {
  return loadout?.speed ?? card.speed
}

export function airframeJamming(card: FighterCard, loadout: FighterLoadout | undefined): number {
  return loadout?.jamming ?? card.jamming
}

// ---------------------------------------------------------------------------
// Flight state
// ---------------------------------------------------------------------------

/** Fighters in one flight, at most (outline: "groups of 1-6"). */
export const MAX_FLIGHT_SIZE = 6
/** Flights one carrier may put on the board at once (outline; four ID boxes per card). */
export const MAX_FLIGHTS_PER_SHIP = 4
/** Range a flight launches into, as J8.2.1 for shuttles. */
export const FLIGHT_RANGE = 1
/**
 * How close a flight must finish to come aboard.
 *
 * Shared with the AI's planner on purpose. Every refusal loop this code has
 * produced came from the planner and the engine measuring the same thing with
 * slightly different arithmetic — a flight exactly 2.0" out read as "in reach"
 * to one and "too far" to the other, so the AI offered the landing forever.
 * One predicate, one epsilon, both callers.
 */
export const RECOVERY_RANGE = FLIGHT_RANGE + 1

/**
 * How far a fighter shoots, as distinct from how far it flies.
 *
 * "The standard range of a fighter's weapons is range 2" — Fighters and Small
 * Craft outline, Apr 2026, under Dogfight Rating. A flight's threat is
 * therefore its speed *plus* two: it moves, then it shoots from where it
 * finished. This was speed for a while, which quietly gave every airframe twice
 * the reach it should have had, because movement was already a separate action.
 */
export const FIGHTER_WEAPON_RANGE = 2

export function withinWeaponRange(from: Point, target: Point): boolean {
  return distance(from, target) <= FIGHTER_WEAPON_RANGE + 1e-9
}

export function withinRecoveryRange(from: Point, ship: Point): boolean {
  return distance(from, ship) <= RECOVERY_RANGE + 1e-9
}

export interface Flight {
  id: string
  side: string
  /** The ship that launched it, and the one it lands back aboard. */
  motherId: string
  cardId: string
  /** The loaded side of the counter; `spent` flips it to BASIC (Q4‑A). */
  config: FighterConfigKind
  /** Ordnance expended — the counter is on its BASIC face. */
  spent: boolean
  /** Fighters still flying. */
  members: number
  /** The leader's position; movement is measured from here (outline). */
  position: Point
  /**
   * Damage soaked that has not yet added up to a whole fighter. COA 1 divides
   * pooled damage by Structure; the remainder stays on the flight rather than
   * evaporating between volleys, so two half-kills are a kill.
   */
  damage: number
  /** Moved this phase (J8.2.2, two flights at a time). */
  activated: boolean
  /** Fired its guns or its ordnance this phase. */
  attacked: boolean
  /** Aboard this ship, out of the fight and rearming (Hangar Bay Segment). */
  dockedTo?: string
}

export function flightDestroyed(flight: Flight): boolean {
  return flight.members <= 0
}

/** The loadout in force: the printed one, or BASIC once the ordnance is gone. */
export function currentConfig(flight: Flight): FighterConfigKind {
  return flight.spent ? 'basic' : flight.config
}

export function currentLoadout(flight: Flight, card: FighterCard): FighterLoadout | undefined {
  return loadoutOf(card, currentConfig(flight)) ?? loadoutOf(card, flight.config)
}

// ---------------------------------------------------------------------------
// Points (provisional)
// ---------------------------------------------------------------------------

/*
 * What a flight costs in a fleet list.
 *
 * **Derived, not guessed.** `tools/fighter_points.ts` is the working: it prices
 * the ninety-three printed hulls in two currencies the rules themselves define
 * — damage points delivered per round, and damage points needed to remove the
 * unit — fits their printed point values against the product of those two, and
 * then prices a flight in the same currencies. Nothing in it is tuned to how
 * fighters play; the only calibration is the printed roster's own prices. Run
 * that tool after any change here or to the cards, and paste its constants
 * back; `fighters.test.ts` checks the two agree.
 *
 * The fitted law is `points = 0.0516 · (damage per round × damage to destroy)^0.816`,
 * which reproduces the printed roster to a mean absolute error of 19.5% — a
 * hand-priced roster is not a formula, and that is about as close as a two-
 * parameter model gets to one.
 *
 * It lands where the one independent measurement we have already put it. The
 * ARK ROYAL's 47.3-point hull flying twenty-four fighters fought dead even with
 * a 100-point EXETER II across sixteen games, which makes the wing worth about
 * 53 points, or 13 a flight, against a fleet that brought no fighters of its
 * own. This model makes the same flights 9. The gap is inside the model's own
 * fit error, and the two were arrived at with nothing in common.
 *
 * **This is our answer to Q3, not Doyle's.** It is a defensible number rather
 * than a printed one, and the day a real price arrives it replaces all of this.
 */

/** Fitted to the printed roster by `tools/fighter_points.ts`. */
export const PRICE_SCALE = 0.051566
export const PRICE_EXPONENT = 0.816494
/** Share of the printed roster's fire that is point defense, and so ignores jamming. */
export const PD_SHARE = 0.714275
/** Damage points a typical fighter costs a starship to shoot down. */
export const TYPICAL_FIGHTER_SOAK = 5.684101
/**
 * What a battery keeps of its expected damage when the target's jamming is
 * added to the range (E10.2.2), measured across every printed firing chart.
 * Index is the jamming value.
 */
export const JAMMING_PENALTY = [
  1.0, 0.9147, 0.8293, 0.7441, 0.6596, 0.5816, 0.5044, 0.4295, 0.3604, 0.2915, 0.2289, 0.1905,
  0.1565,
]

/** Combat phases in a round (A3.2). A flight acts in every one; a gun does not. */
const PHASES_PER_ROUND = 3
/** The roster's own middle Dodge, so DFR is priced against a typical opponent. */
const TYPICAL_DODGE = 3

/**
 * The share of a volley aimed at a flight that actually lands on it: point
 * defense whole (E12.4.3), everything else halved (E10.2.3, E12.4.4) and
 * pushed down the chart by jamming (E10.2.2).
 */
export function soakEfficiency(jamming: number): number {
  const penalty = JAMMING_PENALTY[Math.min(jamming, JAMMING_PENALTY.length - 1)] ?? 0.15
  return PD_SHARE + (1 - PD_SHARE) * 0.5 * penalty
}

/**
 * Damage a flight puts into starships in a round.
 *
 * One strike per load (Q4‑A), so a flight over a target runs its load once and
 * its guns for the other two phases of the round.
 */
export function flightDamagePerRound(
  card: FighterCard,
  kind: FighterConfigKind,
  members: number,
): number {
  const loaded = loadoutOf(card, kind)
  const basic = loadoutOf(card, 'basic') ?? loaded
  if (!loaded || !basic) return 0
  const run = (l: FighterLoadout) => members * (l.strikeHit / 6) * l.strikeDamage
  if (kind === 'basic') return run(basic) * PHASES_PER_ROUND
  return run(loaded) + run(basic) * (PHASES_PER_ROUND - 1)
}

/**
 * The dogfight, in the same damage currency as everything else: a kill is worth
 * the damage a starship would have had to land to do the same job. Pricing it
 * in *points* instead makes a fighter's value appear on both sides of its own
 * equation, and the iteration walks off rather than settling.
 */
export function flightDogfightPerRound(
  card: FighterCard,
  kind: FighterConfigKind,
  members: number,
): number {
  const l = loadoutOf(card, kind)
  if (!l) return 0
  const kills = members * (l.dfr / 6) * (1 - TYPICAL_DODGE / 6) * PHASES_PER_ROUND
  return kills * TYPICAL_FIGHTER_SOAK
}

/** Damage points a starship must land to wipe the flight, dodge included. */
export function flightDurability(
  card: FighterCard,
  kind: FighterConfigKind,
  members: number,
): number {
  const l = loadoutOf(card, kind)
  if (!l) return 0
  // F1.4.3 keeps the dodge away from point defense, so it is folded in at half
  // weight: only some of the fire aimed at a flight comes from other fighters.
  const dodge = 1 + 0.5 * (1 / (1 - l.dodge / 6) - 1)
  return ((members * card.structure) / soakEfficiency(airframeJamming(card, l))) * dodge
}

/**
 * What a flight costs in a fleet list.
 *
 * `role: 'all'` — the default — prices everything it can do, and is what a
 * fleet list has to pay: the dogfight term assumes an opponent who also brings
 * fighters. `role: 'strike'` prices the anti-ship role alone, which is what a
 * flight is worth against a fleet with no wing of its own, and is the figure
 * comparable to the ARK ROYAL measurement.
 */
export function flightPoints(
  card: FighterCard,
  kind: FighterConfigKind,
  members: number,
  role: 'all' | 'strike' = 'all',
): number {
  if (!loadoutOf(card, kind) || members < 1) return 0
  const damage =
    flightDamagePerRound(card, kind, members) +
    (role === 'all' ? flightDogfightPerRound(card, kind, members) : 0)
  const durability = flightDurability(card, kind, members)
  const scouting = role === 'all' ? card.sensor : 0
  return Math.round(PRICE_SCALE * (Math.max(0.1, damage) * durability) ** PRICE_EXPONENT + scouting)
}

/** One fighter's share of its flight's cost, for a part-strength counter. */
export function fighterPoints(
  card: FighterCard,
  loadout: FighterLoadout,
  members = MAX_FLIGHT_SIZE,
): number {
  return Math.round((flightPoints(card, loadout.kind, members) / members) * 10) / 10
}

// ---------------------------------------------------------------------------
// Carrier capacity, launching and recovery
// ---------------------------------------------------------------------------

/**
 * Flights a hangar holds. The V41 builder prices HNGR at a point a box and says
 * a hangar "contain[s] a full fighter unit (generally 2-12 craft)"; we read one
 * box as one flight, which is the reading that makes a six-box hangar a wing
 * rather than a fleet (Q6).
 */
export function hangarCapacity(ship: ShipState): number {
  return undamagedSystemBoxes(ship, 'HNGR')
}

/** Flights that may leave in one phase — one per undamaged LNCH box (Q5). */
export function launchRate(ship: ShipState): number {
  return undamagedSystemBoxes(ship, 'LNCH')
}

/**
 * Flights that may come home in one phase — one per undamaged LNDG box (Q5).
 *
 * E8.4.6 spells the landing bay **LNDG**; the V41 builder's sheet calls it
 * **LAND**. The published rulebook wins, and Q5 asks Doyle to confirm.
 */
export function recoveryRate(ship: ShipState): number {
  return undamagedSystemBoxes(ship, 'LNDG')
}

/** Why a flight may not launch, or `null` if it may. */
export function flightLaunchRefusal(
  ship: ShipState,
  flightsAirborne: number,
  launchedThisPhase: number,
  aboard: number,
): string | null {
  if (ship.destroyed || ship.derelict) return `${ship.name} cannot conduct flight operations.`
  if (hangarCapacity(ship) === 0) return `${ship.name} has no undamaged HNGR boxes (E8.4.6).`
  if (launchRate(ship) === 0) return `${ship.name} has no undamaged LNCH boxes (E8.4.6).`
  if (launchedThisPhase >= launchRate(ship)) {
    return `${ship.name} launches ${launchRate(ship)} flight(s) a phase, one per LNCH box.`
  }
  if (aboard < 1) return `${ship.name} has no flights left in the hangar.`
  if (flightsAirborne >= MAX_FLIGHTS_PER_SHIP) {
    return `${ship.name} may have ${MAX_FLIGHTS_PER_SHIP} flights out at once.`
  }
  return null
}

/** Where a flight forms up: the aft arc, an inch out, as J8.2.1. */
export function launchPositionFor(ship: ShipState): Point {
  return translate(ship.placement.position, (ship.placement.heading + 180) % 360, FLIGHT_RANGE)
}

/** Why a flight may not land aboard, or `null` if it may. */
export function flightRecoveryRefusal(
  flight: Flight,
  ship: ShipState,
  recoveredThisPhase: number,
  aboard: number,
): string | null {
  if (flight.side !== ship.side) return 'That ship is not friendly.'
  if (ship.destroyed || ship.derelict) return `${ship.name} cannot recover flights.`
  if (recoveryRate(ship) === 0) return `${ship.name} has no undamaged LNDG boxes (E8.4.6).`
  if (recoveredThisPhase >= recoveryRate(ship)) {
    return `${ship.name} recovers ${recoveryRate(ship)} flight(s) a phase, one per LNDG box.`
  }
  if (aboard >= hangarCapacity(ship)) {
    return `${ship.name}'s hangar holds ${hangarCapacity(ship)} flight(s).`
  }
  if (!withinRecoveryRange(flight.position, ship.placement.position)) {
    const range = distance(flight.position, ship.placement.position)
    return `The flight is ${range.toFixed(1)}" out; it must finish within ${RECOVERY_RANGE}".`
  }
  return null
}

/**
 * Why a flight may not move where it was told to.
 *
 * Fighters have no facing — like shuttles under J8.2.3 they move "in any
 * direction, regardless of facing" — so the only limit is the airframe's speed
 * for the loadout it is carrying.
 */
export function flightMoveRefusal(flight: Flight, card: FighterCard, to: Point): string | null {
  if (flight.activated) return 'That flight has already activated this phase (J8.2.2).'
  if (flight.dockedTo) return 'That flight is in the hangar.'
  const speed = airframeSpeed(card, currentLoadout(flight, card))
  const travelled = distance(flight.position, to)
  if (travelled > speed + 1e-9) {
    return `That is ${travelled.toFixed(1)}"; a ${card.name} moves ${speed}" a phase.`
  }
  return null
}

// ---------------------------------------------------------------------------
// Dogfighting (d6)
// ---------------------------------------------------------------------------

export interface DogfightResult {
  /** One entry per attacking fighter, in order. */
  rolls: Array<{ hit: number; dodged: number | null }>
  hits: number
  dodged: number
  kills: number
}

/**
 * One flight shoots at another.
 *
 * Every surviving fighter in the attacking flight rolls a d6 and hits on its
 * DFR or less; each hit is answered by a dodge roll from the target, which
 * saves on its Dodge or less. Every hit that is not dodged kills one fighter
 * outright — Structure is what a *starship's* guns have to chew through
 * (Q19), not what another fighter's cannon does.
 *
 * The outline's own playtest is the check on this: six fighters at DFR 1‑3
 * against a dodge of 1‑2 average 3 hits, a third of them dodged, so 2 kills a
 * phase — and the playtest recorded 2, 4 and 5 kills across three phases.
 */
export function dogfight(
  attacker: { members: number; dfr: number },
  defender: { members: number; dodge: number },
  rng: Rng,
): DogfightResult {
  const rolls: DogfightResult['rolls'] = []
  let hits = 0
  let dodged = 0
  let kills = 0
  for (let i = 0; i < attacker.members; i++) {
    const hit = rollD6(rng)
    if (hit > attacker.dfr || attacker.dfr <= 0) {
      rolls.push({ hit, dodged: null })
      continue
    }
    hits += 1
    // Nothing left to kill; the shot is still rolled and still misses nothing.
    if (kills >= defender.members) {
      rolls.push({ hit, dodged: null })
      continue
    }
    const save = rollD6(rng)
    rolls.push({ hit, dodged: save })
    if (save <= defender.dodge) dodged += 1
    else kills += 1
  }
  return { rolls, hits, dodged, kills }
}

// ---------------------------------------------------------------------------
// Striking a starship (d6)
// ---------------------------------------------------------------------------

export interface StrikeResult {
  rolls: number[]
  hits: number
  damage: number
}

/**
 * A flight attacks a starship: one d6 per fighter, hitting on the Strike range
 * printed on the card, each hit doing the card's damage.
 *
 * The ship gets its point-defense answer first — E12.3.4 already publishes that
 * ordering, and the sequence of play gives it, since offensive fire is resolved
 * in the Combat Segment and flights act in Flight Operations after it.
 */
export function strike(
  flight: { members: number },
  loadout: { strikeHit: number; strikeDamage: number },
  rng: Rng,
): StrikeResult {
  const rolls: number[] = []
  let hits = 0
  for (let i = 0; i < flight.members; i++) {
    const roll = rollD6(rng)
    rolls.push(roll)
    if (loadout.strikeHit > 0 && roll <= loadout.strikeHit) hits += 1
  }
  return { rolls, hits, damage: hits * loadout.strikeDamage }
}

/**
 * Whether an attack expends the load and flips the counter to BASIC.
 *
 * "When ordinance is expended, the counter is flipped" — one strike per load
 * (Q4‑A). Dogfighting is guns and never flips anything; BASIC is the reverse
 * face of the card, not a fourth loadout.
 */
export function strikeExpendsLoad(config: FighterConfigKind): boolean {
  return config !== 'basic'
}

// ---------------------------------------------------------------------------
// A starship shooting at a flight (E12.4, COA 1)
// ---------------------------------------------------------------------------

export interface FlightCasualties {
  volley: SmallTargetVolley
  /** Fighters removed by this volley. */
  killed: number
  /** Damage carried on the flight afterwards, short of the next kill. */
  carried: number
}

/**
 * COA 1 — pool the volley against the flight, then divide by Structure.
 *
 * `smallTargetDamage` already does the first half: point defense applies its
 * damage in full (E12.4.3) and everything else goes through Degraded Fire
 * Control, halved and rounded down (E12.4.4, E10.2.3). What is added here is
 * the division: pooled damage over the *fighter's* Structure, which is why the
 * Frazi at 5 soaks thirty points across a flight of six and the Sentri at 3
 * soaks eighteen (Q19).
 */
export function flightCasualties(
  faces: DieFace[],
  specialDamage: number,
  pointDefense: boolean,
  flight: Flight,
  card: FighterCard,
  automatic = false,
): FlightCasualties {
  const volley = smallTargetDamage(faces, specialDamage, pointDefense, automatic)
  const pool = flight.damage + volley.damage
  const killed = Math.min(flight.members, Math.floor(pool / card.structure))
  return { volley, killed, carried: pool - killed * card.structure }
}

/**
 * Jamming added to the range of a volley fired at this flight (E10.2.2).
 *
 * Point defense weapons ignore it — E12.4.3 has them firing normally — which is
 * exactly what makes PD mounts the anti-fighter answer rather than the main
 * battery (F1.20).
 */
export function jammingAgainstFlight(
  card: FighterCard,
  loadout: FighterLoadout | undefined,
  pointDefense: boolean,
): number {
  return pointDefense ? 0 : airframeJamming(card, loadout)
}

// ---------------------------------------------------------------------------
// Dodge against point defense (F1.4.3)
// ---------------------------------------------------------------------------

/**
 * "Small craft MAY NOT use their evasion roll when fired at by point defense
 * weapons" (F1.4.3). The Dodge roll is an evasion roll wearing another name, so
 * it carries over — but under COA 1 a starship's fire is pooled damage with no
 * to-hit step at all, so there is no dodge roll to forbid in the first place.
 * Kept as a named rule so the day COA 2 is tried, the exception is already here.
 */
export function dodgeAllowed(againstPointDefense: boolean): boolean {
  return !againstPointDefense
}

/** A dodge roll, for the paths that do take one. */
export function dodges(dodge: number, rng: Rng): boolean {
  return rollsUnder(dodge, rng)
}
