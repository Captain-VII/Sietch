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
