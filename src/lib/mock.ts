// Mode navigateur (développement uniquement) : simule le moteur Rust et les plugins Tauri
// pour pouvoir ouvrir l'interface sur http://localhost:1420 et la tester sans l'application.
// Les données sont gardées dans le localStorage du navigateur.

import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Settings, Timer, TimerInput } from "./api";

const KEY = "sietch-mock";
type State = { timers: Timer[]; settings: Settings; store: Record<string, unknown> };

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
  overlayOpacity: 85,
  overlayClickThrough: false,
  overlayPosition: "top-right",
  shortcuts: {
    marker: "Ctrl+Shift+M",
    timer: "Ctrl+Shift+T",
    overlay: "Ctrl+Shift+O",
    wiki: "Ctrl+Shift+W",
    map: "Ctrl+Shift+C",
  },
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
    case "test_alarm":
      void emit("alarm", { title: "Test d'alarme", body: "Les notifications de Sietch fonctionnent." });
      return null;
    case "toggle_overlay":
    case "show_wiki":
    case "show_main":
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
      if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:autostart|")) return null;
      console.warn(`[simulation] commande non simulée : ${cmd}`, args);
      return null;
  }
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
  console.info("[simulation] Sietch tourne dans le navigateur avec un moteur simulé.");
}
