// Mode navigateur (développement uniquement) : simule le moteur Rust et les plugins Tauri
// pour pouvoir ouvrir l'interface sur http://localhost:1420 et la tester sans l'application.
// Les données sont gardées dans le localStorage du navigateur.

import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { MapData, PlayerState, Settings, Timer, TimerInput } from "./api";

const KEY = "sietch-mock";
type State = { timers: Timer[]; settings: Settings; store: Record<string, unknown>; widgetsEdit?: boolean };

const DEFAULT_SETTINGS: Settings = {
  serverOffsetMin: 60,
  serverLabel: "Europe",
  coriolisWeekday: 1,
  coriolisHour: 3,
  coriolisMinute: 0,
  coriolisReminders: [1440, 60, 10],
  dnd: false,
  closeToTray: true,
  startMinimized: false,
  overlayClickThrough: false,
  shortcuts: {
    marker: "Ctrl+Shift+M",
    timer: "Ctrl+Shift+T",
    "timer-last": "Ctrl+Shift+R",
    overlay: "Ctrl+Shift+O",
    "overlay-edit": "Ctrl+Shift+L",
    "overlay-next": "Ctrl+Shift+N",
    wiki: "Ctrl+Shift+W",
    map: "Ctrl+Shift+C",
  },
  liveModules: false,
  liveRegion: "hagga",
  calibration: {},
  playerAlerts: { water: 25, health: 30, power: 15, volume: 90, worm: 75, heat: 70 },
  mapImages: {},
  gaugeRings: ["health", "stamina", "hydration", "power", "inventory", "worm"],
  layouts: [{
    id: "exploration",
    name: "Exploration",
    widgets: (["clock", "coriolis", "sector", "timers", "health", "stamina", "hydration", "power", "inventory", "minimap", "gauges", "gear"] as const).map((kind) => ({ kind, shown: !["health", "stamina", "hydration", "power", "inventory"].includes(kind), pos: null, scale: 1, opacity: 100 })),
  }],
  activeLayout: "exploration",
};

function read(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "");
    return { timers: s.timers ?? [], settings: { ...DEFAULT_SETTINGS, ...s.settings }, store: s.store ?? {} };
  } catch {
    return { timers: [], settings: DEFAULT_SETTINGS, store: {} };
  }
}

let state = read();
const save = () => localStorage.setItem(KEY, JSON.stringify(state));

/** Personnage simulé : la vie et l'endurance oscillent, l'eau baisse lentement. */
function simPlayer(): PlayerState {
  const t = Date.now() / 1000;
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    health: r(100 + Math.sin(t / 4) * 50), healthMax: 150,
    stamina: r(60 + Math.sin(t / 2) * 40), staminaMax: 100,
    power: 150, powerMax: 150,
    hydration: r(100 - ((t / 3) % 100)), hydrationMax: 100,
    heat: 0, heatMax: 100, sunExposure: 0, heatstroke: 100,
    // Une journée du jeu en 4 minutes.
    timeOfDay: Math.floor(((t / 10) % 24) * 60) / 60,
    volume: 268.5, volumeMax: 1750, slots: 16, slotsMax: 35, wormThreat: 40,
    x: Math.cos(t * 0.15) * 400000 - 50000, y: Math.sin(t * 0.15) * 400000 - 50000, z: 0,
    // Tangente au cercle parcouru.
    yaw: Math.round(((t * 0.15 * 180) / Math.PI + 90) % 360),
  };
}

/** Carte simulée : limites du Bassin de Hagga, quelques zones et points d'intérêt. */
function simMap(): MapData {
  const kinds = ["station", "base", "epave", "mine", "autel"];
  return {
    layer: "BP_MapLayer_Survival_1_C_0",
    bounds: { minX: -457200, minY: -457200, maxX: 355600, maxY: 355600 },
    areas: Array.from({ length: 12 }, (_, i) => ({ kind: 0, circles: [[-300000 + i * 50000, -200000 + (i % 4) * 120000, 8000 + i * 1500] as [number, number, number]] })),
    pois: Array.from({ length: 30 }, (_, i) => ({ kind: kinds[i % 5], name: `CB_Simulation_${i}`, x: -400000 + (i * 73000) % 740000, y: -400000 + (i * 151000) % 740000, z: 0 })),
  };
}

