import "./styles/theme.css";
import "./styles/components.css";
import "./styles/widget.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, on, type MapData, type PlayerState, type SeenResource, type Settings, type Timer, type Widget, type WidgetKind } from "./lib/api";
import { hiddenPoiKinds, mapRegion, POI_KINDS, resourceKind, SIZE, worldToMap } from "./lib/carte";
import { markers, sectorOf } from "./lib/data";
import { h, icon, mount } from "./lib/dom";
import { live, solveAffine, startLive, toMap } from "./lib/live";
import { remaining, startLiveUpdates, syncClock } from "./lib/time";

/** Un widget de l'overlay : une petite fenêtre par élément, ouverte par le moteur (`widget.html?kind=…`). */
const kind = new URLSearchParams(location.search).get("kind") as WidgetKind;
const card = h("div", { class: "widget" });
let settings: Settings;
let timers: Timer[] = [];

function config(s: Settings): Widget | undefined {
  return s.layouts.find((l) => l.id === s.activeLayout)?.widgets.find((w) => w.kind === kind);
}

function apply(s: Settings) {
  const w = config(s);
  if (!w) return;
  card.style.opacity = String(w.opacity / 100);
  document.documentElement.style.setProperty("--scale", String(w.scale));
}

function line(label: string, value: HTMLElement) {
  return [h("span", { class: "w-label" }, label), value];
}

// ---------- Minuteurs ----------

function drawTimers() {
  const list = timers
    .filter((t) => t.inOverlay)
    .sort((a, b) => Number(b.fired) - Number(a.fired) || remaining(a) - remaining(b))
    .slice(0, 5);
  mount(
    card,
    h("span", { class: "w-label" }, "Minuteurs"),
    list.length
      ? list.map((t) =>
          h("div", { class: t.fired ? "w-timer ready" : "w-timer" },
            h("span", { class: "w-name" }, t.endsAt === null && !t.fired ? `${t.name} (pause)` : t.name),
            h("span", { class: "digits w-mid", "data-timer": t.id, "data-part": "left" })))
      : h("span", { class: "w-soft" }, "Aucun minuteur"),
  );
}

// ---------- Secteur ----------

