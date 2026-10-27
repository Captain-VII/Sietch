mod alerts;
mod engine;
mod live;
mod settings;
mod shortcuts;
mod state;
mod timers;
mod tray;
mod ue;
mod windows;

use serde::Serialize;
use settings::{Settings, next_coriolis};
use state::AppState;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use timers::{Timer, TimerInput, now_ms};

type CmdResult<T> = Result<T, String>;

// ---------- Minuteurs ----------

#[tauri::command]
fn get_timers(state: State<AppState>) -> Vec<Timer> {
    state.timers.lock().unwrap().clone()
}

/// Modifie `id` avec `f`, enregistre et prévient toutes les fenêtres.
fn with_timer(app: &AppHandle, id: &str, f: impl FnOnce(&mut Timer)) -> CmdResult<()> {
    let state = app.state::<AppState>();
    let mut timers = state.timers.lock().unwrap();
    let t = timers
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or("Minuteur introuvable")?;
    f(t);
    state.save_timers(&timers);
    drop(timers);
    let _ = app.emit("timers-changed", ());
    Ok(())
}

#[tauri::command]
fn save_timer(app: AppHandle, state: State<AppState>, timer: TimerInput) -> CmdResult<String> {
    if timer.name.trim().is_empty() {
        return Err("Donnez un nom au minuteur.".into());
    }
    if timer.duration_secs <= 0 {
        return Err("La durée doit être supérieure à zéro.".into());
    }
    let id = match timer.id.clone() {
        Some(id) => {
            with_timer(&app, &id, |t| t.apply(timer))?;
            id
        }
        None => {
            let id = state.new_id();
            let mut timers = state.timers.lock().unwrap();
            timers.push(Timer::start(timer, id.clone()));
            state.save_timers(&timers);
            drop(timers);
            let _ = app.emit("timers-changed", ());
            id
        }
    };
    Ok(id)
}

#[tauri::command]
fn delete_timer(app: AppHandle, state: State<AppState>, id: String) {
    let mut timers = state.timers.lock().unwrap();
    timers.retain(|t| t.id != id);
    state.save_timers(&timers);
    drop(timers);
    let _ = app.emit("timers-changed", ());
}

#[tauri::command]
fn pause_timer(app: AppHandle, id: String) -> CmdResult<()> {
    with_timer(&app, &id, Timer::pause)
}

#[tauri::command]
fn resume_timer(app: AppHandle, id: String) -> CmdResult<()> {
    with_timer(&app, &id, Timer::resume)
}

#[tauri::command]
fn restart_timer(app: AppHandle, id: String) -> CmdResult<()> {
    with_timer(&app, &id, Timer::restart)
}

/// Raccourci : relance le dernier minuteur terminé, sans ouvrir Sietch (après une récolte, par exemple).
pub(crate) fn restart_last_fired(app: &AppHandle) {
    let state = app.state::<AppState>();
    let name = {
        let mut timers = state.timers.lock().unwrap();
        timers::last_fired(&timers).map(|i| {
            timers[i].restart();
            let name = timers[i].name.clone();
            state.save_timers(&timers);
            name
        })
    };
    let settings = state.settings.lock().unwrap().clone();
    let alarm = match name {
        Some(name) => {
            let _ = app.emit("timers-changed", ());
            engine::Alarm { title: format!("{name} relancé"), body: "Le minuteur repart de zéro.".into() }
        }
        None => engine::Alarm { title: "Aucun minuteur terminé".into(), body: "Rien à relancer pour l'instant.".into() },
    };
    engine::send_alarm(app, &settings, alarm);
}

/// Remet les minuteurs dans l'ordre donné ; les identifiants inconnus sont ignorés.
#[tauri::command]
fn reorder_timers(app: AppHandle, state: State<AppState>, ids: Vec<String>) {
    let mut timers = state.timers.lock().unwrap();
    timers.sort_by_key(|t| ids.iter().position(|id| id == &t.id).unwrap_or(usize::MAX));
    state.save_timers(&timers);
    drop(timers);
    let _ = app.emit("timers-changed", ());
}

