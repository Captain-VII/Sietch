import type { MapData } from "./api";
import type { Region } from "./data";

/** Côté de la carte, en unités de Sietch (secteurs A1–I9 de 100). */
export const SIZE = 900;

/** Types de points d'intérêt lus dans le jeu (Terrain Blocks) : couleur et pictogramme plein (silhouette dessinée
 *  pour Sietch, grille 24 × 24, règle de remplissage evenodd pour les découpes). Les silhouettes pleines restent
 *  lisibles à 15 px sur la mini-carte, contrairement aux pictogrammes en trait. */
export const POI_KINDS: Record<string, { label: string; color: string; path: string }> = {
  // Dôme de recherche et son antenne.
  station: { label: "Station écologique", color: "#6fb6e8", path: "M1 19h22v3H1zM2.5 18a9.5 9.5 0 0 1 19 0zM11 1h2v8h-2zM8 2h8v2.5H8z" },
  // Maison.
  base: { label: "Base", color: "#e05a4f", path: "M12 2l10 8v12h-7v-6h-6v6H2V10z" },
  // Coque brisée, mâts tordus.
  epave: { label: "Épave", color: "#b9ad93", path: "M1 14h22l-4 7H5zM6 13l3-8 3 4 4-6 2 10z" },
  // Entrée de galerie.
  mine: { label: "Galerie de mine", color: "#c9a861", path: "M2 22V12a10 10 0 0 1 20 0v10zM8 22v-8a4 4 0 0 1 8 0v8z" },
  // Obélisque sur son socle.
  autel: { label: "Autel", color: "#b46be0", path: "M10 2h4l1.5 15h-7zM4 18h16v4H4z" },
  // Tente, porte découpée.
  abri: { label: "Abri du Landsraad", color: "#7fd1b9", path: "M12 2l11 20H1zM12 12l-4 8h8z" },
  // Engin à chenilles et sa benne.
  moissonneuse: {
    label: "Moissonneuse", color: "#e8823a",
    path: "M3 4h11v9H3zM14 8h5l4 5h-9zM1 14h22v4.5a3.5 3.5 0 0 1-3.5 3.5h-15A3.5 3.5 0 0 1 1 18.5z"
      + "M5.5 16.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3zM12 16.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3zM18.5 16.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3z",
  },
  // Étoile.
  histoire: { label: "Lieu de l'histoire", color: "#f1d7ff", path: "M12 1l3.3 7 7.7.9-5.7 5.2 1.6 7.6L12 17.8l-6.9 3.9 1.6-7.6L1 8.9 8.7 8z" },
  // Triangle d'alerte, point d'exclamation découpé.
  evenement: { label: "Événement", color: "#f09a8a", path: "M12 1l11 21H1zM10.5 8h3l-.5 7h-2zM10.5 17h3v3h-3z" },
};

/** Pastille d'un lieu : fond de sa couleur, silhouette sombre (l'inverse des ressources, pour les distinguer). */
export function poiSvg(kind: string, size: number) {
  const k = POI_KINDS[kind] ?? { color: "#e9dfc9", path: "M12 7a5 5 0 1 0 0 10 5 5 0 1 0 0-10z" };
  return `<svg width="${size}" height="${size}" viewBox="-6 -6 36 36" aria-hidden="true"><circle cx="12" cy="12" r="16.5" fill="${k.color}" stroke="#11131F" stroke-width="2.5"/>`
    + `<path d="${k.path}" fill="#11131F" fill-rule="evenodd"/></svg>`;
}

