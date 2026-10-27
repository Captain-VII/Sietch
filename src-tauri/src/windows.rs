use crate::state::AppState;
use serde::Serialize;
use std::sync::Mutex;
use std::sync::atomic::Ordering;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

#[derive(Clone, Serialize)]
pub struct Navigate {
    pub view: String,
    pub action: Option<String>,
}

pub fn show_main(app: &AppHandle, view: Option<&str>, action: Option<&str>) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    if let Some(view) = view {
        let _ = app.emit_to(
            "main",
            "navigate",
            Navigate {
                view: view.into(),
                action: action.map(Into::into),
            },
        );
    }
}

pub fn show_wiki(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("wiki") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn toggle_overlay(app: &AppHandle) {
    let state = app.state::<AppState>();
    // Masquer les widgets termine le mode édition (positions enregistrées).
    if state.widgets_on.load(Ordering::SeqCst) && state.widgets_edit.load(Ordering::SeqCst) {
        toggle_widgets_edit(app);
    }
    state.widgets_on.fetch_xor(true, Ordering::SeqCst);
    refresh_widgets(app);
}

/// Entre ou sort du mode édition des widgets. En sortant, les positions sont enregistrées
/// dans la disposition active.
pub fn toggle_widgets_edit(app: &AppHandle) {
    let state = app.state::<AppState>();
    let editing = !state.widgets_edit.fetch_xor(true, Ordering::SeqCst);
    if editing {
        state.widgets_on.store(true, Ordering::SeqCst);
        refresh_widgets(app);
    } else {
        save_widget_positions(app);
    }
    let _ = app.emit("widgets-edit", editing);
}

/// Passe à la disposition suivante et affiche ses widgets.
pub fn next_layout(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.widgets_edit.load(Ordering::SeqCst) {
        // Les positions en cours d'édition appartiennent à la disposition actuelle.
        toggle_widgets_edit(app);
    }
    let mut settings = state.settings.lock().unwrap().clone();
    settings.active_layout = settings.next_layout();
    state.widgets_on.store(true, Ordering::SeqCst);
    crate::set_settings(app.clone(), state, settings);
}

fn save_widget_positions(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut settings = state.settings.lock().unwrap().clone();
    let active = settings.active_layout.clone();
    let Some(layout) = settings.layouts.iter_mut().find(|l| l.id == active) else {
        return;
    };
    for w in &mut layout.widgets {
        let Some(win) = app.get_webview_window(&format!("widget-{}", w.kind)) else {
            continue;
        };
        if let (Ok(p), Ok(f)) = (win.outer_position(), win.scale_factor()) {
            let p = p.to_logical::<f64>(f);
            w.pos = Some([p.x.round() as i32, p.y.round() as i32]);
        }
    }
    // Enregistre, prévient les fenêtres et remet les widgets en mode verrouillé.
    crate::set_settings(app.clone(), state, settings);
}

/// Taille de base (logique) de chaque widget, avant l'échelle choisie.
fn widget_size(kind: &str) -> (f64, f64) {
    match kind {
        "timers" => (250.0, 170.0),
        "sector" => (250.0, 64.0),
        "coriolis" => (210.0, 64.0),
        "minimap" => (200.0, 200.0),
        "gauges" => (300.0, 70.0),
        "health" | "stamina" | "hydration" | "power" | "inventory" => (230.0, 52.0),
        _ => (180.0, 64.0),
    }
}

/// Ouvre, place ou ferme les fenêtres des widgets selon la disposition active.
/// Passe par une tâche de fond : créer une fenêtre depuis le fil principal (commande synchrone,
/// raccourci) la laisserait blanche sous Windows.
pub fn refresh_widgets(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { apply_widgets(&app) });
}

