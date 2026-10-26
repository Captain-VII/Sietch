import "./styles/theme.css";
import "./styles/components.css";
import "./styles/overlay.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, on, type Settings, type Timer } from "./lib/api";
import { markers, sectorOf } from "./lib/data";
import { live, solveAffine, startLive, toMap } from "./lib/live";
import { h, icon, logo, mount } from "./lib/dom";
import { remaining, startLiveUpdates, syncClock } from "./lib/time";

/** En développement, hors de Tauri, on simule le moteur pour tester dans un navigateur. */
function boot(label: string): Promise<void> {
  const inTauri = "__TAURI_INTERNALS__" in window;
  return import.meta.env.DEV && !inTauri ? import("./lib/mock").then((m) => m.install(label)) : Promise.resolve();
}

let timers: Timer[] = [];
let settings: Settings;
const panel = h("div", { class: "overlay" });
const timersBox = h("div", { class: "stack", style: "--gap: 10px" });
const sectorBox = h("div", { class: "row", style: "--gap: 12px" });

function applyOpacity() {
  panel.style.setProperty("--alpha", String(settings.overlayOpacity / 100));
}

function drawTimers() {
  const list = timers
    .filter((t) => t.inOverlay)
    .sort((a, b) => Number(a.fired) - Number(b.fired) || remaining(a) - remaining(b))
    .slice(0, 6);
  mount(
    timersBox,
    list.length
      ? list.map((t) =>
          h("div", { class: "stack", style: "--gap: 5px" },
            h("div", { class: "row spread", style: "--gap: 8px" },
              h("span", { class: "name" }, t.endsAt === null && !t.fired ? `${t.name} (pause)` : t.name),
              h("span", { class: "digits", style: "font-size: 12px", "data-timer": t.id, "data-part": "left" })),
            h("div", { class: "bar", style: "height: 3px" }, h("span", { "data-timer": t.id, "data-part": "bar" })),
          ))
      : h("span", { class: "muted", style: "font-size: 13px" }, "Aucun minuteur à afficher."),
  );
}

/** Secteur en direct si la position est connue et la carte calibrée, sinon dernier marqueur. */
async function drawSector() {
  const p = live.position;
  const t = p ? solveAffine(settings.calibration[settings.liveRegion]) : null;
  if (p && t) {
    const m = toMap(t, p.x, p.y);
    mount(
      sectorBox,
      h("span", { class: "digits", style: "font-size: 22px; color: var(--water)" }, sectorOf(Math.max(0, Math.min(899, m.x)), Math.max(0, Math.min(899, m.y)))),
      h("div", { class: "stack", style: "--gap: 2px; min-width: 0" },
        h("span", { class: "label", style: "font-size: 11px" }, "Position en direct"),
        h("span", { class: "name" }, settings.liveRegion === "profond" ? "Désert profond" : "Bassin de Hagga")),
    );
    return;
  }
  const last = (await markers.all()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!last) {
    mount(sectorBox, h("span", { class: "muted", style: "font-size: 13px" }, "Aucun marqueur suivi."));
    return;
  }
  mount(
    sectorBox,
    h("span", { class: "digits", style: "font-size: 22px" }, sectorOf(last.x, last.y)),
    h("div", { class: "stack", style: "--gap: 2px; min-width: 0" },
      h("span", { class: "label", style: "font-size: 11px" }, "Dernier marqueur"),
      h("span", { class: "name" }, last.name)),
  );
}

async function start() {
  [settings, timers] = await Promise.all([api.settings(), api.timers()]);
  await syncClock();
  applyOpacity();

  const win = getCurrentWindow();
  mount(
    panel,
    h("div", { class: "row spread drag", "data-tauri-drag-region": "" },
      h("div", { class: "row", style: "--gap: 8px; pointer-events: none" }, logo(20), h("span", { class: "title" }, "SIETCH")),
      h("div", { class: "row", style: "--gap: 4px" },
        h("button", { class: "icon-btn small", type: "button", "aria-label": "Ouvrir la fenêtre principale", title: "Ouvrir Sietch", onclick: () => api.showMain() }, icon("external", 15)),
        h("button", { class: "icon-btn small", type: "button", "aria-label": "Masquer l'overlay", title: "Masquer", onclick: () => win.hide() }, icon("close", 15)),
      ),
    ),
    h("div", { class: "row spread", style: "align-items: baseline" },
      h("span", { class: "digits clock", "data-clock": "" }, "--:--"),
      h("span", { class: "muted", style: "font-size: 12px" }, "heure serveur")),
    h("div", { class: "coriolis-line" },
      h("span", { class: "label", style: "color: var(--spice); font-family: var(--font-label); font-weight: 600; letter-spacing: 0.18em" }, "Coriolis"),
      h("span", { class: "digits", style: "font-size: 13px", "data-coriolis": "" })),
    sectorBox,
    h("div", { class: "stack", style: "--gap: 10px" },
      h("span", { class: "label", style: "font-family: var(--font-label); font-weight: 600; letter-spacing: 0.2em; color: var(--text-soft)" }, "Minuteurs"),
      timersBox),
    h("span", { class: "muted hint" }, "Glisser le bandeau pour déplacer · réglages dans Paramètres › Overlay"),
  );
  mount(document.getElementById("app")!, panel);
  drawTimers();
  void drawSector();
  startLiveUpdates(() => timers);
  await startLive();
  // Le secteur change rarement : on ne redessine qu'à chaque changement de secteur.
  let lastKey = "";
  live.subscribe(() => {
    const p = live.position;
    const t = p ? solveAffine(settings.calibration[settings.liveRegion]) : null;
    const key = p && t ? (() => { const m = toMap(t, p.x, p.y); return sectorOf(m.x, m.y); })() : "aucun";
    if (key !== lastKey) {
      lastKey = key;
      void drawSector();
    }
  });

  await on.timersChanged(async () => {
    timers = await api.timers();
    drawTimers();
  });
  await on.settingsChanged(async (s) => {
    settings = s;
    applyOpacity();
    await syncClock();
  });
  // Le dernier marqueur a pu changer pendant que l'overlay était masqué.
  await win.onFocusChanged(() => void drawSector());
  window.addEventListener("focus", () => void drawSector());
}

void boot("overlay").then(start);
