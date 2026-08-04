/**
 * Fan designs: ships from other settings, built as StarForce hulls.
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
}): WeaponSystemDef {
  return {
    id: args.id,
    name: args.name,
    weaponClass: args.weaponClass,
    mounts: args.mounts.map((arcs, i) => ({
      id: `${args.id}-m${i + 1}`,
      arcs,
      armingCircles: args.armingCircles,
      hitBoxes: args.hitBoxes,
      ...(args.slowArming ? { roundGates: [true] } : {}),
    })),
    brackets: args.brackets,
    traits: args.traits ?? [],
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
   */
  armor: { F: 60, S: 48, A: 36, P: 48 },

  systems: [
    { kind: 'SCNC', label: 'Sciences', boxes: 3 },
    { kind: 'SENS', label: 'Sensors', boxes: 3 },
    // No tractor beams and no transporters: Earth Alliance ships have neither.
    { kind: 'SHTL', label: 'Fighter Bays', boxes: 4 },
    { kind: 'QTRS', label: 'Quarters', boxes: 2 },
    { kind: 'CRGO', label: 'Cargo', boxes: 2 },
  ],

  structure: [
    ...Array.from({ length: 6 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 4 },
    ...Array.from({ length: 5 }, () => ({ kind: 'box' as const, color: 'black' as const })),
    { kind: 'dc' as const, rating: 3 },
    ...Array.from({ length: 4 }, () => ({ kind: 'box' as const, color: 'red' as const })),
    { kind: 'dc' as const, rating: 2 },
    ...Array.from({ length: 3 }, () => ({ kind: 'box' as const, color: 'red' as const })),
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
 * is a threshold, not a slope: an enemy whose targeting can nearly match it
 * fights an even battle, and one whose targeting cannot is simply out of range
 * under H2.3.7. So it is not priced by finding the hull it draws with — there
 * isn't one — but by where the whole ladder balances. Forty-eight mirrored
 * games at captain against each:
 *
 *     YORKTOWN III   43.2   45W- 3L      PREDATOR V-11B    72.6   17W-30L
 *     UNION I        52.2   33W-14L      EXETER I          85.2   13W-34L
 *     UNION II       75.4   39W- 9L      EXETER II         95.6    3W-45L
 *     PREDATOR V-11C  147   42W- 6L      UNION III        158.6   28W-20L
 *
 * Read by price that is nonsense. Read by the opponent's sensor suite it is
 * exactly the ship: the EXETERs carry the best sensors in the printed game —
 * four boxes and an eight-point line — and they are the two hulls that beat
 * it, because four targeting against six jamming is a fight. The dreadnoughts
 * it walks through are the ones with three sensor boxes, whatever they cost:
 * the V-11C is a 147-point ship that cannot get a lock. Against those it wins
 * without killing anything — it is not out-shooting them, they are out of
 * range.
 *
 * Left at the model's own 94 with no thumb on the scale. That is above where
 * the median matchup puts it, and deliberately so: a hull that hard-counters
 * whole classes of opponent should be the expensive answer rather than the
 * efficient one.
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
  armor: { F: 0, S: 0, A: 0, P: 0 },

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
     * So the model prints 60.3 and the ship does not fight like a 60-point
     * ship. Mirrored duels at captain, 48 games against each of eight printed
     * hulls, with health read as a fraction of each hull's own structure so
     * that having more boxes than the other ship is not itself a win:
     *
     *     YORKTOWN I     23.0   36W-10L      KURSK I        51.9   11W-36L
     *     YORKTOWN II    30.4   39W- 9L      HAVOC V-10B    45.6    9W-38L
     *     YORKTOWN IIc   32.4   34W-12L      HAVOC V-10D    58.6    9W-32L
     *     YORKTOWN III   43.2   27W-21L
     *
     * Re-measured after the slow-arming diamond came off the guns, which is
     * what these numbers are:
     *
     *     YORKTOWN II    30.4   36W-11L      YORKTOWN IV   49.5   34W-13L
     *     YORKTOWN IIc   32.4   44W- 3L      KURSK I       51.9   29W-17L
     *     YORKTOWN III   43.2   43W- 5L      UNION I       52.2   30W-14L
     *     HAVOC V-10B    45.6   15W-33L      YORKTOWN V    76.8   11W-34L
     *
     * It takes everything up to the low fifties and loses to the high
     * seventies, so it is priced near sixty rather than at the 68.3 the model
     * totals. The HAVOC is the one hull below that line which beats it, and
     * that is a matchup rather than a mispricing — Vallari particle weapons go
     * through armour the way nothing in the Union inventory does.
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