/** Silhouettes pleines des ressources (dessinées pour Sietch, grille 24 × 24, evenodd). */
const RES_ICONS = {
  // Cristal.
  minerai: "M12 1l8 8-8 14-8-14z",
  // Bloc de roche.
  pierre: "M2 20l3-11 8-6 8 7 1 10z",
  // Écrou.
  ferraille: "M12 1l10 5.5v11L12 23 2 17.5v-11zM12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8z",
  // Puce et ses pattes.
  electronique: "M6 6h12v12H6zM8 1h2.5v4H8zM13.5 1H16v4h-2.5zM8 19h2.5v4H8zM13.5 19H16v4h-2.5zM1 8h4v2.5H1zM1 13.5h4V16H1zM19 8h4v2.5h-4zM19 13.5h4V16h-4z",
  // Flamme.
  carburant: "M12 1c4.5 5 8 8.5 8 14a8 8 0 0 1-16 0c0-4 2-6.5 4.5-9.5C9.5 8 11 9.5 12.5 9.5 12.5 6 11 4 12 1z",
  // Buisson sur son tronc.
  plante: "M6.5 18A5 5 0 0 1 5 8.3 6 6 0 0 1 16.6 6 5 5 0 0 1 19 15.8 3.5 3.5 0 0 1 17.5 18zM10.5 17h3v6h-3z",
  // Fleur à quatre pétales.
  fleur: "M12 0a4 4 0 0 1 4 4 4 4 0 0 1-8 0 4 4 0 0 1 4-4zM12 16a4 4 0 0 1 4 4 4 4 0 0 1-8 0 4 4 0 0 1 4-4zM0 12a4 4 0 0 1 4-4 4 4 0 0 1 0 8 4 4 0 0 1-4-4zM16 12a4 4 0 0 1 4-4 4 4 0 0 1 0 8 4 4 0 0 1-4-4zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z",
  // Ornithoptère vu de dessus.
  ornithoptere: "M11 1h2l1 8 9 3v3l-9-1.5-.7 5.5 3.2 2V23h-9v-2l3.2-2-.7-5.5L1 15v-3l9-3z",
  // Lingot sur son socle.
  titane: "M2 17l4-8h12l4 8zM5 19h14v3H5z",
  // Losange taillé, creux au centre.
  stravidium: "M12 1l7 11-7 11-7-11zM12 7l-3.5 5 3.5 5 3.5-5z",
  // Orgues de basalte.
  basalte: "M3 22V9l3-3 3 3v13zM10 22V5l2-3 2 3v17zM15 22V9l3-3 3 3v13z",
  // Touffe de fibres.
  fibre: "M11 23C10 15 6 9 2 6c5 1 8 5 9 9 0-6 1-11 1-14 1 3 2 8 1 14 1-4 4-8 9-9-4 3-8 9-9 17z",
  // Étincelles d'épice.
  epice: "M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2zM19 17l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z",
  // Cactus à deux bras.
  cactus: "M10 23V4a2 2 0 0 1 4 0v19zM4 13V8a1.5 1.5 0 0 1 3 0v3h3v3H5.5A1.5 1.5 0 0 1 4 13zM20 11V6a1.5 1.5 0 0 0-3 0v3h-3v3h4.5A1.5 1.5 0 0 0 20 11z",
  // Goutte et son reflet.
  eau: "M12 1C8 7 5 11 5 15a7 7 0 0 0 14 0c0-4-3-8-7-14zM9 15a3 3 0 0 0 3 3v2a5 5 0 0 1-5-5z",
} as const;

/**
 * Pastille de chaque famille (même repère que les pictogrammes, centre (12, 12), rayon 16,5) : la forme dit la famille
 * même en tout petit sur la mini-carte.
 */
export const FAMILY_SHAPES = {
  roche: "M12 -4.5l14.3 8.25v16.5L12 28.5-2.3 20.25V3.75z",
  vegetal: "M12 -4.5a16.5 16.5 0 1 1 0 33 16.5 16.5 0 0 1 0-33z",
  recup: "M-1.5 -3.5h27a2 2 0 0 1 2 2v27a2 2 0 0 1-2 2h-27a2 2 0 0 1-2-2v-27a2 2 0 0 1 2-2z",
  liquide: "M12 -5.5C17 1 27.5 8 27.5 15.5a15.5 15.5 0 0 1-31 0C-3.5 8 7 1 12 -5.5z",
} as const;

type Family = keyof typeof FAMILY_SHAPES;

/**
 * Ressources lues dans le jeu (générateurs), d'après leur nom interne. Les noms français du jeu peuvent différer.
 * Titane, stravidium, fibre, épice et eau : noms internes supposés, pas encore vus en jeu.
 */
