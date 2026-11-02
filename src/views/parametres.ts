import { getVersion } from "@tauri-apps/api/app";
import { appDataDir } from "@tauri-apps/api/path";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Ctx, ViewHandle } from "../main";
import { api, prettyKeys, SHORTCUT_LABELS, type Diagnostic, type Settings, type UpdateInfo } from "../lib/api";
import { builds, getNotes, markers, setNotes, timerTemplates, type Build, type Marker, type TimerTemplate } from "../lib/data";
import { cardHead, confirmDialog, h, icon, keys, mount, toast, type Child } from "../lib/dom";
import { durationLabel, pad } from "../lib/time";

const TABS = [
  ["general", "Général", "gear"],
  ["serveur", "Serveur", "sun"],
  ["notifications", "Alertes", "bell"],
  ["raccourcis", "Raccourcis", "bolt"],
  ["donnees", "Données", "copy"],
  ["apropos", "À propos", "book"],
] as const;

/** Seuils des alertes du personnage : clé, libellé, explication. */
const PLAYER_ALERTS = [
  ["water", "Eau", "Alerte quand l'eau passe sous ce niveau"],
  ["health", "Vie", "Alerte quand la vie passe sous ce niveau"],
  ["power", "Power pack", "Alerte quand l'énergie passe sous ce niveau"],
  ["volume", "Sac", "Alerte quand le sac est rempli au-delà"],
  ["worm", "Menace du ver", "En pourcentage du seuil d'attaque"],
  ["heat", "Chaleur", "En pourcentage du coup de chaleur"],
] as const;
type Tab = (typeof TABS)[number][0];

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const REMINDERS = [1440, 360, 60, 30, 10, 5];

let lastTab: Tab = "general";

/** Transforme une touche pressée en combinaison "Ctrl+Shift+M", ou null si elle n'est pas utilisable. */
function accelFromEvent(e: KeyboardEvent): string | null {
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code;
  else if (/^Numpad[0-9]$/.test(e.code)) key = e.code;
  if (!key) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  if (!mods.length && !key.startsWith("F")) return null;
  return [...mods, key].join("+");
}

