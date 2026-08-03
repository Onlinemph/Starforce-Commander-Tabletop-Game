/**
 * Keeping ship names readable when hulls fly close together.
 *
 * Every counter prints its name and speed just under itself. That reads well
 * for a duel and turns to mush the moment a squadron closes up — which is
 * exactly when you want to know which hull is which. So before drawing, the
 * labels are laid out: each one starts under its own ship, and any that would
 * land on top of an already-placed label steps down a line until it is clear.
 *
 * This is a drawing concern and nothing more. It reads positions, returns
 * offsets, and touches no game state — which is why it lives here as a plain
 * function with its own tests rather than inside the map component.
 */

/** Vertical pitch of one stacked label line, in map pixels. */
export const LABEL_LINE = 12

/** How far a label may be pushed before we let it overlap and be done. */
const MAX_STEPS = 6

/**
 * Roughly how wide a label is, in map pixels. The names are drawn at 10px in
 * the LCARS face with a little letter-spacing; measuring the real thing would
 * mean laying out text before we can decide where to put it, and an estimate
 * that runs a shade wide only makes the stacking more cautious.
 */
export function labelHalfWidth(text: string): number {
  return (text.length * 6.2) / 2
}

export interface LabelBox {
  id: string
  /** Centre of the label, in map pixels. */
  x: number
  /** Where the label would sit with no neighbours, in map pixels. */
  y: number
  halfWidth: number
}

/** A counter to keep names off, in map pixels. */
export interface LabelObstacle {
  x1: number
  x2: number
  y1: number
  y2: number
}

/**
 * How far each label has to drop to clear the ones already placed and the
 * hulls themselves. Returns a shift per id — zero for a label with room, a
 * multiple of {@link LABEL_LINE} for one that had to give way.
 *
 * Top-down and left-to-right, so the result is stable: the same fleet in the
 * same places always stacks the same way, and a ship that has not moved does
 * not see its name jump because a neighbour arrived.
 *
 * A label that cannot find room within {@link MAX_STEPS} lines gives up and
 * prints where it landed. Better a name that overlaps than one chased off the
 * board looking for space that is not there.
 */
export function stackLabels(
  boxes: LabelBox[],
  obstacles: LabelObstacle[] = [],
): Record<string, number> {
  const placed: { x1: number; x2: number; y: number }[] = []
  const shifts: Record<string, number> = {}
  const order = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))

  for (const box of order) {
    const x1 = box.x - box.halfWidth
    const x2 = box.x + box.halfWidth
    let y = box.y
    for (let step = 0; step < MAX_STEPS; step++) {
      const overText = placed.some((p) => Math.abs(p.y - y) < LABEL_LINE && p.x1 < x2 && x1 < p.x2)
      const overHull = obstacles.some((o) => y > o.y1 && y < o.y2 && o.x1 < x2 && x1 < o.x2)
      if (!overText && !overHull) break
      y += LABEL_LINE
    }
    placed.push({ x1, x2, y })
    shifts[box.id] = y - box.y
  }
  return shifts
}
