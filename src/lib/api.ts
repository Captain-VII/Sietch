import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type TimerGroup = "ressources" | "evenements" | "personnels";

export interface Timer {
  id: string;
  name: string;
  place: string;
  group: TimerGroup;
  durationSecs: number;
  endsAt: number | null;
  remainingMs: number;
  repeat: boolean;
  alarm: boolean;
  inOverlay: boolean;
  fired: boolean;
}

export type TimerInput = Omit<Timer, "id" | "endsAt" | "remainingMs" | "fired"> & { id?: string };

export interface Settings {
  serverOffsetMin: number;
  serverLabel: string;
  coriolisWeekday: number;
  coriolisHour: number;
  coriolisMinute: number;
  coriolisReminders: number[];
  dnd: boolean;
  closeToTray: boolean;
  startMinimized: boolean;
  overlayOpacity: number;
  overlayClickThrough: boolean;
  overlayPosition: string;
  shortcuts: Record<string, string>;
}

export interface Clock {
  now: number;
  serverOffsetMin: number;
  coriolisNext: number;
}

export interface Alarm {
  title: string;
  body: string;
}

export const api = {
  timers: () => invoke<Timer[]>("get_timers"),
  saveTimer: (timer: TimerInput) => invoke<string>("save_timer", { timer }),
  deleteTimer: (id: string) => invoke<void>("delete_timer", { id }),
  pauseTimer: (id: string) => invoke<void>("pause_timer", { id }),
  resumeTimer: (id: string) => invoke<void>("resume_timer", { id }),
  restartTimer: (id: string) => invoke<void>("restart_timer", { id }),
  reorderTimers: (ids: string[]) => invoke<void>("reorder_timers", { ids }),
  settings: () => invoke<Settings>("get_settings"),
  /** Renvoie la liste des raccourcis refusés par le système. */
  setSettings: (settings: Settings) => invoke<string[]>("set_settings", { settings }),
  setDnd: (on: boolean) => invoke<void>("set_dnd", { on }),
  clock: () => invoke<Clock>("get_clock"),
  toggleOverlay: () => invoke<void>("toggle_overlay"),
  showWiki: () => invoke<void>("show_wiki"),
  showMain: (view?: string) => invoke<void>("show_main", { view }),
  /** Ouvre awakening.wiki ou dune.gaming.tools dans la fenêtre de navigation de Sietch. */
  openSite: (url: string) => invoke<void>("open_site", { url }),
  testAlarm: () => invoke<void>("test_alarm"),
};

export const on = {
  timersChanged: (fn: () => void): Promise<UnlistenFn> => listen("timers-changed", fn),
  settingsChanged: (fn: (s: Settings) => void) => listen<Settings>("settings-changed", (e) => fn(e.payload)),
  alarm: (fn: (a: Alarm) => void) => listen<Alarm>("alarm", (e) => fn(e.payload)),
  navigate: (fn: (n: { view: string; action: string | null }) => void) =>
    listen<{ view: string; action: string | null }>("navigate", (e) => fn(e.payload)),
};

export const GROUPS: Record<TimerGroup, string> = {
  ressources: "Réapparition des ressources",
  evenements: "Événements",
  personnels: "Personnels",
};

export const SHORTCUT_LABELS: Record<string, string> = {
  marker: "Ajouter un marqueur",
  timer: "Démarrer un minuteur",
  overlay: "Afficher / masquer l'overlay",
  wiki: "Recherche wiki",
  map: "Ouvrir la carte",
};

/** "Ctrl+Shift+M" → "Ctrl+Maj+M" pour l'affichage. */
export function prettyKeys(accel: string): string {
  return accel ? accel.replace(/Shift/g, "Maj") : "—";
}
