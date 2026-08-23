/**
 * Detection — the heart of the game (design doc Part 4).
 *
 * Submarine-style: after every phase's movement, EVERY unit on the table
 * makes a scan against every enemy unit, both sides, sixteen sweeps a round.
 * The probabilities are the designer's sensor model (sensorModel.ts — his
 * workbook, cell for cell); this module is the campaign around it: track
 * states per contact, the attribute ladder a separate intelligence roll
 * climbs one rung at a time — each rung independently capable of being a
 * lie — ghosts from false-contact rolls, and the decay of a picture nobody
 * refreshes.
 *
 * Everything here runs on the umpire's side of the wall. Player-facing code
 * sees the results only through `views.ts`.
 */

import { registerCustomForms, FILE_FORMS, SHIP_FORMS, shipFormById } from '../data/ships'
import type { ShipForm } from '../engine/types'
import { hexDistance, hexEquals, hexNeighbors, hexStepToward, inBounds, terrainAt } from './hexmap'
import { orderedSpeed, unitDamageBand } from './logistics'
import {
  detectionProbability,
  falseContactChance,
  formationNumber,
  intelligenceProbability,
  reacquisitionProbability,
  resolveSensorModel,
  retentionProbability,
  type ScanGeometry,
  type SensorActor,
  type SensorModelConfig,
} from './sensorModel'
import { operationalStats, type OperationalStats } from './stats'
import {
  CONTACT_ATTRIBUTES,
  nextInt,
  nextRandom,
  type CampaignMap,
  type CampaignScenario,
  type CampaignState,
  type ContactAttribute,
  type ContactRecord,
  type Hex,
  type Infrastructure,
  type Side,
  type TerrainKind,
  type TrackState,
  type Unit,
} from './types'

registerCustomForms(FILE_FORMS)

// ---------------------------------------------------------------------------
// Operational profiles
// ---------------------------------------------------------------------------

const statsCache = new Map<string, OperationalStats>()

function statsFor(formId: string): OperationalStats {
  let s = statsCache.get(formId)
  if (!s) {
    const form = shipFormById(formId)
    if (!form) throw new Error(`No such form: ${formId}`)
    s = operationalStats(form)
    statsCache.set(formId, s)
  }
  return s
}

/**
 * A unit's profile is its ships' stats folded together: as loud as its
 * loudest member (6.2 — close formation makes that explicit and the others
 * inherit it), as sharp as its best set of eyes, cloaked only if every hull
 * aboard can cloak.
 */
export function unitProfile(unit: Unit): {
  signature: number
  sensorRating: number
  /** Rating at each sensor power setting, index = power 0/1/2 (stats.ts). */
  sensorRatings: [number, number, number]
  sciences: number
  cloakCapable: boolean
} {
  const all = unit.ships.map((s) => statsFor(s.formId))
  /*
   * Battle scars change how a hull sounds and sees (3.2's operational
   * bands): a damaged ship searches one point worse; a crippled one leaks
   * two points of signature and cannot hold a cloak at all.
   */
  const band = unitDamageBand(unit)
  const wound = band === 'damaged' ? 1 : 0
  const ratingAt = (power: 0 | 1 | 2) =>
    Math.max(1, Math.max(...all.map((s) => s.sensorRatings[power])) - wound)
  return {
    signature: Math.max(...all.map((s) => s.signature)) + (band === 'crippled' ? 2 : 0),
    sensorRating: ratingAt(2),
    sensorRatings: [ratingAt(0), ratingAt(1), ratingAt(2)],
    sciences: Math.max(...all.map((s) => s.sciences)),
    cloakCapable: all.every((s) => s.cloak) && band !== 'crippled',
  }
}

export function unitIsCloaked(unit: Unit): boolean {
  // An empty tank cannot feed a cloak (6.4).
  return unit.order.cloaked && unit.endurance > 0 && unitProfile(unit).cloakCapable
}

// ---------------------------------------------------------------------------
// Actors for the sensor model (sensorModel.ts — the designer's briefing)
// ---------------------------------------------------------------------------

