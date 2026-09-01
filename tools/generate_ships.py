"""
Turn the extracted ship forms into src/data/ships.json.

Reads `ships_raw.json` (the Master Ship Book) and, if present,
`aurelian_raw.json` (the Expansion 5 Aurelian Starship Book), and writes one
combined roster.
"""
import difflib, json, os, re, sys
from collections import defaultdict

S = json.load(open('ships_raw.json'))
# Union forms come first in the Master Ship Book, Vallari after; the Master
# Ship List uses the same split.
for _s in S:
    _s['faction'] = 'union' if _s['page'] <= 44 else 'vallari'

if os.path.exists('aurelian_raw.json'):
    for _s in json.load(open('aurelian_raw.json')):
        _s['faction'] = 'aurelian'
        # Keep the book of origin so page references stay meaningful.
        _s['book'] = 'aurelian'
        S.append(_s)

# "Civilians, Support and Pirates" — now titled Expansion 6, draft v2
# ("Traders, Freighters and Pirates", Sep 2026), superseding the v21 draft
# this pipeline first imported; the internal book tag stays 'exp7'.
# Freighters, military transports and stations, twenty sheets: the v21 nine
# (BASTION and VIGILANT re-issued as BASTION I/II and SENTINEL II/III) plus
# the O'NEIL habitat, GALILEO I, the GUARDIAN and CUTLASS defense
# satellites, and the Vallari TORTUGA outposts and BLACKREACH
# battlestations. The draft has no Master Ship List, so each form's own
# printed corner (year, availability) is its row. Point values: the draft
# prints two ("(PV6)" in the MAERSK banner, "(Point Value 100)" on the
# BASTION I sheet); the rest come from the design-tool point model via
# exp7_pv.json (written by `npx vite-node tools/price_exp7.ts` — run
# generate, price, generate again).
if os.path.exists('exp7_raw.json'):
    # Vallari sheets are the V- classes plus the named pirate-frontier
    # stations; everything else in the draft flies Union colors.
    _VALLARI = ('V-', 'CUTLASS', 'TORTUGA', 'BLACKREACH')
    for _s in json.load(open('exp7_raw.json')):
        _s['faction'] = 'vallari' if _s['name'].upper().startswith(_VALLARI) else 'union'
        _s['book'] = 'exp7'
        exp7_errata = []
        # The banner's printed point value is identity, not name.
        cleaned = re.sub(r'\s*\(PV\s*\d+\)', '', _s['name']).strip()
        if cleaned != _s['name']:
            _s['name'] = cleaned
        if 'V-6H' in _s['name']:
            # The draft's weapons panel carries only the TYPE-29 — the notes
            # say the class "did not receive heavy weapons" — but the
            # FUNCTIONS list still prints the template's A/MAT TRP and T-37
            # arming lines. Stale lines are dropped so the TYPE-29's own line
            # (1 free, 4 purchased) arms it.
            before = len(_s['functions'])
            _s['functions'] = [f for f in _s['functions']
                               if f['label'] not in ('A/MAT TRP', 'T-37 DISR')]
            if len(_s['functions']) != before:
                exp7_errata.append(
                    'Draft prints arming lines for A/MAT TRP and T-37 DISR but no such '
                    'weapons are on the form (the notes say the class received no heavy '
                    'weapons); the stale lines are dropped.')
        # The "27/2 PHASER" banner sits beside the rotated STBD SHIELD value
        # and bleeds into it; the drawn boxes and the plot say 8 and 10.
        if _s['name'].startswith('HORIZON') and _s['shields'].get('S') == 27:
            _s['shields']['S'] = 8
            exp7_errata.append('STBD SHIELD read 27 from the weapon banner; the drawn boxes say 8.')
        if _s['name'].startswith('WARFARER') and _s['shields'].get('S') == 27:
            _s['shields']['S'] = 10
            exp7_errata.append('STBD SHIELD read 27 from the weapon banner; the drawn boxes say 10.')
        # Where the wrench icon and the structure strip's opening DC marker
        # disagree (GALILEO II prints wrench 2 over a 3-2-1 strip; V-6H
        # wrench 1 over 2-1), the STRIP is the bookkeeping the game is
        # played on — the engine reads the markers — so the rating follows
        # its opening marker. One for Doyle to settle.
        first_dc = next((e['rating'] for e in _s['structure'] if e['kind'] == 'dc'), None)
        if first_dc is not None and first_dc != _s.get('damageControl'):
            exp7_errata.append(
                f"Draft prints Damage Control {_s.get('damageControl')} in the wrench but the "
                f"structure strip opens at {first_dc}; the strip is used.")
            _s['damageControl'] = first_dc
        if _s['name'].startswith('BASTION I-class'):
            # The "(Point Value 100)" note sits on THIS sheet, but it is the
            # v21 BASTION's note carried along when the sheet was cloned —
            # that design (power 9, MK-5/LNC-500/DGR-12A) is now the BASTION
            # II, and the model prices it at ~100 while pricing this
            # lighter Mark I at 40.5. The printed 100 rides with the Mark II.
            exp7_errata.append(
                "Sheet prints '(Point Value 100)' — inherited from the v21 BASTION this sheet "
                'was cloned from, which is now the BASTION II. This Mark I is priced by the '
                'model (40.5); one for Doyle to settle.')
        if _s['name'].startswith('BASTION II'):
            exp7_errata.append(
                'Point Value 100 as the draft prints (the note sits on the Mark I sheet, but '
                'describes this design — the v21 BASTION re-issued).')
        if _s['name'].startswith('SENTINEL'):
            # v21's VIGILANT carried this defect and its v2 successors keep
            # it: the sheet prints TOTAL POWER 5 but draws 2+2+1+1 = 6
            # reactor points. The drawn boxes are the bookkeeping the game
            # is played on; one for Doyle to settle.
            _s['powerMismatchOk'] = True
            exp7_errata.append(
                'Draft prints TOTAL POWER 5 but draws six reactor power points '
                '(L MAIN 2, R MAIN 2, SL REAC 1, AUX PWR 1); the drawn reactors are used.')
        if exp7_errata:
            _s['exp7Errata'] = exp7_errata
        S.append(_s)

