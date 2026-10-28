import type { Ctx, ViewHandle } from "../main";
import { h, icon, mount } from "../lib/dom";
import { openExternal } from "../lib/wiki-browser";

/**
 * Carte de TH.GL (The Hidden Gaming Lair), intégrée comme ils le proposent (th.gl/developers) : iframe gratuite, à
 * condition de garder visible le lien vers leur carte complète. Rien n'est copié dans Sietch.
 */
const MAPS = ["Bassin de Hagga", "Désert Profond", "Arrakeen", "Village d'Harko", "Caverne Rougissante", "Épave du Tyché", "Piste des Contrebandiers"];
const BASE = "https://duneawakening.th.gl/fr";
const STORE = "sietch-thgl";

/** Types de marqueurs de TH.GL (paramètre `types`), regroupés comme sur leur site. */
const GROUPS: { label: string; types: [string, string][] }[] = [
  { label: "Lieux", types: ["cave", "enemycamp", "shipwreck", "intel_point", "enemyoutpost", "tradingpost", "sietch", "secret_door", "ecolab", "explorationpointofinterest", "enemylaboroutpost", "atreides", "harkonnen", "exploration", "taxiservice", "bank", "discoverable", "landsraad_control_point", "small_shipwreck"].map((t) => [t, t]) },
  { label: "Véhicules", types: [["sandbike", "Moto des sables"], ["buggy", "Buggy"]] },
  { label: "Mentors", types: [["trainerstrooper", "Soldat"], ["trainersplanetologist", "Planétologue"], ["trainersbenegesserit", "Bene Gesserit"], ["trainersmentat", "Mentat"], ["trainersswordmaster", "Maître d'armes"]] },
  { label: "PNJ", types: ["npc_unaffiliated", "npc_atreides", "npc_harkonnen", "npc_bandits", "npc_smugglers", "npc_choam", "npc_spacing_guild", "npc_sardaukar", "npc_bene_gesserit", "npc_fremen"].map((t) => [t, t]) },
  { label: "Représentants de Maison", types: ["swydras", "argosaz", "taligari", "kenola", "novebruns", "hurata", "vernius", "richese", "hagal", "lindaren", "moritani", "dyvetz", "ecaz", "thorvald", "sor", "mikarrol", "imota", "alexin", "spinette", "varota", "mutelli", "wallach", "wayku", "maros"].map((t) => [`house_representatives${t}`, t]).concat([["controlpointhousetseida", "tseida"]]) as [string, string][] },
  { label: "Vendeurs", types: [["vehiclevendor", "Véhicules"], ["structurevendor", "Structures"], ["spicevendor", "Épice"], ["survivalvendor", "Survie"], ["resourcevendor", "Ressources"], ["barkeepvendor", "Barman"], ["weaponsvendor", "Armes"], ["landsraadvendor", "Landsraad"]] },
  { label: "Objets", types: ["primitive", "corpse", "rare", "basic", "water_tank", "medical", "ammo", "small_ultra_rare", "contract", "weapon", "ultra_rare", "fuel", "wreck", "refinery", "treasure_loot_container"].map((t) => [t, t]) },
  {
    label: "Ressources",
    types: [
      ["titanium", "Titane"], ["stravidium", "Stravidium"], ["basalt", "Basalte"], ["fiber_plant", "Fibre végétale"], ["bauxite", "Bauxite"],
      ["azurite", "Azurite"], ["rhyolite", "Rhyolite"], ["dolomite", "Dolomite"], ["erythrite", "Érythrite"], ["agave_seeds", "Graines d'agave"],
      ["magnetite", "Magnétite"], ["jasmium", "Jasmium"], ["fuel_cells", "Piles à combustible"], ["scrap_metal", "Ferraille"],
      ["scrap_electronics", "Débris électroniques"], ["primrose_field", "Primevères"], ["flour_sand_field", "Sable farineux"],
      ["spice_field_small", "Épice (petit champ)"], ["spice_field_medium", "Épice (moyen champ)"], ["spice_field_large", "Épice (grand champ)"],
    ],
  },
  { label: "Clés de Pentashield", types: ["white", "red", "blue", "purple", "orange", "green"].map((c) => [`${c}_id_band`, c]) },
];
/** Toujours affichés : frontières, noms des régions, zone de sécurité. */
const ALWAYS = ["region_borders", "region_names", "Security Zone"];
/** Catégories dont on peut choisir chaque type (les autres n'ont que des noms internes). */
const DETAILED = new Set(["Mentors", "Vendeurs", "Ressources", "Véhicules"]);

/** Préférences de l'écran, gardées dans ce navigateur seulement. */
function load(): { map: string; hidden: string[] } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    return { map: MAPS.includes(v.map) ? v.map : MAPS[0], hidden: Array.isArray(v.hidden) ? v.hidden : [] };
  } catch {
    return { map: MAPS[0], hidden: [] };
  }
}

