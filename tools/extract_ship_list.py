"""
Extract the Master Ship List into msl.json.

The list gives each class its point value, year, availability and — most
usefully — the printed victory point table (S2.8.2), which is canon and saves
recomputing the S2.8.4 percentages.

Both books lay the list out identically:

    [FACTION] CLASS  YEAR  POINTS  AVAIL  PWR+BATT  ACTUAL  OFFNS  DEFNC
    SHLDS+ARMOR  SYST  STR  then five (DMG, PV) pairs for the damage levels
    minor / light / moderate / heavy / crippled.

Run it once per book and the results are merged:

    python3 extract_ship_list.py master aurelian   # → msl.json
"""
import json, re, sys
from pypdf import PdfReader

UPLOADS = '/root/.claude/uploads/62d6f1a5-56b2-574a-9fb3-4d36711828b4/'
BOOKS = {
    'master': (UPLOADS + 'ccff2378-2_StarForce_Commander_Ship_Book_4_MASTER_SHIP_Book.pdf',
               (4, 5)),
    'aurelian': (UPLOADS + '18b6b876-007_AURELIAN_STARSHIP_BOOK_v26_Expansion_5.pdf',
                 (4,)),
}

AVAIL = ('COMMON', 'UNCOMMON', 'RARE', 'UNIQUE')

# `AUR ` prefixes the Aurelian list; the Master Ship Book prints no prefix
# because every ship in it is Union or Vallari.
ROW = re.compile(
    r'^(?:(?P<prefix>AUR|UFS|VAL)\s+)?'
    r'(?P<name>.+?)\s+'
    r'(?P<year>3\d{3})\s+'
    r'(?P<points>\d+)\s+'
    r'(?P<avail>' + '|'.join(AVAIL) + r')\s+'
    r'(?P<rest>[\d\s]+)$'
)


def parse_page(text, faction_hint):
    out = []
    for line in text.split('\n'):
        line = ' '.join(line.split())
        m = ROW.match(line)
        if not m:
            continue
        nums = [int(n) for n in m.group('rest').split()]
        # 7 stat columns, then five damage/points pairs.
        if len(nums) < 17:
            continue
        structure = nums[6]
        victory = [{'damage': nums[7 + 2 * i], 'points': nums[8 + 2 * i]} for i in range(5)]
        name = m.group('name').strip()
        out.append({
            'class': name,
            'year': int(m.group('year')),
            'pointValue': int(m.group('points')),
            'availability': m.group('avail').lower(),
            'pwrBatt': nums[0],
            'shieldsArmor': nums[4],
            'systemBoxes': nums[5],
            'structure': structure,
            'victory': victory,
            'faction': (m.group('prefix') or faction_hint or '').lower() or faction_hint,
            # Ships flagged for a later expansion have no form in this book.
            'future': '(Exp' in name,
        })
    return out


def faction_for(book, name):
    if book == 'aurelian':
        return 'aurelian'
    # The Master Ship Book runs Union classes first, then Vallari, whose class
    # names all begin with a "V-" designation.
    return 'vallari' if re.match(r'^V-\d', name) else 'union'


def main(books):
    rows = []
    for book in books:
        path, pages = BOOKS[book]
        reader = PdfReader(path)
        for pno in pages:
            for row in parse_page(reader.pages[pno].extract_text(), book):
                row['faction'] = faction_for(book, row['class'])
                rows.append(row)
    json.dump(rows, open('msl.json', 'w'), indent=1)
    kept = [r for r in rows if not r['future']]
    print(f'ship list: {len(rows)} rows ({len(kept)} with forms in these books)')
    for faction in sorted({r['faction'] for r in rows}):
        print(f'  {faction}: {sum(1 for r in rows if r["faction"] == faction)}')


if __name__ == '__main__':
    main(sys.argv[1:] or ['master', 'aurelian'])
