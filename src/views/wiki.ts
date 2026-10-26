import type { Ctx, ViewHandle } from "../main";
import { api } from "../lib/api";
import { h, icon, mount } from "../lib/dom";
import { DATABASE_URL, openExternal, WikiBrowser } from "../lib/wiki-browser";

// Le navigateur survit aux changements d'écran : on retrouve sa recherche et son article.
let browser: WikiBrowser | null = null;

export function render(root: HTMLElement, _ctx: Ctx): ViewHandle {
  const first = !browser;
  browser ??= new WikiBrowser();
  const b = browser;
  b.search.id = "recherche-wiki";
  b.search.style.cssText = "min-height: 52px; font-size: 17px";

  mount(
    root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Wiki communautaire et base de données"), h("h1", { class: "h1" }, "Wiki")),
      h("div", { class: "row wrap" },
        h("button", { class: "btn", type: "button", onclick: () => void openExternal(DATABASE_URL) }, icon("external", 16), "dune.gaming.tools"),
        h("button", { class: "btn", type: "button", onclick: () => api.showWiki() }, icon("external", 16), "Ouvrir dans une fenêtre"),
      ),
    ),
    h("div", { class: "stack", style: "--gap: 8px" },
      h("label", { class: "sr-only", for: "recherche-wiki" }, "Rechercher dans le wiki"),
      b.search,
      h("span", { class: "muted", style: "font-size: 13px" }, "Articles d'awakening.wiki, en anglais, chargés à la demande. Entrée ouvre le premier résultat."),
    ),
    h("div", { class: "columns" },
      h("section", { style: "flex: 1 1 260px; min-width: 0" }, b.results),
      h("div", { class: "card", style: "flex: 3 1 480px; padding: 32px" }, b.article),
    ),
  );
  if (first) void b.start();
  b.search.focus();
  return {};
}