const RESOURCE_KINDS: Record<string, { label: string; color: string; icon: keyof typeof RES_ICONS; family: Family }> = {
  AzuriteOre: { label: "Azurite", color: "#4f8fe0", icon: "minerai", family: "roche" },
  Azurite: { label: "Azurite", color: "#4f8fe0", icon: "minerai", family: "roche" },
  RhyoliteStone: { label: "Rhyolite", color: "#c7b7a0", icon: "pierre", family: "roche" },
  Titanium: { label: "Titane", color: "#b8c4d6", icon: "titane", family: "roche" },
  Stravidium: { label: "Stravidium", color: "#a58cf0", icon: "stravidium", family: "roche" },
  Basalt: { label: "Basalte", color: "#8d8a96", icon: "basalte", family: "roche" },
  BauxiteOre: { label: "Bauxite", color: "#d07a4a", icon: "pierre", family: "roche" },
  Bauxite: { label: "Bauxite", color: "#d07a4a", icon: "pierre", family: "roche" },
  MagnetiteOre: { label: "Magnétite", color: "#7d8796", icon: "minerai", family: "roche" },
  Magnetite: { label: "Magnétite", color: "#7d8796", icon: "minerai", family: "roche" },
  DolomiteOre: { label: "Dolomite", color: "#e3dccd", icon: "pierre", family: "roche" },
  Dolomite: { label: "Dolomite", color: "#e3dccd", icon: "pierre", family: "roche" },
  Erythrite: { label: "Érythrite", color: "#d8679a", icon: "minerai", family: "roche" },
  ScrapMetal: { label: "Ferraille", color: "#aab4be", icon: "ferraille", family: "recup" },
  ScrapElectronics: { label: "Électronique", color: "#6fd1e8", icon: "electronique", family: "recup" },
  ImpureFuel: { label: "Carburant", color: "#e8823a", icon: "carburant", family: "liquide" },
  Spice: { label: "Épice", color: "#f0b13c", icon: "epice", family: "liquide" },
  Water: { label: "Eau", color: "#5fb8e8", icon: "eau", family: "liquide" },
  BurroBush: { label: "Buisson", color: "#8fbf5a", icon: "plante", family: "vegetal" },
  Primrose: { label: "Primevère", color: "#e6a6d0", icon: "fleur", family: "vegetal" },
  PlantFiber: { label: "Fibre végétale", color: "#c5d97a", icon: "fibre", family: "vegetal" },
  Cistanche: { label: "Cistanche", color: "#d9a35f", icon: "fibre", family: "vegetal" },
  Saguaro: { label: "Saguaro", color: "#5fae6e", icon: "cactus", family: "vegetal" },
  Ornithopter: { label: "Ornithoptère", color: "#f1d7ff", icon: "ornithoptere", family: "recup" },
};

/** Catégories déjà calculées : la mini-carte les demande à chaque image. */
const kindCache = new Map<string, { key: string; label: string; color: string; path: string; shape: string; ground: boolean }>();

/** Catégorie d'une ressource (clé de masquage `r:<nom>`), libellé, couleur, pictogramme, et si elle se ramasse au sol. */
export function resourceKind(name: string) {
  const cached = kindCache.get(name);
  if (cached) return cached;
  const ground = name.endsWith("_Pickup");
  const base = name.replace(/_Pickup$/, "");
  // Variantes (« AzuriteOre_Cliffside ») : on garde la ressource de départ.
  const known = Object.keys(RESOURCE_KINDS).filter((n) => base === n || base.startsWith(`${n}_`))[0];
  const k = (known && RESOURCE_KINDS[known]) || { label: base.replace(/([a-z])([A-Z])/g, "$1 $2"), color: "#e9dfc9", icon: "pierre" as const, family: "roche" as const };
  const kind = { key: `r:${k.label}`, label: k.label, color: k.color, path: RES_ICONS[k.icon], shape: FAMILY_SHAPES[k.family], ground };
  kindCache.set(name, kind);
  return kind;
}

/** Pastille SVG d'une ressource : forme de sa famille, fond sombre, contour et silhouette dans sa couleur. */
export function resourceSvg(path: string, color: string, size: number, shape: string = FAMILY_SHAPES.vegetal) {
  return `<svg width="${size}" height="${size}" viewBox="-6 -6 36 36" aria-hidden="true"><path d="${shape}" fill="#11131F" fill-opacity="0.9" stroke="${color}" stroke-width="2.5"/>`
    + `<path d="${path}" fill="${color}" fill-rule="evenodd" transform="translate(3.6 3.6) scale(.7)"/></svg>`;
}

/** Catégories de points d'intérêt masquées, partagées par la carte et la mini-carte. */
export const POI_HIDDEN_KEY = "sietch-carte-poi-masques";

export function hiddenPoiKinds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(POI_HIDDEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Région de la carte lue (calque Survival_1 = Bassin de Hagga). */
export const mapRegion = (m: MapData): Region => (/deep|profond/i.test(m.layer) ? "profond" : "hagga");

/** Coordonnées du jeu (cm) → carte (0 à 900) ; +y vers le sud, comme la carte du jeu. */
export function worldToMap(m: MapData, x: number, y: number) {
  const b = m.bounds;
  return { x: ((x - b.minX) / (b.maxX - b.minX)) * SIZE, y: ((y - b.minY) / (b.maxY - b.minY)) * SIZE };
}
