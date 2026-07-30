import { rollForSpecial, type Rng } from './dice'
import {
  armingCapacityThisRound,
  batteryPower,
  blueShieldRemaining,
  damageControlRating,
  findLine,
  genSysSetting,
  lineValue,
  mountIsDamaged,
  powerSpent,
  reactorPower,
  shieldGeneratorRating,
  SHIELD_SIDES,
  undamagedSystemBoxes,
  type ShipState,
} from './shipState'
import type { ShieldSide } from './types'

/**
 * Engineering Phase: Resource Allocation (B2) and Damage Control (B3).
 */

// ---------------------------------------------------------------------------
// Resource Allocation Segment (B2)
// ---------------------------------------------------------------------------

export interface AllocationError {
  lineId?: string
  message: string
}

/** Total power available: undamaged reactors plus charged batteries (B2.2.1). */
export function totalPowerAvailable(ship: ShipState): number {
  return reactorPower(ship) + batteryPower(ship)
}

export function powerRemaining(ship: ShipState): number {
  return totalPowerAvailable(ship) - powerSpent(ship)
}

/**
 * Set the number of filled circles on a FUNCTIONS line. Returns an error rather
 * than mutating when the change is illegal.
 */
export function setAllocation(ship: ShipState, lineId: string, circles: number): AllocationError | null {
  const line = ship.form.functions.find((l) => l.id === lineId)
  if (!line) return { lineId, message: 'No such function line.' }
  if (circles < 0 || circles > line.steps.length) {
    return { lineId, message: `Line accepts 0–${line.steps.length} power circles.` }
  }

  // A damaged system may not be powered in the hope of being repaired (B3.3.1).
  const blocked = lineIsUnpowerable(ship, lineId)
  if (blocked && circles > 0) return { lineId, message: blocked }

  const previous = ship.allocation[lineId] ?? 0
  ship.allocation[lineId] = circles

  if (powerRemaining(ship) < 0) {
    ship.allocation[lineId] = previous
    return { lineId, message: 'Not enough power available.' }
  }

  // Power may not be pulled back off a weapon line once its arming points have
  // been spent on mounts — arming circles are already filled in (E4.2.7).
  if (line.kind === 'weapon' && line.weaponSystemId) {
    const spent = (ship.mounts[line.weaponSystemId] ?? []).reduce((sum, m) => sum + m.armedThisRound, 0)
    if (lineValue(ship, lineId) < spent) {
      ship.allocation[lineId] = previous
      return { lineId, message: `${spent} arming point(s) already spent on mounts.` }
    }
  }

  return null
}

/** Reasons a line cannot take power right now. */
function lineIsUnpowerable(ship: ShipState, lineId: string): string | null {
  const line = ship.form.functions.find((l) => l.id === lineId)!
  switch (line.kind) {
    case 'ftl-drive':
      // The FTL drive must be online to be powered (J9.1.3).
      return ship.ftlDriveDamage >= ship.form.ftlDriveBoxes ? 'FTL drive is damaged.' : null
    case 'shield-repair':
      if (shieldGeneratorRating(ship) === 0) return 'All shield generators are damaged (E8.2.1).'
      if (line.shieldSide && blueShieldRemaining(ship, line.shieldSide) === ship.form.shields.blue[line.shieldSide]) {
        return 'Shield is undamaged — nothing to repair.'
      }
      return null
    case 'shield-reinforce':
      return shieldGeneratorRating(ship) === 0 ? 'All shield generators are damaged (E8.2.1).' : null
    case 'battery-recharge': {
      const empty = ship.batteryCharged.some((c, i) => !c && !ship.batteryDamaged[i])
      return empty ? null : 'No empty, undamaged batteries.'
    }
    case 'sensor':
      return undamagedSystemBoxes(ship, 'SENS') === 0 ? 'Sensors are destroyed.' : null
    case 'weapon': {
      const weapon = ship.form.weapons.find((w) => w.id === line.weaponSystemId)
      if (!weapon) return null
      const states = ship.mounts[weapon.id] ?? []
      const anyUsable = states.some((state, i) => !mountIsDamaged(weapon, i, state))
      return anyUsable ? null : 'All mounts on this weapon system are damaged.'
    }
    default:
      return null
  }
}

/**
 * Validate a completed allocation. Derelicts do not allocate at all (E11.2.4).
 */
