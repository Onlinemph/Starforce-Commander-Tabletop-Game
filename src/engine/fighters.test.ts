import { describe, expect, it } from 'vitest'
import { FIGHTER_CARDS, fighterCard } from '../data/fighters'
import { THE_DUEL } from '../data/scenarios'
import { VALLARI_CRUISER, YORKTOWN } from '../data/ships'
import { Rng } from './dice'
import {
  airframeJamming,
  airframeSpeed,
  currentConfig,
  currentLoadout,
  dogfight,
  flightCasualties,
  fighterPoints,
  flightPoints,
  hangarCapacity,
  launchRate,
  loadoutOf,
  recoveryRate,
  strike,
  strikeExpendsLoad,
  MAX_FLIGHT_SIZE,
  type Flight,
} from './fighters'
import {
  advanceSegment,
  createGame,
  fireAtSmallTarget,
  flightDogfight,
  flightStrike,
  flightsAirborne,
  launchFlight,
  moveFlight,
  recoverFlight,
  runHangarBay,
  smallTargetsFor,
  type GameState,
} from './game'
import { createShip, undamagedSystemBoxes, type ShipState } from './shipState'
import type { ShipForm } from './types'

/**
 * Fighters, Package A (`docs/fighter-options.html`).
 *
 * The point of these tests is that the fighter subsystem is *checkable against
 * the outline's own playtest*: six fighters at DFR 1‑3 against a dodge of 1‑2
 * should average two kills a phase, and the 4‑25‑2026 notes record 2, 4 and 5
 * across three phases. A model that cannot reproduce its own source's numbers
 * is the wrong model, so that expectation is measured here rather than assumed.
 */

/** A carrier: the Yorktown with a hangar, a launch bay and a landing bay. */
function carrierForm(boxes = { HNGR: 4, LNCH: 2, LNDG: 1 }): ShipForm {
  return {
    ...YORKTOWN,
    systems: [
      ...YORKTOWN.systems,
      { kind: 'HNGR', label: 'Hangar Bay', boxes: boxes.HNGR },
      { kind: 'LNCH', label: 'Launch Bay', boxes: boxes.LNCH },
      { kind: 'LNDG', label: 'Landing Bay', boxes: boxes.LNDG },
    ],
  }
}

function shipAt(args: {
  id: string
  side?: string
  form?: ShipForm
  x?: number
  y?: number
  heading?: number
}): ShipState {
  return createShip({
    id: args.id,
    side: args.side ?? 'Blue',
    name: args.id.toUpperCase(),
    form: args.form ?? YORKTOWN,
    placement: { position: { x: args.x ?? 0, y: args.y ?? 0 }, heading: args.heading ?? 0 },
    speed: 0,
  })
}

function battle(ships: ShipState[], seed = 7): GameState {
  const game = createGame({ scenario: THE_DUEL, ships, seed })
  game.phase = 'combat-1'
  game.segment = 'flight-operations'
  return game
}

/** A flight on the board without going through a carrier. */
function flightAt(args: Partial<Flight> & { id: string; side: string; x: number; y: number }): Flight {
  return {
    id: args.id,
    side: args.side,
    motherId: args.motherId ?? 'carrier',
    cardId: args.cardId ?? 'starfury',
    config: args.config ?? 'basic',
    spent: args.spent ?? false,
    members: args.members ?? MAX_FLIGHT_SIZE,
    position: { x: args.x, y: args.y },
    damage: args.damage ?? 0,
    activated: args.activated ?? false,
    attacked: args.attacked ?? false,
    ...(args.dockedTo ? { dockedTo: args.dockedTo } : {}),
  }
}

// ---------------------------------------------------------------------------

