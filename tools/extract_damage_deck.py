"""
Parse the 56-card damage deck from the print-and-play component sheets.

Each sheet is a 5x3 grid of card frames. A normal card has two rounded header
bands — the primary hit on top and the ALT HIT below — whose fill colour encodes
the E8 category. Critical (white) cards have no bands and no alternate hit.
A Stress Damage icon is the only artwork printed on a card.
"""
import fitz, json, re
from collections import Counter

PDF = ('/root/.claude/uploads/62d6f1a5-56b2-574a-9fb3-4d36711828b4/'
       'c4e5866a-001_SFC_Print_and_Play_Components_V2_6.pdf')
doc = fitz.open(PDF)
SHEETS = [38, 40, 42, 44]

BAND_CATEGORY = {
    (0.98, 0.9, 0.84): 'weapon',
    (0.89, 0.94, 0.85): 'engineering',
    (0.87, 0.92, 0.97): 'defense',
    (1.0, 1.0, 0.0): 'general',
    (1.0, 0.75, 0.0): 'structure',
}


def frames_of(page):
    seen = {}
    for g in page.get_drawings():
        r = g['rect']
        if abs(r.width - 118) < 5 and abs(r.height - 170) < 5:
            seen.setdefault((round(r.x0 / 8), round(r.y0 / 8)), r)
    return [seen[k] for k in sorted(seen, key=lambda k: (k[1], k[0]))]


def bands_of(page, rect):
    out = []
    for g in page.get_drawings():
        r = g['rect']
        if not (abs(r.width - 99) < 5 and abs(r.height - 74) < 5):
            continue
        if rect.x0 - 6 <= r.x0 and r.x1 <= rect.x1 + 6 and rect.y0 - 6 <= r.y0 <= rect.y1:
            out.append((round(r.y0), g.get('fill')))
    dedup = {}
    for y, fill in out:
        dedup.setdefault(round(y / 8), (y, fill))
    return [dedup[k] for k in sorted(dedup)]


def spans_in(page, rect, y0, y1):
    rows = []
    for b in page.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                x, y = s['bbox'][0], s['bbox'][1]
                if rect.x0 <= x <= rect.x1 and y0 <= y < y1:
                    rows.append((y, x, s['text'], round(s['size'], 1)))
    rows.sort()
    return rows


def split_title(rows):
    """
    A card section is a title followed by optional rules text. Neither type size
    nor colour separates them reliably — long titles shrink to the body's 9pt,
    and yellow cards set their titles in black — but titles are always set in
    caps and rules text in sentence case, which does. A few words are set in
    stylised small caps ("lEFT", "bEAM"), so allow a little lowercase rather
    than requiring none. The literal "ALT HIT" label belongs to neither section.
    """
    title, note = [], []
    for _, _, text, _size in rows:
        text = text.strip()
        if not text or text.upper() == 'ALT HIT':
            continue
        letters = [c for c in text if c.isalpha()]
        lower_ratio = sum(c.islower() for c in letters) / max(1, len(letters))
        (title if lower_ratio < 0.3 else note).append(text)
    # The forms use stylised small caps for some letters (lEFT, bEAM).
    return (re.sub(r'\s+', ' ', ' '.join(title)).strip().upper(),
            re.sub(r'\s+', ' ', ' '.join(note)).strip())


def parse_sheet(pno):
    page = doc[pno]
    images = [fitz.Rect(i['bbox']) for i in page.get_image_info()]
    cards = []
    for rect in frames_of(page):
        bands = bands_of(page, rect)
        if len(bands) >= 2:
            split = bands[1][0]
            p_title, p_note = split_title(spans_in(page, rect, rect.y0, split - 2))
            a_title, a_note = split_title(spans_in(page, rect, split - 2, rect.y1))
            a_title = re.sub(r'^\s*ALT HIT\s*', '', a_title).strip()
            a_note = re.sub(r'^\s*ALT HIT\s*', '', a_note).strip()
            fill = bands[0][1]
            key = tuple(round(v, 2) for v in fill) if fill else None
            category = BAND_CATEGORY.get(key, 'critical')
        else:
            # Critical hits have no bands and no alternate hit (E8.6).
            p_title, p_note = split_title(spans_in(page, rect, rect.y0, rect.y1))
            a_title = a_note = ''
            category = 'critical'

        if not p_title:
            continue
        cards.append({
            'primary': p_title, 'primaryNote': p_note,
            'alt': a_title or None, 'altNote': a_note or None,
            'category': category,
            'stressIcon': any(rect.x0 <= im.x0 and im.x1 <= rect.x1
                              and rect.y0 <= im.y0 and im.y1 <= rect.y1 for im in images),
            'sheet': pno + 1,
        })
    return cards


all_cards = []
for pno in SHEETS:
    got = parse_sheet(pno)
    print(f'sheet page {pno+1}: {len(got)} cards')
    all_cards += got

print('TOTAL', len(all_cards))
print('by category:', dict(Counter(c['category'] for c in all_cards)))
print('stress icons:', sum(1 for c in all_cards if c['stressIcon']))
print()
for (prim, alt, cat, stress), n in sorted(
        Counter((c['primary'], c['alt'], c['category'], c['stressIcon']) for c in all_cards).items()):
    print(f'  {n:2d} × [{cat:<11}] {prim:<28} ALT {str(alt):<28} {"STRESS" if stress else ""}')
json.dump(all_cards, open('cards_raw.json', 'w'), indent=1)
print()
print('Next: map the titles onto engine DamageHit ids and write '
      'src/data/damageDeck.json (see tools/README.md).')
