/**
 * Fan designs: ships the printed roster does not carry, built as StarForce
 * hulls. Two kinds live here — imports from other settings, and original
 * ships built out of the printed factions' own technology.
 *
 * Run it with `npx vite-node tools/fan_designs.ts`. It prices every design,
 * reports anything the validator objects to, and writes the whole set to
 * `src/data/customShips.json` — the roster the site bundles, so a design
 * committed here reaches everyone who loads the page with nothing to import.
 * They carry their own faction flags, which keeps them under their own heading
 * in the fleet picker rather than mixed into the printed ships.
 *
 * The interesting part of importing a ship from another setting is not the
 * numbers, it is deciding what its technology *is* in this rule set. A ship
 * whose distinctive features are flavour text has not really been imported.
 * An original design has the opposite discipline: it may only use what its
 * faction already fields, or it is a different faction's ship wearing the
 * wrong flag.
 *
 * ---------------------------------------------------------------------------
 * EA HYPERION-class heavy cruiser (Babylon 5)
 *
 * Earth Alliance ships have no deflector screens, no transporters, and no
 * artificial gravity outside a rotating section — and the Hyperion is the class
 * that famously lacks even that. Each of those is a real mechanical consequence
 * here:
 *
 *  - **No shields whatsoever.** Not thin ones — none. Every blue and green box
 *    is zero and there is no shield generator, so the ship carries no RNFC or
 *    REPR lines either and its whole defence is grey armour under G2. That is
 *    a harsher thing to be than it sounds: armour absorbs like a blue box, but
 *    G2.2.2 says a ship may not repair armour during combat, so every point of
 *    it the Hyperion loses is gone for the rest of the battle. A Union cruiser
 *    puts its screens back up round after round; this one has a fixed pool and
 *    a clock. It has to win early.
 *  - **An interceptor grid, which is a weapon and not a screen.** It shoots
 *    incoming fire down rather than soaking it, so it lives in the weapons
 *    block with PD MODE, where the point-defence rules can actually reach it.
 *    Modelling it as shield boxes would have been the easy lie.
 *  - **No transporters.** TRAN 0. It cannot beam marines across, cannot be
 *    boarded that way, and — under E11.5 — cannot evacuate its crew by
 *    transporter at all. Its people leave by shuttle or not at all.
 *  - **No tractor beams.** TRAC 0, so no tows, no captures, no plucking
 *    missiles out of the sky.
 *  - **No rotating section.** QTRS 2, the lowest of any cruiser here: the crew
 *    works in zero gravity and the ship carries almost no habitable volume.
 *
 * What it gets in exchange is 192 boxes of armour, damage control, a reactor
 * two points larger than any printed cruiser's, and a fighter complement twice
 * as big.
 *
 * It is calibrated by playing it, not by trusting the price — and here the two
 * disagree by a lot, which is the whole story of the hull. It is printed at 44
 * points against a model that totals it at 60.3; the note beside `costModifier`
 * below has the eight-hull ladder that settled on the number, and the reason
 * the model cannot see it.
 *
 * Five corrections got it there, none of which the point model could have
 * told us about, each recorded at the place it applies:
 *
 *   - a broadside whose arcs were not arcs, so the battery never bore;
 *   - a reactor that could not feed four weapon systems;
 *   - a turn table with a zero in the top row;
 *   - armour priced as though it were a shield that repairs;
 *   - a slow-arming diamond on every gun of both ships, courtesy of the
 *     helper below, halving the rate of fire of hulls whose problem was
 *     already that they did not shoot enough.
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pointValue, validateDesign } from '../src/engine/shipBuilder'
import type { Arc, FunctionLineDef, ShipForm, WeaponSystemDef } from '../src/engine/types'

/**
 * The printed secondary-battery mounting: four mounts, each covering a
 * four-arc quadrant pair, so that whatever the bearing about two of them can
 * see the target. Every canon cruiser's phaser battery is laid out this way,
 * and a weapon that is not laid out this way only fires when the ship is
 * pointed the right direction.
 */
const ALL_ROUND: Arc[][] = [
  ['AP', 'PA', 'PF', 'FP'],
  ['FS', 'SF', 'PF', 'FP'],
  ['SA', 'AS', 'AP', 'PA'],
  ['FS', 'SF', 'SA', 'AS'],
]

/** Every arc: a turret with nothing behind it, as the printed hulls mount one. */
const ALL_ARCS: Arc[] = ['FS', 'SF', 'SA', 'AS', 'AP', 'PA', 'PF', 'FP']

/** `n` mounts firing dead ahead, the way a torpedo battery is carried. */
const forward = (n: number): Arc[][] => Array.from({ length: n }, () => ['FS', 'FP'] as Arc[])

const FORWARD = forward(4)

const step = (value: number) => ({ powerCost: 1, value })

function line(
  id: string,
  label: string,
  kind: FunctionLineDef['kind'],
  values: number[],
  extra: Partial<FunctionLineDef> = {},
): FunctionLineDef {
  return {
    id,
    label,
    kind,
    freeValue: 0,
    steps: values.map(step),
    sequential: true,
    ...extra,
  }
}

/**
 * A weapon system, one mount per entry in `mounts` — which is the arc list that
 * mount covers. Typed as `Arc[][]` rather than strings on purpose: the first
 * draft of the Hyperion carried a broadside written `['S','P']`, which are not
 * arcs, so the battery never bore on anything and the ship lost every duel it
 * fought. A cast is what let that compile.
 */
function weapon(args: {
  id: string
  name: string
  weaponClass: WeaponSystemDef['weaponClass']
  mounts: Arc[][]
  armingCircles: number
  hitBoxes: number
  brackets: WeaponSystemDef['brackets']
  traits?: string[]
  /**
   * A slow-arming diamond between the circles (E4.2.8): the mount may fill
   * only one circle per Resource Allocation Segment, so a two-circle mount
   * fires every other round, and B2.5.6 bars topping it up from a battery.
   *
   * Off by default, which is what the printed ships do — only the A/MAT
   * torpedo batteries carry a diamond, while every phaser and light phaser
   * charges in one round. This defaulted to *on* to begin with, quietly
   * halving the rate of fire of every gun on both designs.
   */
  slowArming?: boolean
  /**
   * The exact diamond pattern, where `slowArming`'s single gate is too blunt.
   * Every printed plasma torpedo runs six circles gated `false, true, false,
   * true, false` — two diamonds part way along rather than one at the start.
   */
  roundGates?: boolean[]
  /**
   * A warhead that does its own fixed damage rather than rolling for it
   * (E5.3): the plasma torpedoes all carry `{ damage: 4, leak: 1, structure:
   * 1 }`. Absent for direct-fire weapons.
   */
  special?: WeaponSystemDef['special']
}): WeaponSystemDef {
  const gates = args.roundGates ?? (args.slowArming ? [true] : undefined)
  return {
    id: args.id,
    name: args.name,
    weaponClass: args.weaponClass,
    mounts: args.mounts.map((arcs, i) => ({
      id: `${args.id}-m${i + 1}`,
      arcs,
      armingCircles: args.armingCircles,
      hitBoxes: args.hitBoxes,
      ...(gates ? { roundGates: gates } : {}),
    })),
    brackets: args.brackets,
    traits: args.traits ?? [],
    ...(args.special ? { special: args.special } : {}),
  }
}

