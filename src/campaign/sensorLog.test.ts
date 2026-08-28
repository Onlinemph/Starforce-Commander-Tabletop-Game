import { describe, expect, it } from 'vitest'
import { pruneOrphanTracks } from './detection'
import { blankScenario, newCampaign } from './file'
import { resolvePhase, type DetectionContext } from './turn'
import { viewFor } from './views'
import { sideToMove, type CampaignFile, type PhaseMove } from './types'

/**
 * The sensor log (the campaign's "why did my picture change"): one line per
 * TRACK transition — gained, lost, reacquired, gone cold, died with its
 * spotter — private per side, positions always the side's own belief.
 *
 * The harness pins the transitions with the sensor model's override dials:
 * detection 1 / retention 0 makes the first sweep a certain find and the
 * second a certain loss, with no dice where certainty reigns.
 */

const CERTAIN_THEN_LOST = {
  override: { detection: 1, intelligence: 0, retention: 0, reacquisition: 0 },
}

function hunterFile(sensorModel: Record<string, unknown> = CERTAIN_THEN_LOST): CampaignFile {
  const scenario = blankScenario({
    mapSeed: 5,
    mapWidth: 40,
    mapHeight: 20,
    rounds: 20,
    forces: {
      A: [
        {
          id: 'a-scout',
          kind: 'ship',
          name: 'USS Beagle',
          ships: ['union-nelson-ii-class-light-frigate'],
          hex: { q: 10, r: 5 },
          order: { speed: 'hold' },
        },
      ],
      B: [
        {
          id: 'b-runner',
          kind: 'ship',
          name: 'IMS Quarry',
          ships: ['vallari-v-6l-savage-class-light-cruiser'],
          hex: { q: 12, r: 5 },
          order: { speed: 'hold' },
        },
      ],
    },
    tuning: {
      detectionCurve: [1, 1, 1, 1, 1, 1],
      misinformationBase: 0,
      falseContacts: false,
      sensorModel,
      pirates: { enabled: false },
    },
  })
  const file = newCampaign(scenario, 'c-sensorlog')
  file.map.terrain = [] // clean space: nothing owes movement debts
  return file
}

const ctxOf = (file: CampaignFile): DetectionContext => ({ map: file.map, scenario: file.scenario })

function pass(file: CampaignFile, phases: number): void {
  for (let i = 0; i < phases; i++) {
    const move: PhaseMove = {
      round: file.state.round,
      phase: file.state.phase,
      side: sideToMove(file.state.phase),
      interventions: [],
    }
    file.state = resolvePhase(ctxOf(file), file.state, move)
  }
}

const logOf = (file: CampaignFile, side: 'A' | 'B') =>
  file.state.sensorLog.filter((e) => e.side === side)

describe('the sensor log', () => {
  it('tells the track story: gained, lost, gone cold — with the spotter named', () => {
    const file = hunterFile()
    pass(file, 1)
    // Certain detection at range 2: both scopes light up on the first sweep.
    expect(logOf(file, 'A')).toHaveLength(1)
    expect(logOf(file, 'A')[0].text).toBe('New contact at 12,5 — flagged by USS Beagle.')
    expect(logOf(file, 'B')[0].text).toBe('New contact at 10,5 — flagged by IMS Quarry.')

    // Retention zero: the very next sweep loses the track, once.
    pass(file, 1)
    expect(logOf(file, 'A')[1].text).toMatch(/^Track lost — last held near 12,5\./)
    pass(file, 2)
    expect(logOf(file, 'A')).toHaveLength(2) // a lost track is not re-lost

    // Reacquisition zero: three quiet rounds later the record goes cold.
    pass(file, 16 * 4 - 4)
    const cold = logOf(file, 'A').filter((e) => /gone cold/.test(e.text))
    expect(cold).toHaveLength(1)
    expect(cold[0].text).toMatch(/three quiet rounds; last known near 12,5\./)
  })

  it('is private per side: the view carries only your own log', () => {
    const file = hunterFile()
    pass(file, 1)
    const viewA = viewFor(file.map, file.state, 'A')
    expect(viewA.sensorLog).toHaveLength(1)
    expect(viewA.sensorLog[0].text).toContain('USS Beagle')
    expect(JSON.stringify(viewA.sensorLog)).not.toContain('IMS Quarry')
  })

  it('a picture dies with its last spotter, and the log says so', () => {
    const file = hunterFile()
    pass(file, 1)
    expect(file.state.contacts.some((c) => c.side === 'A')).toBe(true)
    // The scout is lost (however that happens); its hard-won picture goes too.
    file.state.units = file.state.units.filter((u) => u.id !== 'a-scout')
    pruneOrphanTracks(file.state)
    expect(file.state.contacts.some((c) => c.side === 'A')).toBe(false)
    const gone = logOf(file, 'A').filter((e) => /died with the last hull/.test(e.text))
    expect(gone).toHaveLength(1)
  })

  it('a ghost is logged in exactly the words a real sighting gets', () => {
    // One lonely searcher, false contacts certain: every sweep hallucinates.
    const file = hunterFile({ falseContactPassive: 1 })
    file.scenario.tuning.falseContacts = true
    file.scenario.forces.B = []
    file.state.units = file.state.units.filter((u) => u.side === 'A')
    pass(file, 1)
    const entries = logOf(file, 'A')
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.text).toMatch(/^New contact at -?\d+,-?\d+ — flagged by USS Beagle\.$/)
    }
  })
})
