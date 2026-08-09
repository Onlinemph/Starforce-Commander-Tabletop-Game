"""
Extract StarForce Commander ship forms from the Master Ship Book PDF.

The forms are vector, not raster. Boxes and power circles are Wingdings glyphs
whose colour encodes meaning; range brackets are Calibri spans whose colour and
italics encode the band; attack dice are Wingdings2 glyphs whose colour encodes
the die; and firing-arc icons are small images that the layout rotates and
mirrors, so each *placement* is rasterised and classified rather than each image.
"""
import fitz, hashlib, json, math, os, re, sys
from collections import defaultdict

UPLOADS = '/root/.claude/uploads/62d6f1a5-56b2-574a-9fb3-4d36711828b4/'
BOOKS = {
    'master': UPLOADS + 'ccff2378-2_StarForce_Commander_Ship_Book_4_MASTER_SHIP_Book.pdf',
    'aurelian': UPLOADS + '18b6b876-007_AURELIAN_STARSHIP_BOOK_v26_Expansion_5.pdf',
}
# `BOOK=aurelian python3 extract_ship_book.py all` reads the Expansion 5 book
# instead of the Master Ship Book. The two share a layout and differ only in
# palette, which the colour sets below already allow for.
BOOK = os.environ.get('BOOK', 'master')
PDF = BOOKS.get(BOOK, BOOK)
doc = fitz.open(PDF)

BOX, CIRCLE, FILLED, DIAMOND = 0xf06f, 0xf06d, 0x26ab, 0x2b27
DIE_BY_GLYPH = {0xf075: 'blue', 0xf076: 'green', 0xf077: 'yellow', 0xf078: 'red'}
C_GREEN, C_BLACK, C_RED, C_BLUE = '#00b050', '#000000', '#ff0000', '#00b0f0'
ARMOR_COLORS = {'#7f7f7f', '#ffc000', '#bf9000'}
ARCS = ['FS', 'SF', 'SA', 'AS', 'AP', 'PA', 'PF', 'FP']

# Union forms print headings in white on blue; Vallari forms use yellow on red
# and set titles in Impact rather than Arial; Aurelian forms (Expansion 5) use
# purple on green with dark-green general-data icons.
HEADER_COLORS = {'#ffffff', '#ffff00', '#7030a0'}
ICON_COLORS = {'#ffffff', '#ff0000', '#385723'}


def chars_of(page):
    out = []
    for b in page.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                col = '#%06x' % s['color']
                for c in s['chars']:
                    out.append({'x': c['bbox'][0], 'y': c['bbox'][1], 'x1': c['bbox'][2],
                                'ch': c['c'], 'o': ord(c['c']), 'font': s['font'],
                                'size': s['size'], 'color': col,
                                'blank': not c['c'].strip()})
    out.sort(key=lambda c: (round(c['y']), c['x']))
    return out


def glyphs(chars):
    return [c for c in chars if not c['blank']]


def row_text(chars, y, tol=4, x0=-1e9, x1=1e9):
    cs = sorted([c for c in chars if abs(c['y'] - y) <= tol and x0 <= c['x'] <= x1],
                key=lambda c: c['x'])
    return ''.join(c['ch'] for c in cs)


def label_rows(chars, x0, x1, y0, y1):
    """Left-column labels: {y: (label, colour)}."""
    rows = defaultdict(list)
    for c in chars:
        if x0 <= c['x'] <= x1 and y0 <= c['y'] <= y1 and c['font'].startswith('Arial'):
            rows[round(c['y'])].append(c)
    out = {}
    for y, cs in rows.items():
        cs.sort(key=lambda c: c['x'])
        text = ''.join(c['ch'] for c in cs).strip()
        if text:
            out[y] = (text, cs[0]['color'])
    return out


# ---------------------------------------------------------------- arc icons

_arc_cache = {}


