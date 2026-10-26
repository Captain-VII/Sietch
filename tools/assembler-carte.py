"""Assemble les captures de la carte du jeu (même zoom, simples décalages) en une seule image.

Usage : python -I assembler.py <dossier des morceaux> <image de sortie>
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

W, H = 2000, 1125
# Zones cachées par l'interface du jeu (en pixels sur 2000 × 1125) : bandeaux, menu gauche, aides à droite.
HUD = [(0, 0, W, 88), (0, 1035, W, H), (80, 630, 440, 965), (1590, 455, W, 670), (70, 95, 575, 655)]


def load(path):
    img = Image.open(path).convert("RGB").resize((W, H), Image.LANCZOS)
    rgb = np.asarray(img, dtype=np.float32) / 255.0
    mask = np.ones((H, W), dtype=bool)
    for x0, y0, x1, y1 in HUD:
        mask[y0:y1, x0:x1] = False
    return rgb, mask


def gray(rgb):
    return rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)


def shift_between(a, b, scale=4):
    """Décalage (dx, dy) tel que le pixel (x, y) de b correspond au pixel (x + dx, y + dy) de a."""
    ga, gb = gray(a[0])[::scale, ::scale], gray(b[0])[::scale, ::scale]
    ma, mb = a[1][::scale, ::scale], b[1][::scale, ::scale]
    ga = np.where(ma, ga - ga[ma].mean(), 0)
    gb = np.where(mb, gb - gb[mb].mean(), 0)
    h, w = ga.shape
    # Corrélation de phase sur des images agrandies (pas de repliement pour les grands décalages).
    fa = np.fft.rfft2(ga, s=(2 * h, 2 * w))
    fb = np.fft.rfft2(gb, s=(2 * h, 2 * w))
    r = fa * np.conj(fb)
    r /= np.abs(r) + 1e-9
    c = np.fft.irfft2(r, s=(2 * h, 2 * w))
    best = None
    # Plusieurs pics candidats, départagés par la corrélation réelle sur la zone commune.
    for idx in np.argsort(c.ravel())[-8:]:
        py, px = np.unravel_index(idx, c.shape)
        dy = py - 2 * h if py > h else py
        dx = px - 2 * w if px > w else px
        score, overlap = ncc(ga, gb, ma, mb, dx, dy)
        if overlap > 0.12 * h * w and (best is None or score > best[0]):
            best = (score, dx * scale, dy * scale, overlap)
    return best


def narrow_scan(a, b, scale=8):
    """Recherche exhaustive (grossière puis fine) du meilleur décalage, même pour une bande commune étroite."""
    ga, gb = gray(a[0])[::scale, ::scale], gray(b[0])[::scale, ::scale]
    ma, mb = a[1][::scale, ::scale], b[1][::scale, ::scale]
    h, w = ga.shape
    best = (-1, 0, 0, 0)
    for dy in range(-h + 15, h - 15, 2):
        for dx in range(-w + 15, w - 15, 2):
            s, n = ncc(ga, gb, ma, mb, dx, dy)
            if n > 0.03 * h * w and s > best[0]:
                best = (s, dx, dy, n)
    s, dx, dy, n = best
    # Affinage à l'échelle 2 autour du meilleur point.
    fa, fb = gray(a[0])[::2, ::2], gray(b[0])[::2, ::2]
    fma, fmb = a[1][::2, ::2], b[1][::2, ::2]
    k = scale // 2
    fine = (s, dx * k, dy * k, n)
    for ddy in range(-2 * k, 2 * k + 1):
        for ddx in range(-2 * k, 2 * k + 1):
            s2, n2 = ncc(fa, fb, fma, fmb, dx * k + ddx, dy * k + ddy)
            if s2 > fine[0]:
                fine = (s2, dx * k + ddx, dy * k + ddy, n2)
    return fine[0], fine[1] * 2, fine[2] * 2, fine[3]


def ncc(ga, gb, ma, mb, dx, dy):
    """Corrélation normalisée de a et b décalée de (dx, dy), et taille de la zone commune."""
    h, w = ga.shape
    ax0, ay0 = max(0, dx), max(0, dy)
    ax1, ay1 = min(w, w + dx), min(h, h + dy)
    if ax1 <= ax0 or ay1 <= ay0:
        return -1, 0
    sa = ga[ay0:ay1, ax0:ax1]
    sb = gb[ay0 - dy:ay1 - dy, ax0 - dx:ax1 - dx]
    m = ma[ay0:ay1, ax0:ax1] & mb[ay0 - dy:ay1 - dy, ax0 - dx:ax1 - dx]
    n = m.sum()
    if n < 50:
        return -1, 0
    va, vb = sa[m] - sa[m].mean(), sb[m] - sb[m].mean()
    return float((va * vb).sum() / (np.sqrt((va ** 2).sum() * (vb ** 2).sum()) + 1e-9)), int(n)


def main(folder, out):
    paths = sorted(p for p in Path(folder).iterdir() if p.suffix.lower() in (".png", ".webp", ".jpg", ".jpeg"))
    tiles = [load(p) for p in paths]
    pairs = []
    for i in range(len(tiles)):
        for j in range(i + 1, len(tiles)):
            best = shift_between(tiles[i], tiles[j])
            if best and best[0] > 0.5:
                pairs.append((best[0], i, j, best[1], best[2]))
                print(f"{paths[i].name} ↔ {paths[j].name} : décalage ({best[1]}, {best[2]}), corrélation {best[0]:.2f}")
    # Arbre couvrant : les meilleures paires d'abord.
    pos = {0: (0, 0)}
    for score, i, j, dx, dy in sorted(pairs, reverse=True) * len(tiles):
        if i in pos and j not in pos:
            pos[j] = (pos[i][0] + dx, pos[i][1] + dy)
        elif j in pos and i not in pos:
            pos[i] = (pos[j][0] - dx, pos[j][1] - dy)
    # Groupes non reliés : recherche exhaustive sur de petits chevauchements, puis médiane des décalages
    # impliqués (les faux raccords, minoritaires, sont écartés).
    while len(pos) < len(tiles):
        rest = [k for k in range(len(tiles)) if k not in pos]
        group = {rest[0]: (0, 0)}
        for _ in range(len(tiles)):
            for score, i, j, dx, dy in sorted(pairs, reverse=True):
                if i in group and j not in group and j not in pos:
                    group[j] = (group[i][0] + dx, group[i][1] + dy)
                elif j in group and i not in group and i not in pos:
                    group[i] = (group[j][0] - dx, group[j][1] - dy)
        implied = []
        for i in pos:
            for j in group:
                s, dx, dy, n = narrow_scan(tiles[i], tiles[j])
                if s > 0.4:
                    implied.append((pos[i][0] + dx - group[j][0], pos[i][1] + dy - group[j][1]))
        if not implied:
            break
        # Le décalage sur lequel le plus de raccords s'accordent (à 40 px près), moyenné.
        votes = [[w for w in implied if abs(w[0] - v[0]) < 40 and abs(w[1] - v[1]) < 40] for v in implied]
        agree = max(votes, key=len)
        ox = int(np.mean([v[0] for v in agree]))
        oy = int(np.mean([v[1] for v in agree]))
        near = len(agree)
        print(f"Groupe {sorted(paths[k].name for k in group)} relié : décalage ({ox}, {oy}), {near}/{len(implied)} raccords d'accord")
        for k, (gx, gy) in group.items():
            pos[k] = (gx + ox, gy + oy)
    missing = [paths[k].name for k in range(len(tiles)) if k not in pos]
    if missing:
        print("Non placés (aucun chevauchement fiable) :", ", ".join(missing))
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    x0, y0 = min(xs), min(ys)
    cw, ch = max(xs) - x0 + W, max(ys) - y0 + H
    acc = np.zeros((ch, cw, 3), dtype=np.float32)
    wsum = np.zeros((ch, cw), dtype=np.float32)
    # Poids plus fort au centre de chaque morceau : les raccords se fondent.
    yy, xx = np.mgrid[0:H, 0:W]
    center = np.minimum(np.minimum(xx, W - xx), np.minimum(yy, H - yy)).astype(np.float32) + 1
    for k, (px, py) in pos.items():
        rgb, mask = tiles[k]
        wgt = center * mask
        ox, oy = px - x0, py - y0
        acc[oy:oy + H, ox:ox + W] += rgb * wgt[..., None]
        wsum[oy:oy + H, ox:ox + W] += wgt
    img = acc / np.maximum(wsum, 1e-6)[..., None]
    img[wsum == 0] = 0
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(out)
    print(f"Carte assemblée : {cw} × {ch} px, {len(pos)} morceaux sur {len(tiles)} → {out}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1], sys.argv[2])
