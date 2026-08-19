import { describe, expect, it } from 'vitest'
import { blankScenario, newCampaign } from '../campaign/file'
import { resolvePhase } from '../campaign/turn'
import { sideToMove, type CampaignFile, type PhaseMove } from '../campaign/types'
import {
  fileFromLedger,
  isCampaignMatch,
  ledgerDocOf,
  SEAT_LABEL,
  stateFingerprint,
} from './onlineCampaign'

/**
 * The online campaign's pure layer: the ledger document round-trips through
 * the same fold a local file replays through, campaign matches are
 * recognizable among tactical ones, and the per-move fingerprint actually
 * fingerprints. The wire itself is the tactical match client, already tested.
 */

function played(): CampaignFile {
  const file = newCampaign(
    blankScenario({
      mapSeed: 5,
      forces: {
        A: [{ id: 'a-1', kind: 'ship', name: 'USS Ledger', ships: ['union-nelson-ii-class-light-frigate'], hex: { q: 4, r: 8 } }],
        B: [{ id: 'b-1', kind: 'ship', name: 'AMV Echo', ships: ['aurelian-corvus-i-class-destroyer'], hex: { q: 30, r: 0 } }],
      },
    }),
    'c-online-test',
  )
  for (let i = 0; i < 7; i++) {
    const move: PhaseMove = {
      round: file.state.round,
      phase: file.state.phase,
      side: sideToMove(file.state.phase),
      interventions: [],
    }
    file.state = resolvePhase({ map: file.map, scenario: file.scenario }, file.state, move)
    file.journal.push(move)
  }
  return file
}

describe('the campaign ledger document', () => {
  it('folds back to the very same state the sender holds — byte for byte', () => {
    const file = played()
    const rebuilt = fileFromLedger(ledgerDocOf(file), file.journal)
    expect(typeof rebuilt).not.toBe('string')
    expect(JSON.stringify((rebuilt as CampaignFile).state)).toBe(JSON.stringify(file.state))
    expect((rebuilt as CampaignFile).campaignId).toBe('c-online-test')
  })

  it('refuses a document that is not a campaign, and a journal that will not fold', () => {
    const file = played()
    expect(typeof fileFromLedger({ kind: 'battle' } as never, [])).toBe('string')
    // A journal whose first move claims the wrong phase cannot replay.
    const broken: PhaseMove[] = [{ round: 3, phase: 9, side: 'A', interventions: [] }]
    expect(typeof fileFromLedger(ledgerDocOf(file), broken)).toBe('string')
  })

  it('the fingerprint separates states a single move apart', () => {
    const file = played()
    const before = stateFingerprint(file.state)
    const move: PhaseMove = {
      round: file.state.round,
      phase: file.state.phase,
      side: sideToMove(file.state.phase),
      interventions: [],
    }
    const after = resolvePhase({ map: file.map, scenario: file.scenario }, file.state, move)
    expect(stateFingerprint(after)).not.toBe(before)
  })
})

describe('campaign matches among tactical ones', () => {
  it('recognizes the fixed seat list and nothing else', () => {
    expect(isCampaignMatch({ sides: [SEAT_LABEL.A, SEAT_LABEL.B] })).toBe(true)
    expect(isCampaignMatch({ sides: ['Union Fleet', 'Vallari Raiders'] })).toBe(false)
    expect(isCampaignMatch({ sides: [SEAT_LABEL.B, SEAT_LABEL.A] })).toBe(false)
    expect(isCampaignMatch({ sides: [SEAT_LABEL.A] })).toBe(false)
  })
})
