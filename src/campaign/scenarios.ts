/**
 * The launch scenarios (design doc 10.2) — three campaigns that teach the
 * game in ascending order: contacts and postures, then the raid, then the
 * long war with reinforcements.
 *
 * Convoys sail small canon hulls as freighter stand-ins until Doyle's
 * civilian designs land in the ship builder (6.3 wants purpose-built
 * freighters committed to customShips.json; the campaign mechanics do not
 * care what the hull is). Forces are all canon, so files replay anywhere.
 */

import { blankScenario } from './file'
import { DETECTION_CURVE, type CampaignScenario } from './types'

/** 10.2.1 — symmetric, small, fifteen rounds: contacts, formations, postures. */
export function borderWatch(): CampaignScenario {
  return blankScenario({
    name: 'The Border Watch',
    rounds: 15,
    mapSeed: 101,
    mapWidth: 30,
    mapHeight: 22,
    forces: {
      A: [
        { id: 'a-cruiser', kind: 'ship', name: 'USS Vigilant', ships: ['union-yorktown-i-class-heavy-cruiser'], hex: { q: 5, r: 8 } },
        { id: 'a-escort', kind: 'ship', name: 'USS Pelham', ships: ['union-nelson-ii-class-light-frigate'], hex: { q: 5, r: 12 } },
        { id: 'a-scout', kind: 'ship', name: 'USS Farsight', ships: ['union-hermes-i-class-scout'], hex: { q: 7, r: 4 } },
      ],
      B: [
        { id: 'b-cruiser', kind: 'ship', name: 'VNS Talon', ships: ['vallari-v-7c-raider-class-battlecruiser'], hex: { q: 24, r: 2 } },
        { id: 'b-escort', kind: 'ship', name: 'VNS Snare', ships: ['vallari-v-6l-savage-class-light-cruiser'], hex: { q: 24, r: 6 } },
        { id: 'b-scout', kind: 'ship', name: 'VNS Whisper', ships: ['vallari-v-2n-flanker-class-scout'], hex: { q: 22, r: 10 } },
      ],
    },
    infrastructure: [
      { id: 'a-outpost', side: 'A', kind: 'outpost', hex: { q: 3, r: 10 } },
      { id: 'b-outpost', side: 'B', kind: 'outpost', hex: { q: 26, r: 2 } },
    ],
    // The objectives scaffold (objectives.ts), seeded from the designer's
    // roadmap: scout the enemy's outpost, bleed two of their hulls.
    objectives: [
      { id: 'a-scout-outpost', side: 'A', kind: 'scout-hex', hex: { q: 26, r: 2 }, vp: 5, text: 'Scout the Vallari outpost' },
      { id: 'a-kill-two', side: 'A', kind: 'destroy-ships', count: 2, vp: 10, text: 'Destroy two Vallari hulls' },
      { id: 'b-scout-outpost', side: 'B', kind: 'scout-hex', hex: { q: 3, r: 10 }, vp: 5, text: 'Scout the Union outpost' },
      { id: 'b-kill-two', side: 'B', kind: 'destroy-ships', count: 2, vp: 10, text: 'Destroy two Union hulls' },
    ],
    vpThreshold: 60,
  })
}

/**
 * 10.2.2 — asymmetric, twenty rounds: cloaked Aurelian raiders against a
 * Union defense with fixed infrastructure and shipping that must move. The
 * published BATREP one level up.
 */
export function raidOnDeltaVideus(): CampaignScenario {
  return blankScenario({
    name: 'Raid on Delta Videus',
    rounds: 20,
    mapSeed: 202,
    mapWidth: 34,
    mapHeight: 26,
    forces: {
      A: [
        { id: 'a-heavy', kind: 'ship', name: 'USS Bulwark', ships: ['union-yorktown-iii-class-heavy-cruiser'], hex: { q: 8, r: 10 } },
        { id: 'a-picket-1', kind: 'ship', name: 'USS Kestrel', ships: ['union-xerxes-i-class-destroyer'], hex: { q: 11, r: 6 }, order: { speed: 'hold', sensorPower: 2 } },
        { id: 'a-picket-2', kind: 'ship', name: 'USS Osprey', ships: ['union-xerxes-i-class-destroyer'], hex: { q: 11, r: 14 }, order: { speed: 'hold', sensorPower: 2 } },
        {
          id: 'a-convoy',
          kind: 'convoy',
          name: 'Convoy DV-7',
          ships: ['union-nelson-i-class-light-frigate', 'union-nelson-i-class-light-frigate', 'union-soryu-i-class-frigate'],
          hex: { q: 4, r: 18 },
          order: { waypoints: [{ q: 14, r: 10 }, { q: 26, r: 4 }] },
          deliverHex: { q: 26, r: 4 },
          deliveryVp: 12,
        },
      ],
      B: [
        { id: 'b-raider-1', kind: 'ship', name: 'AMV Nightfall', ships: ['aurelian-corvus-i-class-destroyer'], hex: { q: 30, r: 2 }, order: { cloaked: true } },
        { id: 'b-raider-2', kind: 'ship', name: 'AMV Duskwing', ships: ['aurelian-corvus-i-class-destroyer'], hex: { q: 30, r: 8 }, order: { cloaked: true } },
        { id: 'b-heavy', kind: 'ship', name: 'AMV Stormcrow', ships: ['aurelian-tonitrus-i-class-heavy-cruiser'], hex: { q: 32, r: 4 } },
      ],
    },
    infrastructure: [
      { id: 'a-base', side: 'A', kind: 'fleet-base', hex: { q: 6, r: 10 } },
      { id: 'a-colony', side: 'A', kind: 'colony', hex: { q: 26, r: 4 } },
      { id: 'a-beacon-1', side: 'A', kind: 'jump-beacon', hex: { q: 10, r: 14 } },
      { id: 'a-beacon-2', side: 'A', kind: 'jump-beacon', hex: { q: 18, r: 8 } },
      { id: 'a-ears', side: 'A', kind: 'listening-post', hex: { q: 20, r: 2 } },
    ],
    objectives: [
      { id: 'a-hold-colony', side: 'A', kind: 'hold-hex', hex: { q: 26, r: 4 }, count: 3, vp: 8, text: 'Keep a warship over the Delta Videus colony for three rounds' },
      { id: 'a-kill-raider', side: 'A', kind: 'destroy-ships', count: 1, vp: 10, text: 'Destroy an Aurelian raider' },
      { id: 'b-raze-colony', side: 'B', kind: 'destroy-station', stationId: 'a-colony', vp: 15, text: 'Destroy the Delta Videus colony' },
      { id: 'b-kill-two', side: 'B', kind: 'destroy-ships', count: 2, vp: 10, text: 'Destroy two Union hulls' },
    ],
    vpThreshold: 50,
  })
}

