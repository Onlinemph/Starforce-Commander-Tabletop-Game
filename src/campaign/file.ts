/**
 * The campaign file (design doc Part 9): one JSON document, the battle-file
 * philosophy one level up. Setup + journal are the truth; the stored state is
 * a verifiable cache, and a loader that cannot reproduce it from the journal
 * refuses the file rather than trusting it — the same posture the tactical
 * save format takes toward replay.
 */

import { generateMap } from './hexmap'
import { resolvePhase } from './turn'
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
  const units: Unit[] = (['A', 'B'] as const).flatMap((side) =>
    scenario.forces[side].map((f) => ({
      id: f.id,
      side,
      kind: f.kind,
      ships: f.ships.map((formId, i) => ({ id: `${f.id}-s${i + 1}`, formId, name: f.name ?? f.id })),
      hex: { ...f.hex },
      order: { ...structuredClone(DEFAULT_ORDER), ...structuredClone(f.order ?? {}) },
      moveDebt: 0,
      // Endurance from the largest hull aboard lands with logistics (Phase 4);
      // until then every unit carries the full default.
      endurance: 8,
    })),
  )
  return {
    round: 1,
    phase: 1,
    roundLimit: scenario.rounds,
    rng: { seed: scenario.mapSeed, calls: 0 },
    units,
    infrastructure: scenario.infrastructure.map((i) => ({ ...i, hex: { ...i.hex }, destroyed: false })),
    contacts: [],
    vp: { A: 0, B: 0 },
    finished: false,
  }
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
  let state = openingState(file.scenario)
  for (const move of file.journal) state = resolvePhase(file.map, state, move)
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
  if (JSON.stringify(replayed) !== JSON.stringify(file.state)) {
    return 'The stored state does not match the journal replay.'
  }
  return file
}
