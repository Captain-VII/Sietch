// Recettes d'artisanat lues sur awakening.wiki (CC BY-NC-SA 4.0) : tableau « Crafted By » de chaque article,
// chargé à la demande par `getArticle` (?action=render), comme le reste du wiki.

import { getArticle } from "./wiki";

export interface Stack {
  item: string;
  qty: number;
}

export interface Recipe {
  /** Atelier ou raffinerie. */
  station: string;
  inputs: Stack[];
  outputs: Stack[];
  /** Durée d'une fabrication, en secondes (0 : inconnue). */
  time: number;
}

const CACHE_KEY = "sietch-recettes-3";
const CACHE_TTL = 7 * 86_400_000;
const memory = new Map<string, Recipe[]>();

function readCache(): Record<string, { at: number; r: Recipe[] }> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Eau, en millilitres (« 50mL Water », sans article sur le wiki). */
export const WATER = "Water";

/** « Carbon Ore x4 », « 50mL Water » ; `null` pour la durée (« 5.0s »), lue à part. */
function parseStack(li: Element): Stack | null {
  const text = (li.textContent ?? "").replace(/\s+/g, " ").trim();
  if (/^\d+(\.\d+)?\s*s$/.test(text)) return null;
  const water = /^([\d.,\s]+)\s*mL\s+Water$/i.exec(text);
  if (water) return { item: WATER, qty: Number(water[1].replace(/[\s,]/g, "")) || 0 };
  const qty = Number(/x\s*(\d+)$/.exec(text)?.[1] ?? 1);
  const link = li.querySelector("a[data-wiki]");
  const item = link?.getAttribute("data-wiki") ?? text.replace(/x\s*\d+$/, "").trim();
  return item ? { item, qty } : null;
}

/** Durée d'une fabrication, en secondes (« 5.0s »). */
function parseTime(td: Element): number {
  for (const li of td.querySelectorAll("li")) {
    const m = /^(\d+(?:\.\d+)?)\s*s$/.exec((li.textContent ?? "").trim());
    if (m) return Number(m[1]);
  }
  return 0;
}

/** Recettes qui produisent l'article (section « Crafted By ») ; vide pour une matière première. */
export function parseRecipes(html: string): Recipe[] {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const head = doc.getElementById("Crafted_By");
  if (!head) return [];
  // Le titre est dans une <div class="mw-heading"> : le tableau est le suivant après elle.
  let el: Element | null = head.closest("div") ?? head;
  while (el && el.tagName !== "TABLE") {
    el = el.nextElementSibling;
    if (el && /^H[23]$/.test(el.tagName)) return [];
    if (el?.querySelector("h2, h3")) return [];
  }
  if (!el) return [];
  const recipes: Recipe[] = [];
  for (const row of el.querySelectorAll("tr")) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 3) continue;
    const stacks = (td: Element) => [...td.querySelectorAll("li")].map(parseStack).filter((s): s is Stack => !!s);
    const station = [...cells[0].querySelectorAll("li")].map((l) => l.textContent?.trim()).filter(Boolean).join(", ");
    const r = { station, inputs: stacks(cells[1]), outputs: stacks(cells[2]), time: parseTime(cells[1]) };
    if (r.inputs.length && r.outputs.length) recipes.push(r);
  }
  return recipes;
}

/** Page d'un ensemble (« Kirab Stillsuit ») : ses pièces, chacune avec sa recette. Recette fictive « Ensemble ». */
export function parseSet(html: string, item: string): Recipe | null {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const head = doc.getElementById("Armor_Set");
  if (!head) return null;
  const pieces = new Set<string>();
  let el = head.closest("div")?.nextElementSibling ?? null;
  while (el && !el.querySelector("h2") && el.tagName !== "H2") {
    el.querySelectorAll("a[data-wiki]").forEach((a) => {
      const t = a.getAttribute("data-wiki");
      if (t && t !== item) pieces.add(t);
    });
    el = el.nextElementSibling;
  }
  return pieces.size ? { station: "Ensemble (pièces fabriquées une à une)", inputs: [...pieces].map((p) => ({ item: p, qty: 1 })), outputs: [{ item, qty: 1 }], time: 0 } : null;
}