EXP7_PV = json.load(open('exp7_pv.json')) if os.path.exists('exp7_pv.json') else {}
# The two prices the draft itself prints. The 100 is keyed to the BASTION II:
# the note sits on the Mark I sheet but describes the v21 BASTION that sheet
# was cloned from, which v2 re-issues as the Mark II (see the errata above).
EXP7_PRINTED_PV = {'MAERSK': 6.0, 'BASTION II': 100.0}


def exp7_msl_row(ship):
    """A pseudo-MSL row for a book with no list: the form's own corner, and
    the SYST BOXES aggregate summed from the form the way the real list's
    column was verified to sum (internal boxes + the structure track)."""
    internal = 0
    for row in ship['power']:
        if row['label'].startswith('BATTERY'):
            internal += len(row['points'])
        elif row['label'].startswith('FTL'):
            internal += row.get('boxes', 0)
        else:
            internal += sum(row['points'])
    internal += ship.get('driveBoxes', 0)
    internal += sum(ship['systems'].values())
    internal += ship.get('shieldGen', 0)
    for w in ship['weapons']:
        internal += sum(m['hitBoxes'] for m in w['mounts'])
    printed = next((v for k, v in EXP7_PRINTED_PV.items() if ship['name'].startswith(k)), None)
    pv = printed if printed is not None else EXP7_PV.get(ship['name'], 0)
    return {'pointValue': pv,
            'year': ship.get('year') or 3660,
            'availability': ship.get('availability') or 'common',
            'systemBoxes': internal + ship['strCount'],
            'structure': ship['strCount']}

# Rows flagged for a later expansion stay in the matching pool: a few of them
# already have forms in this book, and dropping the row made the fuzzy match
# hand the form its predecessor's point value.
M = json.load(open('msl.json'))

# Doyle's hit-point-based damage levels (Aug 2026, "MASTER SHIP LIST UNION UFS
# Hit Point BASED DMG LEVELS"). Damage levels are no longer fractions of the
# structure track alone: they are measured in *hit points*, where every marked
# box on the internal damage chart is one hit point and every marked structure
# box is two. The sheet's basis is its printed SYST BOXES + STR columns — and
# SYST BOXES already includes the structure track (verified by summing the
# forms across the roster), which is where structure's double weight comes
# from. The thresholds, verified exactly against all 37 Union rows:
#
#   LIGHT  = (SYST BOXES + STR) / 4      MINOR = LIGHT - 1
#   MOD    = 2 x LIGHT     HVY = 3 x LIGHT     CRIP = 3.6 x LIGHT
#
# with the same victory percentages as before (10/25/50/75/90% of PV). The
# sheet only covers the Union, but the formula runs on columns every faction's
# MSL row carries, so the whole roster moves together. Union point values are
# taken from the sheet (a handful moved: UNION 50 -> 50.4, XERXES II 24 ->
# 23.5, ...); the other factions keep their MSL values until Doyle re-lists
# them.
HP_MSL = json.load(open('union_hp_msl.json')) if os.path.exists('union_hp_msl.json') else []


