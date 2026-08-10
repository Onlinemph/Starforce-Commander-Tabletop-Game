"""Trace the designer's ship silhouettes into the map's vector glyphs.

Doyle's `SHIP Silhouette DRAFTS.pptx` carries the shapes the printed playing
pieces use — solid one-colour PNGs, nose up. This traces each one to an SVG
path and writes `src/ui/officialSilhouettes.ts`, so the map draws the game's
own art through the same CSS-tinted `.glyph-hull` pipeline as before.

Which image is which ship comes from the deck itself: slide 2 labels the
classes, slides 4-5 show the playing-piece versions, slide 3 the capital
drafts. The mapping below is by (faction x hull role), matching MapView's
glyph buckets.

    python3 tools/trace_silhouettes.py /path/to/SHIP_Sillhouette_DRAFTS.pptx

Pure PIL — no numpy, no potrace: marching-edge contour following plus
Douglas-Peucker simplification is enough for solid silhouettes.
"""

import sys
import zipfile
from io import BytesIO

from PIL import Image

# (faction, role) -> media name inside the deck. Slide-2 labels name the
# classes; the role buckets are MapView's.
MAPPING = {
    ('union', 'scout'): 'image16.png',  # Xerxes-piece: saucer + single nacelle
    ('union', 'escort'): 'image15.png',  # Soryu frigate playing piece
    ('union', 'cruiser'): 'image14.png',  # Yorktown playing piece
    ('union', 'battlecruiser'): 'image10.png',  # slide-3 battlecruiser draft
    ('union', 'dreadnought'): 'image9.png',  # slide-3 dreadnought draft
    ('vallari', 'scout'): 'image2.png',  # V2 Flanker
    ('vallari', 'escort'): 'image29.png',  # V5 Corsair
    ('vallari', 'cruiser'): 'image13.png',  # V6 Savage
    ('vallari', 'battlecruiser'): 'image12.png',  # V7 Raider
    ('vallari', 'dreadnought'): 'image8.png',  # slide-3 dreadnought draft
}

BOX = 96  # fit into -48..48 of the 100-unit glyph box
MIN_LOOP_AREA = 30  # px^2 — drop stray-pixel rings
EPSILON = 1.6  # px — Douglas-Peucker tolerance


def mask_of(im: Image.Image):
    """Filled = opaque and not near-white (some drafts sit on white)."""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    grid = [[False] * w for _ in range(h)]
    for y in range(h):
        row = grid[y]
        for x in range(w):
            r, g, b, a = px[x, y]
            row[x] = a > 128 and not (r > 235 and g > 235 and b > 235)
    return grid, w, h


def contours(grid, w, h):
    """Closed loops of pixel-boundary edges, interior kept on one side."""
    edges = {}

    def filled(x, y):
        return 0 <= x < w and 0 <= y < h and grid[y][x]

    for y in range(h):
        for x in range(w):
            if not grid[y][x]:
                continue
            if not filled(x, y - 1):
                edges.setdefault((x, y), []).append((x + 1, y))
            if not filled(x, y + 1):
                edges.setdefault((x + 1, y + 1), []).append((x, y + 1))
            if not filled(x - 1, y):
                edges.setdefault((x, y + 1), []).append((x, y))
            if not filled(x + 1, y):
                edges.setdefault((x + 1, y), []).append((x + 1, y + 1))

    loops = []
    while edges:
        start = next(iter(edges))
        loop = [start]
        cur = start
        while True:
            nxts = edges.get(cur)
            if not nxts:
                break
            nxt = nxts.pop()
            if not nxts:
                del edges[cur]
            if nxt == start:
                break
            loop.append(nxt)
            cur = nxt
        if len(loop) >= 4:
            loops.append(loop)
    return loops


def area(loop):
    s = 0
    for i in range(len(loop)):
        x1, y1 = loop[i]
        x2, y2 = loop[(i + 1) % len(loop)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def simplify(points, eps):
    """Douglas-Peucker on a closed loop, split at its two farthest points."""

    def dp(pts):
        if len(pts) < 3:
            return pts
        ax, ay = pts[0]
        bx, by = pts[-1]
        dx, dy = bx - ax, by - ay
        norm = (dx * dx + dy * dy) ** 0.5 or 1
        best, bi = -1.0, 0
        for i in range(1, len(pts) - 1):
            px, py = pts[i]
            d = abs(dx * (ay - py) - dy * (ax - px)) / norm
            if d > best:
                best, bi = d, i
        if best <= eps:
            return [pts[0], pts[-1]]
        left = dp(pts[: bi + 1])
        return left[:-1] + dp(pts[bi:])

    hi = max(range(len(points)), key=lambda i: points[i][0] ** 2 + points[i][1] ** 2)
    pts = points[hi:] + points[: hi + 1]
    lo = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    first = dp(pts[: lo + 1])
    second = dp(pts[lo:])
    out = first[:-1] + second[:-1]
    return out


def trace(im: Image.Image) -> str:
    grid, w, h = mask_of(im)
    loops = [l for l in contours(grid, w, h) if area(l) >= MIN_LOOP_AREA]
    if not loops:
        raise ValueError('empty silhouette')
    xs = [x for l in loops for x, _ in l]
    ys = [y for l in loops for _, y in l]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    scale = BOX / max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

    parts = []
    for loop in sorted(loops, key=area, reverse=True):
        pts = simplify(loop, EPSILON)
        coords = [((x - cx) * scale, (y - cy) * scale) for x, y in pts]
        d = 'M ' + ' L '.join(f'{x:.1f} {y:.1f}' for x, y in coords) + ' Z'
        parts.append(d)
    return ' '.join(parts)


def main() -> None:
    deck = sys.argv[1]
    z = zipfile.ZipFile(deck)
    entries = []
    for (faction, role), media in MAPPING.items():
        im = Image.open(BytesIO(z.read(f'ppt/media/{media}')))
        d = trace(im)
        entries.append((faction, role, media, d))
        print(f'{faction:8} {role:14} {media:12} -> {len(d)} chars')

    lines = [
        '/**',
        " * The designer's own ship silhouettes, traced from the shapes the printed",
        ' * playing pieces use (SHIP Silhouette DRAFTS deck; slide 2 names the',
        ' * classes, slides 4-5 show the pieces). Generated by',
        ' * tools/trace_silhouettes.py — edit that, not this.',
        ' *',
        ' * Paths are nose-up in the same 100-unit box as the hand-drawn glyphs in',
        ' * MapView, so they inherit the whole .glyph-hull pipeline: side colours,',
        ' * damage washes, selection glows, cloak fades.',
        ' */',
        '',
        "export type OfficialFaction = 'union' | 'vallari'",
        "export type OfficialRole = 'scout' | 'escort' | 'cruiser' | 'battlecruiser' | 'dreadnought'",
        '',
        'export const OFFICIAL_SILHOUETTES: Record<OfficialFaction, Record<OfficialRole, string>> = {',
    ]
    for faction in ('union', 'vallari'):
        lines.append(f'  {faction}: {{')
        for _, role, media, d in [e for e in entries if e[0] == faction]:
            lines.append(f'    // {media}')
            lines.append(f"    {role}: '{d}',")
        lines.append('  },')
    lines.append('}')
    lines.append('')
    out = 'src/ui/officialSilhouettes.ts'
    with open(out, 'w') as f:
        f.write('\n'.join(lines))
    print('wrote', out)


if __name__ == '__main__':
    main()
