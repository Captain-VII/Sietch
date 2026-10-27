import type { MapData } from "./api";
import type { Region } from "./data";

/** Côté de la carte, en unités de Sietch (secteurs A1–I9 de 100). */
export const SIZE = 900;

/** Types de points d'intérêt lus dans le jeu (Terrain Blocks) : couleur et pictogramme (dessiné pour Sietch, grille 24 × 24). */
export const POI_KINDS: Record<string, { label: string; color: string; path: string }> = {
  station: { label: "Station écologique", color: "#6fb6e8", path: "M4 18h16M6 18a6 6 0 0 1 12 0M12 6v6M9 9h6" },
  base: { label: "Base", color: "#e05a4f", path: "M5 20V9l7-5 7 5v11zM10 20v-5h4v5" },
  epave: { label: "Épave", color: "#b9ad93", path: "M3 15l4-6h10l4 6zM8 9l2-4M14 9l3-3M6 19h12" },
  mine: { label: "Galerie de mine", color: "#c9a861", path: "M5 20l9-9M8 6c4-2 8-1 10 3M13 5c3 1 5 4 5 8" },
  autel: { label: "Autel", color: "#b46be0", path: "M5 20h14M7 20v-7h10v7M12 13V5M9 8h6" },
  abri: { label: "Abri du Landsraad", color: "#7fd1b9", path: "M3 19L12 5l9 14zM9 19l3-5 3 5" },
  moissonneuse: { label: "Moissonneuse", color: "#e8823a", path: "M3 16h18M5 16v-5h10l4 5M8 11V7h4v4M8 19.5a1.5 1.5 0 1 0 0.01 0M16 19.5a1.5 1.5 0 1 0 0.01 0" },
  histoire: { label: "Lieu de l'histoire", color: "#f1d7ff", path: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5l-5.3 2.9 1.2-6-4.5-4.1 6-.7z" },
  evenement: { label: "Événement", color: "#f09a8a", path: "M12 3l10 18H2zM12 10v5M12 18v.5" },
};

/** Pastille d'un lieu : fond de sa couleur, pictogramme sombre (l'inverse des ressources, pour les distinguer). */
export function poiSvg(kind: string, size: number) {
  const k = POI_KINDS[kind] ?? { color: "#e9dfc9", path: "M12 8a4 4 0 1 0 0.01 0" };
  return `<svg width="${size}" height="${size}" viewBox="-4 -4 32 32" aria-hidden="true"><circle cx="12" cy="12" r="14" fill="${k.color}" stroke="#11131F" stroke-width="2"/>`
    + `<path d="${k.path}" fill="none" stroke="#11131F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Pictogrammes des ressources (dessinés pour Sietch, en trait, grille 24 × 24). */
const RES_ICONS = {
  minerai: "M12 3l6 6-6 12-6-12zM6 9h12M12 3v18",
  pierre: "M4 18l3-9 6-4 6 5 1 8z",
  ferraille: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 9a3 3 0 1 0 0.01 0",
  electronique: "M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
  carburant: "M12 3c3 4 6 6.5 6 11a6 6 0 0 1-12 0c0-3 1.5-5 3-7 1 2 2 3 3 3 0-3-1-5 0-7z",
  plante: "M5 19C5 11 11 5 19 5c0 8-6 14-14 14zM5 19l8-8",
  fleur: "M12 10a2 2 0 1 0 0.01 0M12 3v5M12 14v7M5 9l5 2M19 9l-5 2M8 19l3-6M16 19l-3-6",
  ornithoptere: "M2 11h20M12 7v9M9 16h6M5 11l-3-4M19 11l3-4",
} as const;

/** Ressources lues dans le jeu (générateurs), d'après leur nom interne. Les noms français du jeu peuvent différer. */
const RESOURCE_KINDS: Record<string, { label: string; color: string; icon: keyof typeof RES_ICONS }> = {
  AzuriteOre: { label: "Azurite", color: "#4f8fe0", icon: "minerai" },
  Azurite: { label: "Azurite", color: "#4f8fe0", icon: "minerai" },
  RhyoliteStone: { label: "Rhyolite", color: "#c7b7a0", icon: "pierre" },
  ScrapMetal: { label: "Ferraille", color: "#aab4be", icon: "ferraille" },
  ScrapElectronics: { label: "Électronique", color: "#6fd1e8", icon: "electronique" },
  ImpureFuel: { label: "Carburant", color: "#e8823a", icon: "carburant" },
  BurroBush: { label: "Buisson", color: "#8fbf5a", icon: "plante" },
  Primrose: { label: "Primevère", color: "#e6a6d0", icon: "fleur" },
  Ornithopter: { label: "Ornithoptère", color: "#f1d7ff", icon: "ornithoptere" },
};

/** Catégorie d'une ressource (clé de masquage `r:<nom>`), libellé, couleur, pictogramme, et si elle se ramasse au sol. */
export function resourceKind(name: string) {
  const ground = name.endsWith("_Pickup");
  const base = name.replace(/_Pickup$/, "");
  // Variantes (« AzuriteOre_Cliffside ») : on garde la ressource de départ.
  const known = Object.keys(RESOURCE_KINDS).filter((n) => base === n || base.startsWith(`${n}_`))[0];
  const k = (known && RESOURCE_KINDS[known]) || { label: base.replace(/([a-z])([A-Z])/g, "$1 $2"), color: "#e9dfc9", icon: "pierre" as const };
  return { key: `r:${k.label}`, label: k.label, color: k.color, path: RES_ICONS[k.icon], ground };
}

/** Pastille SVG d'une ressource : fond sombre, contour et pictogramme dans la couleur de la ressource. */
export function resourceSvg(path: string, color: string, size: number) {
  return `<svg width="${size}" height="${size}" viewBox="-4 -4 32 32" aria-hidden="true"><circle cx="12" cy="12" r="14" fill="#11131F" fill-opacity="0.85" stroke="${color}" stroke-width="2"/>`
    + `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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
