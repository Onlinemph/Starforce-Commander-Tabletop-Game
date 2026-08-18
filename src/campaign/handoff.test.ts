import { describe, expect, it } from 'vitest'
import { buildGame, type SavedGame } from '../data/savedGame'
import { applyAction, type GameAction } from '../engine/actions'
import { aiNextActions, createAiMemo, type AiMemo } from '../engine/ai'
import { activeShips, type GameState } from '../engine/game'
import { hitPointDamage } from '../engine/shipState'
import { blankScenario, newCampaign } from './file'
import { battleFileFor, hashText, readback, shipKeys } from './handoff'
import { damageBand, repairTick, scarHp, unitDamageBand } from './logistics'
import { resolvePhase, PhaseError, type DetectionContext } from './turn'
import { unitProfile } from './detection'
import { viewFor } from './views'
import {
  sideToMove,
  type BattleResult,
  type CampaignFile,
  type PhaseMove,
  type ShipRecord,
} from './types'
import type { ShipScars } from '../engine/shipState'

/**
 * The handoff (Part 7): the fog meets the table and the scars come home.
 * Deterministic throughout — a certain or empty detection curve where the
 * test is about engagement logic, the campaign stream everywhere else.
 */

const CERTAIN = [1, 1, 1, 1, 1, 1]

function warFile(over: {
  curve?: readonly number[]
  aHex?: { q: number; r: number }
  bHex?: { q: number; r: number }
  aShips?: string[]
  bShips?: string[]
  aOrder?: Record<string, unknown>
  bOrder?: Record<string, unknown>
}): CampaignFile {
  const scenario = blankScenario({
    mapSeed: 11,
    mapWidth: 20,
    mapHeight: 20,
    forces: {
      A: [
        {
          id: 'a-1',
          kind: 'ship',
          name: 'USS Anvil',
          ships: over.aShips ?? ['union-yorktown-i-class-heavy-cruiser'],
          hex: over.aHex ?? { q: 8, r: 4 },
          order: { speed: 'hold', ...(over.aOrder ?? {}) },
        },
      ],
      B: [
        {
          id: 'b-1',
          kind: 'ship',
          name: 'VNS Hammer',
          ships: over.bShips ?? ['vallari-v-6l-savage-class-light-cruiser'],
          hex: over.bHex ?? { q: 9, r: 4 },
          order: { speed: 'hold', ...(over.bOrder ?? {}) },
        },
      ],
    },
    tuning: { detectionCurve: over.curve ?? CERTAIN, misinformationBase: 0, falseContacts: false },
  })
  const file = newCampaign(scenario, 'c-war')
  file.map.terrain = [] // clean space; terrain translation is tested directly
  return file
}

const ctxOf = (file: CampaignFile): DetectionContext => ({ map: file.map, scenario: file.scenario })

function pass(file: CampaignFile, battles?: PhaseMove['battles']): void {
  const move: PhaseMove = {
    round: file.state.round,
    phase: file.state.phase,
    side: sideToMove(file.state.phase),
    interventions: [],
    ...(battles ? { battles } : {}),
  }
  file.state = resolvePhase(ctxOf(file), file.state, move)
  file.journal.push(move)
}

/** March B onto A's hex: same hex plus a certain curve means an engagement. */
function collide(file: CampaignFile): void {
  pass(file) // A's phase: scans land both ways
  const b = file.state.units.find((u) => u.id === 'b-1')!
  b.hex = { ...file.state.units.find((u) => u.id === 'a-1')!.hex }
  pass(file) // B's phase: co-located and known → pending battle
}

describe('engagement triggering (7.1)', () => {
  it('known and co-located means a battle, and the campaign then waits', () => {
    const file = warFile({})
    collide(file)
    expect(file.state.pendingBattles).toHaveLength(1)
    // No counter moves while the table is waiting.
    expect(() => pass(file)).toThrow(/unresolved/)
  })

  it('a cloaked hull nobody has found passes silently — or springs an ambush', () => {
    const silent = warFile({
      curve: [0, 0, 0, 0, 0, 0],
      bShips: ['aurelian-corvus-i-class-destroyer'],
      bOrder: { cloaked: true, engagement: 'silent' },
      bHex: { q: 8, r: 4 }, // same hex from the start
    })
    pass(silent)
    pass(silent)
    expect(silent.state.pendingBattles).toHaveLength(0)

    const ambush = warFile({
      curve: [0, 0, 0, 0, 0, 0],
      bShips: ['aurelian-corvus-i-class-destroyer'],
      bOrder: { cloaked: true, engagement: 'fight' },
      bHex: { q: 8, r: 4 },
    })
    pass(ambush)
    expect(ambush.state.pendingBattles).toHaveLength(1)
    expect(ambush.state.pendingBattles[0].ambushBy).toBe('B')
  })

  it('a withdrawal with a sprint and a thin dossier always slips away (7.2)', () => {
    // Nelson II carries FTL 2 (+2) and one phase of scanning leaves the
    // dossier at two rungs (+2): worst roll totals five — guaranteed escape.
    const file = warFile({
      aShips: ['union-nelson-ii-class-light-frigate'],
      aOrder: { engagement: 'withdraw' },
    })
    collide(file)
    expect(file.state.pendingBattles).toHaveLength(0)
    const a = file.state.units.find((u) => u.id === 'a-1')!
    const b = file.state.units.find((u) => u.id === 'b-1')!
    expect(a.hex).not.toEqual(b.hex)
  })
})

