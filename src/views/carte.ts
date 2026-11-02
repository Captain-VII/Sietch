import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Ctx, ViewHandle } from "../main";
import { api, on, type GamePlaces, type GameRegions, type MapData, type SeenResource, type Trail } from "../lib/api";
import { gameIcon, HAZARD_EDGE, HAZARDS, hazardCircles, hiddenPoiKinds, loadGameIcons, mapRegion, MARKER_GAME_ICONS, PLAYER_GAME_ICON, PLAYER_PIVOT_Y, POI_HIDDEN_KEY, POI_KINDS, PLACE_GROUPS, placeIcon, poiSvg, REGION_BORDER, resourceIcon, resourceKind, resourceSvg, SIZE, worldToMap as toWorldMap } from "../lib/carte";
import {
  decodeMarkers, encodeMarkers, markers as store, MARKER_TYPES, parseSector, REGIONS, sectorOf, uid,
  type Marker, type MarkerType, type Region,
} from "../lib/data";
import { confirmDialog, h, icon, mount, toast } from "../lib/dom";
import { live, solveAffine, toMap } from "../lib/live";

/** Leaflet compte la latitude vers le haut : y (vers le bas) devient -y. */
const toLatLng = (x: number, y: number) => L.latLng(-y, x);
const clamp = (v: number) => Math.min(SIZE, Math.max(0, Math.round(v)));

let lastRegion: Region = "hagga";
const HIDDEN_KEY = "sietch-carte-marqueurs-masques";
/** Types de marqueurs masqués, gardés d'une session à l'autre comme les calques du jeu. */
const hidden = new Set<MarkerType>((() => {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as MarkerType[];
  } catch {
    return [];
  }
})());
const saveHidden = () => {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    // Pas de mémoire possible : le filtre vaut pour cette session.
  }
};
/** Catégories de points d'intérêt masquées, gardées d'une session à l'autre. */
const hiddenPoi = new Set<string>(hiddenPoiKinds());
/** Catégories dépliées dans le panneau des filtres : celles des lieux, pour servir de légende. */
const openGroups = new Set<string>(PLACE_GROUPS.map(([label]) => label));

type FilterItem = { key: string; on: boolean; icon: Node; label: string; count?: number };

/**
 * Un calque du panneau des filtres : en-tête (chevron pour déplier, nom, nombre affiché, interrupteur tout / rien,
 * mixte si une partie seulement), puis une ligne par élément (pictogramme, nom, nombre), cliquable.
 */
function filterGroup(label: string, items: FilterItem[], setAll: (on: boolean) => void, toggle: (key: string) => void, redraw: () => void): HTMLElement[] {
  if (!items.length) return [];
  const on = items.filter((i) => i.on).length;
  const opened = openGroups.has(label);
  const head = h("div", { class: "layer-head" },
    h("button", {
      class: "layer-open", type: "button", "aria-expanded": String(opened),
      onclick: () => {
        if (opened) openGroups.delete(label);
        else openGroups.add(label);
        redraw();
      },
    }, h("span", { class: "layer-chevron", "aria-hidden": "true" }, "›"), label, h("span", { class: "layer-count" }, `${on}/${items.length}`)),
    h("button", {
      class: "switch small", type: "button", role: "switch", "aria-label": `${label} : tout afficher ou masquer`,
      "aria-checked": on === items.length ? "true" : on ? "mixed" : "false",
      onclick: () => setAll(on < items.length),
    }));
  if (!opened) return [h("div", { class: "layer" }, head)];
  return [h("div", { class: "layer" }, head,
    h("div", { class: "layer-items", role: "group", "aria-label": label },
      ...items.map((i) => h("button", { class: "layer-item", type: "button", "aria-pressed": String(i.on), onclick: () => toggle(i.key) },
        i.icon, h("span", { class: "layer-item-label" }, i.label), i.count != null ? h("span", { class: "layer-count" }, String(i.count)) : null))))];
}