def victory_table(point_value, system_boxes, structure):
    light = (system_boxes + structure) / 4
    bands = [(light - 1, 0.1), (light, 0.25), (2 * light, 0.5),
             (3 * light, 0.75), (3.6 * light, 0.9)]
    return [{'damage': round(damage, 2), 'points': round(point_value * fraction, 1)}
            for damage, fraction in bands]

for _s in S:
    _s['strCount'] = sum(1 for e in _s['structure'] if e['kind'] == 'box')

STANDARD = {'ACC/DEC', 'SIF/IDF', 'SIF', 'EMER', 'BTY RECH', 'FTL DRV',
            'SHLD RNFC', 'SHLD REPR', 'SENSOR', 'GEN SYS'}
SPECIAL = {'SCOUT SEN', 'CLOAK', 'CLK'}

FUNCTION_KIND = {
    'ACC/DEC': 'accel', 'SIF/IDF': 'sif', 'SIF': 'sif', 'EMER': 'emergency-turn',
    'BTY RECH': 'battery-recharge', 'FTL DRV': 'ftl-drive', 'SENSOR': 'sensor',
    'GEN SYS': 'gen-sys',
}

REACTOR_KIND = {'L MAIN': 'left-main', 'R MAIN': 'right-main', 'C MAIN': 'center-main',
                'SL REAC': 'sublight-reactor', 'AUX PWR': 'aux'}

SYSTEM_LABEL = {'SCNC': 'Sciences', 'SENS': 'Sensors', 'TRAC': 'Tractor Beams',
                'TRAN': 'Transporters', 'SHTL': 'Shuttle Bay', 'QTRS': 'Quarters',
                'CRGO': 'Cargo', 'CMND': 'Command Systems', 'HNGR': 'Hangar Bay',
                'PROB': 'Probe Launcher', 'SPCL': 'Special System',
                'CLOAK': 'Cloaking System'}

FACTION_NAME = {'union': 'Union of Federated Systems', 'vallari': 'Vallari Imperium',
                'aurelian': 'Aurelian Empire'}

# Errata: places where the printed form is internally inconsistent. Each entry
# is keyed by (ship name fragment, weapon name) and is applied after extraction,
# with the reason recorded on the generated form.
ERRATA = [
    {
        'ship': 'V-6N SAVAGE', 'weapon': 'G-YAGUS A/MAT TORPEDO',
        'note': ('Ship Book prints range brackets "0-4 5-10 9-15 16-20"; the third '
                 'bracket overlaps the second. Read as 11-15 so the chart is continuous.'),
        'fix': lambda w: [b.update({'min': 11}) for b in w['brackets'] if b['min'] == 9 and b['max'] == 15],
    },
    {
        # Ship Book 5 carries the same copy-paste forward into the refit.
        'ship': 'INVICTUS II-class', 'weapon': 'RP-B MEDIUM PLASMA TORP',
        'note': ('Ship Book 5 prints "TRAIT: PREC 1, PD MODE, ATMO" on this plasma '
                 'torpedo — a disruptor block\'s trait line. The same weapon reads '
                 '"HOMING 3, PARTCL, NoBAT, FTL" everywhere else it appears.'),
        'fix': lambda w: w.__setitem__('traits', ['HOMING 3', 'PARTCL', 'NoBAT', 'FTL']),
    },
    {
        'ship': 'INVICTUS I-class', 'weapon': 'RP-B MEDIUM PLASMA TORP',
        'note': ('Aurelian Starship Book prints "TRAIT: PREC 1, PD MODE, ATMO" on this '
                 'plasma torpedo — the trait line of the disruptor block below it. The '
                 'same weapon reads "HOMING 3, PARTCL, NoBAT, FTL" on all eight other '
                 'ships that carry it, and F5.4 gives those as the standard traits.'),
        'fix': lambda w: w.__setitem__('traits', ['HOMING 3', 'PARTCL', 'NoBAT', 'FTL']),
    },
]

