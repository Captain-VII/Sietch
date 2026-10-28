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
  /** Moment où il a sonné (ms), null s'il n'est pas terminé. */
  firedAt?: number | null;
}

export type TimerInput = Omit<Timer, "id" | "endsAt" | "remainingMs" | "fired" | "firedAt"> & { id?: string };

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
  overlayHideInMenus: boolean;
  overlayOnlyInGame: boolean;
  autoLayout: boolean;
  shortcuts: Record<string, string>;
  liveModules: boolean;
  liveRegion: string;
  calibration: Record<string, CalibrationPoint[]>;
  /** Capture de la carte du jeu par région : [x0, y0, x1, y1] sur la carte (0 à 900). */
  mapImages: Record<string, [number, number, number, number]>;
  /** Anneaux du widget Jauges, dans l'ordre. */
  gaugeRings: WidgetKind[];
  /** Seuils des alertes du personnage, en % (0 = désactivée) ; volume : sac rempli au-delà. */
  playerAlerts: { water: number; health: number; power: number; volume: number; worm: number; heat: number };
  /** Dispositions de widgets de l'overlay (au moins une). */
  layouts: Layout[];
  activeLayout: string;
}

export type WidgetKind = "clock" | "coriolis" | "sector" | "timers" | "health" | "stamina" | "hydration" | "power" | "inventory" | "minimap" | "gauges" | "gear" | "threat" | "hits" | "worm";

/** Carte de la région lue dans le jeu : limites (cm), zones (cercles x, y, rayon) et points d'intérêt. */
export interface MapData {
  layer: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  areas: { kind: number; circles: [number, number, number][] }[];
  pois: { kind: string; name: string; x: number; y: number; z: number }[];
}

/** Générateur de ressources vu dans le jeu ; `live` s'il est chargé autour du joueur en ce moment. */
export interface SeenResource {
  region: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** Délai de réapparition, en secondes. */
  respawn: number;
  live: boolean;
}

/** Une valeur d'attribut du personnage (écran « Stats brutes »). */
export interface RawStat {
  set: string;
  name: string;
  value: number;
}

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
  heatstroke: number;
  /** Heure du jeu en heures (7.5 = 07:30), null si elle n'a pas été trouvée. */
  timeOfDay: number | null;
  /** Volume du sac et son maximum, null s'ils n'ont pas été trouvés. */
  volume: number | null;
  volumeMax: number | null;
  /** Emplacements occupés du sac et leur nombre. */
  slots: number | null;
  slotsMax: number | null;
  /** Menace du ver en % du seuil d'attaque (100 = attaque). */
  wormThreat: number | null;
  /** Arme en main, à bord d'un véhicule ; null tant que le champ n'est pas connu. */
  armed: boolean | null;
  inVehicle: boolean | null;
  /** Nom de la zone affiché par le jeu, dans sa langue (« Sud du Bassin de Hagga »). */
  zone: string | null;
  x: number;
  y: number;
  z: number;
  /** Orientation en degrés : 0 = est, 90 = sud (sens de la carte). */
  yaw: number;
}

/** Sessions de jeu : (début, fin) en ms ; `current` = début de la session en cours. */
export interface Playtime {
  sessions: [number, number][];
  current: number | null;
}

/** Jeu au premier plan, menu du jeu ouvert (curseur affiché). */
export interface GameFocus {
  foreground: boolean;
  menu: boolean;
}

/** Nouvelle version publiée sur GitHub. */
export interface UpdateInfo {
  version: string;
  notes: string;
}

/** Trajet de la session, en coordonnées du jeu ; `null` coupe le tracé (téléportation, mort). */
export type Trail = ([number, number] | null)[];

/** Journal de la partie en cours (modules sans BattlEye) : distance en mètres. */
export interface Session {
  start: number | null;
  distance: number;
  hits: number;
  kills: number;
  damage: number;
}

/** Coup porté : vie retirée à un personnage proche, `kill` quand elle tombe à 0. */
export interface Hit {
  damage: number;
  kill: boolean;
}

/** Écran de diagnostic des modules sans BattlEye (`live.rs::Diagnostic`). */
export interface Diagnostic {
  tables: boolean;
  character: boolean;
  reads: number;
  failures: number;
  lastRead: number | null;
  lastPosition: [number, number, number] | null;
  source: "personnage" | "chaine" | "";
  armed: boolean | null;
  inVehicle: boolean | null;
  resourcesKnown: number;
  lastScanSecs: number | null;
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
  /** Demande une relecture de tous les attributs du personnage ; renvoie la dernière lecture. */
  requestRawStats: () => invoke<RawStat[]>("request_raw_stats"),
  mapData: () => invoke<MapData | null>("get_map_data"),
  resources: () => invoke<SeenResource[]>("get_resources"),
  trail: () => invoke<Trail>("get_trail"),
  gameFocus: () => invoke<GameFocus>("get_game_focus"),
  playtime: () => invoke<Playtime>("get_playtime"),
  update: () => invoke<UpdateInfo | null>("get_update"),
  checkUpdate: () => invoke<UpdateInfo | null>("check_update"),
  installUpdate: () => invoke<void>("install_update"),
  clearTrail: () => invoke<void>("clear_trail"),
  diagnostic: () => invoke<Diagnostic>("get_diagnostic"),
  session: () => invoke<Session>("get_session"),
  importMapImage: (region: string, path: string) => invoke<string>("import_map_image", { region, path }),
  mapImage: (region: string) => invoke<string | null>("get_map_image", { region }),
  removeMapImage: (region: string) => invoke<void>("remove_map_image", { region }),
  gameIcons: () => invoke<Record<string, string>>("get_game_icons"),
  /** Relit position.json ; renvoie son chemin. */
  reloadLiveConfig: () => invoke<string>("reload_live_config"),
};

export const on = {
  timersChanged: (fn: () => void): Promise<UnlistenFn> => listen("timers-changed", fn),
  settingsChanged: (fn: (s: Settings) => void) => listen<Settings>("settings-changed", (e) => fn(e.payload)),
  alarm: (fn: (a: Alarm) => void) => listen<Alarm>("alarm", (e) => fn(e.payload)),
  liveStatus: (fn: (s: LiveStatus) => void) => listen<LiveStatus>("live-status", (e) => fn(e.payload)),
  mapData: (fn: (m: MapData | null) => void) => listen<MapData | null>("map-data", (e) => fn(e.payload)),
  resources: (fn: (r: SeenResource[]) => void) => listen<SeenResource[]>("resources", (e) => fn(e.payload)),
  playtime: (fn: (p: Playtime) => void) => listen<Playtime>("playtime", (e) => fn(e.payload)),
  gameFocus: (fn: (f: GameFocus) => void) => listen<GameFocus>("game-focus", (e) => fn(e.payload)),
  // Trajet remplacé (effacé, changement de région) ou prolongé de quelques points.
  trail: (fn: (t: Trail) => void) => listen<Trail>("trail", (e) => fn(e.payload)),
  trailPoint: (fn: (t: Trail) => void) => listen<Trail>("trail-point", (e) => fn(e.payload)),
  /** Coup porté à un personnage proche (modules sans BattlEye). */
  hit: (fn: (h: Hit) => void) => listen<Hit>("hit", (e) => fn(e.payload)),
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
  "timer-last": "Relancer le dernier minuteur terminé",
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