/** Terrain levels the orders doc names: a system is 1, a nebula 2. */
function terrainLevelOf(kind: TerrainKind): number {
  switch (kind) {
    case 'nebula':
      return 2
    case 'system':
    case 'dust':
      return 1
    default:
      return 0
  }
}

/** Close formation with company: the redesign's special rules apply (6.2). */
function inCloseFormation(unit: Unit): boolean {
  return unit.order.formation === 'close' && unit.ships.length > 1
}

/**
 * A unit as the sensor model's actor: the workbook's yellow input table read
 * off the fleet's forms, folded the way units fold — as loud as the loudest
 * hull, as sharp as the best SENS rating, as big as the biggest hull. On the
 * target side damage is the sheet's points scale (E49's 20-points-per-band
 * reading of the campaign damage bands).
 *
 * The designer's close formation bends both roles: searching, only the lead
 * ship works its scopes (best SENS aboard; ITS stats, not a committee's), and
 * as a target the group reads as ONE contact — ship count 1 in the difficulty
 * stack, the truth findable only through the count rung's 25% peek.
 */
function unitActor(map: CampaignMap, unit: Unit, role: 'searcher' | 'target'): SensorActor {
  const all = unit.ships.map((s) => statsFor(s.formId))
  const band = unitDamageBand(unit)
  const close = inCloseFormation(unit)
  // The lead scanner: the hull with the best SENS rating, whole.
  const scanners =
    role === 'searcher' && close
      ? [all.reduce((best, s) => (s.sensBoxes > best.sensBoxes ? s : best))]
      : all
  return {
    sens: Math.max(...scanners.map((s) => s.sensBoxes)),
    scoutSensors: Math.max(...scanners.map((s) => s.scoutSensors)),
    command: Math.max(...scanners.map((s) => s.commandBoxes)),
    sciences: Math.max(...scanners.map((s) => s.sciencesRaw)),
    actualPower:
      role === 'searcher'
        ? Math.max(...scanners.map((s) => s.actualPower))
        : Math.max(...all.map((s) => s.actualPower)),
    sp0: Math.max(...scanners.map((s) => s.sensorValues[0])),
    sp1: Math.max(...scanners.map((s) => s.sensorValues[1])),
    sp2: Math.max(...scanners.map((s) => s.sensorValues[2])),
    sizeClass: Math.max(...all.map((s) => s.sizeClass)),
    speed: unit.movedLastOwnPhase ? orderedSpeed(unit) : 0,
    // A dry tank cannot feed an active sweep (6.4).
    active: (unit.order.activeSensors ?? false) && unit.endurance > 0,
    cloaked: unitIsCloaked(unit),
    unitType: unit.kind === 'convoy' ? 'civilian' : 'military',
    damage: band === 'crippled' ? 40 : band === 'damaged' ? 20 : 0,
    formation: formationNumber(unit.order.formation, unit.ships.length),
    // "Appear as 1 Target": the difficulty stack counts one hull.
    shipCount: close && role === 'target' ? 1 : unit.ships.length,
    terrain: terrainLevelOf(terrainAt(map, unit.hex)),
  }
}

/** Summed terrain levels of the hexes strictly between two positions (§15). */
function interveningTerrain(map: CampaignMap, from: Hex, to: Hex): number {
  let total = 0
  let at = from
  for (let guard = 0; guard < 64; guard++) {
    if (hexEquals(at, to)) break
    at = hexStepToward(at, to)
    if (hexEquals(at, to)) break
    total += terrainLevelOf(terrainAt(map, at))
  }
  return total
}

// ---------------------------------------------------------------------------
// Truth about a target, one attribute at a time (4.4)
// ---------------------------------------------------------------------------

function sizeBand(sizeClass: number): string {
  if (sizeClass <= 2) return 'small'
  if (sizeClass <= 4) return 'medium'
  if (sizeClass <= 6) return 'large'
  return 'huge'
}

