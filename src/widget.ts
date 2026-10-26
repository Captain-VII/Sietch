import "./styles/theme.css";
import "./styles/components.css";
import "./styles/widget.css";

import { api, on, type Settings, type Widget, type WidgetKind } from "./lib/api";
import { h, mount } from "./lib/dom";
import { startLiveUpdates, syncClock } from "./lib/time";

/** Un widget de l'overlay : une petite fenêtre par élément, ouverte par le moteur (`widget.html?kind=…`). */
const kind = new URLSearchParams(location.search).get("kind") as WidgetKind;
const card = h("div", { class: "widget" });

function config(s: Settings): Widget | undefined {
  return s.layouts.find((l) => l.id === s.activeLayout)?.widgets.find((w) => w.kind === kind);
}

function apply(s: Settings) {
  const w = config(s);
  if (!w) return;
  card.style.setProperty("--alpha", String(w.opacity / 100));
  document.documentElement.style.setProperty("--scale", String(w.scale));
}

function content() {
  switch (kind) {
    case "clock":
      return [
        h("span", { class: "w-label" }, "Heure serveur"),
        h("span", { class: "digits w-big", "data-clock": "" }, "--:--"),
      ];
    default:
      return [h("span", { class: "w-label" }, kind), h("span", { class: "muted" }, "Bientôt")];
  }
}

async function start() {
  const settings = await api.settings();
  await syncClock();
  apply(settings);
  mount(card, ...content());
  mount(document.getElementById("app")!, card);
  startLiveUpdates(() => []);
  await on.settingsChanged(async (s) => {
    apply(s);
    await syncClock();
  });
}

void start();
