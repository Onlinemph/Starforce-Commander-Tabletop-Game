import { describe, expect, it } from 'vitest'
import { shipFormById } from '../data/ships'
import { unitActor } from './detection'
import { blankScenario, newCampaign } from './file'
import { unitDamageBand } from './logistics'
import {
  approachTrials,
  cloakCapable,
  cloakEffective,
  effectiveSpeed,
  labActor,
  labUnit,
  rangeSweep,
  readSituation,
  sweepCsv,
  type LabShipSetup,
  type LabSituation,
} from './sensorLab'
import { detectionProbability, intelligenceProbability } from './sensorModel'
import type { CampaignFile } from './types'

/**
 * The Sensor Lab (the designer's ask: a workbook for checking the detection
 * math with real ships in it). The load-bearing test is the first one — the
 * lab must report what the CAMPAIGN would compute, or it is a second model
 * pretending to check the first.
 */

const YORKTOWN = shipFormById('union-yorktown-ii-class-heavy-cruiser')!
const FLANKER = shipFormById('vallari-v-2p-flanker-class-scout')!
const HERMES = shipFormById('union-hermes-iv-class-scout')!
const RUNNER = shipFormById('union-runner-class-light-freighter')!
const NOCTURNE = shipFormById('aurelian-corvus-i-class-destroyer')!

function setup(form = YORKTOWN, over: Partial<LabShipSetup> = {}): LabShipSetup {
  return {
    form,
    speed: 4,
    active: false,
    cloaked: false,
    damage: 'fresh',
    shipCount: 1,
    formation: 'standard',
    terrain: 0,
    civilian: false,
    ...over,
  }
}

function situation(over: Partial<LabSituation> = {}): LabSituation {
  return {
    searcher: setup(),
    target: setup(FLANKER),
    range: 3,
    interveningTerrain: 0,
    previousRange: 3,
    ...over,
  }
}

describe('the lab reports what the campaign computes', () => {
  it('matches a real campaign sweep, hull for hull and factor for factor', () => {
    // A campaign with the same two ships, placed at the same range.
    const file: CampaignFile = newCampaign(
      blankScenario({
        mapSeed: 4,
        mapWidth: 30,
        mapHeight: 20,
        forces: {
          A: [
            {
              id: 'a-1',
              kind: 'ship',
              name: 'searcher',
              ships: [YORKTOWN.id],
              hex: { q: 5, r: 5 },
              order: { speed: 'emergency', exactSpeed: 4 },
            },
          ],
          B: [
            {
              id: 'b-1',
              kind: 'ship',
              name: 'target',
              ships: [FLANKER.id],
              hex: { q: 8, r: 5 },
              order: { speed: 'emergency', exactSpeed: 4 },
            },
          ],
        },
      }),
      'c-lab',
    )
    file.map.terrain = [] // clear space either side, and nothing between
    for (const unit of file.state.units) unit.movedLastOwnPhase = true

    const searcher = file.state.units.find((u) => u.id === 'a-1')!
    const target = file.state.units.find((u) => u.id === 'b-1')!
    const geom = { range: 3, interveningTerrain: 0 }
    const campaignDetection = detectionProbability(
      unitActor(file.map, searcher, 'searcher'),
      unitActor(file.map, target, 'target'),
      geom,
    )
    const campaignIntel = intelligenceProbability(
      unitActor(file.map, searcher, 'searcher'),
      unitActor(file.map, target, 'target'),
      geom,
    )

    const reading = readSituation(situation())
    expect(reading.detection).toBe(campaignDetection.p)
    expect(reading.intelligence).toBe(campaignIntel.p)
    expect(reading.detectionFactors).toEqual(campaignDetection.factors)
    // And the actors themselves are the campaign's, not a copy.
    expect(labActor(setup(), 'searcher')).toEqual(unitActor(file.map, searcher, 'searcher'))
  })

  it('states the per-round truth: sixteen scans, not one', () => {
    const reading = readSituation(situation())
    expect(reading.detection).toBeGreaterThan(0)
    expect(reading.detectionPerRound).toBeCloseTo(1 - (1 - reading.detection) ** 16, 12)
    expect(reading.detectionPerRound).toBeGreaterThan(reading.detection)
    // The even-odds scan count agrees with the cumulative curve.
    const n = reading.scansToEven
    expect(1 - (1 - reading.detection) ** n).toBeCloseTo(0.5, 10)
  })
})

