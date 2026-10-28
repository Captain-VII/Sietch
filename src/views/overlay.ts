import type { Ctx, ViewHandle } from "../main";
import { api, prettyKeys, type Layout, type Settings, type WidgetKind } from "../lib/api";
import { confirmDialog, h, icon, mount, toast } from "../lib/dom";

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

/** Dispositions préfaites : éléments affichés. Gardées en accord avec `PRESETS` de `settings.rs`. */
const PRESETS: Record<string, { hint: string; shown: WidgetKind[] }> = {
  exploration: { hint: "Tout : repères, minuteurs, personnage.", shown: ["clock", "coriolis", "sector", "timers", "minimap", "gauges", "gear", "threat", "hits"] },
  combat: { hint: "Seulement le personnage, près du viseur.", shown: ["gauges", "gear", "threat", "hits"] },
  vehicule: { hint: "Se repérer et surveiller le ver.", shown: ["clock", "coriolis", "sector", "minimap", "threat", "hits"] },
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

    // ---------- Disposition ----------
    const tabs = h("div", { class: "segmented", role: "group", "aria-label": "Disposition affichée", style: "flex-wrap: wrap" },
      s.layouts.map((l) => h("button", { type: "button", "aria-pressed": String(l.id === layout.id), onclick: () => void update({ activeLayout: l.id }).then(draw) }, l.name)));
    const name = h("input", { class: "input", id: "o-disp-nom", type: "text", maxlength: "30", value: layout.name, style: "flex: 1 1 160px; width: auto" });
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
      h("h2", { class: "section-title", id: "o-disp-titre" }, "Disposition"),
      tabs,
      h("p", { class: "muted", style: "margin: 0; font-size: 13px" },
        `${preset ? preset.hint + " " : ""}En jeu, ${prettyKeys(s.shortcuts["overlay-next"] ?? "")} passe à la suivante.`),
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

    // ---------- Éléments ----------
    const chip = (kind: WidgetKind) => {
      const w = layout.widgets.find((x) => x.kind === kind);
      if (!w) return null;
      const box = h("input", { type: "checkbox", checked: w.shown });
      box.addEventListener("change", () => edit((ls) => void (current(ls).widgets.find((x) => x.kind === kind)!.shown = box.checked)));
      return h("label", { class: "chip", style: "border-style: solid" }, box, WIDGET_LABELS[kind],
        w.scale !== 1 ? h("span", { class: "muted", style: "font-size: 12px" }, `${Math.round(w.scale * 100)} %`) : null);
    };
    // Anneaux ou barres : on coche l'un, on décoche l'autre.
    const rings = !layout.widgets.some((w) => STATS.includes(w.kind) && w.shown);
    const style = (asRings: boolean) => edit((ls) => {
      for (const w of current(ls).widgets) {
        if (RING_WIDGETS.includes(w.kind)) w.shown = asRings;
        else if (STATS.includes(w.kind)) w.shown = !asRings;
      }
    });
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
    const group = (title: string, ...children: (HTMLElement | null)[]) =>
      h("div", { class: "stack", style: "--gap: 8px" }, h("span", { class: "label" }, title), h("div", { class: "row wrap", style: "--gap: 8px" }, children));
    const elementsCard = h("section", { class: "card", "aria-labelledby": "o-elem-titre" },
      h("h2", { class: "section-title", id: "o-elem-titre" }, `Éléments · ${layout.name}`),
      group("Repères", ...LANDMARKS.map(chip)),
      h("div", { class: "stack", style: "--gap: 8px" },
        h("div", { class: "row spread wrap" },
          h("span", { class: "label" }, "Personnage"),
          h("div", { class: "segmented", role: "group", "aria-label": "Style des jauges" },
            h("button", { type: "button", "aria-pressed": String(rings), onclick: () => style(true) }, "Anneaux"),
            h("button", { type: "button", "aria-pressed": String(!rings), onclick: () => style(false) }, "Barres"))),
        h("div", { class: "row wrap", style: "--gap: 8px" }, rings ? RING_WIDGETS.map(chip) : STATS.map(chip), chip("threat"), chip("hits")),
        rings
          ? h("details", {},
              h("summary", { class: "muted", style: "cursor: pointer; font-size: 13px" }, "Valeurs dans les anneaux (toutes dispositions)"),
              h("div", { class: "row wrap", style: "--gap: 14px; margin-top: 8px" }, ringValues))
          : null),
    );

    // ---------- Comportement ----------
    const behaviourCard = h("section", { class: "card", "aria-labelledby": "o-comp-titre" },
      h("h2", { class: "section-title", id: "o-comp-titre" }, "Comportement"),
      toggle("autoLayout", "Disposition automatique", "Combat arme en main, Véhicule à bord, Exploration sinon. Seulement sans BattlEye (lecture du jeu) ; avec BattlEye, la disposition reste celle choisie."),
      toggle("overlayOnlyInGame", "Seulement avec le jeu au premier plan", "Les widgets s'effacent avec Alt+Tab ou quand le jeu est fermé."),
      toggle("overlayHideInMenus", "Masqués dans les menus du jeu", "Inventaire, carte, Échap… : effacés tant que le curseur est affiché. Le bandeau des alertes reste visible."),
      toggle("overlayClickThrough", "Clic traversant", "Les clics passent à travers les widgets, vers le jeu."),
      h("p", { class: "muted", style: "margin: 0; font-size: 13px" },
        `${prettyKeys(s.shortcuts.overlay ?? "")} affiche ou masque l'overlay ; ${prettyKeys(s.shortcuts["overlay-edit"] ?? "")} ouvre le mode édition `
        + "(glisser pour déplacer, molette pour la taille), la même combinaison le referme. Les minuteurs du widget se choisissent dans l'écran Minuteurs."),
    );

    mount(body,
      h("div", { class: "stack", style: "--gap: 20px; flex: 3 1 480px; min-width: 0" }, layoutCard, elementsCard),
      h("div", { class: "stack", style: "--gap: 20px; flex: 2 1 300px; min-width: 0" }, behaviourCard),
    );
  }

  mount(
    root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Widgets par-dessus le jeu"), h("h1", { class: "h1" }, "Overlay")),
      h("div", { class: "row wrap", style: "--gap: 8px" },
        h("button", { class: "btn btn-primary", type: "button", onclick: () => api.toggleWidgetsEdit() }, icon("edit", 16), "Placer les widgets"),
        h("button", { class: "btn", type: "button", onclick: () => api.toggleOverlay() }, "Afficher / masquer")),
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
