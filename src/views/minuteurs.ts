import type { Ctx, ViewHandle } from "../main";
import { api, GROUPS, SOUNDS, type Timer, type TimerGroup, type TimerInput } from "../lib/api";
import { confirmDialog, h, icon, mount, toast } from "../lib/dom";
import { durationLabel, timerStatus } from "../lib/time";

const GRIP = () => {
  const svg = icon("", 14);
  svg.setAttribute("viewBox", "0 0 14 20");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("stroke", "none");
  svg.innerHTML = [4, 10, 16].map((y) => `<circle cx="4" cy="${y}" r="1.6"/><circle cx="10" cy="${y}" r="1.6"/>`).join("");
  return svg;
};

function toInput(t: Timer): TimerInput {
  const { id, name, place, group, durationSecs, repeat, alarm, sound, inOverlay } = t;
  return { id, name, place, group, durationSecs, repeat, alarm, sound, inOverlay };
}

export function render(root: HTMLElement, ctx: Ctx, action?: string | null): ViewHandle {
  const listBox = h("div", { class: "stack", style: "--gap: 24px" });
  let editing: Timer | null = null;
  let dragId: string | null = null;

  // ---------- Formulaire ----------
  const f = {
    name: h("input", { class: "input", id: "t-nom", type: "text", maxlength: "80", placeholder: "ex. Nœud de fer — B7" }),
    place: h("input", { class: "input", id: "t-lieu", type: "text", maxlength: "80", placeholder: "ex. Bassin de Hagga" }),
    group: h("select", { class: "select", id: "t-groupe" },
      Object.entries(GROUPS).map(([v, l]) => h("option", { value: v }, l))),
    hours: h("input", { class: "input", id: "t-h", type: "number", min: "0", max: "999", value: "0" }),
    minutes: h("input", { class: "input", id: "t-m", type: "number", min: "0", max: "59", value: "45" }),
    sound: h("select", { class: "select", id: "t-son" },
      h("option", { value: "" }, "Son par défaut"),
      Object.entries(SOUNDS).map(([v, l]) => h("option", { value: v }, l))),
    alarm: h("input", { type: "checkbox", checked: true }),
    repeat: h("input", { type: "checkbox" }),
    inOverlay: h("input", { type: "checkbox", checked: true }),
  };
  const formTitle = h("h2", { class: "section-title", id: "form-titre" }, "Nouveau minuteur");
  const submit = h("button", { class: "btn btn-primary", type: "submit" }, "Démarrer");
  const cancel = h("button", { class: "btn", type: "button", hidden: true, onclick: () => fill(null) }, "Annuler");
  const error = h("p", { class: "form-error", role: "alert", style: "margin: 0" });

  function fill(t: Timer | null) {
    editing = t;
    f.name.value = t?.name ?? "";
    f.place.value = t?.place ?? "";
    f.group.value = t?.group ?? "ressources";
    f.hours.value = String(t ? Math.floor(t.durationSecs / 3600) : 0);
    f.minutes.value = String(t ? Math.round((t.durationSecs % 3600) / 60) : 45);
    f.sound.value = t?.sound ?? "";
    f.alarm.checked = t?.alarm ?? true;
    f.repeat.checked = t?.repeat ?? false;
    f.inOverlay.checked = t?.inOverlay ?? true;
    formTitle.textContent = t ? "Modifier le minuteur" : "Nouveau minuteur";
    submit.textContent = t ? "Enregistrer" : "Démarrer";
    cancel.hidden = !t;
    error.textContent = "";
    if (t) f.name.focus();
  }

  const form = h(
    "form",
    {
      class: "card",
      "aria-labelledby": "form-titre",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const secs = (Number(f.hours.value) || 0) * 3600 + (Number(f.minutes.value) || 0) * 60;
        const input: TimerInput = {
          id: editing?.id,
          name: f.name.value.trim(),
          place: f.place.value.trim(),
          group: f.group.value as TimerGroup,
          durationSecs: secs,
          repeat: f.repeat.checked,
          alarm: f.alarm.checked,
          sound: f.sound.value,
          inOverlay: f.inOverlay.checked,
        };
        try {
          await api.saveTimer(input);
          if (editing && editing.durationSecs !== secs) toast("Durée modifiée", "Le minuteur repart de zéro.");
          fill(null);
        } catch (err) {
          error.textContent = String(err);
        }
      },
    },
    formTitle,
    h("div", { class: "field" }, h("label", { class: "label", for: "t-nom" }, "Nom"), f.name),
    h("div", { class: "field" }, h("label", { class: "label", for: "t-lieu" }, "Lieu"), f.place),
    h("div", { class: "field" }, h("label", { class: "label", for: "t-groupe" }, "Groupe"), f.group),
    h("div", { class: "row" },
      h("div", { class: "field grow" }, h("label", { class: "label", for: "t-h" }, "Heures"), f.hours),
      h("div", { class: "field grow" }, h("label", { class: "label", for: "t-m" }, "Minutes"), f.minutes),
    ),
    h("div", { class: "field" }, h("label", { class: "label", for: "t-son" }, "Son d'alarme"), f.sound),
    h("div", { class: "stack", style: "--gap: 0" },
      h("label", { class: "check" }, f.alarm, "Alarme et notification Windows"),
      h("label", { class: "check" }, f.repeat, "Répéter automatiquement"),
      h("label", { class: "check" }, f.inOverlay, "Afficher dans l'overlay"),
    ),
    error,
    h("div", { class: "row" }, h("div", { class: "grow", style: "display: flex" }, submit), cancel),
  );
  submit.style.flex = "1";

  // ---------- Liste ----------
  function row(t: Timer) {
    const status = timerStatus(t);
    const alarmBtn = h("button", {
      class: "icon-btn toggle", type: "button",
      "aria-pressed": String(t.alarm),
      "aria-label": t.alarm ? `Couper l'alarme de ${t.name}` : `Activer l'alarme de ${t.name}`,
      title: t.alarm ? "Alarme activée" : "Alarme coupée",
      onclick: () => api.saveTimer({ ...toInput(t), alarm: !t.alarm }),
    }, icon("bell"));
    const playPause = status === "done"
      ? h("button", { class: "icon-btn", type: "button", "aria-label": `Relancer ${t.name}`, title: "Relancer", onclick: () => api.restartTimer(t.id) }, icon("play", 16))
      : status === "paused"
        ? h("button", { class: "icon-btn", type: "button", "aria-label": `Reprendre ${t.name}`, title: "Reprendre", onclick: () => api.resumeTimer(t.id) }, icon("play", 16))
        : h("button", { class: "icon-btn", type: "button", "aria-label": `Mettre ${t.name} en pause`, title: "Pause", onclick: () => api.pauseTimer(t.id) }, icon("pause", 16));

    const el = h("div", {
      class: `timer-row${status === "done" ? " finished" : ""}`,
      draggable: "true",
      ondragstart: (e: DragEvent) => {
        dragId = t.id;
        e.dataTransfer?.setData("text/plain", t.id);
        el.classList.add("dragging");
      },
      ondragend: () => {
        dragId = null;
        el.classList.remove("dragging");
        listBox.querySelectorAll(".drop-before").forEach((x) => x.classList.remove("drop-before"));
      },
      ondragover: (e: DragEvent) => {
        if (!dragId || dragId === t.id) return;
        e.preventDefault();
        el.classList.add("drop-before");
      },
      ondragleave: () => el.classList.remove("drop-before"),
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        el.classList.remove("drop-before");
        if (!dragId || dragId === t.id) return;
        const ids = ctx.timers().map((x) => x.id).filter((id) => id !== dragId);
        ids.splice(ids.indexOf(t.id), 0, dragId);
        // Le groupe suit celui de la ligne sur laquelle on dépose.
        const moved = ctx.timers().find((x) => x.id === dragId);
        if (moved && moved.group !== t.group) void api.saveTimer({ ...toInput(moved), group: t.group });
        void api.reorderTimers(ids);
      },
    },
      h("span", { class: "grip", title: "Glisser pour réorganiser" }, GRIP()),
      h("div", { class: "stack grow", style: "--gap: 8px; flex: 1 1 220px" },
        h("div", { class: "row wrap spread" },
          h("span", { style: "color: var(--text-strong); font-weight: 600" }, t.name),
          h("span", { class: "muted", style: "font-size: 13px" },
            [t.place, durationLabel(t.durationSecs), t.repeat ? "répétition" : "", status === "paused" ? "en pause" : ""].filter(Boolean).join(" · ")),
        ),
        h("div", { class: "bar" }, h("span", { "data-timer": t.id, "data-part": "bar" })),
      ),
      h("span", { class: "digits remaining", "data-timer": t.id, "data-part": "left" }),
      h("div", { class: "actions" },
        alarmBtn,
        playPause,
        h("button", { class: "icon-btn", type: "button", "aria-label": `Recommencer ${t.name}`, title: "Recommencer", onclick: () => api.restartTimer(t.id) }, icon("restart", 16)),
        h("button", { class: "icon-btn", type: "button", "aria-label": `Modifier ${t.name}`, title: "Modifier", onclick: () => fill(t) }, icon("edit", 16)),
        h("button", {
          class: "icon-btn", type: "button", "aria-label": `Supprimer ${t.name}`, title: "Supprimer",
          onclick: async () => {
            if (await confirmDialog(`Supprimer le minuteur « ${t.name} » ?`, "Supprimer")) {
              if (editing?.id === t.id) fill(null);
              await api.deleteTimer(t.id);
            }
          },
        }, icon("trash", 16)),
      ),
    );
    return el;
  }

  function drawList() {
    const all = ctx.timers();
    if (!all.length) {
      mount(listBox, h("div", { class: "empty" }, "Aucun minuteur. Créez-en un avec le formulaire, ou depuis un marqueur de la carte."));
      return;
    }
    mount(
      listBox,
      (Object.keys(GROUPS) as TimerGroup[]).map((g) => {
        const items = all.filter((t) => t.group === g);
        if (!items.length) return null;
        return h("section", { class: "stack", style: "--gap: 10px", "aria-label": GROUPS[g] },
          h("h2", { class: "section-title", style: "color: var(--text-soft)" }, GROUPS[g]),
          items.map(row),
        );
      }),
    );
  }

  drawList();
  mount(
    root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Alarmes et notifications Windows"), h("h1", { class: "h1" }, "Minuteurs")),
      h("span", { class: "muted" }, "Glisser-déposer pour réorganiser"),
    ),
    h("div", { class: "columns" },
      h("div", { style: "flex: 2 1 520px; min-width: 0" }, listBox),
      h("div", { class: "stack", style: "--gap: 20px; flex: 1 1 300px; min-width: 0" },
        h("section", { class: "card hot tight", "aria-labelledby": "cor-titre" },
          h("h2", { class: "section-title", id: "cor-titre", style: "color: var(--spice)" }, "Tempête de Coriolis"),
          h("span", { class: "digits", style: "font-size: 26px; color: var(--text-strong)", "data-coriolis": "" }),
          h("span", { class: "muted" }, `Chaque semaine · rappels à ${ctx.settings().coriolisReminders.map((m) => durationLabel(m * 60)).join(", ") || "aucun"}`),
        ),
        form,
      ),
    ),
  );
  if (action === "new-timer") {
    fill(null);
    f.name.focus();
  }

  return { onTimers: drawList };
}
