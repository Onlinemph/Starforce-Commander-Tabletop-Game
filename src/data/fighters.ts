import type { FighterCard } from '../engine/fighters'

/**
 * Fighter cards.
 *
 * Two sets live here. **`SFC_FIGHTERS` is the roster** — five airframes built
 * out of the printed factions' own technology, and what a carrier flies unless
 * somebody picks otherwise. `FAN_FIGHTERS` is the calibration set: the sixteen
 * Babylon 5 cards embedded in the Apr 2026 outline's own .docx, kept the way
 * the cross-franchise hulls in `tools/fan_designs.ts` are — clearly marked,
 * fully playable, out of the default.
 *
 * The design discipline for the roster is the one that file uses for original
 * hulls: **a fighter may only express what its faction already fields, or it is
 * another faction's craft wearing the wrong flag.** A card carries seven
 * numbers, so the whole of a faction's identity has to arrive through them.
 *
 * What the printed ships say each faction is, and where it lands on a card:
 *
 * | faction | 93 printed hulls say | on a fighter card |
 * | --- | --- | --- |
 * | **Union** | no armour at all, repairing blue and green screens, phasers with PREC and PD MODE, the best sensors in the game (SENS 3.4), and the widest class list by far | **Sensor 2** and the only airframe whose three loadouts are all worth flying. It has no extreme, and that is the point. |
 * | **Vallari** | the only faction with armour — up to 18 points of it, and G2.2.2 says it never repairs — gravitic disruptors, no cloak anywhere | **Structure 5**, the lowest Dodge on any card, and Jamming 5. It soaks and it cannot evade. |
 * | **Aurelian** | 21 hulls out of 21 carry a cloak; plasma torpedoes that arm slowly and hit enormously; the worst sensors in the game (SENS 2.8) | **Jamming 8** and **Structure 3**. A cloak does not fit on a fighter, but what a cloak *does* is exactly what jamming does under E10.2.2. |
 * | **Pirate** | nothing — not one printed hull | the most speculative card here, and built as such: somebody else's airframe with the good parts sold off. |
 *
 * Every card stays inside the envelope of the calibration set — Speed 5‑6,
 * Jamming 5‑8, Structure 3‑5, Sensor 1‑2, DFR 0‑5, Dodge 1‑4, Strike to 1‑4 for
 * 4 — for the same reason the fan hulls were weakened into the printed
 * envelope: a roster whose own designs sit outside the reference set cannot be
 * compared to it.
 */

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

const UNION = 'Union of Federated Systems'
const VALLARI = 'Vallari Imperium'
const AURELIAN = 'Aurelian Empire'
const PIRATE = 'Pirate'

