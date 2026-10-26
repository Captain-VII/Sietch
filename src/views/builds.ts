import type { Ctx, ViewHandle } from "../main";
import {
  BUILD_TAGS, builds as store, decodeBuild, encodeBuild, newBuild, SCHOOLS, SLOTS,
  type Build, type BuildTag,
} from "../lib/data";
import { confirmDialog, h, icon, mount, toast } from "../lib/dom";

export function render(root: HTMLElement, _ctx: Ctx, action?: string | null): ViewHandle {
  let list: Build[] = [];
  let current: Build | null = null;
  let saveTimer = 0;

  const listBox = h("div", { class: "stack", style: "--gap: 8px" });
  const editor = h("div", { class: "columns", style: "flex: 4 1 700px; min-width: 0" });
  const savedHint = h("span", { class: "muted", "aria-live": "polite" });

  /** Enregistre peu après la dernière modification. */
  function touch() {
    if (!current) return;
    savedHint.textContent = "Modifications…";
    clearTimeout(saveTimer);
    const b = current;
    saveTimer = window.setTimeout(async () => {
      saveTimer = 0;
      await store.save(b);
      list = await store.all();
      savedHint.textContent = "Enregistré";
      drawList();
    }, 400);
  }

  // Recherche (nom, équipement, notes) et filtre par usage.
  const search = h("input", { class: "input search", type: "search", placeholder: "Chercher un build, une pièce…", "aria-label": "Chercher dans les builds" });
  const tagFilter = h("select", { class: "select", "aria-label": "Filtrer par usage" },
    h("option", { value: "" }, "Tous les usages"),
    (Object.keys(BUILD_TAGS) as BuildTag[]).map((t) => h("option", { value: t }, t)));
  const filters = h("div", { class: "stack", style: "--gap: 8px" }, search, tagFilter);
  search.addEventListener("input", () => drawList());
  tagFilter.addEventListener("change", () => drawList());
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  function drawList() {
    // Recherche et filtre utiles à partir de quelques builds seulement.
    filters.hidden = list.length < 4;
    const q = fold(search.value.trim());
    const shown = list.filter((b) =>
      (!tagFilter.value || b.tag === tagFilter.value)
      && (!q || fold([b.name, b.notes, ...Object.values(b.slots)].join(" ")).includes(q)));
    mount(
      listBox,
      list.length && !shown.length ? h("div", { class: "empty" }, "Aucun build ne correspond.") : null,
      list.length
        ? shown.map((b) =>
            h("button", {
              class: "pick", type: "button", "aria-pressed": String(b.id === current?.id),
              onclick: () => {
                current = list.find((x) => x.id === b.id) ?? null;
                drawList();
                drawEditor();
              },
            },
              h("span", { class: "title" }, b.name),
              h("span", { class: "row", style: "--gap: 8px" },
                h("span", { class: "tag", style: `color: ${BUILD_TAGS[b.tag]}` }, b.tag),
                h("span", { class: "muted", style: "font-size: 13px" }, new Date(b.updatedAt).toLocaleDateString("fr-FR"))),
            ),
          )
        : h("div", { class: "empty" }, "Aucun build. Créez-en un ou importez un code de partage."),
    );
  }

  function drawEditor() {
    if (!current) {
      mount(editor, h("div", { class: "empty", style: "flex: 1" }, "Choisissez un build dans la liste."));
      return;
    }
    const b = current;
    const name = h("input", { class: "input", id: "b-nom", type: "text", maxlength: "80", value: b.name, style: "font-family: var(--font-display); font-size: 16px; letter-spacing: 0.06em" });
    name.addEventListener("input", () => {
      b.name = name.value.trim() || "Sans nom";
      touch();
    });
    const tag = h("select", { class: "select", id: "b-tag", style: "width: 160px" },
      (Object.keys(BUILD_TAGS) as BuildTag[]).map((t) => h("option", { value: t, selected: t === b.tag }, t)));
    tag.addEventListener("change", () => {
      b.tag = tag.value as BuildTag;
      touch();
    });
    const code = encodeBuild(b);
    const codeEl = h("code", { title: code }, code);

    const slots = SLOTS.map((slot, i) => {
      const input = h("input", { class: "input", id: `slot-${i}`, type: "text", maxlength: "80", value: b.slots[slot] ?? "", placeholder: "Vide" });
      input.addEventListener("input", () => {
        b.slots[slot] = input.value;
        codeEl.textContent = encodeBuild(b);
        touch();
      });
      return h("div", { class: "slot" }, h("label", { class: "label", for: `slot-${i}`, style: "font-family: var(--font-label); font-weight: 600; letter-spacing: 0.2em; font-size: 12px" }, slot), input);
    });

    const schools = SCHOOLS.map((school) => {
      const value = h("span", { class: "digits", style: "font-size: 13px" });
      const pips = h("div", { class: "pips", role: "group", "aria-label": `Investissement ${school}` });
      const draw = () => {
        const v = b.schools[school] ?? 0;
        value.textContent = `${v} / 10`;
        mount(pips, Array.from({ length: 10 }, (_, j) =>
          h("button", {
            type: "button", class: j < v ? "on" : "",
            "aria-label": `${school} : ${j + 1}`, "aria-pressed": String(j < v),
            onclick: () => {
              b.schools[school] = v === j + 1 ? j : j + 1;
              draw();
              codeEl.textContent = encodeBuild(b);
              touch();
            },
          })));
      };
      draw();
      return h("div", { class: "stack", style: "--gap: 8px" }, h("div", { class: "row spread" }, h("span", {}, school), value), pips);
    });

    const notes = h("textarea", { class: "textarea", id: "b-notes", rows: "5", maxlength: "4000", placeholder: "Rotation, consommables, conseils…" });
    notes.value = b.notes;
    notes.addEventListener("input", () => {
      b.notes = notes.value;
      touch();
    });

    mount(
      editor,
      h("section", { class: "card", style: "flex: 2 1 420px", "aria-label": "Équipement" },
        h("div", { class: "row wrap" },
          h("div", { class: "field grow", style: "flex: 1 1 240px" }, h("label", { class: "label", for: "b-nom" }, "Nom du build"), name),
          h("div", { class: "field" }, h("label", { class: "label", for: "b-tag" }, "Usage"), tag),
        ),
        h("div", { class: "slots" }, slots),
        h("div", { class: "share-box" },
          h("span", { class: "label" }, "Code de partage"),
          codeEl,
          h("button", {
            class: "btn", type: "button",
            onclick: async () => {
              await navigator.clipboard.writeText(encodeBuild(b));
              toast("Code copié", "Collez-le à un ami : il l'importe depuis l'écran Builds.");
            },
          }, icon("copy", 16), "Copier"),
        ),
        h("div", { class: "row wrap spread" },
          savedHint,
          h("div", { class: "row" },
            h("button", {
              class: "btn", type: "button",
              onclick: async () => {
                const copy: Build = { ...structuredClone(b), id: newBuild().id, name: `${b.name} (copie)` };
                await store.save(copy);
                list = await store.all();
                current = list.find((x) => x.id === copy.id) ?? null;
                drawList();
                drawEditor();
              },
            }, "Dupliquer"),
            h("button", {
              class: "btn btn-danger", type: "button",
              onclick: async () => {
                if (!(await confirmDialog(`Supprimer le build « ${b.name} » ?`, "Supprimer"))) return;
                clearTimeout(saveTimer);
                await store.remove(b.id);
                list = await store.all();
                current = list[0] ?? null;
                drawList();
                drawEditor();
              },
            }, "Supprimer"),
          ),
        ),
      ),
      h("section", { class: "card", style: "flex: 1 1 280px", "aria-labelledby": "sk-titre" },
        h("h2", { class: "section-title", id: "sk-titre" }, "Écoles de compétences"),
        h("p", { class: "muted", style: "margin: 0" }, "Niveau d'investissement de 0 à 10, pour comparer vos builds."),
        schools,
        h("div", { class: "field" }, h("label", { class: "label", for: "b-notes" }, "Notes du build"), notes),
      ),
    );
  }

  async function create() {
    const b = newBuild();
    await store.save(b);
    list = await store.all();
    current = list.find((x) => x.id === b.id) ?? null;
    drawList();
    drawEditor();
    document.getElementById("b-nom")?.focus();
  }

  function importCode() {
    const input = h("input", { class: "input", id: "code-import", type: "text", placeholder: "SIETCH1-…" });
    const err = h("p", { class: "form-error", role: "alert", style: "margin: 0" });
    const dlg = h("dialog", { class: "dialog" });
    mount(dlg,
      h("form", {
        class: "stack", style: "--gap: 16px", method: "dialog",
        onsubmit: async (e: Event) => {
          e.preventDefault();
          try {
            const b = decodeBuild(input.value);
            await store.save(b);
            list = await store.all();
            current = list.find((x) => x.id === b.id) ?? null;
            drawList();
            drawEditor();
            dlg.close();
            dlg.remove();
            toast("Build importé", b.name);
          } catch (x) {
            err.textContent = x instanceof Error && x.message.startsWith("Ce n'est") ? x.message : "Code illisible : vérifiez qu'il est complet.";
          }
        },
      },
        h("h2", { class: "section-title" }, "Importer un build"),
        h("div", { class: "field" }, h("label", { class: "label", for: "code-import" }, "Code de partage"), input),
        err,
        h("div", { class: "row", style: "justify-content: flex-end" },
          h("button", { class: "btn", type: "button", onclick: () => { dlg.close(); dlg.remove(); } }, "Annuler"),
          h("button", { class: "btn btn-primary", type: "submit" }, "Importer"),
        ),
      ));
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  mount(
    root,
    h("header", { class: "page-head" },
      h("div", { class: "titles" }, h("span", { class: "eyebrow" }, "Équipement et compétences"), h("h1", { class: "h1" }, "Builds")),
      h("div", { class: "row wrap" },
        h("button", { class: "btn", type: "button", onclick: importCode }, "Importer un code"),
        h("button", { class: "btn btn-primary", type: "button", onclick: create }, icon("plus", 16), "Nouveau build"),
      ),
    ),
    h("div", { class: "columns" },
      h("section", { class: "stack", style: "--gap: 8px; flex: 1 1 240px; min-width: 0", "aria-label": "Mes builds" }, filters, listBox),
      editor),
  );

  void store.all().then((l) => {
    list = l;
    current = list.find((b) => b.id === action) ?? list[0] ?? null;
    drawList();
    drawEditor();
  });

  return {
    dispose: () => {
      // Enregistre tout de suite une modification en attente.
      if (saveTimer && current) {
        clearTimeout(saveTimer);
        void store.save(current);
      }
    },
  };
}
