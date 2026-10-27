import type { Ctx, ViewHandle } from "../main";
import { api, prettyKeys, type Layout, type Settings, type WidgetKind } from "../lib/api";
import { confirmDialog, h, mount, toast } from "../lib/dom";

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
};

/** Widgets de l'overlay : dispositions, éléments affichés, clic traversant. */
export function render(root: HTMLElement, ctx: Ctx): ViewHandle {
  const content = h("section", { class: "card", style: "padding: 28px" });
  /** Réglages envoyés depuis cet écran dont on attend encore l'écho. */
  let pendingEchoes = 0;

  async function update(patch: Partial<Settings>) {
    pendingEchoes++;
    const errors = await ctx.saveSettings({ ...ctx.settings(), ...patch });
    if (errors.length) toast("Réglage refusé", errors.join(" — "));
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

    const pick = h("select", { class: "select", id: "o-disp" }, s.layouts.map((l) => h("option", { value: l.id, selected: l.id === layout.id }, l.name)));
    pick.addEventListener("change", () => void update({ activeLayout: pick.value }).then(draw));
    const name = h("input", { class: "input", id: "o-disp-nom", type: "text", maxlength: "30", value: layout.name });
    name.addEventListener("change", () => {
      const v = name.value.trim();
      if (v) edit((ls) => void (current(ls).name = v));
    });

    const elements = layout.widgets.map((w) => {
      const box = h("input", { type: "checkbox", checked: w.shown });
      box.addEventListener("change", () => edit((ls) => {
        current(ls).widgets.find((x) => x.kind === w.kind)!.shown = box.checked;
      }));
      return h("label", { class: "chip", style: "border-style: solid" }, box, WIDGET_LABELS[w.kind],
        w.scale !== 1 ? h("span", { class: "muted", style: "font-size: 12px" }, `${Math.round(w.scale * 100)} %`) : null);
    });

    const through = h("button", {
      class: "switch", type: "button", role: "switch", "aria-checked": String(s.overlayClickThrough), "aria-label": "Clic traversant",
      onclick: () => {
        const v = through.getAttribute("aria-checked") !== "true";
        through.setAttribute("aria-checked", String(v));
        void update({ overlayClickThrough: v });
      },
    });

    mount(content,
      h("p", { class: "muted", style: "margin: 0" },
        `Chaque élément est un widget que vous placez où vous voulez par-dessus le jeu. ${prettyKeys(s.shortcuts.overlay ?? "")} les affiche ou les masque, `
        + `${prettyKeys(s.shortcuts["overlay-edit"] ?? "")} ouvre le mode édition : glissez-les à la souris, la molette change leur taille, puis la même combinaison les verrouille.`),
      h("div", { class: "row wrap" },
        h("button", { class: "btn btn-primary", type: "button", onclick: () => api.toggleWidgetsEdit() }, "Placer les widgets"),
        h("button", { class: "btn", type: "button", onclick: () => api.toggleOverlay() }, "Afficher / masquer"),
      ),
      h("div", { class: "grid-auto", style: "--min: 220px; gap: 16px" },
        h("div", { class: "field" }, h("label", { class: "label", for: "o-disp" }, "Disposition affichée"), pick),
        h("div", { class: "field" }, h("label", { class: "label", for: "o-disp-nom" }, "Nom de la disposition"), name),
      ),
      h("div", { class: "row wrap" },
        h("button", { class: "btn", type: "button", onclick: () => edit((ls) => {
          // Copie de la disposition affichée : on part de ses positions.
          const id = `disposition-${Date.now().toString(36)}`;
          ls.push({ ...structuredClone(current(ls)), id, name: `Disposition ${ls.length + 1}` });
          return id;
        }) }, "Nouvelle disposition"),
        h("button", { class: "btn", type: "button", onclick: () => edit((ls) => {
          for (const w of current(ls).widgets) w.pos = null;
        }) }, "Replacer automatiquement"),
        s.layouts.length > 1
          ? h("button", { class: "btn btn-danger", type: "button", onclick: async () => {
            if (!(await confirmDialog(`Supprimer la disposition « ${layout.name} » ?`, "Supprimer"))) return;
            edit((ls) => {
              ls.splice(ls.findIndex((l) => l.id === layout.id), 1);
              return ls[0].id;
            });
          } }, "Supprimer")
          : null,
      ),
      h("div", { class: "stack", style: "--gap: 8px" },
        h("span", { class: "label" }, "Éléments affichés"),
        h("div", { class: "row wrap", style: "--gap: 8px" }, elements)),
      h("div", { class: "setting-row" },
        h("div", { class: "stack", style: "--gap: 4px" }, h("span", {}, "Clic traversant"),
          h("span", { class: "muted", style: "font-size: 13px" }, "Widgets verrouillés : les clics passent à travers, vers le jeu. Le mode édition les rend toujours déplaçables.")),
        through),
      h("p", { class: "muted", style: "margin: 0" }, `${prettyKeys(s.shortcuts["overlay-next"] ?? "")} passe d'une disposition à l'autre, même en jeu. Choisissez dans l'écran Minuteurs quels minuteurs apparaissent dans le widget Minuteurs.`),
    );
  }

  mount(
    root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Widgets par-dessus le jeu"), h("h1", { class: "h1" }, "Overlay")),
      h("span", { class: "muted" }, "Enregistré automatiquement"),
    ),
    content,
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
