"""Second-opinion audit: read every ship page via the TEXT layer and diff
against src/data/ships.json.

The point is independence. The extractor counts glyphs; its own validator
can only check the sums the extractor chose to check, which is how a clipped
label cost seventeen ships their shield generators and ten Aurelian plasma
mounts fired +1 where the page prints +4 — both invisible to a validator
that trusts the extraction. This tool re-reads the pages by a different
mechanism entirely (the text layer: bonus tokens, range bands, capability
labels) and flags every disagreement with the shipped data.

Run from the repo root: python3 tools/audit_ship_book.py

Expected output on a healthy roster: exactly one flag — the V-6N SAVAGE's
G-YAGUS bracket, where the book itself prints an overlapping band
("5-10" then "9-15") and the data carries the documented errata reading
of 11-15 (see ERRATA in generate_ships.py). Any second flag is news.
"""
import fitz, json, re, collections

UP = '/root/.claude/uploads/62d6f1a5-56b2-574a-9fb3-4d36711828b4/'
MASTER = fitz.open(UP + 'ccff2378-2_StarForce_Commander_Ship_Book_4_MASTER_SHIP_Book.pdf')
AURELIAN = fitz.open(UP + '18b6b876-007_AURELIAN_STARSHIP_BOOK_v26_Expansion_5.pdf')
ships = json.load(open('src/data/ships.json'))

flags = []
audited = 0
for ship in ships:
    doc = AURELIAN if ship['faction'] == 'Aurelian Empire' else MASTER
    pno = ship.get('shipBookPage')
    if not pno or pno > len(doc): continue
    page = doc[pno - 1]
    text = page.get_text()
    audited += 1
    right = page.get_text(clip=fitz.Rect(500, 40, 800, 800))

    # 1. bracket bonus multiset: "+N" tokens, minus SPCL-line tokens (LEAK+1 etc.)
    page_bonus = collections.Counter(int(t) for t in re.findall(r'\+(\d+)', right))
    spcl = collections.Counter(int(t) for t in re.findall(r'(?:LEAK|STR|DMG|SPD|TRK)\s*\+\s*(\d+)', right))
    page_adj = page_bonus - spcl
    data_bonus = collections.Counter()
    for w in ship['weapons']:
        for b in w.get('brackets', []):
            if b.get('bonus'): data_bonus[b['bonus']] += 1
    if page_adj != data_bonus:
        flags.append((ship['id'], 'bonus', dict(page_adj - data_bonus), dict(data_bonus - page_adj)))

    # 2. range bands "a-b"
    page_ranges = collections.Counter(re.findall(r'\b(\d+-\d+)\b', right))
    data_ranges = collections.Counter()
    for w in ship['weapons']:
        for b in w.get('brackets', []):
            data_ranges[f"{b['min']}-{b['max']}"] += 1
    if page_ranges != data_ranges:
        flags.append((ship['id'], 'ranges', dict(page_ranges - data_ranges), dict(data_ranges - page_ranges)))

    # 3. capability labels vs data
    kinds = {s['kind'] for s in ship.get('systems', [])}
    if 'SHIELD GEN' in text and ship['shields'].get('generatorBoxes', 0) == 0:
        flags.append((ship['id'], 'SHIELD GEN label, 0 boxes', '', ''))
    if 'SCOUT SEN' in text and not ship.get('scoutSensor'):
        flags.append((ship['id'], 'SCOUT SEN label, no scout data', '', ''))
    if re.search(r'\bCLOAK\b', text) and 'CLOAK' not in kinds:
        flags.append((ship['id'], 'CLOAK label, no cloak system', '', ''))

print(f'audited {audited} of {len(ships)} ships')
print(f'{len(flags)} flags:')
for f in flags[:70]:
    print(' ', f[0], '|', f[1], '| page-only:', f[2], '| data-only:', f[3])