export function validateAllocation(ship: ShipState): AllocationError[] {
  const errors: AllocationError[] = []
  if (powerRemaining(ship) < 0) errors.push({ message: 'Allocation exceeds available power.' })

  for (const line of ship.form.functions) {
    const filled = ship.allocation[line.id] ?? 0
    if (filled === 0) continue
    const blocked = lineIsUnpowerable(ship, line.id)
    if (blocked) errors.push({ lineId: line.id, message: blocked })
  }

  // GEN SYS must reach NRM before MAX (B2.2.10).
  const genSys = findLine(ship.form, 'gen-sys')
  if (genSys) {
    const filled = ship.allocation[genSys.id] ?? 0
    if (filled > 0 && genSys.freeValue === 0 && filled < 1) {
      errors.push({ lineId: genSys.id, message: 'General Systems must be powered to NRM before MAX.' })
    }
  }
  return errors
}

export interface CommitResult {
  /** Arming points generated per weapon system (E4.1). */
  armingPoints: Record<string, number>
  /** Shields repaired this segment (G1.3.3). */
  shieldsRepaired: Partial<Record<ShieldSide, number>>
  /** Shields reinforced this segment (G1.3.2). */
  shieldsReinforced: Partial<Record<ShieldSide, number>>
  accelerationPoints: number
  sifCapacity: number
  sensorPoints: number
  emergencyTurnAvailable: boolean
  ftlEngaged: boolean
  log: string[]
}

/**
 * Apply the effects of the completed allocation: spend battery power, generate
 * arming points, repair and reinforce shields, set GEN SYS level.
 */
export function commitAllocation(ship: ShipState): CommitResult {
  const log: string[] = []
  const result: CommitResult = {
    armingPoints: {},
    shieldsRepaired: {},
    shieldsReinforced: {},
    accelerationPoints: 0,
    sifCapacity: 0,
    sensorPoints: 0,
    emergencyTurnAvailable: false,
    ftlEngaged: false,
    log,
  }

  // Spend batteries for any power drawn beyond reactor output (B2.4.1).
  const spent = powerSpent(ship)
  const fromBatteries = Math.max(0, spent - reactorPower(ship))
  for (let i = 0, drained = 0; i < ship.batteryCharged.length && drained < fromBatteries; i++) {
    if (ship.batteryCharged[i] && !ship.batteryDamaged[i]) {
      ship.batteryCharged[i] = false
      drained += 1
    }
  }
  if (fromBatteries > 0) log.push(`${ship.name}: ${fromBatteries} battery power expended.`)

  for (const line of ship.form.functions) {
    const filled = ship.allocation[line.id] ?? 0
    const value = lineValue(ship, line.id)

    switch (line.kind) {
      case 'accel':
        result.accelerationPoints = value
        break

      case 'sif':
        result.sifCapacity = value
        break

      case 'emergency-turn':
        result.emergencyTurnAvailable = filled > 0 || line.freeValue > 0
        break

      case 'sensor':
        result.sensorPoints = value
        break

      case 'gen-sys':
        // Free power normally covers NRM; purchased circles reach MAX (J1.1).
        ship.genSysLevel = genSysSetting(ship)
        break

      case 'weapon': {
        if (!line.weaponSystemId) break
        result.armingPoints[line.weaponSystemId] = value
        break
      }

      case 'shield-reinforce': {
        if (!line.shieldSide || filled === 0) break
        // Each power point activates green boxes equal to the generator rating
        // (G1.3.2), capped by the boxes printed on the form.
        const capacity = ship.form.shields.green[line.shieldSide]
        const activated = Math.min(capacity, shieldGeneratorRating(ship) * filled)
        ship.greenShieldActive[line.shieldSide] = activated
        result.shieldsReinforced[line.shieldSide] = activated
        break
      }

      case 'shield-repair': {
        if (!line.shieldSide || filled === 0) break
        // Repairs blue boxes equal to the generator rating (G1.3.3).
        const repaired = Math.min(ship.blueShieldDamage[line.shieldSide], shieldGeneratorRating(ship) * filled)
        ship.blueShieldDamage[line.shieldSide] -= repaired
        result.shieldsRepaired[line.shieldSide] = repaired
        break
      }

      case 'battery-recharge': {
        // One power point recharges one battery (B2.4.3); available next round.
        let toCharge = filled
        for (let i = 0; i < ship.batteryCharged.length && toCharge > 0; i++) {
          if (!ship.batteryCharged[i] && !ship.batteryDamaged[i]) {
            ship.batteryCharged[i] = true
            toCharge -= 1
          }
        }
        break
      }

      case 'ftl-drive':
        // Fully powered FTL disengages during the Final Phase (B2.2.12, J9.1.2).
        result.ftlEngaged = filled >= line.steps.length && line.steps.length > 0
        break

      case 'special':
        break
    }
  }

  for (const side of SHIELD_SIDES) {
    const repaired = result.shieldsRepaired[side]
    if (repaired) log.push(`${ship.name}: ${side} shield repaired by ${repaired}.`)
    const reinforced = result.shieldsReinforced[side]
    if (reinforced) log.push(`${ship.name}: ${side} shield reinforced by ${reinforced}.`)
  }

  return result
}

