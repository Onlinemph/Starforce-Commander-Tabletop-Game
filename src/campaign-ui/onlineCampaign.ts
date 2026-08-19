/**
 * Online campaigns — build Phase 5, on the match service that already exists.
 *
 * The insight that makes this small: the match backend stores "a jsonb setup
 * document plus an ordered jsonb journal", and never reads either. That is a
 * battle (GameSetup + actions) — and it is ALSO a campaign (scenario + map +
 * phase moves). So an online campaign is an ordinary sfc_match whose setup
 * carries `kind: 'campaign'` and whose journal rows are PhaseMoves: the same
 * SQL, the same Realtime feed, the same bcrypt door, zero new deployment.
 * Campaign matches are recognized by their fixed seat list ('Commander A',
 * 'Commander B'), which no tactical battle uses as its side names.
 *
 * The trust posture is exactly the tactical matches' own: every client holds
 * the full ledger and replays it (it must — the resolver runs locally), and
 * each console renders only its seat's SideView. That is the tabletop's honour
 * system, not cryptography; the design doc's server-side fog (an edge function
 * holding truth and serving views) remains the hardening step beyond this.
 */

import type { SavedGame } from '../data/savedGame'
import type { GameAction } from '../engine/actions'
import { openingState } from '../campaign/file'
import { hashText } from '../campaign/handoff'
import { resolvePhase } from '../campaign/turn'
import type {
  CampaignFile,
  CampaignMap,
  CampaignScenario,
  CampaignState,
  PhaseMove,
  Side,
} from '../campaign/types'
import type { MatchSummary, SupabaseConfig } from '../ui/supabaseMatch'

/** The fixed seat names — both the UI labels and the campaign-match marker. */
export const SEAT_LABEL: Record<Side, string> = { A: 'Commander A', B: 'Commander B' }
const CAMPAIGN_SIDES = [SEAT_LABEL.A, SEAT_LABEL.B]

/** A campaign match announces itself by its seat list. */
export function isCampaignMatch(summary: Pick<MatchSummary, 'sides'>): boolean {
  return (
    summary.sides.length === 2 &&
    summary.sides[0] === SEAT_LABEL.A &&
    summary.sides[1] === SEAT_LABEL.B
  )
}

/** The ledger's setup document: everything but the journal and its cache. */
export interface CampaignLedgerDoc {
  kind: 'campaign'
  formatVersion: 1
  campaignId: string
  scenario: CampaignScenario
  map: CampaignMap
}

export function ledgerDocOf(file: CampaignFile): CampaignLedgerDoc {
  return {
    kind: 'campaign',
    formatVersion: 1,
    campaignId: file.campaignId,
    scenario: file.scenario,
    map: file.map,
  }
}

/**
 * Rebuild the campaign from the ledger: fold the journal over the opening
 * state, with the STORED map (never regenerated — 2.2). This is the same fold
 * `replayCampaign` runs on a local file; a ledger that will not fold is
 * refused as a string, exactly as a local file that will not replay is.
 */
export function fileFromLedger(
  doc: CampaignLedgerDoc,
  journal: PhaseMove[],
): CampaignFile | string {
  if (doc?.kind !== 'campaign' || doc.formatVersion !== 1) {
    return 'That match is not a campaign.'
  }
  let state: CampaignState
  try {
    state = openingState(doc.scenario)
    const ctx = { map: doc.map, scenario: doc.scenario }
    for (const move of journal) state = resolvePhase(ctx, state, move)
  } catch (e) {
    return `The campaign ledger does not replay: ${e instanceof Error ? e.message : String(e)}`
  }
  return {
    formatVersion: 1,
    campaignId: doc.campaignId,
    scenario: doc.scenario,
    map: doc.map,
    journal,
    state,
  }
}

/**
 * The state fingerprint a move carries: sender stamps the state its move
 * produced, receiver compares after applying — a mismatch means the boards
 * drifted and the ledger settles it, the tactical matches' own bargain.
 */
export function stateFingerprint(state: CampaignState): string {
  return hashText(JSON.stringify(state))
}

// ---------------------------------------------------------------------------
// Enrollment — so a refresh (or next week's session) reconnects by itself
// ---------------------------------------------------------------------------

export interface CampaignEnrollment {
  server: string
  key: string
  matchId: string
  password: string
  seat: Side
  name: string
}

const ENROLL_KEY = 'sfc.campaign-online.v1'

export function loadEnrollment(): CampaignEnrollment | null {
  try {
    const raw = localStorage.getItem(ENROLL_KEY)
    if (!raw) return null
    const e = JSON.parse(raw) as CampaignEnrollment
    return e?.server && e?.matchId && (e.seat === 'A' || e.seat === 'B') ? e : null
  } catch {
    return null
  }
}

export function saveEnrollment(e: CampaignEnrollment | null): void {
  try {
    if (e) localStorage.setItem(ENROLL_KEY, JSON.stringify(e))
    else localStorage.removeItem(ENROLL_KEY)
  } catch {
    // Private browsing costs only the auto-reconnect, never the campaign.
  }
}