export function render(root: HTMLElement, ctx: Ctx, action?: string | null): ViewHandle {
  let all: Marker[] = [];
  let region = lastRegion;
  let selected: Marker | null = null;
  /** Marqueur pas encore enregistré (clic droit ou raccourci). */
  let draft = false;

  const mapEl = h("div", { class: "map", role: "application", "aria-label": "Carte, clic droit pour ajouter un marqueur" });
  const panel = h("aside", { class: "card side-panel", "aria-live": "polite" });
  const chipsBox = h("div", { class: "filter-list", role: "group", "aria-label": "Mes marqueurs" });
  const poiChips = h("div", { class: "filter-list", role: "group", "aria-label": "Lieux et ressources du jeu" });
  const regionBox = h("div", { class: "segmented", role: "group", "aria-label": "Région" });
  const countEl = h("span");
  const search = h("input", {
    class: "input search", type: "search", id: "recherche-carte",
    placeholder: "Chercher un marqueur, un lieu (épave, station…) ou un secteur (E5)… puis Entrée",
    style: "flex: 1 1 260px; width: auto",
  });

  const map = L.map(mapEl, {
    crs: L.CRS.Simple,
    minZoom: -1.5,
    maxZoom: 3,
    zoomSnap: 0.25,
    attributionControl: false,
    maxBounds: L.latLngBounds(toLatLng(-200, SIZE + 200), toLatLng(SIZE + 200, -200)),
  });
  const bounds = L.latLngBounds(toLatLng(0, SIZE), toLatLng(SIZE, 0));
  // Vue initiale tout de suite : les données du jeu peuvent arriver avant la fin de l'affichage.
  map.fitBounds(bounds);

  // Grille des secteurs A1–I9.
  const lineStyle = { color: "rgba(217, 182, 122, 0.16)", weight: 1, interactive: false };
  for (let i = 0; i <= 9; i++) {
    L.polyline([toLatLng(i * 100, 0), toLatLng(i * 100, SIZE)], lineStyle).addTo(map);
    L.polyline([toLatLng(0, i * 100), toLatLng(SIZE, i * 100)], lineStyle).addTo(map);
  }
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      L.marker(toLatLng(c * 100 + 6, r * 100 + 4), {
        icon: L.divIcon({ className: "sector-label", html: "ABCDEFGHI"[c] + (r + 1), iconSize: [28, 14], iconAnchor: [0, 0] }),
        interactive: false,
        keyboard: false,
      }).addTo(map);
    }
  }
  // ---------- Carte lue dans le jeu : zones et points d'intérêt de la région ----------
  const gameLayer = L.layerGroup().addTo(map);
  let mapData: MapData | null = null;
  let resources: SeenResource[] = [];

  const worldToMap = (x: number, y: number) => toWorldMap(mapData!, x, y);
  /** Régions et lieux extraits des fichiers du jeu, pour la région affichée (null : pas d'extraction). */
  let game: { region: string; regions: GameRegions | null; places: GamePlaces | null } | null = null;
  const placesHere = () => (game?.region === region ? game.places : null);

  /** Catégories de lieux et de ressources présentes dans la région affichée. */
  let poiKinds: string[] = [];

  /** Catégories de points d'intérêt à cocher, avec le nombre de points de chacune. */
  function drawPoiChips() {
    const counts = new Map<string, number>();
    const looks = new Map<string, { label: string; color: string; path: string; shape: string; game?: string }>();
    /** Pictogramme de la catégorie dans son bouton, pour servir de légende. */
    const resIcon = (kind: string) => {
      const place = placeLooks.get(kind);
      if (place) return h("img", { src: placeIcon(place.icon, kind.slice(2))?.url ?? "", width: "20", height: "20", alt: "", class: "place-icon" });
      const k = looks.get(kind);
      const badge = k && resourceIcon(k);
      if (badge) return h("img", { src: badge.url, width: "20", height: "20", alt: "", class: "place-icon" });
      const el = h("span", { style: "display: inline-flex" });
      el.innerHTML = k ? resourceSvg(k.path, k.color, 18, k.shape, k.game) : poiSvg(kind, 18);
      return el;
    };
    // Lieux : ceux des fichiers du jeu (tous, icône officielle) ; sinon ceux lus en direct autour du joueur.
    const placeLooks = new Map<string, { label: string; icon: string }>();
    const places = placesHere();
    if (places) {
      for (const p of places.places) {
        counts.set(`l:${p.type}`, (counts.get(`l:${p.type}`) ?? 0) + 1);
        placeLooks.set(`l:${p.type}`, { label: p.label, icon: p.icon });
      }
    } else if (mapData && mapRegion(mapData) === region) for (const p of mapData.pois) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    // Ressources : une catégorie par ressource déjà vue, au sol ou non ; le nombre compte celles présentes.
    for (const r of resources) {
      if (r.region !== region) continue;
      const k = resourceKind(r.name);
      counts.set(k.key, (counts.get(k.key) ?? 0) + (r.live ? 1 : 0));
      looks.set(k.key, k);
    }
    const sorted = [...counts].sort((a, b) => b[1] - a[1]);
    poiKinds = sorted.map(([kind]) => kind);
    const item = ([kind, n]: [string, number]) => {
      const k = looks.get(kind) ?? placeLooks.get(kind) ?? POI_KINDS[kind] ?? { label: kind, color: "#e9dfc9" };
      return { key: kind, on: !hiddenPoi.has(kind), icon: resIcon(kind), label: k.label, count: n };
    };
    // Lieux du jeu rangés par catégorie (dans l'ordre de `PLACE_GROUPS`) ; ressources et lieux lus en direct à part.
    const placeGroups = PLACE_GROUPS.map(([label, types]) =>
      [label, types.flatMap((t) => sorted.filter(([kind]) => kind === `l:${t}`)).map(item)] as const);
    const grouped = new Set(PLACE_GROUPS.flatMap(([, types]) => types.map((t) => `l:${t}`)));
    const others = sorted.filter(([kind]) => !kind.startsWith("r:") && !grouped.has(kind)).map(item);
    const res = sorted.filter(([kind]) => kind.startsWith("r:")).map(item);
    const save = () => {
      try {
        localStorage.setItem(POI_HIDDEN_KEY, JSON.stringify([...hiddenPoi]));
      } catch {
        // Stockage indisponible : le choix vaut pour cette session.
      }
      drawPoiChips();
      drawGame();
    };
    const setAll = (keys: string[], on: boolean) => {
      for (const k of keys) {
        if (on) hiddenPoi.delete(k);
        else hiddenPoi.add(k);
      }
      save();
    };
    const toggle = (k: string) => setAll([k], hiddenPoi.has(k));
    const group = (label: string, list: FilterItem[]) => filterGroup(label, list, (on) => setAll(list.map((i) => i.key), on), toggle, drawPoiChips);
    mount(poiChips,
      ...placeGroups.flatMap(([label, list]) => group(label, list)),
      ...group(places ? "Autres lieux" : "Lieux du jeu", others),
      ...group("Ressources", res));
  }

  /** Minuteur de réapparition d'une ressource récoltée ; relancé s'il existe déjà pour ce secteur. */
  async function resourceTimer(r: SeenResource) {
    if (r.respawn <= 0) return;
    const k = resourceKind(r.name);
    const p = worldToMap(r.x, r.y);
    const name = `${k.label}${k.ground ? " (au sol)" : ""}`;
    const place = sectorOf(p.x, p.y);
    const existing = ctx.timers().find((t) => t.name === name && t.place === place);
    if (existing) await api.restartTimer(existing.id);
    else await api.saveTimer({ name, place, group: "ressources", durationSecs: Math.round(r.respawn), repeat: false, alarm: true, inOverlay: true });
    toast("Minuteur lancé", `${name} · ${place} : prêt dans ${Math.round(r.respawn / 60)} min.`);
  }

  /**
   * Calque d'un type de zone de danger, fondu en incrustation à l'opacité du jeu : les cercles qui se chevauchent y
   * forment une seule tache, sans foncer.
   */
  function hazardPane(kind: number) {
    const name = `danger-${kind}`;
    if (!map.getPane(name)) {
      const el = map.createPane(name);
      el.style.opacity = String(HAZARDS[kind].alpha);
      el.style.mixBlendMode = "overlay";
      el.style.zIndex = "405";
      el.style.pointerEvents = "none";
    }
    return name;
  }

  /**
   * Brume (radiations) : le cercle est déformé par un bruit, flouté, puis découpé en nappes ; plus de bord net.
   * Filtre SVG défini une fois dans le calque de la carte, comme les hachures.
   */
  function mist(c: L.Circle) {
    const el = c.getElement();
    const svg = el instanceof SVGElement ? el.ownerSVGElement : null;
    if (!el || !svg) return;
    if (!svg.getElementById("sietch-brume")) {
      const defs = svg.querySelector("defs") ?? svg.insertBefore(document.createElementNS("http://www.w3.org/2000/svg", "defs"), svg.firstChild);
      defs.insertAdjacentHTML("beforeend", `<filter id="sietch-brume" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="3" result="bruit"/>
        <feDisplacementMap in="SourceGraphic" in2="bruit" scale="70" xChannelSelector="R" yChannelSelector="G" result="bord"/>
        <feGaussianBlur in="bord" stdDeviation="14" result="flou"/>
        <feColorMatrix in="bruit" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 2.4 -0.5" result="nappes"/>
        <feComposite in="flou" in2="nappes" operator="in"/>
      </filter>`);
    }
    el.setAttribute("filter", "url(#sietch-brume)");
  }

  /** Nom du lieu nommé du jeu le plus proche (à moins de 200 m), pour donner à chaque icône son vrai nom. */
  function placeName(x: number, y: number) {
    let best: { name: string; d: number } | null = null;
    for (const pl of mapData?.places ?? []) {
      const d = Math.hypot(pl.x - x, pl.y - y);
      if (d < 20_000 && (!best || d < best.d)) best = { name: pl.name, d };
    }
    return best?.name ?? null;
  }

  /**
   * Régions du jeu, toujours affichées (comme gravées sur le fond) : frontière discrète de la couleur du jeu, nom et
   * sous-titre au milieu. Pas de remplissage : le fond porte déjà les couleurs de chaque zone, comme la carte du jeu.
   */
  function drawZones() {
    const b = game?.region === region ? game.regions : null;
    if (!b) return;
    const ll = ([x, y]: [number, number]) => {
      const p = toWorldMap(b, x, y);
      return toLatLng(p.x, p.y);
    };
    for (const z of b.regions) {
      L.polygon(z.rings.map((ring) => ring.map(ll)), { color: REGION_BORDER, weight: 1.2, opacity: 0.55, fill: false, interactive: false }).addTo(gameLayer);
      L.marker(ll(z.label), {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: "region-label", html: h("div", {}, h("b", {}, z.name), h("span", {}, z.subtitle)), iconSize: [180, 34], iconAnchor: [90, 17] }),
      }).addTo(gameLayer);
    }
  }

  /**
   * Lieux du jeu : icône officielle de leur type, à sa taille, nom français au survol. Comme la carte du jeu, chaque type
   * n'apparaît qu'à partir de son niveau de zoom (les camps, très nombreux, de près).
   */
  // Vue d'ensemble : les lieux principaux seuls ; en zoomant, le détail (camps, ressources).
  const placeLods = [L.layerGroup(), L.layerGroup(), L.layerGroup()];
  const PLACE_LOD_ZOOM = [-Infinity, -Infinity, 0.75];
  const detailLayer = placeLods[2];
  const showPlaceLods = () => placeLods.forEach((g, i) => (map.getZoom() >= PLACE_LOD_ZOOM[i] ? g.addTo(gameLayer) : gameLayer.removeLayer(g)));
  map.on("zoomend", showPlaceLods);

  function drawPlaces(places: GamePlaces) {
    for (const p of places.places) {
      if (hiddenPoi.has(`l:${p.type}`)) continue;
      const m = toWorldMap(places, p.x, p.y);
      const img = placeIcon(p.icon, p.type)?.url;
      const size = Math.round(26 * p.scale);
      L.marker(toLatLng(m.x, m.y), {
        icon: L.divIcon({ className: "map-pin", html: img ? `<img class="place-icon" src="${img}" width="${size}" height="${size}" alt="">` : poiSvg("", size), iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        keyboard: false,
      })
        .bindTooltip([p.name, p.name === p.label ? null : p.label, sectorOf(m.x, m.y)].filter(Boolean).join(" · "), { className: "marker-tip", direction: "top", offset: [0, -6] })
        .addTo(placeLods[Math.min(2, Math.max(0, p.lod))]);
    }
  }

  function drawGame() {
    gameLayer.clearLayers();
    placeLods.forEach((g) => g.clearLayers());
    // Régions et lieux des fichiers du jeu : chargés une fois par région, puis redessinés.
    if (game?.region !== region) {
      const r = region;
      game = { region: r, regions: null, places: null };
      void Promise.all([api.gameRegions(r).catch(() => null), api.gamePlaces(r).catch(() => null)]).then(([regions, places]) => {
        if (game?.region !== r) return;
        game = { region: r, regions, places };
        drawGame();
      });
    }
    drawZones();
    drawPoiChips();
    drawTrail();
    const places = placesHere();
    if (places) drawPlaces(places);
    showPlaceLods();
    if (!mapData || mapRegion(mapData) !== region) return;
    const scale = SIZE / (mapData.bounds.maxX - mapData.bounds.minX);
    // Zones de danger comme sur la carte du jeu : sa teinte en incrustation et son bord ; radiations en brume, avec
    // leur icône au centre.
    for (const { kind, x, y, r } of hazardCircles(mapData)) {
      const hz = HAZARDS[kind];
      const img = hz ? gameIcon(hz.icon) : null;
      const p = worldToMap(x, y);
      const ll = toLatLng(p.x, p.y);
      const radius = r * scale;
      if (hz?.mist) mist(L.circle(ll, { pane: hazardPane(kind), radius, stroke: false, fillColor: hz.fill, fillOpacity: 1, interactive: false }).addTo(gameLayer));
      else if (hz) L.circle(ll, { pane: hazardPane(kind), radius, color: HAZARD_EDGE, weight: 1.5, fillColor: hz.fill, fillOpacity: 1, interactive: false }).addTo(gameLayer);
      else L.circle(ll, { radius, color: "#c9a861", weight: 1, opacity: 0.6, fillOpacity: 0.08, interactive: false }).addTo(gameLayer);
      if (img && hz?.mist) {
        L.marker(ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: "", iconSize: [18, 18], html: `<img src="${img}" width="18" height="18" alt="">` }) }).addTo(gameLayer);
      }
    }
    for (const poi of places ? [] : mapData.pois) {
      if (hiddenPoi.has(poi.kind)) continue;
      const p = worldToMap(poi.x, poi.y);
      const kind = POI_KINDS[poi.kind] ?? { label: poi.kind, color: "#e9dfc9" };
      L.marker(toLatLng(p.x, p.y), {
        icon: L.divIcon({ className: "map-pin", html: poiSvg(poi.kind, 24), iconSize: [24, 24], iconAnchor: [12, 12] }),
        keyboard: false,
      })
        .bindTooltip([placeName(poi.x, poi.y), kind.label, sectorOf(p.x, p.y)].filter(Boolean).join(" · "), { className: "marker-tip", direction: "top", offset: [0, -6] })
        .addTo(gameLayer);
    }
    drawResources();
  }

  /**
   * Ressources présentes seulement (lues à l'instant dans le jeu ; ni les déjà vues ni les récoltées), icônes du jeu.
   * Celles d'un même type à moins de 26 px l'une de l'autre à l'écran ne font qu'une icône, avec leur nombre :
   * redessinées à chaque zoom.
   */
  const resourceLayer = L.layerGroup();
  function drawResources() {
    resourceLayer.clearLayers().addTo(detailLayer);
    const groups = new Map<string, SeenResource[]>();
    const zoom = map.getZoom();
    for (const r of resources) {
      if (r.region !== region || !r.live) continue;
      const k = resourceKind(r.name);
      if (hiddenPoi.has(k.key)) continue;
      const p = worldToMap(r.x, r.y);
      const px = map.project(toLatLng(p.x, p.y), zoom);
      const cell = `${k.key}|${Math.round(px.x / 26)}|${Math.round(px.y / 26)}`;
      groups.set(cell, [...(groups.get(cell) ?? []), r]);
    }
    for (const group of groups.values()) {
      const r = group[0];
      const k = resourceKind(r.name);
      const pts = group.map((g) => worldToMap(g.x, g.y));
      const p = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
      const respawn = r.respawn > 0 ? ` · réapparaît en ${Math.round(r.respawn / 60)} min` : "";
      const badge = resourceIcon(k);
      const size = (k.ground ? 14 : 20) + (badge ? 4 : 0);
      const count = group.length > 1 ? `<span class="res-count">${group.length}</span>` : "";
      L.marker(toLatLng(p.x, p.y), {
        icon: L.divIcon({ className: "map-pin", html: (badge ? `<img class="place-icon" src="${badge.url}" width="${size}" height="${size}" alt="">` : resourceSvg(k.path, k.color, size, k.shape, k.game)) + count, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        keyboard: false,
      })
        .bindTooltip(group.length > 1
          ? `${group.length} × ${k.label}${k.ground ? " (au sol)" : ""} · ${sectorOf(p.x, p.y)}<br>Clic : zoomer`
          : `${k.label}${k.ground ? " (au sol)" : ""} · ${sectorOf(p.x, p.y)}${respawn}${r.respawn > 0 ? "<br>Clic : lancer le minuteur" : ""}`, { className: "marker-tip", direction: "top", offset: [0, -4] })
        .on("click", () => group.length > 1
          ? map.fitBounds(L.latLngBounds(pts.map((q) => toLatLng(q.x, q.y))).pad(0.5), { maxZoom: zoom + 2 })
          : void resourceTimer(r))
        .addTo(resourceLayer);
    }
  }
  map.on("zoomend", drawResources);

  // ---------- Fond : capture de la carte du jeu (facultative), alignée en 2 clics ----------
  let bg: L.ImageOverlay | null = null;
  /** Alignement en cours : null, puis le premier coin cliqué. */
  let aligning: false | "first" | { x: number; y: number } = false;
  const bgBox = h("div", { class: "row", style: "--gap: 8px" });

  async function drawBackground() {
    bg?.remove();
    bg = null;
    const url = await api.mapImage(region).catch(() => null);
    if (url) {
      const [x0, y0, x1, y1] = ctx.settings().mapImages[region] ?? [0, 0, SIZE, SIZE];
      bg = L.imageOverlay(url, L.latLngBounds(toLatLng(x0, y1), toLatLng(x1, y0)), { opacity: 0.85, interactive: false }).addTo(map);
      bg.bringToBack();
    }
    const btn = (label: string, onclick: () => void) => h("button", { class: "btn", type: "button", onclick }, label);
    mount(bgBox,
      btn(url ? "Changer le fond" : "Fond : ma capture…", () => void importBackground()),
      url ? btn(aligning ? "Cliquez les coins…" : "Aligner", () => { aligning = "first"; toast("Alignement du fond", "Cliquez le coin haut gauche du secteur A1 sur votre capture, puis le coin bas droit du secteur I9."); void drawBackground(); }) : null,
      url ? btn("Retirer", () => void api.removeMapImage(region).then(drawBackground)) : null,
    );
  }

  async function importBackground() {
    const path = await open({ multiple: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    if (typeof path !== "string") return;
    try {
      await api.importMapImage(region, path);
      await drawBackground();
      toast("Fond importé", "Alignez-le avec « Aligner » : deux clics sur les coins de la grille de votre capture.");
    } catch (e) {
      toast("Import impossible", String(e));
    }
  }

  map.on("click", (e: L.LeafletMouseEvent) => {
    if (!aligning || !bg) return;
    const p = { x: e.latlng.lng, y: -e.latlng.lat };
    if (aligning === "first") {
      aligning = p;
      return;
    }
    // Les deux points cliqués (A1 haut gauche, I9 bas droit) doivent tomber sur (0, 0) et (900, 900).
    const a = aligning;
    aligning = false;
    const [x0, y0, x1, y1] = ctx.settings().mapImages[region] ?? [0, 0, SIZE, SIZE];
    const sx = SIZE / (p.x - a.x), sy = SIZE / (p.y - a.y);
    if (!(sx > 0 && sy > 0)) {
      toast("Alignement annulé", "Cliquez d'abord le coin haut gauche, puis le coin bas droit.");
      void drawBackground();
      return;
    }
    const fit: [number, number, number, number] = [(x0 - a.x) * sx, (y0 - a.y) * sy, (x1 - a.x) * sx, (y1 - a.y) * sy];
    const s = ctx.settings();
    void ctx.saveSettings({ ...s, mapImages: { ...s.mapImages, [region]: fit } }).then(drawBackground);
  });

  void api.mapData().then((m) => { mapData = m; followRegion(); drawGame(); drawLive(); });
  /** Région automatique : la carte suit la région où se trouve le joueur. */
  const followRegion = () => {
    if (!mapData || mapRegion(mapData) === region) return;
    region = lastRegion = mapRegion(mapData);
    drawRegions(); drawMarkers(); drawPanel(); void drawBackground();
  };
  const stopMapData = on.mapData((m) => { mapData = m; followRegion(); drawGame(); drawLive(); });
  void api.resources().then((r) => { resources = r; drawGame(); });
  // Relevé toutes les quelques secondes : seulement les ressources et les comptes des filtres, pas les lieux ni les zones.
  const stopResources = on.resources((r) => {
    resources = r;
    if (!mapData || mapRegion(mapData) !== region) return;
    drawResources();
    drawPoiChips();
  });

  // ---------- Trajet de la session ----------
  let trail: Trail = [];
  const trailLine = L.polyline([], { color: "#f1d7ff", weight: 2, opacity: 0.75, dashArray: "3 5", interactive: false }).addTo(map);
  function drawTrail() {
    const segs: L.LatLng[][] = [[]];
    if (mapData && mapRegion(mapData) === region) {
      for (const p of trail) {
        if (!p) {
          segs.push([]);
          continue;
        }
        const m = worldToMap(p[0], p[1]);
        segs[segs.length - 1].push(toLatLng(m.x, m.y));
      }
    }
    trailLine.setLatLngs(segs.filter((s) => s.length > 1));
  }
  void api.trail().then((t) => { trail = t; drawTrail(); });
  const stopTrail = on.trail((t) => { trail = t; drawTrail(); });
  const stopTrailPoint = on.trailPoint((t) => { trail.push(...t); drawTrail(); });

  const layer = L.layerGroup().addTo(map);

  map.on("contextmenu", (e: L.LeafletMouseEvent) => startDraft(clamp(e.latlng.lng), clamp(-e.latlng.lat)));

  // ---------- Position en direct (modules sans BattlEye) ----------
  const liveLayer = L.layerGroup().addTo(map);
  // Flèche du joueur, tournée selon son orientation (0° = est, les deux flèches pointent vers le nord) :
  // celle du jeu si ses icônes sont extraites, sinon celle de Sietch.
  const playerIcon = () => {
    const img = gameIcon(PLAYER_GAME_ICON);
    return img
      ? L.divIcon({
        className: "player-arrow", iconSize: [36, 36], iconAnchor: [18, 36 * PLAYER_PIVOT_Y],
        html: `<img src="${img}" width="36" height="36" alt="" style="transform-origin: 50% ${PLAYER_PIVOT_Y * 100}%">`,
      })
      : L.divIcon({
        className: "player-arrow", iconSize: [28, 28], iconAnchor: [14, 14],
        html: '<svg viewBox="0 0 28 28" width="28" height="28"><path d="M14 2 L24 25 L14 19 L4 25 Z" fill="#f1d7ff" stroke="#11131F" stroke-width="2" stroke-linejoin="round"/></svg>',
      });
  };
  const liveDot = L.marker([0, 0], { interactive: false, keyboard: false, icon: playerIcon() });
  // Orientation de l'état du personnage : seulement si la position n'en donne pas (chaîne de pointeurs).
  let yaw: number | null = null;
  const stopYaw = on.playerState((s) => (yaw = s.yaw));
  /** Angle affiché, sans retour à 0 : la flèche tourne par le plus court chemin (179° → −179° = 2°). */
  let shownYaw: number | null = null;
  let panning = false;
  /** Animation de la flèche en cours (requestAnimationFrame). */
  let frame = 0;
  map.on("moveend", () => (panning = false));
  const liveBar = h("div", { class: "live-bar", role: "status", "aria-live": "polite" });
  let follow = true;
  // Déplacer la carte à la main arrête le suivi ; le bouton « Suivre » le reprend.
  map.on("dragstart", () => {
    if (!follow) return;
    follow = false;
    drawLive();
  });
  let calibrating = false;
  let liveBarKey = "";

  /** Position du joueur sur la carte affichée, si la région et la calibration le permettent. */
  function livePoint(p = live.predicted()): { x: number; y: number } | null {
    const s = ctx.settings();
    // Carte lue dans le jeu : calage automatique, sans calibration.
    if (p && mapData) return mapRegion(mapData) === region ? worldToMap(p.x, p.y) : null;
    if (!p || s.liveRegion !== region) return null;
    const t = solveAffine(s.calibration[region]);
    return t ? toMap(t, p.x, p.y) : null;
  }

  async function saveCalibration(points: { wx: number; wy: number; mx: number; my: number }[]) {
    const s = ctx.settings();
    await ctx.saveSettings({ ...s, calibration: { ...s.calibration, [region]: points } });
    drawLive();
  }

  function drawLive() {
    const st = live.status;
    const s = ctx.settings();
    const pt = placePlayer();
    if (live.position && !frame) frame = requestAnimationFrame(animate);
    liveBar.hidden = !st.enabled;
    if (!st.enabled) return;
    const pts = s.calibration[region] ?? [];
    const btn = (label: string, onclick: () => void, pressed?: boolean) =>
      h("button", { class: "btn", type: "button", onclick, "aria-pressed": pressed === undefined ? undefined : String(pressed) }, label);
    let text: string;
    const actions: HTMLElement[] = [];
    if (!st.active) {
      text = st.message ?? (st.gameRunning ? "Position en direct en attente." : "Position en direct : jeu non détecté.");
    } else if (mapData && mapRegion(mapData) !== region) {
      text = `Position en direct : vous êtes dans ${REGIONS[mapRegion(mapData)]}.`;
      actions.push(btn("Y aller", () => { region = lastRegion = mapRegion(mapData!); drawRegions(); drawMarkers(); drawPanel(); drawGame(); void drawBackground(); drawLive(); }));
    } else if (!mapData && s.liveRegion !== region) {
      text = `Position en direct : vous êtes dans ${REGIONS[s.liveRegion as Region] ?? s.liveRegion}.`;
      actions.push(btn("Je suis dans cette région", () => void ctx.saveSettings({ ...s, liveRegion: region }).then(drawLive)));
    } else if (calibrating) {
      text = "Cliquez sur la carte à l'endroit exact où vous vous trouvez dans le jeu.";
      actions.push(btn("Annuler", () => { calibrating = false; drawLive(); }));
    } else if (!pt) {
      text = `Calibration ${Math.min(pts.length, 3)}/3 : placez-vous à un endroit reconnaissable (bord de falaise, base…), puis ajoutez un point. Éloignez bien les 3 points.`;
      actions.push(btn("Ajouter un point", () => { calibrating = true; drawLive(); }));
      if (pts.length) actions.push(btn("Recommencer", () => void saveCalibration([])));
    } else {
      text = `Vous : ${sectorOf(pt.x, pt.y)}${st.source === "simulation" ? " (simulation)" : ""}`;
      actions.push(
        btn("Suivre", () => {
          follow = !follow;
          if (follow) map.panTo(toLatLng(pt.x, pt.y), { animate: true });
          drawLive();
        }, follow),
        btn("Marqueur ici", () => startDraft(clamp(pt.x), clamp(pt.y))),
        btn("Effacer le trajet", () => void api.clearTrail()),
        ...(mapData ? [] : [btn("Recalibrer", () => void saveCalibration([]))]),
      );
    }
    // Le bandeau ne change que si son texte change : sinon ses boutons seraient
    // remplacés à chaque position reçue (4 fois par seconde) pendant qu'on clique.
    const key = [text, st.active, follow, actions.length].join("|");
    if (key === liveBarKey) return;
    liveBarKey = key;
    mount(liveBar, h("span", { class: "live-dot", "data-on": String(st.active) }), h("span", { class: "grow" }, text), actions);
  }

  map.on("click", (e: L.LeafletMouseEvent) => {
    const p = live.position;
    if (!calibrating || !p) return;
    calibrating = false;
    const pts = [...(ctx.settings().calibration[region] ?? []), { wx: p.x, wy: p.y, mx: clamp(e.latlng.lng), my: clamp(-e.latlng.lat) }].slice(-3);
    if (pts.length === 3 && !solveAffine(pts)) {
      toast("Points trop proches ou alignés", "Ajoutez un point ailleurs, loin des deux autres.");
      void saveCalibration(pts.slice(0, 2));
      return;
    }
    void saveCalibration(pts);
  });
  /** Ce qui change le bandeau : à chaque position reçue (jusqu'à 120 par seconde), on ne le refait que si ça bouge. */
  const liveKey = () => {
    const st = live.status;
    const pt = livePoint();
    return [st.enabled, st.active, st.message, st.gameRunning, mapData && mapRegion(mapData), ctx.settings().liveRegion, pt && sectorOf(pt.x, pt.y)].join("|");
  };
  let lastLiveKey = "";
  const stopLive = live.subscribe(() => {
    const k = liveKey();
    if (k !== lastLiveKey) {
      lastLiveKey = k;
      drawLive();
    } else if (live.position && !frame) frame = requestAnimationFrame(animate);
  });

  /** Place la flèche du joueur à sa position prolongée ; appelé à chaque image tant que la position arrive. */
  function placePlayer() {
    const pt = livePoint();
    if (!pt) {
      liveLayer.clearLayers();
      return null;
    }
    const ll = toLatLng(Math.max(0, Math.min(SIZE, pt.x)), Math.max(0, Math.min(SIZE, pt.y)));
    liveDot.setLatLng(ll);
    if (!liveLayer.hasLayer(liveDot)) liveLayer.addLayer(liveDot);
    const a = live.position?.yaw ?? yaw;
    const arrow = liveDot.getElement()?.querySelector<HTMLElement | SVGElement>("svg, img");
    if (arrow && a !== null) {
      shownYaw = shownYaw === null ? a : shownYaw + (((((a - shownYaw) % 360) + 540) % 360) - 180);
      arrow.style.transform = `rotate(${shownYaw + 90}deg)`;
    }
    // Un seul déplacement de la carte à la fois : relancé à chaque image, il saccaderait.
    if (follow && !panning && !map.getBounds().pad(-0.25).contains(ll)) {
      panning = true;
      map.panTo(ll, { animate: true });
    }
    return pt;
  }

  function animate() {
    placePlayer();
    // Plus de position nouvelle depuis 250 ms (immobile) : on arrête ; la suivante relance la boucle.
    const fresh = live.position && Date.now() - live.position.at < 250;
    frame = fresh ? requestAnimationFrame(animate) : 0;
  }

  function startDraft(x: number, y: number) {
    selected = { id: uid("m"), region, type: "autre", name: "", x, y, note: "", updatedAt: Date.now() };
    draft = true;
    if (hidden.has("autre")) hidden.delete("autre");
    drawChips();
    drawMarkers();
    drawPanel();
  }

  function visible() {
    const list = all.filter((m) => m.region === region && !hidden.has(m.type));
    if (draft && selected && !list.includes(selected)) list.push(selected);
    return list;
  }

  function drawMarkers() {
    layer.clearLayers();
    const list = visible();
    for (const m of list) {
      const isSel = selected?.id === m.id;
      const img = gameIcon(MARKER_GAME_ICONS[m.type]);
      const color = MARKER_TYPES[m.type].color;
      const size = isSel ? 34 : 26;
      // Icône du jeu sur pastille sombre bordée de la couleur du type (blanc si sélectionné), sinon un point de couleur.
      const dot = img
        ? L.marker(toLatLng(m.x, m.y), {
          icon: L.divIcon({
            className: "", iconSize: [size, size],
            html: `<svg width="${size}" height="${size}" viewBox="-6 -6 36 36"><circle cx="12" cy="12" r="16.5" fill="#11131F" stroke="${isSel ? "#F2E6D0" : color}" stroke-width="${isSel ? 3.5 : 2.5}"/><image href="${img}" x="-1" y="-1" width="26" height="26"/></svg>`,
          }),
        })
        : L.circleMarker(toLatLng(m.x, m.y), {
          radius: isSel ? 10 : 7,
          color: isSel ? "#F2E6D0" : "#11131F",
          weight: isSel ? 3 : 2,
          fillColor: color,
          fillOpacity: 1,
        });
      dot.bindTooltip(m.name || "Nouveau marqueur", { className: "marker-tip", direction: "top", offset: [0, -8], permanent: isSel });
      dot.on("click", () => select(m));
      dot.addTo(layer);
    }
    countEl.textContent = `${list.length} marqueur${list.length > 1 ? "s" : ""} affiché${list.length > 1 ? "s" : ""}`;
  }

  function select(m: Marker | null) {
    if (draft && selected && m?.id !== selected.id) draft = false;
    selected = m;
    drawMarkers();
    drawPanel();
  }

  function drawChips() {
    saveHidden(); // chaque changement de filtre repasse par ici
    const types = Object.keys(MARKER_TYPES) as MarkerType[];
    const set = (list: MarkerType[], on: boolean) => {
      for (const t of list) {
        if (on) hidden.delete(t);
        else hidden.add(t);
      }
      if (selected && hidden.has(selected.type) && !draft) selected = null;
      drawChips();
      drawMarkers();
      drawPanel();
    };
    mount(chipsBox, ...filterGroup(
      "Mes marqueurs",
      types.map((t) => ({
        key: t, on: !hidden.has(t),
        icon: h("span", { class: "dot", style: `color: ${MARKER_TYPES[t].color}; background: ${MARKER_TYPES[t].color}` }), label: MARKER_TYPES[t].label,
      })),
      (on) => set(types, on),
      (k) => set([k as MarkerType], hidden.has(k as MarkerType)),
      drawChips,
    ));
  }

  /** Tout afficher ou masquer, marqueurs comme lieux du jeu. */
  function showAll(on: boolean) {
    for (const t of Object.keys(MARKER_TYPES) as MarkerType[]) {
      if (on) hidden.delete(t);
      else hidden.add(t);
    }
    if (on) hiddenPoi.clear();
    else for (const k of poiKinds) hiddenPoi.add(k);
    try {
      localStorage.setItem(POI_HIDDEN_KEY, JSON.stringify([...hiddenPoi]));
    } catch {
      // Stockage indisponible : le choix vaut pour cette session.
    }
    if (selected && hidden.has(selected.type) && !draft) selected = null;
    drawChips();
    drawPoiChips();
    drawMarkers();
    drawGame();
    drawPanel();
  }

  function drawRegions() {
    mount(
      regionBox,
      (Object.keys(REGIONS) as Region[]).map((r) =>
        h("button", {
          type: "button", "aria-pressed": String(r === region),
          onclick: () => {
            region = lastRegion = r;
            draft = false;
            selected = null;
            calibrating = false;
            drawRegions();
            drawMarkers();
            drawPanel();
            drawGame(); void drawBackground();
            drawLive();
          },
        }, REGIONS[r]),
      ),
    );
  }

  function drawPanel() {
    if (!selected) {
      const counts = (Object.keys(MARKER_TYPES) as MarkerType[])
        .map((t) => [t, all.filter((m) => m.region === region && m.type === t).length] as const)
        .filter(([, n]) => n > 0);
      mount(
        panel,
        h("h2", { class: "section-title" }, REGIONS[region]),
        h("p", { class: "prose soft", style: "margin: 0" }, "Clic droit sur la carte pour poser un marqueur, ou utilisez le raccourci global depuis le jeu."),
        counts.length
          ? h("div", { class: "stack", style: "--gap: 8px" },
              counts.map(([t, n]) => h("div", { class: "row spread" },
                h("span", { class: "row", style: "--gap: 8px" }, h("span", { class: "dot", style: `color: ${MARKER_TYPES[t].color}; background: ${MARKER_TYPES[t].color}` }), MARKER_TYPES[t].label),
                h("span", { class: "digits", style: "font-size: 13px" }, String(n)))))
          : h("p", { class: "muted", style: "margin: 0" }, "Aucun marqueur dans cette région."),
      );
      return;
    }
    const m = selected;
    const linked = m.timerId ? ctx.timers().find((t) => t.id === m.timerId) : undefined;
    const name = h("input", { class: "input", id: "m-nom", type: "text", maxlength: "80", value: m.name, placeholder: "ex. Gisement d'épice" });
    const type = h("select", { class: "select", id: "m-type" },
      (Object.keys(MARKER_TYPES) as MarkerType[]).map((t) => h("option", { value: t, selected: t === m.type }, MARKER_TYPES[t].label)));
    const note = h("textarea", { class: "textarea", id: "m-note", rows: "3", maxlength: "1000" });
    note.value = m.note;
    const link = h("input", { type: "checkbox" });
    const respawn = h("input", { class: "input", id: "m-resp", type: "number", min: "1", max: "10000", value: "45", style: "width: 96px" });

    const saveBtn = h("button", {
      class: "btn btn-primary grow", type: "button",
      onclick: async () => {
        m.name = name.value.trim() || MARKER_TYPES[type.value as MarkerType].label;
        m.type = type.value as MarkerType;
        m.note = note.value.trim();
        if (link.checked) {
          const mins = Math.max(1, Number(respawn.value) || 45);
          m.timerId = await api.saveTimer({
            name: `${m.name} — ${sectorOf(m.x, m.y)}`, place: REGIONS[m.region], group: "ressources",
            durationSecs: mins * 60, repeat: false, alarm: true, inOverlay: true,
          });
        }
        await store.save(m);
        draft = false;
        all = await store.all();
        selected = all.find((x) => x.id === m.id) ?? null;
        if (hidden.has(m.type)) hidden.delete(m.type);
        drawChips();
        drawMarkers();
        drawPanel();
        toast("Marqueur enregistré", `${m.name} · ${sectorOf(m.x, m.y)}`);
      },
    }, "Enregistrer");
    const removeBtn = h("button", {
      class: "btn btn-danger", type: "button",
      onclick: async () => {
        if (draft) return select(null);
        if (!(await confirmDialog(`Supprimer le marqueur « ${m.name} » ?`, "Supprimer"))) return;
        await store.remove(m.id);
        all = await store.all();
        select(null);
      },
    }, draft ? "Annuler" : "Supprimer");

    mount(
      panel,
      h("div", { class: "stack", style: "--gap: 6px" },
        h("span", { class: "eyebrow", style: "font-size: 12px" }, `${draft ? "Nouveau marqueur" : "Marqueur"} · ${sectorOf(m.x, m.y)}`),
        h("h2", { class: "h2", style: "font-size: 17px" }, m.name || "Sans nom"),
      ),
      h("div", { class: "field" }, h("label", { class: "label", for: "m-nom" }, "Nom"), name),
      h("div", { class: "field" }, h("label", { class: "label", for: "m-type" }, "Type"), type),
      h("div", { class: "field" }, h("label", { class: "label", for: "m-note" }, "Note"), note),
      linked
        ? h("div", { class: "stack", style: "--gap: 8px" },
            h("span", { class: "label" }, "Minuteur lié"),
            h("div", { class: "row spread" },
              h("span", { class: "digits", "data-timer": linked.id, "data-part": "left" }),
              h("button", { class: "btn", type: "button", onclick: () => api.restartTimer(linked.id) }, icon("restart", 16), "Relancer"),
            ))
        : h("div", { class: "row wrap" },
            h("label", { class: "check grow" }, link, "Lier un minuteur de réapparition"),
            h("label", { class: "sr-only", for: "m-resp" }, "Durée en minutes"),
            respawn, h("span", { class: "muted" }, "min")),
      h("div", { class: "row" }, saveBtn, removeBtn),
    );
    if (draft) name.focus();
  }

  async function exportMarkers() {
    const path = await save({ defaultPath: "sietch-marqueurs.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return;
    await writeTextFile(path, JSON.stringify({ format: "sietch-marqueurs", version: 1, markers: all }, null, 2));
    toast("Export terminé", `${all.length} marqueurs enregistrés.`);
  }

  async function importMarkers() {
    const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      const raw = JSON.parse(await readTextFile(path));
      const list: unknown[] = Array.isArray(raw) ? raw : raw.markers;
      if (!Array.isArray(list)) throw new Error("aucune liste de marqueurs dans ce fichier");
      const incoming: Marker[] = list.flatMap((x) => {
        const o = x as Partial<Marker>;
        if (typeof o.x !== "number" || typeof o.y !== "number") return [];
        return [{
          id: typeof o.id === "string" ? o.id : uid("m"),
          region: o.region === "profond" ? "profond" : "hagga",
          type: o.type && o.type in MARKER_TYPES ? o.type : "autre",
          name: String(o.name ?? "").slice(0, 80),
          x: clamp(o.x), y: clamp(o.y),
          note: String(o.note ?? "").slice(0, 1000),
          updatedAt: Date.now(),
        } satisfies Marker];
      });
      const byId = new Map(all.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      await store.replaceAll([...byId.values()]);
      all = await store.all();
      drawMarkers();
      drawPanel();
      toast("Import terminé", `${incoming.length} marqueurs ajoutés ou mis à jour.`);
    } catch (e) {
      toast("Import impossible", String(e instanceof Error ? e.message : e));
    }
  }

  /** Partage par code (amis, guilde) : le marqueur sélectionné ou ceux affichés, et collage d'un code reçu. */
  function shareMarkers() {
    const list = selected && !draft ? [selected] : visible();
    const code = list.length ? encodeMarkers(list) : "";
    const out = h("textarea", { class: "textarea", rows: "3", readonly: true, "aria-label": "Code à partager", style: "word-break: break-all; width: 100%; box-sizing: border-box" });
    out.value = code;
    const input = h("input", { class: "input", type: "text", placeholder: "SIETCHM1-…", "aria-label": "Code reçu", style: "flex: 1 1 auto; min-width: 0; width: auto" });
    const dlg = h("dialog", { class: "dialog" });
    const close = () => { dlg.close(); dlg.remove(); };
    mount(dlg,
      h("div", { class: "stack", style: "--gap: 16px; min-width: 0" },
        h("h2", { class: "section-title" }, "Partager des marqueurs"),
        list.length
          ? [h("p", { class: "muted", style: "margin: 0" }, selected && !draft ? `Le marqueur « ${selected.name} ».` : list.length > 1 ? `Les ${list.length} marqueurs affichés dans ${REGIONS[region]}.` : `Le seul marqueur affiché dans ${REGIONS[region]}.`),
             out,
             h("button", { class: "btn btn-primary", type: "button", style: "align-self: flex-start", onclick: async () => {
               await navigator.clipboard.writeText(code);
               toast("Code copié", "Collez-le à vos amis : ils l'ajoutent depuis leur carte.");
             } }, icon("copy", 16), "Copier le code")]
          : h("p", { class: "muted", style: "margin: 0" }, "Aucun marqueur affiché à partager."),
        h("span", { class: "label" }, "Ajouter des marqueurs reçus"),
        h("div", { class: "row", style: "--gap: 8px" }, input,
          h("button", { class: "btn", type: "button", onclick: async () => {
            try {
              // Un marqueur déjà présent (même région, nom et position) n'est pas ajouté deux fois.
              const key = (m: Marker) => `${m.region}|${m.name}|${m.x}|${m.y}`;
              const have = new Set(all.map(key));
              const incoming = decodeMarkers(input.value).filter((m) => !have.has(key(m)));
              await store.replaceAll([...all, ...incoming]);
              all = await store.all();
              drawMarkers();
              drawPanel();
              close();
              toast("Marqueurs ajoutés", `${incoming.length} marqueur${incoming.length > 1 ? "s" : ""}.`);
            } catch (e) {
              toast("Code refusé", String(e instanceof Error ? e.message : e));
            }
          } }, "Ajouter")),
        h("div", { class: "row", style: "justify-content: flex-end" }, h("button", { class: "btn", type: "button", onclick: close }, "Fermer")),
      ),
    );
    dlg.addEventListener("cancel", () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = search.value.trim();
    if (!q) return;
    const sector = parseSector(q);
    if (sector) {
      map.flyTo(toLatLng(sector.x, sector.y), 1.5);
      return;
    }
    const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const found = all.find((m) => m.region === region && fold(m.name).includes(fold(q)))
      ?? all.find((m) => fold(m.name).includes(fold(q)));
    // Lieux des fichiers du jeu : par nom (« Gardefaille ») ou par type (« grotte ») ; le plus proche du joueur d'abord.
    const places = placesHere();
    if (!found && places) {
      const me = livePoint();
      const at = (p: { x: number; y: number }) => toWorldMap(places, p.x, p.y);
      const hits = places.places.filter((p) => fold(p.name).includes(fold(q)) || fold(p.label).includes(fold(q)))
        .sort((a, b) => (me ? Math.hypot(at(a).x - me.x, at(a).y - me.y) - Math.hypot(at(b).x - me.x, at(b).y - me.y) : 0));
      if (hits.length) {
        hiddenPoi.delete(`l:${hits[0].type}`);
        drawGame();
        const m = at(hits[0]);
        map.flyTo(toLatLng(m.x, m.y), 2);
        toast(hits[0].name, `${hits[0].label} · ${sectorOf(m.x, m.y)}${hits.length > 1 ? ` · le plus proche sur ${hits.length}` : ""}`);
        return;
      }
    }
    if (!found) {
      // Ressources présentes : par nom (« aluminium ») ; la plus proche du joueur d'abord.
      const me = livePoint();
      const near = resources.filter((r) => r.region === region && r.live && fold(resourceKind(r.name).label).includes(fold(q)))
        .map((r) => ({ r, m: worldToMap(r.x, r.y) }))
        .sort((a, b) => (me ? Math.hypot(a.m.x - me.x, a.m.y - me.y) - Math.hypot(b.m.x - me.x, b.m.y - me.y) : 0));
      if (near.length) {
        const k = resourceKind(near[0].r.name);
        hiddenPoi.delete(k.key);
        drawGame();
        map.flyTo(toLatLng(near[0].m.x, near[0].m.y), 2.5);
        toast(k.label, `${sectorOf(near[0].m.x, near[0].m.y)}${near.length > 1 ? ` · la plus proche sur ${near.length}` : ""}`);
        return;
      }
    }
    if (!found) {
      // Points d'intérêt du jeu : par type (« épave ») ou par nom ; le plus proche du joueur d'abord.
      const pois = (mapData && mapRegion(mapData) === region ? mapData.pois : [])
        .filter((p) => fold(POI_KINDS[p.kind]?.label ?? p.kind).includes(fold(q)) || fold(p.name).includes(fold(q)));
      const me = livePoint();
      const dist = (p: { x: number; y: number }) => {
        const m = worldToMap(p.x, p.y);
        return me ? (m.x - me.x) ** 2 + (m.y - me.y) ** 2 : 0;
      };
      const poi = pois.sort((a, b) => dist(a) - dist(b))[0];
      if (!poi) return toast("Aucun résultat", `Rien ne correspond à « ${q} ».`);
      hiddenPoi.delete(poi.kind);
      drawGame();
      const m = worldToMap(poi.x, poi.y);
      map.flyTo(toLatLng(m.x, m.y), 2);
      toast(POI_KINDS[poi.kind]?.label ?? poi.kind, `${sectorOf(m.x, m.y)}${pois.length > 1 ? ` · le plus proche sur ${pois.length}` : ""}`);
      return;
    }
    if (found.region !== region) {
      region = lastRegion = found.region;
      drawRegions();
    }
    hidden.delete(found.type);
    drawChips();
    select(found);
    map.flyTo(toLatLng(found.x, found.y), 1.5);
  });

  mount(
    root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Secteurs A1 — I9"), h("h1", { class: "h1" }, "Carte")),
      h("div", { class: "row wrap" },
        regionBox,
        h("button", { class: "btn", type: "button", onclick: shareMarkers }, "Partager"),
        h("button", { class: "btn", type: "button", onclick: importMarkers }, "Importer"),
        h("button", { class: "btn", type: "button", onclick: exportMarkers }, "Exporter"),
        bgBox,
      ),
    ),
    h("div", { class: "row wrap" }, h("label", { class: "sr-only", for: "recherche-carte" }, "Rechercher sur la carte"), search),
    liveBar,
    h("div", { class: "columns map-columns" },
      h("div", { class: "map-wrap" },
        mapEl,
        h("div", { class: "row spread muted", style: "font-size: 13px" }, h("span", {}, "Molette : zoom · Clic droit : nouveau marqueur"), countEl),
      ),
      h("div", { class: "side-col" },
        h("aside", { class: "card filters-card stack", style: "--gap: 10px" },
          h("div", { class: "row spread" },
            h("h2", { class: "section-title", style: "flex: 1" }, "Calques"),
            h("div", { class: "row", style: "--gap: 2px" },
              h("button", { class: "link-btn", type: "button", onclick: () => showAll(true) }, "Tout"),
              h("span", { class: "muted", "aria-hidden": "true" }, "·"),
              h("button", { class: "link-btn", type: "button", onclick: () => showAll(false) }, "Aucun"),
            ),
          ),
          chipsBox,
          poiChips,
          h("p", { class: "muted", style: "font-size: 12px; margin: 0" }, "Vue d'ensemble : les lieux principaux. En zoomant : camps et ressources présentes."),
        ),
        panel,
      ),
    ),
  );

  drawRegions();
  drawChips();
  // Icônes du jeu extraites en local : elles remplacent les pictogrammes une fois chargées.
  void loadGameIcons().then(() => {
    drawPoiChips();
    drawGame();
    drawMarkers();
    liveDot.setIcon(playerIcon());
  });
  requestAnimationFrame(() => {
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [8, 8] });
  });
  // La carte suit la taille de la fenêtre (elle prend toute la hauteur restante).
  const resize = new ResizeObserver(() => map.invalidateSize());
  resize.observe(mapEl);
  void store.all().then((list) => {
    all = list;
    drawMarkers();
    if (action === "new-marker") {
      // Avec la position en direct, le marqueur se pose là où se trouve le joueur.
      const lp = livePoint();
      const c = map.getCenter();
      startDraft(clamp(lp ? lp.x : c.lng), clamp(lp ? lp.y : -c.lat));
    } else {
      drawPanel();
    }
  });
  drawPanel();

  // Le décompte du minuteur lié se met à jour tout seul (data-timer) :
  // pas besoin de redessiner le panneau, ce qui effacerait une saisie en cours.
  drawLive();
  void drawBackground();
  return {
    onSettings: drawLive,
    dispose: () => {
      resize.disconnect();
      stopLive();
      cancelAnimationFrame(frame);
      void stopMapData.then((un) => un());
      void stopResources.then((un) => un());
      void stopTrail.then((un) => un());
      void stopTrailPoint.then((un) => un());
      void stopYaw.then((un) => un());
      map.remove();
    },
  };
}