export const SFC_FIGHTERS: FighterCard[] = [
  {
    /*
     * SABRE — the Union's fleet interceptor, and the roster's centre of mass.
     *
     * The Union has no faction trick. It has no armour, no cloak, and the best
     * sensors in the game, and its hulls win by being adequate at everything
     * and precise about it. So the SABRE is the airframe with no extreme: the
     * best Sensor on any card, ties the best Dodge, and is the only fighter
     * here whose three loadouts are all genuinely worth flying — space
     * superiority at DFR 4 is a real dogfighter, strike at 1‑3 for 2 is a real
     * strike, and even BASIC keeps a 1‑2 gun rather than the 1‑1 pop-gun the
     * Starfury and Sentri drop to.
     *
     * Hanging ordnance costs it an inch and a point of jamming, the way it does
     * on the Starfury and Thunderbolt — the outline's "speeds for a fighter may
     * be different based on its load out", and the only place a Union card
     * carries a penalty at all.
     */
    id: 'sabre',
    name: 'SABRE',
    faction: UNION,
    origin: 'Union fleet interceptor, contemporary with the YORKTOWN III',
    speed: 6,
    jamming: 6,
    structure: 4,
    sensor: 2,
    loadouts: [
      { kind: 'strike', dfr: 2, dodge: 2, strikeHit: 3, strikeDamage: 2, speed: 5, jamming: 5 },
      { kind: 'space-superiority', dfr: 4, dodge: 3, strikeHit: 2, strikeDamage: 1 },
      { kind: 'basic', dfr: 3, dodge: 3, strikeHit: 2, strikeDamage: 1 },
    ],
  },
  {
    /*
     * HALBERD — the Union's strike fighter, and the reason a Union carrier is
     * worth bringing to a gunfight it cannot otherwise reach.
     *
     * Union hulls fight at range with A/MAT torpedoes; the HALBERD is that
     * doctrine in a small airframe. Structure 5 because it has to survive the
     * run in, Speed 5 because it is carrying the load, and Strike 1‑4 for 3 —
     * six of them expected to put twelve points into a shield in one pass,
     * which is a torpedo salvo by another name.
     *
     * It pays for all of it in the merge. DFR 2 and Dodge 2 loaded makes it the
     * worst dogfighter on the roster, and the whole reason a Union carrier
     * launches SABREs alongside it.
     */
    id: 'halberd',
    name: 'HALBERD',
    faction: UNION,
    origin: 'Union strike fighter — the A/MAT doctrine in a small airframe',
    speed: 5,
    jamming: 6,
    structure: 5,
    sensor: 2,
    loadouts: [
      { kind: 'strike', dfr: 2, dodge: 2, strikeHit: 4, strikeDamage: 3, jamming: 5 },
      { kind: 'space-superiority', dfr: 3, dodge: 3, strikeHit: 3, strikeDamage: 1 },
      { kind: 'basic', dfr: 2, dodge: 3, strikeHit: 2, strikeDamage: 1 },
    ],
  },
  {
    /*
     * V-1 TALON — Vallari, and the only armoured fighter in the game.
     *
     * The Vallari are the one faction that carries armour, up to eighteen
     * points of it, and G2.2.2 is what makes that a *character* rather than a
     * bonus: armour never repairs, so a Vallari hull has a fixed pool and a
     * clock and has to win early. On a fighter there is no repair to lose in
     * the first place, so the trade comes out entirely in its favour: Structure
     * 5 means six of them soak thirty points of point-defense fire under COA 1,
     * the most of anything in the sky.
     *
     * And it cannot evade. **Dodge 1‑2 at best and 1‑1 loaded** — the lowest on
     * any card by a clear step, so a merge against a SABRE or a STRIX goes
     * badly however good its own guns are. That is the armour-versus-agility
     * axis the calibration set already has between the Frazi and the Sentri,
     * pushed to the end of its own logic: the TALON does not dodge, it takes
     * the hit and keeps coming.
     *
     * Speed 5 and Jamming 5, the lowest of both. Vallari hulls have no cloak
     * and no sensor advantage, and neither does this.
     */
    id: 'v-1-talon',
    name: 'V-1 TALON',
    faction: VALLARI,
    origin: 'Vallari assault fighter — the only armoured airframe in the game',
    speed: 5,
    jamming: 5,
    structure: 5,
    sensor: 1,
    loadouts: [
      { kind: 'strike', dfr: 2, dodge: 1, strikeHit: 3, strikeDamage: 3 },
      { kind: 'space-superiority', dfr: 4, dodge: 2, strikeHit: 3, strikeDamage: 1 },
      { kind: 'basic', dfr: 3, dodge: 2, strikeHit: 2, strikeDamage: 1 },
    ],
  },
  {
    /*
     * STRIX — Aurelian, and the sharpest card in the set.
     *
     * Every one of the twenty-one printed Aurelian hulls carries a cloak. A
     * cloak does not fit in a fighter, but **what a cloak does is what jamming
     * does**: E10.2.2 adds the target's jamming to the actual range of any
     * non-point-defense attack, so a STRIX two inches off a cruiser's bow is
     * fired at as though it were ten inches away, and at ten inches it is off
     * most main batteries' charts entirely. Jamming 8 is the Nial's figure, the
     * highest in the calibration set, and it is the Aurelian faction trait
     * translated exactly.
     *
     * It is also the most fragile thing in the sky at **Structure 3** — six of
     * them are gone to eighteen points of point-defense fire, where six TALONs
     * take thirty. E12.4.3 exempts point defense from the jamming, so a PD
     * mount is firing at where the STRIX actually is, for full damage. Against
     * a battery it is nearly untouchable; against flak it evaporates. That is
     * the Aurelian bargain everywhere else in this game, on a card.
     *
     * The strike load is plasma, and it reads like the printed plasma
     * torpedoes: **1‑2 to hit for 4** — the worst to-hit and the equal-best
     * damage on any card. And Sensor 1, because Aurelian hulls have the worst
     * sensors in the game.
     */
    id: 'strix',
    name: 'STRIX',
    faction: AURELIAN,
    origin: 'Aurelian stealth fighter — what a cloak becomes at this scale',
    speed: 6,
    jamming: 8,
    structure: 3,
    sensor: 1,
    loadouts: [
      { kind: 'strike', dfr: 2, dodge: 3, strikeHit: 2, strikeDamage: 4, jamming: 7 },
      { kind: 'space-superiority', dfr: 4, dodge: 4, strikeHit: 2, strikeDamage: 2 },
      { kind: 'basic', dfr: 3, dodge: 4, strikeHit: 1, strikeDamage: 1 },
    ],
  },
  {
    /*
     * MAGPIE — Pirate, and the most speculative card here by a distance.
     *
     * There is not one printed Pirate hull to read a doctrine off, so this is
     * built from the only thing that is safe to assume about pirates: they fly
     * what they can get. The MAGPIE is a SABRE airframe with the good parts
     * sold — the same speed and structure, a point less jamming, a worse sensor
     * fit, and every loadout one step below the Union card it was built from.
     *
     * It is deliberately not interesting. A pirate wing is numbers and nerve,
     * and the card should say so: nothing here is better than anything the
     * navies fly, and that is the design rather than a gap in it.
     */
    id: 'magpie',
    name: 'MAGPIE',
    faction: PIRATE,
    origin: 'Pirate — a SABRE with the good parts sold off',
    speed: 6,
    jamming: 5,
    structure: 4,
    sensor: 1,
    loadouts: [
      { kind: 'strike', dfr: 1, dodge: 2, strikeHit: 3, strikeDamage: 2, speed: 5 },
      { kind: 'space-superiority', dfr: 3, dodge: 3, strikeHit: 2, strikeDamage: 1 },
      { kind: 'basic', dfr: 2, dodge: 2, strikeHit: 1, strikeDamage: 1 },
    ],
  },
]