/** Même calcul que `next_coriolis` côté Rust. */
function nextCoriolis(now: number, s: Settings) {
  const DAY = 86_400_000;
  const offset = s.serverOffsetMin * 60_000;
  const local = now + offset;
  const day = Math.floor(local / DAY);
  const weekday = (((day + 3) % 7) + 7) % 7;
  const ahead = (((s.coriolisWeekday - weekday) % 7) + 7) % 7;
  let target = (day + ahead) * DAY + (s.coriolisHour * 60 + s.coriolisMinute) * 60_000;
  if (target <= local) target += 7 * DAY;
  return target - offset;
}

const changed = () => {
  save();
  void emit("timers-changed");
};

function withTimer(id: string, f: (t: Timer) => void) {
  const t = state.timers.find((x) => x.id === id);
  if (!t) throw "Minuteur introuvable";
  f(t);
  changed();
}

function restart(t: Timer) {
  t.fired = false;
  t.remainingMs = 0;
  t.endsAt = Date.now() + t.durationSecs * 1000;
}

function handle(cmd: string, args: Record<string, any>): unknown {
  switch (cmd) {
    case "get_timers":
      return state.timers;
    case "save_timer": {
      const input = args.timer as TimerInput;
      if (!input.name.trim()) throw "Donnez un nom au minuteur.";
      if (input.durationSecs <= 0) throw "La durée doit être supérieure à zéro.";
      if (input.id) {
        withTimer(input.id, (t) => {
          const restartNeeded = t.durationSecs !== input.durationSecs;
          Object.assign(t, { ...input, id: t.id });
          if (restartNeeded) restart(t);
        });
        return input.id;
      }
      const id = `t${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      state.timers.push({ ...input, id, endsAt: Date.now() + input.durationSecs * 1000, remainingMs: 0, fired: false });
      changed();
      return id;
    }
    case "delete_timer":
      state.timers = state.timers.filter((t) => t.id !== args.id);
      changed();
      return null;
    case "pause_timer":
      return withTimer(args.id, (t) => {
        if (t.endsAt !== null) {
          t.remainingMs = Math.max(1, t.endsAt - Date.now());
          t.endsAt = null;
        }
      });
    case "resume_timer":
      return withTimer(args.id, (t) => {
        if (t.endsAt === null && !t.fired && t.remainingMs > 0) {
          t.endsAt = Date.now() + t.remainingMs;
          t.remainingMs = 0;
        }
      });
    case "restart_timer":
      return withTimer(args.id, restart);
    case "reorder_timers": {
      const ids: string[] = args.ids;
      const pos = (id: string) => (ids.includes(id) ? ids.indexOf(id) : Infinity);
      state.timers.sort((a, b) => pos(a.id) - pos(b.id));
      changed();
      return null;
    }
    case "get_settings":
      return state.settings;
    case "set_settings":
      state.settings = args.settings;
      save();
      void emit("settings-changed", state.settings);
      return [];
    case "set_dnd":
      state.settings = { ...state.settings, dnd: args.on };
      save();
      void emit("settings-changed", state.settings);
      return null;
    case "get_clock":
      return { now: Date.now(), serverOffsetMin: state.settings.serverOffsetMin, coriolisNext: nextCoriolis(Date.now(), state.settings) };
    case "get_live_status":
      return liveStatus();
    case "reload_live_config":
      return "/simulation/com.captainvii.sietch/position.json";
    case "test_alarm":
      void emit("alarm", { title: "Test d'alarme", body: "Les notifications de Sietch fonctionnent." });
      return null;
    case "request_raw_stats": {
      const p = simPlayer();
      return state.settings.liveModules
        ? [["DuneCharacterAttributeSet", "CurrentHealth", p.health], ["DuneCharacterAttributeSet", "MaxHealth", p.healthMax], ["DuneCharacterAttributeSet", "CurrentStamina", p.stamina], ["DuneHydrationAttributeSet", "CurrentHydration", p.hydration]].map(([set, name, value]) => ({ set, name, value }))
        : [];
    }
    case "get_map_image":
    case "import_map_image":
    case "remove_map_image":
      return null;
    case "get_resources":
      return [];
    case "get_trail": {
      // Les 20 dernières secondes du cercle parcouru par le joueur simulé (voir simPlayer).
      const t = Date.now() / 1000;
      return state.settings.liveModules
        ? Array.from({ length: 40 }, (_, i) => {
            const a = (t - 20 + i * 0.5) * 0.15;
            return [Math.cos(a) * 400000 - 50000, Math.sin(a) * 400000 - 50000];
          })
        : [];
    }
    case "clear_trail":
      void emit("trail", []);
      return null;
    case "get_map_data":
      return state.settings.liveModules ? simMap() : null;
    case "get_player_state":
      return state.settings.liveModules ? simPlayer() : null;
    case "get_widgets_edit":
      return state.widgetsEdit ?? false;
    case "toggle_widgets_edit":
      state.widgetsEdit = !state.widgetsEdit;
      void emit("widgets-edit", state.widgetsEdit);
      return null;
    case "toggle_overlay":
    case "show_wiki":
    case "show_main":
    case "open_site":
      console.info(`[simulation] ${cmd}`, args);
      return null;

    // Plugins
    case "plugin:store|load":
    case "plugin:store|get_store":
      return 1;
    case "plugin:store|get":
      return [state.store[args.key] ?? null, args.key in state.store];
    case "plugin:store|set":
      state.store[args.key] = args.value;
      save();
      return null;
    case "plugin:store|save":
      return null;
    case "plugin:app|version":
      return "0.1.0 (simulation)";
    case "plugin:path|resolve_directory":
      return "/simulation/com.captainvii.sietch";
    case "plugin:autostart|is_enabled":
      return false;
    case "plugin:dialog|save":
    case "plugin:dialog|open":
      return null;
    default:
      if (cmd.startsWith("plugin:opener|")) {
        window.open(args.url, "_blank");
        return null;
      }
      if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:autostart|")) return null;
      console.warn(`[simulation] commande non simulée : ${cmd}`, args);
      return null;
  }
}

/** En mode navigateur, les modules sans BattlEye tournent toujours en simulation. */
function liveStatus() {
  const on = state.settings.liveModules;
  return {
    gameRunning: true, battleyeRunning: false, enabled: on, configured: true,
    active: on, source: on ? "simulation" : "aucune", message: null,
  };
}

export function install(label = "main") {
  mockWindows(label);
  mockIPC((cmd, args) => handle(cmd, (args ?? {}) as Record<string, any>), { shouldMockEvents: true });

  // Boucle du « moteur » : fait sonner les minuteurs arrivés à échéance.
  setInterval(() => {
    const now = Date.now();
    let any = false;
    for (const t of state.timers) {
      if (t.endsAt === null || t.endsAt > now) continue;
      any = true;
      if (t.repeat) t.endsAt = Math.max(t.endsAt + t.durationSecs * 1000, now + 1000);
      else Object.assign(t, { endsAt: null, remainingMs: 0, fired: true });
      if (t.alarm && !state.settings.dnd) {
        void emit("alarm", { title: t.name, body: "Minuteur terminé." });
      }
    }
    if (any) changed();
  }, 500);

  // Position simulée (même trajectoire que SIETCH_SIMULATION=1 côté Rust).
  let lastEnabled: boolean | null = null;
  setInterval(() => {
    const on = state.settings.liveModules;
    if (on !== lastEnabled) {
      lastEnabled = on;
      void emit("live-status", liveStatus());
    }
    if (!on) return;
    const t = Date.now() / 1000;
    void emit("player-position", { x: Math.cos(t * 0.15) * 40000 + 10000, y: Math.sin(t * 0.15) * 40000 - 5000, z: 1200, at: Date.now() });
    void emit("player-state", simPlayer());
  }, 250);
  console.info("[simulation] Sietch tourne dans le navigateur avec un moteur simulé.");
}