export function render(root: HTMLElement, ctx: Ctx, action?: string | null): ViewHandle {
  let tab: Tab = (TABS.find(([id]) => id === action)?.[0]) ?? lastTab;
  const content = h("div", { class: "stack", style: "--gap: 20px; flex: 4 1 520px; min-width: 0" });
  const tabsBox = h("div", { class: "tabs", role: "tablist", "aria-label": "Rubriques" });
  let stopListening: (() => void) | null = null;
  /** Réglages envoyés depuis cet écran dont on attend encore l'écho. */
  let pendingEchoes = 0;

  async function update(patch: Partial<Settings>) {
    const next = { ...ctx.settings(), ...patch };
    pendingEchoes++;
    const errors = await ctx.saveSettings(next);
    if (errors.length) toast("Raccourci refusé", errors.join(" — "));
  }

  function sw(label: string, hint: string, value: boolean, onChange: (v: boolean) => void) {
    const btn = h("button", {
      class: "switch", type: "button", role: "switch", "aria-checked": String(value), "aria-label": label,
      onclick: () => {
        const v = btn.getAttribute("aria-checked") !== "true";
        btn.setAttribute("aria-checked", String(v));
        onChange(v);
      },
    });
    return h("div", { class: "setting-row" },
      h("div", { class: "stack", style: "--gap: 4px" }, h("span", {}, label), h("span", { class: "muted", style: "font-size: 13px" }, hint)),
      btn);
  }

  function select(id: string, label: string, options: [string, string][], value: string, onChange: (v: string) => void) {
    const el = h("select", { class: "select", id }, options.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
    el.addEventListener("change", () => onChange(el.value));
    return h("div", { class: "field" }, h("label", { class: "label", for: id }, label), el);
  }

  let cardId = 0;
  function card(title: string, ...children: Child[]) {
    const id = `p-carte-${++cardId}`;
    return h("section", { class: "card", "aria-labelledby": id }, cardHead(id, title), ...children);
  }

  /** Plusieurs cartes dans un même onglet. */
  const cards = (...children: Child[]) => h("div", { class: "stack", style: "--gap: 20px" }, ...children);

  const note = (text: string) => h("p", { class: "muted", style: "margin: 0" }, text);

  const panels: Record<Tab, () => HTMLElement | Promise<HTMLElement>> = {
    general: async () => {
      const s = ctx.settings();
      const auto = await autostartEnabled().catch(() => false);
      return card("Démarrage",
        h("div", {},
          sw("Lancer au démarrage de l'ordinateur", "Sietch démarre réduit dans la zone de notification", auto, async (v) => {
            try {
              await (v ? enableAutostart() : disableAutostart());
            } catch (e) {
              toast("Réglage impossible", String(e));
            }
          }),
          sw("Démarrer réduit", "N'ouvre pas la fenêtre principale au lancement", s.startMinimized, (v) => update({ startMinimized: v })),
          sw("Garder dans la zone de notification", "Fermer la fenêtre ne quitte pas Sietch : les alarmes continuent", s.closeToTray, (v) => update({ closeToTray: v })),
        ),
      );
    },

    serveur: () => {
      const s = ctx.settings();
      const offsets: [string, string][] = [];
      for (let m = -12 * 60; m <= 14 * 60; m += 30) {
        const sign = m < 0 ? "−" : "+";
        offsets.push([String(m), `UTC${sign}${Math.floor(Math.abs(m) / 60)}${Math.abs(m) % 60 ? ":30" : ""}`]);
      }
      const label = h("input", { class: "input", id: "p-serveur", type: "text", maxlength: "40", value: s.serverLabel });
      label.addEventListener("change", () => update({ serverLabel: label.value.trim() }));
      const hour = h("input", { class: "input", id: "p-cor-h", type: "time", value: `${pad(s.coriolisHour)}:${pad(s.coriolisMinute)}` });
      hour.addEventListener("change", () => {
        const [hh, mm] = hour.value.split(":").map(Number);
        if (Number.isFinite(hh) && Number.isFinite(mm)) update({ coriolisHour: hh, coriolisMinute: mm });
      });
      const reminders = REMINDERS.map((m) => {
        const chip = h("button", { class: "chip small solid", type: "button", "aria-pressed": String(s.coriolisReminders.includes(m)), onclick: () => {
          const on = chip.getAttribute("aria-pressed") !== "true";
          chip.setAttribute("aria-pressed", String(on));
          const set = new Set(ctx.settings().coriolisReminders);
          if (on) set.add(m);
          else set.delete(m);
          update({ coriolisReminders: [...set].sort((a, b) => b - a) });
        } }, durationLabel(m * 60));
        return chip;
      });
      return cards(
        card("Serveur",
          h("div", { class: "grid-auto", style: "--min: 220px; gap: 16px" },
            h("div", { class: "field" }, h("label", { class: "label", for: "p-serveur" }, "Nom du serveur"), label),
            select("p-offset", "Fuseau de l'heure serveur", offsets, String(s.serverOffsetMin), (v) => update({ serverOffsetMin: Number(v) })),
          ),
        ),
        card("Tempête de Coriolis",
          note("Vérifiez le jour et l'heure sur votre serveur : ils servent au compte à rebours et aux rappels."),
          h("div", { class: "grid-auto", style: "--min: 220px; gap: 16px" },
            select("p-cor-j", "Jour", DAYS.map((d, i) => [String(i), d]), String(s.coriolisWeekday), (v) => update({ coriolisWeekday: Number(v) })),
            h("div", { class: "field" }, h("label", { class: "label", for: "p-cor-h" }, "Heure (serveur)"), hour),
          ),
          h("div", { class: "stack", style: "--gap: 8px" }, h("span", { class: "label" }, "Me prévenir avant"), h("div", { class: "row wrap", style: "--gap: 8px" }, reminders)),
        ),
      );
    },

    raccourcis: () => {
      const s = ctx.settings();
      const rows = Object.entries(SHORTCUT_LABELS).map(([action, label]) => {
        const btn = h("button", { class: "key-btn", type: "button", "aria-label": `${label} : ${prettyKeys(s.shortcuts[action] ?? "")}, cliquer pour changer` }, keys(s.shortcuts[action]));
        btn.addEventListener("click", () => {
          stopListening?.();
          btn.classList.add("listening");
          btn.textContent = "Appuyez sur la combinaison…";
          const onKey = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Escape") return finish(null);
            if (e.key === "Backspace" || e.key === "Delete") return finish("");
            const accel = accelFromEvent(e);
            if (accel) finish(accel);
          };
          const finish = (accel: string | null) => {
            window.removeEventListener("keydown", onKey, true);
            stopListening = null;
            btn.classList.remove("listening");
            const shortcuts = { ...ctx.settings().shortcuts };
            if (accel !== null) {
              for (const [a, k] of Object.entries(shortcuts)) if (k === accel && a !== action) shortcuts[a] = "";
              shortcuts[action] = accel;
              void update({ shortcuts }).then(() => draw());
            }
            btn.replaceChildren(keys(ctx.settings().shortcuts[action]));
          };
          window.addEventListener("keydown", onKey, true);
          stopListening = () => finish(null);
        });
        return h("div", { class: "setting-row" }, h("span", {}, label), btn);
      });
      return card("Raccourcis globaux",
        h("p", { class: "muted", style: "margin: 0" }, "Ils fonctionnent même quand le jeu est au premier plan. Cliquez sur une combinaison puis appuyez sur la nouvelle ; Échap annule, Retour arrière désactive."),
        h("div", {}, rows),
      );
    },

    notifications: () => {
      const s = ctx.settings();
      const thresholds = PLAYER_ALERTS.map(([key, label, hint]) => {
        const input = h("input", { class: "input", id: `p-al-${key}`, type: "number", min: "0", max: "100", value: String(s.playerAlerts[key]), style: "width: 88px; text-align: right" });
        input.addEventListener("change", () => {
          const v = Math.max(0, Math.min(100, Math.round(Number(input.value) || 0)));
          input.value = String(v);
          update({ playerAlerts: { ...ctx.settings().playerAlerts, [key]: v } });
        });
        return h("div", { class: "setting-row" },
          h("div", { class: "stack", style: "--gap: 4px" }, h("label", { for: `p-al-${key}` }, label), h("span", { class: "muted", style: "font-size: 13px" }, hint)),
          h("div", { class: "row", style: "--gap: 8px" }, input, h("span", { class: "muted" }, "%")));
      });
      return cards(
        card("Notifications",
          note("Les alertes sont silencieuses : une notification du système et un message dans Sietch, sans aucun son."),
          h("div", {},
            sw("Ne pas déranger", "Aucune notification jusqu'à nouvel ordre", s.dnd, (v) => api.setDnd(v)),
          ),
          h("div", { class: "row" },
            h("button", { class: "btn btn-accent", type: "button", onclick: () => api.testAlarm() }, "Envoyer une notification de test"),
          ),
        ),
        card("Alertes du personnage",
          note("Une notification quand une valeur franchit son seuil, sans répétition tant qu'elle n'est pas revenue de l'autre côté. 0 désactive l'alerte."),
          h("div", {}, thresholds),
        ),
      );
    },

    donnees: async () => {
      const dir = await appDataDir().catch(() => "");
      return cards(
        card("Sauvegarde",
          h("p", { class: "prose soft", style: "margin: 0" }, "Marqueurs, builds, notes, minuteurs et modèles de minuteurs restent sur cet ordinateur. Exportez-les pour les sauvegarder ou les transférer sur un autre PC."),
          dir ? h("p", { class: "muted", style: "margin: 0; word-break: break-all" }, `Dossier : ${dir}`) : null,
          h("div", { class: "row wrap" },
            h("button", { class: "btn btn-primary", type: "button", onclick: exportAll }, "Tout exporter"),
            h("button", { class: "btn", type: "button", onclick: importAll }, "Importer une sauvegarde"),
          ),
        ),
        card("Tout effacer",
          note("Supprime définitivement vos marqueurs, builds, notes et minuteurs. Exportez d'abord pour en garder une copie."),
          h("div", {},
            h("button", { class: "btn btn-danger", type: "button", onclick: resetAll }, "Effacer toutes mes données"),
          ),
        ),
      );
    },

    apropos: async () => {
      const version = await getVersion().catch(() => "?");
      // Mises à jour : la vérification de fond a peut-être déjà trouvé une version plus récente.
      const updateBox = h("div", { class: "row wrap", style: "--gap: 12px" });
      const showUpdate = (u: UpdateInfo | null, checked = false) => mount(updateBox,
        u
          ? [h("span", {}, `Version ${u.version} disponible.`),
             h("button", { class: "btn btn-primary", type: "button", onclick: async (e: Event) => {
               (e.currentTarget as HTMLButtonElement).disabled = true;
               toast("Mise à jour", "Téléchargement… Sietch va se fermer puis se relancer.");
               await api.installUpdate().catch((err) => toast("Mise à jour impossible", String(err)));
             } }, "Installer et redémarrer")]
          : [h("span", { class: "muted" }, checked ? "Sietch est à jour." : "Vérification automatique au lancement, puis toutes les 6 heures."),
             h("button", { class: "btn", type: "button", onclick: async (e: Event) => {
               (e.currentTarget as HTMLButtonElement).disabled = true;
               try {
                 showUpdate(await api.checkUpdate(), true);
               } catch (err) {
                 toast("Vérification impossible", String(err));
                 showUpdate(null);
               }
             } }, "Rechercher une mise à jour")]);
      showUpdate(await api.update().catch(() => null));
      return cards(gameReading(await api.diagnostic().catch(() => null)), card("À propos",
        h("div", { class: "row", style: "align-items: baseline; --gap: 12px" },
          h("span", { class: "h2" }, "SIETCH"), h("span", { class: "muted" }, `version ${version}`)),
        updateBox,
        h("p", { class: "prose soft", style: "margin: 0" }, "Compagnon de bureau non officiel pour Dune: Awakening. Sietch ne modifie jamais le jeu : il lit seulement sa mémoire, en mode solo ou sur un serveur privé sans BattlEye."),
        h("p", { class: "muted", style: "margin: 0" }, "Logiciel libre sous licence GPL-3.0-or-later. Dune et Dune: Awakening appartiennent à leurs ayants droit ; Sietch n'y est pas affilié."),
      ));
    },
  };

  /** Ce que Sietch arrive à lire du jeu : après un patch, dit précisément ce qui manque au lieu de valeurs vides. */
  function gameReading(d: Diagnostic | null) {
    const battleye = note("Sietch ne lit le jeu que sans BattlEye : mode solo ou serveur privé. Avec BattlEye, seuls les minuteurs, la carte et les outils hors jeu fonctionnent.");
    if (!d?.tables) return card("Lecture du jeu", battleye, note("Jeu fermé, avec BattlEye, ou pas encore lu : rien à vérifier pour l'instant."));
    const item = (label: string, ok: boolean) => h("li", { class: ok ? "check-ok" : "check-missing" }, h("span", { "aria-hidden": "true" }, ok ? "✓" : "✕"), ` ${label}`, h("span", { class: "sr-only" }, ok ? " : lu" : " : introuvable"));
    return card("Lecture du jeu",
      d.missing.length
        ? h("p", { class: "prose", role: "alert", style: "margin: 0" }, h("strong", {}, "Le jeu a changé (mise à jour ?) : "),
          `champs introuvables, le personnage n'est plus lu : ${d.missing.join(", ")}. Une nouvelle version de Sietch est nécessaire.`)
        : note(d.character ? "Personnage lu : vie, endurance, eau, énergie et position." : "Personnage pas encore chargé (menu du jeu, chargement…)."),
      d.optional.length ? h("ul", { class: "check-list" }, d.optional.map(([label, ok]) => item(label, ok))) : null,
      note(`${d.reads} lectures, ${d.failures} manquées · ressources : ${d.scanning ? "relevé en cours" : d.lastScanSecs != null ? `dernier relevé en ${d.lastScanSecs.toFixed(1)} s` : "pas encore relevées"} · ${d.foes} personnage${d.foes > 1 ? "s" : ""} suivi${d.foes > 1 ? "s" : ""}`),
    );
  }

  async function exportAll() {
    const path = await save({ defaultPath: "sietch-sauvegarde.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return;
    const data = {
      format: "sietch-sauvegarde",
      version: 1,
      exportedAt: new Date().toISOString(),
      markers: await markers.all(),
      builds: await builds.all(),
      notes: await getNotes(),
      timerTemplates: await timerTemplates.all(),
      timers: ctx.timers(),
    };
    await writeTextFile(path, JSON.stringify(data, null, 2));
    toast("Sauvegarde enregistrée", path);
  }

  async function importAll() {
    const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      const data = JSON.parse(await readTextFile(path));
      if (data?.format !== "sietch-sauvegarde") throw new Error("ce fichier n'est pas une sauvegarde Sietch");
      if (!(await confirmDialog("Remplacer vos marqueurs, builds et notes par ceux de la sauvegarde ? Les minuteurs de la sauvegarde seront ajoutés aux vôtres.", "Remplacer"))) return;
      if (Array.isArray(data.markers)) await markers.replaceAll(data.markers as Marker[]);
      if (Array.isArray(data.builds)) await builds.replaceAll(data.builds as Build[]);
      if (typeof data.notes === "string") await setNotes(data.notes);
      if (Array.isArray(data.timerTemplates)) await timerTemplates.replaceAll(data.timerTemplates as TimerTemplate[]);
      let n = 0;
      for (const t of Array.isArray(data.timers) ? data.timers : []) {
        if (typeof t?.name !== "string" || typeof t?.durationSecs !== "number") continue;
        await api.saveTimer({
          name: t.name, place: String(t.place ?? ""), group: ["ressources", "evenements", "personnels"].includes(t.group) ? t.group : "personnels",
          durationSecs: t.durationSecs, repeat: !!t.repeat, alarm: t.alarm !== false, inOverlay: t.inOverlay !== false,
        });
        n++;
      }
      toast("Sauvegarde importée", `${n} minuteur${n > 1 ? "s" : ""} relancé${n > 1 ? "s" : ""}.`);
    } catch (e) {
      toast("Import impossible", String(e instanceof Error ? e.message : e));
    }
  }

  async function resetAll() {
    if (!(await confirmDialog("Effacer tous vos marqueurs, builds, notes et minuteurs ? Cette action est définitive : exportez d'abord si vous voulez garder une copie.", "Tout effacer"))) return;
    await markers.replaceAll([]);
    await builds.replaceAll([]);
    await setNotes("");
    await timerTemplates.replaceAll([]);
    for (const t of ctx.timers()) await api.deleteTimer(t.id);
    toast("Données effacées");
  }

  async function draw() {
    lastTab = tab;
    mount(tabsBox, TABS.map(([id, label, ico]) =>
      h("button", {
        class: "tab", type: "button", role: "tab", "aria-selected": String(id === tab),
        onclick: () => {
          stopListening?.();
          tab = id;
          void draw();
        },
      }, icon(ico, 16), label)));
    const panel = await panels[tab]();
    mount(content, panel);
  }

  mount(
    root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Préférences de l'application"), h("h1", { class: "h1" }, "Paramètres")),
      h("span", { class: "muted" }, "Enregistré automatiquement"),
    ),
    h("div", { class: "columns" }, tabsBox, content),
  );
  void draw();

  return {
    // Un autre écran (ou la zone de notification) a changé un réglage : on rafraîchit,
    // sauf pendant la saisie d'un raccourci.
    onSettings: () => {
      if (pendingEchoes > 0) {
        pendingEchoes--;
        return;
      }
      if (!stopListening) void draw();
    },
    dispose: () => {
      stopListening?.();
    },
  };
}
