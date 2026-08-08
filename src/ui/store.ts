import { useSyncExternalStore } from 'react'
import {
  buildGame,
  parseSavedGame,
  replayGame,
  withEmbeddedForms,
  type GameSetup,
  type SavedGame,
} from '../data/savedGame'
import {
  actionSide,
  applyAction,
  undoableInMatch,
  type ActionOutcome,
  type GameAction,
} from '../engine/actions'
import { aiNextActions, createAiMemo, setRolloutEnemyRank, type AiMemo } from '../engine/ai'
import { probeDecision, type DamageChoice, type DamageDecision } from '../engine/damage'
import { cloneGame, everyoneReady, sidesAwaited, type GameState } from '../engine/game'
import { stateHash } from '../engine/stateHash'
import { fxAfter, fxBefore, type BattleFx } from './fx'
import { soundFx } from './sound'

/**
 * The store journals every action it applies, so the battle on screen is
 * always (setup + journal) — and that record is what autosave writes, what
 * undo rewinds through, and what an exported battle file contains. The engine
 * still mutates in place; the UI subscribes to a version counter.
 */

const SAVE_KEY = 'sfc.saved-game.v1'

const DEFAULT_SETUP: GameSetup = { scenarioId: 's3.1-the-duel', seed: 0x5f04ce }

let setup: GameSetup = DEFAULT_SETUP
let journal: GameAction[] = []
let game: GameState = restore()

let version = 0
const listeners = new Set<() => void>()

function emit(): void {
  version += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** For components that watch something other than the game itself. */
export const subscribeStore = subscribe

// ---------------------------------------------------------------------------
// Battle visuals
// ---------------------------------------------------------------------------

/**
 * Ephemeral weapon-fire and damage effects, queued as actions land and pruned
 * once played. When several volleys arrive in one synchronous burst — an AI
 * closing a segment fires everything at once — each volley is pushed back
 * behind the one before it, so the barrage reads as sequential fire.
 */
let fxQueue: BattleFx[] = []
let fxBase = 0
let fxBaseReset = false
let fxPrune: ReturnType<typeof setTimeout> | null = null

export function activeFx(): BattleFx[] {
  return fxQueue
}

function queueFx(...groups: BattleFx[][]): void {
  const batch = groups.flat()
  if (batch.length === 0) return
  const staggered = batch.map((fx) => ({ ...fx, delay: fx.delay + fxBase }))
  fxQueue = [...fxQueue, ...staggered]
  // The battle heard, on the same clock as the battle seen.
  soundFx(staggered)
  const span = Math.max(...batch.map((fx) => fx.delay)) + 700
  // Stagger later volleys of the same burst, but never queue a minute of it.
  fxBase = Math.min(fxBase + span, 3600)
  if (!fxBaseReset) {
    fxBaseReset = true
    queueMicrotask(() => {
      fxBase = 0
      fxBaseReset = false
    })
  }
  if (fxPrune) clearTimeout(fxPrune)
  fxPrune = setTimeout(() => {
    fxQueue = []
    emit()
  }, fxBase + 4500)
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function saved(): SavedGame {
  return { version: 1, setup, actions: journal }
}

function autosave(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saved()))
  } catch {
    // Quota or private browsing: the battle still plays, it just won't survive
    // a refresh. Not worth interrupting the game over.
  }
}

/** Boot: pick the autosaved battle back up, or open on the default duel. */
function restore(): GameState {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SAVE_KEY)
    if (raw) {
      const parsed = parseSavedGame(raw)
      if (typeof parsed !== 'string') {
        const rebuilt = replayGame(parsed)
        setup = parsed.setup
        journal = parsed.actions
        return rebuilt
      }
    }
  } catch {
    // A save that no longer replays (or corrupt storage) is discarded rather
    // than wedging the app shut.
  }
  setup = DEFAULT_SETUP
  journal = []
  return buildGame(setup)
}

// ---------------------------------------------------------------------------
// The mutation boundary
// ---------------------------------------------------------------------------

