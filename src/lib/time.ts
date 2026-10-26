import { api, type Clock, type Timer } from "./api";

let clock: Clock | null = null;
/** Écart entre l'horloge du système et celle vue par l'interface. */
let skew = 0;

export async function syncClock() {
  clock = await api.clock();
  skew = clock.now - Date.now();
}

export const now = () => Date.now() + skew;

/** Heure serveur "HH:MM". */
export function serverTime(): string {
  const offset = (clock?.serverOffsetMin ?? 0) * 60_000;
  const d = new Date(now() + offset);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function coriolisNext(): number {
  return clock?.coriolisNext ?? now();
}

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** 754000 → "00:12:34". */
export function hms(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function parts(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return { d: Math.floor(m / 1440), h: Math.floor((m % 1440) / 60), m: m % 60 };
}

/** "2 j 14 h 07" */
export function shortCountdown(ms: number): string {
  const p = parts(ms);
  if (p.d > 0) return `${p.d} j ${p.h} h ${pad(p.m)}`;
  if (p.h > 0) return `${p.h} h ${pad(p.m)}`;
  return hms(ms);
}

export function durationLabel(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h && m) return `${h} h ${pad(m)}`;
  if (h) return `${h} h`;
  return `${m} min`;
}

export function remaining(t: Timer): number {
  if (t.fired) return 0;
  if (t.endsAt !== null) return Math.max(0, t.endsAt - now());
  return t.remainingMs;
}

/** Part écoulée, de 0 à 1. */
export function progress(t: Timer): number {
  if (t.fired) return 1;
  return 1 - remaining(t) / (t.durationSecs * 1000);
}

export function timerStatus(t: Timer): "running" | "paused" | "done" {
  if (t.fired) return "done";
  return t.endsAt === null ? "paused" : "running";
}

/**
 * Met à jour chaque demi-seconde les éléments marqués :
 * - `data-timer="<id>"` + `data-part="left|bar"` ;
 * - `data-clock` (heure serveur), `data-coriolis` (compte à rebours), `data-coriolis-part="d|h|m"`.
 */
export function startLiveUpdates(getTimers: () => Timer[]) {
  let lastSync = Date.now();
  const update = () => {
    const byId = new Map(getTimers().map((t) => [t.id, t]));
    document.querySelectorAll<HTMLElement>("[data-timer]").forEach((el) => {
      const t = byId.get(el.dataset.timer!);
      if (!t) return;
      if (el.dataset.part === "bar") el.style.width = `${(progress(t) * 100).toFixed(1)}%`;
      else el.textContent = t.fired ? "Prêt" : hms(remaining(t));
    });
    const clockText = serverTime();
    document.querySelectorAll<HTMLElement>("[data-clock]").forEach((el) => (el.textContent = clockText));
    const left = coriolisNext() - now();
    const p = parts(left);
    document.querySelectorAll<HTMLElement>("[data-coriolis]").forEach((el) => (el.textContent = shortCountdown(left)));
    document.querySelectorAll<HTMLElement>("[data-coriolis-part]").forEach((el) => {
      el.textContent = pad(p[el.dataset.coriolisPart as "d" | "h" | "m"]);
    });
    // La tempête passée, on redemande la suivante ; sinon on resynchronise toutes les 10 min.
    if (left <= 0 || Date.now() - lastSync > 600_000) {
      lastSync = Date.now();
      void syncClock();
    }
  };
  update();
  return window.setInterval(update, 500);
}