/** Secteur en direct si la position est connue et la carte calibrée, sinon dernier marqueur. */
async function drawSector() {
  const p = live.position;
  const t = p ? solveAffine(settings.calibration[settings.liveRegion]) : null;
  if (p && t) {
    const m = toMap(t, p.x, p.y);
    const sector = sectorOf(Math.max(0, Math.min(899, m.x)), Math.max(0, Math.min(899, m.y)));
    const region = settings.liveRegion === "profond" ? "Désert profond" : "Hagga";
    mount(card, ...line("Secteur", h("span", { class: "digits w-mid live" }, `${sector} · ${region}`)));
    return;
  }
  const last = (await markers.all()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  mount(
    card,
    ...(last
      ? line("Dernier marqueur", h("span", { class: "digits w-mid" }, `${sectorOf(last.x, last.y)} · ${last.name}`))
      : line("Secteur", h("span", { class: "w-soft" }, "Inconnu"))),
  );
}

function sectorKey() {
  const p = live.position;
  const t = p ? solveAffine(settings.calibration[settings.liveRegion]) : null;
  if (!p || !t) return "aucun";
  const m = toMap(t, p.x, p.y);
  return sectorOf(m.x, m.y);
}

// ---------- Heure du jeu (jour ou nuit) ----------

/** Lever et coucher du soleil sur Arrakis, en heures du jeu (le jeu passe au soleil entre 05:31 et 06:15). */
const SUNRISE = 6;
const SUNSET = 18;
let clockMode = "";

/** Heure du jeu quand on la lit (modules sans BattlEye), sinon heure du serveur. */
function drawClock(s: PlayerState | null) {
  const t = s?.timeOfDay;
  if (t == null) {
    if (clockMode !== "serveur") {
      clockMode = "serveur";
      mount(card, ...line("Heure serveur", h("span", { class: "digits w-big", "data-clock": "" }, "--:--")));
    }
    return;
  }
  const day = t >= SUNRISE && t < SUNSET;
  const mode = day ? "jour" : "nuit";
  const hh = Math.floor(t);
  const text = `${String(hh).padStart(2, "0")}:${String(Math.floor((t - hh) * 60)).padStart(2, "0")}`;
  if (clockMode !== mode) {
    clockMode = mode;
    mount(card,
      h("span", { class: "w-label" }, day ? "Jour" : "Nuit"),
      h("span", { class: `w-time ${mode}` }, icon(day ? "sun" : "moon", 20), h("span", { class: "digits w-big" })));
  }
  card.querySelector(".w-time .digits")!.textContent = text;
}

// ---------- Barres du personnage (vie, endurance, eau) ----------

const BARS: Partial<Record<WidgetKind, { label: string; value: (s: PlayerState) => [number, number]; full?: boolean }>> = {
  health: { label: "Vie", value: (s) => [s.health, s.healthMax] },
  stamina: { label: "Endurance", value: (s) => [s.stamina, s.staminaMax] },
  hydration: { label: "Eau", value: (s) => [s.hydration, s.hydrationMax] },
  power: { label: "Énergie", value: (s) => [s.power, s.powerMax] },
  // Le sac s'alerte quand il est presque plein, pas presque vide.
  inventory: { label: "Volume", value: (s) => [s.volume ?? 0, s.volumeMax ?? 0], full: true },
};

function drawBar(s: PlayerState | null) {
  const bar = BARS[kind]!;
  const [cur, max] = s ? bar.value(s) : [0, 0];
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  mount(
    card,
    h("div", { class: "w-bar-head" },
      h("span", { class: "w-label" }, bar.label),
      h("span", { class: "digits w-mid" }, max > 0 ? `${Math.round(cur)} / ${Math.round(max)}` : "—")),
    h("div", { class: `w-bar ${kind}` }, h("span", { style: `width: ${pct.toFixed(1)}%` })),
  );
  card.classList.toggle("low", max > 0 && (bar.full ? pct >= 90 : pct <= 25));
}

// ---------- Jauges : un anneau par valeur, qui se remplit ----------

const RING = 2 * Math.PI * 19;

/** Deux groupes séparés : fonctions vitales et équipement (un widget chacun). */
const RING_GROUPS: Partial<Record<WidgetKind, WidgetKind[]>> = {
  gauges: ["health", "stamina", "hydration"],
  gear: ["power", "inventory"],
};
const RING_ICONS: Partial<Record<WidgetKind, string>> = {
  health: "heart", stamina: "run", hydration: "drop", power: "bolt", inventory: "bag",
};

function drawGauges(s: PlayerState | null) {
  const rings = settings.gaugeRings.filter((k) => RING_GROUPS[kind]!.includes(k));
  if (card.dataset.rings !== rings.join()) {
    card.dataset.rings = rings.join();
    mount(card, rings.map((k) =>
      h("div", { class: `w-ring ${k}`, title: BARS[k]!.label, "data-kind": k },
        svgRing(),
        h("span", { class: "w-ring-in" }, icon(RING_ICONS[k]!, 13), h("span", { class: "digits" })))));
    // Fonctions vitales en arc de cercle autour du personnage : colonne dont le milieu s'écarte vers la droite.
    if (kind === "gauges") {
      const half = (rings.length - 1) / 2 || 1;
      card.querySelectorAll<HTMLElement>(".w-ring").forEach((el, i) => {
        el.style.transform = `translateX(${(14 - ((i - half) / half) ** 2 * 28).toFixed(1)}px)`;
      });
    }
  }
  for (const el of card.querySelectorAll<HTMLElement>(".w-ring")) {
    const bar = BARS[el.dataset.kind as WidgetKind]!;
    const [cur, max] = s ? bar.value(s) : [0, 0];
    const pct = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
    el.querySelector<SVGCircleElement>(".fill")!.style.strokeDashoffset = String(RING * (1 - pct));
    el.querySelector(".digits")!.textContent = max > 0 ? String(Math.round(cur)) : "—";
    el.classList.toggle("low", max > 0 && (bar.full ? pct >= 0.9 : pct <= 0.25));
  }
}

function svgRing() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 44 44");
  for (const cls of ["track", "fill"]) {
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("class", cls);
    c.setAttribute("cx", "22");
    c.setAttribute("cy", "22");
    c.setAttribute("r", "19");
    if (cls === "fill") c.style.strokeDasharray = String(RING);
    svg.appendChild(c);
  }
  return svg;
}

// ---------- Mini-carte ----------

/** Demi-largeur visible, en unités de carte (1 unité ≈ 9 m dans le Bassin de Hagga) : environ 1 km de large. */
const VIEW = 60;
/** Rayon du disque, en pixels CSS (fenêtre de 200 × 200 avant l'échelle). */
const R = 100;
const canvas = h("canvas", { class: "w-minimap" }) as HTMLCanvasElement;
let mapData: MapData | null = null;
let mapImg: { img: HTMLImageElement; rect: [number, number, number, number] } | null = null;
let player: PlayerState | null = null;
let resources: SeenResource[] = [];
/** Pictogrammes des ressources, préparés une fois. */
const paths = new Map<string, Path2D>();

