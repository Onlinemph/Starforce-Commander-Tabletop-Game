"""
Read the scan-tier probe: what does H4 actually charge, numbers or sensor tech?

One anchor, one probe hull, one set of seeds, and nothing varied but the
swarm's Tactical Scan ceiling — the stat that sets how many hulls may fire
together under H4.5.1, and the stat that climbs with a hull's year.

If H4 taxed numbers, the anchor's break-even count would be flat across the
tiers. Whatever slope shows up here is the tax falling on tech instead.

Run after tools/scan_tier_probe.ts:  python3 tools/analyze_scan_tier.py
"""
import csv
import math
import sys
from collections import defaultdict

SOURCE = sys.argv[1] if len(sys.argv) > 1 else 'tools/scan_tier.csv'
ROWS = list(csv.DictReader(open(SOURCE)))
PV_ANCHOR = 158.5   # UNION III-class Dreadnought, printed
PV_PROBE = 23.0     # YORKTOWN I-class Heavy Cruiser, printed

cells = defaultdict(list)
groups = defaultdict(lambda: [0, 0])
for r in ROWS:
    tier, n = int(r['tier']), int(r['n'])
    margin = float(r['vpA']) / (n * PV_PROBE) - float(r['vpB']) / PV_ANCHOR
    cells[(tier, n)].append(margin)
    groups[tier][0] += int(r['groups'])
    groups[tier][1] += int(r['groupShips'])


def crossing(tier):
    ns = sorted(n for t, n in cells if t == tier)
    rates = [(n, sum(1 for m in cells[(tier, n)] if m > 0) / len(cells[(tier, n)])) for n in ns]
    above = [n for n, w in rates if w > 0.5]
    below = [n for n, w in rates if w < 0.5]
    if not below:
        return ('>', ns[-1], rates)
    if not above:
        return ('<', ns[0], rates)
    lo = max(above)
    later = [n for n, w in rates if w < 0.5 and n > lo]
    hi = min(later) if later else lo + 1
    wlo, whi = dict(rates)[lo], dict(rates).get(hi, 0.0)
    t = (wlo - 0.5) / max(wlo - whi, 1e-9)
    return ('=', math.exp(math.log(lo) + t * (math.log(hi) - math.log(lo))), rates)


print('== One dreadnought against a YORKTOWN I swarm, H4 on, scan ceiling varied ==')
print(f"{'scan ceiling':>13} {'games':>6} {'groups':>7} {'mean size':>10} {'break-even hulls':>17} {'anchor worth':>13}")
base = None
for tier in sorted({int(r['tier']) for r in ROWS}):
    kind, val, _rates = crossing(tier)
    g, s = groups[tier]
    n_games = sum(len(v) for (t, _), v in cells.items() if t == tier)
    worth = val * PV_PROBE
    mark = '' if kind == '=' else kind
    print(f'{tier:>13} {n_games:>6} {g:>7} {s / max(g, 1):>10.2f} '
          f'{mark + format(val, ".2f"):>17} {mark + format(worth, ".0f"):>13}')
    if tier == 3:
        base = worth

if base:
    print(f'\n(printed hulls of the 3640s–50s cap at scan 3; every hull of the 3670s reaches 4)')
    for tier in sorted({int(r['tier']) for r in ROWS}):
        kind, val, _ = crossing(tier)
        print(f'  at scan {tier}: the same dreadnought is worth {val * PV_PROBE / base:.2f}x '
              f'what it is worth against a scan-3 swarm')