function biggestForm(unit: Unit): ShipForm {
  let best = shipFormById(unit.ships[0].formId)!
  for (const s of unit.ships.slice(1)) {
    const f = shipFormById(s.formId)!
    if (f.sizeClass > best.sizeClass) best = f
  }
  return best
}

/** The true value of one ladder rung for a unit target. */
export function trueAttribute(unit: Unit, attr: ContactAttribute): string {
  const lead = biggestForm(unit)
  switch (attr) {
    case 'exists':
      return 'yes'
    case 'bearingClass':
      return unit.kind === 'convoy' ? 'civilian' : 'military'
    case 'sizeClass':
      return sizeBand(lead.sizeClass)
    case 'speed':
      return unit.movedLastOwnPhase ? 'cruising' : 'holding'
    case 'count':
      return String(unit.ships.length)
    case 'faction':
      return lead.faction
    case 'damage':
      return unitDamageBand(unit)
    case 'shipClass':
      return lead.name
    case 'shipName':
      return unit.ships.find((s) => s.formId === lead.id)?.name ?? unit.ships[0].name
  }
}

/**
 * The ladder for one target, in resolution order. Identification needs range
 * three or a scout block (4.4); a close formation's count hides behind its
 * own probabilistic gate, rolled at climb time (the designer's 25% peek).
 */
function ladderFor(): ContactAttribute[] {
  return [...CONTACT_ATTRIBUTES]
}

function rungGate(attr: ContactAttribute, range: number, searcherScout: boolean): boolean {
  if ((attr === 'shipClass' || attr === 'shipName') && range > 3 && !searcherScout) return false
  return true
}

// ---------------------------------------------------------------------------
// Misinformation (4.5)
// ---------------------------------------------------------------------------

/** Same-faction, same-size-band classes, sorted for determinism. */
function plausibleClasses(faction: string, size: string): string[] {
  return SHIP_FORMS.filter(
    (f) => !f.id.startsWith('fan-') && f.faction === faction && sizeBand(f.sizeClass) === size,
  )
    .map((f) => f.name)
    .sort()
}

/**
 * A false value that could be true (4.5): drawn from the same category,
 * stable once drawn, and never absurd — a wrong count is off by one or two,
 * a wrong class is a real class of the same faction and size band.
 */
function falseAttribute(
  state: CampaignState,
  target: Unit,
  attr: ContactAttribute,
  truth: string,
): string {
  const rng = state.rng
  switch (attr) {
    case 'bearingClass':
      return truth === 'military' ? 'civilian' : 'military'
    case 'sizeClass': {
      const bands = ['small', 'medium', 'large', 'huge']
      const i = bands.indexOf(truth)
      const shifted = i + (nextInt(rng, 2) === 0 ? -1 : 1)
      return bands[Math.max(0, Math.min(bands.length - 1, shifted === i ? i + 1 : shifted))]
    }
    case 'speed':
      return truth === 'cruising' ? 'holding' : 'cruising'
    case 'count': {
      const n = Number(truth)
      const off = 1 + nextInt(rng, 2)
      return String(Math.max(1, n + (nextInt(rng, 2) === 0 ? -off : off)))
    }
    case 'faction': {
      const others = factionPool().filter((f) => f !== truth)
      return others[nextInt(rng, others.length)] ?? truth
    }
    case 'damage': {
      const bands = ['fresh', 'damaged', 'crippled']
      const i = bands.indexOf(truth)
      return bands[i === 0 ? 1 : i - 1] ?? 'damaged'
    }
    case 'shipClass': {
      const pool = plausibleClasses(biggestForm(target).faction, sizeBand(biggestForm(target).sizeClass)).filter(
        (n) => n !== truth,
      )
      return pool.length > 0 ? pool[nextInt(rng, pool.length)] : truth
    }
    case 'shipName':
      return `${truth.replace(/\s+\S+$/, '')} (unverified)`
    case 'exists':
      // 4.5's design guard: presence is never a lie.
      return truth
  }
}

