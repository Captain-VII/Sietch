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
const listeners = new Set<() => void>();

export const live = {
  get status() {
    return status;
  },
  /** Dernière position connue, si elle date de moins de 3 secondes. */
  get position() {
    return position && Date.now() - position.at < 3000 && status.active ? position : null;
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
    if (!s.active) position = null;
    notify();
  });
  await on.position((p) => {
    position = p;
    notify();
  });
}
