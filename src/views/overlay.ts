import type { Ctx, ViewHandle } from "../main";
import { api, type Layout, type Settings, type WidgetKind } from "../lib/api";
import { confirmDialog, h, icon, keys, mount, toast } from "../lib/dom";

const WIDGET_LABELS: Record<WidgetKind, string> = {
  clock: "Heure du jeu",
  coriolis: "Coriolis",
  sector: "Secteur",
  timers: "Minuteurs",
  health: "Vie",
  stamina: "Endurance",
  hydration: "Eau",
  power: "Énergie",
  inventory: "Volume du sac",
  minimap: "Mini-carte",
  gauges: "Fonctions vitales",
  gear: "Équipement",
  threat: "Menace du ver",
  hits: "Coups portés",
  worm: "Ver",
};
/** Valeurs du personnage : en barres (un widget chacune) ou en anneaux (widgets Fonctions vitales et Équipement). */
const STATS: WidgetKind[] = ["health", "stamina", "hydration", "power", "inventory"];
const RING_WIDGETS: WidgetKind[] = ["gauges", "gear"];
/** Repères autour du joueur, puis le personnage. */
const LANDMARKS: WidgetKind[] = ["minimap", "clock", "coriolis", "sector", "timers"];
/** Largeur visible de la mini-carte : demi-largeur en unités de carte (1 unité ≈ 9 m), libellé. */
const MINIMAP_ZOOMS: [number, string][] = [[30, "500 m"], [60, "1 km"], [120, "2 km"], [240, "4 km"]];

/** Dispositions préfaites : éléments affichés. Gardées en accord avec `PRESETS` de `settings.rs`. */
const PRESETS: Record<string, { hint: string; shown: WidgetKind[] }> = {
  exploration: { hint: "Tout : repères, minuteurs, personnage.", shown: ["clock", "coriolis", "timers", "minimap", "gauges", "gear", "threat", "hits"] },
  combat: { hint: "Le personnage près du viseur, et la mini-carte.", shown: ["minimap", "gauges", "gear", "threat", "hits"] },
  vehicule: { hint: "Se repérer et surveiller le ver.", shown: ["clock", "coriolis", "minimap", "threat", "hits"] },
};

/** Pictogramme et rôle de chaque widget, pour la liste de l'écran. */
const WIDGET_INFO: Partial<Record<WidgetKind, { icon: string; hint: string }>> = {
  minimap: { icon: "map", hint: "Carte autour de vous, tournée comme la caméra." },
  clock: { icon: "sun", hint: "Heure du jeu, jour et nuit." },
  coriolis: { icon: "bell", hint: "Compte à rebours de la tempête." },
  sector: { icon: "pin", hint: "Zone et secteur où vous êtes." },
  timers: { icon: "timer", hint: "Ceux choisis dans l'écran Minuteurs." },
  gauges: { icon: "heart", hint: "Vie, endurance et eau en anneaux, près du viseur." },
  gear: { icon: "bolt", hint: "Énergie et volume du sac, au-dessus de la compétence." },
  health: { icon: "heart", hint: "Barre de vie." },
  stamina: { icon: "run", hint: "Barre d'endurance." },
  hydration: { icon: "drop", hint: "Barre d'eau." },
  power: { icon: "bolt", hint: "Barre d'énergie." },
  inventory: { icon: "bag", hint: "Volume et emplacements du sac." },
  threat: { icon: "worm", hint: "Seulement sur le sable, violette au seuil d'alerte." },
  hits: { icon: "shield", hint: "Dégâts infligés, au centre de l'écran." },
};