// ---------------------------------------------------------------------------
// The calibration set
// ---------------------------------------------------------------------------

/**
 * The fighter cards embedded in **StarFighter_Rules_Outline.docx** (Apr 2026).
 *
 * The document's text is 9.8 KB; the file is 1.4 MB, and the difference is
 * eleven images a text extraction never sees. Sixteen cards, transcribed by eye
 * and cross-checked against the outline's own worked examples — it names the
 * Starfury and Sentri as DFR 3 and the Nial as DFR 4, and the green chevron
 * reads exactly 1‑3, 1‑3, 1‑4 in BASIC. The full transcription, with the icon
 * key and the reasoning for which box is DFR and which is Dodge, is in
 * `docs/fighter-stats.md`.
 *
 * **Every one of these is a Babylon 5 design**, which is what makes them a
 * calibration set rather than a roster — the same instinct as pricing the DFR
 * ladder against known franchises. They are kept the way the cross-franchise
 * hulls in `tools/fan_designs.ts` are kept: clearly marked, playable, and never
 * the default.
 *
 * Speed and jamming sit on the airframe and are constant across a card's
 * loadouts, except on the Starfury and Thunderbolt where hanging ordnance costs
 * one or both.
 */
export const FAN_FIGHTERS: FighterCard[] = [
  {
    id: 'starfury',
    name: 'STARFURY',
    faction: 'Earth Alliance',
    fan: true,
    origin: 'Earth Alliance (Babylon 5)',
    speed: 6,
    jamming: 6,
    structure: 4,
    sensor: 1,
    loadouts: [
      { kind: 'strike', dfr: 2, dodge: 2, strikeHit: 3, strikeDamage: 2, speed: 5, jamming: 5 },
      { kind: 'space-superiority', dfr: 3, dodge: 4, strikeHit: 2, strikeDamage: 1 },
      { kind: 'basic', dfr: 3, dodge: 3, strikeHit: 1, strikeDamage: 1 },
    ],
  },
  {
    id: 'thunderbolt',
    name: 'THUNDERBOLT',
    faction: 'Earth Alliance',
    fan: true,
    origin: 'Earth Alliance (Babylon 5)',
    speed: 6,
    jamming: 7,
    structure: 4,
    sensor: 1,
    loadouts: [
      { kind: 'strike', dfr: 2, dodge: 2, strikeHit: 4, strikeDamage: 2, jamming: 6 },
      { kind: 'space-superiority', dfr: 3, dodge: 3, strikeHit: 3, strikeDamage: 1 },
      { kind: 'basic', dfr: 2, dodge: 3, strikeHit: 2, strikeDamage: 1 },
    ],
  },
  {
    id: 'frazi',
    name: 'FRAZI',
    faction: 'Narn Regime',
    fan: true,
    origin: 'Narn Regime (Babylon 5)',
    speed: 5,
    jamming: 5,
    structure: 5,
    sensor: 1,
    loadouts: [
      { kind: 'strike', dfr: 2, dodge: 2, strikeHit: 3, strikeDamage: 3 },
      { kind: 'space-superiority', dfr: 3, dodge: 4, strikeHit: 3, strikeDamage: 1 },
      { kind: 'basic', dfr: 3, dodge: 3, strikeHit: 2, strikeDamage: 1 },
    ],
  },
  {
    id: 'nial',
    name: 'NIAL',
    faction: 'Minbari Federation',
    fan: true,
    origin: 'Minbari Federation (Babylon 5)',
    speed: 6,
    jamming: 8,
    structure: 4,
    sensor: 2,
    loadouts: [
      { kind: 'strike', dfr: 3, dodge: 3, strikeHit: 4, strikeDamage: 3 },
      { kind: 'space-superiority', dfr: 5, dodge: 4, strikeHit: 3, strikeDamage: 2 },
      { kind: 'basic', dfr: 4, dodge: 4, strikeHit: 3, strikeDamage: 1 },
    ],
  },
  {
    id: 'sentri',
    name: 'SENTRI',
    faction: 'Centauri Republic',
    fan: true,
    origin: 'Centauri Republic (Babylon 5)',
    speed: 6,
    jamming: 6,
    structure: 3,
    sensor: 2,
    loadouts: [
      { kind: 'strike', dfr: 2, dodge: 2, strikeHit: 3, strikeDamage: 2 },
      { kind: 'space-superiority', dfr: 4, dodge: 3, strikeHit: 3, strikeDamage: 1 },
      { kind: 'basic', dfr: 3, dodge: 4, strikeHit: 1, strikeDamage: 1 },
    ],
  },
  {
    /*
     * The PEREGRINE sheet is watermarked MASTER COPY and carries only its
     * STRIKE card, so it is the layout template rather than a finished entry.
     * Its two missing loadouts are interpolated from the shape every other card
     * holds to — space superiority buys DFR and Dodge and gives up anti-ship
     * damage, basic sits between — and are marked as ours, not Doyle's.
     */
    id: 'peregrine',
    name: 'PEREGRINE',
    faction: 'Unassigned',
    fan: true,
    origin: 'Master-copy template sheet (Babylon 5)',
    speed: 6,
    jamming: 5,
    structure: 5,
    sensor: 2,
    loadouts: [
      { kind: 'strike', dfr: 2, dodge: 3, strikeHit: 4, strikeDamage: 4 },
      // Interpolated — not on the sheet.
      { kind: 'space-superiority', dfr: 3, dodge: 4, strikeHit: 3, strikeDamage: 1 },
      { kind: 'basic', dfr: 3, dodge: 3, strikeHit: 2, strikeDamage: 1 },
    ],
  },
]