export async function recipesOf(item: string): Promise<Recipe[]> {
  const hit = memory.get(item);
  if (hit) return hit;
  const cache = readCache();
  const c = cache[item];
  if (c && Date.now() - c.at < CACHE_TTL) {
    memory.set(item, c.r);
    return c.r;
  }
  let r: Recipe[] = [];
  if (item === WATER) return r;
  try {
    const html = (await getArticle(item)).html;
    r = parseRecipes(html);
    if (!r.length) {
      const set = parseSet(html, item);
      if (set) r = [set];
    }
  } catch {
    // Pas d'article (eau…) ou réseau coupé : traité comme une matière première.
  }
  memory.set(item, r);
  try {
    cache[item] = { at: Date.now(), r };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache plein ou indisponible : la mémoire suffit pour cette session.
  }
  return r;
}

export interface Plan {
  /** Matières premières à récolter. */
  raw: Map<string, number>;
  /** Étapes de fabrication, des matières premières vers l'objet : combien de fois lancer chaque recette. */
  steps: { item: string; runs: number; makes: number; recipe: Recipe }[];
}

/**
 * Tout ce qu'il faut pour les objets voulus (un ou plusieurs : liste de courses d'un build).
 * `choice` : recette retenue par objet (la première par défaut). Les recettes en boucle et au-delà de
 * 8 niveaux s'arrêtent : l'objet compte alors comme matière première.
 */
export async function plan(targets: Stack[], choice: Map<string, number> = new Map()): Promise<Plan> {
  const need = new Set<string>();
  const recipe = new Map<string, Recipe>();

  // Première passe : découvrir l'arbre des recettes (chaque objet une seule fois).
  async function visit(it: string, path: string[]) {
    if (need.has(it)) return;
    need.add(it);
    if (path.length > 8) return;
    const list = await recipesOf(it);
    const r = list[choice.get(it) ?? 0] ?? list[0];
    if (!r || r.inputs.some((i) => path.includes(i.item))) return;
    recipe.set(it, r);
    await Promise.all(r.inputs.map((i) => visit(i.item, [...path, it])));
  }
  await Promise.all(targets.map((t) => visit(t.item, [])));
  // Seconde passe, sur les totaux : un lingot partagé par plusieurs pièces se compte une fois, arrondi au total.
  const totals = new Map<string, number>();
  for (const t of targets) totals.set(t.item, (totals.get(t.item) ?? 0) + t.qty);
  const done = new Set<string>();
  const steps: Plan["steps"] = [];
  // Ordre topologique : un objet après tous ceux qui le consomment.
  const consumers = (it: string) => [...recipe.entries()].filter(([, r]) => r.inputs.some((i) => i.item === it)).map(([k]) => k);
  const pending = [...need.keys()];
  while (pending.length) {
    const i = pending.findIndex((it) => consumers(it).every((c) => done.has(c) || !need.has(c)));
    const it = pending.splice(i < 0 ? 0 : i, 1)[0];
    done.add(it);
    const r = recipe.get(it);
    const n = totals.get(it) ?? 0;
    if (!r || n <= 0) continue;
    const makes = r.outputs.find((o) => o.item === it)?.qty ?? 1;
    const runs = Math.ceil(n / makes);
    steps.unshift({ item: it, runs, makes, recipe: r });
    for (const inp of r.inputs) totals.set(inp.item, (totals.get(inp.item) ?? 0) + inp.qty * runs);
  }
  const raw = new Map<string, number>();
  for (const [it, n] of totals) if (!recipe.has(it) && n > 0) raw.set(it, n);
  return { raw, steps };
}