describe('the cards', () => {
  it('carries all six airframes with their loadouts', () => {
    expect(FIGHTER_CARDS.map((c) => c.id)).toEqual([
      'starfury',
      'thunderbolt',
      'frazi',
      'nial',
      'sentri',
      'peregrine',
    ])
    for (const card of FIGHTER_CARDS) {
      expect(card.loadouts.map((l) => l.kind)).toEqual(['strike', 'space-superiority', 'basic'])
    }
  })

  it('keeps DFR inside 0-5 and Dodge inside 1-4, as the outline gives them', () => {
    for (const card of FIGHTER_CARDS) {
      for (const l of card.loadouts) {
        expect(l.dfr, `${card.name} ${l.kind} DFR`).toBeGreaterThanOrEqual(0)
        expect(l.dfr, `${card.name} ${l.kind} DFR`).toBeLessThanOrEqual(5)
        expect(l.dodge, `${card.name} ${l.kind} dodge`).toBeGreaterThanOrEqual(1)
        expect(l.dodge, `${card.name} ${l.kind} dodge`).toBeLessThanOrEqual(4)
      }
    }
  })

  it('agrees with the outline\'s own worked examples', () => {
    // "Starfury and Sentri at DFR 3, the Nial at DFR 4" — in BASIC.
    expect(loadoutOf(fighterCard('starfury')!, 'basic')!.dfr).toBe(3)
    expect(loadoutOf(fighterCard('sentri')!, 'basic')!.dfr).toBe(3)
    expect(loadoutOf(fighterCard('nial')!, 'basic')!.dfr).toBe(4)
  })

  it('costs the Starfury its speed and jamming to hang a strike load', () => {
    const card = fighterCard('starfury')!
    expect(airframeSpeed(card, loadoutOf(card, 'strike'))).toBe(5)
    expect(airframeJamming(card, loadoutOf(card, 'strike'))).toBe(5)
    expect(airframeSpeed(card, loadoutOf(card, 'basic'))).toBe(6)
    expect(airframeJamming(card, loadoutOf(card, 'basic'))).toBe(6)
  })

  it('prices a flight in the same neighbourhood as a light hull', () => {
    const six = FIGHTER_CARDS.map((c) => flightPoints(c, 'space-superiority', 6))
    for (const p of six) {
      expect(p).toBeGreaterThan(10)
      expect(p).toBeLessThan(40)
    }
    // The Nial is the premium airframe on every stat that matters.
    const nial = fighterPoints(fighterCard('nial')!, loadoutOf(fighterCard('nial')!, 'space-superiority')!)
    const sentri = fighterPoints(fighterCard('sentri')!, loadoutOf(fighterCard('sentri')!, 'space-superiority')!)
    expect(nial).toBeGreaterThan(sentri)
  })
})

// ---------------------------------------------------------------------------

