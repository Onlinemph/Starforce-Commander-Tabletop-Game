/**
 * The Sensor Lab — the designer's workbook, live, with real ships in it.
 *
 * His ask, verbatim: "a spreadsheet similar in format to the one I sent you,
 * that allows us designers to enter data for various situations (speed,
 * sensor quality, etc) to ensure the results are to our liking and that they
 * make sense… spots to enter data about both the searching ship and the
 * target of the search… useful for us to check Claude's work and useful for
 * players."
 *
 * So: this module answers, for a chosen searcher and target and a described
 * situation, exactly what the campaign's own sensor sweep would compute —
 * because it builds its actors the same way `detection.ts` does (unitActor)
 * and calls the same `sensorModel.ts` functions. A number shown here is the
 * number the campaign uses; a test pins that agreement, so the lab can never
 * quietly drift into being a second model.
 *
 * Three things a spreadsheet cell cannot do, and the reason this is a tool
 * rather than a table:
 *  - the per-round truth (§3): sixteen scans a round, so a 5% per-scan
 *    contact is 56% by the round tick. Per-scan numbers alone mislead.
 *  - the sweep: the same pairing across every range at once, which is the
 *    shape a balance judgement actually needs.
 *  - the approach: two ships closing at their real speeds, rolling the real
 *    per-phase odds, answering "at what range do I actually see them?"
 */

import { Rng } from '../engine/dice'
import type { ShipForm } from '../engine/types'
import type { ShipScars } from '../engine/shipState'
import { unitActor, unitIsCloaked } from './detection'
import { damageBand, orderedSpeed, type DamageBand } from './logistics'
import { ROUND_PHASES } from './schedule'
import {
  cumulativeDetection,
  detectionProbability,
  falseContactChance,
  intelligenceProbability,
  reacquisitionProbability,
  retentionProbability,
  SENSOR_MODEL,
  type ScanGeometry,
  type SensorActor,
  type SensorModelConfig,
} from './sensorModel'
import { operationalStats } from './stats'
import type { CampaignMap, Formation, Side, Unit } from './types'

/** Everything the lab lets a designer say about one side of a scan. */
export interface LabShipSetup {
  form: ShipForm
  /** Hexes a round. 0 is a ship holding station — the quietest it gets. */
  speed: number
  /** Active sensors: sharper inside range 2, and +7 signature speed (§5–6). */
  active: boolean
  cloaked: boolean
  /** 3.2's operational bands, as the campaign scores them (fresh/damaged/crippled). */
  damage: DamageBand
  /** Hulls in the unit (6.1) and how they fly (6.2). */
  shipCount: number
  formation: Formation
  /** Terrain the unit occupies: 0 clear, 1 system or dust, 2 nebula. */
  terrain: number
  /** Civilian hulls are three times as findable (E51). */
  civilian: boolean
}

export interface LabSituation {
  searcher: LabShipSetup
  target: LabShipSetup
  range: number
  /** Summed terrain levels of the hexes BETWEEN the two (§15). */
  interveningTerrain: number
  /** Where the track was last held, for retention and reacquisition (B106/B107). */
  previousRange: number
}

/**
 * Marked boxes that land a hull in a given operational band (3.2). The lab
 * describes damage the way a player does — fresh, damaged, crippled — and
 * the campaign reads bands off actual scars, so the lab fabricates the
 * cheapest scar record that lands in the band rather than asserting the
 * band's points directly. That keeps the band's CONSEQUENCES honest too: a
 * crippled hull cannot hold a cloak, and the campaign is what says so.
 */
