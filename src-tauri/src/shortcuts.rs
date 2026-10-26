use crate::state::AppState;
use crate::windows;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

/// Réenregistre toutes les combinaisons des réglages.
/// Renvoie, pour chaque combinaison refusée, un message lisible.
pub fn register_all(app: &AppHandle) -> Vec<String> {
    let state = app.state::<AppState>();
    let wanted = state.settings.lock().unwrap().shortcuts.clone();
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    let mut registered = Vec::new();
    let mut errors = Vec::new();
    for (action, accel) in wanted {
        if accel.trim().is_empty() {
            continue;
        }
        match accel.parse::<Shortcut>() {
            Ok(sc) => match gs.register(sc) {
                Ok(()) => registered.push((sc, action)),
                Err(e) => errors.push(format!("{accel} : {e}")),
            },
            Err(e) => errors.push(format!("{accel} : {e}")),
        }
    }
    *state.shortcuts.lock().unwrap() = registered;
    errors
}

pub fn handle(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state() != ShortcutState::Pressed {
        return;
    }
    let action = {
        let list = app.state::<AppState>().shortcuts.lock().unwrap().clone();
        list.into_iter()
            .find(|(sc, _)| sc == shortcut)
            .map(|(_, a)| a)
    };
    if let Some(action) = action {
        run_action(app, &action);
    }
}

pub fn run_action(app: &AppHandle, action: &str) {
    match action {
        "overlay" => windows::toggle_overlay(app),
        "wiki" => windows::show_wiki(app),
        "marker" => windows::show_main(app, Some("carte"), Some("new-marker")),
        "timer" => windows::show_main(app, Some("minuteurs"), Some("new-timer")),
        "map" => windows::show_main(app, Some("carte"), None),
        _ => {}
    }
}
