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
  overlayClickThrough: boolean;
  shortcuts: Record<string, string>;
  liveModules: boolean;
  liveRegion: string;
  calibration: Record<string, CalibrationPoint[]>;
  /** Dispositions de widgets de l'overlay (au moins une). */
  layouts: Layout[];
  activeLayout: string;
}

export type WidgetKind = "clock" | "coriolis" | "sector" | "timers" | "health" | "stamina" | "hydration" | "power" | "inventory";

/** État du personnage lu dans le jeu (modules sans BattlEye), arrondi au dixième. */
export interface PlayerState {
  health: number;
  healthMax: number;
  stamina: number;
  staminaMax: number;
  power: number;
  powerMax: number;
  hydration: number;
  hydrationMax: number;
  heat: number;
  heatMax: number;
  sunExposure: number;
  /** Heure du jeu en heures (7.5 = 07:30), null si elle n'a pas été trouvée. */
  timeOfDay: number | null;
  /** Volume du sac et son maximum, null s'ils n'ont pas été trouvés. */
  volume: number | null;
  volumeMax: number | null;
  x: number;
  y: number;
  z: number;
}

/** Un widget de l'overlay : une petite fenêtre à part. */
export interface Widget {
  kind: WidgetKind;
  shown: boolean;
  /** Coin haut gauche à l'écran, en pixels logiques ; null : placé automatiquement. */
  pos: [number, number] | null;
  /** De 0.5 à 2. */
  scale: number;
  /** Opacité du widget, de 20 à 100. */
  opacity: number;
}

export interface Layout {
  id: string;
  name: string;
  widgets: Widget[];
}

/** Correspondance entre coordonnées du jeu (wx, wy) et position sur la carte (mx, my, de 0 à 900). */
export type { CalibrationPoint } from "./affine";
import type { CalibrationPoint } from "./affine";

export interface LiveStatus {
  gameRunning: boolean;
  battleyeRunning: boolean;
  enabled: boolean;
  configured: boolean;
  active: boolean;
  source: "memoire" | "simulation" | "aucune";
  message: string | null;
}

export interface PlayerPosition {
  x: number;
  y: number;
  z: number;
  at: number;
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
  /** Entre ou sort du mode édition des widgets (positions enregistrées en sortant). */
  toggleWidgetsEdit: () => invoke<void>("toggle_widgets_edit"),
  widgetsEdit: () => invoke<boolean>("get_widgets_edit"),
  showWiki: () => invoke<void>("show_wiki"),
  showMain: (view?: string) => invoke<void>("show_main", { view }),
  /** Ouvre awakening.wiki ou dune.gaming.tools dans la fenêtre de navigation de Sietch. */
  openSite: (url: string) => invoke<void>("open_site", { url }),
  testAlarm: () => invoke<void>("test_alarm"),
  liveStatus: () => invoke<LiveStatus>("get_live_status"),
  playerState: () => invoke<PlayerState | null>("get_player_state"),
  /** Relit position.json ; renvoie son chemin. */
  reloadLiveConfig: () => invoke<string>("reload_live_config"),
};

export const on = {
  timersChanged: (fn: () => void): Promise<UnlistenFn> => listen("timers-changed", fn),
  settingsChanged: (fn: (s: Settings) => void) => listen<Settings>("settings-changed", (e) => fn(e.payload)),
  alarm: (fn: (a: Alarm) => void) => listen<Alarm>("alarm", (e) => fn(e.payload)),
  liveStatus: (fn: (s: LiveStatus) => void) => listen<LiveStatus>("live-status", (e) => fn(e.payload)),
  playerState: (fn: (s: PlayerState) => void) => listen<PlayerState>("player-state", (e) => fn(e.payload)),
  position: (fn: (p: PlayerPosition) => void) => listen<PlayerPosition>("player-position", (e) => fn(e.payload)),
  widgetsEdit: (fn: (editing: boolean) => void) => listen<boolean>("widgets-edit", (e) => fn(e.payload)),
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
  "overlay-edit": "Placer les widgets",
  "overlay-next": "Disposition suivante",
  wiki: "Recherche wiki",
  map: "Ouvrir la carte",
};

/** "Ctrl+Shift+M" → "Ctrl+Maj+M" pour l'affichage. */
export function prettyKeys(accel: string): string {
  return accel ? accel.replace(/Shift/g, "Maj") : "—";
}