/**
 * The one place an action becomes part of the battle: fx snapshot, apply,
 * journal. Every path — the human, the AI driver, the remote peer — funnels
 * through here, so weapon fire flashes on the map no matter who pulled the
 * trigger.
 */
function applyJournaled(action: GameAction): ActionOutcome {
  const pre = fxBefore(game, action)
  const outcome = applyAction(game, action)
  journal.push(action)
  queueFx(pre, fxAfter(game, action, outcome))
  return outcome
}

/** Apply an action, journal it, autosave, notify. The only way state changes. */
export function dispatch(action: GameAction): ActionOutcome {
  // Before the human closes a segment, the AI settles anything it was still
  // waiting on — a firing slot later in the Tactical Scan order, above all —
  // so a segment never ends with its guns silent.
  if (action.type === 'advance-segment') void driveAi(true)
  const outcome = applyJournaled(action)
  autosave()
  emit()
  net?.onAction(action, journal.length)
  void driveAi()
  return outcome
}

// ---------------------------------------------------------------------------
// Damage-card choices (E8.4.1)
// ---------------------------------------------------------------------------

/**
 * Asking the defending captain which box to mark, without breaking replay.
 *
 * A battle is (setup + actions), so a decision made in the moment has to end
 * up in the journal or the replay will make its own. It cannot be asked
 * *during* resolution either: `applyAction` is synchronous, and a prompt is
 * not. So the question is put first, on a throwaway copy of the battle — the
 * engine being deterministic, the copy draws exactly the cards the real one is
 * about to — and once every question is answered the answers are journalled
 * ahead of the action that consumes them.
 *
 * A ship the local player does not command is answered by the doctrine, which
 * covers the AI, and covers the far side of an online match: the attacker's
 * browser must not stop to ask the defender's, and cannot ask on their behalf.
 */
let pending: { decision: DamageDecision; answer: (choice: DamageChoice) => void } | null = null

export function pendingDamageDecision(): DamageDecision | null {
  return pending?.decision ?? null
}

export function answerDamageDecision(choice: DamageChoice): void {
  const waiting = pending
  pending = null
  emit()
  waiting?.answer(choice)
}

/** Whether the player at this console commands the ship being asked about. */
function playerCommands(shipId: string): boolean {
  const ship = game.ships.find((s) => s.id === shipId)
  if (!ship) return false
  if ((setup.aiSides ?? []).includes(ship.side)) return false
  // A guest's actions come over the wire already resolved; only the side
  // driving the battle can be at a console to answer.
  return !aiSuppressed
}

/**
 * Dispatch an action, stopping to ask about any damage-card choice it raises.
 * Panels that can cause damage use this instead of `dispatch`.
 */
async function askAbout(action: GameAction): Promise<DamageChoice[]> {
  const script: DamageChoice[] = []
  for (let guard = 0; guard < 64; guard++) {
    const decision = probeDecision(script, () => {
      applyAction(cloneGame(game), action)
    })
    if (!decision || decision.options.length === 0) break
    const fallback = decision.options.find((o) => o.recommended) ?? decision.options[0]
    script.push(
      playerCommands(decision.shipId)
        ? await new Promise<DamageChoice>((resolve) => {
            pending = { decision, answer: resolve }
            emit()
          })
        : fallback.choice,
    )
  }
  return script
}

export async function dispatchWithChoices(action: GameAction): Promise<ActionOutcome> {
  // The same settling `dispatch` does, done before the probe rather than after
  // it: the AI's closing volleys move the deck, and a script written against
  // the state before them would be answering different cards.
  if (action.type === 'advance-segment') await driveAi(true)
  const script = await askAbout(action)
  if (script.length > 0) dispatch({ type: 'queue-damage-choices', choices: script })
  return dispatch(action)
}

/**
 * Turn on the ready gate for this battle (online matches).
 *
 * Only before the first action. A battle already under way has bare
 * `advance-segment` actions in its journal, and those would be refused by the
 * gate on the next replay — a save that no longer replays is a worse bug than
 * the one the gate fixes. In the normal flow a match is created before anyone
 * has moved, so this is the case that matters.
 */
