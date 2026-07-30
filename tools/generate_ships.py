"""Turn the extracted ship forms into src/data/ships.ts."""
import difflib, json, re, sys
from collections import defaultdict

S = json.load(open('ships_raw.json'))
M = json.load(open('msl.json'))

# Union forms come first in the book, Vallari after; the Master Ship List uses
# the same split.
for _s in S:
    _s['faction'] = 'union' if _s['page'] <= 44 else 'vallari'
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
                'PROB': 'Probe Launcher', 'SPCL': 'Special System'}

FACTION_NAME = {'union': 'Union of Federated Systems', 'vallari': 'Vallari Imperium'}

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
]


def apply_errata(ship):
    notes = []
    for e in ERRATA:
        if e['ship'] not in ship['name']:
            continue
        for w in ship['weapons']:
            if w['name'] == e['weapon']:
                e['fix'](w)
                notes.append(e['note'])
    return notes


def norm(s):
    return re.sub(r'[^A-Z0-9]', '', s.upper())


def match_msl(ship):
    cands = [m for m in M if m['faction'] == ship['faction'] and m['year'] == ship['year']
             and m['structure'] == ship['strCount']]
    if not cands:
        cands = [m for m in M if m['faction'] == ship['faction']]
    if len(cands) == 1:
        return cands[0]
    target = norm(ship['name'])
    return max(cands, key=lambda m: difflib.SequenceMatcher(None, target, norm(m['class'])).ratio())


def slug(name):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', name.lower())).strip('-')


def build(ship):
    msl = match_msl(ship)
    faction = ship['faction']
    errata = apply_errata(ship)

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
            functions.append({'id': slug(label), 'label': label, 'kind': 'special',
                              'freeValue': (free['value'] or 1) if free else 0,
                              'steps': steps(), 'sequential': True})
            continue

        # Weapon arming line, matched to the weapon block of the same ordinal.
        weapon = ship['weapons'][wi] if wi < len(ship['weapons']) else None
        wi += 1
        functions.append({'id': f'f-{slug(label)}-{wi}', 'label': label, 'kind': 'weapon',
                          'freeValue': (free['value'] or 0) if free else 0,
                          'steps': steps(), 'sequential': True,
                          'weaponSystemId': slug(weapon['name']) + f'-{wi}' if weapon else None})

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
                          **({'bonus': b['bonus']} if b['bonus'] else {})}
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
        'pointValue': msl['pointValue'],
        'year': msl['year'],
        'availability': msl['availability'],
        'victoryTable': msl['victory'],
        'shipBookPage': ship['page'],
        **({'notes': ' '.join(errata)} if errata else {}),
    }


def weapon_class(name, traits):
    n = name.upper()
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
for s, raw in zip(ships, S):
    power = sum(len(r['points']) for r in s['reactors'])
    if power != raw.get('totalPower'):
        print(f"  power mismatch {s['name']}: reactors {power} vs TOTAL POWER {raw['totalPower']}")
        problems += 1
    if s['batteries'] != raw.get('totalBatteries'):
        print(f"  battery mismatch {s['name']}: {s['batteries']} vs {raw['totalBatteries']}")
        problems += 1
    blue = sum(s['shields']['blue'].values())
    if blue != raw['_blue']:
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
print(f'validation problems: {problems}')
