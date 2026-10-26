import "./styles/theme.css";
import "./styles/components.css";
import "./styles/app.css";
import "./styles/window.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { h, icon, logo, mount } from "./lib/dom";
import { DATABASE_URL, openExternal, WikiBrowser } from "./lib/wiki-browser";

/** En développement, hors de Tauri, on simule le moteur pour tester dans un navigateur. */
function boot(label: string): Promise<void> {
  const inTauri = "__TAURI_INTERNALS__" in window;
  return import.meta.env.DEV && !inTauri ? import("./lib/mock").then((m) => m.install(label)) : Promise.resolve();
}

function main() {
  const win = getCurrentWindow();
  const browser = new WikiBrowser(true);
  browser.search.id = "wf-recherche";
  browser.search.classList.add("grow");
  let pinned = false;

  const back = h("button", { class: "icon-btn", type: "button", "aria-label": "Article précédent", onclick: () => browser.back() }, icon("chevronLeft", 16));
  const forward = h("button", { class: "icon-btn", type: "button", "aria-label": "Article suivant", onclick: () => browser.forward() }, icon("chevronRight", 16));
  browser.onChange = () => {
    back.disabled = !browser.canBack;
    forward.disabled = !browser.canForward;
  };
  const pin = h("button", {
    class: "win-btn", type: "button", "aria-label": "Toujours au premier plan", "aria-pressed": "false",
    onclick: async () => {
      pinned = !pinned;
      await win.setAlwaysOnTop(pinned);
      pin.setAttribute("aria-pressed", String(pinned));
    },
  }, icon("pin", 14));

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
      h("div", { class: "toolbar" },
        back, forward,
        h("label", { class: "sr-only", for: "wf-recherche" }, "Rechercher dans le wiki"),
        browser.search,
        h("button", { class: "btn", type: "button", onclick: () => void openExternal(DATABASE_URL), title: "Base de données dune.gaming.tools" }, "Base de données"),
      ),
      h("div", { class: "split" }, h("div", { class: "results" }, browser.results), h("div", { class: "content" }, browser.article)),
    ),
  );
  void browser.start();

  // Ouvrir la fenêtre (raccourci ou bouton) place directement le curseur dans la recherche.
  void win.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      browser.search.focus();
      browser.search.select();
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") void win.hide();
    if (e.altKey && e.key === "ArrowLeft") browser.back();
    if (e.altKey && e.key === "ArrowRight") browser.forward();
  });
}

void boot("wiki").then(main);