describe('the battle file (7.3)', () => {
  it('is a golden file: same engagement, same bytes', () => {
    const file = warFile({})
    collide(file)
    const one = JSON.stringify(battleFileFor(ctxOf(file), file.state, file.campaignId, file.state.pendingBattles[0]))
    const two = JSON.stringify(battleFileFor(ctxOf(file), file.state, file.campaignId, file.state.pendingBattles[0]))
    expect(one).toBe(two)
    expect(hashText(one)).toBe(hashText(two))
  })

  it('the richer dossier deploys second, and the file says why', () => {
    const file = warFile({})
    collide(file)
    // A's Yorktown out-scienced B: its dossier is deeper by construction
    // (two rungs a scan against one). Deployment order makes that physical.
    const battle = battleFileFor(ctxOf(file), file.state, file.campaignId, file.state.pendingBattles[0])
    const scenario = battle.setup.customScenario!
    expect(scenario.sides[1].side).toBe('Alpha Command')
    expect(scenario.specialRules?.join(' ')).toContain('deploys second')
    expect(battle.setup.campaignRef.engagementId).toBe(file.state.pendingBattles[0].id)
  })

  it('carries exact scars in, and deploy marks the very boxes', () => {
    const file = warFile({})
    const a = file.state.units.find((u) => u.id === 'a-1')!
    a.ships[0].scars = {
      structure: 3,
      reactors: {},
      batteries: [],
      ftl: 1,
      systems: { SENS: 2 },
      scout: 0,
      shieldGenerator: 1,
      armor: { F: 0, S: 0, A: 0, P: 0 },
      mounts: {},
    }
    collide(file)
    const battle = battleFileFor(ctxOf(file), file.state, file.campaignId, file.state.pendingBattles[0])
    const aSide = battle.setup.customScenario!.sides.find((s) => s.side === 'Alpha Command')!
    expect(aSide.scars?.[0]?.structure).toBe(3)

    const game = buildGame(battle.setup)
    const ship = game.ships.find((s) => s.side === 'Alpha Command')!
    expect(ship.structureDamaged.filter(Boolean)).toHaveLength(3)
    expect(ship.systemDamage['SENS']).toBe(2)
    expect(ship.ftlDriveDamage).toBe(1)
    expect(ship.shieldGeneratorDamage).toBe(1)
    // The ledger baseline prices the old wounds at exactly their hit points.
    expect(ship.preDamaged * 2).toBe(hitPointDamage(ship))
  })
})