// ---------- Réglages et horloge ----------

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

/// Enregistre les réglages ; renvoie les raccourcis qui n'ont pas pu être enregistrés.
#[tauri::command]
fn set_settings(app: AppHandle, state: State<AppState>, mut settings: Settings) -> Vec<String> {
    settings.normalize();
    let dnd = settings.dnd;
    state.save_settings(&settings);
    *state.settings.lock().unwrap() = settings.clone();
    if let Some(item) = state.dnd_item.lock().unwrap().as_ref() {
        let _ = item.set_checked(dnd);
    }
    let errors = shortcuts::register_all(&app);
    windows::refresh_widgets(&app);
    let _ = app.emit("settings-changed", settings);
    errors
}

pub(crate) fn set_dnd_inner(app: &AppHandle, on: bool) {
    let state = app.state::<AppState>();
    let mut settings = state.settings.lock().unwrap().clone();
    settings.dnd = on;
    set_settings(app.clone(), state, settings);
}

#[tauri::command]
fn set_dnd(app: AppHandle, on: bool) {
    set_dnd_inner(&app, on);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Clock {
    now: i64,
    server_offset_min: i32,
    coriolis_next: i64,
}

#[tauri::command]
fn get_clock(state: State<AppState>) -> Clock {
    let s = state.settings.lock().unwrap();
    let now = now_ms();
    Clock {
        now,
        server_offset_min: s.server_offset_min,
        coriolis_next: next_coriolis(now, &s),
    }
}

// ---------- Fenêtres ----------

#[tauri::command]
fn toggle_overlay(app: AppHandle) {
    windows::toggle_overlay(&app);
}

#[tauri::command]
fn toggle_widgets_edit(app: AppHandle) {
    windows::toggle_widgets_edit(&app);
}

#[tauri::command]
fn get_widgets_edit(state: State<AppState>) -> bool {
    state.widgets_edit.load(std::sync::atomic::Ordering::SeqCst)
}

#[tauri::command]
fn show_wiki(app: AppHandle) {
    windows::show_wiki(&app);
}

#[tauri::command]
fn show_main(app: AppHandle, view: Option<String>) {
    windows::show_main(&app, view.as_deref(), None);
}

#[tauri::command]
fn get_live_status(state: State<AppState>) -> live::LiveStatus {
    state.live_status.lock().unwrap().clone()
}

#[tauri::command]
fn get_player_state(state: State<AppState>) -> Option<ue::PlayerState> {
    state.player_state.lock().unwrap().clone()
}

// ---------- Fond de carte : capture de la carte du jeu par l'utilisateur ----------

/// Type d'image d'après ses premiers octets (PNG, JPEG, WebP), sinon `None`.
fn image_mime(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if b.starts_with(&[0xFF, 0xD8]) {
        Some("image/jpeg")
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn base64(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for (i, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            out.push(if i <= c.len() { T[(n >> shift & 63) as usize] as char } else { '=' });
        }
    }
    out
}

fn map_image_path(state: &AppState, region: &str) -> Result<std::path::PathBuf, String> {
    if region.is_empty() || !region.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("région invalide".into());
    }
    Ok(state.dir.join("cartes").join(region))
}

/// Copie la capture choisie dans le dossier de Sietch ; renvoie l'image en data URL.
#[tauri::command]
fn import_map_image(state: State<AppState>, region: String, path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mime = image_mime(&bytes).ok_or("image PNG, JPEG ou WebP attendue")?;
    let dest = map_image_path(&state, &region)?;
    std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", base64(&bytes)))
}

#[tauri::command]
fn get_map_image(state: State<AppState>, region: String) -> Option<String> {
    let bytes = std::fs::read(map_image_path(&state, &region).ok()?).ok()?;
    Some(format!("data:{};base64,{}", image_mime(&bytes)?, base64(&bytes)))
}

#[tauri::command]
fn remove_map_image(state: State<AppState>, region: String) -> Result<(), String> {
    let _ = std::fs::remove_file(map_image_path(&state, &region)?);
    Ok(())
}

#[tauri::command]
fn get_map_data(state: State<AppState>) -> Option<ue::MapData> {
    state.map_data.lock().unwrap().clone()
}

/// Demande une relecture de tous les attributs et renvoie la dernière lecture.
#[tauri::command]
fn request_raw_stats(state: State<AppState>) -> Vec<ue::RawStat> {
    state.raw_wanted.store(true, std::sync::atomic::Ordering::Relaxed);
    state.raw_stats.lock().unwrap().clone()
}

/// Relit position.json et renvoie son chemin, pour l'afficher dans les réglages.
#[tauri::command]
fn reload_live_config(app: AppHandle, state: State<AppState>) -> String {
    state.live_reload.store(true, std::sync::atomic::Ordering::Relaxed);
    live::config_path(&app).display().to_string()
}

/// `async` obligatoire : une fenêtre créée depuis une commande synchrone reste blanche sous Windows.
#[tauri::command]
async fn open_site(app: AppHandle, url: String) -> CmdResult<()> {
    windows::open_site(&app, &url)
}

#[tauri::command]
fn test_alarm(app: AppHandle, state: State<AppState>) {
    let mut settings = state.settings.lock().unwrap().clone();
    settings.dnd = false;
    engine::send_alarm(
        &app,
        &settings,
        engine::Alarm {
            title: "Test d'alarme".into(),
            body: "Les notifications de Sietch fonctionnent.".into(),
        },
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_main(app, None, None);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--minimized"])
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(shortcuts::handle)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(AppState::load(dir));
            // Fenêtres créées après manage() (create: false dans la config) : en release, les pages
            // embarquées appellent les commandes avant la fin de setup sinon.
            for cfg in app.config().app.windows.clone() {
                tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?.build()?;
            }
            let handle = app.handle().clone();
            tray::create(&handle)?;
            // L'overlay s'affiche dès le lancement de Sietch.
            windows::refresh_widgets(&handle);
            for e in shortcuts::register_all(&handle) {
                eprintln!("Raccourci refusé — {e}");
            }
            engine::spawn(handle.clone());
            live::spawn(handle.clone());

            let minimized = std::env::args().any(|a| a == "--minimized")
                || handle
                    .state::<AppState>()
                    .settings
                    .lock()
                    .unwrap()
                    .start_minimized;
            // En développement, l'appli redémarre à chaque modification du Rust : la fenêtre principale
            // reste cachée pour ne pas prendre le focus au jeu (zone de notification pour l'ouvrir).
            if !minimized && !cfg!(debug_assertions) {
                windows::show_main(&handle, None, None);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let to_tray = window.label() != "main"
                    || window
                        .app_handle()
                        .state::<AppState>()
                        .settings
                        .lock()
                        .unwrap()
                        .close_to_tray;
                if to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_timers,
            save_timer,
            delete_timer,
            pause_timer,
            resume_timer,
            restart_timer,
            reorder_timers,
            get_settings,
            set_settings,
            set_dnd,
            get_clock,
            toggle_overlay,
            toggle_widgets_edit,
            get_widgets_edit,
            get_player_state,
            request_raw_stats,
            get_map_data,
            import_map_image,
            get_map_image,
            remove_map_image,
            show_wiki,
            show_main,
            open_site,
            get_live_status,
            reload_live_config,
            test_alarm,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Sietch");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_map_images() {
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"M"), "TQ==");
        assert_eq!(image_mime(&[0x89, b'P', b'N', b'G', 0]), Some("image/png"));
        assert_eq!(image_mime(b"pas une image"), None);
    }
}
