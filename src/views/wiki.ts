import type { Ctx, ViewHandle } from "../main";
import { api } from "../lib/api";
import { h, icon, mount } from "../lib/dom";
import { CATEGORIES, renderArticle, searchWiki, type WikiEntry } from "../lib/wiki";

let lastQuery = "";
let lastCat = "Tout";
let lastId: string | null = null;

export function render(root: HTMLElement, ctx: Ctx): ViewHandle {
  const search = h("input", {
    class: "input search", id: "recherche-wiki", type: "search", value: lastQuery,
    placeholder: "Rechercher une ressource, un objet, un lieu…", style: "min-height: 52px; font-size: 17px",
  });
  const chips = h("div", { class: "row wrap", style: "--gap: 8px" });
  const results = h("section", { class: "stack", style: "--gap: 8px; flex: 1 1 260px; min-width: 0", "aria-label": "Résultats" });
  const article = h("div", { class: "card", style: "flex: 3 1 480px; padding: 32px" });

  function draw() {
    const found = searchWiki(lastQuery, lastCat);
    const pick: WikiEntry | undefined = found.find((e) => e.id === lastId) ?? found[0];
    lastId = pick?.id ?? null;
    mount(chips, CATEGORIES.map((c) =>
      h("button", {
        class: "chip solid", type: "button", "aria-pressed": String(c === lastCat),
        onclick: () => {
          lastCat = c;
          draw();
        },
      }, c)));
    mount(
      results,
      h("span", { class: "muted", style: "font-size: 13px" }, `${found.length} résultat${found.length > 1 ? "s" : ""}`),
      found.map((e) =>
        h("button", {
          class: "pick", type: "button", "aria-pressed": String(e.id === lastId),
          onclick: () => {
            lastId = e.id;
            draw();
          },
        }, h("span", { class: "title" }, e.title), h("span", { class: "muted", style: "font-size: 13px" }, e.cat)),
      ),
    );
    if (!pick) {
      mount(article, h("p", { class: "muted", style: "margin: 0" }, "Aucun article ne correspond à cette recherche."));
      return;
    }
    mount(article, renderArticle(pick,
      h("div", { class: "row wrap", style: "margin-top: 8px" },
        h("button", { class: "btn btn-accent", type: "button", onclick: () => ctx.go("carte") }, "Voir sur la carte"),
        h("button", { class: "btn", type: "button", onclick: () => ctx.go("minuteurs", "new-timer") }, "Créer un minuteur"),
      )));
  }

  search.addEventListener("input", () => {
    lastQuery = search.value;
    lastId = null;
    draw();
  });

  mount(
    root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Encyclopédie d'Arrakis"), h("h1", { class: "h1" }, "Wiki")),
      h("button", { class: "btn", type: "button", onclick: () => api.showWiki() }, icon("external", 16), "Ouvrir dans une fenêtre"),
    ),
    h("div", { class: "stack", style: "--gap: 14px" }, h("label", { class: "sr-only", for: "recherche-wiki" }, "Rechercher dans le wiki"), search, chips),
    h("div", { class: "columns" }, results, article),
  );
  draw();
  search.focus();
  return {};
}