// ---------------------------------------------------------------------------
// Arming point distribution (E4.2)
// ---------------------------------------------------------------------------

/**
 * Arming points still available to a weapon system this round.
 *
 * Points are generated by the weapon's FUNCTIONS line in Step 1A and spent on
 * individual mounts in Step 1B — both inside the same Resource Allocation
 * Segment (E4.2.1). Points may not be transferred between weapon systems
 * (E4.2.6), and any left unspent when the segment ends are simply lost
 * (E4.2.10), which falls out of this being derived from the round's arming.
 */
export function armingPointsAvailable(ship: ShipState, weaponId: string): number {
  const line = ship.form.functions.find((l) => l.kind === 'weapon' && l.weaponSystemId === weaponId)
  if (!line) return 0
  const generated = lineValue(ship, line.id)
  const spent = (ship.mounts[weaponId] ?? []).reduce((sum, state) => sum + state.armedThisRound, 0)
  return Math.max(0, generated - spent)
}

/** Spend one arming point on a mount (E4.2.2). */
export function armMount(ship: ShipState, weaponId: string, mountIndex: number): AllocationError | null {
  const weapon = ship.form.weapons.find((w) => w.id === weaponId)
  if (!weapon) return { message: 'Unknown weapon system.' }
  const state = ship.mounts[weaponId]?.[mountIndex]
  if (!state) return { message: 'Unknown weapon mount.' }
  if (mountIsDamaged(weapon, mountIndex, state)) return { message: 'Mount is damaged.' }

  if (armingPointsAvailable(ship, weaponId) <= 0) {
    return { message: 'No arming points remaining for this weapon system.' }
  }
  if (state.armed >= weapon.mounts[mountIndex].armingCircles) {
    return { message: 'Mount is already fully armed.' }
  }
  if (armingCapacityThisRound(weapon, mountIndex, state) <= 0) {
    return { message: 'Slow-arming weapon: no further circles may be filled this round (E4.2.8).' }
  }

  state.armed += 1
  state.armedThisRound += 1
  return null
}

// ---------------------------------------------------------------------------
// Damage Control Segment (B3)
// ---------------------------------------------------------------------------

export type RepairCategory = 'systems' | 'shields' | 'weapons' | 'engineering' | 'structure' | 'boarders'

export interface RepairTarget {
  category: RepairCategory
  /** Stable identifier used to apply the repair. */
  key: string
  label: string
}

/** Everything damage control could currently fix (B3.2 Step 2). */
export function repairTargets(ship: ShipState): RepairTarget[] {
  const targets: RepairTarget[] = []

  for (const group of ship.form.systems) {
    const damaged = group.boxes - undamagedSystemBoxes(ship, group.kind)
    if (damaged > 0) {
      targets.push({ category: 'systems', key: `system:${group.kind}`, label: `${group.label} (${damaged} damaged)` })
    }
  }

  if (ship.shieldGeneratorDamage > 0) {
    targets.push({ category: 'shields', key: 'shield-gen', label: `Shield Generator (${ship.shieldGeneratorDamage} damaged)` })
  }

  for (const weapon of ship.form.weapons) {
    const states = ship.mounts[weapon.id] ?? []
    states.forEach((state, index) => {
      if (state.damage > 0) {
        targets.push({
          category: 'weapons',
          key: `weapon:${weapon.id}:${index}`,
          label: `${weapon.name} mount ${index + 1}`,
        })
      }
    })
  }

  for (const group of ship.form.reactors) {
    const damage = ship.reactorDamage[group.id] ?? []
    // Any damaged reactor box may be repaired, in any order (B3.3.2).
    damage.forEach((hits, index) => {
      if (hits > 0) {
        targets.push({
          category: 'engineering',
          key: `reactor:${group.id}:${index}`,
          label: `${group.label} power point ${index + 1}`,
        })
      }
    })
  }
  if ((ship.systemDamage['__sublight'] ?? 0) > 0) {
    targets.push({ category: 'engineering', key: 'sublight-drive', label: 'Sublight Drive' })
  }
  if (ship.ftlDriveDamage > 0) {
    targets.push({ category: 'engineering', key: 'ftl-drive', label: 'FTL Drive' })
  }
  ship.batteryDamaged.forEach((damaged, index) => {
    if (damaged) targets.push({ category: 'engineering', key: `battery:${index}`, label: `Battery ${index + 1}` })
  })

  // Only black structure boxes are repairable in space (B3.3.3, B3.3.4).
  const boxes = ship.form.structure.filter((e) => e.kind === 'box') as Array<{ kind: 'box'; color: 'black' | 'red' }>
  const repairableStructure = boxes.some((b, i) => b.color === 'black' && ship.structureDamaged[i])
  if (ship.excessStructureDamage > 0) {
    // Excess damage must be repaired before black boxes (E11.2.7).
    targets.push({ category: 'structure', key: 'excess-structure', label: 'Excess structural damage' })
  } else if (repairableStructure) {
    targets.push({ category: 'structure', key: 'structure', label: 'Black structure box' })
  }

  return targets
}

