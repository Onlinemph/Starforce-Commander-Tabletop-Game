/**
 * A fingerprint of the battle, for catching a desync before it becomes a
 * disagreement about who won.
 *
 * Two browsers in a match stay in step by replaying the same journal through
 * the same deterministic engine. That is *supposed* to be enough, and almost
 * always is — but "almost" is doing real work in that sentence. A build skew
 * between the two clients, a rules change deployed mid-match, an engine bug
 * that reads something outside the seeded RNG: any of these produce two games
 * that agree about every action taken and disagree about the result. The
 * journal comparison already in place cannot see it, because the journals are
 * identical. That is exactly the case this catches.
 *
 * So each client stamps the actions it sends with a hash of the state that
 * action produced, and the receiver compares it against its own after applying
 * the same action. A mismatch asks the ledger for a corrective sync rather
 * than letting the two boards drift apart in silence.
 *
 * What goes in is deliberately narrow: the things a player could point at on
 * the table and disagree about. Ephemera the two sides legitimately hold
 * differently — the log, animation state, whose console is looking — stay out,
 * or the hash would cry wolf every phase.
 */

import type { GameState } from './game'

/**
 * FNV-1a over the digest string. Not cryptographic and not trying to be: this
 * is a check against accident, not against a player editing their client, who
 * has the whole journal to lie about anyway.
 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** One decimal place: enough to catch a real divergence, blind to float noise. */
function round(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}

/**
 * The parts of a ship both players can see or would immediately notice: where
 * it is, how hurt it is, and whether it is still in the battle. Hidden
 * information is included too — the two clients both hold it, and if they hold
 * different values that is precisely the desync worth finding.
 */
function shipDigest(game: GameState): string {
  return game.ships
    .map((s) =>
      [
        s.id,
        round(s.placement.position.x),
        round(s.placement.position.y),
        round(s.placement.heading),
        s.speed,
        s.stressMarkers,
        s.destroyed ? 'X' : s.disengaged ? 'D' : s.derelict ? 'R' : '-',
        s.capturedBy ?? '',
        s.marineSquads,
        s.structureDamaged.filter(Boolean).length,
        Object.values(s.blueShieldDamage).join('.'),
        Object.values(s.greenShieldDamage).join('.'),
        Object.values(s.armorDamage).join('.'),
        Object.values(s.systemDamage).join('.'),
      ].join(','),
    )
    .join(';')
}

/**
 * A stable fingerprint of the game. Same journal on the same build gives the
 * same string on both clients; anything else is the bug this exists to find.
 */
export function stateHash(game: GameState): string {
  const shape = [
    game.round,
    game.phase,
    game.segment,
    game.ops.step,
    // The deck's *order*, not merely its size. Two clients holding differently
    // shuffled decks agree about everything visible right up until the next
    // card is drawn — a desync that already exists and has not shown itself
    // yet. Hashing the pile finds it on the first action instead.
    fnv1a(game.deck.draw.map((c) => c.id).join(',')),
    game.deck.discard.length,
    [...game.readySides].sort().join('+'),
    shipDigest(game),
    game.homing.map((h) => `${h.id}@${round(h.position.x)}:${round(h.position.y)}`).join(';'),
    game.smallCraft.map((c) => `${c.id}@${round(c.position.x)}:${round(c.position.y)}`).join(';'),
    // A flight's strength is as visible as its position — a counter with four
    // fighters left on it is on the table for both players to count.
    game.flights
      .map(
        (f) =>
          `${f.id}@${round(f.position.x)}:${round(f.position.y)}` +
          `x${f.members}/${f.damage}${f.spent ? '!' : ''}${f.dockedTo ? `>${f.dockedTo}` : ''}`,
      )
      .join(';'),
  ].join('|')
  return fnv1a(shape)
}