async function loadMapImage() {
  mapImg = null;
  if (!mapData) return;
  const region = mapRegion(mapData);
  const url = await api.mapImage(region).catch(() => null);
  if (!url) return;
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  mapImg = { img, rect: settings.mapImages[region] ?? [0, 0, SIZE, SIZE] };
}

/** Nord en haut, joueur au centre ; fond (si importé), zones, lieux et flèche du joueur. */
function drawMinimap() {
  const scale = config(settings)?.scale ?? 1;
  const dpr = window.devicePixelRatio * scale;
  if (canvas.width !== Math.round(2 * R * dpr)) canvas.width = canvas.height = Math.round(2 * R * dpr);
  const g = canvas.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, 2 * R, 2 * R);
  g.save();
  g.beginPath();
  g.arc(R, R, R - 2, 0, Math.PI * 2);
  g.fillStyle = "rgba(17, 19, 31, 0.6)";
  g.fill();
  g.clip();

  const here = player && mapData ? worldToMap(mapData, player.x, player.y) : null;
  if (here && mapData) {
    const k = R / VIEW;
    const px = (x: number) => R + (x - here.x) * k;
    const py = (y: number) => R + (y - here.y) * k;
    if (mapImg) {
      const [x0, y0, x1, y1] = mapImg.rect;
      g.globalAlpha = 0.85;
      g.drawImage(mapImg.img, px(x0), py(y0), (x1 - x0) * k, (y1 - y0) * k);
      g.globalAlpha = 1;
    }
    // Lignes des secteurs, pour se repérer avec la grande carte.
    g.strokeStyle = "rgba(217, 182, 122, 0.25)";
    g.lineWidth = 1;
    for (let i = 0; i <= 9; i++) {
      g.beginPath();
      g.moveTo(px(i * 100), py(0));
      g.lineTo(px(i * 100), py(SIZE));
      g.moveTo(px(0), py(i * 100));
      g.lineTo(px(SIZE), py(i * 100));
      g.stroke();
    }
    const unit = SIZE / (mapData.bounds.maxX - mapData.bounds.minX);
    g.strokeStyle = "rgba(201, 168, 97, 0.4)";
    for (const a of mapData.areas) {
      for (const [x, y, r] of a.circles) {
        const p = worldToMap(mapData, x, y);
        g.beginPath();
        g.arc(px(p.x), py(p.y), r * unit * k, 0, Math.PI * 2);
        g.stroke();
      }
    }
    const masked = new Set(hiddenPoiKinds());
    for (const poi of mapData.pois) {
      if (masked.has(poi.kind)) continue;
      const p = worldToMap(mapData, poi.x, poi.y);
      if (Math.hypot(p.x - here.x, p.y - here.y) > VIEW * 1.1) continue;
      g.beginPath();
      g.arc(px(p.x), py(p.y), 4, 0, Math.PI * 2);
      g.fillStyle = POI_KINDS[poi.kind]?.color ?? "#e9dfc9";
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = "#11131F";
      g.stroke();
    }
    // Ressources : petits points, pâles si elles ne sont plus chargées.
    const region = mapRegion(mapData);
    for (const r of resources) {
      if (r.region !== region) continue;
      const k = resourceKind(r.name);
      if (masked.has(k.key)) continue;
      const p = worldToMap(mapData, r.x, r.y);
      if (Math.hypot(p.x - here.x, p.y - here.y) > VIEW * 1.1) continue;
      // Pastille avec pictogramme, comme sur la grande carte (grille 24 ramenée à la taille voulue).
      const size = k.ground ? 9 : 13;
      g.globalAlpha = r.live ? 1 : 0.45;
      g.save();
      g.translate(px(p.x), py(p.y));
      g.beginPath();
      g.arc(0, 0, size / 2, 0, Math.PI * 2);
      g.fillStyle = "rgba(17, 19, 31, 0.85)";
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = k.color;
      g.stroke();
      const s = (size * 0.7) / 24;
      g.scale(s, s);
      g.translate(-12, -12);
      g.lineWidth = 2.4;
      g.lineCap = g.lineJoin = "round";
      g.stroke(paths.get(k.path) ?? paths.set(k.path, new Path2D(k.path)).get(k.path)!);
      g.restore();
    }
    g.globalAlpha = 1;
    // Flèche du joueur : yaw 0 = vers l'est, comme sur la grande carte.
    g.save();
    g.translate(R, R);
    g.rotate(((player!.yaw + 90) * Math.PI) / 180);
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6.5, 7);
    g.lineTo(0, 3.5);
    g.lineTo(-6.5, 7);
    g.closePath();
    g.fillStyle = "#b46be0";
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = "#f1d7ff";
    g.stroke();
    g.restore();
  }
  g.restore();

  // Anneau, nord et secteur.
  g.beginPath();
  g.arc(R, R, R - 2, 0, Math.PI * 2);
  g.lineWidth = 2;
  g.strokeStyle = "rgba(201, 168, 97, 0.85)";
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "rgba(4, 5, 10, 0.9)";
  g.shadowBlur = 3;
  g.fillStyle = "#f3e7cf";
  g.font = "600 11px Jost, sans-serif";
  g.fillText("N", R, 11);
  g.font = "600 13px Jost, sans-serif";
  g.fillText(here ? sectorOf(Math.max(0, Math.min(899, here.x)), Math.max(0, Math.min(899, here.y))) : "Position inconnue", R, 2 * R - 16);
  g.shadowBlur = 0;
}