// ---------------------------------------------------------------------------

/** Everything flyable, roster first. */
export const FIGHTER_CARDS: FighterCard[] = [...SFC_FIGHTERS, ...FAN_FIGHTERS]

export function fighterCard(id: string): FighterCard | undefined {
  return FIGHTER_CARDS.find((c) => c.id === id)
}

/**
 * What a carrier of this faction flies unless somebody says otherwise.
 *
 * Falls back to the SABRE, which is the roster's centre of mass — a hull with
 * no faction the cards recognise (a fan design, a custom build) gets the
 * airframe with no extremes rather than somebody else's specialist.
 */
export function defaultWingFor(faction: string): string {
  const own = SFC_FIGHTERS.find((c) => c.faction === faction)
  if (own) return own.id
  // A guest hull flies its own navy's craft if the calibration set has one —
  // an OMEGA launches Starfuries, which is the whole reason those cards are
  // still here. Anything else gets the SABRE.
  const guest = FAN_FIGHTERS.find((c) => c.faction === faction)
  return (guest ?? SFC_FIGHTERS[0]).id
}

/** Loadouts printed on a real card, as against the two we interpolated. */
export const INTERPOLATED_LOADOUTS: ReadonlyArray<{ cardId: string; kind: string }> = [
  { cardId: 'peregrine', kind: 'space-superiority' },
  { cardId: 'peregrine', kind: 'basic' },
]