fn apply_widgets(app: &AppHandle) {
    // Deux mises à jour en même temps créeraient deux fois la même fenêtre.
    static BUSY: Mutex<()> = Mutex::new(());
    let _guard = BUSY.lock().unwrap();
    let state = app.state::<AppState>();
    let on = state.widgets_on.load(Ordering::SeqCst);
    let editing = state.widgets_edit.load(Ordering::SeqCst);
    let settings = state.settings.lock().unwrap().clone();
    let Some(layout) = settings.layouts.iter().find(|l| l.id == settings.active_layout) else {
        return;
    };
    // Placement automatique : en colonne, en haut à droite de l'écran principal.
    let area = app.primary_monitor().ok().flatten().map(|m| {
        let area = m.work_area();
        let size = area.size.to_logical::<f64>(m.scale_factor());
        let p = area.position.to_logical::<f64>(m.scale_factor());
        (p.x, p.y, size.width)
    });
    let mut next_y = 24.0;
    for w in &layout.widgets {
        let label = format!("widget-{}", w.kind);
        let existing = app.get_webview_window(&label);
        if !(on && w.shown) {
            if let Some(win) = existing {
                let _ = win.destroy();
            }
            continue;
        }
        let (bw, bh) = widget_size(&w.kind);
        let (width, height) = (bw * w.scale, bh * w.scale);
        let (x, y) = match (w.pos, area) {
            (Some([x, y]), _) => (x as f64, y as f64),
            (None, Some((left, top, aw))) => {
                let pos = (left + aw - width - 24.0, top + next_y);
                next_y += height + 10.0;
                pos
            }
            (None, None) => (24.0, 24.0),
        };
        let win = match existing {
            Some(win) => {
                let _ = win.set_size(LogicalSize::new(width, height));
                // En édition, la fenêtre est là où la souris l'a posée : la position enregistrée est
                // ancienne (elle ne l'est qu'en sortant du mode édition).
                if !editing {
                    let _ = win.set_position(LogicalPosition::new(x, y));
                }
                win
            }
            None => {
                let url = WebviewUrl::App(format!("widget.html?kind={}", w.kind).into());
                let built = WebviewWindowBuilder::new(app, &label, url)
                    .title("Sietch — Widget")
                    .inner_size(width, height)
                    .position(x, y)
                    .decorations(false)
                    .transparent(true)
                    .shadow(false)
                    .resizable(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    // Ne jamais prendre le focus au jeu.
                    .focused(false)
                    .focusable(false)
                    .build();
                match built {
                    Ok(win) => {
                        no_activate(&win);
                        win
                    }
                    Err(_) => continue,
                }
            }
        };
        let _ = win.set_ignore_cursor_events(!editing && settings.overlay_click_through);
    }
}

/// Un clic sur le widget (mode édition) ne doit pas l'activer : le jeu garderait sinon le focus perdu.
/// `focusable(false)` ne suffit pas sous Windows, d'où `WS_EX_NOACTIVATE`.
#[cfg(windows)]
fn no_activate(win: &WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, SetWindowLongPtrW, WS_EX_NOACTIVATE,
    };
    if let Ok(hwnd) = win.hwnd() {
        let hwnd = hwnd.0 as _;
        // SAFETY : fenêtre valide qui appartient à ce processus ; on n'ajoute qu'un style étendu.
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_NOACTIVATE as isize);
        }
    }
}

#[cfg(not(windows))]
fn no_activate(_: &WebviewWindow) {}

/// Sites que Sietch peut ouvrir dans sa fenêtre de navigation.
const SITES: [&str; 2] = ["awakening.wiki", "dune.gaming.tools"];

/// Ouvre une page d'un site autorisé dans la fenêtre « web » (créée au besoin).
/// Cette fenêtre n'a accès à aucune commande de Sietch.
pub fn open_site(app: &AppHandle, url: &str) -> Result<(), String> {
    let url = Url::parse(url).map_err(|e| e.to_string())?;
    if url.scheme() != "https" || !url.host_str().is_some_and(|h| SITES.contains(&h)) {
        return Err("Site non autorisé".into());
    }
    if let Some(w) = app.get_webview_window("web") {
        w.navigate(url).map_err(|e| e.to_string())?;
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "web", WebviewUrl::External(url))
        .title("Sietch — Navigateur")
        .inner_size(1280.0, 860.0)
        .min_inner_size(640.0, 480.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
