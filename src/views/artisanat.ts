import type { Ctx, ViewHandle } from "../main";
import { h, mount, toast } from "../lib/dom";
import { plan, recipesOf, WATER, type Plan } from "../lib/recipes";
import { loadIndex, pageUrl, searchTitles, WIKI_LICENSE, WIKI_LICENSE_URL } from "../lib/wiki";
import { openExternal } from "../lib/wiki-browser";

/** « 1 h 05 », « 12 min », « 45 s ». */
function durationText(secs: number): string {
  if (secs >= 3600) return `${Math.floor(secs / 3600)} h ${String(Math.round((secs % 3600) / 60)).padStart(2, "0")}`;
  return secs >= 60 ? `${Math.round(secs / 60)} min` : `${Math.round(secs)} s`;
}

/** Calculateur d'artisanat : de l'objet voulu jusqu'aux matières premières, d'après les recettes du wiki. */
export function render(root: HTMLElement, _ctx: Ctx, action?: string | null): ViewHandle {
  const search = h("input", { class: "input search", id: "art-objet", type: "search", placeholder: "Objet du wiki, en anglais : Steel Ingot, Stillsuit…", autocomplete: "off", style: "flex: 1 1 260px; width: auto" });
  const qty = h("input", { class: "input", id: "art-qte", type: "number", min: "1", max: "9999", value: "1", style: "width: 96px", "aria-label": "Quantité" });
  const suggest = h("div", { class: "row wrap", style: "--gap: 6px" });
  const result = h("div", { class: "stack", style: "--gap: 20px" });
  /** Recette choisie par objet quand il y en a plusieurs (raffinerie petite ou moyenne…). */
  const choice = new Map<string, number>();
  let item = "";
  let titles: string[] = [];
  void loadIndex().then((t) => (titles = t)).catch(() => toast("Wiki injoignable", "La recherche d'objets demande une connexion."));

  search.addEventListener("input", () => {
    const found = searchTitles(titles, search.value, 8);
    mount(suggest, found.map((t) => h("button", { class: "chip", type: "button", onclick: () => pick(t) }, t)));
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = searchTitles(titles, search.value, 1)[0];
      if (first) pick(first);
    }
  });
  qty.addEventListener("change", () => item && void compute());

  /** Liste de courses d'un build : plusieurs objets d'un coup (action « objet1\nobjet2… »). */
  let list: string[] = [];

  function pick(t: string) {
    item = t;
    list = [];
    search.value = t;
    mount(suggest);
    choice.clear();
    void compute();
  }

  async function compute() {
    const n = Math.max(1, Math.min(9999, Math.round(Number(qty.value) || 1)));
    mount(result, h("p", { class: "muted", style: "margin: 0" }, "Lecture des recettes sur le wiki…"));
    let p: Plan;
    let unknown: string[] = [];
    try {
      const targets = list.length ? list.map((i) => ({ item: i, qty: n })) : [{ item, qty: n }];
      // Objets sans recette (nom en français dans le build, matière première…) : signalés à part.
      const known = await Promise.all(targets.map(async (t) => (await recipesOf(t.item)).length > 0));
      unknown = targets.filter((_, i) => !known[i]).map((t) => t.item);
      if (unknown.length === targets.length) {
        mount(result, h("p", { class: "muted", style: "margin: 0" }, `Aucune recette pour « ${unknown.join(" », « ")} » sur le wiki : c'est une matière première, le nom n'est pas celui du wiki (en anglais), ou sa page n'a pas encore de tableau de fabrication.`));
        return;
      }
      p = await plan(targets.filter((_, i) => known[i]), choice);
    } catch (e) {
      mount(result, h("p", { class: "muted", style: "margin: 0" }, `Impossible de lire le wiki : ${e instanceof Error ? e.message : e}`));
      return;
    }
    const name = (t: string) => (t === WATER ? "Eau (mL)" : t);
    const wiki = (t: string) => t === WATER ? h("span", {}, name(t)) : h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); void openExternal(pageUrl(t)); } }, t);
    const fmt = (v: number) => v.toLocaleString("fr-FR");
    const steps = await Promise.all(p.steps.map(async (s) => {
      const options = await recipesOf(s.item);
      return h("div", { class: "setting-row", style: "align-items: flex-start; padding: 10px 0" },
        h("div", { class: "stack grow", style: "--gap: 4px; min-width: 0" },
          h("span", {}, h("span", { class: "digits" }, `${fmt(s.runs)} ×`), " ", wiki(s.item), s.makes > 1 ? h("span", { class: "muted" }, ` (×${s.makes} par fabrication)`) : null),
          h("span", { class: "muted", style: "font-size: 13px" }, [...s.recipe.inputs.map((i) => `${name(i.item)} ×${fmt(i.qty * s.runs)}`), s.recipe.time ? `${durationText(s.recipe.time * s.runs)}` : ""].filter(Boolean).join(" · "))),
        options.length > 1
          ? h("select", { class: "select", style: "width: auto; max-width: 220px", "aria-label": `Atelier pour ${s.item}`, onchange: (e: Event) => {
              choice.set(s.item, Number((e.target as HTMLSelectElement).value));
              void compute();
            } }, options.map((o, i) => h("option", { value: String(i), selected: o === s.recipe }, o.station || `Recette ${i + 1}`)))
          : h("span", { class: "muted", style: "font-size: 13px; text-align: right" }, s.recipe.station));
    }));
    mount(result,
      list.length ? h("p", { class: "soft", style: "margin: 0" }, `Liste de courses du build : ${list.length - unknown.length} pièce${list.length - unknown.length > 1 ? "s" : ""} sur ${list.length} trouvée${list.length > 1 ? "s" : ""} sur le wiki.`) : null,
      unknown.length
        ? h("p", { class: "muted", style: "margin: 0; font-size: 13px" }, `Sans recette sur le wiki (nom à écrire comme sur le wiki, en anglais) : ${unknown.join(", ")}.`)
        : null,
      h("section", { class: "card" },
        h("h2", { class: "section-title" }, "À récolter"),
        h("div", { class: "grid-auto", style: "--min: 220px; gap: 8px" },
          [...p.raw].sort((a, b) => b[1] - a[1]).map(([it, v]) =>
            h("div", { class: "row spread" }, wiki(it), h("span", { class: "digits" }, fmt(v)))))),
      h("section", { class: "card" },
        h("h2", { class: "section-title" }, "Étapes de fabrication"),
        h("p", { class: "muted", style: "margin: 0; font-size: 13px" }, "Des matières premières vers l'objet. Quand plusieurs ateliers fabriquent la même chose, choisissez le vôtre."),
        h("div", {}, steps)),
    );
  }

  mount(root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Recettes d'awakening.wiki"), h("h1", { class: "h1" }, "Artisanat"))),
    h("section", { class: "card" },
      h("div", { class: "row wrap" },
        h("label", { class: "sr-only", for: "art-objet" }, "Objet"), search,
        h("label", { class: "label", for: "art-qte" }, "Quantité"), qty),
      suggest),
    result,
    h("p", { class: "muted", style: "margin: 0; font-size: 13px" },
      "Recettes du ", h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); void openExternal("https://awakening.wiki/"); } }, "Dune: Awakening Community Wiki"),
      `, sous licence `, h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); void openExternal(WIKI_LICENSE_URL); } }, WIKI_LICENSE),
      ". Elles peuvent avoir du retard sur le jeu."),
  );
  if (action?.includes("\n")) {
    list = action.split("\n").map((s) => s.trim()).filter(Boolean);
    search.value = "";
    void compute();
  } else if (action) pick(action);
  else search.focus();
  return {};
}
