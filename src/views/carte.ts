import L from "leaflet";
import { open, save } from "@tauri-apps/plugin-dialog";
import { BaseDirectory, exists, mkdir, readFile, readTextFile, remove, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Ctx, ViewHandle } from "../main";
import { api } from "../lib/api";
import {
  markers as store, MARKER_TYPES, parseSector, REGIONS, sectorOf, uid,
  type Marker, type MarkerType, type Region,
} from "../lib/data";
import { confirmDialog, h, icon, mount, toast } from "../lib/dom";
import { live, solveAffine, toMap } from "../lib/live";

const SIZE = 900;
/** Leaflet compte la latitude vers le haut : y (vers le bas) devient -y. */
const toLatLng = (x: number, y: number) => L.latLng(-y, x);
const clamp = (v: number) => Math.min(SIZE, Math.max(0, Math.round(v)));

let lastRegion: Region = "hagga";
const hidden = new Set<MarkerType>();

/** Fond de carte importé par le joueur (capture de la carte du jeu), dans le dossier de données. */
const bgFile = (r: Region) => `fond-${r}.img`;
const APPDATA = { baseDir: BaseDirectory.AppData };

async function loadBackground(r: Region): Promise<string | null> {
  try {
    if (!(await exists(bgFile(r), APPDATA))) return null;
    return URL.createObjectURL(new Blob([await readFile(bgFile(r), APPDATA)]));
  } catch {
    return null; // mode navigateur, ou fichier illisible : la grille seule suffit
  }
}

/** Traînée derrière le joueur : quelques dizaines de secondes de déplacement. */
const TRAIL_MAX = 240;