export function applyRepair(ship: ShipState, key: string): boolean {
  if (key === 'shield-gen') {
    if (ship.shieldGeneratorDamage === 0) return false
    ship.shieldGeneratorDamage -= 1
    return true
  }
  if (key === 'sublight-drive') {
    const hits = ship.systemDamage['__sublight'] ?? 0
    if (hits === 0) return false
    ship.systemDamage['__sublight'] = hits - 1
    return true
  }
  if (key === 'ftl-drive') {
    if (ship.ftlDriveDamage === 0) return false
    ship.ftlDriveDamage -= 1
    return true
  }
  if (key === 'excess-structure') {
    if (ship.excessStructureDamage === 0) return false
    ship.excessStructureDamage -= 1
    return true
  }
  if (key === 'structure') {
    const boxes = ship.form.structure.filter((e) => e.kind === 'box') as Array<{ kind: 'box'; color: 'black' | 'red' }>
    const index = boxes.findIndex((b, i) => b.color === 'black' && ship.structureDamaged[i])
    if (index === -1) return false
    ship.structureDamaged[index] = false
    // The DC rating reduction is permanent (B3.3.3) — structureHitsTaken stands.
    return true
  }

  const [kind, ...rest] = key.split(':')
  if (kind === 'system') {
    const groupKind = rest[0]
    const current = ship.systemDamage[groupKind] ?? 0
    if (current === 0) return false
    ship.systemDamage[groupKind] = current - 1
    return true
  }
  if (kind === 'weapon') {
    const [weaponId, indexStr] = rest
    const state = ship.mounts[weaponId]?.[Number(indexStr)]
    if (!state || state.damage === 0) return false
    state.damage -= 1
    return true
  }
  if (kind === 'reactor') {
    const [groupId, indexStr] = rest
    const damage = ship.reactorDamage[groupId]
    const index = Number(indexStr)
    if (!damage || (damage[index] ?? 0) === 0) return false
    damage[index] -= 1
    return true
  }
  if (kind === 'battery') {
    const index = Number(rest[0])
    if (!ship.batteryDamaged[index]) return false
    ship.batteryDamaged[index] = false
    // A repaired battery holds no power until recharged (B2.4.4).
    ship.batteryCharged[index] = false
    return true
  }
  return false
}

export interface RepairAssignment {
  category: RepairCategory
  dice: number
  /** Which damaged box to fix on success. Ignored for `boarders`. */
  targetKey?: string
}

export interface RepairOutcome {
  category: RepairCategory
  dice: number
  success: boolean
  repaired?: string
  /** Enemy marine squads eliminated (B3.4.2). */
  boardersKilled?: number
}

/**
 * Resolve the Damage Control Segment. Each category may repair at most one box
 * per round regardless of how many dice are assigned (B3.2 Step 3).
 */
export function resolveDamageControl(
  ship: ShipState,
  assignments: RepairAssignment[],
  rng: Rng,
  log: (message: string) => void,
): RepairOutcome[] {
  const budget = damageControlRating(ship)
  const outcomes: RepairOutcome[] = []
  let used = 0

  for (const assignment of assignments) {
    const dice = Math.min(assignment.dice, Math.max(0, budget - used))
    used += dice
    if (dice === 0) continue

    // Damage control rolls use red dice; an `S` is a success (B3.1.1).
    const { success } = rollForSpecial(dice, rng)
    const outcome: RepairOutcome = { category: assignment.category, dice, success }

    if (success && assignment.category === 'boarders') {
      // Only one enemy squad may be eliminated per round (B3.4.2).
      const total = Object.values(ship.boarders).reduce((a, b) => a + b, 0)
      if (total > 0) {
        const owner = Object.keys(ship.boarders).find((k) => ship.boarders[k] > 0)!
        ship.boarders[owner] -= 1
        outcome.boardersKilled = 1
        log(`${ship.name}: damage control eliminates a boarding squad.`)
      }
    } else if (success && assignment.targetKey) {
      if (applyRepair(ship, assignment.targetKey)) {
        outcome.repaired = assignment.targetKey
        log(`${ship.name}: repaired ${assignment.targetKey} (${dice} dice).`)
      }
    } else if (!success) {
      log(`${ship.name}: ${assignment.category} repair failed (${dice} dice).`)
    }

    outcomes.push(outcome)
  }

  return outcomes
}
