import { describe, expect, it } from 'vitest'
import { allShipForms } from '../data/ships'
import { hullKindFor, isCommandHull } from './MapView'

/**
 * The counters tell carriers, freighters and stations from warships of the
 * same tonnage. The kind comes off the printed class name, so these pin the
 * roster's own names to the art they should get.
 */
describe('hull kinds on the map', () => {
  const kind = (name: string) => hullKindFor({ name })

  it('reads carriers, freighters and installations off the class name', () => {
    expect(kind('ARK ROYAL I-class Fleet Carrier')).toBe('carrier')
    expect(kind('NIDUS-class Escort Carrier')).toBe('carrier')
    expect(kind('WARFARER-class Large Freighter')).toBe('freighter')
    expect(kind('V-5H CORSAIR-class Fast Transport')).toBe('freighter')
    expect(kind('BASTION I-class Battlestation')).toBe('station')
    expect(kind('TORTUGA I-class Outpost')).toBe('station')
    expect(kind('GUARDIAN I-class Defense Satellite')).toBe('station')
    expect(kind("O’NEIL-class Habitat")).toBe('station')
  })

  it('leaves warships as warships, hangars or not', () => {
    // TRAFALGAR carries HNGR boxes but is not built as a carrier.
    expect(kind('TRAFALGAR-class Super Dreadnought')).toBe('warship')
    expect(kind('YORKTOWN III-class Heavy Cruiser')).toBe('warship')
    expect(kind('V-2N FLANKER-class Scout')).toBe('warship')
  })

  it('flags command variants however the class spells it', () => {
    expect(isCommandHull({ name: 'YORKTOWN IIIc-class Command Cruiser' })).toBe(true)
    expect(isCommandHull({ name: 'AQUILA BELLUM III-class Cmnd Cruiser' })).toBe(true)
    expect(isCommandHull({ name: 'V-7CC RAIDER-class Command Cruiser' })).toBe(true)
    expect(isCommandHull({ name: 'YORKTOWN III-class Heavy Cruiser' })).toBe(false)
  })

  it('gives every carrier in the roster a flight deck', () => {
    const carriers = allShipForms().filter((f) => /carrier/i.test(f.name))
    expect(carriers.length).toBeGreaterThan(5)
    for (const f of carriers) expect(hullKindFor(f)).toBe('carrier')
  })
})
