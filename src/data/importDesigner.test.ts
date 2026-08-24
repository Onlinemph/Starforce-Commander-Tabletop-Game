import { describe, expect, it } from 'vitest'
import sample from './designerExport.sample.json'
import { designerFormToShipForm, looksLikeDesignerExport, type DesignerExport } from './importDesigner'
import { registerCustomForms } from './ships'
import { startScenario } from './scenarios'
import { pointValue } from '../engine/shipBuilder'
import { applyAction } from '../engine/actions'
import { aiNextActions, createAiMemo } from '../engine/ai'

/**
 * The Ship Designer import (crazyvulcan.github.io), pinned on a real export.
 * The sample is the designer's blank template — which is exactly what makes
 * it a good schema fixture: every block is present, most of them in their
 * default shapes.
 */

const convert = () => {
  const result = designerFormToShipForm(sample as DesignerExport)
  if (typeof result === 'string') throw new Error(result)
  return result
}

describe('detecting the format', () => {
  it('recognizes a designer export and not one of our forms', () => {
    expect(looksLikeDesignerExport(sample)).toBe(true)
    expect(looksLikeDesignerExport({ id: 'x', name: 'y', weapons: [] })).toBe(false)
    expect(looksLikeDesignerExport(null)).toBe(false)
  })
})

describe('the conversion, pinned on the sample export', () => {
  it('identity, shields, armor and printed point value carry over', () => {
    const { form } = convert()
    expect(form.name).toBe('CLASSNAME ID-class Weight Class')
    expect(form.faction).toBe('COMMON')
    expect(form.pointValue).toBe(17)
    expect(form.provisional).toBe(true)
    expect(form.shields.blue).toEqual({ F: 13, A: 8, P: 4, S: 5 })
    expect(form.shields.generatorBoxes).toBe(3)
    expect(form.shields.green.F).toBe(2)
    expect(form.armor).toEqual({ F: 7, A: 4, P: 0, S: 0 })
  })

  it('power tracks become reactors, batteries and FTL boxes', () => {
    const { form } = convert()
    const kinds = form.reactors.map((r) => r.hitKind)
    expect(kinds).toEqual(['left-main', 'right-main', 'center-main', 'sublight-reactor', 'aux'])
    // Two points with boxPattern [2,1,2]: the first two pattern entries.
    expect(form.reactors[0].points).toEqual([{ boxes: 2 }, { boxes: 1 }])
    expect(form.reactors[3].points).toHaveLength(3) // SL REAC, three points
    expect(form.batteries).toBe(2)
    expect(form.ftlDriveBoxes).toBe(0)
  })

  it('only the enabled weapon with real brackets imports, dice and special intact', () => {
    const { form } = convert()
    expect(form.weapons).toHaveLength(1)
    const weapon = form.weapons[0]
    expect(weapon.name).toBe('DAFG')
    expect(weapon.brackets).toEqual([
      { min: 0, max: 6, band: 'green', dice: ['red', 'red'] },
      { min: 7, max: 12, band: 'black', dice: ['yellow', 'yellow'] },
    ])
    expect(weapon.special).toEqual({ damage: 6, leak: 3, structure: 2 })
    // Three mount specs: '1', '2|5', '6' → FS, SF+AP, PA.
    expect(weapon.mounts.map((m) => m.arcs)).toEqual([['FS'], ['SF', 'AP'], ['PA']])
    // powerStops [2, 4] on a 1-circle mount: no gates fit — none invented.
    expect(weapon.mounts[0].armingCircles).toBe(1)
    expect(weapon.mounts[0].roundGates).toBeUndefined()
    // The arming line references the imported weapon.
    const line = form.functions.find((l) => l.kind === 'weapon')!
    expect(line.weaponSystemId).toBe(weapon.id)
    expect(line.freeValue).toBe(1)
  })

  it('function ladders, structure, sublight and systems translate', () => {
    const { form } = convert()
    const sensor = form.functions.find((l) => l.kind === 'sensor')!
    expect(sensor.steps).toEqual([{ powerCost: 1, value: 1 }])
    const gensys = form.functions.find((l) => l.kind === 'gen-sys')!
    expect(gensys.freeValue).toBe(1) // NRM comes lit
    expect(gensys.steps).toHaveLength(1) // MAX is one circle up
    expect(form.functions.some((l) => l.kind === 'emergency-turn')).toBe(true) // emer: true
    expect(form.functions.find((l) => l.kind === 'ftl-drive')!.steps).toHaveLength(2)

    expect(form.structure.filter((e) => e.kind === 'box')).toHaveLength(7) // 2 black + 5 red
    expect(form.structure.filter((e) => e.kind === 'box' && e.color === 'black')).toHaveLength(2)

    expect(form.sublight.maxSpeed).toBe(6)
    // Printed rows descend 6..0 with turns [20,20,35,20,20,20,40].
    expect(form.sublight.turnBySpeed).toEqual([40, 20, 20, 20, 35, 20, 20])
    expect(form.sublight.driveBoxes).toBe(0) // no damage stops marked

    const kinds = form.systems.map((s) => s.kind)
    expect(kinds).toContain('LNDG') // LAND maps to the landing bay
    expect(kinds).toContain('CLOAK')
    expect(form.systems.find((s) => s.kind === 'SPCL')?.label).toBe('FCON')
    expect(form.scoutSensor?.sensors).toBe(1) // SCOUT 1 became the scout block

    // Heuristic meta, from the canon ladders: 7 boxes reads as a size-2 hull.
    expect(form.sizeClass).toBe(2)
    expect(form.stressRating).toBe(2)
    expect(form.damageControlRating).toBe(2)
    expect(form.shuttles).toBe(2)
    expect(form.marineSquads).toBe(10)
  })
})

describe('an imported design is actually playable', () => {
  it('prices through the builder model and fights a few AI phases', () => {
    const { form } = convert()
    expect(() => pointValue(form)).not.toThrow()
    expect(pointValue(form).actualPower).toBeGreaterThan(0)

    registerCustomForms([form])
    const game = startScenario('s3.1-the-duel', {
      seed: 3,
      fleets: {
        'Blue Force': [form.id],
        'Red Force': ['union-nelson-ii-class-light-frigate'],
      },
    })
    const memo = createAiMemo()
    for (let guard = 0; guard < 200 && game.round <= 2; guard++) {
      const batch = aiNextActions(game, ['Blue Force', 'Red Force'], memo, false, 'captain')
      if (batch.length === 0) {
        applyAction(game, { type: 'advance-segment' })
        continue
      }
      for (const action of batch) applyAction(game, action)
    }
    expect(game.round).toBeGreaterThanOrEqual(2) // the engine played it without choking
  })
})