# Forms whose printed shield strengths do not match the number of shield boxes
# drawn on them. The printed number is what the rules quote ("FWD SHIELD 6"), so
# it is what the engine uses; the box count is recorded here so the validator
# stays honest rather than being loosened.
SHIELD_BOX_ERRATA = {
    'PASSER II-class Frigate': (21,
        'Form prints FWD SHIELD 6 but draws 7 forward shield boxes (20 printed, 21 drawn). '
        'The printed strengths are used.'),
    'CORVUS I-class Destroyer': (48,
        'Form prints AFT SHIELD 12 but draws 10 aft shield boxes (50 printed, 48 drawn). '
        'The printed strengths are used.'),
    # Ship Book 5 carries the CORVUS I's art defect forward into its refit.
    'CORVUS II-class Destroyer': (58,
        'Form prints AFT SHIELD 12 but draws 10 aft shield boxes (60 printed, 58 drawn). '
        'The printed strengths are used.'),
    # Draft v2 raised the GALILEO II's shields (18/16/16/16, was 14/12/12/12)
    # but the drawn tracks did not grow with the banner.
    'GALILEO II-class Transport': (60,
        'Form prints shields 18/16/16/16 (66) but draws 60 shield boxes. '
        'The printed strengths are used.'),
}


# Structure strips whose DC markers are printed in the wrong order. Every
# multi-DC form descends left to right (CORVUS II: "…2 …1"; INVICTUS II:
# "…4 …3 …2 …1") because marking damage left to right must never *raise* the
# rating (B3.1.2) — and both new PASSER forms print "…1 …2" while their own
# wrench icon says the fresh-hull rating is 2. The markers are swapped in
# place, and the note travels on the form.
STRUCTURE_DC_SWAP = {
    'PASSER III-class Frigate':
        'Form prints the structure strip DC markers ascending ("…1 …2") where '
        'every other form descends and the printed Damage Control Rating is 2. '
        'The markers are read as "…2 …1".',
    'PASSER IV-class Frigate':
        'Form prints the structure strip DC markers ascending ("…1 …2") where '
        'every other form descends and the printed Damage Control Rating is 2. '
        'The markers are read as "…2 …1".',
}


# The INVICTUS II prints Damage Control 5 in the wrench and a structure strip
# of 4-3-2-1 — the strip is box-for-box the INVICTUS I's, on a refit where
# every other number went up, so the strip reads as the copy-paste and the
# wrench as the intent. The quoted number beats the drawn boxes here for the
# same reason it does on the CORVUS shields: the rating is what the rules
# read (B1.3.4), the strip is the bookkeeping drawn under it. One for Doyle
# to confirm.
STRUCTURE_DC_OVERRIDE = {
    'INVICTUS II-class Dreadnought': ([5, 4, 3, 2],
        'Form prints Damage Control 5 but a structure strip of 4-3-2-1, '
        'identical to the INVICTUS I\'s. The wrench is read as the intent and '
        'the strip as 5-4-3-2.'),
}


def apply_errata(ship):
    notes = []
    for e in ERRATA:
        if e['ship'] not in ship['name']:
            continue
        for w in ship['weapons']:
            if w['name'] == e['weapon']:
                e['fix'](w)
                notes.append(e['note'])
    known = SHIELD_BOX_ERRATA.get(ship['name'])
    if known:
        notes.append(known[1])
    override = STRUCTURE_DC_OVERRIDE.get(ship['name'])
    if override:
        ratings, note = override
        dcs = [e for e in ship['structure'] if e['kind'] == 'dc']
        for e, r in zip(dcs, ratings):
            e['rating'] = r
        notes.append(note)
    swap = STRUCTURE_DC_SWAP.get(ship['name'])
    if swap:
        dcs = [e for e in ship['structure'] if e['kind'] == 'dc']
        ratings = sorted((e['rating'] for e in dcs), reverse=True)
        for e, r in zip(dcs, ratings):
            e['rating'] = r
        notes.append(swap)
    return notes


def norm(s):
    return re.sub(r'[^A-Z0-9]', '', s.upper())


def hp_key(name):
    """The class identity shorn of hull-type suffixes: 'NELSON I-Class Frigate
    (FF)' and 'NELSON I-class Light Frigate' are the same ship."""
    s = re.sub(r'\((DN|CB|CH|CC|CCL|CL|CE|CS|DD|DS|FF)\)', '', name, flags=re.I)
    m = re.match(r'(.*?)[\s-]+class\b', s, flags=re.I)
    key = norm(m.group(1) if m else s)
    # The sheet writes the first of the line bare: "UNION-Class" is the UNION I.
    if not re.search(r'(I|II|III|IV|V|VI)$|[0-9][A-Z]*$', key):
        key += 'I'
    return key


HP_BY_KEY = {hp_key(h['class']): h for h in HP_MSL}


