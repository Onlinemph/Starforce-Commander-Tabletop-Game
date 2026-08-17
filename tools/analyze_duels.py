"""
Score the duel round-robin against both price lists.

Which pricing better predicts single combat — the printed Master Ship List
or the measured fleet-value draft? The outcome metric is deliberately
price-free (fleet health margin and destruction), so neither list is used
to grade itself. The deciding evidence is the pairs where the two lists
disagree about the favorite or the closeness.

Run after tools/point_duels.ts:  python3 tools/analyze_duels.py
"""
import csv
import json
import math
from collections import defaultdict

ROWS = list(csv.DictReader(open('tools/duel_results.csv')))
DRAFT = {d['id']: d['draft'] for d in json.load(open('tools/repriced_draft2.json'))}
PRINTED = {d['id']: d['printed'] for d in json.load(open('tools/repriced_draft2.json'))}

pairs = defaultdict(list)
for r in ROWS:
    pairs[(r['idA'], r['idB'])].append(float(r['healthA']) - float(r['healthB']))

short = lambda h: h.split('-', 1)[1].replace('-class', '').replace('-', ' ')[:22]

results = []
for (a, b), ms in sorted(pairs.items()):
    mean = sum(ms) / len(ms)
    wins = sum(1 for m in ms if m > 0) / len(ms)
    results.append((a, b, mean, wins, len(ms)))

def grade(prices, label):
    right = wrong = ties = 0
    sse = 0.0
    for a, b, mean, wins, _ in results:
        edge = math.log(prices[a]) - math.log(prices[b])
        if abs(mean) < 0.05:
            ties += 1
            continue
        if (edge > 0) == (mean > 0):
            right += 1
        else:
            wrong += 1
    # How well does the price ratio track the margin? Rank correlation.
    xs = [math.log(prices[a]) - math.log(prices[b]) for a, b, *_ in results]
    ys = [mean for _, _, mean, _, _ in results]
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        out = [0.0] * len(v)
        for rank, i in enumerate(order):
            out[i] = rank
        return out
    rx, ry = ranks(xs), ranks(ys)
    n = len(xs)
    mrx, mry = sum(rx) / n, sum(ry) / n
    num = sum((x - mrx) * (y - mry) for x, y in zip(rx, ry))
    den = math.sqrt(sum((x - mrx) ** 2 for x in rx) * sum((y - mry) ** 2 for y in ry))
    rho = num / den
    print(f'{label:<22} favorite right {right}/{right + wrong} (near-draws excluded: {ties})   rank corr {rho:+.3f}')

print('== Which list predicts the duel? ==')
grade(PRINTED, 'printed prices')
grade(DRAFT, 'measured fleet values')

print('\n== The deciding pairs: lists disagree on the favorite ==')
print(f"{'matchup':<48} {'printed says':>12} {'draft says':>11} {'measured':>9}")
for a, b, mean, wins, n in results:
    pr = PRINTED[a] / PRINTED[b]
    dr = DRAFT[a] / DRAFT[b]
    if (pr > 1) == (dr > 1) and not (max(pr, 1 / pr) > 1.25 and max(dr, 1 / dr) < 1.1) and not (max(dr, 1 / dr) > 1.25 and max(pr, 1 / pr) < 1.1):
        continue
    def says(ratio):
        if ratio > 1.1: return 'A'
        if ratio < 1 / 1.1: return 'B'
        return 'even'
    verdict = 'A' if mean > 0.05 else ('B' if mean < -0.05 else 'even')
    print(f'{short(a):<24}v {short(b):<22} {says(pr):>12} {says(dr):>11} {verdict:>6} ({wins:.0%} A, margin {mean:+.2f})')