/** Widgets de l'overlay : dispositions, éléments affichés, comportement. */
export function render(root: HTMLElement, ctx: Ctx): ViewHandle {
  const body = h("div", { class: "columns" });
  /** Réglages envoyés depuis cet écran dont on attend encore l'écho. */
  let pendingEchoes = 0;

  async function update(patch: Partial<Settings>) {
    pendingEchoes++;
    const errors = await ctx.saveSettings({ ...ctx.settings(), ...patch });
    if (errors.length) toast("Réglage refusé", errors.join(" — "));
  }

  /** Interrupteur d'un réglage booléen, avec son libellé et son explication. */
  function toggle(key: "overlayClickThrough" | "overlayOnlyInGame" | "overlayHideInMenus" | "autoLayout", label: string, hint: string) {
    const sw = h("button", {
      class: "switch", type: "button", role: "switch", "aria-checked": String(ctx.settings()[key]), "aria-label": label,
      onclick: () => {
        const v = sw.getAttribute("aria-checked") !== "true";
        sw.setAttribute("aria-checked", String(v));
        void update({ [key]: v });
      },
    });
    return h("div", { class: "setting-row" },
      h("div", { class: "stack", style: "--gap: 4px" }, h("span", {}, label), h("span", { class: "muted", style: "font-size: 13px" }, hint)),
      sw);
  }

  /** Interrupteur seul (pour une ligne de la liste des widgets). */
  function switchBtn(on: boolean, label: string, onChange: (v: boolean) => void) {
    const sw = h("button", {
      class: "switch", type: "button", role: "switch", "aria-checked": String(on), "aria-label": label,
      onclick: () => {
        const v = sw.getAttribute("aria-checked") !== "true";
        sw.setAttribute("aria-checked", String(v));
        onChange(v);
      },
    });
    return sw;
  }

  /** Combinaison de touches, une touche par pastille. */

  function draw() {
    const s = ctx.settings();
    const layout = s.layouts.find((l) => l.id === s.activeLayout) ?? s.layouts[0];
    /** Modifie une copie des dispositions, l'enregistre et redessine. */
    const edit = (fn: (layouts: Layout[]) => string | void) => {
      const layouts = structuredClone(ctx.settings().layouts);
      const active = fn(layouts) ?? ctx.settings().activeLayout;
      void update({ layouts, activeLayout: active }).then(draw);
    };
    const current = (layouts: Layout[]) => layouts.find((l) => l.id === layout.id)!;
    const preset = PRESETS[layout.id];

    // ---------- Dispositions ----------
    const tabs = h("div", { class: "segmented", role: "group", "aria-label": "Disposition affichée", style: "flex-wrap: wrap" },
      s.layouts.map((l) => h("button", { type: "button", "aria-pressed": String(l.id === layout.id), onclick: () => void update({ activeLayout: l.id }).then(draw) }, l.name)));
    const name = h("input", { class: "input", id: "o-disp-nom", type: "text", maxlength: "30", value: layout.name, style: "flex: 1 1 180px; width: auto" });
    name.addEventListener("change", () => {
      const v = name.value.trim();
      if (v) edit((ls) => void (current(ls).name = v));
    });
    const reset = () => edit((ls) => {
      // Positions, tailles et éléments d'origine (anneaux plutôt que barres).
      const shown = (PRESETS[layout.id] ?? PRESETS.exploration).shown;
      for (const w of current(ls).widgets) {
        w.pos = null;
        w.scale = 1;
        w.opacity = 100;
        w.shown = shown.includes(w.kind);
      }
    });
    const layoutCard = h("section", { class: "card", "aria-labelledby": "o-disp-titre" },
      h("div", { class: "row spread wrap" },
        h("h2", { class: "section-title", id: "o-disp-titre", style: "flex: 1" }, "Dispositions"),
        h("span", { class: "muted row", style: "--gap: 8px; font-size: 13px" }, "Suivante en jeu", keys(s.shortcuts["overlay-next"]))),
      tabs,
      preset ? h("p", { class: "muted", style: "margin: 0; font-size: 13px" }, preset.hint) : null,
      h("div", { class: "row wrap", style: "--gap: 8px" },
        h("label", { class: "sr-only", for: "o-disp-nom" }, "Nom de la disposition"), name,
        h("button", { class: "btn", type: "button", title: "Nouvelle disposition, copie de celle-ci", onclick: () => edit((ls) => {
          const id = `disposition-${Date.now().toString(36)}`;
          ls.push({ ...structuredClone(current(ls)), id, name: `${layout.name} (copie)` });
          return id;
        }) }, icon("copy", 16), "Dupliquer"),
        h("button", { class: "btn", type: "button", title: "Positions, tailles et éléments d'origine", onclick: reset }, icon("restart", 16), "Par défaut"),
        s.layouts.length > 1
          ? h("button", { class: "icon-btn", type: "button", "aria-label": `Supprimer la disposition ${layout.name}`, title: "Supprimer", onclick: async () => {
              if (!(await confirmDialog(`Supprimer la disposition « ${layout.name} » ?`, "Supprimer"))) return;
              edit((ls) => {
                ls.splice(ls.findIndex((l) => l.id === layout.id), 1);
                return ls[0].id;
              });
            } }, icon("trash", 16))
          : null),
    );

    // ---------- Widgets de la disposition ----------
    /** Une ligne par widget : pictogramme, nom, rôle, taille si changée, interrupteur. */
    const row = (kind: WidgetKind) => {
      const w = layout.widgets.find((x) => x.kind === kind);
      if (!w) return null;
      const info = WIDGET_INFO[kind];
      return h("div", { class: "widget-row" },
        h("span", { class: "widget-row-icon", "aria-hidden": "true" }, icon(info?.icon ?? "layers", 18)),
        h("div", { class: "stack", style: "--gap: 2px; min-width: 0" },
          h("span", { class: "widget-row-name" }, WIDGET_LABELS[kind],
            w.scale !== 1 ? h("span", { class: "tag", style: "color: var(--text-muted)" }, `${Math.round(w.scale * 100)} %`) : null),
          info ? h("span", { class: "muted", style: "font-size: 13px" }, info.hint) : null),
        switchBtn(w.shown, WIDGET_LABELS[kind], (v) => edit((ls) => void (current(ls).widgets.find((x) => x.kind === kind)!.shown = v))));
    };
    // Anneaux ou barres : on coche l'un, on décoche l'autre.
    const rings = !layout.widgets.some((w) => STATS.includes(w.kind) && w.shown);
    const style = (asRings: boolean) => edit((ls) => {
      for (const w of current(ls).widgets) {
        if (RING_WIDGETS.includes(w.kind)) w.shown = asRings;
        else if (STATS.includes(w.kind)) w.shown = !asRings;
      }
    });
    const section = (title: string, extra: HTMLElement | null, rows: (HTMLElement | null)[]) =>
      h("div", { class: "stack", style: "--gap: 0" },
        h("div", { class: "row spread wrap", style: "padding-bottom: 6px" }, h("span", { class: "label" }, title), extra),
        ...rows);
    const widgetsCard = h("section", { class: "card", "aria-labelledby": "o-elem-titre" },
      h("div", { class: "stack", style: "--gap: 4px" },
        h("h2", { class: "section-title", id: "o-elem-titre" }, `Widgets · ${layout.name}`),
        h("p", { class: "muted", style: "margin: 0; font-size: 13px" }, "Ce qui s'affiche dans cette disposition. Place et taille : bouton « Placer les widgets ».")),
      section("Repères", null, LANDMARKS.map(row)),
      section("Personnage",
        h("div", { class: "segmented", role: "group", "aria-label": "Style des jauges" },
          h("button", { type: "button", "aria-pressed": String(rings), onclick: () => style(true) }, "Anneaux"),
          h("button", { type: "button", "aria-pressed": String(!rings), onclick: () => style(false) }, "Barres")),
        [...(rings ? RING_WIDGETS : STATS).map(row), row("threat"), row("hits")]),
    );

    // ---------- Colonne de droite : réglages communs à toutes les dispositions ----------
    const minimapCard = h("section", { class: "card", "aria-labelledby": "o-mini-titre" },
      h("h2", { class: "section-title", id: "o-mini-titre" }, "Mini-carte"),
      h("div", { class: "stack", style: "--gap: 8px" },
        h("span", { class: "label" }, "Largeur visible"),
        h("div", { class: "segmented", role: "group", "aria-label": "Zoom de la mini-carte" },
          MINIMAP_ZOOMS.map(([view, label]) => h("button", { type: "button", "aria-pressed": String(s.minimapView === view), onclick: () => void update({ minimapView: view }).then(draw) }, label)))),
      h("p", { class: "muted", style: "margin: 0; font-size: 13px" }, "Seules les ressources présentes s'affichent ; les filtres de l'écran Carte valent aussi pour elle."),
    );
    const ringValues = STATS.map((k) => {
      const box = h("input", { type: "checkbox", checked: s.gaugeRings.includes(k) });
      box.addEventListener("change", () => {
        const on = new Set(ctx.settings().gaugeRings);
        if (box.checked) on.add(k);
        else on.delete(k);
        void update({ gaugeRings: STATS.filter((x) => on.has(x)) });
      });
      return h("label", { class: "check" }, box, WIDGET_LABELS[k]);
    });
    const ringsCard = rings
      ? h("section", { class: "card", "aria-labelledby": "o-anneaux-titre" },
          h("h2", { class: "section-title", id: "o-anneaux-titre" }, "Anneaux"),
          h("p", { class: "muted", style: "margin: 0; font-size: 13px" }, "Valeurs montrées dans les anneaux, pour toutes les dispositions."),
          h("div", { class: "row wrap", style: "--gap: 14px" }, ringValues))
      : null;
    const behaviourCard = h("section", { class: "card", "aria-labelledby": "o-comp-titre" },
      h("h2", { class: "section-title", id: "o-comp-titre" }, "Comportement"),
      toggle("autoLayout", "Disposition automatique", "Combat arme en main, Véhicule à bord, Exploration sinon. Sans BattlEye seulement."),
      toggle("overlayOnlyInGame", "Seulement avec le jeu au premier plan", "Effacés avec Alt+Tab ou jeu fermé."),
      toggle("overlayHideInMenus", "Masqués dans les menus du jeu", "Inventaire, carte, Échap… Le bandeau des alertes reste visible."),
      toggle("overlayClickThrough", "Clic traversant", "Les clics passent à travers les widgets, vers le jeu."),
    );
    const shortcut = (label: string, combo: string | undefined) => h("div", { class: "setting-row" }, h("span", {}, label), keys(combo));
    const keysCard = h("section", { class: "card", "aria-labelledby": "o-touches-titre" },
      h("h2", { class: "section-title", id: "o-touches-titre" }, "Raccourcis"),
      shortcut("Afficher / masquer", s.shortcuts.overlay),
      shortcut("Placer les widgets", s.shortcuts["overlay-edit"]),
      shortcut("Disposition suivante", s.shortcuts["overlay-next"]),
      h("p", { class: "muted", style: "margin: 0; font-size: 13px" }, "En mode placement : glisser pour déplacer, molette pour la taille. Combinaisons modifiables dans Paramètres › Raccourcis."),
    );

    mount(body,
      h("div", { class: "stack", style: "--gap: 20px; flex: 3 1 520px; min-width: 0" }, layoutCard, widgetsCard),
      h("div", { class: "stack", style: "--gap: 20px; flex: 2 1 320px; min-width: 0" }, minimapCard, ringsCard, behaviourCard, keysCard),
    );
  }

  mount(
    root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Widgets par-dessus le jeu"), h("h1", { class: "h1" }, "Overlay")),
      h("div", { class: "row wrap", style: "--gap: 8px" },
        h("button", { class: "btn", type: "button", onclick: () => api.toggleOverlay() }, icon("layers", 16), "Afficher / masquer"),
        h("button", { class: "btn btn-primary", type: "button", onclick: () => api.toggleWidgetsEdit() }, icon("edit", 16), "Placer les widgets")),
    ),
    body,
  );
  draw();

  return {
    // Positions enregistrées en sortant du mode édition, disposition changée au raccourci…
    onSettings: () => {
      if (pendingEchoes > 0) {
        pendingEchoes--;
        return;
      }
      draw();
    },
  };
}