/** 10.2.3 — twenty-five rounds, both raid and both defend, mid-game reinforcements. */
export function theLongPatrol(): CampaignScenario {
  return blankScenario({
    name: 'The Long Patrol',
    rounds: 25,
    mapSeed: 303,
    mapWidth: 40,
    mapHeight: 30,
    forces: {
      A: [
        { id: 'a-flag', kind: 'group', name: 'Task Group Anvil', ships: ['union-kursk-i-class-battlecruiser', 'union-coventry-i-class-light-cruiser'], hex: { q: 6, r: 12 } },
        { id: 'a-scout', kind: 'ship', name: 'USS Longeye', ships: ['union-hermes-ii-class-scout'], hex: { q: 9, r: 6 } },
        {
          id: 'a-convoy',
          kind: 'convoy',
          name: 'Convoy LP-1',
          ships: ['union-nelson-i-class-light-frigate', 'union-nelson-i-class-light-frigate'],
          hex: { q: 4, r: 20 },
          order: { waypoints: [{ q: 20, r: 15 }, { q: 34, r: 6 }] },
          deliverHex: { q: 34, r: 6 },
          deliveryVp: 10,
        },
        { id: 'a-relief', kind: 'ship', name: 'USS Latecomer', ships: ['union-yorktown-i-class-heavy-cruiser'], hex: { q: 2, r: 14 }, arrivesRound: 10 },
      ],
      B: [
        { id: 'b-flag', kind: 'group', name: 'Strike Group Fang', ships: ['vallari-v-7c-raider-class-battlecruiser', 'vallari-v-6l-savage-class-light-cruiser'], hex: { q: 34, r: 10 } },
        { id: 'b-scout', kind: 'ship', name: 'VNS Glimmer', ships: ['vallari-v-12a-hunter-class-scout'], hex: { q: 31, r: 16 } },
        {
          id: 'b-convoy',
          kind: 'convoy',
          name: 'Convoy VK-9',
          ships: ['vallari-v-2n-flanker-class-scout', 'vallari-v-2n-flanker-class-scout'],
          hex: { q: 36, r: 4 },
          order: { waypoints: [{ q: 22, r: 12 }, { q: 8, r: 22 }] },
          deliverHex: { q: 8, r: 22 },
          deliveryVp: 10,
        },
        { id: 'b-relief', kind: 'ship', name: 'VNS Reprisal', ships: ['vallari-v-8a-ravager-class-destroyer'], hex: { q: 38, r: 8 }, arrivesRound: 12 },
      ],
    },
    infrastructure: [
      { id: 'a-base', side: 'A', kind: 'fleet-base', hex: { q: 4, r: 14 } },
      { id: 'a-beacon', side: 'A', kind: 'jump-beacon', hex: { q: 16, r: 17 } },
      { id: 'b-base', side: 'B', kind: 'fleet-base', hex: { q: 36, r: 8 } },
      { id: 'b-beacon', side: 'B', kind: 'jump-beacon', hex: { q: 26, r: 10 } },
    ],
    objectives: [
      { id: 'a-scout-base', side: 'A', kind: 'scout-hex', hex: { q: 36, r: 8 }, vp: 8, text: 'Scout the Vallari fleet base' },
      { id: 'a-raze-base', side: 'A', kind: 'destroy-station', stationId: 'b-base', vp: 20, text: 'Destroy the Vallari fleet base' },
      { id: 'b-scout-base', side: 'B', kind: 'scout-hex', hex: { q: 4, r: 14 }, vp: 8, text: 'Scout the Union fleet base' },
      { id: 'b-raze-base', side: 'B', kind: 'destroy-station', stationId: 'a-base', vp: 20, text: 'Destroy the Union fleet base' },
    ],
  })
}

/** All three, for a picker. */
export const LAUNCH_SCENARIOS: Array<{ id: string; build: () => CampaignScenario }> = [
  { id: 'border-watch', build: borderWatch },
  { id: 'raid-on-delta-videus', build: raidOnDeltaVideus },
  { id: 'the-long-patrol', build: theLongPatrol },
]

export { DETECTION_CURVE }