let factionsCache: string[] | null = null
/** The factions that exist in the data, not a hardcoded guess at their names. */
function factionPool(): string[] {
  if (!factionsCache) {
    factionsCache = [
      ...new Set(SHIP_FORMS.filter((f) => !f.id.startsWith('fan-')).map((f) => f.faction)),
    ].sort()
  }
  return factionsCache
}

function misinformationChance(
  scenario: CampaignScenario,
  range: number,
  targetTerrain: TerrainKind,
  searcherSciences: number,
): number {
  let p = scenario.tuning.misinformationBase
  if (range >= 4) p += 0.1
  if (targetTerrain === 'nebula' || targetTerrain === 'dust') p += 0.1
  if (searcherSciences >= 3) p -= 0.1
  return Math.max(0, p)
}

// ---------------------------------------------------------------------------
// The sweep (4.1) — called by resolvePhase after every phase's movement
// ---------------------------------------------------------------------------

export interface DetectionContext {
  map: CampaignMap
  scenario: CampaignScenario
}

function findContact(state: CampaignState, side: Side, targetId: string): ContactRecord | undefined {
  return state.contacts.find((c) => c.side === side && c.targetUnitId === targetId)
}

function newContact(state: CampaignState, side: Side, targetId: string, hex: Hex): ContactRecord {
  const record: ContactRecord = {
    id: `ct-${side}-${state.contactSeq++}`,
    side,
    targetUnitId: targetId,
    attributes: {},
    estimatedHex: { ...hex },
    positionEstimated: false,
    lastScan: { round: state.round, phase: state.phase },
    unscannedRounds: 0,
    course: null,
    observedMoving: false,
  }
  state.contacts.push(record)
  return record
}

/**
 * A successful detection (or retention, or reacquisition) lands: position
 * updates to truth (a first sighting past range two lands ±1 — 4.4), the
 * track state advances (briefing §13), and 'exists' resolves — detection
 * alone says something is there, whatever intelligence later makes of it.
 */
function landDetection(
  state: CampaignState,
  side: Side,
  target: Unit,
  range: number,
  prevTrack: TrackState | null,
): { contact: ContactRecord; existsWasNew: boolean } {
  let contact = findContact(state, side, target.id)
  const firstScan = !contact
  if (!contact) contact = newContact(state, side, target.id, target.hex)

  // Position: truth, except a first sighting past range two lands ±1 (4.4).
  if (firstScan && range > 2) {
    const options = [target.hex, ...hexNeighbors(target.hex)]
    contact.estimatedHex = { ...options[nextInt(state.rng, options.length)] }
    contact.positionEstimated = true
  } else {
    contact.estimatedHex = { ...target.hex }
    contact.positionEstimated = false
  }
  contact.lastScan = { round: state.round, phase: state.phase }
  contact.unscannedRounds = 0
  contact.course = target.course ? { ...target.course } : null
  contact.observedMoving = target.movedLastOwnPhase
  contact.track = prevTrack === null ? 'detected' : prevTrack === 'track-lost' ? 'reacquired' : 'tracked'

  const existsWasNew = !contact.attributes.exists
  if (existsWasNew) {
    // Presence is never a lie for a real unit (4.5).
    contact.attributes.exists = { value: 'yes', truthful: true, resolvedAtRange: range, stale: false }
  }
  return { contact, existsWasNew }
}

/**
 * A successful intelligence check climbs the ladder (§12 — a separate roll
 * from detection: detected is not identified). Sciences three or better
 * resolves two rungs per success; the scan that first resolved 'exists'
 * already spent one of them. A rung resolved *falsely* is re-rolled by any
 * success at closer range than the lie was bought at, truth replacing it on
 * a clean roll (4.5).
 */
