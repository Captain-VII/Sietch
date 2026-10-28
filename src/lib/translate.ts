// Traduction automatique des articles du wiki (anglais → français), pour l'affichage seulement :
// l'Artisanat lit toujours les recettes en anglais (lib/recipes.ts).
//
// Service : Google Traduction par son adresse publique sans clé (`translate.googleapis.com`, client « gtx »).
// Elle n'est pas officielle et peut cesser de marcher : en cas d'échec, l'article reste en anglais.
// Les traductions sont gardées sur ce PC (localStorage) : un article n'est traduit qu'une fois.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fr&dt=t";
/** Taille d'un envoi (caractères) : le service refuse les textes trop longs. */
const BATCH = 4000;
const ARTICLES_KEY = "sietch-wiki-fr";
const TITLES_KEY = "sietch-wiki-fr-titres";
/** Articles traduits gardés au plus (les plus anciens sont oubliés). */
const ARTICLES_MAX = 80;

const inTauri = "__TAURI_INTERNALS__" in window;

/** Une requête : les textes séparés par des retours à la ligne, que le service conserve. */
async function request(text: string): Promise<string> {
  const body = new URLSearchParams({ q: text }).toString();
  const init = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body };
  const res = inTauri ? await tauriFetch(ENDPOINT, init) : await window.fetch("/__gtr" + ENDPOINT.slice(ENDPOINT.indexOf("/translate_a")), init);
  if (!res.ok) throw new Error(`traduction : ${res.status}`);
  const data = (await res.json()) as [[string, string][]];
  return data[0].map((seg) => seg[0]).join("");
}

/** Traduit une liste de textes courts (sans retour à la ligne), dans le même ordre. */
export async function translateTexts(texts: string[]): Promise<string[]> {
  const out = [...texts];
  let start = 0;
  while (start < texts.length) {
    let end = start;
    let size = 0;
    while (end < texts.length && (end === start || size + texts[end].length + 1 <= BATCH)) size += texts[end++].length + 1;
    const part = texts.slice(start, end);
    const lines = (await request(part.join("\n"))).split("\n");
    // Le service a fusionné des lignes : on garde l'anglais de ce morceau plutôt que de décaler les textes.
    if (lines.length === part.length) lines.forEach((l, i) => (out[start + i] = l.trim() || part[i]));
    start = end;
  }
  return out;
}

function load<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage plein ou bloqué : la traduction sera simplement refaite.
  }
}

/** Nœuds de texte à traduire : pas les espaces, nombres, unités seules ni le code. */
function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      /[A-Za-z]{2}/.test(n.nodeValue ?? "") && !(n.parentElement?.closest("code, pre, script, style"))
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

/** HTML d'un article traduit en français (titre compris), depuis le cache si possible. */
export async function translateArticle(title: string, html: string): Promise<{ title: string; html: string }> {
  const cache = load<Record<string, { title: string; html: string; at: number }>>(ARTICLES_KEY, {});
  const hit = cache[title];
  if (hit) return hit;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const nodes = textNodes(tpl.content);
  const texts = nodes.map((n) => n.nodeValue!.replace(/\s+/g, " ").trim());
  const [frTitle, ...fr] = await translateTexts([title, ...texts]);
  nodes.forEach((n, i) => {
    // Les espaces autour du texte séparent les mots des liens voisins : on les garde.
    const v = n.nodeValue!;
    n.nodeValue = (/^\s/.test(v) ? " " : "") + fr[i] + (/\s$/.test(v) ? " " : "");
  });
  const page = { title: frTitle, html: tpl.innerHTML, at: Date.now() };
  cache[title] = page;
  const keys = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at);
  for (const k of keys.slice(ARTICLES_MAX)) delete cache[k];
  store(ARTICLES_KEY, cache);
  return page;
}

let titles: Record<string, string> | null = null;

/** Titres déjà traduits (liste des résultats), sans requête. */
export function knownTitle(title: string): string | undefined {
  titles ??= load<Record<string, string>>(TITLES_KEY, {});
  return titles[title];
}

/** Traduit les titres d'une liste de résultats qui ne le sont pas encore ; `true` si de nouveaux sont arrivés. */
export async function translateTitles(list: string[]): Promise<boolean> {
  titles ??= load<Record<string, string>>(TITLES_KEY, {});
  const missing = list.filter((t) => !(t in titles!));
  if (!missing.length) return false;
  const fr = await translateTexts(missing);
  missing.forEach((t, i) => (titles![t] = fr[i]));
  store(TITLES_KEY, titles);
  return true;
}
