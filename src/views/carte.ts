import L from "leaflet";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Ctx, ViewHandle } from "../main";
import { api, on, type MapData, type SeenResource, type Trail } from "../lib/api";
import { hiddenPoiKinds, mapRegion, POI_HIDDEN_KEY, POI_KINDS, poiSvg, resourceKind, resourceSvg, SIZE, worldToMap as toWorldMap } from "../lib/carte";
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
const hidden = new Set<MarkerType>();
/** Catégories de points d'intérêt masquées, gardées d'une session à l'autre. */
const hiddenPoi = new Set<string>(hiddenPoiKinds());

export function render(root: HTMLElement, ctx: Ctx, action?: string | null): ViewHandle {
  let all: Marker[] = [];
  let region = lastRegion;
  let selected: Marker | null = null;
  /** Marqueur pas encore enregistré (clic droit ou raccourci). */
  let draft = false;

  const mapEl = h("div", { class: "map", role: "application", "aria-label": "Carte, clic droit pour ajouter un marqueur" });
  const panel = h("aside", { class: "card side-panel", "aria-live": "polite" });
  const chipsBox = h("div", { class: "row wrap" });
  const poiChips = h("div", { class: "row wrap", "aria-label": "Points d'intérêt du jeu" });
  const poiRow = h("div", { class: "row wrap", style: "--gap: 10px" }, h("span", { class: "label" }, "Lieux du jeu"), poiChips);
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

  // Grille des secteurs A1–I9 et quelques lignes de dunes décoratives.
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
  for (const y of [200, 430, 670]) {
    const pts = Array.from({ length: 19 }, (_, i) => toLatLng(i * 50, y + Math.sin(i * 0.7 + y) * 18));
    L.polyline(pts, { color: "#5B4D2E", weight: 1.2, interactive: false, smoothFactor: 2 }).addTo(map);
  }
  // ---------- Carte lue dans le jeu : zones et points d'intérêt de la région ----------
  const gameLayer = L.layerGroup().addTo(map);
  let mapData: MapData | null = null;
  let resources: SeenResource[] = [];

  const worldToMap = (x: number, y: number) => toWorldMap(mapData!, x, y);

  /** Catégories de points d'intérêt à cocher, avec le nombre de points de chacune. */
  function drawPoiChips() {
    const counts = new Map<string, number>();
    const looks = new Map<string, { label: string; color: string; path: string }>();
    /** Pictogramme de la catégorie dans son bouton, pour servir de légende. */
    const resIcon = (kind: string) => {
      const k = looks.get(kind);
      const el = h("span", { style: "display: inline-flex" });
      el.innerHTML = k ? resourceSvg(k.path, k.color, 18) : poiSvg(kind, 18);
      return el;
    };
    if (mapData && mapRegion(mapData) === region) for (const p of mapData.pois) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    // Ressources : une catégorie par ressource, au sol ou non.
    for (const r of resources) {
      if (r.region !== region) continue;
      const k = resourceKind(r.name);
      counts.set(k.key, (counts.get(k.key) ?? 0) + 1);
      looks.set(k.key, k);
    }
    mount(poiChips, [...counts].sort((a, b) => Number(a[0].startsWith("r:")) - Number(b[0].startsWith("r:")) || b[1] - a[1]).map(([kind, n]) => {
      const k = looks.get(kind) ?? POI_KINDS[kind] ?? { label: kind, color: "#e9dfc9" };
      return h("button", {
        class: "chip", type: "button", "aria-pressed": String(!hiddenPoi.has(kind)),
        onclick: () => {
          if (hiddenPoi.has(kind)) hiddenPoi.delete(kind);
          else hiddenPoi.add(kind);
          try {
            localStorage.setItem(POI_HIDDEN_KEY, JSON.stringify([...hiddenPoi]));
          } catch {
            // Stockage indisponible : le choix vaut pour cette session.
          }
          drawPoiChips();
          drawGame();
        },
      }, resIcon(kind), `${k.label} (${n})`);
    }));
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

  function drawGame() {
    gameLayer.clearLayers();
    drawPoiChips();
    drawTrail();
    if (!mapData || mapRegion(mapData) !== region) return;
    const scale = SIZE / (mapData.bounds.maxX - mapData.bounds.minX);
    for (const a of mapData.areas) {
      for (const [x, y, r] of a.circles) {
        const p = worldToMap(x, y);
        L.circle(toLatLng(p.x, p.y), { radius: r * scale, color: "#c9a861", weight: 1, opacity: 0.35, fillOpacity: 0.06, interactive: false }).addTo(gameLayer);
      }
    }
    for (const poi of mapData.pois) {
      if (hiddenPoi.has(poi.kind)) continue;
      const p = worldToMap(poi.x, poi.y);
      const kind = POI_KINDS[poi.kind] ?? { label: poi.kind, color: "#e9dfc9" };
      L.marker(toLatLng(p.x, p.y), {
        icon: L.divIcon({ className: "map-pin", html: poiSvg(poi.kind, 24), iconSize: [24, 24], iconAnchor: [12, 12] }),
        keyboard: false,
      })
        .bindTooltip(`${kind.label} · ${sectorOf(p.x, p.y)}`, { className: "marker-tip", direction: "top", offset: [0, -6] })
        .addTo(gameLayer);
    }
    // Ressources : petits points sans contour ; pâles quand elles ne sont plus chargées (déjà vues).
    for (const r of resources) {
      if (r.region !== region) continue;
      const k = resourceKind(r.name);
      if (hiddenPoi.has(k.key)) continue;
      const p = worldToMap(r.x, r.y);
      const respawn = r.respawn > 0 ? ` · réapparaît en ${Math.round(r.respawn / 60)} min` : "";
      const size = k.ground ? 14 : 20;
      L.marker(toLatLng(p.x, p.y), {
        icon: L.divIcon({ className: "map-pin", html: resourceSvg(k.path, k.color, size), iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        opacity: r.live ? 1 : 0.45,
        keyboard: false,
      })
        .bindTooltip(`${k.label}${k.ground ? " (au sol)" : ""} · ${sectorOf(p.x, p.y)}${respawn}${r.live ? "" : " · déjà vue"}${r.respawn > 0 ? "<br>Clic : lancer le minuteur" : ""}`, { className: "marker-tip", direction: "top", offset: [0, -4] })
        .on("click", () => void resourceTimer(r))
        .addTo(gameLayer);
    }
  }

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
  const stopResources = on.resources((r) => { resources = r; drawGame(); });

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
  // Flèche du joueur, tournée selon son orientation (0° = est, la flèche dessinée pointe vers le nord).
  const liveDot = L.marker([0, 0], {
    interactive: false,
    keyboard: false,
    icon: L.divIcon({
      className: "player-arrow",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      html: '<svg viewBox="0 0 28 28" width="28" height="28"><path d="M14 2 L24 25 L14 19 L4 25 Z" fill="#f1d7ff" stroke="#11131F" stroke-width="2" stroke-linejoin="round"/></svg>',
    }),
  });
  let yaw: number | null = null;
  const stopYaw = on.playerState((s) => {
    yaw = s.yaw;
    const el = liveDot.getElement()?.querySelector("svg");
    if (el) el.style.transform = `rotate(${yaw + 90}deg)`;
  });
  const liveHalo = L.circleMarker([0, 0], { radius: 18, color: "#4FA3D9", weight: 2, fill: false, className: "live-halo", interactive: false });
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
  function livePoint(): { x: number; y: number } | null {
    const p = live.position;
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
    const pt = livePoint();
    liveLayer.clearLayers();
    if (pt) {
      const ll = toLatLng(Math.max(0, Math.min(SIZE, pt.x)), Math.max(0, Math.min(SIZE, pt.y)));
      liveHalo.setLatLng(ll).addTo(liveLayer);
      liveDot.setLatLng(ll).addTo(liveLayer);
      const arrow = liveDot.getElement()?.querySelector("svg");
      if (arrow && yaw !== null) arrow.style.transform = `rotate(${yaw + 90}deg)`;
      if (follow && !map.getBounds().pad(-0.25).contains(ll)) map.panTo(ll, { animate: true });
    }
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
  const stopLive = live.subscribe(drawLive);

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
      const dot = L.circleMarker(toLatLng(m.x, m.y), {
        radius: isSel ? 10 : 7,
        color: isSel ? "#F2E6D0" : "#11131F",
        weight: isSel ? 3 : 2,
        fillColor: MARKER_TYPES[m.type].color,
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
    mount(
      chipsBox,
      (Object.keys(MARKER_TYPES) as MarkerType[]).map((t) =>
        h("button", {
          class: "chip", type: "button", "aria-pressed": String(!hidden.has(t)),
          onclick: () => {
            if (hidden.has(t)) hidden.delete(t);
            else hidden.add(t);
            if (selected && hidden.has(selected.type) && !draft) selected = null;
            drawChips();
            drawMarkers();
            drawPanel();
          },
        },
          h("span", { class: "dot", style: `color: ${MARKER_TYPES[t].color}; background: ${hidden.has(t) ? "transparent" : MARKER_TYPES[t].color}` }),
          MARKER_TYPES[t].label),
      ),
    );
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
    h("div", { class: "row wrap" }, h("label", { class: "sr-only", for: "recherche-carte" }, "Rechercher sur la carte"), search, h("span", { class: "label" }, "Mes marqueurs"), chipsBox),
      poiRow,
    liveBar,
    h("div", { class: "columns map-columns" },
      h("div", { class: "map-wrap" },
        mapEl,
        h("div", { class: "row spread muted", style: "font-size: 13px" }, h("span", {}, "Molette : zoom · Clic droit : nouveau marqueur"), countEl),
      ),
      panel,
    ),
  );

  drawRegions();
  drawChips();
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
      void stopMapData.then((un) => un());
      void stopResources.then((un) => un());
      void stopTrail.then((un) => un());
      void stopTrailPoint.then((un) => un());
      void stopYaw.then((un) => un());
      map.remove();
    },
  };
}
