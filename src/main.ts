import "leaflet/dist/leaflet.css";
import "./styles/theme.css";
import "./styles/components.css";
import "./styles/app.css";

import { api, on, type Settings, type Timer } from "./lib/api";
import { h, icon, logo, mount, toast } from "./lib/dom";
import { startLiveUpdates, syncClock } from "./lib/time";
import { DATABASE_URL, openExternal } from "./lib/wiki-browser";
import * as accueil from "./views/accueil";
import * as builds from "./views/builds";
import * as carte from "./views/carte";
import * as minuteurs from "./views/minuteurs";
import * as parametres from "./views/parametres";
import * as wiki from "./views/wiki";

export type ViewName = "accueil" | "carte" | "minuteurs" | "builds" | "wiki" | "parametres";

export interface Ctx {
  timers: () => Timer[];
  settings: () => Settings;
  go: (view: ViewName, action?: string | null) => void;
  saveSettings: (s: Settings) => Promise<string[]>;
}

/** Ce qu'un écran peut renvoyer pour réagir aux changements. */
export interface ViewHandle {
  onTimers?: () => void;
  onSettings?: () => void;
  dispose?: () => void;
}

type ViewModule = { render: (root: HTMLElement, ctx: Ctx, action?: string | null) => ViewHandle | void };

const VIEWS: Record<ViewName, { label: string; icon: string; module: ViewModule }> = {
  accueil: { label: "Accueil", icon: "home", module: accueil },
  carte: { label: "Carte", icon: "map", module: carte },
  minuteurs: { label: "Minuteurs", icon: "timer", module: minuteurs },
  builds: { label: "Builds", icon: "shield", module: builds },
  wiki: { label: "Wiki", icon: "book", module: wiki },
  parametres: { label: "Paramètres", icon: "gear", module: parametres },
};

/** En développement, hors de Tauri, on simule le moteur pour tester dans un navigateur. */
function boot(label: string): Promise<void> {
  const inTauri = "__TAURI_INTERNALS__" in window;
  return import.meta.env.DEV && !inTauri ? import("./lib/mock").then((m) => m.install(label)) : Promise.resolve();
}

let timers: Timer[] = [];
let settings: Settings;
let current: { name: ViewName; handle: ViewHandle } | null = null;
const navButtons = new Map<ViewName, HTMLButtonElement>();
const mainEl = h("main", { class: "main", id: "contenu", tabindex: "-1" });

const ctx: Ctx = {
  timers: () => timers,
  settings: () => settings,
  go,
  saveSettings: async (s) => {
    settings = s;
    return api.setSettings(s);
  },
};

function go(name: ViewName, action: string | null = null) {
  current?.handle.dispose?.();
  for (const [n, btn] of navButtons) {
    if (n === name) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  }
  mainEl.replaceChildren();
  mainEl.scrollTop = 0;
  const handle = VIEWS[name].module.render(mainEl, ctx, action) ?? {};
  current = { name, handle };
}

function navButton(name: ViewName) {
  const v = VIEWS[name];
  const btn = h("button", { class: "nav-link", type: "button", onclick: () => go(name) }, icon(v.icon), v.label);
  navButtons.set(name, btn);
  return btn;
}

function sidebar() {
  return h(
    "nav",
    { class: "sidebar", "aria-label": "Navigation principale" },
    h("div", { class: "brand" }, logo(42), h("div", { class: "stack", style: "--gap: 4px" },
      h("span", { class: "name" }, "SIETCH"),
      h("span", { class: "sub" }, "DUNE AWAKENING"),
    )),
    h("div", { class: "nav" },
      (["accueil", "carte", "minuteurs", "builds", "wiki"] as ViewName[]).map(navButton),
      h("div", { class: "nav-sep" }),
      h("button", { class: "nav-link", type: "button", onclick: () => api.toggleOverlay() }, icon("layers"), "Overlay"),
      h("button", { class: "nav-link", type: "button", title: "dune.gaming.tools", onclick: () => void openExternal(DATABASE_URL) }, icon("external"), "Base de données"),
      navButton("parametres"),
    ),
    h("div", { class: "server-clock" },
      h("span", { class: "label", style: "font-family: var(--font-label); font-weight: 600; letter-spacing: 0.2em; font-size: 12px" }, "Heure serveur"),
      h("span", { class: "digits", "data-clock": "" }, "--:--"),
      h("span", { class: "muted", id: "server-label" }),
    ),
  );
}

function updateServerLabel() {
  const el = document.getElementById("server-label");
  if (el) el.textContent = settings.serverLabel || "Serveur";
}

async function refreshTimers() {
  timers = await api.timers();
  current?.handle.onTimers?.();
}

async function start() {
  const [s, t] = await Promise.all([api.settings(), api.timers(), syncClock()]);
  settings = s;
  timers = t;
  mount(document.getElementById("app")!, h("div", { class: "app" }, sidebar(), mainEl));
  updateServerLabel();
  go("accueil");
  startLiveUpdates(() => timers);

  await on.timersChanged(() => void refreshTimers());
  await on.settingsChanged(async (s) => {
    settings = s;
    updateServerLabel();
    await syncClock();
    current?.handle.onSettings?.();
  });
  await on.navigate(({ view, action }) => {
    if (view in VIEWS) go(view as ViewName, action);
  });
  await on.alarm((a) => {
    toast(a.title, a.body);
  });
}

boot("main").then(start).catch((e) => {
  console.error(e);
  mount(document.getElementById("app")!, h("p", { class: "empty", style: "margin: 40px" }, `Sietch n'a pas pu démarrer : ${e}`));
});