describe('fight it, read it back, carry the scars (7.4)', () => {
  it('a real battle round-trips: readback, application, and the next file remembers', () => {
    // A dreadnought against a light cruiser, retreats off: decisive by
    // construction. (An even duel at captain rank can end with every internal
    // box repaired by damage control — an honest no-scars result, but not the
    // round-trip this test is for.)
    const file = warFile({ aShips: ['union-union-iii-class-dreadnought'] })
    collide(file)
    const engagement = file.state.pendingBattles[0]
    const battle = battleFileFor(ctxOf(file), file.state, file.campaignId, engagement)

    // The tabletop plays it — here, the AI at the wheel for both sides.
    const game: GameState = buildGame(battle.setup)
    const journal: GameAction[] = []
    const sides = [...new Set(game.ships.map((s) => s.side))]
    const memos = new Map<string, AiMemo>(sides.map((x) => [x, createAiMemo()]))
    const drive = (closing: boolean) => {
      for (let guard = 0; guard < 50; guard++) {
        const before = game.log.length + game.firingStepIndex + game.firedThisSegment.size
        for (const side of sides) {
          for (let g = 0; g < 400; g++) {
            const batch = aiNextActions(game, [side], memos.get(side)!, closing && guard === 0 && g === 0, 'captain', 'steady', false)
            if (batch.length === 0) break
            for (const action of batch) {
              applyAction(game, action)
              journal.push(action)
            }
          }
        }
        if (game.log.length + game.firingStepIndex + game.firedThisSegment.size === before) return
      }
    }
    drive(false)
    for (let step = 0; step < 300; step++) {
      if (new Set(activeShips(game).map((s) => s.side)).size <= 1 || game.round > 14) break
      drive(true)
      applyAction(game, { type: 'advance-segment' })
      journal.push({ type: 'advance-segment' })
      drive(false)
    }
    const fought: SavedGame = { version: 1, setup: battle.setup, actions: journal }
    const text = JSON.stringify(fought)

    const result = readback(file.state, engagement, text)
    expect(typeof result).not.toBe('string')
    const r = result as BattleResult
    const keys = [...shipKeys(file.state, engagement, 'A'), ...shipKeys(file.state, engagement, 'B')]
    expect(Object.keys(r.ships).sort()).toEqual([...keys].sort())
    // Two AI captains at knife range: SOMETHING happened to somebody.
    const touched = Object.values(r.ships).some((s) => s.destroyed || s.scars !== null)
    expect(touched).toBe(true)

    // The result rides the journal into the next move.
    pass(file, [{ engagementId: engagement.id, fileHash: hashText(JSON.stringify(battle)), result: r }])
    expect(file.state.pendingBattles.some((p) => p.id === engagement.id)).toBe(false)
    for (const [key, outcome] of Object.entries(r.ships)) {
      const [unitId, shipId] = key.split('/')
      const unit = file.state.units.find((u) => u.id === unitId)
      if (outcome.destroyed) {
        expect(unit?.ships.find((s) => s.id === shipId)).toBeUndefined()
      } else if (outcome.scars) {
        expect(unit?.ships.find((s) => s.id === shipId)?.scars).toEqual(outcome.scars)
      }
    }
    expect(file.state.vp.A + file.state.vp.B).toBeGreaterThan(0)
  })

  it('refuses a result for a battle nobody is waiting on', () => {
    const file = warFile({})
    const result: BattleResult = { ships: {}, vp: { A: 0, B: 0 } }
    expect(() =>
      resolvePhase(ctxOf(file), file.state, {
        round: 1,
        phase: 1,
        side: 'A',
        interventions: [],
        battles: [{ engagementId: 'eg-99', fileHash: '0', result }],
      }),
    ).toThrow(PhaseError)
  })
})

// ---------------------------------------------------------------------------
// Repair (3.2)
// ---------------------------------------------------------------------------

function scarred(): ShipScars {
  return {
    structure: 2,
    reactors: { main: [1, 0] },
    batteries: [true],
    ftl: 1,
    systems: { SENS: 2, TRAN: 1, __sublight: 1 },
    scout: 0,
    shieldGenerator: 1,
    armor: { F: 1, S: 0, A: 0, P: 0 },
    mounts: { laser: [2] },
  }
}

