/**
 * The campaign file (design doc Part 9): one JSON document, the battle-file
 * philosophy one level up. Setup + journal are the truth; the stored state is
 * a verifiable cache, and a loader that cannot reproduce it from the journal
 * refuses the file rather than trusting it — the same posture the tactical
 * save format takes toward replay.
 */

import { generateMap } from './hexmap'
import { enduranceMaxOf, resolveEndurance } from './logistics'
import { orderRefusal, resolvePhase, type DetectionContext } from './turn'
import {
  DETECTION_CURVE,
  type CampaignFile,
  type CampaignScenario,
  type CampaignState,
  type StandingOrder,
  type Unit,
} from './types'

export const DEFAULT_ORDER: StandingOrder = {
  waypoints: [],
  speed: 'cruise',
  sensorPower: 1,
  cloaked: false,
  formation: 'standard',
}

/** A minimal scenario for tests and hotseat bring-up. */
export function blankScenario(overrides: Partial<CampaignScenario> = {}): CampaignScenario {
  return {
    name: 'Border Watch',
    rounds: 15,
    mapSeed: 1,
    mapWidth: 40,
    mapHeight: 30,
    forces: { A: [], B: [] },
    infrastructure: [],
    tuning: { detectionCurve: DETECTION_CURVE, misinformationBase: 0.1, falseContacts: false },
    ...overrides,
  }
}

/**
 * The state a campaign opens with — a pure function of the scenario alone.
 *
 * Deliberately independent of the map and of map *generation*: the generator
 * spends its own throwaway stream, and the campaign stream starts at call
 * zero. That separation is what lets the stored map be authoritative (2.2 —
 * never regenerated at load) while replay still reproduces every later draw:
 * if the opening rng position depended on how many draws generation happened
 * to make, a generator improvement would silently break every saved campaign.
 */
export function openingState(scenario: CampaignScenario): CampaignState {
  const build = (side: 'A' | 'B', f: (typeof scenario.forces)['A'][number]): Unit => {
    const unit: Unit = {
      id: f.id,
      side,
      kind: f.kind,
      ships: f.ships.map((formId, i) => ({
        id: `${f.id}-s${i + 1}`,
        formId,
        name: f.name ?? f.id,
        // A named wing arrives ready (3.3); hulls without hangars simply
        // never launch it, so naming one is harmless there.
        ...(f.wings?.[i]
          ? { wing: { cardId: f.wings[i]!, readiness: 'ready' as const, rearmRounds: 0 } }
          : {}),
      })),
      hex: { ...f.hex },
      order: { ...structuredClone(DEFAULT_ORDER), ...structuredClone(f.order ?? {}) },
      moveDebt: 0,
      endurance: 0,
      enduranceMax: 0,
      cloakedThisRound: false,
      movedLastOwnPhase: false,
      course: null,
    }
    // The smallest tank aboard sets the unit's legs (3.1, 6.4), scaled by
    // the scenario's endurance dial.
    unit.enduranceMax = enduranceMaxOf(unit, resolveEndurance(scenario.tuning.endurance).tankMultiplier)
    unit.endurance = unit.enduranceMax
    return unit
  }
  const units: Unit[] = []
  const reinforcements: CampaignState['reinforcements'] = []
  for (const side of ['A', 'B'] as const) {
    for (const f of scenario.forces[side]) {
      const unit = build(side, f)
      // Reinforcements are held off the map until their round (S3.2): not
      // drawn, not scannable, not engageable — and not in the enemy's view
      // by construction, because they are not on the board at all.
      if (f.arrivesRound && f.arrivesRound > 1) {
        reinforcements.push({ arrivesRound: f.arrivesRound, side, unit })
      } else {
        units.push(unit)
      }
    }
  }
  const state: CampaignState = {
    round: 1,
    phase: 1,
    roundLimit: scenario.rounds,
    contactSeq: 1,
    engagementSeq: 1,
    pendingBattles: [],
    events: [],
    sensorLog: [],
    objectivesDone: [],
    objectiveProgress: {},
    shipsLost: { A: 0, B: 0 },
    scouted: { A: [], B: [] },
    reinforcements,
    winner: null,
    rng: { seed: scenario.mapSeed, calls: 0 },
    units,
    infrastructure: scenario.infrastructure.map((i) => ({ ...i, hex: { ...i.hex }, destroyed: false })),
    contacts: [],
    vp: { A: 0, B: 0 },
    finished: false,
  }
  // The same validator interventions face (turn.ts): a scenario cannot open
  // with an order the rules would refuse mid-game. Missions cannot exist at
  // the opening bell — no contact does — so any scenario-set mission drops.
  for (const unit of state.units) {
    const refusal = orderRefusal(state, unit, unit.order)
    if (refusal) throw new Error(`Scenario force: ${refusal}`)
    delete unit.order.mission
  }
  return state
}

