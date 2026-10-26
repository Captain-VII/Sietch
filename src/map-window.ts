// Fenêtre de carte dédiée : la carte seule, en plein cadre, qui suit le joueur.

import "leaflet/dist/leaflet.css";
import "./styles/theme.css";
import "./styles/components.css";
import "./styles/app.css";

import type { Ctx, ViewHandle } from "./main";
import { api, on, type Settings, type Timer } from "./lib/api";
import { h, mount } from "./lib/dom";
import { startLive } from "./lib/live";
import { render } from "./views/carte";

/** En développement, hors de Tauri, on simule le moteur pour tester dans un navigateur. */
function boot(label: string): Promise<void> {
  const inTauri = "__TAURI_INTERNALS__" in window;
  return import.meta.env.DEV && !inTauri ? import("./lib/mock").then((m) => m.install(label)) : Promise.resolve();
}

async function start() {
  let settings: Settings = await api.settings();
  let timers: Timer[] = await api.timers();
  const root = document.getElementById("app")!;
  const ctx: Ctx = {
    timers: () => timers,
    settings: () => settings,
    // Les autres écrans sont dans la fenêtre principale.
    go: (view) => void api.showMain(view),
    saveSettings: async (s) => {
      settings = s;
      return api.setSettings(s);
    },
  };
  await startLive();
  const handle: ViewHandle = render(root, ctx, null, { solo: true });

  await on.settingsChanged((s) => {
    settings = s;
    handle.onSettings?.();
  });
  await on.timersChanged(async () => {
    timers = await api.timers();
  });
  // Les marqueurs se modifient dans la fenêtre principale : on les relit quand on revient ici.
  window.addEventListener("focus", () => handle.onTimers?.());
}

boot("map").then(start).catch((e) => {
  console.error(e);
  mount(document.getElementById("app")!, h("p", { class: "empty", style: "margin: 40px" }, `La carte n'a pas pu s'ouvrir : ${e}`));
});
