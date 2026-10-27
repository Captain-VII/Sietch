import { getVersion } from "@tauri-apps/api/app";
import { appDataDir } from "@tauri-apps/api/path";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Ctx, ViewHandle } from "../main";
import { api, prettyKeys, SHORTCUT_LABELS, type Diagnostic, type Settings, type UpdateInfo } from "../lib/api";
import { builds, getNotes, markers, setNotes, timerTemplates, type Build, type Marker, type TimerTemplate } from "../lib/data";
import { confirmDialog, h, mount, toast, type Child } from "../lib/dom";
import { durationLabel, pad } from "../lib/time";
import { live, solveAffine } from "../lib/live";

const TABS = [
  ["general", "Général"],
  ["raccourcis", "Raccourcis"],
  ["notifications", "Notifications"],
  ["sansbe", "Sans BattlEye"],
  ["donnees", "Données"],
  ["apropos", "À propos"],
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

  function card(title: string, ...children: Child[]) {
    return h("section", { class: "card", style: "padding: 28px" }, h("h2", { class: "section-title" }, title), ...children);
  }

  const panels: Record<Tab, () => HTMLElement | Promise<HTMLElement>> = {
    general: async () => {
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
      const auto = await autostartEnabled().catch(() => false);
      return card("Général",
        h("div", { class: "grid-auto", style: "--min: 220px; gap: 16px" },
          h("div", { class: "field" }, h("label", { class: "label", for: "p-serveur" }, "Nom du serveur"), label),
          select("p-offset", "Fuseau de l'heure serveur", offsets, String(s.serverOffsetMin), (v) => update({ serverOffsetMin: Number(v) })),
          select("p-cor-j", "Jour de la tempête de Coriolis", DAYS.map((d, i) => [String(i), d]), String(s.coriolisWeekday), (v) => update({ coriolisWeekday: Number(v) })),
          h("div", { class: "field" }, h("label", { class: "label", for: "p-cor-h" }, "Heure de la tempête (serveur)"), hour),
        ),
        h("p", { class: "muted", style: "margin: 0" }, "Vérifiez le jour et l'heure de la tempête sur votre serveur : ils servent au compte à rebours et aux rappels."),
        h("div", {},
          sw("Lancer au démarrage de l'ordinateur", "Sietch démarre réduit dans la zone de notification", auto, async (v) => {
            try {
              await (v ? enableAutostart() : disableAutostart());
            } catch (e) {
              toast("Réglage impossible", String(e));
            }
          }),
          sw("Garder dans la zone de notification", "Fermer la fenêtre ne quitte pas Sietch : les alarmes continuent", s.closeToTray, (v) => update({ closeToTray: v })),
          sw("Démarrer réduit", "N'ouvre pas la fenêtre principale au lancement", s.startMinimized, (v) => update({ startMinimized: v })),
        ),
      );
    },

    raccourcis: () => {
      const s = ctx.settings();
      const rows = Object.entries(SHORTCUT_LABELS).map(([action, label]) => {
        const btn = h("button", { class: "key-btn", type: "button", "aria-label": `${label} : ${prettyKeys(s.shortcuts[action] ?? "")}, cliquer pour changer` }, prettyKeys(s.shortcuts[action] ?? ""));
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
            btn.textContent = prettyKeys(ctx.settings().shortcuts[action] ?? "");
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
      const reminders = REMINDERS.map((m) => {
        const box = h("input", { type: "checkbox", checked: s.coriolisReminders.includes(m) });
        box.addEventListener("change", () => {
          const set = new Set(ctx.settings().coriolisReminders);
          if (box.checked) set.add(m);
          else set.delete(m);
          update({ coriolisReminders: [...set].sort((a, b) => b - a) });
        });
        return h("label", { class: "chip", style: "border-style: solid" }, box, durationLabel(m * 60));
      });
      return card("Notifications",
        h("p", { class: "muted", style: "margin: 0" }, "Les alertes sont silencieuses : une notification du système et un message dans Sietch, sans aucun son."),
        h("div", { class: "stack", style: "--gap: 8px" }, h("span", { class: "label" }, "Rappels avant la tempête de Coriolis"), h("div", { class: "row wrap", style: "--gap: 8px" }, reminders)),
        h("div", {},
          sw("Ne pas déranger", "Aucune notification jusqu'à nouvel ordre", s.dnd, (v) => api.setDnd(v)),
        ),
        h("div", { class: "row" },
          h("button", { class: "btn btn-accent", type: "button", onclick: () => api.testAlarm() }, "Envoyer une notification de test"),
        ),
      );
    },

    sansbe: async () => {
      const s = ctx.settings();
      const st = live.status;
      const path = await api.reloadLiveConfig().catch(() => "position.json");
      const line = (label: string, value: string, ok: boolean | null) =>
        h("div", { class: "setting-row" }, h("span", {}, label),
          h("span", { style: `color: ${ok === null ? "var(--text-soft)" : ok ? "var(--info)" : "var(--danger)"}` }, value));
      const regions: [string, string][] = [["hagga", "Bassin de Hagga"], ["profond", "Désert profond"]];
      // Diagnostic : relu chaque seconde tant que l'onglet est affiché.
      const diagBox = h("div", { class: "stack", style: "--gap: 8px" });
      const yesNo = (v: boolean | null, yes: string, no: string) => v === null ? "champ pas encore trouvé" : v ? yes : no;
      const showDiag = (d: Diagnostic) => {
        const age = d.lastRead ? Math.round((Date.now() - d.lastRead) / 1000) : null;
        mount(diagBox,
          h("span", { class: "label" }, "Diagnostic"),
          h("div", {},
            line("Structures du jeu", d.tables ? "trouvées" : "pas encore", d.tables ? true : null),
            line("Personnage", d.character ? "trouvé" : "pas encore", d.character ? true : null),
            line("Dernière lecture", age === null ? "aucune" : age < 2 ? "à l'instant" : `il y a ${age} s`, age === null ? null : age < 5),
            line("Source", d.source === "personnage" ? "noms d'Unreal Engine" : d.source === "chaine" ? "chaîne de pointeurs (position.json)" : "—", d.source ? true : null),
            line("Lectures réussies / manquées", `${d.reads} / ${d.failures}`, null),
            d.lastPosition ? line("Position (jeu)", d.lastPosition.map((v) => Math.round(v)).join(" · "), null) : null,
            line("Arme en main", yesNo(d.armed, "oui", "non"), d.armed === null ? null : true),
            line("À bord d'un véhicule", yesNo(d.inVehicle, "oui", "non"), d.inVehicle === null ? null : true),
            line("Ressources connues", d.lastScanSecs === null ? String(d.resourcesKnown) : `${d.resourcesKnown} (relevé en ${d.lastScanSecs.toFixed(1)} s)`, null),
          ));
      };
      const pollDiag = () => api.diagnostic().then((d) => { if (diagBox.isConnected) showDiag(d); else clearInterval(diagTimer); }).catch(() => {});
      const diagTimer = setInterval(pollDiag, 1000);
      void pollDiag();
      return card("Modules sans BattlEye",
        h("p", { class: "prose soft", style: "margin: 0" },
          "Depuis la mise à jour 1.5, Dune: Awakening peut se lancer sans BattlEye pour le mode solo et les serveurs privés qui ne l'exigent pas. "
          + "Dans ce cas seulement, Sietch peut lire votre position dans le jeu pour l'afficher sur la carte. Lecture seule : rien n'est modifié dans le jeu."),
        h("p", { class: "muted", style: "margin: 0" },
          "Garde-fou : dès que BattlEye est détecté, la lecture s'arrête immédiatement. Ne l'utilisez pas pour contourner les règles d'un serveur."),
        h("div", {},
          sw("Activer la position en direct", "Uniquement quand le jeu tourne sans BattlEye", s.liveModules, (v) => update({ liveModules: v })),
          line("Jeu détecté", st.gameRunning ? "oui" : "non", st.gameRunning ? true : null),
          line("BattlEye", st.battleyeRunning ? "actif : modules coupés" : "absent", st.battleyeRunning ? false : true),
          line("Position", st.active ? (st.source === "simulation" ? "en direct (simulation)" : "en direct") : "inactive", st.active),
          st.message ? line("État", st.message, false) : null,
        ),
        diagBox,
        h("div", { class: "stack", style: "--gap: 8px" },
          h("span", { class: "label" }, "Alertes du personnage"),
          h("p", { class: "muted", style: "margin: 0" }, "Notification silencieuse quand une valeur franchit son seuil (0 = désactivée). Elle ne se répète pas tant que la valeur n'est pas revenue de l'autre côté."),
          h("div", { class: "grid-auto", style: "--min: 160px; gap: 12px" },
            ([["water", "Eau sous (%)"], ["health", "Vie sous (%)"], ["power", "Power pack sous (%)"], ["volume", "Sac plein au-delà de (%)"], ["worm", "Ver au-delà de (% du seuil)"], ["heat", "Chaleur au-delà de (% du coup de chaleur)"]] as const).map(([key, label]) => {
              const input = h("input", { class: "input", id: `p-al-${key}`, type: "number", min: "0", max: "100", value: String(s.playerAlerts[key]) });
              input.addEventListener("change", () => {
                const v = Math.max(0, Math.min(100, Math.round(Number(input.value) || 0)));
                input.value = String(v);
                update({ playerAlerts: { ...ctx.settings().playerAlerts, [key]: v } });
              });
              return h("div", { class: "field" }, h("label", { class: "label", for: `p-al-${key}` }, label), input);
            })),
        ),
        h("div", { class: "stack", style: "--gap: 8px" },
          h("span", { class: "label" }, "Calibration de la carte"),
          ...regions.map(([id, label]) => {
            const n = (s.calibration[id] ?? []).length;
            const ok = !!solveAffine(s.calibration[id]);
            return h("div", { class: "row spread" },
              h("span", {}, `${label} : ${ok ? "calibrée" : `${Math.min(n, 3)}/3 points`}${s.liveRegion === id ? " · région actuelle" : ""}`),
              n ? h("button", { class: "btn", type: "button", onclick: () => update({ calibration: { ...s.calibration, [id]: [] } }).then(() => draw()) }, "Effacer") : null);
          }),
          h("span", { class: "muted" }, "La calibration se fait depuis la carte, jeu lancé : bandeau bleu au-dessus de la carte."),
        ),
        h("div", { class: "stack", style: "--gap: 8px" },
          h("span", { class: "label" }, "Réglage technique (position.json)"),
          h("p", { class: "muted", style: "margin: 0; word-break: break-all" }, path),
          h("p", { class: "muted", style: "margin: 0" },
            "La position du joueur se trouve à une adresse mémoire qui change à chaque mise à jour du jeu. "
            + "Renseignez sa chaîne de pointeurs (pointerChain), trouvée par exemple avec Cheat Engine en mode solo sans BattlEye, puis rechargez."),
          h("div", { class: "row" }, h("button", { class: "btn btn-accent", type: "button", onclick: async () => { await api.reloadLiveConfig(); toast("position.json rechargé"); } }, "Recharger position.json")),
        ),
      );
    },

    donnees: async () => {
      const dir = await appDataDir().catch(() => "");
      return card("Données",
        h("p", { class: "prose soft", style: "margin: 0" }, "Marqueurs, builds, notes, minuteurs et modèles de minuteurs restent sur cet ordinateur. Exportez-les pour les sauvegarder ou les transférer sur un autre PC."),
        dir ? h("p", { class: "muted", style: "margin: 0; word-break: break-all" }, `Dossier : ${dir}`) : null,
        h("div", { class: "row wrap" },
          h("button", { class: "btn btn-primary", type: "button", onclick: exportAll }, "Tout exporter"),
          h("button", { class: "btn", type: "button", onclick: importAll }, "Importer une sauvegarde"),
        ),
        h("div", {},
          h("button", { class: "btn btn-danger", type: "button", onclick: resetAll }, "Effacer toutes mes données"),
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
      return card("À propos",
        h("div", { class: "row", style: "align-items: baseline; --gap: 12px" },
          h("span", { class: "h2" }, "SIETCH"), h("span", { class: "muted" }, `version ${version}`)),
        updateBox,
        h("p", { class: "prose soft", style: "margin: 0" }, "Compagnon de bureau non officiel pour Dune: Awakening. Sietch ne modifie jamais le jeu. Il ne lit sa mémoire (sans l'écrire) qu'en mode solo ou serveur privé sans BattlEye, et seulement si vous l'activez : il reste compatible avec BattlEye."),
        h("p", { class: "muted", style: "margin: 0" }, "Logiciel libre sous licence GPL-3.0-or-later. Dune et Dune: Awakening appartiennent à leurs ayants droit ; Sietch n'y est pas affilié."),
      );
    },
  };

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
    mount(tabsBox, TABS.map(([id, label]) =>
      h("button", {
        class: "tab", type: "button", role: "tab", "aria-selected": String(id === tab),
        onclick: () => {
          stopListening?.();
          tab = id;
          void draw();
        },
      }, label)));
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
  // L'état du jeu change : on rafraîchit l'onglet Sans BattlEye s'il est affiché.
  let lastActive: string = "";
  const stopLive = live.subscribe(() => {
    const st = live.status;
    const key = [st.gameRunning, st.battleyeRunning, st.active, st.enabled, st.message].join("|");
    if (key !== lastActive) {
      lastActive = key;
      if (tab === "sansbe" && !stopListening) void draw();
    }
  });

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
      stopLive();
    },
  };
}