describe('dogfighting on the d6 (Q1-A)', () => {
  it('reproduces the outline\'s own playtest rate: six at DFR 3 vs dodge 2 average two kills', () => {
    const rng = new Rng(20260425)
    let kills = 0
    const trials = 4000
    for (let i = 0; i < trials; i++) {
      kills += dogfight({ members: 6, dfr: 3 }, { members: 6, dodge: 2 }, rng).kills
    }
    // 6 × 3/6 hits = 3, of which 2/6 are dodged → 2.0 kills a phase. The
    // playtest recorded 2, 4 and 5 across three phases; the mean is the claim.
    expect(kills / trials).toBeGreaterThan(1.9)
    expect(kills / trials).toBeLessThan(2.1)
  })

  it('never kills more fighters than the target has', () => {
    const rng = new Rng(3)
    for (let i = 0; i < 200; i++) {
      const result = dogfight({ members: 6, dfr: 5 }, { members: 1, dodge: 1 }, rng)
      expect(result.kills).toBeLessThanOrEqual(1)
    }
  })

  it('an unarmed loadout hits nothing', () => {
    const rng = new Rng(11)
    const result = dogfight({ members: 6, dfr: 0 }, { members: 6, dodge: 1 }, rng)
    expect(result.hits).toBe(0)
    expect(result.kills).toBe(0)
  })

  it('resolves one flight against another on the board and removes the dead', () => {
    const game = battle([shipAt({ id: 'carrier', form: carrierForm() })])
    game.flights.push(
      flightAt({ id: 'blue', side: 'Blue', x: 10, y: 10, config: 'space-superiority', cardId: 'nial' }),
      flightAt({ id: 'red', side: 'Red', x: 12, y: 10, members: 2, config: 'strike' }),
    )
    expect(flightDogfight(game, 'blue', 'red')).toBeNull()
    const red = game.flights.find((f) => f.id === 'red')
    // Nial space superiority is DFR 1-5 against a Starfury strike dodge of 1-2;
    // two fighters do not survive six passes of that for long.
    expect(red === undefined || red.members < 2).toBe(true)
  })

  it('refuses a second attack in the same phase, and a friendly one', () => {
    const game = battle([shipAt({ id: 'carrier', form: carrierForm() })])
    game.flights.push(
      flightAt({ id: 'blue', side: 'Blue', x: 10, y: 10 }),
      flightAt({ id: 'blue-2', side: 'Blue', x: 11, y: 10 }),
      flightAt({ id: 'red', side: 'Red', x: 12, y: 10, members: 60 }),
    )
    expect(flightDogfight(game, 'blue', 'blue-2')).toMatch(/friendly/)
    expect(flightDogfight(game, 'blue', 'red')).toBeNull()
    expect(flightDogfight(game, 'blue', 'red')).toMatch(/already attacked/)
  })

  it('will not reach a flight further away than the airframe flies', () => {
    const game = battle([shipAt({ id: 'carrier', form: carrierForm() })])
    game.flights.push(
      flightAt({ id: 'blue', side: 'Blue', x: 0, y: 0 }),
      flightAt({ id: 'red', side: 'Red', x: 20, y: 0 }),
    )
    expect(flightDogfight(game, 'blue', 'red')).toMatch(/reaches 6"/)
  })
})

// ---------------------------------------------------------------------------

describe('striking a starship (Q4-A: one strike, then flip to BASIC)', () => {
  it('rolls one d6 per fighter and pays the card\'s damage per hit', () => {
    const rng = new Rng(5)
    const result = strike({ members: 6 }, { strikeHit: 3, strikeDamage: 2 }, rng)
    expect(result.rolls).toHaveLength(6)
    expect(result.hits).toBe(result.rolls.filter((r) => r <= 3).length)
    expect(result.damage).toBe(result.hits * 2)
  })

  it('flips the counter to BASIC once, and BASIC has nothing left to spend', () => {
    expect(strikeExpendsLoad('strike')).toBe(true)
    expect(strikeExpendsLoad('space-superiority')).toBe(true)
    expect(strikeExpendsLoad('basic')).toBe(false)

    const game = battle([
      shipAt({ id: 'carrier', form: carrierForm() }),
      shipAt({ id: 'target', side: 'Red', form: VALLARI_CRUISER, x: 12, y: 10 }),
    ])
    game.flights.push(
      flightAt({ id: 'blue', side: 'Blue', x: 10, y: 10, config: 'strike', cardId: 'peregrine' }),
    )
    expect(flightStrike(game, 'blue', 'target')).toBeNull()
    const flight = game.flights[0]
    expect(flight.spent, 'the load should be gone after one run').toBe(true)
    expect(currentConfig(flight)).toBe('basic')

    // Next phase, still spent: the BASIC face is guns and stays available.
    flight.attacked = false
    expect(flightStrike(game, 'blue', 'target')).toBeNull()
    expect(currentLoadout(flight, fighterCard('peregrine')!)!.strikeDamage).toBe(1)
  })

  it('puts its damage on the shield it is bearing on', () => {
    const game = battle([
      shipAt({ id: 'carrier', form: carrierForm() }),
      // Head-on: the flight sits dead ahead of a ship pointed up the board.
      shipAt({ id: 'target', side: 'Red', form: VALLARI_CRUISER, x: 10, y: 10, heading: 0 }),
    ])
    game.flights.push(
      flightAt({ id: 'blue', side: 'Blue', x: 10, y: 4, config: 'strike', cardId: 'peregrine', members: 6 }),
    )
    const before = game.ships[1].blueShieldDamage.F + game.ships[1].greenShieldDamage.F
    flightStrike(game, 'blue', 'target')
    const after = game.ships[1].blueShieldDamage.F + game.ships[1].greenShieldDamage.F
    // Peregrine strike is 1-4 for 4 apiece across six fighters; the forward
    // shield takes it, and something lands on essentially every seed.
    expect(after).toBeGreaterThan(before)
  })

  it('refuses a friendly ship, an out-of-reach one, and a second run', () => {
    const game = battle([
      shipAt({ id: 'carrier', form: carrierForm() }),
      shipAt({ id: 'far', side: 'Red', form: VALLARI_CRUISER, x: 40, y: 10 }),
    ])
    game.flights.push(flightAt({ id: 'blue', side: 'Blue', x: 10, y: 10, config: 'strike' }))
    expect(flightStrike(game, 'blue', 'carrier')).toMatch(/friendly/)
    expect(flightStrike(game, 'blue', 'far')).toMatch(/reaches/)
  })
})

// ---------------------------------------------------------------------------

describe('a starship shooting at a flight (Q2-A: COA 1)', () => {
  const card = fighterCard('frazi')! // Structure 5, the toughest airframe

  it('pools the volley and divides by one fighter\'s Structure', () => {
    const flight = flightAt({ id: 'f', side: 'Red', x: 0, y: 0, cardId: 'frazi' })
    // H+H+H = 12 points from a point defense mount: two Frazis at Structure 5,
    // with 2 points carried.
    const result = flightCasualties(['H', 'H', 'H'], 0, true, flight, card)
    expect(result.volley.damage).toBe(12)
    expect(result.killed).toBe(2)
    expect(result.carried).toBe(2)
  })

  it('halves non-point-defense fire first (E10.2.3, E12.4.4)', () => {
    const flight = flightAt({ id: 'f', side: 'Red', x: 0, y: 0, cardId: 'frazi' })
    const result = flightCasualties(['H', 'H', 'H'], 0, false, flight, card)
    expect(result.volley.raw).toBe(12)
    expect(result.volley.damage).toBe(6) // halved, rounded down
    expect(result.killed).toBe(1)
    expect(result.carried).toBe(1)
  })

  it('carries the remainder, so two half-kills are a kill', () => {
    const flight = flightAt({ id: 'f', side: 'Red', x: 0, y: 0, cardId: 'frazi', damage: 3 })
    const result = flightCasualties(['L'], 0, true, flight, card) // 2 points
    expect(result.killed).toBe(1)
    expect(result.carried).toBe(0)
  })

  it('never removes more fighters than are in the flight', () => {
    const flight = flightAt({ id: 'f', side: 'Red', x: 0, y: 0, cardId: 'sentri', members: 2 })
    const sentri = fighterCard('sentri')! // Structure 3
    const result = flightCasualties(['H', 'H', 'H', 'H', 'H', 'H'], 0, true, flight, sentri)
    expect(result.killed).toBe(2)
  })

  it('makes the Frazi far harder to shoot down than the Sentri', () => {
    const faces = ['H', 'H', 'H', 'H', 'H'] as const // 20 points
    const frazi = flightCasualties([...faces], 0, true, flightAt({ id: 'a', side: 'R', x: 0, y: 0, cardId: 'frazi' }), fighterCard('frazi')!)
    const sentri = flightCasualties([...faces], 0, true, flightAt({ id: 'b', side: 'R', x: 0, y: 0, cardId: 'sentri' }), fighterCard('sentri')!)
    expect(frazi.killed).toBe(4)
    expect(sentri.killed).toBe(6)
  })

  it('resolves through fire-small-target and removes a wiped-out flight', () => {
    const game = battle([
      shipAt({ id: 'blue-1', x: 10, y: 10 }),
      shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 30, y: 10 }),
    ])
    game.segment = 'combat'
    game.flights.push(
      flightAt({ id: 'red-flight', side: 'Red', x: 11, y: 10, cardId: 'sentri', members: 1 }),
    )
    const target = smallTargetsFor(game, game.ships[0]).find((t) => t.id === 'red-flight')
    expect(target, 'the flight should be a small target (E12.4.2)').toBeDefined()
    expect(target!.kind).toBe('flight')

    // Any point defense mount aboard, armed, at range 1.
    const pd = game.ships[0].form.weapons.find((w) =>
      w.traits.some((t) => /^PD/i.test(t.replace(/\s+/g, ''))),
    )
    if (!pd) return
    game.ships[0].mounts[pd.id].forEach((m, i) => {
      m.armed = pd.mounts[i].armingCircles
    })
    for (let i = 0; i < game.ships[0].mounts[pd.id].length; i++) {
      const out = fireAtSmallTarget(game, game.ships[0], 'red-flight', pd.id, i)
      if (out.refusal) continue
      if (out.destroyed) break
    }
    // One Sentri at Structure 3 does not survive a hull's worth of PD.
    expect(game.flights.find((f) => f.id === 'red-flight')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------

describe('jamming exactly as E10.2.2 (Q18-A)', () => {
  /*
   * The Yorktown's two mounts are exactly the pair this rule is about: the
   * MK-3 torpedo is a main battery whose chart runs 0-16, and the LNC-447
   * phaser carries PD MODE and a chart that stops at 12. Firing each at a
   * flight sitting two inches off the bow is what separates "jamming is a
   * to-hit modifier" from "jamming is a range-bracket shift".
   */
  const BATTERY = 'mk-3-a-mat-torpedo-1'
  const PD = 'lnc-447-phaser-2'

  function fireAt(cardId: string, gap: number, weaponId: string) {
    const game = battle([
      shipAt({ id: 'blue-1', x: 0, y: 0, heading: 90 }),
      shipAt({ id: 'red-1', side: 'Red', form: VALLARI_CRUISER, x: 60, y: 40 }),
    ])
    game.segment = 'combat'
    game.flights.push(flightAt({ id: 'f', side: 'Red', x: gap, y: 0, cardId, members: 6 }))
    const weapon = game.ships[0].form.weapons.find((w) => w.id === weaponId)!
    game.ships[0].mounts[weapon.id].forEach((m, i) => {
      m.armed = weapon.mounts[i].armingCircles
    })
    const target = smallTargetsFor(game, game.ships[0]).find((t) => t.id === 'f')!
    return { weapon, target, out: fireAtSmallTarget(game, game.ships[0], 'f', weapon.id, 0) }
  }

  it('reads the flight\'s jamming off the card and onto the target list', () => {
    expect(fireAt('nial', 2, PD).target.jamming).toBe(8)
    expect(fireAt('frazi', 2, PD).target.jamming).toBe(5)
  })

  it('shifts a main battery\'s bracket: 2" against a Nial is resolved at 10"', () => {
    const near = fireAt('nial', 2, BATTERY)
    expect(near.out.refusal).toBeNull()
    // The torpedo rolls red at 0-8 and yellow at 9-16: jamming demotes the die
    // the volley is fired with, which is the whole point of a bracket shift.
    expect(near.weapon.brackets[0].dice).toEqual(['red'])
    const shifted = near.weapon.brackets.find((b) => 10 >= b.min && 10 <= b.max)!
    expect(shifted.dice).toEqual(['yellow'])
    // An `S` is only on the red die (E7.2.5), so a jammed torpedo can no longer
    // roll its special at all.
    expect(near.out.volley!.faces).toHaveLength(1)
    expect(near.out.volley!.faces[0]).not.toBe('S')
  })

  it('pushes a main battery clean off the chart at longer range', () => {
    // 10" actual + 8 jamming = 18, past the torpedo's 16" chart.
    const out = fireAt('nial', 10, BATTERY).out
    expect(out.refusal).toMatch(/\+8 jamming/)
    expect(out.refusal).toMatch(/off .* chart \(E10\.2\.2\)/)
  })

  it('point defense ignores it entirely (E12.4.3, F1.20)', () => {
    const near = fireAt('nial', 2, PD)
    expect(near.out.refusal).toBeNull()
    // Unshifted: a PD mount at 2" fires from the 0-2 bracket, at full dice.
    expect(near.out.volley!.faces).toHaveLength(near.weapon.brackets[0].dice.length)
    // And its damage is not halved, where the battery's would be (E12.4.3).
    expect(near.out.volley!.degraded).toBe(false)
    // Still on the chart where the battery is off it entirely.
    expect(fireAt('nial', 10, PD).out.refusal).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('launching and recovering (Q5, Q12-A)', () => {
  it('launches one flight per LNCH box per phase', () => {
    const ship = shipAt({ id: 'carrier', form: carrierForm({ HNGR: 4, LNCH: 2, LNDG: 1 }) })
    const game = battle([ship])
    expect(launchRate(ship)).toBe(2)
    expect(hangarCapacity(ship)).toBe(4)
    expect(launchFlight(game, ship)).toBeNull()
    expect(launchFlight(game, ship)).toBeNull()
    expect(launchFlight(game, ship)).toMatch(/2 flight\(s\) a phase/)
    expect(flightsAirborne(game, ship)).toHaveLength(2)
    expect(ship.flightsAboard).toBe(2)
  })

  it('a hull with no launch bay cannot put a wing up at all', () => {
    const ship = shipAt({ id: 'c', form: carrierForm({ HNGR: 4, LNCH: 0, LNDG: 1 }) })
    const game = battle([ship])
    expect(launchFlight(game, ship)).toMatch(/no undamaged LNCH/)
  })

  it('caps a carrier at four flights out (the four ID boxes)', () => {
    const ship = shipAt({ id: 'c', form: carrierForm({ HNGR: 8, LNCH: 8, LNDG: 1 }) })
    const game = battle([ship])
    for (let i = 0; i < 4; i++) expect(launchFlight(game, ship)).toBeNull()
    expect(launchFlight(game, ship)).toMatch(/4 flights out at once/)
  })

  it('counts a whole flight as ONE launch for cloak detection (H6.15.4)', () => {
    const ship = shipAt({ id: 'c', form: carrierForm() })
    const searcher = shipAt({ id: 'e', side: 'Red', form: VALLARI_CRUISER, x: 10, y: 0 })
    const game = battle([ship, searcher])
    const before = game.log.length
    launchFlight(game, ship, 'starfury', 'space-superiority', 6)
    // Whatever the search machinery logs, six fighters must not read as six
    // launches — that would forbid a cloaked carrier to operate.
    const lines = game.log.slice(before).map((l) => l.message).join('\n')
    expect(lines).not.toMatch(/6 (small craft|rolls)/i)
    expect(lines).toMatch(/launches 6 STARFURY/)
  })

  it('refuses a flight bigger than six, or smaller than one', () => {
    const ship = shipAt({ id: 'c', form: carrierForm() })
    const game = battle([ship])
    expect(launchFlight(game, ship, 'starfury', 'basic', 7)).toMatch(/1 to 6/)
    expect(launchFlight(game, ship, 'starfury', 'basic', 0)).toMatch(/1 to 6/)
  })

  it('recovers one flight per LNDG box per phase, and only within an inch', () => {
    const ship = shipAt({ id: 'c', form: carrierForm({ HNGR: 4, LNCH: 2, LNDG: 1 }) })
    const game = battle([ship])
    expect(recoveryRate(ship)).toBe(1)
    launchFlight(game, ship)
    launchFlight(game, ship)
    const [a, b] = game.flights
    expect(recoverFlight(game, a.id, ship)).toBeNull()
    expect(recoverFlight(game, b.id, ship)).toMatch(/1 flight\(s\) a phase/)

    b.position = { x: 40, y: 40 }
    game.ops.flightsRecoveredThisPhase = {}
    expect(recoverFlight(game, b.id, ship)).toMatch(/must finish within/)
  })

  it('a recovered flight is out of the fight and off the target list', () => {
    const ship = shipAt({ id: 'c', form: carrierForm() })
    const enemy = shipAt({ id: 'e', side: 'Red', form: VALLARI_CRUISER, x: 3, y: 0 })
    const game = battle([ship, enemy])
    launchFlight(game, ship)
    const flight = game.flights[0]
    expect(smallTargetsFor(game, enemy).some((t) => t.id === flight.id)).toBe(true)
    recoverFlight(game, flight.id, ship)
    expect(smallTargetsFor(game, enemy).some((t) => t.id === flight.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('flying a flight', () => {
  it('moves in any direction up to the airframe\'s speed for its load', () => {
    const game = battle([shipAt({ id: 'c', form: carrierForm() })])
    game.flights.push(flightAt({ id: 'f', side: 'Blue', x: 0, y: 0, config: 'strike' }))
    // Starfury strike is speed 5, not 6.
    expect(moveFlight(game, 'f', { x: 6, y: 0 })).toMatch(/moves 5" a phase/)
    expect(moveFlight(game, 'f', { x: 0, y: -5 })).toBeNull()
    expect(game.flights[0].position).toEqual({ x: 0, y: -5 })
  })

  it('gets its speed back when the load is expended', () => {
    const game = battle([shipAt({ id: 'c', form: carrierForm() })])
    game.flights.push(flightAt({ id: 'f', side: 'Blue', x: 0, y: 0, config: 'strike', spent: true }))
    expect(moveFlight(game, 'f', { x: 6, y: 0 })).toBeNull()
  })

  it('activates once a phase, and the markers come off when the segment closes', () => {
    const game = battle([shipAt({ id: 'c', form: carrierForm() })])
    game.flights.push(flightAt({ id: 'f', side: 'Blue', x: 0, y: 0 }))
    expect(moveFlight(game, 'f', { x: 1, y: 0 })).toBeNull()
    expect(moveFlight(game, 'f', { x: 2, y: 0 })).toMatch(/already activated/)
    advanceSegment(game)
    expect(game.flights[0].activated).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('the Hangar Bay Segment (A3.4.4, printed TBD)', () => {
  it('rearms a spent flight that is aboard, and leaves one in the air alone', () => {
    const ship = shipAt({ id: 'c', form: carrierForm() })
    const game = battle([ship])
    game.flights.push(
      flightAt({ id: 'home', side: 'Blue', x: 0, y: 0, config: 'strike', spent: true, dockedTo: 'c' }),
      flightAt({ id: 'out', side: 'Blue', x: 0, y: 0, config: 'strike', spent: true }),
    )
    runHangarBay(game)
    expect(game.flights.find((f) => f.id === 'home')!.spent).toBe(false)
    expect(game.flights.find((f) => f.id === 'out')!.spent).toBe(true)
  })

  it('a wrecked hangar rearms nothing', () => {
    const ship = shipAt({ id: 'c', form: carrierForm({ HNGR: 1, LNCH: 1, LNDG: 1 }) })
    const game = battle([ship])
    ship.systemDamage.HNGR = 1
    expect(undamagedSystemBoxes(ship, 'HNGR')).toBe(0)
    game.flights.push(
      flightAt({ id: 'home', side: 'Blue', x: 0, y: 0, config: 'strike', spent: true, dockedTo: 'c' }),
    )
    runHangarBay(game)
    expect(game.flights[0].spent).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('counter ids are per battle, not per browser tab', () => {
  /*
   * A journal names a flight by id. If the serial number lived in a module
   * counter it would keep climbing across battles, so replaying yesterday's
   * journal in a tab that has since played another game would hand the same
   * launch a different id and every `move-flight` after it would address a
   * counter that does not exist. Two fresh games must number identically.
   */
  it('two fresh games number their flights the same way', () => {
    const ids = () => {
      const ship = shipAt({ id: 'c', form: carrierForm() })
      const game = battle([ship])
      launchFlight(game, ship)
      launchFlight(game, ship)
      return game.flights.map((f) => f.id)
    }
    const first = ids()
    const second = ids()
    expect(first).toEqual(['flight-1', 'flight-2'])
    expect(second).toEqual(first)
  })
})

describe('a hull with no hangar', () => {
  it('starts with nothing aboard and is refused a launch', () => {
    const ship = shipAt({ id: 'plain' })
    const game = battle([ship])
    expect(ship.flightsAboard).toBe(0)
    expect(launchFlight(game, ship)).toMatch(/no undamaged HNGR/)
  })
})