export function render(root: HTMLElement, _ctx: Ctx): ViewHandle {
  const saved = load();
  let map = saved.map;
  const hidden = new Set(saved.hidden);
  let open: string | null = null;

  const frame = h("iframe", { class: "map", title: "Carte interactive TH.GL", allowfullscreen: "" }) as HTMLIFrameElement;
  const link = h("a", { href: "#" }) as HTMLAnchorElement;
  const mapSelect = h("select", {
    class: "select", id: "thgl-carte",
    onchange: (e: Event) => {
      map = (e.target as HTMLSelectElement).value;
      apply(true);
    },
  }, MAPS.map((name) => h("option", { value: name, selected: name === map }, name))) as HTMLSelectElement;
  const groupsBox = h("div", { class: "filter-list", role: "group", "aria-label": "Marqueurs affichés" });

  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ map, hidden: [...hidden] }));
    } catch {
      // Stockage indisponible : les choix ne valent que pour cette visite.
    }
  };

  let reload = 0;
  /** Recharge la carte (TH.GL ne lit les filtres qu'au chargement), après une courte pause entre deux clics. */
  const apply = (now = false) => {
    window.clearTimeout(reload);
    const go = () => {
      const path = `/maps/${encodeURIComponent(map)}`;
      const shown = GROUPS.flatMap((g) => g.types.map(([t]) => t)).filter((t) => !hidden.has(t));
      frame.src = `${BASE}/embed${path}?types=${encodeURIComponent([...shown, ...ALWAYS].join(","))}`;
      link.textContent = `Carte interactive de Dune: Awakening (${map})`;
      link.onclick = (e) => {
        e.preventDefault();
        void openExternal(BASE + path);
      };
    };
    if (now) go();
    else reload = window.setTimeout(go, 600);
    save();
  };

  const draw = () => {
    groupsBox.replaceChildren(
      ...GROUPS.flatMap((g) => {
        const on = g.types.filter(([t]) => !hidden.has(t)).length;
        const all = on === g.types.length;
        const row = h("div", { class: "filter-row" },
          h("button", {
            class: "chip filter-group", type: "button", "aria-pressed": String(on > 0),
            title: all ? "Tout masquer" : "Tout afficher",
            onclick: () => {
              for (const [t] of g.types) {
                if (all) hidden.add(t);
                else hidden.delete(t);
              }
              draw();
              apply();
            },
          }, g.label, h("span", { class: "muted" }, `${on}/${g.types.length}`)),
          DETAILED.has(g.label)
            ? h("button", { class: "chip", type: "button", "aria-expanded": String(open === g.label), "aria-label": `Détail : ${g.label}`, onclick: () => { open = open === g.label ? null : g.label; draw(); } }, open === g.label ? "▴" : "▾")
            : null,
        );
        if (open !== g.label) return [row];
        const detail = h("div", { class: "filter-detail", role: "group", "aria-label": `Détail : ${g.label}` },
          ...g.types.map(([t, label]) =>
            h("button", {
              class: "chip", type: "button", "aria-pressed": String(!hidden.has(t)),
              onclick: () => {
                if (hidden.has(t)) hidden.delete(t);
                else hidden.add(t);
                draw();
                apply();
              },
            }, label)));
        return [row, detail];
      }),
    );
  };

  mount(
    root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Lieux, ressources et PNJ"), h("h1", { class: "h1" }, "Carte TH.GL")),
      h("button", { class: "btn", type: "button", onclick: () => void openExternal(BASE + `/maps/${encodeURIComponent(map)}`) }, icon("external", 16), "Ouvrir dans le navigateur"),
    ),
    h("div", { class: "columns map-columns" },
      h("div", { class: "map-wrap" },
        frame,
        h("p", { class: "muted", style: "margin: 0; font-size: 13px" }, link, " par The Hidden Gaming Lair"),
      ),
      h("aside", { class: "card side-panel stack", style: "--gap: 14px" },
        h("div", { class: "stack", style: "--gap: 6px" }, h("label", { class: "label", for: "thgl-carte" }, "Carte"), mapSelect),
        h("div", { class: "row spread" },
          h("span", { class: "label" }, "Marqueurs"),
          h("div", { class: "row", style: "--gap: 6px" },
            h("button", { class: "btn", type: "button", onclick: () => { hidden.clear(); draw(); apply(); } }, "Tout"),
            h("button", { class: "btn", type: "button", onclick: () => { for (const g of GROUPS) for (const [t] of g.types) hidden.add(t); draw(); apply(); } }, "Aucun"),
          ),
        ),
        groupsBox,
      ),
    ),
  );
  draw();
  apply(true);
  return { dispose: () => window.clearTimeout(reload) };
}