function scarsForBand(form: ShipForm, band: DamageBand): ShipScars | undefined {
  if (band === 'fresh') return undefined
  const scars: ShipScars = {
    structure: 0,
    reactors: {},
    batteries: [],
    ftl: 0,
    systems: {},
    scout: 0,
    shieldGenerator: 0,
    armor: { F: 0, S: 0, A: 0, P: 0 },
    mounts: {},
  }
  const reached = () => damageBand({ id: 'lab', formId: form.id, name: form.name, scars }) === band
  /*
   * Mark boxes until the hull reads in the band asked for. Structure first
   * (it is the heaviest at two hit points a box), then the internal tracks —
   * a crippled hull is past sixty percent of everything, which structure
   * alone cannot always reach on a hull with a deep internal chart.
   */
  const slots: Array<[number, (n: number) => void]> = [
    [form.structure.filter((e) => e.kind === 'box').length, (n) => (scars.structure = n)],
    [form.ftlDriveBoxes, (n) => (scars.ftl = n)],
    [form.shields.generatorBoxes, (n) => (scars.shieldGenerator = n)],
    [form.sublight.driveBoxes, (n) => (scars.systems['__sublight'] = n)],
    ...form.systems.map(
      (group) => [group.boxes, (n: number) => (scars.systems[group.label] = n)] as [number, (n: number) => void],
    ),
  ]
  for (const [capacity, mark] of slots) {
    for (let n = 1; n <= capacity; n++) {
      mark(n)
      if (reached()) return scars
    }
  }
  return reached() ? scars : undefined
}

/**
 * The lab's situation as a campaign UNIT — the same object the resolver
 * moves and the sweep scans. Everything downstream then runs the campaign's
 * own code: this is why the lab cannot drift into being a second model.
 */
export function labUnit(setup: LabShipSetup, side: Side = 'A'): Unit {
  const scars = scarsForBand(setup.form, setup.damage)
  const count = Math.max(1, Math.round(setup.shipCount))
  return {
    id: 'lab',
    side,
    // A civilian hull is a convoy to the campaign — which is also what caps
    // merchant speeds at 1–3 (the designer's note), so the lab inherits that.
    kind: setup.civilian ? 'convoy' : count > 1 ? 'group' : 'ship',
    ships: Array.from({ length: count }, (_, i) => ({
      id: `lab-s${i + 1}`,
      formId: setup.form.id,
      name: setup.form.name,
      ...(scars ? { scars: structuredClone(scars) } : {}),
    })),
    hex: { q: 0, r: 0 },
    order: {
      waypoints: [],
      // The typed speed is an exact-speed order, so the campaign's own
      // envelope clamps it: the lab can only describe situations the
      // campaign could actually produce (see `effectiveSpeed`).
      speed: 'emergency',
      exactSpeed: Math.max(0, Math.round(setup.speed)),
      sensorPower: 1,
      activeSensors: setup.active,
      cloaked: setup.cloaked,
      formation: setup.formation,
    },
    moveDebt: 0,
    endurance: 8,
    enduranceMax: 8,
    cloakedThisRound: false,
    movedLastOwnPhase: setup.speed > 0,
    course: null,
  }
}

/** A one-hex chart carrying the terrain the setup says the unit occupies. */
function labMap(terrain: number): CampaignMap {
  return {
    width: 4,
    height: 4,
    terrain: terrain >= 2
      ? [{ q: 0, r: 0, kind: 'nebula' }]
      : terrain === 1
        ? [{ q: 0, r: 0, kind: 'system' }]
        : [],
    border: [],
  }
}

/**
 * One side of the scan as the sensor model's actor — built by the CAMPAIGN's
 * own `unitActor`, not a copy of it. The close-formation rules, the damage
 * bands, the dry-tank and crippled-hull cloak refusals and the civilian
 * speed cap all come along for free, because this is the same call the
 * campaign's sweep makes.
 */
export function labActor(setup: LabShipSetup, role: 'searcher' | 'target'): SensorActor {
  return unitActor(labMap(setup.terrain), labUnit(setup), role)
}

/** The speed the campaign would actually let this hull make, after clamping. */
export function effectiveSpeed(setup: LabShipSetup): number {
  return orderedSpeed(labUnit(setup))
}

/** Can this hull even run a cloak (H6)? The lab greys the switch when not. */
export function cloakCapable(form: ShipForm): boolean {
  return operationalStats(form).cloak
}