function landIntel(
  ctx: DetectionContext,
  state: CampaignState,
  searcherSciences: number,
  searcherScout: boolean,
  target: Unit,
  range: number,
  contact: ContactRecord,
  existsWasNew: boolean,
  cfg: SensorModelConfig,
): void {
  const ladder = ladderFor()
  const targetTerrain = terrainAt(ctx.map, target.hex)
  let rungs = (searcherSciences >= 3 ? 2 : 1) - (existsWasNew ? 1 : 0)
  if (rungs <= 0) return

  // Corrections first: a lie bought at longer range is re-examined by this
  // closer look, and the re-roll spends this scan's rung (4.5).
  for (const attr of ladder) {
    if (rungs === 0) break
    const entry = contact.attributes[attr]
    if (!entry || entry.truthful || range >= entry.resolvedAtRange) continue
    rungs -= 1
    const lie = nextRandom(state.rng) < misinformationChance(ctx.scenario, range, targetTerrain, searcherSciences)
    if (!lie) {
      contact.attributes[attr] = {
        value: trueAttribute(target, attr),
        truthful: true,
        resolvedAtRange: range,
        stale: false,
      }
    } else {
      entry.resolvedAtRange = range
    }
  }

  // Then the next unresolved rungs, stopping at a gate rather than skipping
  // past it — the ladder's order is the information's order.
  for (const attr of ladder) {
    if (rungs === 0) break
    if (contact.attributes[attr]) {
      contact.attributes[attr]!.stale = false
      continue
    }
    if (!rungGate(attr, range, searcherScout)) break
    // A close formation reads as one target (6.2, the designer's redesign):
    // each scan has only a 25% chance to peek past the lead hull and count.
    if (
      attr === 'count' &&
      inCloseFormation(target) &&
      nextRandom(state.rng) >= cfg.closeFormationCountChance
    ) {
      break
    }
    rungs -= 1
    const truth = trueAttribute(target, attr)
    const never = attr === 'exists' // presence is never false (4.5)
    const lie =
      !never &&
      nextRandom(state.rng) < misinformationChance(ctx.scenario, range, targetTerrain, searcherSciences)
    contact.attributes[attr] = {
      value: lie ? falseAttribute(state, target, attr, truth) : truth,
      truthful: !lie,
      resolvedAtRange: range,
      stale: false,
    }
  }
}

/** Infrastructure that scans (3.4). Listening posts roll; the rest radiate certainty. */
function infrastructureSweep(
  ctx: DetectionContext,
  state: CampaignState,
  station: Infrastructure,
  cfg: SensorModelConfig,
): void {
  if (station.destroyed) return
  for (const target of state.units) {
    if (target.side === station.side) continue
    const range = hexDistance(station.hex, target.hex)
    const cloaked = unitIsCloaked(target)
    if (station.kind === 'jump-beacon') continue
    if (station.kind === 'listening-post') {
      // Passive 3 (3.4): the sensor model from a fixed, silent station,
      // hard-capped at three hexes.
      if (range > 3) continue
      const geom: ScanGeometry = {
        range,
        interveningTerrain: interveningTerrain(ctx.map, station.hex, target.hex),
      }
      const det = detectionProbability(LISTENING_POST_ACTOR, unitActor(ctx.map, target, 'target'), geom, cfg)
      if (det.p > 0 && (det.p >= 1 || nextRandom(state.rng) < det.p)) {
        const existing = findContact(state, station.side, target.id)
        const prev = existing && !contactCollapsed(existing) ? (existing.track ?? 'tracked') : null
        const landed = landDetection(state, station.side, target, range, prev)
        landed.contact.lastRange = range
      }
      continue
    }
    // Fleet base ≤4, outpost ≤2, colony ≤1: automatic contact on anything
    // non-cloaked inside the radar picket — no roll, no misinformation.
    const radius = station.kind === 'fleet-base' ? 4 : station.kind === 'outpost' ? 2 : 1
    if (cloaked || range > radius) continue
    landScanCertain(state, station.side, target)
  }
}

/** A fixed watchstation: the workbook's baseline ship, bolted down (3.4). */
const LISTENING_POST_ACTOR: SensorActor = {
  sens: 3,
  scoutSensors: 0,
  command: 0,
  sciences: 3,
  actualPower: 100,
  sp0: 2,
  sp1: 4,
  sp2: 6,
  sizeClass: 3,
  speed: 0,
  active: false,
  cloaked: false,
  unitType: 'military',
  damage: 0,
  formation: 0,
  shipCount: 1,
  terrain: 0,
}

