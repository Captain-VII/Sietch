use crate::live::LiveStatus;
use crate::settings::Settings;
use crate::timers::Timer;
use serde::{Serialize, de::DeserializeOwned};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::Wry;
use tauri::menu::CheckMenuItem;
use tauri_plugin_global_shortcut::Shortcut;

pub struct AppState {
    pub dir: PathBuf,
    pub timers: Mutex<Vec<Timer>>,
    pub settings: Mutex<Settings>,
    /// Combinaisons enregistrées et l'action qu'elles déclenchent.
    pub shortcuts: Mutex<Vec<(Shortcut, String)>>,
    /// Rappels Coriolis déjà envoyés : (tempête, minutes avant).
    pub coriolis_sent: Mutex<HashSet<(i64, i64)>>,
    pub dnd_item: Mutex<Option<CheckMenuItem<Wry>>>,
    pub live_status: Mutex<LiveStatus>,
    /// Demande de relecture de position.json par le fil des modules.
    pub live_reload: AtomicBool,
    counter: AtomicU64,
}

impl AppState {
    pub fn load(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        Self {
            timers: Mutex::new(read_json(&dir.join("timers.json")).unwrap_or_default()),
            settings: Mutex::new(read_json(&dir.join("settings.json")).unwrap_or_default()),
            dir,
            shortcuts: Mutex::new(Vec::new()),
            coriolis_sent: Mutex::new(HashSet::new()),
            dnd_item: Mutex::new(None),
            live_status: Mutex::new(LiveStatus::default()),
            live_reload: AtomicBool::new(false),
            counter: AtomicU64::new(0),
        }
    }

    pub fn new_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        format!("t{}-{}", crate::timers::now_ms(), n)
    }

    pub fn save_timers(&self, timers: &[Timer]) {
        write_json(&self.dir.join("timers.json"), timers);
    }

    pub fn save_settings(&self, settings: &Settings) {
        write_json(&self.dir.join("settings.json"), settings);
    }
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let text = fs::read_to_string(path).ok()?;
    match serde_json::from_str(&text) {
        Ok(v) => Some(v),
        Err(e) => {
            eprintln!("Lecture impossible de {} : {e}", path.display());
            None
        }
    }
}

/// Écrit dans un fichier temporaire puis renomme, pour ne jamais laisser un fichier à moitié écrit.
fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) {
    let Ok(text) = serde_json::to_string_pretty(value) else {
        return;
    };
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, text).is_ok() {
        let _ = fs::rename(&tmp, path);
    }
}