describe('the situation inputs move the numbers the way the rules say', () => {
  it('range, terrain, speed and cloak each make a target harder to find', () => {
    const base = readSituation(situation()).detection
    expect(readSituation(situation({ range: 6 })).detection).toBeLessThan(base)
    expect(readSituation(situation({ interveningTerrain: 2 })).detection).toBeLessThan(base)
    // A searcher tearing along hears less; a target running fast is louder.
    expect(readSituation(situation({ searcher: setup(YORKTOWN, { speed: 8 }) })).detection).toBeLessThan(base)
    expect(readSituation(situation({ target: setup(FLANKER, { speed: 8 }) })).detection).toBeGreaterThan(base)
    const cloaked = situation({ target: setup(NOCTURNE, { cloaked: true }) })
    const uncloaked = situation({ target: setup(NOCTURNE, { cloaked: false }) })
    expect(readSituation(cloaked).detection).toBeLessThan(readSituation(uncloaked).detection)
  })

  it('a civilian hull is loud, and a scout searches better than a cruiser', () => {
    const merchant = readSituation(situation({ target: setup(RUNNER, { civilian: true }) })).detection
    const warship = readSituation(situation({ target: setup(RUNNER, { civilian: false }) })).detection
    expect(merchant).toBeGreaterThan(warship)
    const scout = readSituation(situation({ searcher: setup(HERMES) })).detection
    const cruiser = readSituation(situation()).detection
    expect(scout).toBeGreaterThan(cruiser)
  })

  it('carries the campaign consequences a bare formula would miss', () => {
    // A crippled hull cannot hold a cloak (3.2), even ticked here.
    expect(cloakCapable(NOCTURNE)).toBe(true)
    expect(cloakEffective(setup(NOCTURNE, { cloaked: true }))).toBe(true)
    expect(cloakEffective(setup(NOCTURNE, { cloaked: true, damage: 'crippled' }))).toBe(false)
    // A merchant hull cannot make a warship's pace (the designer's 1–3 note).
    expect(effectiveSpeed(setup(RUNNER, { civilian: true, speed: 8 }))).toBeLessThanOrEqual(3)
    // The damage band the lab asks for is the band the campaign reads back.
    for (const band of ['fresh', 'damaged', 'crippled'] as const) {
      expect(unitDamageBand(labUnit(setup(YORKTOWN, { damage: band })))).toBe(band)
    }
  })

  it('a close formation reads as one contact, and its lead ship does the scanning', () => {
    const spread = situation({ target: setup(FLANKER, { shipCount: 4, formation: 'standard' }) })
    const tight = situation({ target: setup(FLANKER, { shipCount: 4, formation: 'close' }) })
    expect(labActor(spread.target, 'target').shipCount).toBe(4)
    expect(labActor(tight.target, 'target').shipCount).toBe(1)
    expect(readSituation(tight).detection).toBeGreaterThan(readSituation(spread).detection)
  })
})

describe('the sweep and the approach', () => {
  it('sweeps every range, falling away as it goes, and exports as a spreadsheet', () => {
    const rows = rangeSweep(situation(), 8)
    expect(rows).toHaveLength(9)
    expect(rows[0].range).toBe(0)
    expect(rows[0].detection).toBeGreaterThan(rows[8].detection)
    for (const row of rows) {
      expect(row.detection).toBeGreaterThanOrEqual(0)
      expect(row.detection).toBeLessThanOrEqual(1)
      expect(row.detectionPerRound).toBeGreaterThanOrEqual(row.detection)
    }
    const csv = sweepCsv(situation(), rows)
    expect(csv).toContain('range,detection %')
    expect(csv).toContain(YORKTOWN.name)
    expect(csv.trim().split('\n')).toHaveLength(5 + 9) // header block + a row per range
  })

  it('the approach answers "at what range do I see them?", and is reproducible', () => {
    const closing = situation({
      searcher: setup(YORKTOWN, { speed: 0 }),
      target: setup(FLANKER, { speed: 4 }),
    })
    const run = approachTrials(closing, { startRange: 8, trials: 400, seed: 7 })
    expect(run.trials).toBe(400)
    expect(run.detected).toBeGreaterThan(0)
    expect(run.meanRange).not.toBeNull()
    expect(run.meanRange!).toBeGreaterThan(0)
    expect(run.meanRange!).toBeLessThanOrEqual(8)
    expect(run.byRange.reduce((n, b) => n + b.contacts, 0)).toBe(run.detected)
    // Same seed, same run — two designers comparing notes see one answer.
    expect(approachTrials(closing, { startRange: 8, trials: 400, seed: 7 })).toEqual(run)
    // Loudness at the SAME closing rate: a target lighting up its own active
    // sensors (+7 signature speed, §5) is picked up further out.
    const loud = approachTrials(
      situation({
        searcher: setup(YORKTOWN, { speed: 0 }),
        target: setup(FLANKER, { speed: 4, active: true }),
      }),
      { startRange: 8, trials: 400, seed: 7 },
    )
    expect(loud.meanRange!).toBeGreaterThan(run.meanRange!)
    expect(loud.detected).toBeGreaterThanOrEqual(run.detected)
  })

  it('creeping in slowly is not stealth: a slow approach gives the picket more looks', () => {
    // An emergent result worth knowing at the table — the per-scan odds fall
    // with speed, but a slow closer spends more phases in every range band,
    // and the extra scans more than pay the quieter signature back.
    const picket = setup(YORKTOWN, { speed: 0 })
    const fast = approachTrials(
      situation({ searcher: picket, target: setup(FLANKER, { speed: 6 }) }),
      { startRange: 8, trials: 400, seed: 11 },
    )
    const crawl = approachTrials(
      situation({ searcher: picket, target: setup(FLANKER, { speed: 1 }) }),
      { startRange: 8, trials: 400, seed: 11 },
    )
    expect(crawl.meanRange!).toBeGreaterThan(fast.meanRange!)
  })
})