/** The tactical matches' claim identity, shared: one browser, one chair-holder. */
function claimKey(): string {
  try {
    const KEY = 'sfc.claim-key.v1'
    let key = localStorage.getItem(KEY)
    if (!key) {
      key = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
      localStorage.setItem(KEY, key)
    }
    return key
  } catch {
    return `ephemeral-${Math.random().toString(36).slice(2)}`
  }
}

// ---------------------------------------------------------------------------
// The wire — thin adapters over the tactical match client
// ---------------------------------------------------------------------------
// The backend stores jsonb it never reads, so the SavedGame/GameAction types
// on the tactical client are its reading of the bytes, not the bytes' own
// shape. The casts below are that statement made once, at the boundary.

function asSave(doc: CampaignLedgerDoc, journal: PhaseMove[]): SavedGame {
  return { version: 1, setup: doc as unknown as SavedGame['setup'], actions: journal as unknown as GameAction[] }
}

export interface CampaignMatchHandlers {
  /** A phase move landed on the ledger (1-based seq over the journal). */
  onMove(move: PhaseMove, seq: number, hash?: string): void
  /** The ledger arrived whole — an undo upstream, a resync, or the catch-up read. */
  onLedger(doc: CampaignLedgerDoc, journal: PhaseMove[]): void
  /** Seats with somebody connected right now. */
  onPresence(labels: string[]): void
  onDropped(): void
}

export interface CampaignMatchLink {
  appendMove(move: PhaseMove, seq: number, hash: string): Promise<void>
  /** Tell the match browser whose phase the campaign waits on. Best-effort. */
  setWaiting(label: string): Promise<void>
  resync(): Promise<void>
  close(): void
}

export interface OpenedCampaignMatch {
  link: CampaignMatchLink
  name: string
  doc: CampaignLedgerDoc
  journal: PhaseMove[]
}

/** Host a campaign as a persistent match; resolves to its join code. */
export async function hostCampaignMatch(
  config: SupabaseConfig,
  name: string,
  password: string,
  file: CampaignFile,
  isPublic: boolean,
): Promise<{ id?: string; error?: string }> {
  const { createSupabaseMatch } = await import('../ui/supabaseMatch')
  return createSupabaseMatch(
    config,
    name,
    password,
    CAMPAIGN_SIDES,
    asSave(ledgerDocOf(file), file.journal),
    isPublic,
  )
}

/** The campaign rows of the shared match browser. */
export async function listCampaignMatches(
  config: SupabaseConfig,
): Promise<{ matches?: MatchSummary[]; error?: string }> {
  const { listSupabaseMatches } = await import('../ui/supabaseMatch')
  const result = await listSupabaseMatches(config)
  if (!result.matches) return result
  return { matches: result.matches.filter(isCampaignMatch), error: result.error }
}

/**
 * Open a campaign match and hold the live link: the ledger as it stands, the
 * Realtime feed of moves, a refereed claim on the chosen seat (renewed on a
 * timer so a closed tab frees the chair by silence).
 */
export async function openCampaignMatch(
  config: SupabaseConfig,
  matchId: string,
  password: string,
  seat: Side,
  handlers: CampaignMatchHandlers,
  journalLength: () => number,
): Promise<{ opened?: OpenedCampaignMatch; error?: string }> {
  const { openSupabaseMatch } = await import('../ui/supabaseMatch')
  const label = SEAT_LABEL[seat]
  const result = await openSupabaseMatch(
    config,
    matchId,
    password,
    label,
    {
      onAction(action, seq, hash) {
        handlers.onMove(action as unknown as PhaseMove, seq, hash)
      },
      onResync(save) {
        handlers.onLedger(
          save.setup as unknown as CampaignLedgerDoc,
          (save.actions as unknown as PhaseMove[]) ?? [],
        )
      },
      onPresence: handlers.onPresence,
      onDropped: handlers.onDropped,
    },
    journalLength,
    claimKey(),
  )
  if (!result.opened) return { error: result.error }
  const { link, name, save } = result.opened

  const doc = save.setup as unknown as CampaignLedgerDoc
  if (doc?.kind !== 'campaign') {
    link.close()
    return { error: 'That match is a tactical battle, not a campaign — join it from Online match.' }
  }

  // The seat is refereed by the ledger, exactly as tactical chairs are.
  const claimed = await link.claim(label)
  if (claimed === 'taken') {
    link.close()
    return { error: `${label} is already held by another console.` }
  }
  const renew = setInterval(() => void link.claim(label), 3 * 60 * 1000)

  const campaignLink: CampaignMatchLink = {
    async appendMove(move, seq, hash) {
      await link.append(move as unknown as GameAction, seq, hash)
    },
    async setWaiting(waitingLabel) {
      await link.setWaiting([waitingLabel])
    },
    resync: () => link.resync(),
    close() {
      clearInterval(renew)
      void link.claim(null)
      link.close()
    },
  }
  return {
    opened: {
      link: campaignLink,
      name,
      doc,
      journal: (save.actions as unknown as PhaseMove[]) ?? [],
    },
  }
}