/** Would the campaign honor a cloak order here — crippled hulls cannot (3.2). */
export function cloakEffective(setup: LabShipSetup): boolean {
  return unitIsCloaked(labUnit(setup))
}

export interface LabReading {
  /** Per-scan, the campaign's own numbers. */
  detection: number
  intelligence: number
  /** §3 over one round's sixteen scans — the number that decides a hunt. */
  detectionPerRound: number
  intelligencePerRound: number
  /** Phases (scans) until an even chance, ∞ when the per-scan odds are zero. */
  scansToEven: number
  /** B106/B107, given the previous range in the situation. */
  retention: number
  reacquisition: number
  /** B108, per scan, for the searcher's own sensor mode. */
  falseContact: number
  /** Every factor of the product, named — the workbook's own columns. */
  detectionFactors: Record<string, number>
  intelligenceFactors: Record<string, number>
}

/** Everything the model says about one situation. */
export function readSituation(
  situation: LabSituation,
  cfg: SensorModelConfig = SENSOR_MODEL,
): LabReading {
  const searcher = labActor(situation.searcher, 'searcher')
  const target = labActor(situation.target, 'target')
  const geom: ScanGeometry = {
    range: situation.range,
    interveningTerrain: situation.interveningTerrain,
  }
  const det = detectionProbability(searcher, target, geom, cfg)
  const intel = intelligenceProbability(searcher, target, geom, cfg)
  const perRound = (p: number) => cumulativeDetection(new Array(ROUND_PHASES).fill(p))
  return {
    detection: det.p,
    intelligence: intel.p,
    detectionPerRound: perRound(det.p),
    intelligencePerRound: perRound(intel.p),
    // 1 − (1 − p)^n = 0.5  →  n = ln(0.5) / ln(1 − p).
    scansToEven: det.p <= 0 ? Infinity : det.p >= 1 ? 1 : Math.log(0.5) / Math.log(1 - det.p),
    retention: retentionProbability(situation.previousRange, situation.range, intel.p, cfg),
    reacquisition: reacquisitionProbability(
      det.p,
      situation.previousRange,
      situation.range,
      intel.p,
      cfg,
    ),
    falseContact: falseContactChance(searcher.active, cfg),
    detectionFactors: det.factors,
    intelligenceFactors: intel.factors,
  }
}

export interface SweepRow {
  range: number
  detection: number
  intelligence: number
  detectionPerRound: number
  retention: number
  reacquisition: number
}

/**
 * The same pairing at every range — the shape a balance judgement needs.
 * Retention and reacquisition are read as if the track were held at that
 * same range last phase (a steady shadow), which is the honest baseline.
 */
export function rangeSweep(
  situation: LabSituation,
  maxRange = 10,
  cfg: SensorModelConfig = SENSOR_MODEL,
): SweepRow[] {
  const rows: SweepRow[] = []
  for (let range = 0; range <= maxRange; range++) {
    const at = readSituation({ ...situation, range, previousRange: range }, cfg)
    rows.push({
      range,
      detection: at.detection,
      intelligence: at.intelligence,
      detectionPerRound: at.detectionPerRound,
      retention: at.retention,
      reacquisition: at.reacquisition,
    })
  }
  return rows
}

export interface ApproachResult {
  /** Trials that ended in contact before the closing was over. */
  detected: number
  trials: number
  /** Range at first contact, per detected trial — the distribution that matters. */
  rangeAtContact: number[]
  /** Mean range at contact, or null when nobody was ever seen. */
  meanRange: number | null
  /** How the contacts fell by range, for a histogram. */
  byRange: Array<{ range: number; contacts: number }>
  /** Mean phases elapsed before contact. */
  meanPhases: number | null
}

