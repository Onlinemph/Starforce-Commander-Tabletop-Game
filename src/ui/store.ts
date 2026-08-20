import { useSyncExternalStore } from 'react'
import {
  buildGame,
  CURRENT_RULES_VERSION,
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
  // A resolve is the held volley finally landing: the effects layer should
  // see the volley, not the envelope, so the fire flashes on every console.
  const shown =
    action.type === 'resolve-staged-action' && game.stagedAction
      ? game.stagedAction.action
      : action
  const pre = fxBefore(game, shown)
  const outcome = applyAction(game, action)
  journal.push(action)
  queueFx(pre, fxAfter(game, shown, outcome))
  return outcome
}


/**
 * The human closing a combat segment is the human declining to fire with the
 * ships they never fired. Said out loud — as journaled passes — because the
 * engine enforces the firing sequence now, and an undecided high-scan ship
 * blocks every gun below it: the AI's closing sweep would find its whole
 * fleet out of turn behind a ship whose captain had simply moved on.
 *
 * Only the ships this console commands. The AI's are the sweep's to fire, and
 * in an online match the opponent's are not ours to decline — there the ready
 * gate does this same job on their console when they signal ready.
 */
function declineRemainingFire(): void {
  if (game.segment !== 'combat' || game.coordinatedFire) return
  for (const ship of game.ships) {
    if (ship.destroyed || ship.disengaged || ship.derelict) continue
    if (game.firedThisSegment.has(ship.id)) continue
    if ((setup.aiSides ?? []).includes(ship.side)) continue
    if (matchSide !== null && ship.side !== matchSide) continue
    const pass: GameAction = { type: 'pass-fire', shipId: ship.id }
    applyJournaled(pass)
    net?.onAction(pass, journal.length)
  }
}

/** Apply an action, journal it, autosave, notify. The only way state changes. */
export function dispatch(action: GameAction): ActionOutcome {
  /*
   * In an online match this console speaks only for its claimed side. The
   * view redaction always *discouraged* touching the other fleet, but
   * nothing refused it — and a joiner clicking around an enemy panel could
   * journal orders for ships that were never theirs, which reads to both
   * players as the game malfunctioning. The exceptions are deliberate:
   * sides the computer commands are driven from the creator's console, and
   * `signal-ready` stays open because the creator readies absent sides
   * through the gate (readyAbsentSides). Actions with no side — advancing
   * the shared sequence, damage-choice scripts — pass untouched.
   */
  if (matchSide !== null && action.type !== 'signal-ready') {
    const owner = actionSide(game, action)
    if (owner !== null && owner !== matchSide && !(setup.aiSides ?? []).includes(owner)) {
      return { message: `${owner} is commanded from another console.` }
    }
  }
  // Before the human closes a segment, the AI settles anything it was still
  // waiting on — a firing slot later in the Tactical Scan order, above all —
  // so a segment never ends with its guns silent. The human's own undecided
  // ships pass first, or the sequence holds the AI's guns shut behind them.
  if (action.type === 'advance-segment') {
    declineRemainingFire()
    void driveAi(true)
  }
  const outcome = applyJournaled(action)
  autosave()
  emit()
  net?.onAction(action, journal.length)
  void driveAi()
  // A local dispatch can be the first quiet moment after a staged action
  // arrived mid-prompt; make sure the relay is picked back up.
  void settleStagedAction()
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
 * A ship the AI commands is answered by the doctrine. A ship the *other
 * player* commands in an online match is neither: the attacker's browser
 * cannot ask on the defender's behalf, so it journals the action *staged* —
 * held, with the answers so far — and the defender's console picks the relay
 * up (settleStagedAction), asks its own player, and lands the action. The
 * playtest that forced this: a full broadside into the Karnath, and the
 * Yorktown's own damage-card choices silently played by doctrine because the
 * return volley resolved on the other console.
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
  /*
   * In an online match this console commands exactly its claimed side —
   * found the hard way: the host fired on the guest's cruiser and was then
   * handed the GUEST'S damage-card choices, while the guest stared at an
   * undamaged ship because the volley sat unjournalled behind the prompts.
   * The far side's choices are not doctrine's either: `remoteChooser` hands
   * them across the wire (stage-damage-action), so the defender answers
   * E8.4.1 at their own console. Doctrine keeps only the empty chairs.
   */
  if (matchSide !== null) return ship.side === matchSide
  // A guest's actions come over the wire already resolved; only the side
  // driving the battle can be at a console to answer.
  return !aiSuppressed
}

