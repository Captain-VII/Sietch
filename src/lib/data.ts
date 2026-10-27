// Données gardées côté interface : marqueurs, builds et notes, dans des fichiers JSON locaux.

import { load, type Store } from "@tauri-apps/plugin-store";
import type { TimerGroup } from "./api";

export type Region = "hagga" | "profond";
export type MarkerType = "epice" | "minerai" | "eau" | "epave" | "grotte" | "base" | "autre";

export interface Marker {
  id: string;
  region: Region;
  type: MarkerType;
  name: string;
  /** Position sur la carte, de 0 à 900 sur chaque axe (0,0 = coin haut gauche). */
  x: number;
  y: number;
  note: string;
  timerId?: string;
  updatedAt: number;
}

export const MARKER_TYPES: Record<MarkerType, { label: string; color: string }> = {
  epice: { label: "Épice", color: "#E8823A" },
  minerai: { label: "Minerai", color: "#B8C4CF" },
  eau: { label: "Point d'eau", color: "#4FA3D9" },
  epave: { label: "Épave", color: "#D9C49A" },
  grotte: { label: "Grotte", color: "#9C86E8" },
  base: { label: "Base", color: "#7DD39A" },
  autre: { label: "Autre", color: "#F2E6D0" },
};

export const REGIONS: Record<Region, string> = {
  hagga: "Bassin de Hagga",
  profond: "Désert profond",
};

export const SLOTS = [
  "Tête",
  "Torse",
  "Mains",
  "Jambes",
  "Pieds",
  "Distille",
  "Arme principale",
  "Arme secondaire",
  "Bouclier",
] as const;

export const SCHOOLS = ["Maître d'armes", "Bene Gesserit", "Mentat", "Soldat", "Planétologue"] as const;

export type BuildTag = "PvP" | "PvE" | "Récolte" | "Exploration";
export const BUILD_TAGS: Record<BuildTag, string> = {
  PvP: "#F09A8A",
  PvE: "#8FC4E6",
  Récolte: "#9ED9A8",
  Exploration: "#D9C49A",
};

export interface Build {
  id: string;
  name: string;
  tag: BuildTag;
  slots: Record<string, string>;
  /** Investissement par école, de 0 à 10. */
  schools: Record<string, number>;
  notes: string;
  updatedAt: number;
}

let store: Store | null = null;
async function db() {
  store ??= await load("donnees.json", { autoSave: 300, defaults: {} });
  return store;
}

async function getList<T>(key: string): Promise<T[]> {
  return ((await (await db()).get<T[]>(key)) ?? []).slice();
}

async function setList<T>(key: string, list: T[]) {
  await (await db()).set(key, list);
}

export const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const markers = {
  all: () => getList<Marker>("markers"),
  save: async (m: Marker) => {
    const list = await markers.all();
    const i = list.findIndex((x) => x.id === m.id);
    m.updatedAt = Date.now();
    if (i >= 0) list[i] = m;
    else list.push(m);
    await setList("markers", list);
  },
  remove: async (id: string) => setList("markers", (await markers.all()).filter((m) => m.id !== id)),
  replaceAll: (list: Marker[]) => setList("markers", list),
};

export const builds = {
  all: () => getList<Build>("builds"),
  save: async (b: Build) => {
    const list = await builds.all();
    const i = list.findIndex((x) => x.id === b.id);
    b.updatedAt = Date.now();
    if (i >= 0) list[i] = b;
    else list.unshift(b);
    await setList("builds", list);
  },
  remove: async (id: string) => setList("builds", (await builds.all()).filter((b) => b.id !== id)),
  replaceAll: (list: Build[]) => setList("builds", list),
};

/** Modèle de minuteur : un minuteur qu'on démarre souvent, en un clic. */
export interface TimerTemplate {
  id: string;
  name: string;
  place: string;
  group: TimerGroup;
  durationSecs: number;
  repeat: boolean;
  alarm: boolean;
  inOverlay: boolean;
}