// ---------- Mode édition ----------

/** Cadre, déplacement à la souris et taille à la molette ; le moteur enregistre les positions en sortant. */
const badge = h("span", { class: "w-badge" });

function setEditing(on: boolean) {
  document.documentElement.classList.toggle("editing", on);
  badge.textContent = `${Math.round((config(settings)?.scale ?? 1) * 100)} %`;
}

function editControls() {
  card.addEventListener("mousedown", (e) => {
    if (document.documentElement.classList.contains("editing") && e.button === 0) {
      void getCurrentWindow().startDragging();
    }
  });
  window.addEventListener("wheel", (e) => {
    const w = config(settings);
    if (!document.documentElement.classList.contains("editing") || !w) return;
    const scale = Math.round(Math.min(2, Math.max(0.5, w.scale + (e.deltaY < 0 ? 0.1 : -0.1))) * 10) / 10;
    if (scale === w.scale) return;
    w.scale = scale;
    badge.textContent = `${Math.round(scale * 100)} %`;
    void api.setSettings(settings);
  });
}

// ---------- Démarrage ----------

async function start() {
  [settings, timers] = await Promise.all([api.settings(), api.timers()]);
  await syncClock();
  apply(settings);
  mount(document.getElementById("app")!, card, badge);
  editControls();
  setEditing(await api.widgetsEdit());
  await on.widgetsEdit(setEditing);

  switch (kind) {
    case "clock":
      drawClock(await api.playerState());
      await on.playerState(drawClock);
      break;
    case "coriolis":
      mount(card, ...line("Coriolis", h("span", { class: "digits w-mid", "data-coriolis": "" })));
      break;
    case "timers":
      drawTimers();
      await on.timersChanged(async () => {
        timers = await api.timers();
        drawTimers();
      });
      break;
    case "health":
    case "stamina":
    case "hydration":
    case "power":
    case "inventory":
      drawBar(await api.playerState());
      await on.playerState(drawBar);
      break;
    case "gauges":
    case "gear":
      card.classList.add("gauges");
      card.classList.toggle("vitals", kind === "gauges");
      drawGauges(await api.playerState());
      await on.playerState(drawGauges);
      break;
    case "minimap": {
      card.classList.add("minimap");
      mount(card, canvas);
      [player, mapData, resources] = await Promise.all([api.playerState(), api.mapData(), api.resources()]);
      await on.resources((r) => {
        resources = r;
        drawMinimap();
      });
      await loadMapImage();
      drawMinimap();
      await on.playerState((s) => {
        player = s;
        drawMinimap();
      });
      await on.mapData(async (m) => {
        mapData = m;
        await loadMapImage();
        drawMinimap();
      });
      break;
    }
    case "sector": {
      void drawSector();
      await startLive();
      // Le secteur change rarement : on ne redessine qu'à chaque changement.
      let lastKey = sectorKey();
      live.subscribe(() => {
        const key = sectorKey();
        if (key !== lastKey) {
          lastKey = key;
          void drawSector();
        }
      });
      // Un marqueur a pu être ajouté depuis la fenêtre principale.
      window.setInterval(() => {
        if (sectorKey() === "aucun") void drawSector();
      }, 10_000);
      break;
    }
  }
  startLiveUpdates(() => timers);

  await on.settingsChanged(async (s) => {
    settings = s;
    apply(s);
    await syncClock();
    if (kind === "sector") void drawSector();
    if (kind === "gauges" || kind === "gear") drawGauges(await api.playerState());
    if (kind === "minimap") {
      // Fond changé ou réaligné, échelle modifiée.
      await loadMapImage();
      drawMinimap();
    }
  });
}

/** En développement, hors de Tauri, on simule le moteur pour tester dans un navigateur. */
function boot(label: string): Promise<void> {
  const inTauri = "__TAURI_INTERNALS__" in window;
  return import.meta.env.DEV && !inTauri ? import("./lib/mock").then((m) => m.install(label)) : Promise.resolve();
}

void boot("widget").then(start);
