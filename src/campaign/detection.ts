/**
 * Detection — the heart of the game (design doc Part 4).
 *
 * Submarine-style: after every phase's movement, EVERY unit on the table makes
 * a passive scan against every enemy unit, both sides, twelve sweeps a round.
 * Doyle's per-scan curve is steep in range and hard-capped at five hexes; the
 * modifier stack shifts the roll by whole columns ("bands") so his shape
 * survives tuning; and what a scan earns is not a blip but an attribute — one
 * rung of a graded ladder, each rung independently capable of being a lie.
 *
 * Everything here runs on the umpire's side of the wall. Player-facing code
 * sees the results only through `views.ts`, and the one number this module
 * exports for UI use — `detectionChance` — is a function of things a player
 * at a physical table could see anyway (their own posture, a bearing, range).
 */

import { registerCustomForms, FILE_FORMS, SHIP_FORMS, shipFormById } from '../data/ships'
import type { ShipForm } from '../engine/types'
import { hexDistance, hexNeighbors, terrainAt } from './hexmap'
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
  sciences: number
  cloakCapable: boolean
} {
  const all = unit.ships.map((s) => statsFor(s.formId))
  return {
    signature: Math.max(...all.map((s) => s.signature)),
    sensorRating: Math.max(...all.map((s) => s.sensorRating)),
    sciences: Math.max(...all.map((s) => s.sciences)),
    cloakCapable: all.every((s) => s.cloak),
  }
}

export function unitIsCloaked(unit: Unit): boolean {
  return unit.order.cloaked && unitProfile(unit).cloakCapable
}

// ---------------------------------------------------------------------------
// The band arithmetic (4.2, 4.3)
// ---------------------------------------------------------------------------

export interface ScanPosture {
  signature: number
  sensorRating: number
  moved: boolean
  cloaked: boolean
  formation: 'close' | 'standard' | 'wide'
  sensorPower: 0 | 1 | 2
  terrain: TerrainKind
}

/**
 * The per-scan probability for one (searcher, target) pair, or null when no
 * roll happens at all. Bands move the roll whole columns along the curve —
 * plus-bands one column closer, minus-bands one farther — and a stack that
 * walks off the long end of the curve is a scan that simply cannot succeed,
 * which is the worked example's own arithmetic (Appendix A: a held-still
 * target at range five is off-curve, not merely unlikely).
 */
export function detectionChance(
  curve: readonly number[],
  range: number,
  searcher: ScanPosture,
  target: ScanPosture,
): number | null {
  const ceiling = curve.length - 1
  if (range > ceiling) return null
  // Hard gates before any arithmetic: a cloaked or nebula-shrouded target is
  // a range-2 problem however good the searcher (2.2, 4.3).
  if (target.cloaked && range > 2) return null
  if (target.terrain === 'nebula' && range > 2) return null
  // Same hex always detects, unless the target is cloaked (4.3).
  if (range === 0 && !target.cloaked) return 1

  let bands = 0 // positive = easier to detect (columns toward range zero)
  if (target.signature >= 8) bands += 1
  if (target.signature <= 3) bands -= 1
  if (!target.moved) bands -= 1
  if (target.formation === 'wide') bands += 1
  if (target.terrain === 'system') bands += 1
  if (target.terrain === 'dust') bands -= 1
  if (target.cloaked) bands -= 1

  if (searcher.moved) bands -= 1
  if (searcher.sensorPower === 0) bands -= 1
  if (searcher.sensorPower === 2) bands += 1
  if (searcher.sensorRating >= 8) bands += 1
  if (searcher.sensorRating <= 3) bands -= 1
  if (searcher.formation === 'close') bands -= 1
  if (searcher.formation === 'wide') bands += 1
  if (searcher.cloaked) bands -= 2 // cloaked ships are very limited detectors
  if (searcher.terrain === 'nebula') bands -= 2 // scanning outward through it

  const column = range - bands
  if (column > ceiling) return null
  return curve[Math.max(0, column)]
}

function postureOf(map: CampaignMap, unit: Unit): ScanPosture {
  const p = unitProfile(unit)
  return {
    signature: p.signature,
    sensorRating: p.sensorRating,
    moved: unit.movedLastOwnPhase,
    cloaked: unitIsCloaked(unit),
    formation: unit.order.formation,
    sensorPower: unit.order.sensorPower,
    terrain: terrainAt(map, unit.hex),
  }
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
      // Fresh until battle scars persist (build Phase 3, 3.2).
      return 'fresh'
    case 'shipClass':
      return lead.name
    case 'shipName':
      return unit.ships.find((s) => s.formId === lead.id)?.name ?? unit.ships[0].name
  }
}

