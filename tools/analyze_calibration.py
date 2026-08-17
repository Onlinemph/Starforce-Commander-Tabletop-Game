"""
Read the point-calibration sweep and answer three questions:

 1. How big is the numbers advantage at equal points?  (win rate and mean
    victory-point margin, bucketed by hull-count ratio)
 2. What is each panel hull actually worth?  (least-squares battle value per
    hull from every game's VP margin)
 3. What would a re-priced roster look like?  (regress the measured values
    against the stats every form carries, apply to all 103 printed hulls)

Run after tools/point_calibration.ts:  python3 tools/analyze_calibration.py
"""
import csv
import json
import math
import sys
from collections import defaultdict

SOURCE = sys.argv[1] if len(sys.argv) > 1 else 'tools/calibration_results.csv'
ROWS = list(csv.DictReader(open(SOURCE)))
SHIPS = {s['id']: s for s in json.load(open('tools/ships_final.json'))}

# Outcome per game: fraction of the enemy fleet's value destroyed minus the
# fraction of your own conceded. Symmetric, bounded, in the game's own currency.
def margin(row):
    return float(row['vpA']) / float(row['pvB']) - float(row['vpB']) / float(row['pvA'])

# ---- 1. the numbers-advantage curve ---------------------------------------
buckets = defaultdict(lambda: [0, 0, 0.0])  # ratio bucket -> [games, swarm wins, sum margin toward swarm]
for r in ROWS:
    nA, nB = int(r['nA']), int(r['nB'])
    if nA == nB:
        key = '1:1'
        m = margin(r)
        buckets[key][0] += 1
        buckets[key][1] += 1 if m > 0 else 0
        buckets[key][2] += m
        continue
    # Orient every game so "the swarm" is the side with more hulls.
    swarmA = nA > nB
    ratio = max(nA, nB) / min(nA, nB)
    key = ('%.0f:1' % ratio) if abs(ratio - round(ratio)) < 0.26 else '%.1f:1' % ratio
    m = margin(r) if swarmA else -margin(r)
    buckets[key][0] += 1
    buckets[key][1] += 1 if m > 0 else 0
    buckets[key][2] += m

print('== Numbers advantage at equal points ==')
print(f"{'count ratio':>12} {'games':>6} {'swarm wins':>11} {'mean VP margin':>15}")
def ratio_key(k):
    return float(k.split(':')[0])
for key in sorted(buckets, key=ratio_key):
    g, w, s = buckets[key]
    print(f'{key:>12} {g:6d} {100 * w / g:10.0f}% {s / g:+15.2f}')

# ---- 2. per-hull battle value ---------------------------------------------
# Solve least squares: margin ~ c * (nA * v[idA] - nB * v[idB]).  The scale c
# is absorbed into v; the pricing only needs ratios.  Normal equations by hand
# (14 unknowns; no numpy in this environment's stdlib guarantee).
ids = sorted({r['idA'] for r in ROWS} | {r['idB'] for r in ROWS})
index = {h: i for i, h in enumerate(ids)}
n = len(ids)
A = [[0.0] * n for _ in range(n)]
b = [0.0] * n
for r in ROWS:
    x = [0.0] * n
    x[index[r['idA']]] += int(r['nA'])
    x[index[r['idB']]] -= int(r['nB'])
    m = margin(r)
    for i in range(n):
        if x[i] == 0.0:
            continue
        b[i] += x[i] * m
        for j in range(n):
            A[i][j] += x[i] * x[j]
# Ridge for stability (values are only identified up to the games played).
for i in range(n):
    A[i][i] += 1e-6

def solve(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        M[col], M[piv] = M[piv], M[col]
        d = M[col][col]
        for j in range(col, n + 1):
            M[col][j] /= d
        for r2 in range(n):
            if r2 != col and M[r2][col] != 0:
                f = M[r2][col]
                for j in range(col, n + 1):
                    M[r2][j] -= f * M[col][j]
    return [M[i][n] for i in range(n)]

v = solve(A, b)
# Rescale so the panel's total measured worth equals its total printed price:
# the roster stays at the same overall price level, only the ratios move.
printed = {h: SHIPS[h]['pointValue'] for h in ids}
scale = sum(printed.values()) / sum(max(vi, 1e-9) for vi in v)
value = {h: max(v[index[h]], 1e-9) * scale for h in ids}

print('\n== Measured battle value vs printed price (panel) ==')
print(f"{'hull':<44} {'printed':>8} {'measured':>9} {'ratio':>6}")
for h in sorted(ids, key=lambda h: printed[h]):
    print(f'{h:<44} {printed[h]:8.1f} {value[h]:9.1f} {value[h] / printed[h]:6.2f}')

# ---- 3. draft re-pricing for the whole roster ------------------------------
# Fit log(value) ~ a + g*log(stats index) on the panel, where the stats index
# is the raw material a point buys: hit-point basis + shields + attack dice.
def stats_index(s):
    basis = s['victoryTable'][4]['damage'] / 0.9  # printed SYST+STR back out
    shields = sum(s['shields']['blue'].values()) + sum(a for a in s['armor'].values())
    dice = 0.0
    for w in s['weapons']:
        best = max(len(bk['dice']) + (bk.get('bonus') or 0) * 0.5 for bk in w['brackets'])
        dice += best * len(w['mounts'])
    return basis + shields + 6.0 * dice

xs = [math.log(stats_index(SHIPS[h])) for h in ids]
ys = [math.log(value[h]) for h in ids]
mx = sum(xs) / n
my = sum(ys) / n
g = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
a = my - g * mx
resid = [y - (a + g * x) for x, y in zip(xs, ys)]
rms = math.sqrt(sum(e * e for e in resid) / n)
print(f'\nfit: log(value) = {a:.3f} + {g:.3f} * log(stats)   rms {rms:.2f} (in log points)')

print('\n== Draft re-priced roster (biggest moves) ==')
draft = []
for s in SHIPS.values():
    pv_new = math.exp(a + g * math.log(stats_index(s)))
    draft.append((pv_new / s['pointValue'], s['pointValue'], round(pv_new, 1), s['name']))
draft.sort(key=lambda d: d[0])
print(f"{'shift':>6} {'printed':>8} {'draft':>7}  name")
for shift, old, new, name in draft[:8] + [('...', '', '', '')] + draft[-8:]:
    if shift == '...':
        print('   ...')
        continue
    print(f'{shift:6.2f} {old:8.1f} {new:7.1f}  {name[:44]}')

with open('tools/repriced_draft.json', 'w') as f:
    json.dump(
        [{'id': s['id'], 'name': s['name'], 'printed': s['pointValue'],
          'draft': round(math.exp(a + g * math.log(stats_index(s))), 1)}
         for s in SHIPS.values()],
        f, indent=1)
print('\nwrote tools/repriced_draft.json')
