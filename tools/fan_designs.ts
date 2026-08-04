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
 * Four corrections got it there, none of which the point model could have
 * told us about, each recorded at the place it applies:
 *
 *   - a broadside whose arcs were not arcs, so the battery never bore;
 *   - a reactor that could not feed four weapon systems;
 *   - a turn table with a zero in the top row;
 *   - armour priced as though it were a shield that repairs.
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

/** Four mounts firing dead ahead, the way a torpedo battery is carried. */
const FORWARD: Arc[][] = [['FS', 'FP'], ['FS', 'FP'], ['FS', 'FP'], ['FS', 'FP']]

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
      roundGates: [true],
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
     * It trades evenly with the YORKTOWN III at 43.2 and loses to everything
     * from 45.6 up, so it is priced where it fights rather than where it
     * totals. (The YORKTOWN IV is the one hull out of line with the rest at
     * 33W-15L; its weapons are identical to the III's, so the difference is in
     * how that matchup plays out, not in the Hyperion. One outlier does not
     * move the price.)
     */
    costModifier: 0.73,
    costNote: 'armour-only hull: the model cannot see that armour never repairs (G2.2.2)',
  },
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