/** A radar-certain fix: exists and true position, nothing else, no lies. */
function landScanCertain(state: CampaignState, side: Side, target: Unit): void {
  let contact = findContact(state, side, target.id)
  if (!contact) contact = newContact(state, side, target.id, target.hex)
  contact.estimatedHex = { ...target.hex }
  contact.positionEstimated = false
  contact.lastScan = { round: state.round, phase: state.phase }
  contact.unscannedRounds = 0
  contact.course = target.course ? { ...target.course } : null
  contact.observedMoving = target.movedLastOwnPhase
  if (!contact.attributes.exists) {
    contact.attributes.exists = { value: 'yes', truthful: true, resolvedAtRange: 0, stale: false }
  }
}

/**
 * The sweep after one phase's movement (4.1, briefing §1): both sides, every
 * unit, fixed iteration order so the rng stream replays — sides A then B,
 * searchers in state order, targets in state order, infrastructure after the
 * fleet, the searcher's false-contact roll after its targets.
 *
 * Per (searcher, target) pair the briefing's five checks stay separate:
 * a cold pair rolls DETECTION; a held track rolls RETENTION (and goes
 * track-lost on a miss, keeping its last-known picture); a lost track rolls
 * REACQUISITION, floored above a fresh search because the searcher knows the
 * signature now. Any success lands a position fix, and INTELLIGENCE then
 * rolls on its own to climb the attribute ladder — detected is not
 * identified.
 */
export function runDetection(ctx: DetectionContext, state: CampaignState): void {
  const cfg = resolveSensorModel(ctx.scenario.tuning.sensorModel)
  for (const side of ['A', 'B'] as const) {
    for (const searcher of state.units) {
      if (searcher.side !== side) continue
      const actor = unitActor(ctx.map, searcher, 'searcher')
      const profile = unitProfile(searcher)
      const scout = actor.scoutSensors > 0
      for (const target of state.units) {
        if (target.side === side) continue
        const range = hexDistance(searcher.hex, target.hex)
        const geom: ScanGeometry = {
          range,
          interveningTerrain: interveningTerrain(ctx.map, searcher.hex, target.hex),
        }
        const targetActor = unitActor(ctx.map, target, 'target')
        const det = detectionProbability(actor, targetActor, geom, cfg)
        const intel = intelligenceProbability(actor, targetActor, geom, cfg)

        const existing = findContact(state, side, target.id)
        const track: TrackState | null =
          existing && !contactCollapsed(existing) ? (existing.track ?? 'tracked') : null

        // 4.3's floor survives the model: a same-hex scan always finds an
        // uncloaked hull — engagement logic (7.1) is built on co-located
        // units knowing each other, and ambush stays a cloak's privilege.
        const pointBlank = range === 0 && !targetActor.cloaked

        let held = false
        if (pointBlank) {
          held = true
        } else if (track === null) {
          // Initial detection (§3): a zero-probability scan rolls no dice.
          held = det.p > 0 && (det.p >= 1 || nextRandom(state.rng) < det.p)
        } else if (range > cfg.trackingMaxRange) {
          // Beyond the tracking horizon the picture just goes cold: no roll,
          // a held track is lost, a lost one stays lost.
          existing!.track = 'track-lost'
        } else if (track === 'track-lost') {
          const p = reacquisitionProbability(det.p, existing!.lastRange ?? range, range, intel.p, cfg)
          held = nextRandom(state.rng) < p
        } else {
          const p = retentionProbability(existing!.lastRange ?? range, range, intel.p, cfg)
          held = nextRandom(state.rng) < p
          if (!held) existing!.track = 'track-lost'
        }
        if (existing) existing.lastRange = range
        if (!held) continue

        const landed = landDetection(state, side, target, range, track)
        landed.contact.lastRange = range
        // Intelligence is its own check (§12): the ladder climbs only when
        // it lands — a certain read (p ≥ 1) spends no die.
        if (intel.p > 0 && (intel.p >= 1 || nextRandom(state.rng) < intel.p)) {
          landIntel(ctx, state, profile.sciences, scout, target, range, landed.contact, landed.existsWasNew, cfg)
        }
      }
      // §14: the scan that saw something that was never there.
      if (ctx.scenario.tuning.falseContacts) {
        const p = falseContactChance(actor.active, cfg)
        if (nextRandom(state.rng) < p) spawnFalseContact(ctx, state, side, searcher)
      }
    }
    for (const station of state.infrastructure) {
      if (station.side === side) infrastructureSweep(ctx, state, station, cfg)
    }
  }
}