export function enableReadyGate(): boolean {
  if (setup.readyGate) return true
  if (journal.length > 0) return false
  setup = { ...setup, readyGate: true }
  game = buildGame(setup)
  autosave()
  emit()
  return true
}

/** Start a fresh battle from a setup. Custom designs are embedded into it. */
export function newGame(next: GameSetup): void {
  setup = withEmbeddedForms(next)
  journal = []
  game = buildGame(setup)
  aiMemo = createAiMemo()
  autosave()
  emit()
  net?.onReplace(saved())
  void driveAi()
}

/** The setup of the battle in progress — what "Rematch" rolls a new seed for. */
export function currentSetup(): GameSetup {
  return setup
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * The side this console commands in an online match, or null when nobody is
 * looking over your shoulder — solo, hot-seat, or a browser-to-browser link
 * where the two players are in the same room and can police each other.
 *
 * Set by the match client on enrolment. It is what turns undo from a rewind
 * button into something with rules.
 */
let matchSide: string | null = null

export function setMatchSide(side: string | null): void {
  matchSide = side
  emit()
}

export function currentMatchSide(): string | null {
  return matchSide
}

/**
 * Why the last action cannot be taken back, or null if it can.
 *
 * Outside a match, anything can: it is one person's own game and undo is a
 * convenience. Inside one, undo would otherwise let a captain re-roll a volley
 * they did not like or un-announce a system the other player has already seen
 * and planned around — so it is narrowed to their own orders, still secret.
 */
export function undoRefusal(): string | null {
  if (journal.length === 0) return 'Nothing to take back.'
  if (!matchSide) return null
  const last = journal[journal.length - 1]
  if (actionSide(game, last) !== matchSide && actionSide(game, last) !== null) {
    return 'That was the other commander’s order — only your own can be taken back.'
  }
  if (!undoableInMatch(game, last, matchSide)) {
    return 'Once an order is carried out the table has seen it; it cannot be taken back in a match.'
  }
  return null
}

export function canUndo(): boolean {
  return undoRefusal() === null
}

/**
 * Take back the last action by replaying everything before it. The engine is
 * deterministic, so this is exact — dice included.
 */
export function undo(): void {
  if (journal.length === 0) return
  // In a match the same rule the button is greyed out by is enforced here, so
  // a stale click or a second console cannot slip past it.
  if (matchSide && undoRefusal() !== null) return
  journal = journal.slice(0, -1)
  // A queued script belongs to the action it was queued for; taking one back
  // without the other would leave answers waiting for a question nobody asks.
  while (journal.at(-1)?.type === 'queue-damage-choices') journal = journal.slice(0, -1)
  game = replayGame(saved())
  // The rewound action may have been the AI's; a fresh memo lets it owe the
  // duty again instead of remembering having done it in an unmade past.
  aiMemo = createAiMemo()
  autosave()
  emit()
  net?.onUndo(journal.length)
}

// ---------------------------------------------------------------------------
// Battle files
// ---------------------------------------------------------------------------

/** The battle as a file: setup, journal, and any custom designs it needs. */
export function exportBattle(): string {
  return JSON.stringify(saved(), null, 2) + '\n'
}

/** Load a battle file. Returns an error to show, or null on success. */
export function importBattle(text: string): string | null {
  const parsed = parseSavedGame(text)
  if (typeof parsed === 'string') return parsed
  try {
    game = replayGame(parsed)
  } catch {
    return 'That battle file does not replay — it may be from an incompatible version.'
  }
  setup = parsed.setup
  journal = parsed.actions
  aiMemo = createAiMemo()
  autosave()
  emit()
  net?.onReplace(saved())
  void driveAi()
  return null
}

// ---------------------------------------------------------------------------
// Remote play (the network's hooks into the journal)
// ---------------------------------------------------------------------------

/**
 * Remote play rides the same journal that autosave and undo use: local
 * mutations are announced through these hooks, and the peer's arrive through
 * the applyRemote* functions — which never announce, so nothing echoes.
 */
export interface NetHooks {
  onAction(action: GameAction, seq: number): void
  onUndo(lengthAfter: number): void
  /** A whole-state replacement: new game, imported battle, corrective sync. */
  onReplace(saved: SavedGame): void
}

let net: NetHooks | null = null

export function setNetHooks(hooks: NetHooks | null): void {
  net = hooks
}

export function journalLength(): number {
  return journal.length
}

/**
 * Sides nobody is commanding: not handed to the computer, and not given a
 * single order since the round began.
 *
 * A side like this does not lose — it never fights at all. Its ships sit at
 * the speed they started, never plot, never fire, and are shot to pieces by
 * whoever *is* being played, and the game says nothing about it because
 * "gave no orders" is a legal, if suicidal, way to spend a round. That is a
 * silent walkover, and it is easy to arrange by accident: tick the AI box for
 * one side in Choose Forces, miss the other, and every battle after reads as
 * a crushing victory for a ship that was never actually tested.
 *
 * Measured, on the two fan destroyers: with both sides driven the Sharlin
 * loses to the Omega 0-40; with the Omega left untended the same duel reads
 * 40-0 the other way. The hull did not change. Only who was flying it.
 */
export function unattendedSides(): string[] {
  // Nothing to say before the battle has had a chance to speak: a side that
  // has not moved during the opening Resource Allocation is not neglected yet.
  if (game.round < 2) return []
  const ai = new Set(setup.aiSides ?? [])
  const alive = new Set(game.ships.filter((s) => !s.destroyed).map((s) => s.side))
  // "Has this side ever given an order?" — not "recently". A pause between
  // two orders is a captain thinking; nothing at all, a whole round in, is
  // nobody at the console.
  const spoke = new Set<string>()
  for (const action of journal) {
    if (action.type === 'advance-segment') continue
    const side = actionSide(game, action)
    if (side) spoke.add(side)
  }
  return [...alive].filter((side) => !ai.has(side) && !spoke.has(side)).sort()
}

/**
 * A fingerprint of the battle as it stands, for the match client to stamp on
 * the actions it sends. Two clients replaying the same journal must agree on
 * it; when they do not, one of them is wrong and neither can tell which, so
 * the ledger is asked to settle it.
 */
export function currentStateHash(): string {
  return stateHash(game)
}

/**
 * Ready the sides nobody is at the console for (online matches).
 *
 * The ready gate is what stops one player advancing the segment out from under
 * the other, and it does that by refusing to move until every side has said it
 * is finished. A side whose player has closed the tab says nothing, ever — so
 * the gate that protects the match also deadlocks it, and the remaining player
 * has no way out but to abandon the game.
 *
 * The fix is not to weaken the gate but to notice the empty chair: a side with
 * nobody connected is readied on its behalf, journalled like any other action
 * so both clients and any later replay agree it happened. A player who comes
 * back can un-ready and carry on; their orders were never touched, only the
 * declaration that they had finished giving them.
 *
 * One client does this — the creator's, the same one that drives the AI — so
 * two consoles cannot both volunteer the same absent side.
 */
export function readyAbsentSides(present: readonly string[], aiSides: readonly string[]): void {
  if (!game.readyGate) return
  for (const side of sidesAwaited(game)) {
    if (game.readySides.includes(side)) continue
    // The computer's sides are driven from this very client; they are never
    // the absent ones, and readying them would race the driver.
    if (aiSides.includes(side)) continue
    if (present.includes(side)) continue
    dispatch({ type: 'signal-ready', side, ready: true })
  }
}

/** Whether the gate is currently holding, for the match client to check. */
export function gateIsWaiting(): boolean {
  return game.readyGate && !everyoneReady(game)
}

/** The current battle record, for the network to ship whole. */
export function currentSave(): SavedGame {
  return saved()
}

/**
 * Apply an action from the peer. With `force` (the ordering authority's
 * arrival rule) the action is appended regardless of the sequence number the
 * sender predicted; without it a mismatch refuses, so the caller can ask for
 * a corrective sync instead of guessing.
 */
export function applyRemoteAction(action: GameAction, seq: number, force: boolean): 'ok' | 'mismatch' {
  if (!force && seq !== journal.length + 1) return 'mismatch'
  if (action.type === 'advance-segment') void driveAi(true)
  applyJournaled(action)
  autosave()
  emit()
  void driveAi()
  return 'ok'
}

export function applyRemoteUndo(lengthAfter: number, force: boolean): 'ok' | 'mismatch' {
  if (!force && lengthAfter !== journal.length - 1) return 'mismatch'
  if (journal.length === 0) return 'ok'
  journal = journal.slice(0, -1)
  game = replayGame(saved())
  autosave()
  emit()
  return 'ok'
}

/** Adopt the peer's battle wholesale. Returns an error to show, or null. */
export function applyRemoteSave(save: SavedGame): string | null {
  try {
    game = replayGame(save)
  } catch {
    return 'The other player’s battle does not replay on this build.'
  }
  setup = save.setup
  journal = save.actions
  autosave()
  emit()
  return null
}

// ---------------------------------------------------------------------------
// The AI driver
// ---------------------------------------------------------------------------

/**
 * When a setup names AI sides, the computer's orders are folded in after every
 * action: the driver asks the captain what it owes, dispatches it through the
 * same journal as everything else, and repeats until the captain is content.
 * Idempotent duties make the loop safe; the guard makes it finite regardless.
 */
let aiMemo: AiMemo = createAiMemo()
let aiSuppressed = false

/** In remote play only the host drives the AI — the guest gets its actions over the wire. */
export function suppressAi(on: boolean): void {
  aiSuppressed = on
  if (!on) void driveAi()
}

let driving = false

/**
 * Asynchronous because of one case that matters more than any other in solo
 * play: the computer firing at *your* ship. Its volley draws cards like
 * anyone's, and the captain those cards ask questions of is you — so the
 * driver stops here too, and the modal is what it is waiting on. The prompt
 * covers the screen while it does, so nothing else can be clicked mid-batch.
 */
async function driveAi(closing = false): Promise<void> {
  if (driving || aiSuppressed) return
  const sides = (setup.aiSides ?? []).filter((side) => game.ships.some((s) => s.side === side))
  if (sides.length === 0) return
  /*
   * Who the admiral's rollouts imagine on the other side. The app has one
   * difficulty setting shared by every AI side, so the enemy is either
   * another AI at that rank or a human — and a human is cast as a captain,
   * the rank whose doctrine the rollout policy plays anyway.
   */
  const everySideIsAi = game.ships.every((ship) => sides.includes(ship.side))
  setRolloutEnemyRank(everySideIsAi ? (setup.aiDifficulty ?? 'admiral') : 'captain')
  driving = true
  try {
    let changed = false
    for (let guard = 0; guard < 300; guard++) {
      const batch = aiNextActions(
        game,
        sides,
        aiMemo,
        closing,
        setup.aiDifficulty ?? 'admiral',
        setup.aiPersonality ?? 'steady',
        setup.aiRetreats ?? true,
      )
      if (batch.length === 0) break
      for (const action of batch) {
        const script = await askAbout(action)
        if (script.length > 0) {
          const queue: GameAction = { type: 'queue-damage-choices', choices: script }
          applyJournaled(queue)
          net?.onAction(queue, journal.length)
        }
        applyJournaled(action)
        net?.onAction(action, journal.length)
        changed = true
      }
      closing = false
    }
    if (changed) {
      autosave()
      emit()
    }
  } finally {
    driving = false
  }
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

export function getGame(): GameState {
  return game
}

/** Re-renders whenever the game mutates. */
export function useGame(): GameState {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  )
  return game
}

// A restored battle may owe AI duties (a save from before the AI finished a
// segment, or one made as a suppressed remote guest). Settle up once the
// module is fully initialised.
queueMicrotask(() => void driveAi())
