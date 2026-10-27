import type { Ctx, ViewHandle } from "../main";
import { api, on, prettyKeys, SHORTCUT_LABELS, type Playtime, type Timer } from "../lib/api";
import { builds, getNotes, markers, MARKER_TYPES, REGIONS, sectorOf, setNotes } from "../lib/data";
import { h, mount } from "../lib/dom";
import { remaining } from "../lib/time";

export function timerLine(t: Timer) {
  return h(
    "div",
    { class: "stack", style: "--gap: 8px" },
    h("div", { class: "row spread" },
      h("span", {}, t.name),
      h("span", { class: "digits", style: "font-size: 13px", "data-timer": t.id, "data-part": "left" }),
    ),
    h("div", { class: "bar" }, h("span", { "data-timer": t.id, "data-part": "bar" })),
    t.place ? h("span", { class: "muted", style: "font-size: 13px" }, t.place) : null,
  );
}

/** Minuteurs en cours, du plus proche au plus lointain. */
export function activeTimers(list: Timer[]) {
  return list.filter((t) => !t.fired && t.endsAt !== null).sort((a, b) => remaining(a) - remaining(b));
}

export function render(root: HTMLElement, ctx: Ctx): ViewHandle {
  const timersBox = h("div", { class: "stack", style: "--gap: 18px" });
  const drawTimers = () => {
    const list = activeTimers(ctx.timers()).slice(0, 4);
    mount(timersBox, list.length ? list.map(timerLine) : h("p", { class: "muted", style: "margin: 0" }, "Aucun minuteur en cours."));
  };
  drawTimers();

  const markerBox = h("div", { class: "stack" });
  const buildsBox = h("div", { class: "row wrap" });
  void markers.all().then((list) => {
    const last = list.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!last) {
      mount(markerBox, h("p", { class: "muted", style: "margin: 0" }, "Aucun marqueur pour l'instant."));
      return;
    }
    const sector = sectorOf(last.x, last.y);
    const col = Math.floor(last.x / 100);
    const row = Math.floor(last.y / 100);
    const cells = Array.from({ length: 45 }, (_, i) => {
      // Fenêtre de 9 × 5 secteurs centrée verticalement sur le marqueur.
      const r = Math.min(Math.max(row - 2, 0), 4) + Math.floor(i / 9);
      return h("span", { class: r === row && i % 9 === col ? "on" : "" });
    });
    mount(
      markerBox,
      h("div", { class: "mini-map", "aria-hidden": "true" }, cells),
      h("div", { class: "row spread", style: "align-items: baseline" },
        h("span", { class: "digits", style: "font-size: 22px" }, sector),
        h("span", { class: "soft" }, `${last.name} · ${MARKER_TYPES[last.type].label} · ${REGIONS[last.region]}`),
      ),
    );
  });
  void builds.all().then((list) => {
    mount(
      buildsBox,
      list.length
        ? list.slice(0, 3).map((b) =>
            h("button", { class: "pick", type: "button", style: "flex: 1 1 200px; width: auto", onclick: () => ctx.go("builds", b.id) },
              h("span", { class: "title" }, b.name),
              h("span", { class: "muted", style: "font-size: 13px" }, `${b.tag} · modifié le ${new Date(b.updatedAt).toLocaleDateString("fr-FR")}`),
            ),
          )
        : h("p", { class: "muted", style: "margin: 0" }, "Aucun build enregistré."),
    );
  });

  // Temps de jeu : session en cours, aujourd'hui et les 7 derniers jours (heure locale).
  const playBox = h("div", { class: "stack", style: "--gap: 14px" });
  let play: Playtime | null = null;
  const drawPlay = () => {
    if (!play) return;
    const now = Date.now();
    const spans: [number, number][] = [...play.sessions, ...(play.current != null ? [[play.current, now] as [number, number]] : [])];
    const day0 = new Date(now).setHours(0, 0, 0, 0);
    // Minutes jouées le jour `i` (0 = aujourd'hui, 6 = il y a 6 jours).
    const perDay = Array.from({ length: 7 }, (_, i) => {
      const from = new Date(day0).setDate(new Date(day0).getDate() - i), to = new Date(from).setDate(new Date(from).getDate() + 1);
      return spans.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0) / 60_000;
    });
    const fmt = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")}` : `${Math.round(min)} min`);
    const max = Math.max(...perDay, 1);
    const days = ["D", "L", "M", "M", "J", "V", "S"];
    mount(playBox,
      h("div", { class: "row spread", style: "align-items: baseline" },
        h("span", { class: "soft" }, play.current != null ? "Session en cours" : "Jeu fermé"),
        h("span", { class: "digits", style: "font-size: 22px" }, play.current != null ? fmt((now - play.current) / 60_000) : "—")),
      h("div", { class: "row spread" }, h("span", { class: "soft" }, "Aujourd'hui"), h("span", { class: "digits" }, fmt(perDay[0]))),
      h("div", { class: "row spread" }, h("span", { class: "soft" }, "7 derniers jours"), h("span", { class: "digits" }, fmt(perDay.reduce((a, b) => a + b, 0)))),
      h("div", { class: "play-bars", "aria-hidden": "true" },
        perDay.slice().reverse().map((m, i) =>
          h("span", { title: fmt(m) },
            h("i", { style: `height: ${Math.round((m / max) * 100)}%` }),
            days[new Date(day0 - (6 - i) * 86_400_000).getDay()]))),
    );
  };
  void api.playtime().then((p) => { play = p; drawPlay(); });
  const stopPlay = on.playtime((p) => { play = p; drawPlay(); });
  const playTick = window.setInterval(drawPlay, 30_000);

  const notes = h("textarea", { class: "textarea", rows: "5", "aria-label": "Notes rapides", placeholder: "Coordonnées, rendez-vous de guilde, achats à faire…" });
  void getNotes().then((t) => (notes.value = t));
  let notesTimer = 0;
  notes.addEventListener("input", () => {
    clearTimeout(notesTimer);
    notesTimer = window.setTimeout(() => void setNotes(notes.value), 400);
  });

  const s = ctx.settings();
  mount(
    root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Bienvenue dans le sietch"), h("h1", { class: "h1" }, "Accueil")),
    ),

    h("section", { class: "card hot coriolis", "aria-labelledby": "coriolis-titre" },
      h("div", { class: "stack", style: "--gap: 10px; flex: 1 1 360px" },
        h("span", { class: "eyebrow" }, "Événement hebdomadaire"),
        h("h2", { class: "h2", id: "coriolis-titre", style: "font-size: 20px; letter-spacing: 0.12em" }, "TEMPÊTE DE CORIOLIS"),
        h("p", { class: "prose soft", style: "margin: 0" }, "Le Désert profond sera balayé et réinitialisé. Rentrez vos véhicules et videz vos coffres avant l'arrivée du front."),
      ),
      h("div", { class: "row wrap", style: "--gap: 28px" },
        h("div", { class: "countdown", role: "timer", "aria-label": "Temps restant avant la tempête" },
          ...(["d", "h", "m"] as const).map((p) =>
            h("div", { class: "unit" }, h("span", { class: "digits", "data-coriolis-part": p }, "--"), h("span", {}, { d: "JOURS", h: "HEURES", m: "MIN" }[p])),
          ),
        ),
        h("button", { class: "btn", type: "button", onclick: () => ctx.go("parametres", "notifications") }, "Régler les rappels"),
      ),
    ),

    h("div", { class: "grid-auto" },
      h("section", { class: "card", "aria-labelledby": "mt-titre" },
        h("div", { class: "row spread" },
          h("h2", { class: "section-title", id: "mt-titre" }, "Minuteurs actifs"),
          h("button", { class: "btn", type: "button", onclick: () => ctx.go("minuteurs") }, "Tout voir"),
        ),
        timersBox,
      ),
      h("section", { class: "card", "aria-labelledby": "pos-titre" },
        h("div", { class: "row spread" },
          h("h2", { class: "section-title", id: "pos-titre" }, "Dernier marqueur"),
          h("button", { class: "btn", type: "button", onclick: () => ctx.go("carte") }, "Carte"),
        ),
        markerBox,
      ),
      h("section", { class: "card", "aria-labelledby": "jeu-titre" },
        h("h2", { class: "section-title", id: "jeu-titre" }, "Temps de jeu"),
        playBox,
      ),
      h("section", { class: "card", "aria-labelledby": "rac-titre" },
        h("h2", { class: "section-title", id: "rac-titre" }, "Raccourcis globaux"),
        Object.entries(SHORTCUT_LABELS).slice(0, 4).map(([action, label]) =>
          h("div", { class: "shortcut-row" }, label, h("kbd", { class: "kbd" }, prettyKeys(s.shortcuts[action] ?? ""))),
        ),
      ),
    ),

    h("div", { class: "grid-auto", style: "--min: 320px" },
      h("section", { class: "card", "aria-labelledby": "br-titre" },
        h("div", { class: "row spread" },
          h("h2", { class: "section-title", id: "br-titre" }, "Builds récents"),
          h("button", { class: "btn", type: "button", onclick: () => ctx.go("builds") }, "Gérer"),
        ),
        buildsBox,
      ),
      h("section", { class: "card", "aria-labelledby": "notes-titre" },
        h("h2", { class: "section-title", id: "notes-titre" }, "Notes rapides"),
        notes,
        h("div", { class: "row wrap spread" },
          h("span", { class: "badge" }, "Compatible BattlEye · lecture du jeu seulement sans BattlEye"),
          h("button", { class: "btn", type: "button", onclick: () => api.toggleOverlay() }, "Overlay"),
        ),
      ),
    ),
  );

  return {
    onTimers: drawTimers,
    dispose: () => {
      window.clearInterval(playTick);
      void stopPlay.then((un) => un());
    },
  };
}