def classify_arcs(page, info):
    t = info['transform']
    key = (hashlib.md5(doc.extract_image(info['xref'])['image']).hexdigest()[:10],
           round(t[0], 2), round(t[1], 2), round(t[2], 2), round(t[3], 2))
    if key in _arc_cache:
        return _arc_cache[key]
    pix = page.get_pixmap(clip=fitz.Rect(info['bbox']).round(), dpi=400)
    W, H = pix.width, pix.height
    xs, ys = [], []
    for y in range(H):
        for x in range(W):
            p = pix.pixel(x, y)
            if not (p[0] > 235 and p[1] > 235 and p[2] > 235):
                xs.append(x); ys.append(y)
    if not xs:
        _arc_cache[key] = []
        return []
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    R = min(max(xs) - min(xs), max(ys) - min(ys)) / 2
    red = [0] * 8; white = [0] * 8
    for y in range(H):
        for x in range(W):
            dx, dy = x - cx, cy - y
            dist = math.hypot(dx, dy)
            if dist < R * 0.30 or dist > R * 0.78:
                continue
            ang = (math.degrees(math.atan2(dx, dy)) + 360) % 360
            if not (11 < ang % 45 < 34):
                continue
            k = int(ang // 45)
            p = pix.pixel(x, y)
            if p[0] > 140 and p[1] < 120 and p[2] < 120:
                red[k] += 1
            elif p[0] > 200 and p[1] > 200 and p[2] > 200:
                white[k] += 1
    arcs = [ARCS[k] for k in range(8) if red[k] > white[k]]
    _arc_cache[key] = arcs
    return arcs


def arc_icons(page):
    out = []
    for info in page.get_image_info(xrefs=True):
        if not (40 <= info['width'] <= 70 and 40 <= info['height'] <= 70):
            continue
        arcs = classify_arcs(page, info)
        if not arcs:
            continue
        b = info['bbox']
        out.append({'x': b[0], 'cx': (b[0] + b[2]) / 2, 'y': b[1], 'arcs': arcs})
    out.sort(key=lambda a: (round(a['y'] / 8), a['x']))
    return out


# ------------------------------------------------------------------ helpers

def group_numbers(chars, gap=6):
    """Digits sorted by x, joined into numbers wherever they sit side by side."""
    out, cur, last = [], '', None
    for c in sorted(chars, key=lambda c: c['x']):
        if last is not None and c['x'] - last > gap and cur:
            out.append((last, cur)); cur = ''
        cur += c['ch']; last = c['x1']
    if cur:
        out.append((last, cur))
    return out


def cluster_rows(chars, tol=3.0):
    """
    Group glyphs into printed rows by proximity rather than a fixed grid.

    A label and the boxes beside it are not always set on exactly the same
    baseline — on Aurelian forms the CLOAK box sits 0.8pt above its label — and
    a fixed bucket boundary can fall in that gap and split the row in two.
    """
    rows = []
    for c in sorted(chars, key=lambda c: c['y']):
        if rows and c['y'] - rows[-1][0] <= tol:
            rows[-1][1].append(c)
        else:
            rows.append((c['y'], [c]))
    return [sorted(cs, key=lambda c: c['x']) for _, cs in rows]


def dedupe(items):
    """Order-preserving unique. Aurelian forms overprint the FTL trait in two
    colours, which reads out as a repeat."""
    seen, out = set(), []
    for item in items:
        # "FTL FTL" collapses to "FTL" as well as whole-token repeats.
        parts = item.split()
        if len(parts) > 1 and len(set(parts)) == 1:
            item = parts[0]
        if item not in seen:
            seen.add(item); out.append(item)
    return out


def group_by_gap(items, gap):
    groups, cur = [], []
    for c in items:
        if cur and c['x'] - cur[-1]['x1'] > gap:
            groups.append(cur); cur = []
        cur.append(c)
    if cur:
        groups.append(cur)
    return groups


def parse_circles(chars, y, x0=60, x1=270):
    """
    A FUNCTIONS row as an ordered list of circles, each with the number or word
    printed immediately to its right.
    """
    row = sorted([c for c in chars if abs(c['y'] - y) <= 5 and x0 < c['x'] < x1 and not c['blank']],
                 key=lambda c: c['x'])
    out = []
    for i, c in enumerate(row):
        if not (c['font'].startswith('Wingdings') and c['o'] in (CIRCLE, FILLED)):
            continue
        num, word = '', ''
        for nxt in row[i + 1:]:
            if nxt['font'].startswith('Wingdings'):
                break
            if nxt['ch'].isdigit():
                num += nxt['ch']
            elif nxt['ch'].isalpha():
                word += nxt['ch']
        out.append({'free': c['o'] == FILLED, 'value': int(num) if num else None,
                    'word': word or None, 'x': c['x']})
    return out


# ----------------------------------------------------------------- the ship

def parse_ship(pno):
    page = doc[pno]
    chars = chars_of(page)
    gl = glyphs(chars)
    if not gl:
        return None

    text = page.get_text()

    titles = [c for c in gl if c['size'] >= 17 and c['y'] < 32]
    if not titles:
        return None
    # Build the name only from the large title glyphs — the grey "SHIP NAME / ID"
    # watermark sits on the same row.
    ty = round(titles[0]['y'])
    tx0 = min(c['x'] for c in titles)
    name = ''.join(c['ch'] for c in sorted(
        [c for c in chars if abs(c['y'] - ty) <= 4 and c['x'] >= tx0 - 2 and c['size'] >= 17],
        key=lambda c: c['x'])).strip()
    if not name or 'SHIP NAME' in name.upper():
        return None

    ship = {'page': pno + 1, 'name': re.sub(r'\s+', ' ', name)}

    # General data icons: size class, max accel/phase, stress rating, DC rating.
    icons = sorted([c for c in gl if c['font'] == 'Arial-Black' and c['color'] in ICON_COLORS
                    and 45 <= c['y'] <= 72 and c['x'] < 265], key=lambda c: c['x'])
    nums, cur, last = [], '', None
    for c in icons:
        if last is not None and c['x'] - last > 12 and cur:
            nums.append(int(cur)); cur = ''
        cur += c['ch']; last = c['x1']
    if cur:
        nums.append(int(cur))
    if len(nums) >= 4:
        ship['sizeClass'], ship['accelPerPhase'] = nums[0], nums[1]
        ship['stressRating'], ship['damageControl'] = nums[2], nums[3]

    m = re.search(r'TOTAL POWER:\s*(\d+)\s*\+\s*(\d+)', text)
    if m:
        ship['totalPower'], ship['totalBatteries'] = int(m.group(1)), int(m.group(2))
    m = re.search(r'\b(RARE|COMMON|UNCOMMON|UNIQUE)\b', text)
    ship['availability'] = m.group(1).lower() if m else None
    m = re.search(r'\b(3[0-9]{3})\b', text)
    ship['year'] = int(m.group(1)) if m else None

    # ---------------------------------------------------------- FUNCTIONS
    funcs = []
    for y, (label, colour) in sorted(label_rows(chars, 0, 72, 90, 300).items()):
        circles = parse_circles(chars, y)
        if not circles:
            continue
        label = re.sub(r'\s+', ' ', label).strip()
        # The left margin carries rotated caption text, one glyph per row; a real
        # FUNCTIONS label is at least three characters and starts with a letter.
        if len(label) < 3 or not label[0].isalpha():
            continue
        split = next((i for i, c in enumerate(circles) if c['word'] == 'EMER'), None)
        if split is not None:
            funcs.append({'label': label, 'color': colour, 'y': y,
                          'circles': circles[:split + 1]})
            funcs.append({'label': 'EMER', 'color': colour, 'y': y,
                          'circles': circles[split + 1:]})
        else:
            funcs.append({'label': label, 'color': colour, 'y': y, 'circles': circles})
    ship['functions'] = funcs

    # ------------------------------------------------------- POWER SYSTEM
    power = []
    for y, (label, _) in sorted(label_rows(chars, 0, 80, 300, 415).items()):
        row = sorted([c for c in gl if abs(c['y'] - y) <= 5 and 60 < c['x'] < 270],
                     key=lambda c: c['x'])
        pts, boxes = [], 0
        for c in row:
            if not c['font'].startswith('Wingdings'):
                continue
            if c['o'] in (FILLED, CIRCLE):
                pts.append(0)
            elif c['o'] == BOX:
                boxes += 1
                if pts:
                    pts[-1] += 1
        # The FTL DRV row is damage boxes only — it produces no power point.
        if pts or boxes:
            power.append({'label': re.sub(r'\s+', ' ', label).strip(),
                          'points': pts, 'boxes': boxes})
    ship['power'] = power

    # ------------------------------------------------------------ SUBLIGHT
    m = re.search(r'MAX ACC\s*/PHS:\s*(\d+)', text)
    if m:
        ship['maxAccelPerPhase'] = int(m.group(1))
    for y, (label, _) in sorted(label_rows(chars, 0, 120, 440, 470).items()):
        if not label.startswith('MAX ACC'):
            continue
        rnd = [c for c in gl if abs(c['y'] - y) <= 5 and c['x'] > 140
               and c['font'].startswith('Wingdings') and c['o'] in (CIRCLE, FILLED)]
        ship['safeAccel'] = sum(1 for c in rnd if c['color'] == C_GREEN)
        ship['stressAccel'] = sum(1 for c in rnd if c['color'] == C_RED)

    def numeric_row(prefix, y0, y1):
        for y, (label, _) in sorted(label_rows(chars, 0, 60, y0, y1).items()):
            if label.replace(' ', '').startswith(prefix):
                cs = sorted([c for c in gl if abs(c['y'] - y) <= 5 and 45 < c['x'] < 265
                             and c['font'].startswith('Arial')], key=lambda c: c['x'])
                vals, cur, last = [], '', None
                for c in cs:
                    if not c['ch'].isdigit():
                        continue
                    if last is not None and c['x'] - last > 6 and cur:
                        vals.append(int(cur)); cur = ''
                    cur += c['ch']; last = c['x1']
                if cur:
                    vals.append(int(cur))
                return vals, y
        return [], None

    ship['spd'], spd_y = numeric_row('SPD', 470, 492)
    if spd_y is not None:
        cs = sorted([c for c in gl if abs(c['y'] - spd_y) <= 5 and 45 < c['x'] < 265
                     and c['font'].startswith('Arial') and c['ch'].isdigit()], key=lambda c: c['x'])
        cols, cur, last = [], None, None
        for c in cs:
            if last is not None and c['x'] - last > 6:
                cur = None
            if cur is None:
                cols.append({'x': c['x'], 'v': c['ch']})
                cur = cols[-1]
            else:
                cur['v'] += c['ch']
            last = c['x1']
        ship['_spdCols'] = [{'x': c['x'], 'speed': int(c['v'])} for c in cols]
    ship['turn'], _ = numeric_row('TURN', 486, 505)
    for y, (label, _) in sorted(label_rows(chars, 0, 60, 458, 478).items()):
        if label.replace(' ', '').startswith('DMG'):
            boxes = sorted([c for c in gl if abs(c['y'] - y) <= 5 and 45 < c['x'] < 265
                            and c['font'].startswith('Wingdings') and c['o'] == BOX],
                           key=lambda c: c['x'])
            ship['driveBoxes'] = len(boxes)
            ship['_driveBoxX'] = [c['x'] for c in boxes]

    # ------------------------------------------------------------- SHIELDS
    shields, armor = {}, {}
    for key, label in (('F', 'FWD SHIELD'), ('A', 'AFT SHIELD'),
                       ('P', 'PORT SHIELD'), ('S', 'STBD SHIELD')):
        m = (re.search(re.escape(label) + r'\s+(\d+)', text)
             or re.search(r'(\d+)\s+' + re.escape(label), text))
        shields[key] = int(m.group(1)) if m else 0
    ship['shields'] = shields

    mid = [c for c in gl if 270 < c['x'] < 520 and c['font'].startswith('Wingdings') and c['o'] == BOX]
    ship['_blue'] = sum(1 for c in mid if c['color'] == C_BLUE)
    ship['_green'] = sum(1 for c in mid if c['color'] == C_GREEN)
    ship['_armor'] = sum(1 for c in mid if c['color'] in ARMOR_COLORS)
    # The window reaches 420, not 400, and the twenty points are a bug fix:
    # the SHIELD GEN label drifts a few points page to page, and on the
    # Soryu I the final N of GEN starts at x=402.3 — one clipped letter made
    # the label read "SHIELD GE", the match fail, and the frigate lose its
    # printed two-box generator. Found by a player. The generator boxes
    # themselves are Wingdings and label_rows keeps only Arial, so the wider
    # window cannot miscount them.
    for y, (label, _) in sorted(label_rows(chars, 300, 420, 100, 140).items()):
        if 'SHIELD GEN' in label:
            ship['shieldGen'] = sum(1 for c in gl if abs(c['y'] - y) <= 6 and c['x'] > 395
                                    and c['font'].startswith('Wingdings') and c['o'] == BOX)

    # ------------------------------------------------------------- SYSTEMS
    # Aurelian forms carry a CLOAK row that sits a line lower than the deepest
    # Union or Vallari systems block, so the window reaches to 492.
    systems = {}
    for cs in cluster_rows([c for c in gl if 270 <= c['x'] <= 505 and 420 <= c['y'] <= 492]):
        cs.sort(key=lambda c: c['x'])
        current = None
        buf = ''
        for c in cs:
            if c['font'].startswith('Arial') and c['ch'].isalpha():
                buf += c['ch']
            elif c['font'].startswith('Wingdings') and c['o'] == BOX:
                if buf:
                    current = buf; buf = ''
                if current:
                    systems[current] = systems.get(current, 0) + 1
        # A trailing label with no boxes means a zero-box system; ignore it.
    ship['systems'] = systems

    # ------------------------------------------------- SCOUT SENSORS (H3.1)
    # Scout ships print a yellow SCOUT SENSOR block beneath the FUNCTIONS list.
    # It holds one green power circle and one damage box per scout sensor, and
    # three range numbers under the targeting, jamming and scan icons, in that
    # left-to-right order (H3.4.2, H3.5.2, H3.6.1).
    if any(f['label'].startswith('SCOUT SEN') for f in funcs):
        block = [c for c in gl if 240 <= c['y'] <= 300 and c['x'] < 280]
        sensors = sum(1 for c in block
                      if c['font'].startswith('Wingdings') and c['o'] == CIRCLE)
        boxes = sum(1 for c in block
                    if c['font'].startswith('Wingdings') and c['o'] == BOX)
        digits = [c for c in block if c['font'].startswith('Arial') and c['ch'].isdigit()
                  and c['y'] > 262]
        ranges = [int(n) for _, n in group_numbers(digits)]
        ship['scoutSensor'] = {
            'sensors': sensors,
            'damageBoxes': boxes,
            'targetingRange': ranges[0] if len(ranges) > 0 else None,
            'jammingRange': ranges[1] if len(ranges) > 1 else None,
            'scanRange': ranges[2] if len(ranges) > 2 else None,
        }

    # ----------------------------------------------------------- STRUCTURE
    struct = sorted([c for c in gl if c['y'] > 500 and
                     ((c['font'].startswith('Wingdings') and c['o'] == BOX) or
                      (c['font'].startswith('Arial') and c['ch'].isdigit()
                       and c['color'] == C_BLACK and c['x'] < 470))],
                    key=lambda c: c['x'])
    ship['structure'] = [
        {'kind': 'box', 'color': 'red' if c['color'] == C_RED else 'black'}
        if c['font'].startswith('Wingdings') else {'kind': 'dc', 'rating': int(c['ch'])}
        for c in struct]

    # ------------------------------------------- SHUTTLES AND MARINE SQUADS
    # Two badges sit under the systems block: a rocket (taller than wide) for
    # shuttles and two soldiers (wider) for marine squads, each with its count
    # printed immediately to its right (B1.7.1, B1.7.2).
    badges = []
    for info in page.get_image_info(xrefs=True):
        w, h, b = info['width'], info['height'], info['bbox']
        # The height bound reaches 70 because the Aurelian book (Expansion 5)
        # draws a taller rocket than the master book: 38x65 against 28x51,
        # while both draw the same 40x47 soldiers. At h <= 60 the Aurelian
        # rocket was rejected, only one badge survived, and it was taken as
        # the shuttle count by position — which is why all twenty-one
        # Aurelian hulls read as 0 marines and carried their marine squads in
        # the shuttle field. The Empire has marines, and not 28 shuttles.
        if not (470 <= b[1] <= 545 and 20 <= w <= 60 and 30 <= h <= 70):
            continue
        digits = sorted([c for c in gl if abs(c['y'] - b[1]) <= 8 and c['ch'].isdigit()
                         and b[2] <= c['x'] <= b[2] + 26], key=lambda c: c['x'])
        if digits:
            badges.append((b[0], int(''.join(c['ch'] for c in digits))))
    badges.sort()
    if badges:
        ship['shuttles'] = badges[0][1]
    if len(badges) > 1:
        ship['marines'] = badges[1][1]

    # ------------------------------------------------------------- WEAPONS
    ship['weapons'] = parse_weapons(page, chars, gl)
    return ship


def endurance_boxes(page):
    """
    Red rectangles drawn around range brackets in the weapons column.

    E5.1.5: "Each range bracket of a homing weapon will have a thick red boxed
    outline. Each red box equals 1 phase of movement." So the boxes are the
    weapon's endurance, and which brackets fall inside which box gives the
    distance it covers in that phase.
    """
    out = []
    for dr in page.get_drawings():
        colour = dr.get('color')
        if not colour or dr.get('width', 0) < 1.2:
            continue
        if not (colour[0] > 0.8 and colour[1] < 0.3 and colour[2] < 0.3):
            continue
        r = dr['rect']
        if r.x0 < 500 or r.y0 > 500 or r.width < 15 or r.width > 200 or r.height > 40:
            continue
        out.append({'x0': r.x0, 'x1': r.x1, 'y0': r.y0, 'y1': r.y1})
    out.sort(key=lambda b: (round(b['y0'] / 8), b['x0']))
    return out


def parse_weapons(page, chars, gl):
    right = [c for c in gl if c['x'] > 500 and c['y'] < 500]
    boxes = endurance_boxes(page)
    rows = defaultdict(list)
    for c in right:
        rows[round(c['y'] / 4.0)].append(c)
    for k in rows:
        rows[k].sort(key=lambda c: c['x'])

    heads = []
    for k in sorted(rows, key=lambda k: rows[k][0]['y']):
        cs = rows[k]
        # The ship title shares this column on Aurelian forms, and is set in the
        # same purple as the section bands, so skip everything above the bands.
        if cs[0]['y'] < 45:
            continue
        if cs[0]['color'] in HEADER_COLORS and cs[0]['font'].startswith('Arial') and cs[0]['size'] >= 9.5:
            t = row_text(chars, cs[0]['y'], 3, 500).strip()
            if t and 'WEAPONS' not in t:
                heads.append((cs[0]['y'], re.sub(r'\s+', ' ', t)))

    icons = arc_icons(page)
    out = []
    for idx, (y0, name) in enumerate(heads):
        y1 = heads[idx + 1][0] if idx + 1 < len(heads) else 1e9
        seg = [c for c in right if y0 - 3 <= c['y'] < y1 - 3]

        arming = sorted([c for c in seg if c['font'].startswith('Wingdings')
                         and c['o'] in (CIRCLE, FILLED, DIAMOND)], key=lambda c: c['x'])
        hits = sorted([c for c in seg if c['font'].startswith('Wingdings')
                       and c['o'] == BOX and c['color'] == C_BLACK], key=lambda c: c['x'])

        # Range brackets and their bands.
        brackets = []
        for k in sorted(rows, key=lambda k: rows[k][0]['y']):
            cs = rows[k]
            if not (y0 <= cs[0]['y'] < y1) or not cs[0]['font'].startswith('Calibri'):
                continue
            for toks in group_by_gap(cs, 4):
                lab = ''.join(c['ch'] for c in toks).strip()
                m = re.match(r'^(\d+)\s*[-–]\s*(\d+)$', lab)
                if not m:
                    continue
                f = toks[0]
                bandname = ('green' if f['color'] == C_GREEN
                            else 'red' if ('Italic' in f['font'] or f['color'] == C_RED)
                            else 'black')
                brackets.append({'min': int(m.group(1)), 'max': int(m.group(2)),
                                 'band': bandname, 'dice': [], 'bonus': 0,
                                 'x0': toks[0]['x'], 'x1': toks[-1]['x1']})
        brackets.sort(key=lambda b: b['min'])

        # Attack dice, assigned to the bracket whose column they sit under.
        for die in sorted([c for c in seg if c['font'] == 'Wingdings2' and c['o'] in DIE_BY_GLYPH],
                          key=lambda c: c['x']):
            if not brackets:
                break
            inside = [b for b in brackets if b['x0'] - 8 <= die['x'] <= b['x1'] + 8]
            b = inside[0] if inside else min(brackets, key=lambda b: abs((b['x0'] + b['x1']) / 2 - die['x']))
            b['dice'].append(DIE_BY_GLYPH[die['o']])

        # Bonus damage: "+N" printed just left of a bracket's attack dice (E4.3).
        # It is set in Arial on Union and Vallari forms and Calibri on Aurelian
        # ones, and the digit sits flush against the plus, so the only reliable
        # discriminator is the row: a bonus shares the dice row, while the plus
        # signs in "SPCL: 4 DMG, LEAK+1, STR+1" sit a line below.
        dice_ys = [c['y'] for c in seg if c['font'] == 'Wingdings2' and c['o'] in DIE_BY_GLYPH]
        dice_y = min(dice_ys) if dice_ys else None
        for c in seg:
            if c['ch'] != '+' or dice_y is None or abs(c['y'] - dice_y) > 4:
                continue
            nxt = [d for d in seg if abs(d['y'] - c['y']) < 0.5
                   and -1 <= d['x'] - c['x1'] < 8 and d['ch'].isdigit()]
            if not nxt or not brackets:
                continue
            b = min(brackets, key=lambda b: abs(b['x0'] - c['x']))
            b['bonus'] = int(nxt[0]['ch'])

        # Tag each bracket with the red endurance box it sits in (E5.1.5). The
        # boxes are numbered left to right, one per phase of homing movement.
        block_boxes = [b for b in boxes if y0 <= b['y0'] < y1]
        for b in brackets:
            cx = (b['x0'] + b['x1']) / 2
            for n, box in enumerate(block_boxes, start=1):
                if box['x0'] - 2 <= cx <= box['x1'] + 2:
                    b['endurancePhase'] = n
                    break

        blob = ' '.join(row_text(chars, rows[k][0]['y'], 3, 500) for k in sorted(rows)
                        if y0 <= rows[k][0]['y'] < y1)
        spcl = re.search(r'SPCL:\s*(.*?)(?:\s*TRAIT:|$)', blob)
        trait = re.search(r'TRAIT:\s*([^\n]*)', blob)

        block_icons = [i for i in icons if y0 - 22 <= i['y'] < y1 - 22]

        # Each mount is anchored on its firing-arc icon; arming circles, gates
        # and hit boxes belong to whichever anchor they sit under. Gap-splitting
        # alone is unreliable because slow-arm diamonds close the gaps.
        if block_icons:
            anchors = [i['cx'] for i in block_icons]
        else:
            anchors = [g[0]['x'] for g in group_by_gap(hits, 9)] or [500.0]

        def bucket(items):
            out = [[] for _ in anchors]
            for c in items:
                k = min(range(len(anchors)), key=lambda i: abs(anchors[i] - c['x']))
                out[k].append(c)
            return out

        arm_b = bucket(arming)
        hit_b = bucket(hits)

        mounts = []
        for i in range(len(anchors)):
            g = sorted(arm_b[i], key=lambda c: c['x'])
            circles = [c for c in g if c['o'] in (CIRCLE, FILLED)]
            gates, seen = [], 0
            for c in g:
                if c['o'] in (CIRCLE, FILLED):
                    seen += 1
                elif c['o'] == DIAMOND and seen > 0:
                    gates.append(seen - 1)
            mounts.append({
                'armingCircles': max(1, len(circles)),
                'hitBoxes': max(1, len(hit_b[i])),
                'gates': gates,
                'arcs': block_icons[i]['arcs'] if i < len(block_icons) else [],
            })

        out.append({
            'name': name,
            'mounts': mounts,
            'brackets': [{k: b[k] for k in ('min', 'max', 'band', 'dice', 'bonus')}
                         | ({'endurancePhase': b['endurancePhase']} if 'endurancePhase' in b else {})
                         for b in brackets],
            'spcl': spcl.group(1).strip() if spcl else None,
            'traits': dedupe([t.strip() for t in re.split(r'[,•]', trait.group(1)) if t.strip()])
            if trait else [],
        })
    return out


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'all':
        ships = []
        for pno in range(6, len(doc)):
            try:
                s = parse_ship(pno)
            except Exception as e:
                print(f'page {pno+1}: ERROR {e}', file=sys.stderr); continue
            if s and s.get('weapons') and s.get('structure'):
                ships.append(s)
        json.dump(ships, open('ships_raw.json', 'w'), indent=1)
        print(f'extracted {len(ships)} ships')
    else:
        pno = int(sys.argv[1]) - 1 if len(sys.argv) > 1 else 6
        print(json.dumps(parse_ship(pno), indent=1))
