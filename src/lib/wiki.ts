// Wiki en ligne : articles du Dune: Awakening Community Wiki (awakening.wiki),
// chargés à la demande et réaffichés dans le style de Sietch.
// Contenu sous licence CC BY-NC-SA 4.0 : la source est toujours citée sous l'article.
//
// - Index de recherche : le plan du site public (sitemap), téléchargé une fois puis gardé 7 jours.
// - Article : la page rendue (`?action=render`), nettoyée avant affichage.
// Sietch n'utilise ni api.php ni index.php, que le robots.txt du wiki réserve.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export const WIKI_BASE = "https://awakening.wiki";
export const WIKI_LICENSE = "CC BY-NC-SA 4.0";
export const WIKI_LICENSE_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/deed.fr";
const SITEMAP = "/sitemaps/sitemap-awakening.wiki-NS_0-0.xml";
const INDEX_KEY = "sietch-wiki-index";
const INDEX_TTL = 7 * 86_400_000;

/** Articles proposés quand la recherche est vide. */
export const FEATURED = [
  "Spice",
  "Sandworm",
  "Coriolis Storm",
  "Deep Desert",
  "Hagga Basin",
  "Water",
  "Ornithopter",
  "Fremen",
];

const inTauri = "__TAURI_INTERNALS__" in window;

/** Télécharge un texte du wiki. Hors de Tauri (mode navigateur), passe par le relais de Vite. */
async function getText(path: string): Promise<string> {
  const res = inTauri
    ? await tauriFetch(WIKI_BASE + path, { headers: { Accept: "text/html,application/xml" } })
    : await window.fetch("/__wiki" + path);
  if (res.status === 404) throw new WikiError("absent", "Cet article n'existe pas (ou plus) sur le wiki.");
  if (!res.ok) throw new WikiError("reseau", `Le wiki a répondu ${res.status}.`);
  return res.text();
}

export class WikiError extends Error {
  constructor(
    public kind: "absent" | "reseau",
    message: string,
  ) {
    super(message);
  }
}

// ---------- Index et recherche ----------

let index: string[] | null = null;

/** "Coriolis Storm" ↔ "Coriolis_Storm" dans les adresses. */
export const toPath = (title: string) => "/" + encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/");
export const pageUrl = (title: string) => WIKI_BASE + toPath(title);

function titleFromHref(href: string): string | null {
  let path: string;
  try {
    const u = new URL(href, WIKI_BASE);
    if (u.host !== "awakening.wiki" || u.search) return null;
    path = u.pathname.slice(1);
  } catch {
    return null;
  }
  if (!path || path.includes(":")) return null; // Fichiers, catégories, pages spéciales…
  return decodeURIComponent(path).replace(/_/g, " ");
}

export async function loadIndex(force = false): Promise<string[]> {
  if (index && !force) return index;
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(INDEX_KEY) ?? "null");
      if (cached && Date.now() - cached.at < INDEX_TTL && Array.isArray(cached.titles)) {
        index = cached.titles as string[];
        return index;
      }
    } catch {
      // Cache illisible : on retélécharge.
    }
  }
  const xml = await getText(SITEMAP);
  const titles = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => titleFromHref(m[1].replace(/&amp;/g, "&")))
    .filter((t): t is string => !!t && !/^\d+(\.\d+)+$/.test(t)); // sans les pages de numéros de version
  index = [...new Set(titles)].sort((a, b) => a.localeCompare(b));
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify({ at: Date.now(), titles: index }));
  } catch {
    // Pas de cache possible : tant pis, l'index reste en mémoire.
  }
  return index;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Titres qui correspondent, les débuts de titre et de mot d'abord. */
export function searchTitles(titles: string[], query: string, limit = 60): string[] {
  const q = fold(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/);
  return titles
    .map((t) => {
      const f = fold(t);
      if (!words.every((w) => f.includes(w))) return null;
      const score = f === q ? 0 : f.startsWith(q) ? 1 : f.split(/[\s'()-]+/).some((w) => w.startsWith(words[0])) ? 2 : 3;
      return { t, score };
    })
    .filter((r): r is { t: string; score: number } => r !== null)
    .sort((a, b) => a.score - b.score || a.t.length - b.t.length)
    .slice(0, limit)
    .map((r) => r.t);
}

// ---------- Articles ----------

const cache = new Map<string, string>();

const DROP = "script, style, link, meta, iframe, object, embed, form, input, button, select, textarea, noscript, audio, video, .mw-editsection, .navbox, .toc, #toc, .mw-empty-elt";
const KEEP_ATTRS: Record<string, string[]> = {
  a: ["href", "title"],
  img: ["src", "alt", "width", "height"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan", "scope"],
  ol: ["start"],
};

/**
 * Nettoie le HTML d'un article : retire scripts, styles et attributs inconnus,
 * transforme les liens internes en navigation dans Sietch et ne garde que les images du wiki.
 */
export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
  const root = doc.getElementById("root")!;
  root.querySelectorAll(DROP).forEach((el) => el.remove());
  root.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const keep = KEEP_ATTRS[tag] ?? [];
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name === "id" || name === "class" ? false : !keep.includes(name)) el.removeAttribute(attr.name);
    }
    // Les classes du wiki ne servent qu'à repérer les infobox ; on n'en garde pas d'autres.
    const cls = el.getAttribute("class") ?? "";
    el.removeAttribute("class");
    if (/infobox/i.test(cls)) el.setAttribute("class", "wiki-infobox");
    if (/\bwikitable\b/.test(cls)) el.setAttribute("class", "wiki-table");
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      if (href.startsWith("#")) return;
      const title = titleFromHref(href);
      if (title) {
        el.setAttribute("data-wiki", title);
        el.setAttribute("href", "#");
      } else if (/^https:\/\//.test(href)) {
        el.setAttribute("data-external", href);
        el.setAttribute("href", "#");
      } else {
        el.replaceWith(...el.childNodes);
      }
    }
    if (tag === "img") {
      const src = el.getAttribute("src") ?? "";
      if (!src.startsWith("https://media.awakening.wiki/")) el.remove();
    }
  });
  return root.innerHTML;
}

/** HTML nettoyé d'un article, depuis le cache si on l'a déjà lu. */
export async function getArticle(title: string): Promise<{ title: string; html: string }> {
  const hit = cache.get(title);
  if (hit !== undefined) return { title, html: hit };
  const raw = await getText(`${toPath(title)}?action=render`);
  // Une page de redirection ne contient qu'un lien vers la vraie page : on le suit une fois.
  const redirect = /class="redirectText"[\s\S]*?<a href="([^"]+)"/.exec(raw);
  const target = redirect ? titleFromHref(redirect[1]) : null;
  if (target && target !== title) {
    const page = await getArticle(target);
    cache.set(title, page.html);
    return page;
  }
  const html = sanitize(raw);
  cache.set(title, html);
  return { title, html };
}