def match_msl(ship):
    # An exact class-name match outranks everything. The year+structure filter
    # exists for rows whose names drifted between printings, but it backfires
    # when the *list* is stale: the Exp 5 MSL announced the INVICTUS II with
    # 18 structure and the printed form arrived with 20, so the filter found
    # nothing, fell back to fuzzy, and handed the II its predecessor's 75
    # points instead of its own 158. The name, minus the "(Exp 6)" flag, is
    # not ambiguous; trust it first.
    target = norm(ship['name'])
    exact = [m for m in M if m['faction'] == ship['faction']
             and norm(re.sub(r'\(EXP ?6\)', '', m['class'], flags=re.I)) == target]
    if len(exact) == 1:
        return exact[0]
    cands = [m for m in M if m['faction'] == ship['faction'] and m['year'] == ship['year']
             and m['structure'] == ship['strCount']]
    if not cands:
        cands = [m for m in M if m['faction'] == ship['faction']]
    if len(cands) == 1:
        return cands[0]
    return max(cands, key=lambda m: difflib.SequenceMatcher(None, target, norm(m['class'])).ratio())


def slug(name):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', name.lower())).strip('-')


# The forms abbreviate on the FUNCTIONS list what the weapon panels spell out.
LABEL_EXPANSIONS = {
    'HVY': 'HEAVY', 'MED': 'MEDIUM', 'LT': 'LIGHT', 'SML': 'SMALL',
    'PLAS': 'PLASMA', 'DISR': 'DISRUPTOR', 'TORP': 'TORPEDO', 'PHSR': 'PHASER',
}


def claim_weapon_for_label(ship, label, claimed, name_first):
    """The weapon a FUNCTIONS line arms.

    Two forms lie in two different ways, and each exposes the other's fix:

     - The AQUILA BELLUM VI *omits* a line (no SML PLAS row), so ordinal
       matching slides every later line one weapon up — the medium disruptor's
       line armed the small plasma. Names catch it.
     - The INVICTUS I *mislabels* a line ("MED DISR" printed where MED PLAS is
       meant — the circle counts match its plasma, not its disruptor), so name
       matching cross-links two weapons ordinal had right.

    The tell is the count. When every weapon has a line, print order is the
    author's own pairing and the labels are decoration; only when lines are
    missing has the order come apart, and then the names are what is left."""
    if not name_first:
        pick = next((i for i in range(len(ship['weapons'])) if i not in claimed), None)
        if pick is None:
            return None
        claimed.add(pick)
        return pick
    tokens = [LABEL_EXPANSIONS.get(t, t) for t in re.split(r'[\s/]+', label.upper()) if t]
    scored = []
    for i, w in enumerate(ship['weapons']):
        if i in claimed:
            continue
        name = ' ' + w['name'].upper() + ' '
        expanded = name
        for short, long in LABEL_EXPANSIONS.items():
            expanded = expanded.replace(f' {short} ', f' {long} ')
        if all(t in expanded for t in tokens):
            scored.append(i)
    pick = scored[0] if len(scored) == 1 else None
    if pick is None:
        # Ambiguous or no name match: the next unclaimed weapon in print order,
        # which is the behaviour every already-verified form was built with.
        pick = next((i for i in range(len(ship['weapons'])) if i not in claimed), None)
    if pick is None:
        return None
    claimed.add(pick)
    return pick


