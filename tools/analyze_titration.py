"""
Read the titration sweep and price each anchor hull in swarm units.

For every (anchor, probe) pair the sweep played the anchor alone against
n probes across the parity region. The n where the anchor's win rate
crosses even is what the anchor is *worth*, in that probe's printed
points: worth = N* x probe price. Interpolated in log n between the
bracketing counts; censored when the anchor won or lost the whole range.

Run after tools/point_titration.ts:  python3 tools/analyze_titration.py
"""
import csv
import json
import math
from collections import defaultdict

ROWS = list(csv.DictReader(open('tools/titration_results.csv')))
SHIPS = {s['id']: s for s in json.load(open('tools/ships_final.json'))}

# Anchor's outcome per game, in the game's own currency.
def anchor_margin(r):
    return float(r['vpA']) / float(r['pvProbes']) - float(r['vpB']) / float(r['pvAnchor'])

cells = defaultdict(list)  # (anchor, probe, n) -> margins
for r in ROWS:
    cells[(r['anchor'], r['probe'], int(r['n']))].append(anchor_margin(r))

pairs = sorted({(a, p) for a, p, _ in cells})

def crossing(anchor, probe):
    """N* where the anchor's win rate crosses 0.5, or a censored bound."""
    ns = sorted(n for a, p, n in cells if a == anchor and p == probe)
    rates = []
    for n in ns:
        ms = cells[(anchor, probe, n)]
        rates.append((n, sum(1 for m in ms if m > 0) / len(ms)))
    # Walk for the last n where the anchor still wins more than it loses.
    above = [n for n, w in rates if w > 0.5]
    below = [n for n, w in rates if w < 0.5]
    if not below:
        return ('>', ns[-1], rates)
    if not above:
        return ('<', ns[0], rates)
    lo = max(above)
    hi = min(n for n, w in rates if w < 0.5 and n > lo) if any(n > lo for n, w in rates if w < 0.5) else min(below)
    if hi <= lo:  # non-monotonic noise: use the overall 50% point by fit
        hi = lo + 1
    wlo = dict(rates)[lo]
    whi = dict(rates).get(hi, 0.0)
    t = (wlo - 0.5) / max(wlo - whi, 1e-9)
    return ('=', math.exp(math.log(lo) + t * (math.log(hi) - math.log(lo))), rates)

short = lambda h: h.split('-', 1)[1].replace('-class', '').replace('-', ' ')[:26]
print('== What one hull is worth, measured in swarm units ==')
print(f"{'anchor':<28} {'printed':>7}   worth-in-points by probe (median last)")
anchors = sorted({a for a, _ in pairs}, key=lambda a: SHIPS[a]['pointValue'])
measured = {}
for a in anchors:
    pvA = SHIPS[a]['pointValue']
    worths = []
    parts = []
    for _, p in [x for x in pairs if x[0] == a]:
        pvP = SHIPS[p]['pointValue']
        kind, val, rates = crossing(a, p)
        if kind == '=':
            worths.append(val * pvP)
            parts.append(f'{val * pvP:5.0f}')
        else:
            parts.append(f'{kind}{val * pvP:4.0f}')
            # A censored bound still bounds the median honestly.
            worths.append(val * pvP * (1.25 if kind == '>' else 0.8))
    worths.sort()
    med = worths[len(worths) // 2] if worths else float('nan')
    measured[a] = med
    print(f'{short(a):<28} {pvA:7.1f}   {" ".join(parts)}  -> {med:5.0f}')

# ---- the correction curve --------------------------------------------------
# Probes act as their own reference (the equal-points sweep showed near-fair
# results at 1:1 between similar hulls), so fit measured worth against printed
# price across the anchors: worth = k * printed^beta.
xs = [math.log(SHIPS[a]['pointValue']) for a in anchors]
ys = [math.log(measured[a]) for a in anchors]
n = len(xs)
mx, my = sum(xs) / n, sum(ys) / n
beta = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
k = math.exp(my - beta * mx)
print(f'\nfit: measured worth = {k:.2f} * printed^{beta:.3f}')

# Re-priced draft: keep the smallest fighting hulls where they are (they are
# the numeraire) and bring everything else onto the measured curve, i.e.
# price' = k * printed^beta, rescaled so a 23-point YORKTOWN I stays 23.
ref = 'union-yorktown-i-class-heavy-cruiser'
norm = SHIPS[ref]['pointValue'] / (k * SHIPS[ref]['pointValue'] ** beta)
print(f"\n== Draft re-pricing (normalized so YORKTOWN I keeps {SHIPS[ref]['pointValue']}) ==")
print(f"{'hull':<44} {'printed':>8} {'draft':>7}")
draft = []
for s in sorted(SHIPS.values(), key=lambda s: s['pointValue']):
    pv2 = round(norm * k * s['pointValue'] ** beta, 1)
    draft.append({'id': s['id'], 'name': s['name'], 'printed': s['pointValue'], 'draft': pv2})
for d in draft[::8] + draft[-3:]:
    print(f"{d['name'][:44]:<44} {d['printed']:8.1f} {d['draft']:7.1f}")
json.dump(draft, open('tools/repriced_draft.json', 'w'), indent=1)
print('\nwrote tools/repriced_draft.json')