/**
 * A false contact (§14): a ghost penciled in a few hexes out, indistinct and
 * never scannable again — it goes stale, drifts nowhere, and collapses like
 * any contact nobody can reacquire. Its target id matches no unit, so no
 * engagement, mission or battle can ever make it real; 'exists' is marked
 * untruthful for the umpire's eyes only.
 */
function spawnFalseContact(
  ctx: DetectionContext,
  state: CampaignState,
  side: Side,
  searcher: Unit,
): void {
  const distance = 2 + nextInt(state.rng, 4)
  let hex = { ...searcher.hex }
  for (let i = 0; i < distance; i++) {
    const options = hexNeighbors(hex).filter((h) => inBounds(h, ctx.map.width, ctx.map.height))
    if (options.length === 0) break
    hex = options[nextInt(state.rng, options.length)]
  }
  const contact = newContact(state, side, `phantom-${side}-${state.contactSeq}`, hex)
  contact.track = 'detected'
  contact.positionEstimated = true
  contact.attributes.exists = {
    value: 'yes',
    truthful: false,
    resolvedAtRange: distance,
    stale: false,
  }
}

/**
 * The round tick's contact decay (4.4): a record with no successful scan this
 * round goes one round staler — its newest attribute greys, its position drifts
 * — and after three quiet rounds it collapses to a last-known marker.
 */
export function decayContacts(state: CampaignState): void {
  for (const contact of state.contacts) {
    if (contact.lastScan.round === state.round) continue
    contact.unscannedRounds += 1
    const resolved = CONTACT_ATTRIBUTES.filter((a) => contact.attributes[a] && !contact.attributes[a]!.stale)
    const newest = resolved[resolved.length - 1]
    if (newest && newest !== 'exists') contact.attributes[newest]!.stale = true
  }
}

/** Contacts collapsed to last-known (4.4): the view shows a marker, no dossier. */
export function contactCollapsed(contact: ContactRecord): boolean {
  return contact.unscannedRounds >= 3
}

/**
 * Where the contact's owner believes the target is right now: the scan hex,
 * advanced along the observed course at cruise pace while unobserved (4.4),
 * clamped to the board — the map edge walls real ships (turn.ts), so a
 * reckoning that sails off the chart is a belief nobody would hold, and an
 * unclamped one had contact markers gliding clean off the map. Views and
 * mission steering both use THIS — never the target's true hex — which is
 * what keeps an Intercept order honest about what its side knows.
 */
export function reckonedHex(map: CampaignMap, contact: ContactRecord, state: CampaignState): Hex {
  if (!contact.course || !contact.observedMoving) return contact.estimatedHex
  const elapsed =
    (state.round - contact.lastScan.round) * 16 + (state.phase - contact.lastScan.phase)
  // Reckon at a typical cruise of four hexes a round: one per four table phases.
  const steps = Math.max(0, Math.floor(elapsed / 4))
  const q = Math.max(0, Math.min(map.width - 1, contact.estimatedHex.q + contact.course.q * steps))
  const rMin = -Math.floor(q / 2)
  const r = Math.max(rMin, Math.min(rMin + map.height - 1, contact.estimatedHex.r + contact.course.r * steps))
  return { q, r }
}
