// Navigateur de wiki partagé par l'écran Wiki et la fenêtre wiki dédiée :
// recherche dans l'index, liste de résultats, article et historique.

import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import { h, icon, mount } from "./dom";
import {
  FEATURED, getArticle, loadIndex, pageUrl, searchTitles, WIKI_LICENSE, WIKI_LICENSE_URL, WikiError,
} from "./wiki";

export const DATABASE_URL = "https://dune.gaming.tools/items";

/** Ouvre une adresse : dans la fenêtre de Sietch si le site est autorisé, sinon dans le navigateur. */
export async function openExternal(url: string) {
  const host = new URL(url).host;
  if (host === "awakening.wiki" || host === "dune.gaming.tools") await api.openSite(url);
  else await openUrl(url);
}

export class WikiBrowser {
  readonly search = h("input", {
    class: "input search", type: "search", autocomplete: "off",
    placeholder: "Rechercher sur awakening.wiki (en anglais : spice, sandworm…)",
  });
  readonly results = h("div", { class: "stack", style: "--gap: 6px", role: "list", "aria-label": "Résultats" });
  readonly article = h("div", { class: "wiki-article", "aria-live": "polite" });
  current: string | null = null;
  private titles: string[] | null = null;
  private history: string[] = [];
  private pos = -1;
  private loadToken = 0;
  /** Appelé après chaque changement d'article, pour mettre à jour les boutons précédent / suivant. */
  onChange: () => void = () => {};

  constructor(private compact = false) {
    this.search.addEventListener("input", () => this.drawResults());
    this.search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const first = this.matches()[0];
      if (first) void this.open(first);
    });
    this.article.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a) return;
      if (a.dataset.wiki) {
        e.preventDefault();
        void this.open(a.dataset.wiki);
      } else if (a.dataset.external) {
        e.preventDefault();
        void openExternal(a.dataset.external);
      }
    });
  }

  async start(first: string | null = FEATURED[0]) {
    this.drawResults();
    if (first) void this.open(first);
    try {
      this.titles = await loadIndex();
    } catch {
      this.titles = null;
    }
    this.drawResults();
  }

  get canBack() {
    return this.pos > 0;
  }

  get canForward() {
    return this.pos < this.history.length - 1;
  }

  back() {
    if (this.canBack) void this.open(this.history[--this.pos], false);
  }

  forward() {
    if (this.canForward) void this.open(this.history[++this.pos], false);
  }

  private matches(): string[] {
    const q = this.search.value.trim();
    if (!q) return FEATURED;
    return this.titles ? searchTitles(this.titles, q) : [];
  }

  private drawResults() {
    const q = this.search.value.trim();
    const list = this.matches();
    let note: string;
    if (!q) note = "À la une";
    else if (!this.titles) note = "Index du wiki indisponible : vérifiez la connexion.";
    else note = `${list.length}${list.length === 60 ? "+" : ""} résultat${list.length > 1 ? "s" : ""}`;
    mount(
      this.results,
      h("span", { class: "label", style: "font-size: 12px; padding: 0 4px 4px" }, note),
      !this.titles && q
        ? h("button", { class: "btn", type: "button", onclick: () => void this.retryIndex() }, "Réessayer")
        : null,
      list.map((t) =>
        h("button", {
          class: `pick${this.compact ? " compact" : ""}`, type: "button", role: "listitem",
          "aria-pressed": String(t === this.current),
          onclick: () => void this.open(t),
        }, h("span", { class: "title" }, t)),
      ),
      q && this.titles && !list.length ? h("p", { class: "muted", style: "margin: 4px" }, "Aucun article ne correspond.") : null,
    );
  }

  private async retryIndex() {
    try {
      this.titles = await loadIndex(true);
    } catch {
      this.titles = null;
    }
    this.drawResults();
  }

  async open(title: string, record = true) {
    if (record) {
      this.history.splice(this.pos + 1);
      this.history.push(title);
      this.pos = this.history.length - 1;
    }
    this.current = title;
    this.drawResults();
    this.onChange();
    const token = ++this.loadToken;
    mount(this.article, h("p", { class: "muted" }, `Chargement de « ${title} »…`));
    try {
      const page = await getArticle(title);
      if (token !== this.loadToken) return;
      this.drawArticle(page.title, page.html);
    } catch (e) {
      if (token !== this.loadToken) return;
      const msg = e instanceof WikiError ? e.message : "Impossible de joindre le wiki : vérifiez la connexion.";
      mount(this.article,
        h("h2", { class: "h2", style: "font-size: 22px" }, title),
        h("p", { class: "prose soft" }, msg),
        h("div", { class: "row wrap" },
          h("button", { class: "btn", type: "button", onclick: () => void this.open(title, false) }, "Réessayer"),
          h("button", { class: "btn", type: "button", onclick: () => void openExternal(pageUrl(title)) }, icon("external", 16), "Ouvrir sur awakening.wiki"),
        ));
    }
  }

  private drawArticle(title: string, html: string) {
    const body = h("div", { class: "wiki-content" });
    body.innerHTML = html; // déjà nettoyé par sanitize()
    mount(
      this.article,
      h("header", { class: "row wrap spread", style: "align-items: flex-start" },
        h("div", { class: "stack", style: "--gap: 6px" },
          h("span", { class: "eyebrow", style: "font-size: 12px" }, "awakening.wiki"),
          h("h2", { class: "h2", style: "font-size: 22px" }, title)),
        h("div", { class: "row wrap" },
          h("button", { class: "btn", type: "button", onclick: () => void openExternal(pageUrl(title)) }, icon("external", 16), "Page d'origine"),
          h("button", { class: "btn", type: "button", onclick: () => void openExternal(DATABASE_URL) }, "Base de données")),
      ),
      body,
      h("p", { class: "muted wiki-credit" },
        "Contenu du ", h("a", { href: "#", "data-external": pageUrl(title) }, "Dune: Awakening Community Wiki"),
        " sous licence ", h("a", { href: "#", "data-external": WIKI_LICENSE_URL }, WIKI_LICENSE),
        ", mis en forme pour Sietch (menus du wiki retirés)."),
    );
    this.article.scrollTop = 0;
    this.article.closest(".main, .content")?.scrollTo?.({ top: 0 });
  }
}