def build(ship):
    msl = exp7_msl_row(ship) if ship.get('book') == 'exp7' else match_msl(ship)
    faction = ship['faction']
    errata = apply_errata(ship) + ship.get('exp7Errata', [])

    # Hit-point-based damage levels: point value from Doyle's HP sheet where it
    # re-lists the hull (Union only, so far), the MSL otherwise; the victory
    # table computed from the printed SYST BOXES + STR aggregates either way.
    hp = HP_BY_KEY.get(hp_key(ship['name'])) if faction == 'union' else None
    point_value = hp['pointValue'] if hp else msl['pointValue']
    system_boxes = hp['systemBoxes'] if hp else msl['systemBoxes']
    hp_structure = hp['structure'] if hp else msl['structure']

    # ---- reactors, batteries, FTL boxes -----------------------------------
    reactors, batteries, ftl_boxes = [], 0, 0
    for row in ship['power']:
        label = row['label']
        if label.startswith('BATTERY'):
            batteries = len(row['points'])
        elif label.startswith('FTL'):
            ftl_boxes = row.get('boxes', 0)
        elif label in REACTOR_KIND:
            reactors.append({'id': slug(label), 'label': label, 'hitKind': REACTOR_KIND[label],
                             'points': [{'boxes': b} for b in row['points']]})

    # ---- FUNCTIONS lines ---------------------------------------------------
    weapon_lines = [f for f in ship['functions']
                    if f['label'] not in STANDARD and f['label'] not in SPECIAL]
    functions = []
    wi = 0
    claimed = set()
    name_first = len(weapon_lines) < len(ship['weapons'])
    for f in ship['functions']:
        label, circles = f['label'], f['circles']
        free = next((c for c in circles if c['free']), None)
        buys = [c for c in circles if not c['free']]

        def steps(default_seq=True):
            out = []
            for i, c in enumerate(buys):
                out.append({'powerCost': 1, 'value': c['value'] if c['value'] is not None else i + 1})
            return out

        if label in ('SHLD RNFC', 'SHLD REPR'):
            kind = 'shield-reinforce' if label == 'SHLD RNFC' else 'shield-repair'
            for c in circles:
                side = c['word'] or 'F'
                functions.append({
                    'id': f"{'rnfc' if kind == 'shield-reinforce' else 'repr'}-{side}",
                    'label': f'{label} {side}', 'kind': kind, 'freeValue': 1 if c['free'] else 0,
                    'steps': [] if c['free'] else [{'powerCost': 1, 'value': 1}],
                    'sequential': False, 'shieldSide': side})
            continue

        if label == 'GEN SYS':
            # Free power normally covers NRM; purchased circles reach MAX (J1.1).
            functions.append({'id': 'gensys', 'label': 'GEN SYS', 'kind': 'gen-sys',
                              'freeValue': 1 if free else 0,
                              'steps': [{'powerCost': 1, 'value': i + (2 if free else 1)}
                                        for i in range(len(buys))],
                              'sequential': True})
            continue

        if label in FUNCTION_KIND:
            kind = FUNCTION_KIND[label]
            fid = {'accel': 'accel', 'sif': 'sif', 'emergency-turn': 'emer',
                   'battery-recharge': 'bat-rech', 'ftl-drive': 'ftl',
                   'sensor': 'sensor'}[kind]
            functions.append({'id': fid, 'label': label, 'kind': kind,
                              'freeValue': (free['value'] or 1) if free else 0,
                              'steps': steps(),
                              'sequential': kind not in ('emergency-turn', 'battery-recharge')})
            continue

        if label in SPECIAL:
            # SCOUT SEN's circles give the number of scout sensors each power
            # point activates, not a capability value (H3.2.1).
            functions.append({'id': slug(label), 'label': label, 'kind': 'special',
                              'freeValue': (free['value'] or 1) if free else 0,
                              'steps': steps(), 'sequential': True})
            continue

        # Weapon arming line. Matched by name first, ordinal second: the
        # AQUILA BELLUM VI's form omits its small plasma's arming line, and
        # ordinal matching then slid every later line up one weapon — MED DISR
        # armed the small plasma, LT DISR armed the medium disruptor, and the
        # light disruptor armed nothing.
        # The claimed INDEX names the weapon: twin batteries print as two
        # equal weapon dicts, and list.index() on the dict handed both
        # arming lines to the first of them (found by the BLACKREACH II's
        # paired TYPE-29s).
        wx = claim_weapon_for_label(ship, label, claimed, name_first)
        wi += 1
        functions.append({'id': f'f-{slug(label)}-{wi}', 'label': label, 'kind': 'weapon',
                          'freeValue': (free['value'] or 0) if free else 0,
                          'steps': steps(), 'sequential': True,
                          'weaponSystemId':
                              slug(ship['weapons'][wx]['name']) + f'-{wx + 1}'
                              if wx is not None else None})

    # A weapon the FUNCTIONS list never arms is a hole in the form, not a
    # free gun: E4.2.6 gives every weapon system exactly one arming line. The
    # AQUILA BELLUM VI omits its small plasma's SML PLAS row — every other
    # RP-G carrier in the book prints one — so the line is synthesized to the
    # book's own pattern: one purchased circle per mount, sequential, no free
    # value, exactly the shape TONITRUS IV prints for the same weapon.
    for i, w in enumerate(ship['weapons']):
        if i in claimed:
            continue
        mounts_n = max(1, len(w.get('mounts', [])) or 1)
        wid = slug(w['name']) + f'-{i + 1}'
        functions.append({'id': f'f-synth-{wid}', 'label': 'SML PLAS', 'kind': 'weapon',
                          'freeValue': 0,
                          'steps': [{'powerCost': 1, 'value': k + 1} for k in range(mounts_n)],
                          'sequential': True, 'weaponSystemId': wid})
        errata.append(f"Form omits an arming line for {w['name']}; one is supplied "
                      f'(one circle per mount, as its sister ships print).')
    # ---- weapons -----------------------------------------------------------
    weapons = []
    seen_ids = defaultdict(int)
    for idx, w in enumerate(ship['weapons'], start=1):
        wid = slug(w['name']) + f'-{idx}'
        spcl = None
        if w['spcl']:
            dmg = re.search(r'(\d+)\s*DMG', w['spcl'])
            leak = re.search(r'LEAK\s*\+\s*(\d+)', w['spcl'])
            stru = re.search(r'STR\s*\+\s*(\d+)', w['spcl'])
            spcl = {'damage': int(dmg.group(1)) if dmg else 0}
            if leak:
                spcl['leak'] = int(leak.group(1))
            if stru:
                spcl['structure'] = int(stru.group(1))
        mounts = []
        for mi, m in enumerate(w['mounts'], start=1):
            mount = {'id': f'{wid}-m{mi}', 'arcs': m['arcs'] or ['FS', 'FP'],
                     'armingCircles': m['armingCircles'], 'hitBoxes': m['hitBoxes']}
            if m['gates']:
                gates = [False] * max(0, m['armingCircles'] - 1)
                for g in m['gates']:
                    if 0 <= g < len(gates):
                        gates[g] = True
                mount['roundGates'] = gates
            mounts.append(mount)
        weapons.append({
            'id': wid, 'name': w['name'],
            'weaponClass': weapon_class(w['name'], w['traits']),
            'mounts': mounts,
            'brackets': [{'min': b['min'], 'max': b['max'], 'band': b['band'],
                          'dice': b['dice'] or ['blue'],
                          **({'bonus': b['bonus']} if b['bonus'] else {}),
                          # One red endurance box per phase of homing flight (E5.1.5).
                          **({'endurancePhase': b['endurancePhase']}
                             if b.get('endurancePhase') else {})}
                         for b in w['brackets']],
            **({'special': spcl} if spcl else {}),
            'traits': w['traits'],
        })

    # ---- sublight ----------------------------------------------------------
    spd = ship.get('spd') or [0]
    turn = ship.get('turn') or []
    max_speed = max(spd)
    turn_by_speed = [0] * (max_speed + 1)
    for i, sp in enumerate(spd):
        if 0 <= sp <= max_speed and i < len(turn):
            turn_by_speed[sp] = turn[i]

    cols = sorted(ship.get('_spdCols', []), key=lambda c: c['x'])
    boxes = sorted(ship.get('_driveBoxX', []))
    dmg_top = []
    for k in range(len(boxes)):
        nxt = k + 1
        if nxt >= len(boxes) or not cols:
            dmg_top.append(0)
        else:
            col = min(cols, key=lambda c: abs(c['x'] - boxes[nxt]))
            dmg_top.append(col['speed'])

    # ---- shields, armor, systems, structure --------------------------------
    gen = ship.get('shieldGen', 0)
    shields = {'generatorBoxes': gen,
               'blue': ship['shields'],
               'green': {k: gen for k in ('F', 'S', 'A', 'P')}}
    armor_total = ship.get('_armor', 0)
    armor = {'F': 0, 'S': 0, 'A': 0, 'P': 0}
    if armor_total:
        # The forms that carry armor spread it evenly across the four facings.
        each, extra = divmod(armor_total, 4)
        for i, side in enumerate(('F', 'P', 'S', 'A')):
            armor[side] = each + (1 if i < extra else 0)

    systems = [{'kind': k, 'label': SYSTEM_LABEL.get(k, k), 'boxes': v}
               for k, v in ship['systems'].items() if k in SYSTEM_LABEL and v]

    return {
        'id': f"{faction}-{slug(ship['name'])}",
        'name': ship['name'],
        'faction': FACTION_NAME[faction],
        'sizeClass': ship.get('sizeClass', 1),
        'stressRating': ship.get('stressRating', 1),
        'damageControlRating': ship.get('damageControl', 1),
        'reactors': reactors,
        'batteries': batteries,
        'ftlDriveBoxes': ftl_boxes,
        'functions': functions,
        'weapons': weapons,
        'shields': shields,
        'armor': armor,
        'systems': systems,
        'structure': ship['structure'],
        'sublight': {
            'maxSpeed': max_speed,
            'turnBySpeed': turn_by_speed,
            'maxAccelPerPhase': ship.get('maxAccelPerPhase', 1),
            'safeAccelPerRound': ship.get('safeAccel', 1),
            'stressAccelPerRound': ship.get('stressAccel', 0),
            'driveBoxes': ship.get('driveBoxes', len(boxes)),
            'dmgTopSpeed': dmg_top,
        },
        'marineSquads': ship.get('marines', 0),
        'shuttles': ship.get('shuttles', 0),
        'pointValue': point_value,
        'year': msl['year'],
        'availability': msl['availability'],
        'victoryTable': victory_table(point_value, system_boxes, hp_structure),
        'shipBookPage': ship['page'],
        **({'shipBook': ship['book']} if ship.get('book') else {}),
        **({'scoutSensor': ship['scoutSensor']} if ship.get('scoutSensor') else {}),
        **({'notes': ' '.join(errata)} if errata else {}),
    }