/**
 * The side whose console must answer a choice for this ship, when that console
 * is not ours. Null means the answer is made here: the local player's prompt,
 * or the doctrine — which still covers the AI's ships, and a side with nobody
 * connected, because an empty chair cannot be asked and must not deadlock the
 * battle.
 */
function remoteChooser(shipId: string): string | null {
  const ship = game.ships.find((s) => s.id === shipId)
  if (!ship) return null
  if (matchSide === null || ship.side === matchSide) return null
  if ((setup.aiSides ?? []).includes(ship.side)) return null
  /*
   * Deliberately NOT consulting presence here. It used to: a side missing
   * from `matchPresent` was answered by doctrine on the attacker's console,
   * straight away and silently. But presence is a realtime channel doing its
   * best, and when it blinked — or simply had not synced the joiner yet —
   * the joiner's damage choices were quietly made for them by enemy
   * doctrine, which a playtest reported as "only the host can select damage
   * options." A player's decisions must never hinge on a heartbeat.
   *
   * So in a match, a non-AI enemy ship's choice is always that side's to
   * answer: stage it. A chair that is genuinely empty is the creator cover's
   * problem (settleStagedAction), which now waits out a grace period first —
   * long enough for a flicker to pass, short enough that a closed tab does
   * not freeze the battle.
   */
  return ship.side
}

/**
 * Gather answers for every damage-card choice an action raises, prompting the
 * local player for their own ships and playing doctrine for the AI's — until
 * the probe reaches a choice that belongs to another connected console, at
 * which point the script so far comes back with `handoff` naming that side.
 */
