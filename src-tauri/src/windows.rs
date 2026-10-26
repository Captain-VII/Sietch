use crate::state::AppState;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

#[derive(Clone, Serialize)]
pub struct Navigate {
    pub view: String,
    pub action: Option<String>,
}

pub fn show_main(app: &AppHandle, view: Option<&str>, action: Option<&str>) {
    let Some(w) = app.get_webview_window("main") else { return };
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    if let Some(view) = view {
        let _ = app.emit_to(
            "main",
            "navigate",
            Navigate { view: view.into(), action: action.map(Into::into) },
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
    let Some(w) = app.get_webview_window("overlay") else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
    } else {
        apply_overlay(app, &w);
        let _ = w.show();
    }
}

/// Applique position, clic traversant et premier plan selon les réglages.
pub fn apply_overlay(app: &AppHandle, w: &WebviewWindow) {
    let settings = app.state::<AppState>().settings.lock().unwrap().clone();
    let _ = w.set_always_on_top(true);
    let _ = w.set_ignore_cursor_events(settings.overlay_click_through);
    if settings.overlay_position == "free" {
        return;
    }
    let monitor = w.current_monitor().ok().flatten().or_else(|| w.primary_monitor().ok().flatten());
    let (Some(monitor), Ok(size)) = (monitor, w.outer_size()) else { return };
    let margin = (24.0 * monitor.scale_factor()) as i32;
    let area = monitor.work_area();
    let (left, top) = (area.position.x, area.position.y);
    let right = left + area.size.width as i32 - size.width as i32 - margin;
    let bottom = top + area.size.height as i32 - size.height as i32 - margin;
    let (x, y) = match settings.overlay_position.as_str() {
        "top-left" => (left + margin, top + margin),
        "bottom-left" => (left + margin, bottom),
        "bottom-right" => (right, bottom),
        _ => (right, top + margin),
    };
    let _ = w.set_position(PhysicalPosition::new(x, y));
}
