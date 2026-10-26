import logoUrl from "../assets/logo.png";
import logoSmallUrl from "../assets/logo-small.png";

export type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown>;

/** Crée un élément : `h("button", { class: "btn", onclick: fn }, "Texte")`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "class") {
      el.className = String(value);
    } else if (key === "value" || key === "checked" || key === "selected") {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

function append(parent: Node, children: Child[]) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Remplace tout le contenu d'un élément. */
export function mount(el: Element, ...children: Child[]) {
  el.replaceChildren();
  append(el, children);
}

const ICONS: Record<string, string> = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  restart: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>',
  pin: '<path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  external: '<path d="M14 4h6v6M20 4l-8 8M18 14v6H4V6h6"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

/** Icône en trait, couleur du texte. Décorative par défaut. */
export function icon(name: keyof typeof ICONS | string, size = 18): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] ?? "";
  return svg;
}

/** Le logo de Sietch : un ver des sables qui jaillit devant la lune. Décoratif.
 *  En dessous de 28 px, la version plate, plus lisible que l'illustration. */
export function logo(size = 34): HTMLImageElement {
  return h("img", { src: size < 28 ? logoSmallUrl : logoUrl, width: String(size), height: String(size), alt: "", "aria-hidden": "true", style: "display: block; flex: 0 0 auto" });
}

/** Petite notification dans la fenêtre (erreurs, confirmations). */
export function toast(title: string, body = "") {
  let zone = document.querySelector(".toast-zone");
  if (!zone) {
    zone = h("div", { class: "toast-zone", role: "status", "aria-live": "polite" });
    document.body.appendChild(zone);
  }
  const el = h("div", { class: "toast" }, h("strong", {}, title), body);
  zone.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/** Demande une confirmation avec une vraie boîte de dialogue accessible. */
export function confirmDialog(message: string, confirmLabel = "Confirmer"): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = h("dialog", { class: "dialog" });
    const done = (v: boolean) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    mount(
      dlg,
      h("div", { class: "stack", style: "--gap: 20px" },
        h("p", { class: "prose" }, message),
        h("div", { class: "row", style: "justify-content: flex-end" },
          h("button", { class: "btn", type: "button", onclick: () => done(false) }, "Annuler"),
          h("button", { class: "btn btn-danger", type: "button", onclick: () => done(true) }, confirmLabel),
        ),
      ),
    );
    dlg.addEventListener("cancel", () => resolve(false));
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}