def weapon_class(name, traits):
    n = name.upper()
    # F5.1.1 gives plasma torpedoes their own class; they are homing particle
    # weapons rather than the Union and Vallari antimatter torpedoes (F4).
    if 'PLASMA' in n:
        return 'plasma-torpedo'
    if 'TORPEDO' in n or 'TORP' in n:
        return 'a-mat-torpedo'
    if 'DISRUPTOR' in n or 'LANCE' in n:
        return 'disruptor'
    if 'PHASER' in n:
        return 'phaser'
    return 'other'


ships = [build(s) for s in S]
json.dump(ships, open('ships_final.json', 'w'), indent=1)
print(f'built {len(ships)} ships')

# ---- validation -----------------------------------------------------------
problems = 0
# Every HP-sheet row must land on exactly one Union form, or a hull silently
# keeps its old price while its neighbours move to the new one.
if HP_MSL:
    union_keys = {hp_key(s['name']) for s in S if s['faction'] == 'union'}
    for h in HP_MSL:
        if hp_key(h['class']) not in union_keys:
            print(f"  HP sheet row unmatched: {h['class']}")
            problems += 1
    for s in S:
        # Expansion 7 predates any HP-sheet row; its rows will come with
        # Doyle's next Master Ship List revision.
        if s.get('book') == 'exp7':
            continue
        if s['faction'] == 'union' and hp_key(s['name']) not in HP_BY_KEY:
            print(f"  Union form missing from HP sheet: {s['name']}")
            problems += 1
        if s['faction'] == 'union' and hp_key(s['name']) in HP_BY_KEY:
            if HP_BY_KEY[hp_key(s['name'])]['structure'] != s['strCount']:
                print(f"  HP sheet structure mismatch: {s['name']} "
                      f"{HP_BY_KEY[hp_key(s['name'])]['structure']} vs form {s['strCount']}")
                problems += 1
