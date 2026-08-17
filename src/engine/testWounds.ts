import {
  hitPointDamage,
  hitPointTotal,
  markStructure,
  structureRemaining,
  structureTotal,
  type ShipState,
} from './shipState'

/**
 * Battle-damage fixtures for tests.
 *
 * The victory ledger measures damage in *hit points* — every marked internal
 * box is one, every marked structure box two (see `hitPointTotal`). A fixture
 * that wants "a ship at heavy damage" therefore has to spread real marks
 * across the whole form: the old trick of marking a fraction of the structure
 * track now amounts to scratch damage on any real hull, because the track is
 * a small slice of the ship's hit points.
 *
 * This lives outside the test files because a dozen of them stage the same
 * thing, and each had grown its own structure-only shorthand that the
 * hit-point system quietly turned into "unhurt".
 */

/**
 * Mark one more internal box. Deterministic order, chosen so the boxes whose
 * *mechanics* fixtures usually still need go last: systems and guns first,
 * then power, and the FTL and sublight drives only when nothing else is left
 * — and never their final box, so a wounded ship can still light its drive
 * and limp (a fixture that wants those dead can mark them itself).
 */
function markInternal(ship: ShipState): boolean {
  for (const group of ship.form.systems) {
    const marked = ship.systemDamage[group.kind] ?? 0
    if (marked < group.boxes) {
      ship.systemDamage[group.kind] = marked + 1
      return true
    }
  }
  for (const weapon of ship.form.weapons) {
    for (const [i, mount] of weapon.mounts.entries()) {
      const state = ship.mounts[weapon.id][i]
      if (state.damage < mount.hitBoxes) {
        state.damage += 1
        return true
      }
    }
  }
  for (const reactor of ship.form.reactors) {
    for (const [i, point] of reactor.points.entries()) {
      if (ship.reactorDamage[reactor.id][i] < point.boxes) {
        ship.reactorDamage[reactor.id][i] += 1
        return true
      }
    }
  }
  for (let i = 0; i < ship.batteryDamaged.length; i++) {
    if (!ship.batteryDamaged[i]) {
      ship.batteryDamaged[i] = true
      return true
    }
  }
  if (ship.shieldGeneratorDamage < ship.form.shields.generatorBoxes) {
    ship.shieldGeneratorDamage += 1
    return true
  }
  if (ship.ftlDriveDamage < ship.form.ftlDriveBoxes - 1) {
    ship.ftlDriveDamage += 1
    return true
  }
  const drive = ship.systemDamage['__sublight'] ?? 0
  if (drive < ship.form.sublight.driveBoxes - 1) {
    ship.systemDamage['__sublight'] = drive + 1
    return true
  }
  return false
}

/**
 * Wound a ship to a fraction of its hit points: the structure track goes
 * first, to the same fraction of its own length (never its last box — these
 * are wounds, not a kill), then internal boxes make up the rest. Best-effort
 * at the very top of the scale, where the spared boxes cap what is markable.
 */
export function woundToFraction(ship: ShipState, fraction: number): void {
  const target = hitPointTotal(ship) * fraction
  const boxes = Math.min(
    structureTotal(ship) - 1,
    Math.ceil(structureTotal(ship) * fraction),
  )
  while (structureTotal(ship) - structureRemaining(ship) < boxes) {
    if (!markStructure(ship)) break
  }
  while (hitPointDamage(ship) < target) {
    if (!markInternal(ship)) break
  }
}
