import "./styles/theme.css";
import "./styles/components.css";
import "./styles/widget.css";

import { api, on, type Settings, type Timer, type Widget, type WidgetKind } from "./lib/api";
import { markers, sectorOf } from "./lib/data";
import { h, mount } from "./lib/dom";
import { live, solveAffine, startLive, toMap } from "./lib/live";
import { remaining, startLiveUpdates, syncClock } from "./lib/time";

/** Un widget de l'overlay : une petite fenêtre par élément, ouverte par le moteur (`widget.html?kind=…`). */
const kind = new URLSearchParams(location.search).get("kind") as WidgetKind;
const card = h("div", { class: "widget" });
let settings: Settings;
let timers: Timer[] = [];

function config(s: Settings): Widget | undefined {
  return s.layouts.find((l) => l.id === s.activeLayout)?.widgets.find((w) => w.kind === kind);
}

function apply(s: Settings) {
  const w = config(s);
  if (!w) return;
  card.style.opacity = String(w.opacity / 100);
  document.documentElement.style.setProperty("--scale", String(w.scale));
}

function line(label: string, value: HTMLElement) {
  return [h("span", { class: "w-label" }, label), value];
}

// ---------- Minuteurs ----------

function drawTimers() {
  const list = timers
    .filter((t) => t.inOverlay)
    .sort((a, b) => Number(b.fired) - Number(a.fired) || remaining(a) - remaining(b))
    .slice(0, 5);
  mount(
    card,
    h("span", { class: "w-label" }, "Minuteurs"),
    list.length
      ? list.map((t) =>
          h("div", { class: t.fired ? "w-timer ready" : "w-timer" },
            h("span", { class: "w-name" }, t.endsAt === null && !t.fired ? `${t.name} (pause)` : t.name),
            h("span", { class: "digits w-mid", "data-timer": t.id, "data-part": "left" })))
      : h("span", { class: "w-soft" }, "Aucun minuteur"),
  );
}

// ---------- Secteur ----------

/** Secteur en direct si la position est connue et la carte calibrée, sinon dernier marqueur. */
async function drawSector() {
  const p = live.position;
  const t = p ? solveAffine(settings.calibration[settings.liveRegion]) : null;
  if (p && t) {
    const m = toMap(t, p.x, p.y);
    const sector = sectorOf(Math.max(0, Math.min(899, m.x)), Math.max(0, Math.min(899, m.y)));
    const region = settings.liveRegion === "profond" ? "Désert profond" : "Hagga";
    mount(card, ...line("Secteur", h("span", { class: "digits w-mid live" }, `${sector} · ${region}`)));
    return;
  }
  const last = (await markers.all()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  mount(
    card,
    ...(last
      ? line("Dernier marqueur", h("span", { class: "digits w-mid" }, `${sectorOf(last.x, last.y)} · ${last.name}`))
      : line("Secteur", h("span", { class: "w-soft" }, "Inconnu"))),
  );
}

function sectorKey() {
  const p = live.position;
  const t = p ? solveAffine(settings.calibration[settings.liveRegion]) : null;
  if (!p || !t) return "aucun";
  const m = toMap(t, p.x, p.y);
  return sectorOf(m.x, m.y);
}

// ---------- Démarrage ----------

async function start() {
  [settings, timers] = await Promise.all([api.settings(), api.timers()]);
  await syncClock();
  apply(settings);
  mount(document.getElementById("app")!, card);

  switch (kind) {
    case "clock":
      mount(card, ...line("Heure serveur", h("span", { class: "digits w-big", "data-clock": "" }, "--:--")));
      break;
    case "coriolis":
      mount(card, ...line("Coriolis", h("span", { class: "digits w-mid", "data-coriolis": "" })));
      break;
    case "timers":
      drawTimers();
      await on.timersChanged(async () => {
        timers = await api.timers();
        drawTimers();
      });
      break;
    case "sector": {
      void drawSector();
      await startLive();
      // Le secteur change rarement : on ne redessine qu'à chaque changement.
      let lastKey = sectorKey();
      live.subscribe(() => {
        const key = sectorKey();
        if (key !== lastKey) {
          lastKey = key;
          void drawSector();
        }
      });
      // Un marqueur a pu être ajouté depuis la fenêtre principale.
      window.setInterval(() => {
        if (sectorKey() === "aucun") void drawSector();
      }, 10_000);
      break;
    }
  }
  startLiveUpdates(() => timers);

  await on.settingsChanged(async (s) => {
    settings = s;
    apply(s);
    await syncClock();
    if (kind === "sector") void drawSector();
  });
}

/** En développement, hors de Tauri, on simule le moteur pour tester dans un navigateur. */
function boot(label: string): Promise<void> {
  const inTauri = "__TAURI_INTERNALS__" in window;
  return import.meta.env.DEV && !inTauri ? import("./lib/mock").then((m) => m.install(label)) : Promise.resolve();
}

void boot("widget").then(start);
