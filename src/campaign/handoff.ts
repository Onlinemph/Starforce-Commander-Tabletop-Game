/**
 * The handoff (design doc Part 7.3–7.4): the campaign emits a standard battle
 * file the existing tabletop loads, the tabletop plays it — human or AI — and
 * the campaign reads the journal back. One format, three ways to play.
 *
 * Everything here is deterministic in the engagement: the same campaign state
 * generates the same battle file byte for byte (the golden-file property),
 * so both players' consoles derive identical files without exchanging them,
 * and the journal's file hash proves they did.
 *
 * The fog crosses over exactly once, here, on the doc's own terms (7.3):
 * deployment reveals. The file necessarily contains both forces — that is
 * what putting counters on a table means — but the *information asymmetry*
 * is made physical instead of leaked: the side with the richer dossier
 * deploys second, and an ambusher's victim finds out what jumped it by
 * looking at the table, not by reading a field it shouldn't have.
 */

import { shipFormById } from '../data/ships'
import { parseSavedGame, replayGame, withEmbeddedForms, type GameSetup, type SavedGame } from '../data/savedGame'
import type { CustomScenario } from '../data/scenarios'
import { victoryPoints } from '../engine/game'
import { MAX_FLIGHT_SIZE } from '../engine/fighters'
import { captureScars, scarsAreEmpty } from '../engine/shipState'
import { terrainAt } from './hexmap'
import type { DetectionContext } from './detection'
import {
  CONTACT_ATTRIBUTES,
  type BattleResult,
  type CampaignState,
  type PendingEngagement,
  type Side,
  type Unit,
} from './types'

/** setup plus the linkage the campaign needs back (7.3); tactical UI ignores it. */
export type CampaignBattleSetup = GameSetup & {
  campaignRef: { campaignId: string; round: number; phase: number; hex: { q: number; r: number }; engagementId: string }
}

export interface CampaignBattleFile {
  version: 1
  setup: CampaignBattleSetup
  actions: unknown[]
}

/** FNV-1a, hex — the journal's link from a battle record to its file. */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// Distinct FIRST words on purpose: deploy() prefixes ship ids with them.
const SIDE_LABEL: Record<Side, string> = { A: 'Alpha Command', B: 'Beta Command' }

function unitsOf(state: CampaignState, engagement: PendingEngagement, side: Side): Unit[] {
  return engagement.unitIds[side]
    .map((id) => state.units.find((u) => u.id === id))
    .filter((u): u is Unit => Boolean(u))
}

/** How much dossier this side holds on those units — the deploy-order input. */
function infoScore(state: CampaignState, side: Side, enemies: Unit[]): number {
  let score = 0
  for (const unit of enemies) {
    const contact = state.contacts.find((c) => c.side === side && c.targetUnitId === unit.id)
    if (contact) score += CONTACT_ATTRIBUTES.filter((a) => contact.attributes[a]).length
  }
  return score
}

/** Deterministic deployment spread per formation (6.2 → 7.3). */
function spreadOf(units: Unit[]): { x: number; y: number } {
  const formation = units[0]?.order.formation ?? 'standard'
  return { x: 0, y: formation === 'close' ? 2 : formation === 'wide' ? 7 : 4 }
}

/**
 * Generate the battle file for an engagement (7.3). Ship order within a side
 * is engagement unit order then ship-record order — the same order readback
 * uses, which is what makes the mapping between campaign ships and tactical
 * ships positional and journal-free.
 */
