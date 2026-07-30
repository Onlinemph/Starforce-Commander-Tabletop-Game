# Ship Book importer

Regenerates `src/data/ships.json` from the StarForce Commander **Master Ship Book** PDF.

```bash
pip install pymupdf
cd tools
python3 extract_ship_book.py all      # → ships_raw.json   (one record per form)
python3 generate_ships.py             # → ships_final.json (engine schema, validated)
```

`extract_ship_book.py` reads the forms structurally rather than as text: box and power-circle glyphs
are identified by Wingdings codepoint plus colour, range-bracket bands by Calibri colour and italics,
attack dice by Wingdings2 colour, and firing arcs by rasterising each icon *placement* (the layout
rotates and mirrors a small set of source images) and reading its eight wedges.

`generate_ships.py` maps those records onto the engine's `ShipForm` schema, joins the Master Ship
List for point values, availability, year and the victory table, applies the errata list, and
cross-checks each ship against its own printed TOTAL POWER, battery count and shield values. It
prints `validation problems: 0` when everything reconciles.

The Master Ship List itself is parsed from a plain-text dump of pages 5-6; `msl.json` is the
intermediate. Both intermediates are scratch files and are not committed.

Set `PDF` at the top of `extract_ship_book.py` to the Ship Book path before running.


# Damage deck importer

Regenerates `src/data/damageDeck.json` from the **print-and-play components** PDF.

```bash
cd tools
python3 extract_damage_deck.py     # → cards_raw.json (56 cards)
```

The deck lives on four "CARD FRONT n of 4" sheets, each a 5x3 grid of card frames. A normal card has
two rounded header bands — the primary hit above, the ALT HIT below — whose fill colour encodes the
E8 category (pale pink weapon, green engineering, blue defense, yellow general, orange structure).
Critical cards have no bands and no alternate hit. The Stress Damage icon (C3.1.4) is the only
artwork a card carries, so its presence is read from the image list.

Titles are separated from rules text by case, not size or colour: titles are set in caps (allowing
for stylised small caps like `lEFT`), rules text in sentence case. Type size does not work — long
titles shrink to the body's 9pt — and neither does colour, since yellow cards set their titles in
black.

Card titles are then mapped onto the engine's `DamageHit` identifiers and written out with stable
ids. The importer prints any title it cannot map.

# Attack dice

The die faces in `src/engine/dice.ts` are transcribed from the DIE ROLL CHART on the Captain's
Reference Card (page 31 of the components PDF), which prints the equivalent result for every face of
a standard d6. They are not extracted programmatically — the table is six rows long and is easier to
read than to parse.
