// Calibration de la carte : passage des coordonnées du jeu à la carte de Sietch.

export interface CalibrationPoint {
  wx: number;
  wy: number;
  mx: number;
  my: number;
}

export interface Affine {
  a: number; b: number; c: number;
  d: number; e: number; f: number;
}

/**
 * Transformation affine à partir des 3 derniers points de calibration :
 * mx = a·wx + b·wy + c, my = d·wx + e·wy + f. Gère échelle, décalage, rotation
 * et inversion d'axes. Renvoie null s'il manque des points ou s'ils sont alignés.
 */
export function solveAffine(points: CalibrationPoint[] | undefined): Affine | null {
  if (!points || points.length < 3) return null;
  const [p, q, r] = points.slice(-3);
  const det = p.wx * (q.wy - r.wy) - p.wy * (q.wx - r.wx) + (q.wx * r.wy - r.wx * q.wy);
  if (Math.abs(det) < 1e-9) return null;
  const solve = (u: number, v: number, w: number) => ({
    k1: (u * (q.wy - r.wy) - p.wy * (v - w) + (v * r.wy - w * q.wy)) / det,
    k2: (p.wx * (v - w) - u * (q.wx - r.wx) + (q.wx * w - r.wx * v)) / det,
    k3: (p.wx * (q.wy * w - r.wy * v) - p.wy * (q.wx * w - r.wx * v) + u * (q.wx * r.wy - r.wx * q.wy)) / det,
  });
  const x = solve(p.mx, q.mx, r.mx);
  const y = solve(p.my, q.my, r.my);
  return { a: x.k1, b: x.k2, c: x.k3, d: y.k1, e: y.k2, f: y.k3 };
}

export function toMap(t: Affine, wx: number, wy: number) {
  return { x: t.a * wx + t.b * wy + t.c, y: t.d * wx + t.e * wy + t.f };
}