for s, raw in zip(ships, S):
    power = sum(len(r['points']) for r in s['reactors'])
    if power != raw.get('totalPower') and not raw.get('powerMismatchOk'):
        print(f"  power mismatch {s['name']}: reactors {power} vs TOTAL POWER {raw['totalPower']}")
        problems += 1
    if s['batteries'] != raw.get('totalBatteries'):
        print(f"  battery mismatch {s['name']}: {s['batteries']} vs {raw['totalBatteries']}")
        problems += 1
    blue = sum(s['shields']['blue'].values())
    known = SHIELD_BOX_ERRATA.get(s['name'])
    if blue != raw['_blue'] and not (known and known[0] == raw['_blue']):
        print(f"  shield mismatch {s['name']}: printed {blue} vs boxes {raw['_blue']}")
        problems += 1
    if not s['weapons']:
        print(f"  no weapons: {s['name']}"); problems += 1
    for w in s['weapons']:
        if not w['brackets']:
            print(f"  no brackets: {s['name']} / {w['name']}"); problems += 1
        for m in w['mounts']:
            if not m['arcs']:
                print(f"  no arcs: {s['name']} / {w['name']}"); problems += 1
    # A scout's sensor block must carry one power circle and one damage box per
    # sensor, and the SCOUT SEN line's top step must activate all of them (H3.2.1).
    scout = s.get('scoutSensor')
    if scout:
        line = next((f for f in s['functions'] if f['label'].startswith('SCOUT SEN')), None)
        top = max((st['value'] for st in line['steps']), default=0) if line else 0
        if not (scout['sensors'] == scout['damageBoxes'] == top):
            print(f"  scout sensor mismatch: {s['name']} "
                  f"{scout['sensors']}/{scout['damageBoxes']}/{top}"); problems += 1
        if not all(scout[k] for k in ('targetingRange', 'jammingRange', 'scanRange')):
            print(f"  scout sensor range missing: {s['name']}"); problems += 1
print(f'validation problems: {problems}')