export function battleFileFor(
  ctx: DetectionContext,
  state: CampaignState,
  campaignId: string,
  engagement: PendingEngagement,
): CampaignBattleFile {
  const terrain = terrainAt(ctx.map, engagement.hex)
  const system = terrain === 'system'
  const size = system ? 36 : 72
  const mid = size / 2

  const units: Record<Side, Unit[]> = {
    A: unitsOf(state, engagement, 'A'),
    B: unitsOf(state, engagement, 'B'),
  }

  /*
   * Deployment order (7.3): the richer dossier deploys second — the sides
   * array is deployment order, so the better-informed side goes LAST. An
   * ambusher outranks arithmetic: springing the trap is deploying second by
   * definition, whatever its dossier says.
   */
  const better: Side =
    engagement.ambushBy ??
    (infoScore(state, 'B', units.A) > infoScore(state, 'A', units.B) ? 'B' : 'A')
  const order: Side[] = [better === 'A' ? 'B' : 'A', better]

  const specialRules: string[] = [
    'A Border Command engagement: damage carries in and carries out, box for box.',
    `${SIDE_LABEL[order[1]]} holds the better picture and deploys second.`,
  ]
  if (engagement.ambushBy) {
    specialRules.push(`${SIDE_LABEL[engagement.ambushBy]} springs an ambush from silence (7.1).`)
  }
  if (engagement.caughtRetreating) {
    specialRules.push(
      `${SIDE_LABEL[engagement.caughtRetreating]} was caught retreating and fights as the defender (7.2).`,
    )
  }

  const scenario: CustomScenario = {
    id: `bc-${campaignId}-${engagement.id}`,
    name: `Border Command: engagement ${engagement.id}`,
    background:
      `Round ${engagement.round}, phase ${engagement.phase}, ` +
      `hex ${engagement.hex.q},${engagement.hex.r} — ${terrain} space.`,
    victory: 'Damage levels inflicted (S2.8.4); the campaign scores the readback.',
    specialRules,
    bounds: { width: size, height: size, fixed: true },
    nebula: terrain === 'nebula' || undefined,
    terrain:
      terrain === 'system'
        ? [{ id: 'bc-world', kind: 'planet', name: 'System primary', center: { x: mid, y: mid }, radius: 5 }]
        : terrain === 'dust'
          ? [
              { id: 'bc-dust-1', kind: 'gas-cloud', name: 'Dust bank 1', center: { x: mid - 6, y: mid - 5 }, radius: 4, scan: 3 },
              { id: 'bc-dust-2', kind: 'gas-cloud', name: 'Dust bank 2', center: { x: mid + 6, y: mid + 5 }, radius: 5, scan: 4 },
            ]
          : [],
    sides: order.map((side, i) => {
      const force = units[side]
      const ships = force.flatMap((u) => u.ships)
      return {
        side: SIDE_LABEL[side],
        objective: 'Fight the battle the campaign brought you.',
        facing: i === 0 ? 2 : 6,
        speed: 4,
        anchor: { x: i === 0 ? Math.round(size / 6) : Math.round((5 * size) / 6), y: mid },
        spread: spreadOf(force),
        force: ships.map((s) => s.formId),
        // Exact scars ride the scenario (3.2): null keeps a hull fresh.
        scars: ships.map((s) => s.scars ?? null),
        // Only a READY wing flies its card (3.3). A rearming or depleted
        // wing leaves the entry unset — full grounding of a spent wing
        // waits on a scenario knob for hangar contents, noted in the docs.
        wing: ships.map((s) => (s.wing?.readiness === 'ready' ? s.wing.cardId : undefined)) as string[],
      }
    }),
  }

  const setup = withEmbeddedForms({
    scenarioId: scenario.id,
    seed: 0, // overwritten below from the campaign stream position
    customScenario: scenario,
  }) as CampaignBattleSetup
  // Seeded from the engagement identity, not Date.now(): both consoles derive
  // the same battle without a message, and campaign replay re-derives it.
  setup.seed = parseInt(hashText(`${campaignId}|${engagement.id}|${state.rng.seed}`), 16)
  setup.campaignRef = {
    campaignId,
    round: engagement.round,
    phase: engagement.phase,
    hex: { q: engagement.hex.q, r: engagement.hex.r },
    engagementId: engagement.id,
  }
  return { version: 1, setup, actions: [] }
}

/** The `unitId/shipId` keys for one engagement side, in battle-ship order. */
export function shipKeys(state: CampaignState, engagement: PendingEngagement, side: Side): string[] {
  return unitsOf(state, engagement, side).flatMap((u) => u.ships.map((s) => `${u.id}/${s.id}`))
}

