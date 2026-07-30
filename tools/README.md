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