export function render(root: HTMLElement, ctx: Ctx, action?: string | null): ViewHandle {
  let all: Marker[] = [];
  // Avec la position en direct, la carte s'ouvre sur la région où se trouve le joueur.
  let region: Region = live.status.active && ctx.settings().liveRegion in REGIONS ? (ctx.settings().liveRegion as Region) : lastRegion;
  /** Vrai dès que le joueur choisit lui-même une région : on ne la change plus à sa place. */
  let pickedRegion = false;
  let bgUrl: string | null = null;
  let selected: Marker | null = null;
  /** Marqueur pas encore enregistré (clic droit ou raccourci). */
  let draft = false;

  const mapEl = h("div", { class: "map", role: "application", "aria-label": "Carte, clic droit pour ajouter un marqueur" });
  const panel = h("aside", { class: "card side-panel", "aria-live": "polite" });
  const chipsBox = h("div", { class: "row wrap" });
  const regionBox = h("div", { class: "segmented", role: "group", "aria-label": "Région" });
  const countEl = h("span");
  const search = h("input", {
    class: "input search", type: "search", id: "recherche-carte",
    placeholder: "Chercher un marqueur ou un secteur (ex. E5)… puis Entrée",
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

  // Le fond de carte passe sous la grille et les marqueurs.
  map.createPane("fond").style.zIndex = "250";
  let bgLayer: L.ImageOverlay | null = null;
  // Dunes décoratives dans leur propre calque, masqué quand un vrai fond est affiché.
  const decorPane = map.createPane("decor");

  async function drawBackground() {
    const r = region;
    const url = await loadBackground(r);
    if (r !== region) {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    bgLayer?.remove();
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = url;
    bgLayer = url ? L.imageOverlay(url, bounds, { pane: "fond", interactive: false }).addTo(map) : null;
    decorPane.hidden = !!url;
    drawBgButtons();
  }

  async function importBackground() {
    const path = await open({ multiple: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    if (typeof path !== "string") return;
    try {
      await mkdir("", { ...APPDATA, recursive: true }).catch(() => {});
      await writeFile(bgFile(region), await readFile(path), APPDATA);
      await drawBackground();
      toast("Fond de carte importé", `${REGIONS[region]} : recadrez la capture sur la carte du jeu, bords compris.`);
    } catch (e) {
      toast("Import impossible", String(e instanceof Error ? e.message : e));
    }
  }

  async function removeBackground() {
    if (!(await confirmDialog(`Retirer le fond de carte de ${REGIONS[region]} ?`, "Retirer"))) return;
    await remove(bgFile(region), APPDATA).catch(() => {});
    await drawBackground();
  }

  const bgBox = h("div", { class: "row" });
  function drawBgButtons() {
    mount(
      bgBox,
      h("button", { class: "btn", type: "button", onclick: importBackground }, bgUrl ? "Changer le fond" : "Fond de carte"),
      bgUrl ? h("button", { class: "btn", type: "button", onclick: removeBackground }, "Retirer le fond") : null,
    );
  }

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
    L.polyline(pts, { color: "#5A4228", weight: 1.2, interactive: false, smoothFactor: 2, pane: "decor" }).addTo(map);
  }
  const layer = L.layerGroup().addTo(map);

  map.on("contextmenu", (e: L.LeafletMouseEvent) => startDraft(clamp(e.latlng.lng), clamp(-e.latlng.lat)));

  // ---------- Position en direct (modules sans BattlEye) ----------
  const liveLayer = L.layerGroup().addTo(map);
  const liveDot = L.circleMarker([0, 0], { radius: 9, color: "#0D0A07", weight: 3, fillColor: "#4FA3D9", fillOpacity: 1, interactive: false });
  const liveHalo = L.circleMarker([0, 0], { radius: 18, color: "#4FA3D9", weight: 2, fill: false, className: "live-halo", interactive: false });
  const liveTrail = L.polyline([], { color: "#4FA3D9", weight: 3, opacity: 0.55, interactive: false });
  const liveBar = h("div", { class: "live-bar", role: "status", "aria-live": "polite" });
  let follow = true;
  let calibrating = false;
  let liveBarKey = "";
  let trail: L.LatLng[] = [];
  /** Première position reçue depuis l'ouverture : on zoome dessus. */
  let firstFix = true;

  // Déplacer la carte à la main arrête le suivi ; le bouton « Suivre » le relance.
  map.on("dragstart", () => {
    if (!follow) return;
    follow = false;
    drawLive();
  });

  /** Position du joueur sur la carte affichée, si la région et la calibration le permettent. */
  function livePoint(): { x: number; y: number } | null {
    const p = live.position;
    const s = ctx.settings();
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
    if (st.active && !pickedRegion && s.liveRegion !== region && s.liveRegion in REGIONS) {
      setRegion(s.liveRegion as Region);
      return; // setRegion redessine tout, position comprise
    }
    const pt = livePoint();
    liveLayer.clearLayers();
    if (pt) {
      const ll = toLatLng(Math.max(0, Math.min(SIZE, pt.x)), Math.max(0, Math.min(SIZE, pt.y)));
      const prev = trail[trail.length - 1];
      if (!prev || map.distance(prev, ll) > 1.5) trail = [...trail, ll].slice(-TRAIL_MAX);
      liveTrail.setLatLngs(trail).addTo(liveLayer);
      liveHalo.setLatLng(ll).addTo(liveLayer);
      liveDot.setLatLng(ll).addTo(liveLayer);
      if (firstFix) {
        firstFix = false;
        map.setView(ll, Math.max(map.getZoom(), 1), { animate: false });
      } else if (follow) {
        // Recentre en continu, sans animation : la position arrive 4 fois par seconde.
        map.panTo(ll, { animate: false });
      }
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
    } else if (s.liveRegion !== region) {
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
        btn("Suivre", () => { follow = !follow; drawLive(); }, follow),
        btn("Marqueur ici", () => startDraft(clamp(pt.x), clamp(pt.y))),
        btn("Recalibrer", () => void saveCalibration([])),
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
        color: isSel ? "#F2E6D0" : "#0D0A07",
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
            pickedRegion = true;
            setRegion(r);
          },
        }, REGIONS[r]),
      ),
    );
  }

  function setRegion(r: Region) {
    region = lastRegion = r;
    draft = false;
    selected = null;
    calibrating = false;
    trail = [];
    firstFix = true;
    drawRegions();
    drawMarkers();
    drawPanel();
    void drawBackground();
    drawLive();
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
    if (!found) return toast("Aucun résultat", `Rien ne correspond à « ${q} ».`);
    if (found.region !== region) {
      pickedRegion = true;
      setRegion(found.region);
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
        bgBox,
        h("button", { class: "btn", type: "button", onclick: importMarkers }, "Importer"),
        h("button", { class: "btn", type: "button", onclick: exportMarkers }, "Exporter"),
      ),
    ),
    h("div", { class: "row wrap" }, h("label", { class: "sr-only", for: "recherche-carte" }, "Rechercher sur la carte"), search, chipsBox),
    liveBar,
    h("div", { class: "columns" },
      h("div", { class: "map-wrap" },
        mapEl,
        h("div", { class: "row spread muted", style: "font-size: 13px" }, h("span", {}, "Molette : zoom · Clic droit : nouveau marqueur"), countEl),
      ),
      panel,
    ),
  );

  drawRegions();
  drawChips();
  drawBgButtons();
  void drawBackground();
  requestAnimationFrame(() => {
    map.invalidateSize();
    // Si la position est déjà arrivée, la carte est déjà centrée sur le joueur.
    if (firstFix) map.fitBounds(bounds, { padding: [8, 8] });
  });
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
  return {
    onSettings: drawLive,
    dispose: () => {
      stopLive();
      map.remove();
      if (bgUrl) URL.revokeObjectURL(bgUrl);
    },
  };
}
