import "./styles/theme.css";
import "./styles/components.css";
import "./styles/widget.css";

import { currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { api, on, type GamePlaces, type GameRegions, type Hit, type MapData, type PlayerState, type GameFocus, type SeenResource, type Settings, type Timer, type Trail, type Widget, type WidgetKind } from "./lib/api";
import { gameImage, HAZARD_EDGE, HAZARDS, hazardCircles, hiddenPoiKinds, loadGameIcons, mapRegion, placeIcon, PLAYER_GAME_ICON, PLAYER_PIVOT_Y, POI_GAME_ICONS, POI_KINDS, regionAt, resourceIcon, resourceKind, SIZE, worldToMap } from "./lib/carte";
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
  // Rien de lancé : widget caché (visible en mode édition, pour le placer).
  card.classList.toggle("off", !list.length);
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

/** Nom de la zone lu dans le jeu (modules sans BattlEye), affiché à la place de la région. */
let zone: string | null = null;

/** Secteur en direct si la position est connue et la carte calibrée, sinon dernier marqueur. */
async function drawSector() {
  const p = live.position;
  const t = p ? solveAffine(settings.calibration[settings.liveRegion]) : null;
  if (p && t) {
    const m = toMap(t, p.x, p.y);
    const sector = sectorOf(Math.max(0, Math.min(899, m.x)), Math.max(0, Math.min(899, m.y)));
    const region = zone ?? (settings.liveRegion === "profond" ? "Désert profond" : "Hagga");
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
  return `${sectorOf(m.x, m.y)}|${zone}`;
}

// ---------- Heure du jeu (jour ou nuit) ----------

/** Lever et coucher du soleil sur Arrakis, en heures du jeu (le jeu passe au soleil entre 05:31 et 06:15). */
const SUNRISE = 6;
const SUNSET = 18;
let clockMode = "";

/** Dernière heure lue (en heures), quand, et vitesse mesurée du jeu (heures par ms). */
let readAt = 0;
let readTime: number | null = null;
let rate = 0;
let shownMinute = -1;

/** Heure lue : met à jour la vitesse sur les pas d'une minute, puis l'affichage. */
function readClock(s: PlayerState | null) {
  const t = s?.timeOfDay ?? null;
  const at = performance.now();
  if (t != null && readTime != null && t !== readTime) {
    const step = t - readTime;
    // Un pas d'une minute du jeu donne la vitesse ; les sauts (lecture en retard, minuit, sommeil) non.
    if (Math.abs(step - 1 / 60) < 1e-4) rate = rate ? rate * 0.8 + (step / (at - readAt)) * 0.2 : step / (at - readAt);
  }
  if (t !== readTime) {
    readTime = t;
    readAt = at;
  }
  drawClock(t);
}

/**
 * Heure du jeu quand on la lit (modules sans BattlEye), sinon heure du serveur. Entre deux lectures elle avance seule
 * à la vitesse mesurée, au plus 5 minutes du jeu : la lecture prend parfois du retard et l'heure sautait de 3 minutes.
 */
function drawClock(read: number | null = readTime) {
  let t = read;
  if (t != null && rate) t += Math.min(5 / 60, rate * (performance.now() - readAt));
  if (t != null) {
    // Jamais en arrière, sauf vrai retour (minuit, heure du jeu changée).
    const minute = Math.floor(t * 60 + 1e-6) % 1440;
    if (minute < shownMinute && shownMinute - minute < 10) return;
    shownMinute = minute;
    t = minute / 60;
  } else shownMinute = -1;
  if (t == null) {
    if (clockMode !== "serveur") {
      clockMode = "serveur";
      mount(card, ...line("Heure serveur", h("span", { class: "digits w-big", "data-clock": "" }, "--:--")));
    }
    return;
  }
  const day = t >= SUNRISE && t < SUNSET;
  const mode = day ? "jour" : "nuit";
  const text = `${String(Math.floor(shownMinute / 60)).padStart(2, "0")}:${String(shownMinute % 60).padStart(2, "0")}`;
  if (clockMode !== mode) {
    clockMode = mode;
    mount(card,
      h("span", { class: "w-label" }, day ? "Jour" : "Nuit"),
      h("span", { class: `w-time ${mode}` }, icon(day ? "sun" : "moon", 20), h("span", { class: "digits w-big" })));
  }
  card.querySelector(".w-time .digits")!.textContent = text;
}

// ---------- Barres du personnage (vie, endurance, eau) ----------

const BARS: Partial<Record<WidgetKind, { label: string; value: (s: PlayerState) => [number, number]; full?: boolean; warn?: number }>> = {
  health: { label: "Vie", value: (s) => [s.health, s.healthMax] },
  stamina: { label: "Endurance", value: (s) => [s.stamina, s.staminaMax] },
  hydration: { label: "Eau", value: (s) => [s.hydration, s.hydrationMax] },
  power: { label: "Énergie", value: (s) => [s.power, s.powerMax] },
  // Le sac s'alerte quand il est presque plein, pas presque vide.
  inventory: { label: "Volume", value: (s) => [s.volume ?? 0, s.volumeMax ?? 0], full: true },
  // Menace du ver, en % du seuil d'attaque : violet dès 75 %.
  worm: { label: "Ver", value: (s) => [s.wormThreat ?? 0, s.wormThreat == null ? 0 : 100], full: true, warn: 0.75 },
};

function drawBar(s: PlayerState | null) {
  const bar = BARS[kind]!;
  const [cur, max] = s ? bar.value(s) : [0, 0];
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  mount(
    card,
    h("div", { class: "w-bar-head" },
      h("span", { class: "w-label" }, kind === "inventory" && s?.slots != null && s.slotsMax ? `${bar.label} · ${s.slots}/${s.slotsMax}` : bar.label),
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

/** Dernière fois que la menace du ver était au-dessus de 0 (le joueur est sur le sable). */
let threatSeen = 0;
/** Le widget reste affiché ce temps après le retour à 0 (arrêt sur le sable, avant de gagner la roche). */
const THREAT_LINGER = 15_000;

/** Menace du ver, à droite de l'endurance : grand anneau et pourcentage lisible d'un coup d'œil.
 *  Affichée seulement sur le sable (menace au-dessus de 0), violette et pulsante dès le seuil de l'alerte. */
function drawThreat(s: PlayerState | null) {
  if (!card.firstChild) {
    mount(card,
      h("div", { class: "w-ring worm" }, svgRing(), h("span", { class: "w-ring-in" }, icon("worm", 22))),
      h("div", { class: "w-threat-text" }, h("span", { class: "w-label" }, "Ver"), h("span", { class: "digits w-big" })));
  }
  const v = s?.wormThreat;
  const pct = v == null ? 0 : Math.max(0, Math.min(1, v / 100));
  card.querySelector<SVGCircleElement>(".fill")!.style.strokeDashoffset = String(RING * (1 - pct));
  // Au-delà de 100 %, le ver attaque : le chiffre s'arrête là (sinon il déborde du cadre).
  card.querySelector(".w-big")!.textContent = v == null ? "—" : `${Math.round(Math.min(100, v))} %`;
  const warn = settings.playerAlerts.worm || 75;
  if (v) threatSeen = Date.now();
  const onSand = Date.now() - threatSeen < THREAT_LINGER;
  card.classList.toggle("off", !onSand);
  card.classList.toggle("calm", !v);
  card.classList.toggle("danger", v != null && v >= warn);
  // Sans nouvel état du joueur (immobile), le widget doit quand même s'effacer au bout du délai.
  window.clearTimeout(threatHide);
  if (onSand) threatHide = window.setTimeout(() => drawThreat(s), THREAT_LINGER);
}
let threatHide = 0;

// ---------- Coups portés ----------

/** Croix rouge discrète au centre (le viseur) et chiffre des dégâts qui monte à côté puis s'efface. */
function mountCross() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "-8 -8 16 16");
  svg.classList.add("w-cross");
  svg.innerHTML = '<path d="M-5 -5 L-2 -2 M5 -5 L2 -2 M-5 5 L-2 2 M5 5 L2 2"/>';
  mount(card, svg);
}

function showHit(hit: Hit) {
  const cross = card.querySelector<SVGElement>(".w-cross")!;
  cross.classList.toggle("kill", hit.kill);
  // Relance l'animation à chaque coup, même rapproché.
  cross.classList.remove("on");
  void cross.getBoundingClientRect();
  cross.classList.add("on");
  const n = h("span", { class: `w-dmg digits${hit.kill ? " kill" : ""}` }, String(Math.round(hit.damage)));
  n.style.setProperty("--dx", `${Math.round(Math.random() * 24 - 6)}px`);
  card.append(n);
  n.addEventListener("animationend", () => n.remove());
}

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
        // 22 px d'écart entre le milieu et les bouts : la pente du chevron du jeu.
        el.style.transform = `translateX(${(11 - ((i - half) / half) ** 2 * 22).toFixed(1)}px)`;
      });
    }
  }
  for (const el of card.querySelectorAll<HTMLElement>(".w-ring")) {
    const bar = BARS[el.dataset.kind as WidgetKind]!;
    const [cur, max] = s ? bar.value(s) : [0, 0];
    const pct = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
    el.querySelector<SVGCircleElement>(".fill")!.style.strokeDashoffset = String(RING * (1 - pct));
    el.querySelector(".digits")!.textContent = max > 0 ? String(Math.round(cur)) : "—";
    // Sac : emplacements occupés sous l'anneau du volume.
    if (el.dataset.kind === "inventory") {
      const sub = el.querySelector(".w-ring-sub") ?? el.appendChild(h("span", { class: "w-ring-sub digits" }));
      sub.textContent = s?.slots != null && s.slotsMax ? `${s.slots}/${s.slotsMax}` : "";
    }
    el.classList.toggle("low", max > 0 && (bar.full ? pct >= (bar.warn ?? 0.9) : pct <= 0.25));
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

/** Rayon du disque, en pixels CSS (fenêtre de 200 × 200 avant l'échelle). */
const R = 100;
/** Demi-largeur visible, en unités de carte (1 unité ≈ 9 m dans le Bassin de Hagga), réglée dans l'écran Overlay. */
const VIEW = () => settings.minimapView || 60;
const canvas = h("canvas", { class: "w-minimap" }) as HTMLCanvasElement;
/** Sous la mini-carte : nom de la zone affiché par le jeu et secteur (« Est du Bouclier · F6 »). */
const minimapName = h("div", { class: "w-minimap-name" });

function drawMinimapName() {
  const here = view && mapData ? worldToMap(mapData, view.x, view.y) : null;
  const sector = here ? sectorOf(Math.max(0, Math.min(899, here.x)), Math.max(0, Math.min(899, here.y))) : null;
  // Sans nom de zone lu (HUD masqué, patch), la région d'après la position.
  const text = [player?.zone || (gameRegions && view ? regionAt(gameRegions, view.x, view.y) : null), sector].filter(Boolean).join(" · ");
  if (minimapName.textContent !== text) minimapName.textContent = text;
}
let mapData: MapData | null = null;
let mapImg: { img: HTMLImageElement; rect: [number, number, number, number] } | null = null;
/** Lieux de la région extraits des fichiers du jeu (null : pas d'extraction, on garde ceux lus en mémoire). */
let gamePlaces: GamePlaces | null = null;
let gameRegions: GameRegions | null = null;
let player: PlayerState | null = null;
let resources: SeenResource[] = [];
/** Pictogrammes des lieux et ressources, préparés une fois. */
const paths = new Map<string, Path2D>();

/** Fond et lieux de la région du joueur. */
async function loadRegion() {
  mapImg = null;
  if (!mapData) return;
  const region = mapRegion(mapData);
  [gamePlaces, gameRegions] = await Promise.all([api.gamePlaces(region).catch(() => null), api.gameRegions(region).catch(() => null)]);
  const url = await api.mapImage(region).catch(() => null);
  if (!url) return;
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  mapImg = { img, rect: settings.mapImages[region] ?? [0, 0, SIZE, SIZE] };
}

/** Pastille ronde de diamètre `d` centrée en (x, y), avec un pictogramme (grille 24 × 24) de taille `glyph`. */
function pin(g: CanvasRenderingContext2D, x: number, y: number, d: number, fill: string, ring: string, path: string | undefined, stroke: string, glyph: number, shape?: string, img?: HTMLImageElement) {
  g.save();
  g.translate(x, y);
  g.fillStyle = fill;
  g.lineWidth = 1.2;
  g.strokeStyle = ring;
  if (shape) {
    // Forme de la famille (repère des pictogrammes, rayon 16,5 autour de (12, 12)).
    g.save();
    g.scale(d / 33, d / 33);
    g.translate(-12, -12);
    const s = paths.get(shape) ?? paths.set(shape, new Path2D(shape)).get(shape)!;
    g.fill(s);
    g.lineWidth = (1.2 * 33) / d;
    g.stroke(s);
    g.restore();
  } else {
    g.beginPath();
    g.arc(0, 0, d / 2, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  if (img) {
    // Icône du jeu extraite en local, à la place du pictogramme.
    const s = d * 0.8;
    g.drawImage(img, -s / 2, -s / 2, s, s);
  } else if (path) {
    // Silhouette pleine (voir lib/carte.ts), découpes en evenodd.
    g.scale(glyph / 24, glyph / 24);
    g.translate(-12, -12);
    g.fillStyle = stroke;
    g.fill(paths.get(path) ?? paths.set(path, new Path2D(path)).get(path)!, "evenodd");
  }
  g.restore();
}

/** Position affichée : la dernière lue (~120 par seconde), prolongée selon la vitesse (`live.predicted`). */
/** `yaw` : orientation du corps (la flèche) ; `cam` : celle de la caméra (la carte tourne avec), null = nord en haut. */
type View = { x: number; y: number; yaw: number; cam: number | null };
let view: View | null = null;
let frame = 0;

/** État du personnage : sert de position seulement quand la position rapide ne vient pas. */
function follow(s: PlayerState | null) {
  player = s;
  if (live.position) return;
  view = s ? { x: s.x, y: s.y, yaw: s.yaw, cam: null } : null;
  drawMinimap();
}

/** Angle sans retour à 0 : on tourne par le plus court chemin depuis `from` (179° → −179° = 2°). */
const unwrap = (from: number, to: number) => from + (((((to - from) % 360) + 540) % 360) - 180);

/**
 * Temps de rattrapage du lissage (ms), assez long pour gommer les à-coups. La cible est prolongée d'autant :
 * le lissage n'ajoute alors aucun retard tant que le mouvement est régulier.
 */
const SMOOTH_MS = 40;
let lastFrame = 0;

/**
 * Redessine à chaque image tant que la position arrive ; rien quand le joueur ne bouge pas.
 * L'affichage rattrape la position prolongée en douceur au lieu d'y sauter : les petites erreurs de prolongation
 * et l'irrégularité des lectures ne se voient plus.
 */
function animate(now = performance.now()) {
  const p = live.predicted(Date.now() + SMOOTH_MS);
  let moved = false;
  if (p) {
    const k = lastFrame ? 1 - Math.exp(-(now - lastFrame) / SMOOTH_MS) : 1;
    const a = p.yaw ?? player?.yaw ?? view?.yaw ?? 0;
    // Premier point, saut (téléportation) ou caméra qui apparaît : on se place directement.
    const jump = !view || Math.hypot(p.x - view.x, p.y - view.y) > 20_000 || (p.camera == null) !== (view.cam == null);
    const next: View = jump
      ? { x: p.x, y: p.y, yaw: a, cam: p.camera ?? null }
      : {
        x: view!.x + (p.x - view!.x) * k,
        y: view!.y + (p.y - view!.y) * k,
        yaw: view!.yaw + (unwrap(view!.yaw, a) - view!.yaw) * k,
        cam: p.camera == null ? null : view!.cam! + (unwrap(view!.cam!, p.camera) - view!.cam!) * k,
      };
    // Écart invisible (moins d'un centimètre, d'un centième de degré) : pas de redessin.
    moved = !view || Math.abs(next.x - view.x) > 1 || Math.abs(next.y - view.y) > 1
      || Math.abs(next.yaw - view.yaw) > 0.01 || Math.abs((next.cam ?? 0) - (view.cam ?? 0)) > 0.01;
    if (moved) {
      view = next;
      drawMinimap();
    }
  }
  // Immobile et plus de position nouvelle : on arrête ; la prochaine position relance la boucle (`live.subscribe`).
  const idle = p && !moved && Date.now() - (live.position?.at ?? 0) > 250;
  lastFrame = p && !idle ? now : 0;
  frame = p && !idle ? requestAnimationFrame(animate) : 0;
}

/** Trajet de la session (coordonnées du jeu) ; `null` coupe le tracé. */
let trail: Trail = [];

/** Trajet de la session, jusqu'à la position actuelle. */
function drawTrail(g: CanvasRenderingContext2D, m: MapData, px: (x: number) => number, py: (y: number) => number, here: { x: number; y: number }) {
  g.beginPath();
  let open = false;
  // Points loin de la vue (jusqu'à 4 000 dans le trajet) : sautés, le tracé reprend en revenant dans la vue.
  const far = VIEW() * 1.5;
  for (const p of trail) {
    const q = p && worldToMap(m, p[0], p[1]);
    if (!q || Math.abs(q.x - here.x) > far || Math.abs(q.y - here.y) > far) {
      open = false;
      continue;
    }
    if (open) g.lineTo(px(q.x), py(q.y));
    else g.moveTo(px(q.x), py(q.y));
    open = true;
  }
  if (open) g.lineTo(px(here.x), py(here.y));
  g.setLineDash([3, 4]);
  g.lineWidth = 2;
  g.lineCap = "round";
  g.strokeStyle = "rgba(241, 215, 255, 0.75)";
  g.stroke();
  g.setLineDash([]);
}

/**
 * Joueur au centre, la carte tournée pour que la caméra regarde vers le haut (nord en haut sans caméra) ;
 * fond (si importé), zones, trajet, lieux, ressources (icônes droites) et flèche du joueur (orientation du corps).
 */
/** Catégories masquées : la fenêtre principale les change dans le stockage partagé, l'événement `storage` prévient ici. */
let masked = new Set(hiddenPoiKinds());
window.addEventListener("storage", () => {
  masked = new Set(hiddenPoiKinds());
  drawMinimap();
});
/** Cercles de danger de la carte lue : calcul en O(n²), refait seulement quand la carte change. */
let circlesOf: { map: MapData; circles: ReturnType<typeof hazardCircles> } | null = null;

function drawMinimap() {
  drawMinimapName();
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

  const here = view && mapData ? worldToMap(mapData, view.x, view.y) : null;
  // Rotation de la carte : la direction de la caméra (0° = est) passe en haut.
  const turn = view?.cam == null ? 0 : (-(view.cam + 90) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  if (here && mapData) {
    const zoom = R / VIEW();
    const px = (x: number) => R + (x - here.x) * zoom;
    const py = (y: number) => R + (y - here.y) * zoom;
    /** Point de la carte tourné autour du joueur : pour placer les icônes, qui restent droites. */
    const at = (x: number, y: number): [number, number] => {
      const [dx, dy] = [px(x) - R, py(y) - R];
      return [R + dx * cos - dy * sin, R + dx * sin + dy * cos];
    };
    // Fond, grille, zones et trajet : dessinés dans le repère tourné.
    g.save();
    g.translate(R, R);
    g.rotate(turn);
    g.translate(-R, -R);
    if (mapImg) {
      const [x0, y0, x1, y1] = mapImg.rect;
      g.globalAlpha = 0.85;
      g.drawImage(mapImg.img, px(x0), py(y0), (x1 - x0) * zoom, (y1 - y0) * zoom);
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
    // Zones de danger comme sur la carte du jeu : sa teinte en incrustation (un seul tracé par type, pour que les cercles
    // qui se chevauchent ne foncent pas), puis leur bord ; icône des radiations
    // posée plus bas, droite.
    const unit = SIZE / (mapData.bounds.maxX - mapData.bounds.minX);
    const radiation: [number, number, HTMLImageElement][] = [];
    if (circlesOf?.map !== mapData) circlesOf = { map: mapData, circles: hazardCircles(mapData) };
    // Seulement les cercles qui touchent la vue : le flou des radiations coûte cher à chaque image.
    const circles = circlesOf.circles.filter((c) => {
      const p = worldToMap(mapData!, c.x, c.y);
      return Math.hypot(px(p.x) - R, py(p.y) - R) <= R + c.r * unit * zoom + 8;
    });
    for (const [kind, hz] of Object.entries(HAZARDS)) {
      g.beginPath();
      for (const c of circles) {
        if (c.kind !== Number(kind)) continue;
        const p = worldToMap(mapData, c.x, c.y);
        g.moveTo(px(p.x) + c.r * unit * zoom, py(p.y));
        g.arc(px(p.x), py(p.y), c.r * unit * zoom, 0, Math.PI * 2);
      }
      g.globalCompositeOperation = "overlay";
      g.globalAlpha = hz.alpha;
      g.fillStyle = hz.fill;
      // Radiations en brume : bord fondu, sans contour.
      g.filter = hz.mist ? "blur(6px)" : "none";
      g.fill();
    }
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.filter = "none";
    for (const { kind, x, y, r } of circles) {
      const hz = HAZARDS[kind];
      const img = hz ? gameImage(hz.icon) : undefined;
      const p = worldToMap(mapData, x, y);
      const rr = r * unit * zoom;
      if (hz?.mist) {
        if (img) radiation.push([p.x, p.y, img]);
        continue;
      }
      g.strokeStyle = hz ? HAZARD_EDGE : "rgba(201, 168, 97, 0.4)";
      g.beginPath();
      g.arc(px(p.x), py(p.y), rr, 0, Math.PI * 2);
      g.globalAlpha = 0.6;
      g.stroke();
      g.globalAlpha = 1;
    }
    drawTrail(g, mapData, px, py, here);
    g.restore();
    for (const [x, y, img] of radiation) {
      const [cx, cy] = at(x, y);
      g.drawImage(img, cx - 7, cy - 7, 14, 14);
    }
    // Lieux du jeu : icône officielle, à la taille de son type, détachée du fond par une ombre (comme la grande carte).
    for (const pl of gamePlaces?.places ?? []) {
      if (masked.has(`l:${pl.type}`)) continue;
      const p = worldToMap(gamePlaces!, pl.x, pl.y);
      if (Math.hypot(p.x - here.x, p.y - here.y) > VIEW() * 1.1) continue;
      const img = placeIcon(pl.icon, pl.type)?.canvas;
      if (!img) continue;
      const [x, y] = at(p.x, p.y);
      const s = 20 * pl.scale;
      g.save();
      g.shadowColor = "rgba(4, 5, 10, 0.95)";
      g.shadowBlur = 3;
      g.drawImage(img, x - s / 2, y - s / 2, s, s);
      g.restore();
    }
    for (const poi of gamePlaces ? [] : mapData.pois) {
      if (masked.has(poi.kind)) continue;
      const p = worldToMap(mapData, poi.x, poi.y);
      if (Math.hypot(p.x - here.x, p.y - here.y) > VIEW() * 1.1) continue;
      // Pastille de sa couleur, pictogramme sombre (comme sur la grande carte).
      const look = POI_KINDS[poi.kind];
      const img = gameImage(POI_GAME_ICONS[poi.kind]);
      // Avec l'icône du jeu (blanche) : pastille sombre bordée de la couleur du type.
      const [x, y] = at(p.x, p.y);
      if (img) pin(g, x, y, 16, "#11131F", look?.color ?? "#e9dfc9", undefined, "", 0, undefined, img);
      else pin(g, x, y, 16, look?.color ?? "#e9dfc9", "#11131F", look?.path, "#11131F", 11);
    }
    // Ressources présentes seulement (lues à l'instant, pas les déjà vues ni les récoltées) : icône du jeu cernée d'ombre.
    // Une seule icône par ressource à moins de 10 px d'une autre du même type : les filons groupés restent lisibles.
    const region = mapRegion(mapData);
    const drawn: [string, number, number][] = [];
    for (const r of resources) {
      if (r.region !== region || !r.live) continue;
      const look = resourceKind(r.name);
      if (masked.has(look.key)) continue;
      const p = worldToMap(mapData, r.x, r.y);
      if (Math.hypot(p.x - here.x, p.y - here.y) > VIEW() * 1.1) continue;
      const badge = resourceIcon(look);
      const size = (look.ground ? 9 : 13) + (badge ? 5 : 0);
      const [x, y] = at(p.x, p.y);
      if (drawn.some(([k, dx, dy]) => k === look.key && Math.hypot(dx - x, dy - y) < 10)) continue;
      drawn.push([look.key, x, y]);
      if (badge) {
        g.save();
        g.shadowColor = "rgba(4, 5, 10, 0.95)";
        g.shadowBlur = 3;
        g.drawImage(badge.canvas, x - size / 2, y - size / 2, size, size);
        g.drawImage(badge.canvas, x - size / 2, y - size / 2, size, size);
        g.restore();
      } else pin(g, x, y, size, "rgba(17, 19, 31, 0.85)", look.color, look.path, look.color, size * 0.6, look.shape, gameImage(look.game));
    }
    g.globalAlpha = 1;
    // Flèche du joueur : orientation du corps (0 = est), dans le repère tourné de la carte.
    g.save();
    g.translate(R, R);
    g.rotate(((view!.yaw + 90) * Math.PI) / 180 + turn);
    const arrow = gameImage(PLAYER_GAME_ICON);
    if (arrow) {
      // Flèche du jeu, tournée autour du centre de son anneau.
      g.drawImage(arrow, -13, -26 * PLAYER_PIVOT_Y, 26, 26);
    } else {
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
    }
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
  // « N » sur l'anneau, là où se trouve le nord de la carte tournée.
  g.fillText("N", R + (R - 11) * sin, R - (R - 11) * cos);
  g.font = "600 13px Jost, sans-serif";
  g.fillText(here ? sectorOf(Math.max(0, Math.min(899, here.x)), Math.max(0, Math.min(899, here.y))) : "Position inconnue", R, 2 * R - 16);
  g.shadowBlur = 0;
}

// ---------- Mode édition ----------

/** Cadre, déplacement à la souris et taille à la molette ; le moteur enregistre les positions en sortant. */
const badge = h("span", { class: "w-badge" });

/** Hors du jeu ou dans un de ses menus : le widget s'efface (sauf en mode édition, ou si les réglages sont coupés). */
let focus: GameFocus = { foreground: true, menu: false };
function applyMenu() {
  const root = document.documentElement;
  const hidden = (settings.overlayOnlyInGame && !focus.foreground) || (settings.overlayHideInMenus && focus.menu);
  root.classList.toggle("in-menu", hidden && !root.classList.contains("editing"));
}

function setEditing(on: boolean) {
  document.documentElement.classList.toggle("editing", on);
  applyMenu();
  badge.textContent = `${Math.round((config(settings)?.scale ?? 1) * 100)} %`;
}

function editControls() {
  card.addEventListener("mousedown", (e) => {
    if (document.documentElement.classList.contains("editing") && e.button === 0) {
      void getCurrentWindow().startDragging();
    }
  });
  // Lâché, le widget s'aimante : son centre se cale sur le point de la grille le plus proche.
  let snapTimer = 0;
  void getCurrentWindow().onMoved(() => {
    if (!document.documentElement.classList.contains("editing")) return;
    window.clearTimeout(snapTimer);
    snapTimer = window.setTimeout(() => void snapToGrid(), 250);
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

// ---------- Grille du mode édition ----------

/** Pas de la grille (px logiques), compté depuis le viseur (centre de l'écran) : points d'accroche des widgets. */
const GRID = 20;

async function snapToGrid() {
  const win = getCurrentWindow();
  const m = await currentMonitor();
  if (!m) return;
  const [p, s] = await Promise.all([win.outerPosition(), win.outerSize()]);
  const step = GRID * m.scaleFactor;
  const snap = (pos: number, size: number, origin: number) =>
    Math.round(origin + Math.round((pos + size / 2 - origin) / step) * step - size / 2);
  const x = snap(p.x, s.width, m.position.x + m.size.width / 2);
  const y = snap(p.y, s.height, m.position.y + m.size.height / 2);
  if (x !== p.x || y !== p.y) await win.setPosition(new PhysicalPosition(x, y));
}

/** Tout l'écran, traversé par la souris : points tous les 20 px, lignes tous les 40, axes et croix au viseur. */
function startGrid() {
  document.body.classList.add("grid");
  const canvas = h("canvas", { class: "w-grid" });
  mount(document.getElementById("app")!, canvas);
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const [w, hgt] = [window.innerWidth, window.innerHeight];
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    const g = canvas.getContext("2d")!;
    g.scale(dpr, dpr);
    const [cx, cy] = [w / 2, hgt / 2];
    const nx = Math.ceil(cx / GRID);
    const ny = Math.ceil(cy / GRID);
    g.lineWidth = 1;
    for (let i = -nx; i <= nx; i++) {
      if (i % 2) continue;
      g.strokeStyle = i === 0 ? "rgba(255, 210, 140, 0.45)" : i % 8 === 0 ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.09)";
      g.beginPath();
      g.moveTo(Math.round(cx + i * GRID) + 0.5, 0);
      g.lineTo(Math.round(cx + i * GRID) + 0.5, hgt);
      g.stroke();
    }
    for (let j = -ny; j <= ny; j++) {
      if (j % 2) continue;
      g.strokeStyle = j === 0 ? "rgba(255, 210, 140, 0.45)" : j % 8 === 0 ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.09)";
      g.beginPath();
      g.moveTo(0, Math.round(cy + j * GRID) + 0.5);
      g.lineTo(w, Math.round(cy + j * GRID) + 0.5);
      g.stroke();
    }
    // Points d'accroche entre les lignes.
    g.fillStyle = "rgba(255, 255, 255, 0.18)";
    for (let i = -nx; i <= nx; i++) for (let j = -ny; j <= ny; j++) if (i % 2 || j % 2) g.fillRect(Math.round(cx + i * GRID) - 1, Math.round(cy + j * GRID) - 1, 2, 2);
    // Croix du viseur.
    g.strokeStyle = "#ffb347";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx - 18, cy);
    g.lineTo(cx + 18, cy);
    g.moveTo(cx, cy - 18);
    g.lineTo(cx, cy + 18);
    g.stroke();
  };
  draw();
  window.addEventListener("resize", draw);
}

// ---------- Démarrage ----------

// ---------- Bandeau des alertes ----------

/** En haut au centre : chaque alerte s'y affiche quelques secondes, puis s'efface. */
async function startBanner() {
  document.body.classList.add("banner");
  const app = document.getElementById("app")!;
  let hide = 0;
  await on.alarm((a) => {
    const el = h("div", { class: `w-banner${a.title.startsWith("Le ver") ? " worm" : ""}` },
      h("strong", {}, a.title),
      h("span", {}, a.body),
    );
    mount(app, el);
    window.clearTimeout(hide);
    hide = window.setTimeout(() => {
      el.classList.add("out");
      window.setTimeout(() => el.remove(), 600);
    }, 8000);
  });
}

async function start() {
  if ((kind as string) === "banner") return startBanner();
  if ((kind as string) === "grid") return startGrid();
  [settings, timers] = await Promise.all([api.settings(), api.timers()]);
  await syncClock();
  apply(settings);
  mount(document.getElementById("app")!, card, badge);
  editControls();
  setEditing(await api.widgetsEdit());
  await on.widgetsEdit(setEditing);
  focus = await api.gameFocus();
  applyMenu();
  await on.gameFocus((f) => {
    focus = f;
    applyMenu();
  });

  switch (kind) {
    case "clock":
      readClock(await api.playerState());
      await on.playerState(readClock);
      window.setInterval(() => drawClock(), 250);
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
    case "hits":
      card.classList.add("hits");
      // Croix posée dès le départ : visible en mode édition pour placer le widget.
      mountCross();
      await on.hit(showHit);
      break;
    case "threat":
      card.classList.add("threat");
      drawThreat(await api.playerState());
      await on.playerState(drawThreat);
      break;
    case "minimap": {
      card.classList.add("minimap");
      mount(card, canvas, minimapName);
      [player, mapData, resources, trail] = await Promise.all([api.playerState(), api.mapData(), api.resources(), api.trail()]);
      view = player ? { x: player.x, y: player.y, yaw: player.yaw, cam: null } : null;
      // Pas de redessin ici : la position suivante le fera.
      await on.trail((t) => (trail = t));
      await on.trailPoint((t) => trail.push(...t));
      await on.resources((r) => {
        resources = r;
        drawMinimap();
      });
      await Promise.all([loadRegion(), loadGameIcons()]);
      drawMinimap();
      await on.playerState(follow);
      await startLive();
      live.subscribe(() => {
        if (!frame && live.position) frame = requestAnimationFrame(animate);
      });
      await on.mapData(async (m) => {
        mapData = m;
        await loadRegion();
        drawMinimap();
      });
      break;
    }
    case "sector": {
      void drawSector();
      await startLive();
      // Le secteur change rarement : on ne redessine qu'à chaque changement.
      let lastKey = sectorKey();
      zone = (await api.playerState())?.zone ?? null;
      await on.playerState((s) => {
        if (s.zone === zone) return;
        zone = s.zone;
        lastKey = sectorKey();
        void drawSector();
      });
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
    applyMenu();
    await syncClock();
    if (kind === "sector") void drawSector();
    if (kind === "gauges" || kind === "gear") drawGauges(await api.playerState());
    if (kind === "minimap") {
      // Fond changé ou réaligné, échelle modifiée.
      await loadRegion();
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
