import { describe, expect, it } from 'vitest'
import { startScenario } from '../data/scenarios'
import { replayGame } from '../data/savedGame'
import { applyAction, type GameAction } from './actions'
import { HIT_LABELS } from '../data/damageDeck'
import {
  autoChoices,
  decisionFor,
  drawAndResolve,
  probeDecision,
  resolveCard,
  type DamageChoice,
} from './damage'
import { cloneGame, damageContext, type GameState } from './game'
import { structureRemaining, type ShipState } from './shipState'

/**
 * Damage cards that hand the defender a choice (E8.4.1 and friends).
 *
 * The engine's own captain plays them by doctrine; a human's answers have to
 * survive into the journal instead, or a replay would quietly make different
 * ones. These pin both halves: what the options are, and that a scripted
 * answer replays exactly.
 */

function duel(seed = 3): { game: GameState; blue: ShipState; red: ShipState } {
  const game = startScenario('s3.1-the-duel', { seed })
  const blue = game.ships.find((s) => s.side === 'Blue Force')!
  const red = game.ships.find((s) => s.side === 'Red Force')!
  return { game, blue, red }
}

describe('a throwaway copy of the battle', () => {
  it('draws the same cards the original is about to', () => {
    const { game, blue } = duel()
    const copy = cloneGame(game)
    const twin = copy.ships.find((s) => s.id === blue.id)!

    drawAndResolve(blue, 6, damageContext(game))
    drawAndResolve(twin, 6, damageContext(copy))

    expect(structureRemaining(twin)).toBe(structureRemaining(blue))
    expect(twin.systemDamage).toEqual(blue.systemDamage)
    // And the copy is genuinely separate — the original never saw the copy's dice.
    expect(copy.rng).not.toBe(game.rng)
  })
})

describe('what a captain may choose', () => {
  it('offers system boxes for an Any Hit, never a critical or a power loss (E8.4.1)', () => {
    const { blue } = duel()
    const decision = decisionFor(blue, 'any-hit')
    const hits = decision.options.map((o) => o.choice.kind === 'any-hit' && o.choice.hit)
    expect(hits).toContain('sensors')
    expect(hits).toContain('shield-generator')
    expect(hits).toContain('any-weapon')
    expect(hits).not.toContain('bridge-hit')
    expect(hits).not.toContain('major-fire')
    expect(hits).not.toContain('shield-power-loss')
    expect(hits).not.toContain('casualties')
    // Structure is not on offer while anything else will take the hit.
    expect(hits).not.toContain('structure')
  })

  it('marks the doctrine’s own pick as the recommendation', () => {
    const { blue } = duel()
    const decision = decisionFor(blue, 'any-hit')
    const recommended = decision.options.filter((o) => o.recommended)
    expect(recommended).toHaveLength(1)
    expect(recommended[0].choice).toEqual({ kind: 'any-hit', hit: autoChoices.anyHit(blue) })
  })

  it('offers structure once nothing else is left (E8.4.1)', () => {
    const { blue } = duel()
    // Strip the ship to its frame: no systems, no weapons, no generators.
    for (const key of Object.keys(blue.systemDamage)) blue.systemDamage[key] = 99
    for (const group of blue.form.systems) blue.systemDamage[group.kind] = 99
    for (const weapon of blue.form.weapons) {
      blue.mounts[weapon.id].forEach((state, i) => {
        blue.mounts[weapon.id][i] = { ...state, armed: 0, damage: weapon.mounts[i].hitBoxes }
      })
    }
    for (const group of blue.form.reactors) {
      blue.reactorDamage[group.id] = group.points.map((p) => p.boxes)
    }
    blue.batteryDamaged = blue.batteryDamaged.map(() => true)
    blue.shieldGeneratorDamage = 99
    blue.systemDamage['__sublight'] = blue.form.sublight.driveBoxes
    blue.ftlDriveDamage = blue.form.ftlDriveBoxes
    blue.scoutSensorDamage = 99

    const hits = decisionFor(blue, 'any-hit').options.map(
      (o) => o.choice.kind === 'any-hit' && o.choice.hit,
    )
    expect(hits).toEqual(['structure'])
  })
})