/**
 * The ladder for one target: `count` climbs a rung for a wide formation and
 * hides behind range one for a close one (6.2); identification needs range
 * three or a scout block (4.4). Returns the rungs in resolution order plus a
 * per-rung gate.
 */
function ladderFor(target: Unit): ContactAttribute[] {
  const base = [...CONTACT_ATTRIBUTES]
  if (target.order.formation === 'wide') {
    const i = base.indexOf('count')
    base.splice(i, 1)
    base.splice(i - 1, 0, 'count')
  }
  return base
}

function rungGate(target: Unit, attr: ContactAttribute, range: number, searcherScout: boolean): boolean {
  if ((attr === 'shipClass' || attr === 'shipName') && range > 3 && !searcherScout) return false
  if (attr === 'count' && target.order.formation === 'close' && range > 1) return false
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
    case 'damage':
      return truth === 'fresh' ? 'damaged' : 'fresh'
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
 * One successful scan lands: position updates to truth (creation fuzzes ±1
 * beyond range two — 4.4), then the ladder climbs. Sciences three or better
 * resolves two rungs per success; a rung already resolved *falsely* is
 * re-rolled by any success at closer range than the lie was bought at, truth
 * replacing it on a clean roll (4.5).
 */
function landScan(
  ctx: DetectionContext,
  state: CampaignState,
  side: Side,
  searcherSciences: number,
  searcherScout: boolean,
  target: Unit,
  range: number,
): void {
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

  const ladder = ladderFor(target)
  const targetTerrain = terrainAt(ctx.map, target.hex)
  let rungs = searcherSciences >= 3 ? 2 : 1

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
    if (!rungGate(target, attr, range, searcherScout)) break
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
function infrastructureSweep(ctx: DetectionContext, state: CampaignState, station: Infrastructure): void {
  if (station.destroyed) return
  const curve = ctx.scenario.tuning.detectionCurve
  for (const target of state.units) {
    if (target.side === station.side) continue
    const range = hexDistance(station.hex, target.hex)
    const cloaked = unitIsCloaked(target)
    if (station.kind === 'jump-beacon') continue
    if (station.kind === 'listening-post') {
      // Passive 3 (3.4): the standard curve, hard-capped at three hexes, from
      // a station that never moves and never radiates.
      if (range > 3) continue
      const p = detectionChance(curve, range, LISTENING_POST_POSTURE, postureOf(ctx.map, target))
      if (p !== null && nextRandom(state.rng) < p) {
        landScan(ctx, state, station.side, 0, false, target, range)
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

const LISTENING_POST_POSTURE: ScanPosture = {
  signature: 1,
  sensorRating: 5,
  moved: false,
  cloaked: false,
  formation: 'standard',
  sensorPower: 1,
  terrain: 'deep',
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
 * The passive sweep after one phase's movement (4.1): both sides, every unit,
 * fixed iteration order so the rng stream replays — sides A then B, searchers
 * in state order, targets in state order, infrastructure after the fleet.
 */
export function runDetection(ctx: DetectionContext, state: CampaignState): void {
  const curve = ctx.scenario.tuning.detectionCurve
  for (const side of ['A', 'B'] as const) {
    for (const searcher of state.units) {
      if (searcher.side !== side) continue
      const sp = postureOf(ctx.map, searcher)
      const profile = unitProfile(searcher)
      const scout = searcher.ships.some((s) => (shipFormById(s.formId)?.scoutSensor?.sensors ?? 0) > 0)
      for (const target of state.units) {
        if (target.side === side) continue
        const range = hexDistance(searcher.hex, target.hex)
        const p = detectionChance(curve, range, sp, postureOf(ctx.map, target))
        if (p === null) continue
        if (p >= 1 || nextRandom(state.rng) < p) {
          landScan(ctx, state, side, profile.sciences, scout, target, range)
        }
      }
    }
    for (const station of state.infrastructure) {
      if (station.side === side) infrastructureSweep(ctx, state, station)
    }
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
 * advanced along the observed course at cruise pace while unobserved (4.4).
 * Views and mission steering both use THIS — never the target's true hex —
 * which is what keeps an Intercept order honest about what its side knows.
 */
export function reckonedHex(contact: ContactRecord, state: CampaignState): Hex {
  if (!contact.course || !contact.observedMoving) return contact.estimatedHex
  const elapsed =
    (state.round - contact.lastScan.round) * 12 + (state.phase - contact.lastScan.phase)
  // One hex per own phase at cruise = one hex per two table phases.
  const steps = Math.max(0, Math.floor(elapsed / 2))
  return {
    q: contact.estimatedHex.q + contact.course.q * steps,
    r: contact.estimatedHex.r + contact.course.r * steps,
  }
}
