# Fighter stat cards, transcribed

Lifted from the images embedded in **StarFighter_Rules_Outline.docx** (Apr 2026). The document's
text is 9.8 KB; the file is 1.4 MB, and the difference is these cards — eleven embedded images that
a text extraction never sees.

Six airframes, three loadout configurations each (PEREGRINE has only its STRIKE card, on a sheet
watermarked MASTER COPY, so it is the layout template rather than a finished entry).

## The card layout

```
┌──────────────────────────────────────────────┐
│ NAME                       CONFIGURATION     │   ← blue band; red band on Narn cards
├──────────────────────────────────────────────┤
│  ↑6    ⟩⟩⟩8    🛡4    📡2            [ID]    │   ← the airframe
│                                                │
│  ⇊1-4         ⚙✈1-4                  [ID]    │   ← the loadout
│         art          🚀 1-3           [ID]    │
│                          1            [ID]    │
└──────────────────────────────────────────────┘
```

| icon | box colour | stat |
| --- | --- | --- |
| `↑` single arrow | green | **Speed**, inches per combat phase |
| `⟩⟩⟩` radio waves | pale blue | **Jamming** |
| `🛡` shield | cyan | **Structure** — damage points to destroy |
| `📡` dish | pale green | **Sensor** — information points gathered |
| `⇊` chevrons | green | **DFR**, as a roll-under d6 range |
| `⚙✈` helm wheel + aircraft | gold | **Dodge**, as a roll-under d6 range |
| `🚀` rocket | red | **Strike** — top: to-hit range vs starships; bottom: damage per hit |
| `ID` | pale grey | four blank boxes to write the flight IDs using this card |

### Why that mapping and not the reverse

The two roll-under boxes are the only ones that could be confused. Three independent checks put
DFR on the green chevrons:

1. **The outline's own examples.** It names Starfury and Sentri as DFR 3 and the Nial as DFR 4.
   In BASIC configuration the green chevron reads exactly `1-3`, `1-3`, `1-4`.
2. **The ranges.** The outline gives DFR as 1–5 and Dodge as 1–4. Across all sixteen cards the
   green chevron reaches 5 (Nial, space superiority) and the gold box never exceeds 4.
3. **The shape of the numbers.** DFR rises with an anti-fighter loadout and falls with an
   anti-ship one; Dodge falls as ordnance is hung on the airframe. Both hold on the green and
   gold boxes respectively, on every card.

## The airframes

Row 1 is the aircraft, and is constant across that fighter's configurations — except on the
Starfury and Thunderbolt, where the strike load costs speed and jamming. That is the outline's
"Speeds for a fighter may be different based on its load out" showing up in the data.

| fighter | | Speed | Jamming | Structure | Sensor |
| --- | --- | --- | --- | --- | --- |
| **STARFURY** | strike | 5 | 5 | 4 | 1 |
| | space sup / basic | 6 | 6 | 4 | 1 |
| **THUNDERBOLT** | strike | 6 | 6 | 4 | 1 |
| | space sup / basic | 6 | 7 | 4 | 1 |
| **FRAZI** | all | 5 | 5 | 5 | 1 |
| **NIAL** | all | 6 | 8 | 4 | 2 |
| **SENTRI** | all | 6 | 6 | 3 | 2 |
| **PEREGRINE** | strike | 6 | 5 | 5 | 2 |

## The loadouts

| fighter | configuration | DFR | Dodge | Strike hit | Strike damage |
| --- | --- | --- | --- | --- | --- |
| STARFURY | STRIKE | 1‑2 | 1‑2 | 1‑3 | 2 |
| STARFURY | SPACE SUPERIORITY | 1‑3 | 1‑4 | 1‑2 | 1 |
| STARFURY | BASIC | 1‑3 | 1‑3 | 1 | 1 |
| THUNDERBOLT | STRIKE | 1‑2 | 1‑2 | 1‑4 | 2 |
| THUNDERBOLT | SPACE SUPERIORITY | 1‑3 | 1‑3 | 1‑3 | 1 |
| THUNDERBOLT | BASIC | 1‑2 | 1‑3 | 1‑2 | 1 |
| FRAZI | STRIKE | 1‑2 | 1‑2 | 1‑3 | 3 |
| FRAZI | SPACE SUPERIORITY | 1‑3 | 1‑4 | 1‑3 | 1 |
| FRAZI | BASIC | 1‑3 | 1‑3 | 1‑2 | 1 |
| NIAL | STRIKE | 1‑3 | 1‑3 | 1‑4 | 3 |
| NIAL | SPACE SUPERIORITY | 1‑5 | 1‑4 | 1‑3 | 2 |
| NIAL | BASIC | 1‑4 | 1‑4 | 1‑3 | 1 |
| SENTRI | STRIKE | 1‑2 | 1‑2 | 1‑3 | 2 |
| SENTRI | SPACE SUPERIORITY | 1‑4 | 1‑3 | 1‑3 | 1 |
| SENTRI | BASIC | 1‑3 | 1‑4 | 1 | 1 |
| PEREGRINE | STRIKE | 1‑2 | 1‑3 | 1‑4 | 4 |

## What the numbers say

**The configurations are a coherent triangle.** Space superiority buys DFR and Dodge and gives up
anti-ship damage; strike does the reverse and is the worst dogfighter on every airframe; basic
sits between them with a Strike that is just guns — `1/1` on the Starfury and Sentri, meaning it
hits a starship only on a natural 1, for one point.

**Structure is not a stiffness ladder.** The Frazi is the toughest thing here at 5 and the worst
dogfighter; the Sentri is the most fragile at 3. This is armour versus agility, not good versus
bad.

**Jamming does the differentiating.** 5 to 8 across six airframes, and under **E10.2.2** jamming
is added to the actual range of any non-point-defense attack — which can push a volley into a
worse bracket. A Nial at jamming 8 is close to unhittable by a starship's main battery. That is
the single most consequential number on these cards for how fighters feel against ships.

**Sensor is 1 or 2** — the number of information points the flight gathers, against a probe's 1
per phase under J7.3.3.

## Caveats

- Every one of these is a **Babylon 5** design (EA Starfury and Thunderbolt, Narn Frazi, Minbari
  Nial, Centauri Sentri). None of StarForce Commander's own factions — Union, Vallari, Aurelian,
  Pirate — has a fighter here. These read as a calibration set, the same way the fan-design
  work in `tools/fan_designs.ts` calibrates hulls against known ships.
- **No point values.** Nothing on the cards says what a flight costs in a fleet list, and the V41
  builder's hangar note says "the point value of any fighters is not included in the hangar."
- **No ammunition count**, so nothing here says how many attacks a strike load buys before the
  counter flips.
- Transcribed from images by eye. The values are legible and cross-check against each other and
  against the outline, but they should be confirmed before anything is priced on them.