/**
 * Read a finished battle back (7.4): parse, replay, and walk the final state
 * into a BattleResult. Works for the played and headless paths alike — the
 * physical table enters the same shape by hand.
 */
export function readback(
  state: CampaignState,
  engagement: PendingEngagement,
  battleText: string,
): BattleResult | string {
  const parsed = parseSavedGame(battleText)
  if (typeof parsed === 'string') return `The battle file does not parse: ${parsed}`
  let game
  try {
    game = replayGame(parsed as SavedGame)
  } catch (e) {
    return `The battle does not replay: ${e instanceof Error ? e.message : String(e)}`
  }

  const result: BattleResult = { ships: {}, vp: { A: 0, B: 0 } }
  for (const side of ['A', 'B'] as const) {
    const keys = shipKeys(state, engagement, side)
    const fleet = game.ships.filter((s) => s.side === SIDE_LABEL[side])
    if (fleet.length !== keys.length) {
      return `The battle fields ${fleet.length} ships for ${SIDE_LABEL[side]}; the engagement has ${keys.length}.`
    }
    const records = unitsOf(state, engagement, side).flatMap((u) => u.ships)
    keys.forEach((key, i) => {
      const ship = fleet[i]
      const dead = ship.destroyed || ship.derelict || ship.capturedBy !== null
      const scars = dead ? null : captureScars(ship)
      result.ships[key] = {
        destroyed: dead,
        disengaged: ship.disengaged,
        scars: scars && !scarsAreEmpty(scars) ? scars : null,
      }
      const record = records[i]
      if (record?.wing && !dead) {
        result.ships[key].wing = wingAfterBattle(game, ship, record.wing)
      }
    })
  }
  const vp = victoryPoints(game)
  result.vp.A = vp[SIDE_LABEL.A] ?? 0
  result.vp.B = vp[SIDE_LABEL.B] ?? 0
  return result
}

/**
 * Wing readiness read off the table (3.3): fighters still flying by the
 * carrier plus flights still in the hangar, against the hangar's full
 * complement. A wing that never flew keeps its record; one that came home
 * having fought rearms for two rounds; past half its fighters gone it is
 * depleted until a fleet base rebuilds it; none left is a destroyed wing —
 * replacement fighters are a scenario's reinforcements, not a timer.
 */
function wingAfterBattle(
  game: { flights: Array<{ motherId: string; members: number }>; ships: Array<unknown> },
  ship: { id: string; flightsAboard: number; form: { systems: Array<{ kind: string; boxes: number }> } },
  wing: { cardId: string; readiness: string; rearmRounds: number },
): { cardId: string; readiness: 'ready' | 'rearming' | 'depleted' | 'destroyed'; rearmRounds: number } {
  const hangar = ship.form.systems
    .filter((g) => g.kind === 'HNGR')
    .reduce((n, g) => n + g.boxes, 0)
  const capacity = Math.max(1, hangar) * MAX_FLIGHT_SIZE
  const flying = game.flights
    .filter((f) => f.motherId === ship.id)
    .reduce((n, f) => n + f.members, 0)
  const survivors = flying + ship.flightsAboard * MAX_FLIGHT_SIZE
  const flew = flying > 0 || ship.flightsAboard < hangar
  if (!flew) {
    return {
      cardId: wing.cardId,
      readiness: wing.readiness as 'ready' | 'rearming' | 'depleted' | 'destroyed',
      rearmRounds: wing.rearmRounds,
    }
  }
  if (survivors === 0) return { cardId: wing.cardId, readiness: 'destroyed', rearmRounds: 0 }
  if (survivors < capacity / 2) return { cardId: wing.cardId, readiness: 'depleted', rearmRounds: 0 }
  return { cardId: wing.cardId, readiness: 'rearming', rearmRounds: 2 }
}

/** Round-trip check used by tests and any UI that wants to verify a form id. */
export function formsExist(unit: Unit): boolean {
  return unit.ships.every((s) => shipFormById(s.formId) !== undefined)
}