/**
 * The approach: the target closes from `startRange` at its own speed while
 * the searcher scans every phase, rolling the real per-phase odds against a
 * shrinking range. Answers the question a designer actually asks — "does my
 * picket see them at six hexes, or at two?" — and it is exactly the
 * campaign's own arithmetic, one phase at a time.
 *
 * Seeded, so a run is reproducible and two people comparing notes see the
 * same numbers.
 */
export function approachTrials(
  situation: LabSituation,
  options: { startRange?: number; trials?: number; seed?: number } = {},
  cfg: SensorModelConfig = SENSOR_MODEL,
): ApproachResult {
  const startRange = options.startRange ?? 10
  const trials = options.trials ?? 500
  const rng = new Rng(options.seed ?? 12345)

  // The closing rate: hexes a phase, from the pair's speeds over the
  // sixteen-phase round (schedule.ts). A pair that never closes still gets
  // one full round of scans at the opening range.
  const closingPerPhase = Math.max(
    0,
    (Math.max(0, situation.searcher.speed) + Math.max(0, situation.target.speed)) / ROUND_PHASES,
  )
  // Pre-compute per-range odds: the loop rolls, it does not re-derive.
  const odds = new Map<number, number>()
  for (let r = 0; r <= startRange; r++) {
    odds.set(r, readSituation({ ...situation, range: r, previousRange: r }, cfg).detection)
  }

  const rangeAtContact: number[] = []
  const phasesAtContact: number[] = []
  const histogram = new Map<number, number>()
  for (let trial = 0; trial < trials; trial++) {
    let range = startRange
    // A closing pair gets the phases the approach lasts; a pair that never
    // closes gets one round, which is the sensible bound on "an encounter".
    const phaseCap = closingPerPhase > 0 ? Math.ceil(startRange / closingPerPhase) + 1 : ROUND_PHASES
    for (let phase = 1; phase <= phaseCap; phase++) {
      const band = Math.max(0, Math.round(range))
      const p = odds.get(band) ?? readSituation({ ...situation, range: band, previousRange: band }, cfg).detection
      if (p > 0 && rng.next() < p) {
        rangeAtContact.push(band)
        phasesAtContact.push(phase)
        histogram.set(band, (histogram.get(band) ?? 0) + 1)
        break
      }
      range = Math.max(0, range - closingPerPhase)
    }
  }

  const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const byRange: Array<{ range: number; contacts: number }> = []
  for (let r = startRange; r >= 0; r--) byRange.push({ range: r, contacts: histogram.get(r) ?? 0 })
  return {
    detected: rangeAtContact.length,
    trials,
    rangeAtContact,
    meanRange: mean(rangeAtContact),
    byRange,
    meanPhases: mean(phasesAtContact),
  }
}

/** The sweep as a spreadsheet, for the designer who asked for one. */
export function sweepCsv(situation: LabSituation, rows: SweepRow[]): string {
  const pct = (p: number) => (p * 100).toFixed(2)
  const head = [
    `# StarForce Commander — sensor model sweep`,
    `# Searcher: ${situation.searcher.form.name} · speed ${situation.searcher.speed} · ` +
      `${situation.searcher.active ? 'active' : 'passive'} · terrain ${situation.searcher.terrain}`,
    `# Target: ${situation.target.form.name} · speed ${situation.target.speed} · ` +
      `${situation.target.cloaked ? 'cloaked' : 'uncloaked'} · ${situation.target.damage} · ` +
      `${situation.target.shipCount} hull(s) ${situation.target.formation} · terrain ${situation.target.terrain}` +
      `${situation.target.civilian ? ' · civilian' : ''}`,
    `# Intervening terrain: ${situation.interveningTerrain}`,
    `range,detection %,intelligence %,detection % per round (16 scans),retention %,reacquisition %`,
  ]
  const body = rows.map((r) =>
    [
      r.range,
      pct(r.detection),
      pct(r.intelligence),
      pct(r.detectionPerRound),
      pct(r.retention),
      pct(r.reacquisition),
    ].join(','),
  )
  return [...head, ...body].join('\n') + '\n'
}