async function askAbout(
  action: GameAction,
  base: DamageChoice[] = [],
  /**
   * A side this console is answering for by doctrine — the creator covering
   * an empty chair. Its decisions are settled here instead of handed back,
   * or the cover would re-stage to the very side it exists to stand in for.
   */
  coverSide: string | null = null,
): Promise<{ script: DamageChoice[]; handoff: string | null }> {
  const script = [...base]
  for (let guard = 0; guard < 64; guard++) {
    const decision = probeDecision(script, () => {
      applyAction(cloneGame(game), action)
    })
    if (!decision || decision.options.length === 0) break
    const handoff = remoteChooser(decision.shipId)
    if (handoff && handoff !== coverSide) return { script, handoff }
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
  return { script, handoff: null }
}

export async function dispatchWithChoices(action: GameAction): Promise<ActionOutcome> {
  // The same settling `dispatch` does, done before the probe rather than after
  // it: the AI's closing volleys move the deck, and a script written against
  // the state before them would be answering different cards.
  if (action.type === 'advance-segment') {
    declineRemainingFire()
    await driveAi(true)
  }
  const { script, handoff } = await askAbout(action)
  if (handoff) {
    // Some of the cards are the other player's to answer. The action goes
    // into the journal *held*, the battle stops, and their console takes the
    // relay from here — the volley lands when they have chosen.
    return dispatch({ type: 'stage-damage-action', action, choices: script, awaiting: handoff })
  }
  if (script.length > 0) dispatch({ type: 'queue-damage-choices', choices: script })
  return dispatch(action)
}

/**
 * Pick up a staged action whose next answer is this console's to give.
 *
 * Runs after anything that could have delivered or unblocked a stage: a
 * remote action, a corrective sync, claiming a side, a presence change. The
 * console named by `awaiting` prompts its player and either lands the action
 * (script complete), or re-stages it with more answers when the cards bounce
 * the choice back across the table. The creator's console additionally covers
 * a chooser who has disconnected mid-relay — by doctrine, the same way it
 * readies absent sides — so a dropped tab cannot freeze the battle forever.
 */
let settling = false

/**
 * How long the creator leaves an empty chair before covering its stage by
 * doctrine. Presence flickers — a phone locking, a tab backgrounded, the
 * realtime channel re-syncing — and a flicker must not cost a connected
 * player their damage choices. A genuinely closed tab still gets covered,
 * just this much later. Overridable so tests are not half a minute long.
 */
let coverGraceMs = 20_000
/** The stage the cover clock is running against, and when it may act. */
let coverStage: unknown = null
let coverAt = 0

export function setCoverGraceMs(ms: number): void {
  coverGraceMs = ms
}

async function settleStagedAction(): Promise<void> {
  const staged = game.stagedAction
  if (!staged || settling || pending) return
  if (matchSide === null) {
    /*
     * No match side and a stage standing: the player left a match mid-relay,
     * or imported a battle file that ends inside one. Nobody is coming to
     * answer, and every action is refused until somebody does — so this
     * console settles it like the solo game it now is, prompting for human
     * ships and playing doctrine for the AI's. The one console that must
     * not is a WebRTC guest (aiSuppressed): its host resolves everything.
     */
    if (aiSuppressed) return
  } else {
    const mine = staged.awaiting === matchSide
    if (!mine) {
      if (!matchCreator) return
      if (matchPresent.includes(staged.awaiting)) {
        // The chooser is at their console; their prompt is theirs to answer.
        coverStage = null
        return
      }
      // The chair looks empty. Start (or continue) the grace clock, and only
      // cover once it has run out with the chair still empty — presence
      // coming back in between resets it, so a blink costs nothing.
      if (coverStage !== staged) {
        coverStage = staged
        coverAt = Date.now() + coverGraceMs
        setTimeout(() => void settleStagedAction(), coverGraceMs)
        return
      }
      if (Date.now() < coverAt) return
    } else {
      coverStage = null
    }
  }
  const mineToAnswer = matchSide === null || staged.awaiting === matchSide
  settling = true
  try {
    // Probing the *resolve* rather than the inner action matters: the clone
    // still holds the stage, and the engine refuses everything else while it
    // does. The probe's provider intercepts every choice, so the empty script
    // here is never actually consulted.
    const probe: GameAction = { type: 'resolve-staged-action', choices: [] }
    const { script, handoff } = await askAbout(
      probe,
      staged.choices,
      mineToAnswer ? null : staged.awaiting,
    )
    // The world may have moved while the player was thinking — a corrective
    // sync, another console covering. Only act on the stage still standing.
    if (game.stagedAction !== staged) return
    if (handoff) {
      dispatch({ type: 'stage-damage-action', action: staged.action, choices: script, awaiting: handoff })
      return
    }
    dispatch({ type: 'resolve-staged-action', choices: script })
  } finally {
    settling = false
  }
  // The stage may have been replaced under us mid-prompt (a corrective sync,
  // a re-stage racing in). The answers gathered against the old one are
  // dropped — they were probed against a state that no longer exists — and
  // the standing stage gets a fresh look instead of waiting on luck.
  if (game.stagedAction && game.stagedAction !== staged) void settleStagedAction()
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

/**
 * Settle the optional rules for this battle (online matches).
 *
 * Whether H4 is in force is something the two captains agree on before the
 * first die, and at a table nobody may revise it later. `set-coordinated-fire`
 * belongs to the table rather than to a side, so the ownership gate lets
 * either console send it — which meant a player could switch the rule off in
 * the middle of a firing sequence that had gone against them. Locked, the
 * engine refuses it on both consoles.
 *
 * Like the ready gate, only before the first action: this rebuilds the battle
 * from its setup, and a battle already under way would be rewound.
 */
export function lockOptionalRules(): boolean {
  if (setup.rulesLocked) return true
  if (journal.length > 0) return false
  setup = { ...setup, rulesLocked: true }
  game = buildGame(setup)
  autosave()
  emit()
  return true
}

/** Start a fresh battle from a setup. Custom designs are embedded into it. */
export function newGame(next: GameSetup): void {
  // Fresh battles are stamped with the current rules reading; saves carry
  // their own stamp so old journals keep replaying under the reading they
  // were fought with (savedGame.ts).
  setup = withEmbeddedForms({ ...next, rulesVersion: next.rulesVersion ?? CURRENT_RULES_VERSION })
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

/**
 * How many actions the journal holds — the title screen's "is a battle
 * actually underway" question. Zero means a fresh table nobody has touched,
 * which gets "New battle" top billing; anything else earns a Continue button
 * that names the scenario and the round it left off in.
 */
export function actionCount(): number {
  return journal.length
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

/**
 * Who is at a console right now, and whether this client created the match —
 * mirrored from the match client so the damage-choice relay can tell a side
 * that must be asked from a chair that is empty. Outside a match both stay at
 * their idle values and nothing consults them.
 */
let matchPresent: string[] = []
let matchCreator = false

export function setMatchSide(side: string | null): void {
  matchSide = side
  emit()
  // Claiming a side can make a waiting stage this console's to answer.
  void settleStagedAction()
}

export function setMatchPresence(present: readonly string[], creator: boolean): void {
  matchPresent = [...present]
  matchCreator = creator
  // A presence change can orphan a stage (its chooser left) or hand one to a
  // console that just arrived; either way the relay deserves a fresh look.
  void settleStagedAction()
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
  // Mid-relay nothing moves, backwards included: rewinding the stage would
  // rip the question out from under the console currently answering it.
  if (game.stagedAction) {
    return 'Damage is being allocated — nothing can be taken back until it lands.'
  }
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
  // Rewinding a resolve puts the battle back into its hold (solo only — in a
  // match the hold refuses undo); pick the relay straight back up.
  void settleStagedAction()
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
  // A battle file can end mid-relay; the hold replays with it and the
  // importer's console is the only one left to answer.
  void settleStagedAction()
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
    // A pass is the absence of an order, and not only philosophically: the
    // store journals passes *for* an idle side when a segment closes, so the
    // firing sequence cannot be held shut by an empty chair. Counting those
    // as the side speaking would hide exactly the walkover this exists to
    // catch.
    if (action.type === 'pass-fire') continue
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
export async function readyAbsentSides(
  present: readonly string[],
  aiSides: readonly string[],
): Promise<void> {
  if (!game.readyGate) return
  for (const side of sidesAwaited(game)) {
    if (game.readySides.includes(side)) continue
    // The computer's sides are driven from this very client; they are never
    // the absent ones, and readying them would race the driver.
    if (aiSides.includes(side)) continue
    if (present.includes(side)) continue
    // Through the probe, never around it: the last ready closes the segment,
    // and a segment exit can draw damage cards — homing impacts, asteroid
    // and nebula transits — whose choices belong at somebody's console. A
    // plain dispatch here answered them all by doctrine, the local player's
    // own ships included.
    await dispatchWithChoices({ type: 'signal-ready', side, ready: true })
  }
}

/** Whether the gate is currently holding, for the match client to check. */
export function gateIsWaiting(): boolean {
  return game.readyGate && !everyoneReady(game)
}

/**
 * The sides the battle is waiting on right now — the ready gate's unanswered
 * chairs, plus the side a staged volley is waiting on for its damage-card
 * answers. What the match browser shows as "waiting on…".
 */
export function waitingSides(): string[] {
  if (game.stagedAction) return [game.stagedAction.awaiting]
  if (!game.readyGate) return []
  return sidesAwaited(game).filter((side) => !game.readySides.includes(side))
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
  // The arriving action may be a stage whose next answer is this console's.
  void settleStagedAction()
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
  // A synced or freshly joined battle can arrive mid-relay — a refresh while
  // the cards were waiting on this very console is exactly that.
  void settleStagedAction()
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
  // While a staged action waits on another console the whole battle holds,
  // the computer included; the resolve will wake the driver again.
  if (game.stagedAction) return
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
      let held = false
      for (const action of batch) {
        const { script, handoff } = await askAbout(action)
        if (handoff) {
          // The computer's volley raises a choice belonging to a player on
          // another console. Same relay as a human attacker: stage it, stop
          // driving, and let the resolve wake the driver back up.
          const stage: GameAction = { type: 'stage-damage-action', action, choices: script, awaiting: handoff }
          applyJournaled(stage)
          net?.onAction(stage, journal.length)
          changed = true
          held = true
          break
        }
        if (script.length > 0) {
          const queue: GameAction = { type: 'queue-damage-choices', choices: script }
          applyJournaled(queue)
          net?.onAction(queue, journal.length)
        }
        applyJournaled(action)
        net?.onAction(action, journal.length)
        changed = true
      }
      if (held) break
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
// segment, or one made as a suppressed remote guest) — or a staged action
// whose answers are this console's to give (a refresh mid-relay). Settle up
// once the module is fully initialised.
queueMicrotask(() => {
  void driveAi()
  void settleStagedAction()
})