describe('repair queues (3.2)', () => {
  function hospitalFile() {
    const file = warFile({ curve: [0, 0, 0, 0, 0, 0], bHex: { q: 18, r: 0 } })
    const ship = file.state.units.find((u) => u.id === 'a-1')!.ships[0]
    ship.scars = scarred()
    return { file, ship }
  }

  it('underway fixes one system box a round, down the priority queue, never structure', () => {
    const { file, ship } = hospitalFile()
    const before = scarHp(ship.scars!)
    repairTick(file.state)
    // Default queue: drive first — the FTL box goes before anything else.
    expect(ship.scars!.ftl).toBe(0)
    expect(ship.scars!.structure).toBe(2)
    expect(scarHp(ship.scars!)).toBe(before - 1)
  })

  it('a fleet base yard fixes six systems and one red box a round', () => {
    const { file, ship } = hospitalFile()
    file.state.infrastructure.push({
      id: 'yard',
      side: 'A',
      kind: 'fleet-base',
      hex: { ...file.state.units.find((u) => u.id === 'a-1')!.hex },
      destroyed: false,
    })
    repairTick(file.state)
    expect(ship.scars!.structure).toBe(1)
    // Six system boxes gone: ftl, sublight, shgen, laser 2, SENS 1 by queue order.
    expect(ship.scars!.ftl).toBe(0)
    expect(ship.scars!.systems['__sublight']).toBe(0)
    expect(ship.scars!.shieldGenerator).toBe(0)
    expect(ship.scars!.mounts['laser'][0]).toBe(0)
    expect(ship.scars!.systems['SENS']).toBe(1)
  })

  it('the player reorders the queue by an ordinary, gated intervention', () => {
    const { file, ship } = hospitalFile()
    pass(file) // phase 1 (A)
    file.state = resolvePhase(ctxOf(file), file.state, {
      round: 1,
      phase: 2,
      side: 'B',
      interventions: [],
    })
    // B cannot set A's repair priorities — same ownership gate as every order.
    expect(() =>
      resolvePhase(ctxOf(file), file.state, {
        round: 1,
        phase: 3,
        side: 'A',
        interventions: [{ type: 'set-repair-priority', unitId: 'b-1', queue: ['weapons'] }],
      }),
    ).toThrow(/not A's unit/)
    file.state = resolvePhase(ctxOf(file), file.state, {
      round: 1,
      phase: 3,
      side: 'A',
      interventions: [{ type: 'set-repair-priority', unitId: 'a-1', queue: ['weapons', 'sensors'] }],
    })
    const scars = file.state.units.find((u) => u.id === 'a-1')!.ships[0].scars!
    const lasersBefore = scars.mounts['laser'][0]
    repairTick(file.state)
    const after = file.state.units.find((u) => u.id === 'a-1')!.ships[0].scars!
    expect(after.mounts['laser'][0]).toBe(lasersBefore - 1)
    expect(after.ftl).toBe(ship.scars!.ftl) // drive waits its new turn
  })
})

describe('damage bands feed the fog (3.2)', () => {
  it('a crippled hull is loud and cannot hold its cloak', () => {
    const file = warFile({ bShips: ['aurelian-corvus-i-class-destroyer'] })
    const unit = file.state.units.find((u) => u.id === 'b-1')!
    const fresh = unitProfile(unit)
    expect(fresh.cloakCapable).toBe(true)

    // Cripple it: well past sixty percent of its boxes.
    const record = unit.ships[0] as ShipRecord
    record.scars = {
      structure: 8,
      reactors: {},
      batteries: [],
      ftl: 1,
      systems: { SENS: 3, SCNC: 2, TRAC: 2, TRAN: 2, SHTL: 1, QTRS: 1, CLOAK: 1, CRGO: 1, __sublight: 2 },
      scout: 0,
      shieldGenerator: 2,
      armor: { F: 0, S: 0, A: 0, P: 0 },
      mounts: {},
    }
    if (damageBand(record) !== 'crippled') {
      record.scars.structure = 12 // whatever it takes past the band edge
    }
    expect(unitDamageBand(unit)).toBe('crippled')
    const hurt = unitProfile(unit)
    expect(hurt.cloakCapable).toBe(false)
    expect(hurt.signature).toBe(fresh.signature + 2)
  })
})

describe('the wall holds through a battle (the leak tests, Part 7 edition)', () => {
  it('an engagement in the view names your units, never theirs', () => {
    const file = warFile({})
    collide(file)
    for (const side of ['A', 'B'] as const) {
      const view = viewFor(file.map, file.state, side)
      expect(view.engagements).toHaveLength(1)
      const engagement = view.engagements[0]
      const own = side === 'A' ? 'a-1' : 'b-1'
      const enemy = side === 'A' ? 'b-1' : 'a-1'
      expect(engagement.yourUnitIds).toEqual([own])
      expect(JSON.stringify(view.engagements)).not.toContain(enemy)
    }
  })

  it('an ambush victim sees the engagement, not the ambusher', () => {
    const file = warFile({
      curve: [0, 0, 0, 0, 0, 0],
      bShips: ['aurelian-corvus-i-class-destroyer'],
      bOrder: { cloaked: true, engagement: 'fight' },
      bHex: { q: 8, r: 4 },
    })
    pass(file)
    expect(file.state.pendingBattles).toHaveLength(1)
    const victim = viewFor(file.map, file.state, 'A')
    const bytes = JSON.stringify(victim)
    expect(victim.engagements[0].youAmbush).toBe(false)
    expect(bytes).not.toContain('b-1')
    expect(bytes).not.toContain('aurelian-corvus')
    const ambusher = viewFor(file.map, file.state, 'B')
    expect(ambusher.engagements[0].youAmbush).toBe(true)
  })

  it('scars stay private: your hulls wear theirs, the enemy sees a band at most', () => {
    const file = warFile({ curve: [0, 0, 0, 0, 0, 0] })
    const a = file.state.units.find((u) => u.id === 'a-1')!
    a.ships[0].scars = scarred()
    const enemyView = viewFor(file.map, file.state, 'B')
    const bytes = JSON.stringify(enemyView)
    // No contact on a-1 at all here — and even with one, the dossier's
    // 'damage' rung is a WORD (fresh/damaged/crippled), never the box map.
    expect(bytes).not.toContain('"structure"')
    expect(bytes).not.toContain('shieldGenerator')
    const ownView = viewFor(file.map, file.state, 'A')
    expect(ownView.units[0].ships[0].scars?.structure).toBe(2)
  })
})