describe('a scripted choice', () => {
  /** Resolve one Any Hit against a ship, with whatever script is in place. */
  const resolveAnyHit = (game: GameState, ship: ShipState) =>
    resolveCard(
      ship,
      { id: 'probe', category: 'general', primary: 'any-hit', stressIcon: false },
      damageContext(game),
    )

  it('is what the resolution uses, and the doctrine is not consulted', () => {
    const { game, blue } = duel(11)
    const decision = probeDecision([], () => {
      const copy = cloneGame(game)
      resolveAnyHit(copy, copy.ships.find((s) => s.id === blue.id)!)
    })
    expect(decision?.kind).toBe('any-hit')

    // Something the doctrine would not have taken: its own pick is elsewhere.
    const contrary = decision!.options.filter((o) => !o.recommended)[0]
    const hit = contrary.choice.kind === 'any-hit' ? contrary.choice.hit : 'structure'
    expect(hit).not.toBe(autoChoices.anyHit(blue))

    game.damageScript = [contrary.choice]
    resolveAnyHit(game, blue)
    expect(game.log.some((l) => l.message.includes(`Any Hit \u2192 ${HIT_LABELS[hit]}`))).toBe(true)
  })

  it('replays from the journal instead of being decided again', () => {
    const build = () => duel(21)
    const first = build()
    const decision = probeDecision([], () => {
      const copy = cloneGame(first.game)
      resolveAnyHit(copy, copy.ships.find((s) => s.id === first.blue.id)!)
    })
    const contrary = decision!.options.filter((o) => !o.recommended)[0]
    const script: GameAction = { type: 'queue-damage-choices', choices: [contrary.choice] }

    applyAction(first.game, script)
    resolveAnyHit(first.game, first.blue)
    const marked = JSON.stringify(first.blue.systemDamage)

    const again = build()
    applyAction(again.game, script)
    resolveAnyHit(again.game, again.blue)
    expect(JSON.stringify(again.blue.systemDamage)).toBe(marked)

    // And a battle that never queued the script decides it differently.
    const doctrine = build()
    resolveAnyHit(doctrine.game, doctrine.blue)
    expect(JSON.stringify(doctrine.blue.systemDamage)).not.toBe(marked)
  })

  it('is consumed once per decision, not once per legality check', () => {
    // Asking "is there a weapon to hit?" used to go through the live provider,
    // which ate a scripted answer before the actual pick ate a second one. The
    // probe answers one question per pass, so a resolution that consumes two
    // per card never converges — it just asks forever.
    const { game, blue } = duel(4)
    const card = {
      id: 'probe',
      category: 'weapon' as const,
      primary: 'any-weapon' as const,
      stressIcon: false,
    }
    let passes = 0
    const script: DamageChoice[] = []
    for (; passes < 8; passes++) {
      const decision = probeDecision(script, () => {
        const copy = cloneGame(game)
        resolveCard(copy.ships.find((s) => s.id === blue.id)!, card, damageContext(copy))
      })
      if (!decision) break
      script.push(decision.options[0].choice)
    }
    // One card, one question.
    expect(script).toHaveLength(1)
    expect(passes).toBe(1)
  })

  it('is spent by the action it was queued for, and never leaks into the next', () => {
    const { game, blue } = duel(5)
    applyAction(game, {
      type: 'queue-damage-choices',
      choices: [{ kind: 'any-hit', hit: 'sensors' }],
    })
    expect(game.damageScript).toHaveLength(1)
    applyAction(game, { type: 'pass-fire', shipId: blue.id })
    expect(game.damageScript).toHaveLength(0)
  })

  it('is refused when it names something the rules do not allow', () => {
    const { game, blue } = duel(7)
    // A battery this ship does not have: the doctrine answers instead.
    game.damageScript = [{ kind: 'battery', index: 99 } as DamageChoice]
    const expected = autoChoices.anyHit(blue)
    resolveAnyHit(game, blue)
    expect(game.log.some((l) => l.message.includes(HIT_LABELS[expected]))).toBe(true)
  })
})

describe('journalled choices survive a save', () => {
  it('replays through the save format unchanged', () => {
    const saved = {
      version: 1 as const,
      setup: { scenarioId: 's3.1-the-duel', seed: 9 },
      actions: [
        { type: 'queue-damage-choices', choices: [{ kind: 'any-hit', hit: 'sensors' }] },
      ] as GameAction[],
    }
    const rebuilt = replayGame(JSON.parse(JSON.stringify(saved)))
    // The action applied and then cleared itself, exactly as it did live.
    expect(rebuilt.damageScript).toEqual([{ kind: 'any-hit', hit: 'sensors' }])
  })
})