export const timerTemplates = {
  all: () => getList<TimerTemplate>("timerTemplates"),
  save: async (t: TimerTemplate) => {
    const list = (await timerTemplates.all()).filter((x) => x.id !== t.id);
    await setList("timerTemplates", [...list, t].sort((a, b) => a.name.localeCompare(b.name, "fr")));
  },
  remove: async (id: string) => setList("timerTemplates", (await timerTemplates.all()).filter((t) => t.id !== id)),
  replaceAll: (list: TimerTemplate[]) => setList("timerTemplates", list),
};

export async function getNotes(): Promise<string> {
  return (await (await db()).get<string>("notes")) ?? "";
}

export async function setNotes(text: string) {
  await (await db()).set("notes", text);
}

/** Liste à cocher avant une sortie dans le Désert profond. */
export interface CheckItem {
  label: string;
  done: boolean;
}

export const DEFAULT_CHECKLIST = [
  "Eau : distille et literjons pleins",
  "Carburant du véhicule",
  "Power pack chargé",
  "Kits de réparation",
  "Munitions",
  "Soins",
  "Sac vidé avant de partir",
  "Coffres et véhicules à l'abri avant la tempête",
];

export async function getChecklist(): Promise<CheckItem[]> {
  return (await (await db()).get<CheckItem[]>("sortie")) ?? DEFAULT_CHECKLIST.map((label) => ({ label, done: false }));
}

export async function setChecklist(items: CheckItem[]) {
  await (await db()).set("sortie", items);
}

export function newBuild(): Build {
  return {
    id: uid("b"),
    name: "Nouveau build",
    tag: "PvE",
    slots: Object.fromEntries(SLOTS.map((s) => [s, ""])),
    schools: Object.fromEntries(SCHOOLS.map((s) => [s, 0])),
    notes: "",
    updatedAt: Date.now(),
  };
}

/** Secteur "E5" d'une position (grille 9 × 9, colonnes A–I, lignes 1–9). */
export function sectorOf(x: number, y: number): string {
  const col = Math.min(8, Math.max(0, Math.floor(x / 100)));
  const row = Math.min(8, Math.max(0, Math.floor(y / 100)));
  return "ABCDEFGHI"[col] + (row + 1);
}

/** "E5" → centre du secteur, ou null si le texte n'est pas un secteur. */
export function parseSector(text: string): { x: number; y: number } | null {
  const m = /^\s*([a-i])\s*([1-9])\s*$/i.exec(text);
  if (!m) return null;
  return { x: ("abcdefghi".indexOf(m[1].toLowerCase()) + 0.5) * 100, y: (Number(m[2]) - 0.5) * 100 };
}

// ---------- Code de partage d'un build ----------

const SHARE_PREFIX = "SIETCH1-";

export function encodeBuild(b: Build): string {
  const payload = JSON.stringify({ n: b.name, t: b.tag, s: b.slots, k: b.schools, o: b.notes });
  const bytes = new TextEncoder().encode(payload);
  let bin = "";
  bytes.forEach((x) => (bin += String.fromCharCode(x)));
  return SHARE_PREFIX + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBuild(code: string): Build {
  const text = code.trim();
  if (!text.startsWith(SHARE_PREFIX)) throw new Error("Ce n'est pas un code de build Sietch.");
  const b64 = text.slice(SHARE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  const b = newBuild();
  b.name = String(raw.n ?? b.name).slice(0, 80);
  if (raw.t in BUILD_TAGS) b.tag = raw.t;
  for (const s of SLOTS) b.slots[s] = String(raw.s?.[s] ?? "").slice(0, 80);
  for (const s of SCHOOLS) b.schools[s] = Math.min(10, Math.max(0, Number(raw.k?.[s]) || 0));
  b.notes = String(raw.o ?? "").slice(0, 4000);
  return b;
}
