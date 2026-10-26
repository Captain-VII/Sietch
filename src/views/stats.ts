import type { Ctx, ViewHandle } from "../main";
import { api, type RawStat } from "../lib/api";
import { h, mount } from "../lib/dom";
import { live } from "../lib/live";

/** « DuneHydrationAttributeSet » → « Hydration ». */
function setLabel(set: string) {
  return set.replace(/^Dune/, "").replace(/AttributeSet$/, "") || set;
}

function format(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 3 : 1);
}

/** Toutes les valeurs d'attributs du personnage, relues chaque seconde tant que l'écran est ouvert. */
export function render(root: HTMLElement, _ctx: Ctx): ViewHandle {
  const search = h("input", { class: "input search", type: "search", placeholder: "Health, Stamina, Hydration…", "aria-label": "Filtrer les valeurs" });
  const status = h("span", { class: "muted" });
  const list = h("div", { class: "grid-auto", style: "--min: 360px" });
  let stats: RawStat[] = [];

  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = stats.filter((s) => !q || s.name.toLowerCase().includes(q) || s.set.toLowerCase().includes(q));
    const sets = [...new Set(shown.map((s) => s.set))];
    status.textContent = stats.length
      ? `${shown.length} valeurs sur ${stats.length}, relues chaque seconde`
      : live.status.active
        ? "Lecture en cours…"
        : "Rien à lire : le jeu doit tourner sans BattlEye, avec la position en direct activée (Paramètres › Sans BattlEye).";
    mount(list, sets.map((set) =>
      h("section", { class: "card tight" },
        h("h2", { class: "section-title" }, setLabel(set)),
        h("div", {}, shown.filter((s) => s.set === set).map((s) =>
          h("div", { class: "setting-row", style: "padding: 6px 0" },
            h("span", { class: "soft", style: "font-size: 14px; word-break: break-all" }, s.name),
            h("span", { class: "digits" }, format(s.value))))),
      )));
  }

  async function refresh() {
    stats = await api.requestRawStats();
    draw();
  }

  search.addEventListener("input", draw);
  mount(root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Personnage en direct"), h("h1", { class: "h1" }, "Stats brutes")),
      search),
    status,
    list,
  );
  void refresh();
  const timer = window.setInterval(() => void refresh(), 1000);
  return { dispose: () => window.clearInterval(timer) };
}
