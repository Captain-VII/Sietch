import type { MapData } from "./api";
import type { Region } from "./data";

/** Côté de la carte, en unités de Sietch (secteurs A1–I9 de 100). */
export const SIZE = 900;

/** Types de points d'intérêt lus dans le jeu (Terrain Blocks), couleurs de la carte. */
export const POI_KINDS: Record<string, { label: string; color: string }> = {
  station: { label: "Station écologique", color: "#6fb6e8" },
  base: { label: "Base", color: "#e05a4f" },
  epave: { label: "Épave", color: "#b9ad93" },
  mine: { label: "Galerie de mine", color: "#c9a861" },
  autel: { label: "Autel", color: "#b46be0" },
  abri: { label: "Abri du Landsraad", color: "#7fd1b9" },
  moissonneuse: { label: "Moissonneuse", color: "#e8823a" },
  histoire: { label: "Lieu de l'histoire", color: "#f1d7ff" },
  evenement: { label: "Événement", color: "#f09a8a" },
};

/** Ressources lues dans le jeu (générateurs), d'après leur nom interne. Les noms français du jeu peuvent différer. */
const RESOURCE_KINDS: Record<string, { label: string; color: string }> = {
  AzuriteOre: { label: "Azurite", color: "#4f8fe0" },
  Azurite: { label: "Azurite", color: "#4f8fe0" },
  RhyoliteStone: { label: "Rhyolite", color: "#a99a86" },
  ScrapMetal: { label: "Ferraille", color: "#9aa3ad" },
  ScrapElectronics: { label: "Électronique", color: "#6fd1e8" },
  ImpureFuel: { label: "Carburant", color: "#e8823a" },
  BurroBush: { label: "Buisson", color: "#8fbf5a" },
  Primrose: { label: "Primevère", color: "#e6a6d0" },
  Ornithopter: { label: "Ornithoptère", color: "#f1d7ff" },
};

/** Catégorie d'une ressource (clé de masquage `r:<nom>`), libellé, couleur, et si elle se ramasse au sol. */
export function resourceKind(name: string) {
  const ground = name.endsWith("_Pickup");
  const base = name.replace(/_Pickup$/, "");
  // Variantes (« AzuriteOre_Cliffside ») : on garde la ressource de départ.
  const known = Object.keys(RESOURCE_KINDS).filter((n) => base === n || base.startsWith(`${n}_`))[0];
  const k = (known && RESOURCE_KINDS[known]) || { label: base.replace(/([a-z])([A-Z])/g, "$1 $2"), color: "#e9dfc9" };
  return { key: `r:${k.label}`, label: k.label, color: k.color, ground };
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
