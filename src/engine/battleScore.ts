import { structureRemaining } from './shipState'
import type { GameState } from './game'

/**
 * How well a side came out of it, per hull, on a scale where 1 is untouched
 * and -1 is a wreck. Coarser than victory points and much harder to game — a
 * fleet that wins on points while losing every hull has not won anything.
 *
 * This used to sum *raw* structure boxes and score a hull that left the battle
 * at zero, and both of those lied.
 *
 * Raw boxes cannot compare two different designs: whichever was printed with
 * the longer track wins a quiet game it did not earn, and whichever is bigger
 * loses one it did. Reading each hull against its own track is what makes a
 * cruiser and a dreadnought comparable at all.
 *
 * Scoring a departure at zero was worse, because it cannot tell a retreat from
 * a ship sailing over the edge of a small map — and the second thing turned
 * out to be common. A UNION III against an EXETER II is destroyed 0 times to
 * the EXETER's 11 and ends at 71% condition against 23%, and this function
 * used to call that a 26-loss season, because in 25 of those games the
 * dreadnought left the board at nearly full structure with its opponent nearly
 * dead. Every balance claim in this project runs through here, so that was not
 * a small thing to have wrong.
 *
 * A hull that leaves now keeps half of what it had: it survived, which beats
 * dying, and it stopped fighting, which is not winning. Destruction is a full
 * -1, so a kill swings two points where condition can only swing one — wrecks
 * decide a battle and the survivors' paintwork breaks the tie.
 */
export function health(game: GameState, side: string): number {
  const ships = game.ships.filter((s) => s.side === side)
  if (ships.length === 0) return 0
  const total = ships.reduce((sum, s) => {
    if (s.destroyed) return sum - 1
    const boxes = s.form.structure.filter((e) => e.kind === 'box').length || 1
    const condition = structureRemaining(s) / boxes
    return sum + (s.disengaged ? condition / 2 : condition)
  }, 0)
  return total / ships.length
}