/** Create a campaign: generate and store the map, open the state. */
export function newCampaign(scenario: CampaignScenario, campaignId: string): CampaignFile {
  // The generator's stream is derived and discarded — see openingState.
  const mapRng = { seed: (scenario.mapSeed ^ 0x6d2b79f5) >>> 0, calls: 0 }
  const map = generateMap(mapRng, scenario.mapWidth, scenario.mapHeight)
  return { formatVersion: 1, campaignId, scenario, map, journal: [], state: openingState(scenario) }
}

/**
 * Fold the journal over the opening state — the definition of the campaign.
 * Uses the file's STORED map throughout; nothing is regenerated.
 */
export function replayCampaign(file: CampaignFile): CampaignState {
  const ctx: DetectionContext = { map: file.map, scenario: file.scenario }
  let state = openingState(file.scenario)
  for (const move of file.journal) state = resolvePhase(ctx, state, move)
  return state
}

export function saveCampaign(file: CampaignFile): string {
  return JSON.stringify(file, null, 1)
}

/**
 * Parse and verify. Returns the file, or a string describing the refusal.
 * Unknown fields survive: the parse keeps the whole object graph, and save
 * writes back whatever it was handed beyond the known keys.
 */
export function loadCampaign(text: string): CampaignFile | string {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return 'Not JSON.'
  }
  const file = raw as CampaignFile
  if (file?.formatVersion !== 1) return 'Unknown campaign format version.'
  if (!file.scenario || !file.map || !Array.isArray(file.journal) || !file.state) {
    return 'Missing scenario, map, journal or state.'
  }
  let replayed: CampaignState
  try {
    replayed = replayCampaign(file)
  } catch (e) {
    return `The journal does not replay: ${e instanceof Error ? e.message : String(e)}`
  }
  /*
   * The verify compares only what the stored state HAS: a build that added a
   * state field since the file was saved (a sensor log, a spotters list)
   * produces a replay that is a superset, and that is an upgrade, not a
   * tamper. Every value the file does carry must still match byte for byte,
   * so a doctored hex or ledger is refused exactly as before — and the
   * replayed state, not the stored one, is what the loaded file carries, so
   * the next save is current.
   */
  if (!storedMatchesReplay(file.state, replayed)) {
    return 'The stored state does not match the journal replay.'
  }
  file.state = replayed
  return file
}

/**
 * Does the stored state agree with the replay on every field it carries?
 * Objects may gain keys in the replay (additive fields); arrays must match
 * element for element; everything else must be equal.
 */
export function storedMatchesReplay(stored: unknown, replayed: unknown): boolean {
  if (Array.isArray(stored)) {
    if (!Array.isArray(replayed) || replayed.length !== stored.length) return false
    return stored.every((item, i) => storedMatchesReplay(item, replayed[i]))
  }
  if (stored !== null && typeof stored === 'object') {
    if (replayed === null || typeof replayed !== 'object' || Array.isArray(replayed)) return false
    const rec = replayed as Record<string, unknown>
    return Object.entries(stored as Record<string, unknown>).every(
      ([key, value]) => key in rec && storedMatchesReplay(value, rec[key]),
    )
  }
  return stored === replayed
}
