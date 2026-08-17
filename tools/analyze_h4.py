"""
Two price columns: the base game, and the game with Coordinated Fire (H4) on.

Every measurement in the points campaign was taken under the base firing
sequence (H2.4) — one pass, descending Tactical Scan, and no limit on how many
of my ships shoot your one ship. H4 is optional (H4.1) and adds the rule that
looks, on paper, like the printed game's own answer to the swarm question:
H4.3.1 allows a faction ONE attack per target per combat phase, and the only
exemption is a coordinated group, whose members must each hold Tactical Scan at
least equal to the group's size (H4.5.1) — a bill paid out of the SENSOR line,
which is exactly the line the cheap hulls are short of.

So this reads two titration sweeps run over identical anchors, probes, counts
and seeds, and prices each anchor twice. Same break-even instrument as
analyze_titration.py: the probe count where the anchor's win rate crosses even
IS the anchor's worth, in that probe's printed points.

    npx vite-node tools/point_titration.ts -- --games 12 --out tools/titration_h4off.csv
    npx vite-node tools/point_titration.ts -- --games 12 --coordinated --out tools/titration_h4on.csv
    python3 tools/analyze_h4.py
"""
import csv
import json
import math
import os
from collections import defaultdict

SHIPS = {s['id']: s for s in json.load(open('tools/ships_final.json'))}
ARMS = [('base game', 'tools/titration_h4off.csv'), ('H4 on', 'tools/titration_h4on.csv')]


def anchor_margin(r):
    """The anchor's outcome in the game's own currency (points per point)."""
    return float(r['vpA']) / float(r['pvProbes']) - float(r['vpB']) / float(r['pvAnchor'])


def load(path):
    """Rows of the sweep, keyed by cell. Fan hulls (the carrier) are not in the
    printed roster this priced against, and are left out of the curve."""
    cells = defaultdict(list)
    skipped = set()
    for r in csv.DictReader(open(path)):
        if r['anchor'] not in SHIPS or r['probe'] not in SHIPS:
            skipped.add(r['anchor'] if r['anchor'] not in SHIPS else r['probe'])
            continue
        cells[(r['anchor'], r['probe'], int(r['n']))].append(anchor_margin(r))
    for s in sorted(skipped):
        print(f'(not in the printed roster, left out of the fit: {s})')
    return cells


def crossing(cells, anchor, probe):
    """N* where the anchor's win rate crosses 0.5, or a censored bound."""
    ns = sorted(n for a, p, n in cells if a == anchor and p == probe)
    if not ns:
        return None
    rates = [(n, sum(1 for m in cells[(anchor, probe, n)] if m > 0) / len(cells[(anchor, probe, n)]))
             for n in ns]
    above = [n for n, w in rates if w > 0.5]
    below = [n for n, w in rates if w < 0.5]
    if not below:
        return ('>', ns[-1])
    if not above:
        return ('<', ns[0])
    lo = max(above)
    later = [n for n, w in rates if w < 0.5 and n > lo]
    hi = min(later) if later else lo + 1
    wlo = dict(rates)[lo]
    whi = dict(rates).get(hi, 0.0)
    t = (wlo - 0.5) / max(wlo - whi, 1e-9)
    return ('=', math.exp(math.log(lo) + t * (math.log(hi) - math.log(lo))))


def worths(cells):
    """Median measured worth per anchor, in points, with a censoring count.

    A pair whose whole probed range fell on one side of even yields a bound,
    not a crossing. Bounds are kept (dropping them would bias the median
    toward the pairs that happened to bracket) but they are counted and
    printed, because a column built mostly of bounds is measuring the window.
    """
    pairs = sorted({(a, p) for a, p, _ in cells})
    out, censored = {}, {}
    for a in sorted({a for a, _ in pairs}, key=lambda a: SHIPS[a]['pointValue']):
        vals, cens = [], 0
        for _, p in [x for x in pairs if x[0] == a]:
            got = crossing(cells, a, p)
            if not got:
                continue
            kind, val = got
            pvP = SHIPS[p]['pointValue']
            if kind != '=':
                cens += 1
            vals.append(val * pvP * (1.0 if kind == '=' else 1.25 if kind == '>' else 0.8))
        if vals:
            vals.sort()
            out[a] = vals[len(vals) // 2]
            censored[a] = (cens, len(vals))
    return out, censored


def fit(measured):
    """worth = k * printed^beta, least squares in log-log."""
    xs = [math.log(SHIPS[a]['pointValue']) for a in measured]
    ys = [math.log(v) for v in measured.values()]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    beta = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return math.exp(my - beta * mx), beta


short = lambda h: h.split('-', 1)[1].replace('-class', '').replace('-', ' ')[:26]

arms = []
for label, path in ARMS:
    if not os.path.exists(path):
        print(f'missing {path} — run the sweep first')
        raise SystemExit(1)
    cells = load(path)
    measured, censored = worths(cells)
    arms.append((label, cells, measured, sum(len(v) for v in cells.values()), censored))

print('== What one hull is worth, measured twice ==')
print(f"{'anchor':<28} {'printed':>8} {'base game':>10} {'H4 on':>8} {'H4/base':>8}   bounded")
for a in sorted(arms[0][2], key=lambda a: SHIPS[a]['pointValue']):
    pv = SHIPS[a]['pointValue']
    off = arms[0][2].get(a)
    on = arms[1][2].get(a)
    if off is None or on is None:
        continue
    c0, n0 = arms[0][4][a]
    c1, n1 = arms[1][4][a]
    flag = f'{c0}/{n0} {c1}/{n1}'
    print(f'{short(a):<28} {pv:8.1f} {off:10.0f} {on:8.0f} {on / off:8.2f}x   {flag}')
print('(bounded = pairs whose range never crossed even, base / H4; those are bounds, not crossings)')

print()
for label, _, measured, games, _cens in arms:
    k, beta = fit(measured)
    # beta = 1 means printed linear pricing is already right; below 1 means big
    # hulls are worth less than they cost and numbers win.
    print(f'{label:<10} ({games:5d} games): worth = {k:.2f} * printed^{beta:.3f}')

k0, b0 = fit(arms[0][2])
k1, b1 = fit(arms[1][2])
print(f'\nexponent moved {b0:.3f} -> {b1:.3f} with H4 switched on '
      f'({"toward" if abs(1 - b1) < abs(1 - b0) else "away from"} linear printed pricing).')

# What the two arms say a 100-point hull is really worth, side by side.
for pv in (25, 50, 100, 160):
    print(f'  a {pv:3d}-point hull measures {k0 * pv ** b0:6.1f} in the base game, '
          f'{k1 * pv ** b1:6.1f} under H4')
