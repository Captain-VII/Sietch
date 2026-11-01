// Position en direct (modules sans BattlEye) : état partagé, calibration et conversion
// des coordonnées du jeu vers la carte de Sietch.

import { api, on, type LiveStatus, type PlayerPosition } from "./api";

export { solveAffine, toMap, type Affine } from "./affine";

const OFF: LiveStatus = {
  gameRunning: false, battleyeRunning: false, enabled: false, configured: false,
  active: false, source: "aucune", message: null,
};

let status: LiveStatus = OFF;
let position: PlayerPosition | null = null;
/** Position d'il y a ~50 ms : sert à estimer la vitesse. Avec une lecture toutes les 8 ms, deux lectures
 *  successives peuvent tomber sur la même image du jeu : la vitesse entre elles serait trop bruitée. */
let previous: PlayerPosition | null = null;
const recent: PlayerPosition[] = [];
const SPEED_WINDOW_MS = 50;

/** Prolongation au plus de 150 ms (2 à 3 lectures manquées) : au-delà, on montre la dernière position lue. */
const PREDICT_MAX_MS = 150;

/**
 * Position prolongée à l'instant `now` selon la vitesse entre les deux dernières lectures.
 * Le joueur s'affiche là où il est probablement, au lieu de là où il était il y a une lecture.
 */
export function predict(p: PlayerPosition, prev: PlayerPosition | null, now: number): PlayerPosition {
  const dt = prev ? p.at - prev.at : 0;
  const ahead = now - p.at;
  if (!prev || dt <= 0 || dt > 500 || ahead <= 0 || ahead > PREDICT_MAX_MS) return p;
  const k = ahead / dt;
  // Saut (téléportation, réapparition) : pas de prolongation.
  if (Math.hypot(p.x - prev.x, p.y - prev.y) > 20_000) return p;
  // Orientations du personnage et de la caméra : même prolongation, au même rythme, par le plus court chemin
  // (179° → −179° = 2°) ; sinon la flèche tremble sur la mini-carte qui tourne.
  const angle = (now: number | null | undefined, before: number | null | undefined) =>
    now == null || before == null ? now : now + (((((now - before) % 360) + 540) % 360) - 180) * k;
  return {
    ...p,
    x: p.x + (p.x - prev.x) * k, y: p.y + (p.y - prev.y) * k, z: p.z + (p.z - prev.z) * k,
    yaw: angle(p.yaw, prev.yaw) ?? null,
    camera: angle(p.camera, prev.camera),
  };
}
const listeners = new Set<() => void>();

export const live = {
  get status() {
    return status;
  },
  /** Dernière position connue, si elle date de moins de 3 secondes. */
  get position() {
    return position && Date.now() - position.at < 3000 && status.active ? position : null;
  },
  /** Position affichée maintenant : la dernière lue, prolongée selon la vitesse (voir `predict`). */
  predicted(now = Date.now()) {
    const p = live.position;
    return p ? predict(p, previous, now) : null;
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

const notify = () => listeners.forEach((fn) => fn());

export async function startLive() {
  status = await api.liveStatus().catch(() => OFF);
  await on.liveStatus((s) => {
    status = s;
    if (!s.active) {
      position = previous = null;
      recent.length = 0;
    }
    notify();
  });
  await on.position((p) => {
    recent.push(p);
    while (recent.length > 2 && p.at - recent[1].at >= SPEED_WINDOW_MS) recent.shift();
    previous = recent.length > 1 ? recent[0] : null;
    position = p;
    notify();
  });
}