const HYPERION: ShipForm = {
  id: 'fan-b5-hyperion-heavy-cruiser',
  name: 'HYPERION-class Heavy Cruiser',
  faction: 'Earth Alliance',
  sizeClass: 5,
  stressRating: 4,
  // Earth Alliance damage control is the reason these ships come home at all.
  damageControlRating: 5,

  // Ten power points where a Union cruiser has eight. Earth Alliance hulls are
  // enormous and fusion-powered, and this one has four weapon systems to feed
  // instead of the usual two — on eight points nothing was ever fully charged
  // and the ship lost to cruisers costing a third less.
  reactors: [
    { id: 'l-main', label: 'L MAIN', hitKind: 'left-main', points: [{ boxes: 2 }, { boxes: 2 }, { boxes: 2 }, { boxes: 2 }] },
    { id: 'r-main', label: 'R MAIN', hitKind: 'right-main', points: [{ boxes: 2 }, { boxes: 2 }, { boxes: 2 }, { boxes: 2 }] },
    { id: 'sl-reac', label: 'SL REAC', hitKind: 'sublight-reactor', points: [{ boxes: 2 }] },
    { id: 'aux-pwr', label: 'AUX PWR', hitKind: 'aux', points: [{ boxes: 2 }] },
  ],
  batteries: 2,
  // The jump engine. A Hyperion carries its own rather than relying on a gate.
  ftlDriveBoxes: 3,

  functions: [
    line('accel', 'ACC/DEC', 'accel', [2, 3], { freeValue: 1 }),
    line('sif', 'SIF/IDF', 'sif', [1, 2, 3]),
    line('emer', 'EMER', 'emergency-turn', [1], { sequential: false }),
    line('bat-rech', 'BTY RECH', 'battery-recharge', [1, 2], { sequential: false }),
    line('ftl', 'JUMP ENG', 'ftl-drive', [1, 2, 3]),
    // No RNFC or REPR lines. There is nothing to reinforce and, under G2.2.2,
    // nothing that may be repaired — so the eight facing lines every other
    // cruiser spends power on simply are not on this form, and that power goes
    // into the guns instead.
    //
    // Unremarkable rather than crippled: the same line the early YORKTOWNs
    // carry. Earth Alliance sensors are the weak end of a cruiser's, not a
    // shuttle's, and a hull that cannot see cannot shoot either (H2.2.3).
    line('sensor', 'SENSORS', 'sensor', [4, 6], { freeValue: 2 }),
    line('gen-sys', 'GEN SYS', 'gen-sys', [1], { freeValue: 1, sequential: false }),
    // Every weapon needs an arming line to charge it from (E4.2.6). The heavy
    // battery arms slowly and the interceptor grid comes up free every phase,
    // which is what makes it a defensive weapon rather than a gun.
    line('f-laser', 'HVY LASER', 'weapon', [3, 5, 7], {
      freeValue: 1,
      weaponSystemId: 'ea-heavy-laser',
    }),
    line('f-particle', 'PART CAN', 'weapon', [3, 5], {
      freeValue: 2,
      weaponSystemId: 'ea-particle-cannon',
    }),
    line('f-intcpt', 'INTCPT GRID', 'weapon', [3], {
      freeValue: 2,
      weaponSystemId: 'ea-interceptor',
    }),
    line('f-missile', 'MISSILE', 'weapon', [2], {
      freeValue: 0,
      weaponSystemId: 'ea-missile-rack',
    }),
  ],

  weapons: [
    // The main battery, carried forward and fired down the bow the way a
    // torpedo battery is: the Hyperion kills what it is pointed at.
    weapon({
      id: 'ea-heavy-laser',
      name: 'HEAVY LASER CANNON',
      weaponClass: 'phaser',
      mounts: FORWARD,
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 1'],
      brackets: [
        { min: 0, max: 8, band: 'green', dice: ['red'] },
        { min: 9, max: 16, band: 'black', dice: ['yellow'] },
        { min: 17, max: 24, band: 'red', dice: ['green'] },
      ],
    }),
    // The secondary battery, spread so that whatever the bearing about half of
    // it can see the target. This is what a cruiser fights with between the
    // passes where its main guns bear.
    weapon({
      id: 'ea-particle-cannon',
      name: 'MEDIUM PARTICLE CANNON',
      weaponClass: 'disruptor',
      mounts: ALL_ROUND,
      armingCircles: 2,
      hitBoxes: 1,
      traits: ['PARTCL'],
      brackets: [
        { min: 0, max: 4, band: 'green', dice: ['green', 'green'] },
        { min: 5, max: 8, band: 'black', dice: ['green', 'blue'] },
        { min: 9, max: 12, band: 'black', dice: ['blue'] },
      ],
    }),
    // The interceptor grid in its offensive role: short, fast, everywhere.
    weapon({
      id: 'ea-interceptor',
      name: 'INTERCEPTOR GRID',
      weaponClass: 'phaser',
      mounts: ALL_ROUND,
      armingCircles: 1,
      hitBoxes: 1,
      traits: ['PD MODE'],
      brackets: [
        { min: 0, max: 4, band: 'green', dice: ['green'] },
        { min: 5, max: 8, band: 'black', dice: ['blue'] },
      ],
    }),
    // Nuclear-tipped missiles: the Earth Alliance answer to armour it cannot
    // burn through with lasers.
    weapon({
      id: 'ea-missile-rack',
      name: 'Mk-IV NUCLEAR MISSILE',
      weaponClass: 'plasma-torpedo',
      mounts: [['FS', 'FP'], ['FS', 'FP']],
      armingCircles: 2,
      hitBoxes: 1,
      // The one gun on either ship that deserves the diamond, for the same
      // reason the printed A/MAT batteries carry it.
      slowArming: true,
      traits: ['HOMING 3', 'MISL 2', 'NoBAT'],
      brackets: [
        { min: 0, max: 4, band: 'green', dice: ['red'], bonus: 3, endurancePhase: 1 },
        { min: 0, max: 8, band: 'green', dice: ['red'], bonus: 2, endurancePhase: 2 },
        { min: 0, max: 12, band: 'green', dice: ['red'], bonus: 1, endurancePhase: 3 },
      ],
    }),
  ],

  // Nothing. No generator, no blue, no green — the only hull here without a
  // shield of any kind.
  shields: {
    generatorBoxes: 0,
    blue: { F: 0, A: 0, P: 0, S: 0 },
    green: { F: 0, S: 0, A: 0, P: 0 },
  },
  /*
   * So the armour does the entire job, and it is deep the way the Vallari
   * MARAUDER's five boxes over a full set of screens is not. Thick where an
   * Earth Alliance ship is thick: the bow it turns toward you, and much less
   * around the back of the drive block.
   *
   * None of it comes back. G2.2.2 forbids repairing armour in combat, and no
   * damage-control roll in this engine can touch it, so the number below is
   * the whole of what the ship will ever have.
   *
   * Rebalanced the same way the Omega was, and for the same reason: armour
   * absorbs without degrading anything, so a hull carrying too much of it
   * comes home either untouched or not at all. Against the KURSK I and the
   * YORKTOWN IV, forty mirrored games each:
   *
   *     armour 192 / struct 18    died 10 and 11 of 40   systems lost 4.7, 8.3
   *     armour 160 / struct 22    died 14 and 15         systems lost 5.6, 9.2
   *     armour 144 / struct 24    died 13 and 20         systems lost 7.8, 9.7
   *     armour 112 / struct 28    died 16 and 18         systems lost 9.8, 10.0
   *
   * The third, which also happens to price itself: at 49.5 points it goes
   * 20W-20L against the 49.5-point YORKTOWN IV. Down here the printed ladder
   * still means something, so unlike the Omega this one could be calibrated
   * against a peer rather than against its own survivability.
   */
  armor: { F: 45, S: 36, A: 27, P: 36 },

  systems: [
    { kind: 'SCNC', label: 'Sciences', boxes: 3 },
    { kind: 'SENS', label: 'Sensors', boxes: 3 },
    // No tractor beams and no transporters: Earth Alliance ships have neither.
    { kind: 'SHTL', label: 'Fighter Bays', boxes: 4 },
    { kind: 'QTRS', label: 'Quarters', boxes: 2 },
    { kind: 'CRGO', label: 'Cargo', boxes: 2 },
  ],

  /*
   * Twenty-four boxes over four Damage Control markers. Six more than the
   * first draft, taken out of the armour: the damage that used to stop dead in
   * the plate now comes through as cards, so the ship loses systems and repair
   * rating as it fights instead of banking hits against a wall.
   */
  structure: [
    ...Array.from({ length: 6 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 4 },
    ...Array.from({ length: 6 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 3 },
    ...Array.from({ length: 6 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 2 },
    ...Array.from({ length: 6 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 1 },
  ],

  sublight: {
    maxSpeed: 6,
    /*
     * A narrower template than a Union cruiser at every speed they share — 170
     * degrees across the table against the YORKTOWN's 190 — but unlike every
     * printed hull it can still come about at full burn. Earth Alliance ships
     * point themselves with attitude thrusters rather than banking, which is
     * why a Starfury can fly backwards, and it is the one thing this design
     * does better than the ships it stands beside.
     *
     * That last row is not decoration. A `0` there means the ship may not turn
     * at its best speed (C2.2.2), and a captain who plots it anyway spends the
     * battle flying away from the fight: with a zero in this row the design
     * lost to a cruiser costing a third less, and with a 15 it beats it.
     */
    turnBySpeed: [35, 30, 30, 25, 20, 15, 15],
    maxAccelPerPhase: 2,
    safeAccelPerRound: 2,
    stressAccelPerRound: 2,
    driveBoxes: 6,
    dmgTopSpeed: [5, 3, 2, 1, 0, 0],
  },

  marineSquads: 8,
  // Starfury squadrons, which this rule set flies as small craft.
  shuttles: 8,

  pointValue: 0,
  year: 2245,
  availability: 'common',
}


// ---------------------------------------------------------------------------

/**
 * EA OMEGA-class destroyer (Babylon 5).
 *
 * The Hyperion's successor and the ship the Earth Alliance built once it had
 * learned what the Minbari war cost. Same doctrine — no shields, armour and
 * interceptors, lasers and pulse cannon — on a larger hull, with the two things
 * the Hyperion conspicuously lacks: a rotating section, and a real hangar.
 *
 *  - **The rotating section.** QTRS 6 against the Hyperion's 2. It is the
 *    visible difference between the classes and it buys crew volume, which
 *    here means quarters boxes: free hits that soak damage cards, and under
 *    J11.2.2 the place a Quarters hit lands before it spills anywhere that
 *    matters.
 *  - **The hangar.** Starfury capacity is carried in HNGR boxes, not as
 *    shuttles. E8.4.6 names hangar bays as their own damageable system —
 *    "such as fighter/shuttle carriers" — so a carrier's fighter capacity has
 *    a printed home on the form that is not the shuttle bay, and when fighter
 *    squadrons arrive they will be flying off these boxes. The eight SHTL
 *    boxes' worth of "Starfuries" the Hyperion pretends to carry are a
 *    placeholder; this is the real thing, waiting for the rules.
 *
 * Still no shields, still no transporters, still no tractors: it is an Earth
 * Alliance ship, and the armour is what there is.
 *
 * Size 7, and deliberately not 8. Raising the class looks like the way to make
 * a ship absorb more punishment and it is not: size drives the point cost
 * (POWER_MULTIPLIER), the excess-damage threshold that breaks a hull apart
 * (E11.2.3), tractor resistance, probe count and docking rate — and nothing
 * else. Measured at size 7 and size 8 with everything else held equal, the two
 * played *identically* across forty games against each of two opponents, and
 * size 8 cost 5.8 points more for it. Capacity to take hits is the structure
 * track, which is independent of the class.
 *
 * Priced by the same ×0.85 the Hyperion carries, and calibrated on killability
 * rather than on matching a printed number — because the printed numbers do
 * not form a performance ladder. Measured in this harness the 158.6-point
 * UNION III loses to the 95.6-point EXETER II, so "trades evenly with a ship
 * of the same cost" has nothing stable to aim at up here. What can be aimed at
 * is whether the thing can be killed, and how hard it is used up doing it:
 *
 *     EXETER II   95.6   31W- 7L   died 9 of 40, and left having lost 17.8
 *                                  system boxes and a point of repair rating
 *     V-11C        147   31W- 9L   died 9 of 40
 *
 * It beats the strongest hull in the printed roster, dies about a fifth of the
 * time doing it, and comes home wrecked either way.
 */
const OMEGA: ShipForm = {
  id: 'fan-b5-omega-destroyer',
  name: 'OMEGA-class Destroyer',
  faction: 'Earth Alliance',
  sizeClass: 7,
  stressRating: 4,
  damageControlRating: 6,

  reactors: [
    { id: 'l-main', label: 'L MAIN', hitKind: 'left-main', points: [{ boxes: 3 }, { boxes: 3 }, { boxes: 3 }, { boxes: 3 }, { boxes: 3 }] },
    { id: 'r-main', label: 'R MAIN', hitKind: 'right-main', points: [{ boxes: 3 }, { boxes: 3 }, { boxes: 3 }, { boxes: 3 }, { boxes: 3 }] },
    { id: 'sl-reac', label: 'SL REAC', hitKind: 'sublight-reactor', points: [{ boxes: 2 }, { boxes: 2 }] },
    { id: 'aux-pwr', label: 'AUX PWR', hitKind: 'aux', points: [{ boxes: 2 }] },
  ],
  batteries: 3,
  ftlDriveBoxes: 4,

  functions: [
    line('accel', 'ACC/DEC', 'accel', [2, 3], { freeValue: 1 }),
    line('sif', 'SIF/IDF', 'sif', [1, 2, 3]),
    line('emer', 'EMER', 'emergency-turn', [1], { sequential: false }),
    line('bat-rech', 'BTY RECH', 'battery-recharge', [1, 2], { sequential: false }),
    line('ftl', 'JUMP ENG', 'ftl-drive', [1, 2, 3]),
    // No RNFC or REPR lines: nothing to reinforce and, under G2.2.2, nothing
    // that may be repaired.
    line('sensor', 'SENSORS', 'sensor', [4, 6], { freeValue: 2 }),
    line('gen-sys', 'GEN SYS', 'gen-sys', [1, 2], { freeValue: 1, sequential: false }),
    // Flight operations, which is what a hangar costs to run (J8.1).
    line('flight', 'FLIGHT OPS', 'gen-sys', [1], { freeValue: 1, sequential: false }),
    line('f-laser', 'HVY LASER', 'weapon', [4, 6, 8], {
      freeValue: 2,
      weaponSystemId: 'ea-omega-laser',
    }),
    line('f-pulse', 'PULSE CAN', 'weapon', [4, 6], {
      freeValue: 2,
      weaponSystemId: 'ea-omega-pulse',
    }),
    line('f-intcpt', 'INTCPT GRID', 'weapon', [3], {
      freeValue: 2,
      weaponSystemId: 'ea-omega-interceptor',
    }),
    line('f-missile', 'MISSILE', 'weapon', [2], {
      freeValue: 0,
      weaponSystemId: 'ea-omega-missile',
    }),
  ],

  weapons: [
    // The Hyperion's battery grown up: four mounts instead of three, and
    // reaching past thirty.
    weapon({
      id: 'ea-omega-laser',
      name: 'HEAVY LASER CANNON',
      weaponClass: 'phaser',
      mounts: FORWARD,
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 1'],
      brackets: [
        { min: 0, max: 10, band: 'green', dice: ['red', 'yellow'] },
        { min: 11, max: 20, band: 'black', dice: ['red'] },
        { min: 21, max: 28, band: 'red', dice: ['yellow'] },
        { min: 29, max: 34, band: 'red', dice: ['green'] },
      ],
    }),
    // Pulse cannon: the Omega's answer to everything inside ten inches, on the
    // printed all-round mounting.
    weapon({
      id: 'ea-omega-pulse',
      name: 'PULSE CANNON',
      weaponClass: 'disruptor',
      mounts: ALL_ROUND,
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PARTCL'],
      brackets: [
        { min: 0, max: 5, band: 'green', dice: ['yellow', 'green'] },
        { min: 6, max: 10, band: 'black', dice: ['green', 'green'] },
        { min: 11, max: 15, band: 'black', dice: ['green', 'blue'] },
      ],
    }),
    weapon({
      id: 'ea-omega-interceptor',
      name: 'INTERCEPTOR GRID',
      weaponClass: 'phaser',
      mounts: ALL_ROUND,
      armingCircles: 1,
      hitBoxes: 1,
      traits: ['PD MODE'],
      brackets: [
        { min: 0, max: 4, band: 'green', dice: ['green'] },
        { min: 5, max: 9, band: 'black', dice: ['blue'] },
      ],
    }),
    weapon({
      id: 'ea-omega-missile',
      name: 'Mk-VI NUCLEAR MISSILE',
      weaponClass: 'plasma-torpedo',
      mounts: [['FS', 'FP'], ['FS', 'FP'], ['FS', 'FP']],
      armingCircles: 2,
      hitBoxes: 1,
      slowArming: true,
      traits: ['HOMING 3', 'MISL 2', 'NoBAT'],
      brackets: [
        { min: 0, max: 5, band: 'green', dice: ['red'], bonus: 3, endurancePhase: 1 },
        { min: 0, max: 10, band: 'green', dice: ['red'], bonus: 2, endurancePhase: 2 },
        { min: 0, max: 15, band: 'green', dice: ['red'], bonus: 1, endurancePhase: 3 },
      ],
    }),
  ],

  shields: {
    generatorBoxes: 0,
    blue: { F: 0, A: 0, P: 0, S: 0 },
    green: { F: 0, S: 0, A: 0, P: 0 },
  },
  /*
   * Less plate than the Hyperion, not more, and the reason is the structure
   * track below rather than the tonnage.
   *
   * Armour and structure both absorb, but they do it differently, and only one
   * of them hurts. Armour is a wall: it soaks until it is gone and degrades
   * nothing on the way. Structure is a track with Damage Control Rating
   * markers down it (B3.1.2), and damage that gets past the armour is drawn as
   * cards — so it lands on systems, knocks out mounts, and walks the ship down
   * its own repair rating. A hull that leans on armour is either untouched or
   * dead; a hull that leans on structure gets worse.
   *
   * The first draft was the former, and badly: 232 boxes, killed in none of
   * forty games against seven of eight printed opponents. Armour is linear in
   * the point model and a step function in play — past what an enemy can chew
   * through in twelve rounds, every further box is a free win.
   *
   * Trading it down and the track up, measured against the EXETER II and the
   * V-11C, forty mirrored games each:
   *
   *     armour 152 / struct 24    died  6 and  5 of 40   systems lost 12.9, 8.0
   *     armour 128 / struct 28    died  9 and  5          systems lost 15.5, 10.5
   *     armour 116 / struct 32    died  9 and  9          systems lost 17.8, 11.6
   *     armour 100 / struct 34    died  9 and 13          systems lost 19.7, 12.9
   *
   * The third is the one shipped. It still beats both, it dies about a fifth
   * of the time against either rather than shrugging one off and not the
   * other, and it ends a battle having lost half again the systems the armour
   * version did. That last column is the whole point: it is the difference
   * between a ship that survived and a ship that has been fought.
   */
  armor: { F: 36, S: 28, A: 22, P: 30 },

  systems: [
    { kind: 'SCNC', label: 'Sciences', boxes: 4 },
    { kind: 'SENS', label: 'Sensors', boxes: 4 },
    // The hangar the Hyperion never had. Starfury capacity lives here rather
    // than in SHTL, so it is fighter capacity when fighters exist (E8.4.6).
    { kind: 'HNGR', label: 'Starfury Hangar', boxes: 6 },
    { kind: 'SHTL', label: 'Shuttle Bay', boxes: 2 },
    // The rotating section: the whole visible difference from a Hyperion.
    { kind: 'QTRS', label: 'Rotating Section', boxes: 6 },
    { kind: 'CRGO', label: 'Cargo', boxes: 3 },
  ],

  /*
   * Thirty-two boxes and four Damage Control markers — the longest track of
   * any hull here, and where this ship's toughness actually lives. Each marker
   * crossed drops the repair rating for good (B3.1.2), so the Omega is at its
   * best in the first exchange and visibly less capable by the fourth.
   */
  structure: [
    ...Array.from({ length: 9 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 5 },
    ...Array.from({ length: 8 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 4 },
    ...Array.from({ length: 8 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 3 },
    ...Array.from({ length: 7 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 2 },
  ],

  sublight: {
    maxSpeed: 6,
    // Heavier than a Hyperion and it turns like it, but the same attitude
    // thrusters mean it can still come about at speed.
    turnBySpeed: [30, 30, 25, 25, 20, 15, 15],
    maxAccelPerPhase: 2,
    safeAccelPerRound: 2,
    stressAccelPerRound: 2,
    driveBoxes: 6,
    dmgTopSpeed: [5, 4, 3, 1, 0, 0],
  },

  marineSquads: 14,
  // Shuttles only. The Starfuries are hangar capacity, and they fly when the
  // fighter rules land.
  shuttles: 4,

  pointValue: 0,
  year: 2258,
  availability: 'common',
}

// ---------------------------------------------------------------------------

/**
 * MINBARI SHARLIN-class warcruiser (Babylon 5).
 *
 * The ship the Earth Alliance could not hit. Everything else about it follows
 * from finding an honest way to say that in these rules, and there is one:
 * jamming. Under H2.3.3 a target's jamming is added to the actual range before
 * the attacker reads its firing chart, and under **H2.3.7, if jamming pushes
 * the effective range past a weapon's maximum, that weapon may not fire at
 * all**. Not a to-hit penalty — no shot.
 *
 * H2.2.3 is what makes that a design problem rather than a free win: the cap
 * on points assignable to any one sensor function is the ship's undamaged
 * SENS boxes. Every printed hull in the game tops out at four — four boxes and
 * an eight-point line, so the best jamming anyone can raise is 4, and spending
 * it means spending the whole line. The SHARLIN carries six boxes and a
 * twelve-point line, so it runs 6 jamming and 6 targeting at the same time:
 * enemies fire at +6 range while it fires at −6. A YORKTOWN III's phaser
 * reaches 13 inches, so from nine inches out it simply cannot shoot back.
 *
 * The counterplay is printed on the ship. Six SENS boxes are six damage boxes,
 * every one of them lowers the cap under H2.2.3, and a Sharlin with its
 * sensors shot out is an ordinary ship with thin shields. Kill the sensors or
 * lose the battle.
 *
 * Which is why this hull's results spread wider than any other here. Jamming
 * is a threshold, not a slope: an enemy that can shoot through it fights an
 * even battle, and one that cannot is simply out of range under H2.3.7, with
 * nothing in between. So it is not priced by finding the hull it draws with —
 * there isn't one — but by where the whole ladder balances. Forty mirrored
 * games at captain against each:
 *
 *     YORKTOWN III   43.2   44W- 4L      PREDATOR V-11B    72.6   16W-31L
 *     UNION I        52.2   31W-12L      EXETER I          85.2   19W-28L
 *     UNION II       75.4   44W- 2L      EXETER II         95.6    8W-40L
 *     PREDATOR V-11C  147   44W- 4L      UNION III        158.6   28W-14L
 *
 * Read by price that is nonsense, and an earlier version of this note claimed
 * it read cleanly by the opponent's sensor suite instead. It does not, and the
 * check is worth keeping written down: UNION I and the V-11B both carry three
 * sensor boxes and a twenty-inch gun, and it beats one and loses to the other;
 * UNION III and the EXETERs all carry four boxes and a twenty-six-inch gun,
 * same split. Neither targeting nor reach separates the winners from the
 * losers on their own, and no single variable found so far does.
 *
 * What can be said honestly is the shape: three of the eight beat it, five
 * lose badly, and almost nothing lands in the middle — which is what a
 * threshold rule does to a matchup table. Against the hulls it beats it
 * frequently kills nothing at all; it is not out-shooting them, they are out
 * of range.
 *
 * Left at the model's own number with no thumb on the scale. That is above
 * where the median matchup puts it, and deliberately so: a hull that
 * hard-counters whole classes of opponent should be the expensive answer
 * rather than the efficient one.
 *
 * The rest of the brief, in mechanics:
 *  - **Tough.** Twenty-two structure boxes, the most of any hull here, and a
 *    Damage Control Rating of 6 that no printed ship matches.
 *  - **Hits hard.** Three heavy neutron lasers firing two red dice each out to
 *    eight inches and still reaching twenty-eight — and with six targeting up,
 *    "eight inches" means fourteen on the ruler.
 *  - **Small shields.** Twelve boxes forward against a dreadnought's thirty:
 *    enough to represent a hull that drinks energy weapons, nowhere near
 *    enough to trade blows with something that can actually see it.
 */
const SHARLIN: ShipForm = {
  id: 'fan-b5-sharlin-warcruiser',
  name: 'SHARLIN-class Warcruiser',
  faction: 'Minbari Federation',
  sizeClass: 6,
  stressRating: 5,
  damageControlRating: 6,

  reactors: [
    { id: 'l-main', label: 'L MAIN', hitKind: 'left-main', points: [{ boxes: 3 }, { boxes: 3 }, { boxes: 3 }, { boxes: 3 }] },
    { id: 'r-main', label: 'R MAIN', hitKind: 'right-main', points: [{ boxes: 3 }, { boxes: 3 }, { boxes: 3 }, { boxes: 3 }] },
    { id: 'sl-reac', label: 'SL REAC', hitKind: 'sublight-reactor', points: [{ boxes: 2 }] },
    { id: 'aux-pwr', label: 'AUX PWR', hitKind: 'aux', points: [{ boxes: 2 }] },
  ],
  batteries: 3,
  ftlDriveBoxes: 3,

  functions: [
    line('accel', 'ACC/DEC', 'accel', [2, 3, 4], { freeValue: 1 }),
    line('sif', 'SIF/IDF', 'sif', [1, 2, 3]),
    line('emer', 'EMER', 'emergency-turn', [1], { sequential: false }),
    line('bat-rech', 'BTY RECH', 'battery-recharge', [1, 2], { sequential: false }),
    line('ftl', 'JUMP ENG', 'ftl-drive', [1, 2, 3]),
    ...(['F', 'P', 'S', 'A'] as const).map((side) =>
      line(`rnfc-${side}`, `SHLD RNFC ${side}`, 'shield-reinforce', [1], {
        sequential: false,
        shieldSide: side,
      }),
    ),
    ...(['F', 'P', 'S', 'A'] as const).map((side) =>
      line(`repr-${side}`, `SHLD REPR ${side}`, 'shield-repair', [1], {
        sequential: false,
        shieldSide: side,
      }),
    ),
    /*
     * The whole ship. Four points for nothing, twelve at two power — half again
     * the best line in the printed game, and paired with six SENS boxes so
     * H2.2.3 lets all of it reach a single function.
     */
    line('sensor', 'SENSORS', 'sensor', [8, 12], { freeValue: 4 }),
    line('gen-sys', 'GEN SYS', 'gen-sys', [1, 2], { freeValue: 1, sequential: false }),
    line('f-neutron', 'NEUT LASER', 'weapon', [3, 5, 7], {
      freeValue: 1,
      weaponSystemId: 'mb-neutron-laser',
    }),
    line('f-fusion', 'FUSION CAN', 'weapon', [4, 6], {
      freeValue: 2,
      weaponSystemId: 'mb-fusion-cannon',
    }),
  ],

  weapons: [
    // The main battery. Two red dice a mount inside eight inches, and it still
    // reaches twenty-eight — the range band where its targeting does the most.
    weapon({
      id: 'mb-neutron-laser',
      name: 'HEAVY NEUTRON LASER',
      weaponClass: 'phaser',
      mounts: forward(3),
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 2'],
      brackets: [
        { min: 0, max: 8, band: 'green', dice: ['red', 'red'] },
        { min: 9, max: 16, band: 'black', dice: ['red', 'yellow'] },
        { min: 17, max: 22, band: 'red', dice: ['red'] },
        { min: 23, max: 28, band: 'red', dice: ['yellow'] },
      ],
    }),
    // Fusion cannon on the printed all-round mounting, so something always
    // bears while the lasers are being brought to bear.
    weapon({
      id: 'mb-fusion-cannon',
      name: 'FUSION CANNON',
      weaponClass: 'disruptor',
      mounts: ALL_ROUND,
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 1', 'PD MODE'],
      brackets: [
        { min: 0, max: 4, band: 'green', dice: ['yellow', 'green'] },
        { min: 5, max: 9, band: 'black', dice: ['green', 'green'] },
        { min: 10, max: 14, band: 'black', dice: ['green', 'blue'] },
        { min: 15, max: 18, band: 'red', dice: ['blue'] },
      ],
    }),
  ],

  // Thin for the tonnage on purpose: the hull drinks a certain amount and then
  // stops, and the ship's real defence was never the shield.
  shields: {
    generatorBoxes: 3,
    blue: { F: 12, A: 8, P: 10, S: 10 },
    green: { F: 3, S: 3, A: 3, P: 3 },
  },
  /*
   * The crystalline hull under the screens: a modest layer, and the one part
   * of this ship's defence that does not come back (G2.2.2). It makes the pair
   * read correctly — the screens drink energy and regenerate on the REPR line,
   * the hull beneath them simply endures and is used up.
   *
   * Kept small deliberately. Armour was tried at 28, 44 and 60 boxes, and it
   * does not do here what it does on an Earth Alliance hull: against the
   * EXETER II — the ship that can actually see through the jamming — it barely
   * moved the result (3W-37L to 7W-33L, still dying in more than three
   * quarters of the games), because that matchup is lost to weight of fire and
   * not to chip damage. What it did change was the games this ship was already
   * winning, where the little that gets through is now stopped entirely: 6
   * deaths in 40 against the V-11C became 4 at 28 boxes and 2 at 44.
   *
   * So armour on this hull widens the gap between its free wins and its hard
   * counters rather than closing it, and the smallest layer that reads as a
   * layer is the right one.
   */
  armor: { F: 9, S: 7, A: 5, P: 7 },

  systems: [
    { kind: 'SCNC', label: 'Sciences', boxes: 5 },
    // Six. Every printed hull in the game has three or four, and under H2.2.3
    // this number *is* the jamming ceiling — which is also why shooting them
    // off is the way to fight this ship.
    { kind: 'SENS', label: 'Sensors', boxes: 6 },
    { kind: 'TRAC', label: 'Tractors', boxes: 2 },
    { kind: 'TRAN', label: 'Transporters', boxes: 2 },
    { kind: 'SHTL', label: 'Flyer Bays', boxes: 3 },
    { kind: 'QTRS', label: 'Quarters', boxes: 4 },
    { kind: 'CRGO', label: 'Cargo', boxes: 2 },
  ],

  structure: [
    ...Array.from({ length: 7 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 5 },
    ...Array.from({ length: 6 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 4 },
    ...Array.from({ length: 5 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 3 },
    ...Array.from({ length: 4 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 2 },
  ],

  sublight: {
    maxSpeed: 6,
    // Agile for its size, and able to come about at full burn — gravitic drive
    // rather than reaction thrust.
    turnBySpeed: [45, 40, 40, 35, 30, 25, 20],
    maxAccelPerPhase: 2,
    safeAccelPerRound: 2,
    stressAccelPerRound: 3,
    driveBoxes: 6,
    dmgTopSpeed: [5, 4, 3, 2, 1, 0],
  },

  marineSquads: 12,
  // Nial flyers.
  shuttles: 6,

  pointValue: 0,
  year: 2245,
  availability: 'rare',
}

// ---------------------------------------------------------------------------

/**
 * TRAFALGAR-class Super Dreadnought — Union of Federated Systems, size 10.
 *
 * Not an import: a Union ship built out of Union technology, at the top of the
 * scale the rules allow. B1.3.1 runs the size classes 1 to 10 and the printed
 * roster stops at 7, so a size 10 is a hull the rulebook makes room for and
 * nobody ever built. The name is the Union's own convention read forward — a
 * light frigate is a NELSON, so the fleet flagship is the battle he won.
 *
 * **What size 10 actually buys, and what it does not.** Class drives the point
 * cost (POWER_MULTIPLIER), the excess-damage threshold that breaks a hull
 * apart (E11.2.3), how hard it is to tractor (J3), probe count, and the rate
 * it can recover small craft (J8.2.6) — and nothing else. It does *not* make a
 * ship absorb more punishment: that is the structure track, which is
 * independent of the class. This was measured when the Omega was built, where
 * size 7 and size 8 played identically over eighty games and the larger cost
 * 5.8 points for the privilege. So the tonnage here is spent on the structure
 * track, the screens and the batteries — the size class is what makes it
 * nearly untractorable and very hard to blow apart, and the rest is paid for
 * honestly.
 *
 * **Modern Union technology**, which means the UNION III's kit one generation
 * on, and nothing borrowed from anyone else:
 *
 *  - **Screens, not armour, and more of them than the rules print.** Every
 *    Union hull in the printed game carries blue and green boxes and no armour
 *    at all, and this one keeps that faith: it repairs its defence on the REPR
 *    line every round rather than spending a fixed pool. It also carries more
 *    than G1.1.3 allows, which is a deliberate house rule — see the shields
 *    below. That is why it still needs no `costModifier`: the point model
 *    prices a repairing screen correctly however many boxes it is given, and
 *    it is only armour-only hulls like the Hyperion and the Omega it misreads.
 *  - **MK-8 A/MAT torpedoes**, ten of them forward, carrying the printed
 *    battery's slow-arming diamond (E4.2.8) and NoBAT: a full salvo every
 *    other round, and never topped up from a battery. This is the ship's
 *    reason to exist and the reason it must be pointed at something.
 *  - **LNC-1600 phasers** on the printed quadrant-pair mounting plus two
 *    all-round turrets, so something always bears while the bow comes round.
 *  - **DGR-20 light phasers** in PD MODE, four of them, because a ship this
 *    slow cannot dodge a homing weapon and has to shoot it down.
 *  - **A flag bridge.** CMND 6, the deepest in the game — under H5 a command
 *    ship lends tactical scan to its squadron, so the hull's real contribution
 *    is what the ships around it can suddenly see.
 *  - **Hangar boxes** (HNGR 6) rather than a pretended shuttle complement, the
 *    same choice the Omega made: when fighter squadrons arrive they fly off
 *    these, and E8.4.6 already gives them a damageable home on the form.
 *
 * **What it gives up.** It is enormous and it manoeuvres like it: top speed 5
 * where every hull it will meet makes 6, and the widest turn templates in the
 * game. It cannot disengage from anything that wants to keep shooting at it,
 * it cannot come about inside a duel, and every one of the ten torpedo tubes
 * is in the bow. A frigate that stays behind its shoulder is a frigate it
 * cannot answer.
 *
 * **What it is worth, measured.** 441.6 points after the reactor correction
 * below (429.8 before it — the model prices reactor durability, so five-box
 * points cost their keep), and unlike the two hulls above
 * it carries no `costModifier`, because there is nothing here the model gets
 * wrong. Checked against the printed roster the spreadsheet is accurate to
 * about a point — UNION III 158 against a modelled 158.6, UNION II 76 against
 * 75.4, YORKTOWN V 78 against 76.8 — so the price is the designers' own
 * arithmetic and not a guess, and it charges in full for the screens over the
 * cap: held to G1.1.3 the same hull prices at 386.9, so the waiver costs 42.9
 * points and is paid for. The size class is a smaller part of the total than
 * it looks: the identical hull prices at 377.2 at size 7, so 52 points is what
 * the class itself costs and the other 377 is ship.
 *
 * Mirrored fleet actions at admiral, 40 games each, scored on victory points
 * with kills and losses beside them — retreat off, for the reason below:
 *
 *     vs UNION III             158   40W- 0L   killed 40, lost 0
 *     vs UNION II + EXETER II  176   34W- 5L   killed 66, lost 0
 *     vs 2x EXETER II          200   27W-11L   killed 28, lost 0
 *     vs UNION III + YORKTOWN V 236  25W-14L   killed 41, lost 0
 *     vs UNION III + EXETER II 258   27W-13L   killed 55, lost 2
 *     vs 3x EXETER II          300   18W-22L   killed 43, lost 5
 *     vs 4x EXETER II          400    0W-40L   killed  2, lost 36
 *
 * The shape is a plateau and then a cliff. Up to about three hundred points of
 * opposition it is barely scratched — forty games against the heaviest printed
 * dreadnought without being destroyed once, and five deaths in forty against
 * three EXETER IIs — and at four hundred it dies in thirty-six of forty games
 * having killed two ships. There is a number of guns that overwhelms the
 * screens faster than six generator boxes can put them back up, and it sits
 * between three cruisers and four.
 *
 * Held to the printed shield cap this ladder was a different ship: 38W-1L
 * against the UNION III instead of 40W-0L, and 7W-33L against three EXETER IIs
 * where it now goes 18W-22L. The cap was doing most of the work of holding a
 * size 10 hull down to cruiser survivability.
 *
 * That it still loses on points to four EXETER IIs is concentration of force
 * behaving as it should rather than a mispricing — the EXETER II is the most
 * efficient hull in the printed roster, and the Omega's note above records the
 * same thing from the other direction: printed point values are not a
 * performance ladder at the top end.
 *
 * **One caveat that is the AI's and not the ship's.** With retreat enabled the
 * computer disengages this hull in round one whenever it is outnumbered, at
 * full structure, having fired a single volley: against three EXETER IIs that
 * produced forty games in which neither side killed anything at all. The
 * numbers above are measured with retreat off for that reason. A lone
 * capital ship facing a fleet is exactly the situation the retreat heuristic
 * reads as hopeless, and it is worth fixing on its own terms — it will do the
 * same to any single powerful ship, printed or otherwise.
 */
const TRAFALGAR: ShipForm = {
  id: 'fan-union-trafalgar-super-dreadnought',
  name: 'TRAFALGAR-class Super Dreadnought',
  faction: 'Union of Federated Systems',
  sizeClass: 10,
  stressRating: 7,
  damageControlRating: 6,

  /*
   * Fifteen power points against the UNION III's twelve — deliberately not
   * more. Power is the dominant term in the cost of a large hull: the model
   * charges size × 2 a point, so at size 10 every reactor point is twenty
   * points of purchase price, and a plant big enough to light the whole form
   * at once priced this ship past four hundred. Fifteen leaves it unable to
   * run full torpedoes, full phasers, full screens and a sensor picture in the
   * same round, which is the interesting problem to hand a flagship captain.
   */
  reactors: [
    // Five boxes per main point, not three: the printed ladder is
    // floor(size/2) — 2 at size 4-5, 3 at size 7 — and this hull shipped
    // with size-7 reactors on a size-10 frame until a player noticed. The
    // builder validates the ladder now. Tougher reactors only; the price
    // model charges per power point, so the cost is unchanged.
    { id: 'l-main', label: 'L MAIN', hitKind: 'left-main', points: [{ boxes: 5 }, { boxes: 5 }, { boxes: 5 }, { boxes: 5 }] },
    { id: 'r-main', label: 'R MAIN', hitKind: 'right-main', points: [{ boxes: 5 }, { boxes: 5 }, { boxes: 5 }, { boxes: 5 }] },
    { id: 'c-main', label: 'C MAIN', hitKind: 'center-main', points: [{ boxes: 5 }, { boxes: 5 }, { boxes: 5 }, { boxes: 5 }] },
    { id: 'sl-reac', label: 'SL REAC', hitKind: 'sublight-reactor', points: [{ boxes: 3 }] },
    { id: 'aux-pwr', label: 'AUX PWR', hitKind: 'aux', points: [{ boxes: 2 }, { boxes: 2 }] },
  ],
  batteries: 3,
  ftlDriveBoxes: 4,

  functions: [
    // One point of acceleration a phase is the whole handling character of the
    // ship; the line is short because there is nothing further to buy.
    line('accel', 'ACC/DEC', 'accel', [1, 2, 3]),
    line('sif', 'SIF/IDF', 'sif', [1, 2, 3]),
    line('emer', 'EMER', 'emergency-turn', [1], { sequential: false }),
    line('bat-rech', 'BTY RECH', 'battery-recharge', [1, 2, 3], { sequential: false }),
    line('ftl', 'FTL DRV', 'ftl-drive', [1, 2, 3, 4, 5]),
    ...(['F', 'P', 'S', 'A'] as const).map((side) =>
      line(`rnfc-${side}`, `SHLD RNFC ${side}`, 'shield-reinforce', [1], {
        sequential: false,
        shieldSide: side,
      }),
    ),
    ...(['F', 'P', 'S', 'A'] as const).map((side) =>
      line(`repr-${side}`, `SHLD REPR ${side}`, 'shield-repair', [1], {
        sequential: false,
        shieldSide: side,
      }),
    ),
    // The UNION III's sensor line one generation on: 4 free, 10 at full power,
    // with five SENS boxes so H2.2.3 caps a single function at five.
    line('sensor', 'SENSOR', 'sensor', [7, 10], { freeValue: 4 }),
    line('gen-sys', 'GEN SYS', 'gen-sys', [2], { freeValue: 1 }),
    line('f-a-mat', 'A/MAT TRP', 'weapon', [6, 9], {
      freeValue: 3,
      weaponSystemId: 'mk-8-a-mat-torpedo',
    }),
    line('f-phaser', 'PHASER', 'weapon', [6, 9, 12], {
      freeValue: 3,
      weaponSystemId: 'lnc-1600-phaser',
    }),
    line('f-lt-phaser', 'LT PHASER', 'weapon', [4, 6], {
      freeValue: 2,
      weaponSystemId: 'dgr-20-light-phaser',
    }),
  ],

  weapons: [
    /*
     * Ten tubes, all forward. The diamond is deliberate and matches every
     * printed A/MAT battery (E4.2.8): one circle a round, so the full salvo
     * comes every second round and cannot be hurried out of a battery
     * (B2.5.6). A ship that could throw this every round would not be a
     * dreadnought, it would be a problem.
     */
    weapon({
      id: 'mk-8-a-mat-torpedo',
      name: 'MK-8 A/MAT TORPEDO',
      weaponClass: 'a-mat-torpedo',
      mounts: forward(10),
      armingCircles: 2,
      hitBoxes: 1,
      traits: ['NoBAT', 'FTL'],
      slowArming: true,
      brackets: [
        { min: 0, max: 8, band: 'green', dice: ['red'], bonus: 1 },
        { min: 9, max: 18, band: 'black', dice: ['red'] },
        { min: 19, max: 25, band: 'red', dice: ['red'] },
        { min: 26, max: 30, band: 'red', dice: ['yellow'] },
      ],
    }),
    // Four quadrant pairs and two turrets with nothing behind them.
    weapon({
      id: 'lnc-1600-phaser',
      name: 'LNC-1600 PHASER',
      weaponClass: 'phaser',
      mounts: [...ALL_ROUND, ALL_ARCS, ALL_ARCS],
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 1', 'PD MODE'],
      brackets: [
        { min: 0, max: 4, band: 'green', dice: ['yellow', 'yellow'], bonus: 1 },
        { min: 5, max: 8, band: 'green', dice: ['yellow', 'yellow'] },
        { min: 9, max: 11, band: 'black', dice: ['yellow', 'yellow'] },
        { min: 12, max: 15, band: 'black', dice: ['green', 'green'] },
        { min: 16, max: 18, band: 'red', dice: ['green', 'blue'] },
      ],
    }),
    // Point defence. Too slow to dodge a homing weapon, so it shoots them down.
    weapon({
      id: 'dgr-20-light-phaser',
      name: 'DGR-20 LIGHT PHASER',
      weaponClass: 'phaser',
      mounts: ALL_ROUND,
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 1', 'PD MODE'],
      brackets: [
        { min: 0, max: 5, band: 'green', dice: ['green', 'green'] },
        { min: 6, max: 8, band: 'black', dice: ['green', 'green'] },
        { min: 9, max: 11, band: 'black', dice: ['green', 'blue'] },
        { min: 12, max: 14, band: 'red', dice: ['green'] },
      ],
    }),
  ],

  /*
   * Over the printed ceiling, deliberately.
   *
   * G1.1.3 caps a blue shield at 36 fore and aft and 28 to either beam, and
   * that cap is flat: the same number for a frigate and for the largest hull
   * the rules allow. Held to it, this ship carried a heavy cruiser's screens,
   * which made the size class a label rather than a fact — so the cap is
   * waived here and the validator reports it as a warning, which is what it
   * is. Nothing enforces the ceiling at play time; a ship over it is entirely
   * playable, and the point model charges honestly for every box.
   *
   * Scaled 1.6x off the UNION III's 30/26/26/26, which is close to the ratio
   * of the two structure tracks (34 boxes against 22). Six generator boxes
   * put them back up, because that is the Union's whole doctrine: nothing is
   * spent permanently.
   */
  shields: {
    generatorBoxes: 6,
    blue: { F: 48, A: 42, P: 42, S: 42 },
    green: { F: 6, S: 6, A: 6, P: 6 },
  },
  armor: { F: 0, S: 0, A: 0, P: 0 },

  systems: [
    { kind: 'SCNC', label: 'Sciences', boxes: 5 },
    { kind: 'SENS', label: 'Sensors', boxes: 5 },
    { kind: 'TRAC', label: 'Tractor Beams', boxes: 4 },
    { kind: 'TRAN', label: 'Transporters', boxes: 4 },
    { kind: 'SHTL', label: 'Shuttle Bay', boxes: 4 },
    // Fighter capacity with a real home on the form (E8.4.6), waiting on the
    // fighter rules — not a shuttle complement wearing a fighter's name.
    { kind: 'HNGR', label: 'Hangar Bay', boxes: 6 },
    { kind: 'QTRS', label: 'Quarters', boxes: 9 },
    // The flag bridge, and the reason a fleet brings this rather than two
    // cruisers: H5 lets it lend tactical scan to everything around it.
    { kind: 'CMND', label: 'Command Systems', boxes: 6 },
    { kind: 'CRGO', label: 'Cargo', boxes: 5 },
  ],

  // Thirty-four boxes and five repair markers: where the tonnage actually
  // went, since the size class does not carry it.
  structure: [
    ...Array.from({ length: 9 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 6 },
    ...Array.from({ length: 8 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 5 },
    ...Array.from({ length: 7 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 4 },
    ...Array.from({ length: 6 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 3 },
    ...Array.from({ length: 4 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 2 },
  ],

  sublight: {
    maxSpeed: 5,
    /*
     * The widest templates in the game, and never a zero — the UNION III's
     * table has one in its top row, and a ship that may not turn at all at
     * speed sails off the map rather than fights. It turns badly here; it can
     * always turn.
     */
    turnBySpeed: [30, 25, 25, 20, 20, 15],
    /*
     * Two a phase, not one. One was the first draft and it made the ship
     * unplayable rather than ponderous: every printed hull it will meet makes
     * speed 6 with two points a phase, so at one point a phase it could not
     * force an engagement on anybody who declined — against three EXETER IIs
     * it fought forty games and neither side killed anything at all, because
     * the cruisers simply stayed away. Top speed 5 is the handicap that
     * belongs to the tonnage; being unable to change speed is not a handicap,
     * it is being taken out of the game.
     */
    maxAccelPerPhase: 2,
    safeAccelPerRound: 2,
    stressAccelPerRound: 2,
    driveBoxes: 10,
    dmgTopSpeed: [5, 5, 4, 4, 3, 3, 2, 1, 1, 0],
  },

  marineSquads: 26,
  shuttles: 8,

  pointValue: 0,
  year: 3680,
  availability: 'rare',
}

// ---------------------------------------------------------------------------

/**
 * YORKTOWN X-class Heavy Cruiser — the refit line run five marks past the V.
 *
 * Not invented: extrapolated. The printed roster carries five marks of
 * YORKTOWN and the progression between them is unusually disciplined, so the
 * useful question is not "what would a bigger Yorktown be" but "what does this
 * line actually do to itself between marks, and what does the fifth step past
 * the V look like".
 *
 * What the printed marks change, per generation, averaged over I → V:
 *
 *     mark   PV  struct  react  bat  blue F/A/P/S   grn  gen  SENS  mounts
 *      I     23    13      7     1    15/12/13/13    3    3    3      7
 *      II    29    13      8     1    16/15/15/15    3    3    3      8
 *      III   42    14      8     1    20/18/18/18    3    3    3      9
 *      IV    48    15      9     1    22/20/20/20    4    4    4      9
 *      V     78    16     10     2    26/24/24/24    4    4    4      9
 *
 * — structure +0.75, reactor +0.75, blue screens +2.75 fore and +3 elsewhere,
 * green and generator and sensors +0.25, mounts +0.5. Five more steps of that
 * gives 20 structure boxes, 14 reactor points, 3 batteries, 40/38/38/38 of
 * blue, 5 green, 5 generator boxes, 5 SENS and twelve mounts, which is what is
 * built below.
 *
 * **What the line does *not* change is the more interesting half, and it is
 * the whole discipline of this design.** Across all five printed marks the
 * YORKTOWN keeps:
 *
 *  - **Size class 5.** It is a heavy cruiser and it stays one. A Mark X that
 *    grew into a dreadnought would not be a Yorktown, it would be a UNION
 *    wearing the name.
 *  - **The same drive, exactly.** Speed 6, the 40-degree template at rest, two
 *    points of acceleration a phase, six drive boxes — identical figures on
 *    the I and the V, twenty-seven years apart. This line never gets faster or
 *    handier; it gets harder to kill and better armed. So the Mark X is not
 *    faster either, including the zero in the top row of its turn table: at
 *    full burn a Yorktown may not turn at all, and that has been true of every
 *    one of them.
 *  - **Four torpedo tubes.** Not five, not six, on any mark. What improves is
 *    the torpedo — MK-3, MK-4, MK-5, MK-5, MK-6 — and the growth in mounts is
 *    all secondary battery. The Mark X keeps four.
 *  - **Stress Rating 4 and Damage Control 4.** Flat across the whole line.
 *
 * So: MK-10 torpedoes in the same four tubes, LNC-2000 phasers where the V
 * carries LNC-1000, and the DGR light phaser back on the form after the V
 * dropped it. The torpedo's reach is the one place the trend is read
 * conservatively — the printed sequence runs 16, 20, 24, 24, 26, so the early
 * jumps say +2.5 a mark and the last three say the reach is levelling off.
 * Taking the plateau rather than the early slope puts the MK-10 at 32 instead
 * of 38; a 38-inch torpedo would cover the whole printed board from the
 * deployment line, which is a different game rather than a better cruiser.
 *
 * It carries the same screens waiver the TRAFALGAR does, and it arrives there
 * honestly: the printed trend alone walks the beam shields past G1.1.3's 28 by
 * the Mark VIII. That is the clearest evidence the cap is a figure written for
 * the hulls that existed rather than a law about shields.
 *
 * **214.8 points, and the price is worth a note.** The model reproduces all
 * five printed marks to within about a point — I 23 against 23, III 42 against
 * 43.2, V 78 against 76.8 — so it can be trusted on the sixth. But extending
 * the *printed prices* instead of the printed parts gives a different answer:
 * 23, 29, 42, 48, 78 compounds at about 1.36 a mark, and five more of that
 * would be roughly 360. The gap is that the parts grow arithmetically here
 * (+0.75 of structure, +2.75 of shield) while the printed prices grew
 * geometrically, because the late marks each added a little of everything at
 * once. Extrapolating the parts is the defensible half — a price with no parts
 * behind it is a number, not a ship — so 214.8 is what this is, and anyone who
 * prefers the price curve should read it as the Mark X being a bargain.
 *
 * **How it fights.** Mirrored, 40 games each at admiral, retreat off:
 *
 *     vs YORKTOWN V             78   40W- 0L   killed 40, lost 0
 *     vs EXETER II             100   40W- 0L   killed 40, lost 0
 *     vs UNION III             158   39W- 1L   killed 40, lost 0
 *     vs 2x EXETER II          200    1W-39L   killed  9, lost 38
 *     vs UNION III + EXETER II 258   19W-21L   killed 28, lost 1
 *     vs TRAFALGAR             430    0W-40L   killed  0, lost 39
 *     2x YORKTOWN X vs TRAFALGAR      40W- 0L   killed 40, lost 4
 *
 * Five marks is an enormous distance: it destroys the YORKTOWN V in all forty
 * games without being scratched, and beats the 158-point UNION III 39-1. Then
 * it walks into two EXETER IIs and dies in thirty-eight of forty.
 *
 * That the same ship is nearly even against a *more* expensive pair — 19-21
 * against a UNION III and an EXETER II, dying once — is not noise. It is the
 * thing this file keeps rediscovering: the EXETER II is the most efficient
 * hull in the printed roster and the UNION III is the least, so 258 points of
 * dreadnought-plus-cruiser is a softer problem than 200 points of two
 * cruisers. A Mark X is not durable enough to be focus-fired by two good guns.
 *
 * And the last line is concentration of force pointing the other way for once:
 * two of these, at 429.6 against the TRAFALGAR's 429.8, take the super
 * dreadnought apart in all forty games for four losses.
 */
const YORKTOWN_X: ShipForm = {
  id: 'fan-union-yorktown-x-heavy-cruiser',
  name: 'YORKTOWN X-class Heavy Cruiser',
  faction: 'Union of Federated Systems',
  // Every printed mark is a size 5 heavy cruiser, and so is this one.
  sizeClass: 5,
  stressRating: 4,
  damageControlRating: 4,

  // Fourteen points, from the V's ten: +0.75 a mark, five marks on.
  reactors: [
    { id: 'l-main', label: 'L MAIN', hitKind: 'left-main', points: [{ boxes: 2 }, { boxes: 2 }, { boxes: 2 }, { boxes: 2 }, { boxes: 2 }] },
    { id: 'r-main', label: 'R MAIN', hitKind: 'right-main', points: [{ boxes: 2 }, { boxes: 2 }, { boxes: 2 }, { boxes: 2 }, { boxes: 2 }] },
    { id: 'sl-reac', label: 'SL REAC', hitKind: 'sublight-reactor', points: [{ boxes: 2 }, { boxes: 2 }] },
    { id: 'aux-pwr', label: 'AUX PWR', hitKind: 'aux', points: [{ boxes: 2 }, { boxes: 2 }] },
  ],
  batteries: 3,
  ftlDriveBoxes: 3,

  functions: [
    // The V's line, unchanged — because the V's drive is the I's drive.
    line('accel', 'ACC/DEC', 'accel', [2, 3, 4], { freeValue: 1 }),
    line('sif', 'SIF/IDF', 'sif', [1, 2, 3]),
    line('emer', 'EMER', 'emergency-turn', [1], { sequential: false }),
    line('bat-rech', 'BTY RECH', 'battery-recharge', [1, 2, 3], { sequential: false }),
    line('ftl', 'FTL DRV', 'ftl-drive', [1, 2, 3, 4]),
    ...(['F', 'P', 'S', 'A'] as const).map((side) =>
      line(`rnfc-${side}`, `SHLD RNFC ${side}`, 'shield-reinforce', [1], {
        sequential: false,
        shieldSide: side,
      }),
    ),
    ...(['F', 'P', 'S', 'A'] as const).map((side) =>
      line(`repr-${side}`, `SHLD REPR ${side}`, 'shield-repair', [1], {
        sequential: false,
        shieldSide: side,
      }),
    ),
    // The V reads 3 free and 8 at full power; five marks of +0.25 SENS puts
    // the rating at 5 and the line at 4 and 10.
    line('sensor', 'SENSOR', 'sensor', [7, 10], { freeValue: 4 }),
    line('gen-sys', 'GEN SYS', 'gen-sys', [2], { freeValue: 1 }),
    line('f-a-mat', 'A/MAT TRP', 'weapon', [4, 6], {
      freeValue: 2,
      weaponSystemId: 'mk-10-a-mat-torpedo',
    }),
    line('f-phaser', 'PHASER', 'weapon', [6, 9, 12], {
      freeValue: 3,
      weaponSystemId: 'lnc-2000-phaser',
    }),
    line('f-lt-phaser', 'LT PHASER', 'weapon', [4], { freeValue: 2, weaponSystemId: 'dgr-24-light-phaser' }),
  ],

  weapons: [
    // Four tubes. Four on the I, four on the V, four here — only the torpedo
    // in them has changed, and the diamond (E4.2.8) has never come off.
    weapon({
      id: 'mk-10-a-mat-torpedo',
      name: 'MK-10 A/MAT TORPEDO',
      weaponClass: 'a-mat-torpedo',
      mounts: forward(4),
      armingCircles: 2,
      hitBoxes: 1,
      traits: ['NoBAT', 'FTL'],
      slowArming: true,
      brackets: [
        { min: 0, max: 8, band: 'green', dice: ['red'], bonus: 1 },
        { min: 9, max: 19, band: 'black', dice: ['red'] },
        { min: 20, max: 27, band: 'red', dice: ['red'] },
        { min: 28, max: 32, band: 'red', dice: ['yellow'] },
      ],
    }),
    // Where the mount growth went, every mark: the secondary battery. Six, on
    // the V's own mounting plus a second turret.
    weapon({
      id: 'lnc-2000-phaser',
      name: 'LNC-2000 PHASER',
      weaponClass: 'phaser',
      mounts: [...ALL_ROUND, ALL_ARCS, ALL_ARCS],
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 1', 'PD MODE'],
      brackets: [
        { min: 0, max: 4, band: 'green', dice: ['yellow', 'yellow'], bonus: 1 },
        { min: 5, max: 7, band: 'green', dice: ['yellow', 'yellow'] },
        { min: 8, max: 11, band: 'black', dice: ['yellow', 'green'] },
        { min: 12, max: 15, band: 'black', dice: ['green', 'green'] },
        { min: 16, max: 18, band: 'red', dice: ['green', 'blue'] },
      ],
    }),
    // The DGR line, back on the form. The III and IV carried a light phaser
    // and the V dropped it for a fifth LNC; at twelve mounts there is room for
    // both, and point defence is what a cruiser wants against the torpedoes
    // this era throws.
    weapon({
      id: 'dgr-24-light-phaser',
      name: 'DGR-24 LIGHT PHASER',
      weaponClass: 'phaser',
      mounts: [
        ['FS', 'SF', 'SA', 'AS'],
        ['AP', 'PA', 'PF', 'FP'],
      ],
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 1', 'PD MODE'],
      brackets: [
        { min: 0, max: 5, band: 'green', dice: ['green', 'green'] },
        { min: 6, max: 9, band: 'black', dice: ['green', 'green'] },
        { min: 10, max: 12, band: 'black', dice: ['green', 'blue'] },
        { min: 13, max: 14, band: 'red', dice: ['green'] },
      ],
    }),
  ],

  /*
   * 40/38/38/38, straight off the trend line — and the beam facings are ten
   * over G1.1.3's 28, which the printed progression reaches on its own by
   * about the Mark VIII. Warned about, not refused; see the TRAFALGAR's
   * shields for the reasoning.
   */
  shields: {
    generatorBoxes: 5,
    blue: { F: 40, A: 38, P: 38, S: 38 },
    green: { F: 5, S: 5, A: 5, P: 5 },
  },
  armor: { F: 0, S: 0, A: 0, P: 0 },

  systems: [
    { kind: 'SCNC', label: 'Sciences', boxes: 6 },
    { kind: 'SENS', label: 'Sensors', boxes: 5 },
    { kind: 'TRAC', label: 'Tractor Beams', boxes: 3 },
    { kind: 'TRAN', label: 'Transporters', boxes: 3 },
    { kind: 'SHTL', label: 'Shuttle Bay', boxes: 3 },
    { kind: 'QTRS', label: 'Quarters', boxes: 5 },
    { kind: 'CRGO', label: 'Cargo', boxes: 3 },
  ],

  // Twenty boxes, from the V's sixteen.
  structure: [
    ...Array.from({ length: 6 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 4 },
    ...Array.from({ length: 5 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 4 },
    ...Array.from({ length: 5 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 3 },
    ...Array.from({ length: 4 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 2 },
  ],

  // The V's drive, to the figure. This line has never bought speed.
  sublight: {
    maxSpeed: 6,
    turnBySpeed: [40, 35, 35, 30, 30, 20, 0],
    maxAccelPerPhase: 2,
    safeAccelPerRound: 2,
    stressAccelPerRound: 2,
    driveBoxes: 6,
    dmgTopSpeed: [5, 4, 2, 1, 0, 0],
  },

  marineSquads: 14,
  shuttles: 6,

  pointValue: 0,
  // Marks land at 3645, 3655, 3662, 3667, 3672 — the gaps closing from ten
  // years to five. Five more at that cadence puts the X in the mid-nineties.
  year: 3695,
  availability: 'rare',
}

// ---------------------------------------------------------------------------

/**
 * UNION X-class Dreadnought — the capital line run seven marks past the III.
 *
 * Same method as the YORKTOWN X above and a much thinner basis for it, which
 * is worth saying plainly: the printed roster carries three UNION marks, so
 * there are two deltas to read a trend from, and this extrapolates seven steps
 * off them. The Yorktown had four deltas and went five steps. Treat the
 * numbers here as a defensible reading rather than a measurement.
 *
 *     mark   PV  struct  react  bat  blue F/A/P/S   SENS  CMND  mounts
 *      I     50    19      9     2    24/20/20/20    3     4      11
 *      II    76    20     10     2    24/22/22/22    3     5      13
 *      III  158    22     12     2    30/26/26/26    4     5      13
 *
 * The rule used throughout: **what is flat across the printed marks stays
 * flat, what grows is extrapolated.** That is not a shortcut, it is the line's
 * signature — and on this line almost everything is flat. Only five figures
 * move at all:
 *
 *   - structure  +1.5 a mark  →  32 boxes
 *   - reactor    +1.5 a mark  →  22 power points
 *   - blue shields +3 a mark  →  51 fore, 47 elsewhere
 *   - SENS       +0.5 a mark  →  7
 *   - CMND       +0.5 a mark  →  8
 *
 * Everything else is held because the Union held it: size class 7, Stress 6,
 * Damage Control 5, exactly two batteries, three FTL boxes, four green boxes,
 * four shield generator boxes, and SCNC 4 / TRAC 3 / TRAN 3 / SHTL 3 / QTRS 6
 * / CRGO 4 with eighteen marine squads and six shuttles — every one of those
 * identical on the I, the II and the III.
 *
 * The drive is identical too, exactly as the Yorktown's is: speed 6, the
 * 35-degree template at rest, two acceleration a phase, eight drive boxes, and
 * a zero in the top row. Nineteen printed years and the Union dreadnought
 * never got a knot faster or a degree handier.
 *
 * And the battery is settled: six torpedo tubes, five phasers, two light
 * phasers. The I had eleven mounts, the II added the two light phasers to make
 * thirteen, and the III changed nothing. So the Mark X changes nothing either
 * — MK-13 torpedoes in the same six tubes, LNC-3000 where the III has
 * LNC-1200, DGR-28 where it has DGR-14.
 *
 * The torpedo's reach is read conservatively at 36 rather than 40: the printed
 * sequence runs 20, 24, 26 — deltas of 4 then 2 — so the early slope says +3 a
 * mark and the trend says it is flattening. Taking the flattening still throws
 * across the whole printed board.
 *
 * **541.8 points, and it does not earn them.** Mirrored, 40 games each at
 * admiral, retreat off:
 *
 *     vs UNION III      158   40W- 0L   killed 39, lost 0
 *     vs 2x EXETER II   200   27W-13L   killed 49, lost 0
 *     vs 2x YORKTOWN X  430   15W-25L   killed 10, lost 5
 *     vs TRAFALGAR      430    3W-37L   killed  0, lost 8
 *     vs 5x EXETER II   500    0W-40L   killed  0, lost 40
 *
 * It walks over the printed dreadnought and it beats the two EXETER IIs that
 * kill a YORKTOWN X thirty-eight times in forty — thirty-two structure boxes
 * and a fifty-one-box screen are hard to chew through. Then it loses to a
 * TRAFALGAR costing a hundred points less, and it never once destroys one.
 *
 * **That "killed 0" is the finding, and it is not what it looks like.** The
 * obvious suspect is the shield generator: four boxes against fifty-one of
 * blue, held flat because the printed line held it flat, so a beaten-down
 * facing stays down. Measured, that is wrong — the same hull at six and eight
 * generator boxes goes 7W-33L and 6W-34L against the TRAFALGAR instead of
 * 3W-37L, still killing nothing, for twenty-seven and fifty-four more points.
 * Recovery is not the bottleneck.
 *
 * The battery is. The Union line settled on thirteen mounts at the Mark II and
 * never changed them — six tubes, five phasers, two light — so a disciplined
 * extrapolation gives a Mark X thirteen mounts against the TRAFALGAR's twenty,
 * and the model prices its 104 of offence beside 435 of defence. Seven marks
 * of this line buy a ship that is very hard to kill and cannot finish anything
 * its own size. That is a real property of the printed progression rather than
 * a flaw in the reading: the Union dreadnought grew its screens every mark and
 * its gun count never once.
 */
const UNION_X: ShipForm = {
  id: 'fan-union-union-x-dreadnought',
  name: 'UNION X-class Dreadnought',
  faction: 'Union of Federated Systems',
  // Size 7 on the I, the II and the III. It stays a dreadnought.
  sizeClass: 7,
  stressRating: 6,
  damageControlRating: 5,

  // Twenty-two points, from the III's twelve, in the III's own arrangement:
  // three equal main groups, a sublight plant and an auxiliary.
  reactors: [
    { id: 'l-main', label: 'L MAIN', hitKind: 'left-main', points: Array.from({ length: 6 }, () => ({ boxes: 3 })) },
    { id: 'r-main', label: 'R MAIN', hitKind: 'right-main', points: Array.from({ length: 6 }, () => ({ boxes: 3 })) },
    { id: 'c-main', label: 'C MAIN', hitKind: 'center-main', points: Array.from({ length: 6 }, () => ({ boxes: 3 })) },
    { id: 'sl-reac', label: 'SL REAC', hitKind: 'sublight-reactor', points: [{ boxes: 2 }, { boxes: 2 }] },
    { id: 'aux-pwr', label: 'AUX PWR', hitKind: 'aux', points: [{ boxes: 2 }, { boxes: 2 }] },
  ],
  // Two. Every printed mark carries two, so this one does.
  batteries: 2,
  ftlDriveBoxes: 3,

  functions: [
    line('accel', 'ACC/DEC', 'accel', [1, 2, 3, 4]),
    line('sif', 'SIF/IDF', 'sif', [1, 2]),
    line('emer', 'EMER', 'emergency-turn', [1], { sequential: false }),
    line('bat-rech', 'BTY RECH', 'battery-recharge', [1, 2], { sequential: false }),
    line('ftl', 'FTL DRV', 'ftl-drive', [1, 2, 3, 4, 5]),
    ...(['F', 'P', 'S', 'A'] as const).map((side) =>
      line(`rnfc-${side}`, `SHLD RNFC ${side}`, 'shield-reinforce', [1], {
        sequential: false,
        shieldSide: side,
      }),
    ),
    ...(['F', 'P', 'S', 'A'] as const).map((side) =>
      line(`repr-${side}`, `SHLD REPR ${side}`, 'shield-repair', [1], {
        sequential: false,
        shieldSide: side,
      }),
    ),
    // Seven SENS boxes, so H2.2.3 lets seven points reach one function.
    line('sensor', 'SENSOR', 'sensor', [8, 12], { freeValue: 5 }),
    line('gen-sys', 'GEN SYS', 'gen-sys', [2], { freeValue: 1 }),
    // Where twenty-two reactor points go: the batteries are deep enough to
    // take them, which is the only way a plant this size is not wasted.
    line('f-a-mat', 'A/MAT TRP', 'weapon', [6, 9], {
      freeValue: 3,
      weaponSystemId: 'mk-13-a-mat-torpedo',
    }),
    line('f-phaser', 'PHASER', 'weapon', [6, 9, 12, 15], {
      freeValue: 3,
      weaponSystemId: 'lnc-3000-phaser',
    }),
    line('f-lt-phaser', 'LT PHASER', 'weapon', [4, 6], {
      freeValue: 2,
      weaponSystemId: 'dgr-28-light-phaser',
    }),
  ],

  weapons: [
    // Six tubes on the I, six on the III, six here.
    weapon({
      id: 'mk-13-a-mat-torpedo',
      name: 'MK-13 A/MAT TORPEDO',
      weaponClass: 'a-mat-torpedo',
      mounts: forward(6),
      armingCircles: 2,
      hitBoxes: 1,
      traits: ['NoBAT', 'FTL'],
      slowArming: true,
      brackets: [
        { min: 0, max: 9, band: 'green', dice: ['red'], bonus: 1 },
        { min: 10, max: 21, band: 'black', dice: ['red'] },
        { min: 22, max: 30, band: 'red', dice: ['red'] },
        { min: 31, max: 36, band: 'red', dice: ['yellow'] },
      ],
    }),
    // Five, on the III's own mounting: four quadrant pairs and one turret.
    weapon({
      id: 'lnc-3000-phaser',
      name: 'LNC-3000 PHASER',
      weaponClass: 'phaser',
      mounts: [...ALL_ROUND, ALL_ARCS],
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 1', 'PD MODE'],
      brackets: [
        { min: 0, max: 5, band: 'green', dice: ['yellow', 'yellow'], bonus: 1 },
        { min: 6, max: 9, band: 'green', dice: ['yellow', 'yellow'] },
        { min: 10, max: 13, band: 'black', dice: ['yellow', 'green'] },
        { min: 14, max: 17, band: 'black', dice: ['green', 'green'] },
        { min: 18, max: 20, band: 'red', dice: ['green', 'blue'] },
      ],
    }),
    // Two, exactly as the II and III carry.
    weapon({
      id: 'dgr-28-light-phaser',
      name: 'DGR-28 LIGHT PHASER',
      weaponClass: 'phaser',
      mounts: [ALL_ARCS, ['SA', 'AS', 'AP', 'PA']],
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 1', 'PD MODE'],
      brackets: [
        { min: 0, max: 6, band: 'green', dice: ['green', 'green'] },
        { min: 7, max: 10, band: 'black', dice: ['green', 'green'] },
        { min: 11, max: 14, band: 'black', dice: ['green', 'blue'] },
        { min: 15, max: 16, band: 'red', dice: ['green'] },
      ],
    }),
  ],

  /*
   * 51/47/47/47, and only four generator boxes to put any of it back — both
   * straight off the trend, because the shields grew every mark and the
   * generator never did. It is the deepest screen in the game and the slowest
   * to recover, and it is tempting to call that the hull's weakness. Measured,
   * it is not: six and eight generator boxes barely move the result (see the
   * note above). This ship's problem is that it cannot shoot, not that it
   * cannot heal.
   */
  shields: {
    generatorBoxes: 4,
    blue: { F: 51, A: 47, P: 47, S: 47 },
    green: { F: 4, S: 4, A: 4, P: 4 },
  },
  armor: { F: 0, S: 0, A: 0, P: 0 },

  // Only SENS and CMND moved on this line. Everything else is the III's.
  systems: [
    { kind: 'SCNC', label: 'Sciences', boxes: 4 },
    { kind: 'SENS', label: 'Sensors', boxes: 7 },
    { kind: 'TRAC', label: 'Tractor Beams', boxes: 3 },
    { kind: 'TRAN', label: 'Transporters', boxes: 3 },
    { kind: 'SHTL', label: 'Shuttle Bay', boxes: 3 },
    { kind: 'QTRS', label: 'Quarters', boxes: 6 },
    { kind: 'CMND', label: 'Command Systems', boxes: 8 },
    { kind: 'CRGO', label: 'Cargo', boxes: 4 },
  ],

  // Thirty-two boxes, from the III's twenty-two.
  structure: [
    ...Array.from({ length: 9 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 5 },
    ...Array.from({ length: 8 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 5 },
    ...Array.from({ length: 8 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 4 },
    ...Array.from({ length: 7 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 3 },
  ],

  // The III's drive, to the figure — including the zero at full burn.
  sublight: {
    maxSpeed: 6,
    turnBySpeed: [35, 30, 30, 30, 30, 20, 0],
    maxAccelPerPhase: 2,
    safeAccelPerRound: 2,
    stressAccelPerRound: 2,
    driveBoxes: 8,
    dmgTopSpeed: [6, 5, 4, 3, 2, 1, 0, 0],
  },

  marineSquads: 18,
  shuttles: 6,

  pointValue: 0,
  // Marks land at 3656, 3668, 3675 — gaps of twelve then seven, closing.
  // Seven more at a closing cadence puts the X just past the turn of the
  // century, and after the YORKTOWN X, whose MK-10 it succeeds.
  year: 3705,
  availability: 'rare',
}

// ---------------------------------------------------------------------------

/**
 * IMPERATOR-class Super Dreadnought — Aurelian Empire.
 *
 * A different exercise from the two Union extrapolations above. The Aurelians
 * field exactly one dreadnought, the INVICTUS I, so there is no mark
 * progression to run forward; what there is instead is a whole roster of
 * fourteen hulls that agree with each other about how war works. The question
 * is not "what comes next" but "what does an Aurelian capital ship look like
 * when nothing is holding it back", and the answer has to be read off the
 * doctrine rather than off a trend line.
 *
 * **What every Aurelian hull agrees on:**
 *
 *  - **Plasma torpedoes, which are long-ranged and fade as they fly.** The
 *    numbers on an RP chart are not firing ranges — they are how far the
 *    counter travels in each phase of its flight, one bracket per endurance
 *    box (E5.1.5). The RP-A goes 3 inches in its first phase, 6 in the second
 *    and 9 in each of the last two: twenty-seven inches of reach, not nine.
 *    What falls away is its strength, and steeply — +8 in the first phase, +7
 *    in the second, +1 in the third and fourth. So it is not a knife, it is a
 *    weapon fired early that arrives weaker the longer it has to travel, and
 *    the Empire's problem is getting it to land while it still hurts. It is
 *    HOMING 3, PARTCL, NoBAT, and the slow-arming diamonds across six circles
 *    mean it takes most of a battle to charge and empties in one exchange.
 *  - **Short disruptors.** The ADM line runs 11 to 13 inches where a Union
 *    phaser of the same era makes 15, and every one of them is PD MODE and
 *    ATMO.
 *  - **No armour, anywhere.** Fourteen hulls, not one plate between them.
 *  - **Marines, and rather a lot of them.** The INVICTUS carries twenty
 *    squads against the UNION III's eighteen, and the AQUILA BELLUM V assault
 *    cruiser carries twenty-eight on a size 4 hull. Small-craft complements
 *    are ordinary — two on most hulls, six on the dreadnought.
 *
 *    This bullet used to say the opposite, because the ship book extractor
 *    was reading the Aurelian forms wrong: their rocket badge is drawn taller
 *    than the master book's, fell outside the size filter, and left one badge
 *    to be taken as the shuttle count by position. Every Aurelian hull
 *    therefore read as zero marines carrying its marine squads in the shuttle
 *    field. Fixed in the extractor and re-read from the book.
 *  - **A cloak.** The INVICTUS is the only dreadnought in the printed roster
 *    with one, and on a fleet whose guns die at nine inches that is not a
 *    luxury, it is the delivery system.
 *
 * So the doctrine writes the ship: **it opens early and closes while its own
 * shot is still in the air.** A plasma salvo launched at long range arrives
 * with almost nothing left of its bonus, so the Empire fires, runs in behind
 * its own torpedoes, and wants the last phases of their flight to happen at
 * short range where they still bite. The cloak is how it survives the run and
 * the disruptors are what it fights with once it is there. That is a
 * genuinely different animal from the UNION X above, which cannot be killed
 * and cannot kill.
 *
 * **Size 9, not 10, on purpose.** The Aurelians build light — their
 * dreadnought is 75 points where the contemporary UNION II is 76 and the later
 * UNION III is 158, and their size 7 INVICTUS carries thinner screens than
 * their size 5 DEFENSOR ALATUS. A hull that hits at size 10 while displacing
 * size 9 is the Empire's whole aesthetic.
 *
 * The one place this departs from the printed hulls deliberately: the INVICTUS
 * has a zero in the top row of its turn table, and this ship does not. A hull
 * that has to keep chasing its own torpedoes in cannot have a speed at which
 * it may not turn — it would cross the board, miss, and never come back.
 * Every other Aurelian handling figure is kept.
 *
 * **543.3 points, and it is the strongest thing in this file by a distance.**
 * Mirrored, 40 games each at admiral, retreat off:
 *
 *     vs INVICTUS I      75   40W- 0L   killed  0, lost 0
 *     vs UNION III      158   40W- 0L   killed 40, lost 0
 *     vs 2x EXETER II   200   40W- 0L   killed 77, lost 0
 *     vs TRAFALGAR      430   40W- 0L   killed 32, lost 0
 *     vs UNION X        542   40W- 0L   killed 40, lost 0
 *     vs 5x EXETER II   500   23W-17L   killed 51, lost 6
 *
 * Beating a UNION X of the same price forty times out of forty without losing
 * a hull is not a balanced result, and the reason is worth writing down: the
 * cloak is doing it, not the plasma. Read the first line — against the printed
 * INVICTUS, another cloaked ship, *neither side kills anything in forty
 * games*. Two hulls that cannot be found cannot fight. Against everything
 * else, this one crosses the board unseen, arrives at three inches with six
 * charged tubes and a warhead that does its damage without rolling, and the
 * defender never gets the exchange it needed at range.
 *
 * So the honest reading is that H6 cloaking is extremely strong in this engine
 * against an AI that does not hunt for it, and a ship built to exploit it
 * inherits all of that. Only the five-EXETER fleet, which has enough
 * point-defence and enough hulls to soak an alpha strike and still shoot back,
 * makes a fight of it. Anyone using this hull should know they are testing the
 * cloak rules as much as the ship.
 */
const IMPERATOR: ShipForm = {
  id: 'fan-aurelian-imperator-super-dreadnought',
  name: 'IMPERATOR-class Super Dreadnought',
  faction: 'Aurelian Empire',
  sizeClass: 9,
  // Seven, matching the INVICTUS — the highest Stress Rating in the game, and
  // the reason an Aurelian captain can throw a hull this size around.
  stressRating: 7,
  damageControlRating: 4,

  reactors: [
    // Size 9 sits between the ladder's rungs, so the points alternate 5/4
    // the way the printed size-3s alternate 2/1 — same correction as the
    // Trafalgar's, same player report, enforced by the builder now.
    { id: 'l-main', label: 'L MAIN', hitKind: 'left-main', points: [5, 4, 5, 4, 5].map((boxes) => ({ boxes })) },
    { id: 'r-main', label: 'R MAIN', hitKind: 'right-main', points: [5, 4, 5, 4, 5].map((boxes) => ({ boxes })) },
    { id: 'c-main', label: 'C MAIN', hitKind: 'center-main', points: [5, 4, 5, 4].map((boxes) => ({ boxes })) },
    { id: 'sl-reac', label: 'SL REAC', hitKind: 'sublight-reactor', points: [{ boxes: 2 }] },
    { id: 'aux-pwr', label: 'AUX PWR', hitKind: 'aux', points: [{ boxes: 2 }] },
  ],
  batteries: 2,
  ftlDriveBoxes: 3,

  functions: [
    line('accel', 'ACC/DEC', 'accel', [1, 2, 3]),
    line('sif', 'SIF/IDF', 'sif', [1, 2, 3]),
    line('emer', 'EMER', 'emergency-turn', [1], { sequential: false }),
    line('bat-rech', 'BTY RECH', 'battery-recharge', [1, 2], { sequential: false }),
    line('ftl', 'FTL DRV', 'ftl-drive', [1, 2, 3]),
    ...(['F', 'P', 'S', 'A'] as const).map((side) =>
      line(`rnfc-${side}`, `SHLD RNFC ${side}`, 'shield-reinforce', [1], {
        sequential: false,
        shieldSide: side,
      }),
    ),
    ...(['F', 'P', 'S', 'A'] as const).map((side) =>
      line(`repr-${side}`, `SHLD REPR ${side}`, 'shield-repair', [1], {
        sequential: false,
        shieldSide: side,
      }),
    ),
    line('sensor', 'SENSOR', 'sensor', [5, 8], { freeValue: 3 }),
    line('gen-sys', 'GEN SYS', 'gen-sys', [2], { freeValue: 1 }),
    // The delivery system, and the deepest cloak line in the game.
    line('cloak', 'CLOAK', 'special', [1, 2, 3, 4]),
    line('f-hvy-plas', 'HVY PLAS', 'weapon', [2, 4], { weaponSystemId: 'rp-omega-hvy-plasma' }),
    line('f-med-plas', 'MED PLAS', 'weapon', [2, 4], { freeValue: 1, weaponSystemId: 'rp-e-med-plasma' }),
    line('f-adm', 'ADM-20', 'weapon', [6, 10, 14], { freeValue: 2, weaponSystemId: 'adm-20-heavy-disruptor' }),
    line('f-adl', 'ADL-4', 'weapon', [4], { freeValue: 2, weaponSystemId: 'adl-4-light-disruptor' }),
  ],

  weapons: [
    /*
     * Four heavy tubes where the INVICTUS carries one. The bracket table keeps
     * the printed plasma shape exactly: one entry per endurance box, and the
     * figure is the distance the counter covers in that phase of flight —
     * 3, then 6, then 9, then 9. Twenty-seven inches of reach in total, with
     * the bonus collapsing from +10 to +2 along the way, so a torpedo that
     * has to fly the whole distance arrives as a rounding error and one
     * launched late arrives whole.
     */
    weapon({
      id: 'rp-omega-hvy-plasma',
      name: 'RP-OMEGA HVY PLASMA TORP',
      weaponClass: 'plasma-torpedo',
      mounts: forward(4),
      armingCircles: 6,
      hitBoxes: 1,
      traits: ['HOMING 3', 'PARTCL', 'NoBAT', 'FTL'],
      // The printed plasma gating: two diamonds part way along six circles.
      roundGates: [false, true, false, true, false],
      // A heavier warhead than the RP-A's 4/1/1 — this is the Empire's
      // largest, and the fixed damage is what makes a plasma hit terrifying
      // rather than the dice (E5.3).
      special: { damage: 6, leak: 2, structure: 2 },
      brackets: [
        { min: 0, max: 3, band: 'green', dice: ['red', 'red', 'red'], bonus: 10, endurancePhase: 1 },
        { min: 0, max: 6, band: 'green', dice: ['red', 'red', 'red'], bonus: 8, endurancePhase: 2 },
        { min: 0, max: 9, band: 'green', dice: ['red', 'red', 'red'], bonus: 2, endurancePhase: 3 },
        { min: 0, max: 9, band: 'black', dice: ['red', 'red', 'red'], bonus: 2, endurancePhase: 4 },
      ],
    }),
    // Medium tubes on the beams, the INVICTUS's own arrangement widened.
    weapon({
      id: 'rp-e-med-plasma',
      name: 'RP-E MED PLASMA TORP',
      weaponClass: 'plasma-torpedo',
      mounts: [
        ['PA', 'PF', 'FP'],
        ['FS', 'SF', 'SA'],
        ['AP', 'PA', 'PF'],
        ['SF', 'SA', 'AS'],
      ],
      armingCircles: 6,
      hitBoxes: 1,
      traits: ['HOMING 3', 'PARTCL', 'NoBAT', 'FTL'],
      roundGates: [false, true, false, true, false],
      special: { damage: 4, leak: 1, structure: 1 },
      brackets: [
        { min: 0, max: 3, band: 'green', dice: ['red', 'red'], bonus: 8, endurancePhase: 1 },
        { min: 0, max: 6, band: 'green', dice: ['red', 'red'], bonus: 6, endurancePhase: 2 },
        { min: 0, max: 9, band: 'green', dice: ['red', 'red'], bonus: 1, endurancePhase: 3 },
        { min: 0, max: 9, band: 'black', dice: ['red', 'red'], bonus: 1, endurancePhase: 4 },
      ],
    }),
    // The ADM line one step on from the ADM-15: still short, still ATMO.
    weapon({
      id: 'adm-20-heavy-disruptor',
      name: 'ADM-20 HEAVY DISRUPTOR',
      weaponClass: 'disruptor',
      mounts: [...ALL_ROUND, ALL_ARCS, ALL_ARCS],
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 1', 'PD MODE', 'ATMO'],
      brackets: [
        { min: 0, max: 3, band: 'green', dice: ['yellow', 'green'] },
        { min: 4, max: 7, band: 'green', dice: ['green', 'green'] },
        { min: 8, max: 11, band: 'black', dice: ['green', 'blue'] },
        { min: 12, max: 13, band: 'black', dice: ['green'] },
        { min: 14, max: 15, band: 'red', dice: ['green'] },
      ],
    }),
    // Point defence, and the only thing that will be firing on the run in.
    weapon({
      id: 'adl-4-light-disruptor',
      name: 'ADL-4 LIGHT DISRUPTOR',
      weaponClass: 'disruptor',
      mounts: ALL_ROUND,
      armingCircles: 1,
      hitBoxes: 1,
      traits: ['PREC 1', 'PD MODE', 'ATMO'],
      brackets: [
        { min: 0, max: 4, band: 'green', dice: ['green'] },
        { min: 5, max: 8, band: 'black', dice: ['green'] },
        { min: 9, max: 11, band: 'red', dice: ['blue'] },
      ],
    }),
  ],

  /*
   * Deliberately not a Union screen. The INVICTUS carries 20/16/18/18 at size
   * 7 — thinner than the Empire's own size 5 heavy cruiser — because Aurelian
   * survival is meant to come from not being shot at rather than from soaking
   * it. Scaled up but kept in that spirit: nowhere near the UNION X's 51.
   */
  shields: {
    generatorBoxes: 5,
    blue: { F: 34, A: 28, P: 30, S: 30 },
    green: { F: 4, S: 4, A: 4, P: 4 },
  },
  armor: { F: 0, S: 0, A: 0, P: 0 },

  systems: [
    { kind: 'SCNC', label: 'Sciences', boxes: 4 },
    { kind: 'SENS', label: 'Sensors', boxes: 5 },
    { kind: 'TRAC', label: 'Tractor Beams', boxes: 4 },
    { kind: 'TRAN', label: 'Transporters', boxes: 3 },
    { kind: 'SHTL', label: 'Shuttle Bay', boxes: 6 },
    { kind: 'QTRS', label: 'Quarters', boxes: 6 },
    { kind: 'CMND', label: 'Command Systems', boxes: 6 },
    { kind: 'CRGO', label: 'Cargo', boxes: 4 },
    // Three boxes where the INVICTUS has one. Shoot them out and the ship
    // loses the only way it has of reaching its own firing range.
    { kind: 'CLOAK', label: 'Cloaking System', boxes: 3 },
  ],

  structure: [
    ...Array.from({ length: 8 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 4 },
    ...Array.from({ length: 7 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 4 },
    ...Array.from({ length: 7 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 3 },
    ...Array.from({ length: 6 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 2 },
  ],

  sublight: {
    maxSpeed: 6,
    // Aurelian handling, and no zero in the top row: a ship that has to arrive
    // at three inches cannot have a speed at which it may not turn.
    turnBySpeed: [40, 35, 35, 30, 30, 25, 20],
    maxAccelPerPhase: 2,
    safeAccelPerRound: 2,
    stressAccelPerRound: 3,
    driveBoxes: 9,
    dmgTopSpeed: [6, 5, 5, 4, 3, 2, 1, 1, 0],
  },

  // Twenty-six squads, above the INVICTUS's twenty, and eight shuttles — the
  // Empire carries marines heavily and small craft sparingly. Both of these
  // were wrong in the first draft because the printed data was.
  marineSquads: 26,
  shuttles: 8,

  pointValue: 0,
  year: 3690,
  availability: 'rare',
}

// ---------------------------------------------------------------------------

/**
 * YORKTOWN XXX-class Heavy Cruiser — the name five and a half centuries on.
 *
 * The YORKTOWN X above is an extrapolation: five marks of a known trend, with
 * everything the line held constant held constant. This is the opposite
 * exercise and it needs saying plainly, because it is not a prediction of
 * anything. Run the clock out far enough and a trend line stops being
 * evidence; what is left is the question of which parts of a ship are its
 * technology and which are its identity.
 *
 * **So every invariant breaks except one.** The printed line froze its drive
 * for twenty-seven years — speed 6, the 40-degree template, two acceleration a
 * phase, and a zero at the top of the turn table on every mark from the I to
 * the V. The Mark X kept all of it because five marks is not long enough for
 * any of it to move. Five hundred years is:
 *
 *   - **Speed 8, which is the ceiling the rules themselves impose.** C1.2.7
 *     says no ship may exceed it. This is the first hull in the roster,
 *     printed or fan, to sit on that number, and there is nowhere further to
 *     go — the design is deliberately built against the wall rather than
 *     towards it.
 *   - **No zero in the turn table, and 50 degrees at rest.** Every printed
 *     YORKTOWN is helpless at full burn. This one comes about at any speed it
 *     can make.
 *   - **Three acceleration a phase**, where nothing printed exceeds two.
 *   - **Stress 8 and Damage Control 8**, doubling figures that sat at 4 on all
 *     five printed marks.
 *
 * **What does not break is the hull class and the tube count.** It is size 5,
 * because a YORKTOWN is a heavy cruiser and a heavy cruiser is what the name
 * means — grow it into a dreadnought and the only thing left of the lineage is
 * the paint. And it carries **four torpedo tubes**, as the Mark I did in 3645,
 * because the Union has built its cruisers around four tubes for five hundred
 * and sixty-five years and some things are older than any technology on board.
 * Everything the marks ever added went to the secondary battery, and that is
 * still true here: eight phasers and four light phasers around the same four
 * tubes.
 *
 * **3,247 points — and it is not worth a third of that.** Mirrored, 20 games
 * each at admiral, retreat off:
 *
 *     vs YORKTOWN X      215   20W- 0L   killed 20, lost  0
 *     vs 8x EXETER II    800    2W-18L   killed 26, lost  2
 *     vs 3x TRAFALGAR   1289    5W-15L   killed 11, lost  1
 *     vs 8x YORKTOWN X  1718    0W-20L   killed  0, lost 16
 *     vs 6x TRAFALGAR   2579    0W-20L   killed  0, lost 20
 *
 * It annihilates the Mark X it descends from and never dies doing it. It
 * survives eight EXETER IIs, killing twenty-six of them across twenty games
 * and dying twice — and still loses on points, because a hull worth 3,247
 * bleeds victory points faster than it can earn them. Above about a thousand
 * points of opposition it stops winning, and by two and a half thousand it
 * dies every game without killing anything.
 *
 * **This is the clearest look yet at the thing the point model cannot see:
 * action economy.** The model multiplies offence by defence, so doubling both
 * roughly quadruples the price — 285 of offence and 668 of defence against the
 * UNION X's 104 and 435 is six times the cost. But a ship with twice the guns
 * and twice the screens does not fight four times as well, because it still
 * gets one activation, presents one facing, and stands in one place. Guns that
 * cannot all bear are guns that are not there.
 *
 * That single blind spot explains every lopsided result in this file. The
 * TRAFALGAR at 430 loses to two YORKTOWN Xs at 430. The UNION X at 542 loses
 * to the TRAFALGAR at 430. This hull at 3,247 loses to 800 points of printed
 * cruisers. In each case the cheaper side had more hulls. The model prices
 * parts; the game rewards ships.
 *
 * So take the number as what it is: an honest total of what is bolted to this
 * hull, and a bad estimate of what it is worth in a fight. It is a scenario
 * centrepiece — the thing a whole fleet is sent to deal with — and not a
 * purchase anybody should make with points.
 */
const YORKTOWN_XXX: ShipForm = {
  id: 'fan-union-yorktown-xxx-heavy-cruiser',
  name: 'YORKTOWN XXX-class Heavy Cruiser',
  faction: 'Union of Federated Systems',
  sizeClass: 5,
  stressRating: 8,
  damageControlRating: 8,

  reactors: [
    { id: 'l-main', label: 'L MAIN', hitKind: 'left-main', points: Array.from({ length: 8 }, () => ({ boxes: 3 })) },
    { id: 'r-main', label: 'R MAIN', hitKind: 'right-main', points: Array.from({ length: 8 }, () => ({ boxes: 3 })) },
    { id: 'sl-reac', label: 'SL REAC', hitKind: 'sublight-reactor', points: [{ boxes: 3 }, { boxes: 3 }] },
    { id: 'aux-pwr', label: 'AUX PWR', hitKind: 'aux', points: [{ boxes: 3 }, { boxes: 3 }, { boxes: 3 }, { boxes: 3 }] },
  ],
  batteries: 5,
  ftlDriveBoxes: 4,

  functions: [
    line('accel', 'ACC/DEC', 'accel', [2, 3, 4, 5], { freeValue: 1 }),
    line('sif', 'SIF/IDF', 'sif', [2, 4, 6]),
    line('emer', 'EMER', 'emergency-turn', [1], { sequential: false }),
    line('bat-rech', 'BTY RECH', 'battery-recharge', [1, 2, 3, 4, 5], { sequential: false }),
    line('ftl', 'FTL DRV', 'ftl-drive', [1, 2, 3, 4]),
    ...(['F', 'P', 'S', 'A'] as const).map((side) =>
      line(`rnfc-${side}`, `SHLD RNFC ${side}`, 'shield-reinforce', [1], {
        sequential: false,
        shieldSide: side,
      }),
    ),
    ...(['F', 'P', 'S', 'A'] as const).map((side) =>
      line(`repr-${side}`, `SHLD REPR ${side}`, 'shield-repair', [1], {
        sequential: false,
        shieldSide: side,
      }),
    ),
    line('sensor', 'SENSOR', 'sensor', [12, 16], { freeValue: 8 }),
    line('gen-sys', 'GEN SYS', 'gen-sys', [2], { freeValue: 1 }),
    line('f-a-mat', 'A/MAT TRP', 'weapon', [6, 9], {
      freeValue: 3,
      weaponSystemId: 'mk-30-a-mat-torpedo',
    }),
    line('f-phaser', 'PHASER', 'weapon', [8, 12, 16, 20], {
      freeValue: 4,
      weaponSystemId: 'lnc-9000-phaser',
    }),
    line('f-lt-phaser', 'LT PHASER', 'weapon', [6, 9], {
      freeValue: 3,
      weaponSystemId: 'dgr-40-light-phaser',
    }),
  ],

  weapons: [
    /*
     * Four. Still four. The diamond is still on them too (E4.2.8) — five
     * centuries and antimatter still will not be hurried, which is the sort of
     * detail that makes a lineage feel real.
     */
    weapon({
      id: 'mk-30-a-mat-torpedo',
      name: 'MK-30 A/MAT TORPEDO',
      weaponClass: 'a-mat-torpedo',
      mounts: forward(4),
      armingCircles: 2,
      hitBoxes: 1,
      traits: ['NoBAT', 'FTL'],
      slowArming: true,
      brackets: [
        { min: 0, max: 12, band: 'green', dice: ['red', 'red'], bonus: 2 },
        { min: 13, max: 26, band: 'black', dice: ['red', 'red'] },
        { min: 27, max: 36, band: 'red', dice: ['red'] },
        { min: 37, max: 40, band: 'red', dice: ['yellow'] },
      ],
    }),
    // Eight, where the V had five and the X six. Every mark's growth went
    // here and it kept going.
    weapon({
      id: 'lnc-9000-phaser',
      name: 'LNC-9000 PHASER',
      weaponClass: 'phaser',
      mounts: [...ALL_ROUND, ALL_ARCS, ALL_ARCS, ALL_ARCS, ALL_ARCS],
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 2', 'PD MODE'],
      brackets: [
        { min: 0, max: 6, band: 'green', dice: ['red', 'yellow'], bonus: 2 },
        { min: 7, max: 12, band: 'green', dice: ['yellow', 'yellow'] },
        { min: 13, max: 18, band: 'black', dice: ['yellow', 'green'] },
        { min: 19, max: 23, band: 'black', dice: ['green', 'green'] },
        { min: 24, max: 26, band: 'red', dice: ['green', 'blue'] },
      ],
    }),
    weapon({
      id: 'dgr-40-light-phaser',
      name: 'DGR-40 LIGHT PHASER',
      weaponClass: 'phaser',
      mounts: ALL_ROUND,
      armingCircles: 2,
      hitBoxes: 2,
      traits: ['PREC 2', 'PD MODE'],
      brackets: [
        { min: 0, max: 8, band: 'green', dice: ['yellow', 'green'] },
        { min: 9, max: 13, band: 'black', dice: ['green', 'green'] },
        { min: 14, max: 18, band: 'red', dice: ['green', 'blue'] },
      ],
    }),
  ],

  shields: {
    generatorBoxes: 8,
    blue: { F: 60, A: 54, P: 54, S: 54 },
    green: { F: 8, S: 8, A: 8, P: 8 },
  },
  armor: { F: 0, S: 0, A: 0, P: 0 },

  systems: [
    { kind: 'SCNC', label: 'Sciences', boxes: 8 },
    { kind: 'SENS', label: 'Sensors', boxes: 9 },
    { kind: 'TRAC', label: 'Tractor Beams', boxes: 5 },
    { kind: 'TRAN', label: 'Transporters', boxes: 5 },
    { kind: 'SHTL', label: 'Shuttle Bay', boxes: 4 },
    { kind: 'QTRS', label: 'Quarters', boxes: 6 },
    { kind: 'CMND', label: 'Command Systems', boxes: 7 },
    { kind: 'CRGO', label: 'Cargo', boxes: 4 },
  ],

  structure: [
    ...Array.from({ length: 8 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 8 },
    ...Array.from({ length: 7 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 7 },
    ...Array.from({ length: 7 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 6 },
    ...Array.from({ length: 6 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 5 },
  ],

  sublight: {
    // Eight is the ceiling C1.2.7 sets, and this is the only hull on it.
    maxSpeed: 8,
    turnBySpeed: [50, 45, 45, 40, 40, 35, 30, 25, 20],
    maxAccelPerPhase: 3,
    safeAccelPerRound: 4,
    stressAccelPerRound: 4,
    driveBoxes: 8,
    dmgTopSpeed: [8, 7, 6, 5, 4, 3, 2, 1],
  },

  marineSquads: 16,
  shuttles: 6,

  pointValue: 0,
  year: 4210,
  availability: 'rare',
}

// ---------------------------------------------------------------------------

interface Design {
  form: ShipForm
  /**
   * The sheet's `specialModifier` — its own designer's thumb on the scale, for
   * a hull that plays better or worse than the sum of its parts. Left at 1
   * unless measurement says otherwise, and never guessed: see the note on the
   * Hyperion for the measurement that set its value.
   */
  costModifier?: number
  /** Why the modifier is not 1, in one line, for whoever reads the roster. */
  costNote?: string
}

const DESIGNS: Design[] = [
  {
    form: HYPERION,
    /*
     * The point model prices an armour box like a blue shield box. That is very
     * nearly right for the nine printed Vallari hulls, which carry one to five
     * boxes of it on top of a full set of screens — and badly wrong here, where
     * armour is the entire defence, because the model has no term for the thing
     * that actually separates them: a blue box comes back every round on the
     * REPR line, and G2.2.2 says an armour box never comes back at all.
     *
     * So it is priced where it fights. Mirrored duels at captain, 48 games
     * against each of eight printed hulls, wrecks deciding the result and
     * condition only breaking ties:
     *
     *     YORKTOWN II    30.4   36W-11L      YORKTOWN IV   49.5   27W-21L
     *     YORKTOWN IIc   32.4   46W- 2L      KURSK I       51.9   26W-18L
     *     YORKTOWN III   43.2   32W-15L      UNION I       52.2   30W-16L
     *     HAVOC V-10B    45.6    2W-46L      YORKTOWN V    76.8    3W-43L
     *
     * Even with the YORKTOWN IV at its own printed cost, winning below it and
     * losing above it. The HAVOC is the exception and it is a matchup rather
     * than a mispricing: Vallari particle weapons go through armour the way
     * nothing in the Union inventory does, and a hull whose whole defence is
     * armour has no second answer. It got worse when the plate came down, and
     * it is meant to — this is the ship you do not bring against Vallari.
     */
    costModifier: 0.85,
    costNote: 'armour-only hull: the model cannot see that armour never repairs (G2.2.2)',
  },
  {
    form: OMEGA,
    // Same reason as the Hyperion, same measurement method: an armour-only
    // hull, and the model cannot see that armour never comes back (G2.2.2).
    // The ladder that set this number is in the note above the design.
    costModifier: 0.85,
    costNote: 'armour-only hull: the model cannot see that armour never repairs (G2.2.2)',
  },
  { form: SHARLIN },
  // No modifier: Union screens repair on the REPR line every round, which is
  // exactly what the point model assumes a defence box does. It is only the
  // armour-only hulls above that it misreads.
  { form: TRAFALGAR },
  // Extrapolated rather than designed, so it gets no thumb on the scale
  // either: whatever the model makes of five more marks is the answer.
  { form: YORKTOWN_X },
  // Same discipline, thinner evidence — three printed marks rather than five.
  { form: UNION_X },
  // Doctrine rather than trend: one dreadnought in the roster, fourteen hulls
  // that agree about how the Empire fights.
  { form: IMPERATOR },
  // Not an extrapolation and not pretending to be: five centuries out, the
  // question is which parts of a ship are technology and which are identity.
  { form: YORKTOWN_XXX },
]

/**
 * Price each design, report what the validator makes of it, and write the
 * roster. The printed point value is the one the fleet picker spends, so it is
 * computed here rather than typed in and left to drift.
 */
let failed = false
const roster = DESIGNS.map(({ form, costModifier = 1, costNote }) => {
  const value = pointValue(form, costModifier)
  const problems = validateDesign(form)
  const points = Math.round(value.points * 10) / 10

  console.log(`${form.name} — ${points} points  (size ${form.sizeClass}, ${form.faction})`)
  console.log(
    `   offense ${Math.round(value.totalOffense)}  defence ${Math.round(value.defence)}` +
      `  power ${Math.round(value.actualPower)}  boxes ${value.systemBoxes}`,
  )
  if (costModifier !== 1) {
    const raw = Math.round(pointValue(form).points * 10) / 10
    console.log(`   ×${costModifier} from the model's ${raw} — ${costNote}`)
  }
  for (const p of problems) {
    console.log(`   ${p.severity}: ${p.message}`)
    if (p.severity === 'error') failed = true
  }
  if (problems.length === 0) console.log('   validator: clean')

  return { ...form, pointValue: points }
})

if (failed) {
  console.error('\nRefusing to write the roster: a design has errors.')
  process.exit(1)
}

const out = fileURLToPath(new URL('../src/data/customShips.json', import.meta.url))
writeFileSync(out, JSON.stringify(roster, null, 2) + '\n')
console.log(`\nWrote ${roster.length} design(s) to src/data/customShips.json`)
