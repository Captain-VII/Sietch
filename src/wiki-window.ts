import "./styles/theme.css";
import "./styles/components.css";
import "./styles/app.css";
import "./styles/window.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./lib/api";
import { h, icon, logo, mount } from "./lib/dom";
import { renderArticle, searchWiki, WIKI } from "./lib/wiki";

/** En développement, hors de Tauri, on simule le moteur pour tester dans un navigateur. */
function boot(label: string): Promise<void> {
  const inTauri = "__TAURI_INTERNALS__" in window;
  return import.meta.env.DEV && !inTauri ? import("./lib/mock").then((m) => m.install(label)) : Promise.resolve();
}

function main() {
  const win = getCurrentWindow();
  let query = "";
  let currentId: string | null = WIKI[0]?.id ?? null;
  const history: string[] = [];
  let pos = -1;
  let pinned = false;

  const results = h("div", { class: "results", role: "list", "aria-label": "Résultats" });
  const article = h("div", { class: "content" });
  const back = h("button", { class: "icon-btn", type: "button", "aria-label": "Article précédent", onclick: () => move(-1) }, icon("chevronLeft", 16));
  const forward = h("button", { class: "icon-btn", type: "button", "aria-label": "Article suivant", onclick: () => move(1) }, icon("chevronRight", 16));
  const pin = h("button", {
    class: "win-btn", type: "button", "aria-label": "Toujours au premier plan", "aria-pressed": "false",
    onclick: async () => {
      pinned = !pinned;
      await win.setAlwaysOnTop(pinned);
      pin.setAttribute("aria-pressed", String(pinned));
    },
  }, icon("pin", 14));

  function open(id: string, record = true) {
    currentId = id;
    if (record) {
      history.splice(pos + 1);
      history.push(id);
      pos = history.length - 1;
    }
    draw();
  }

  function move(step: number) {
    const next = pos + step;
    if (next < 0 || next >= history.length) return;
    pos = next;
    open(history[pos], false);
  }

  function draw() {
    const found = searchWiki(query);
    mount(
      results,
      h("span", { class: "label", style: "font-size: 12px; padding: 0 4px 4px" }, `${found.length} résultat${found.length > 1 ? "s" : ""}`),
      found.map((e) =>
        h("button", { class: "pick compact", type: "button", "aria-pressed": String(e.id === currentId), onclick: () => open(e.id) },
          h("span", { class: "title" }, e.title), h("span", { class: "muted", style: "font-size: 13px" }, e.cat))),
    );
    const entry = WIKI.find((e) => e.id === currentId);
    mount(article, entry
      ? renderArticle(entry, h("div", { class: "row wrap", style: "margin-top: 6px" },
          h("button", { class: "btn btn-accent", type: "button", onclick: () => api.showMain("carte") }, "Voir sur la carte"),
          h("button", { class: "btn", type: "button", onclick: () => api.showMain("minuteurs") }, "Créer un minuteur")))
      : h("p", { class: "muted" }, "Choisissez un article."));
    back.disabled = pos <= 0;
    forward.disabled = pos >= history.length - 1;
  }

  const search = h("input", { class: "input search grow", id: "wf-recherche", type: "search", placeholder: "Rechercher dans le wiki…" });
  search.addEventListener("input", () => {
    query = search.value;
    const first = searchWiki(query)[0];
    if (first && first.id !== currentId) open(first.id);
    else draw();
  });

  mount(
    document.getElementById("app")!,
    h("div", { class: "window" },
      h("header", { class: "titlebar", "data-tauri-drag-region": "" },
        h("div", { class: "row", style: "--gap: 10px; pointer-events: none" }, logo(18), h("span", { class: "win-title" }, "WIKI — SIETCH")),
        h("div", { class: "row", style: "--gap: 0; height: 100%" },
          pin,
          h("button", { class: "win-btn", type: "button", "aria-label": "Réduire", onclick: () => win.minimize() }, icon("minimize", 14)),
          h("button", { class: "win-btn", type: "button", "aria-label": "Agrandir", onclick: () => win.toggleMaximize() }, icon("maximize", 14)),
          h("button", { class: "win-btn close", type: "button", "aria-label": "Fermer", onclick: () => win.hide() }, icon("close", 14)),
        ),
      ),
      h("div", { class: "toolbar" }, back, forward, h("label", { class: "sr-only", for: "wf-recherche" }, "Rechercher dans le wiki"), search),
      h("div", { class: "split" }, results, article),
    ),
  );
  if (currentId) open(currentId);

  // Ouvrir la fenêtre (raccourci ou bouton) place directement le curseur dans la recherche.
  void win.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      search.focus();
      search.select();
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") void win.hide();
    if (e.altKey && e.key === "ArrowLeft") move(-1);
    if (e.altKey && e.key === "ArrowRight") move(1);
  });
}

void boot("wiki").then(main);
