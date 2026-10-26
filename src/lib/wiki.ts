import entries from "../data/wiki.json";
import { h } from "./dom";

export interface WikiEntry {
  id: string;
  title: string;
  cat: string;
  body: string;
  where: string;
  facts: { k: string; v: string }[];
}

export const WIKI: WikiEntry[] = entries;
export const CATEGORIES = ["Tout", ...new Set(WIKI.map((e) => e.cat))];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Recherche sans tenir compte des accents ; le titre compte plus que le texte. */
export function searchWiki(query: string, cat = "Tout"): WikiEntry[] {
  const q = fold(query.trim());
  const pool = WIKI.filter((e) => cat === "Tout" || e.cat === cat);
  if (!q) return pool;
  return pool
    .map((e) => {
      const title = fold(e.title);
      const score = title.startsWith(q) ? 3 : title.includes(q) ? 2 : fold(`${e.body} ${e.where}`).includes(q) ? 1 : 0;
      return { e, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.e);
}

/** Corps d'un article : texte, « Où le trouver », fiche. `actions` se place sous le texte. */
export function renderArticle(e: WikiEntry, actions: HTMLElement | null = null) {
  return h(
    "article",
    { class: "article", "aria-labelledby": `art-${e.id}` },
    h(
      "div",
      { class: "body" },
      h("span", { class: "eyebrow", style: "font-size: 12px" }, e.cat),
      h("h2", { class: "h2", id: `art-${e.id}`, style: "font-size: 22px" }, e.title),
      h("p", { class: "prose" }, e.body),
      h("h3", { class: "section-title", style: "font-size: 14px; color: var(--text-soft); margin-top: 6px" }, "Où le trouver"),
      h("p", { class: "prose" }, e.where),
      actions,
    ),
    h(
      "aside",
      { class: "facts", "aria-label": "Fiche" },
      e.facts.map((f) => h("div", { class: "stack", style: "--gap: 2px" }, h("span", { class: "k" }, f.k), h("span", {}, f.v))),
      h("span", { class: "muted", style: "font-size: 12px" }, "Contenu de départ, à compléter : src/data/wiki.json"),
    ),
  );
}
