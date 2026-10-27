//! Mises à jour automatiques : `latest.json` de la dernière release GitHub, paquet signé (clé publique
//! dans `tauri.conf.json`). Sietch vérifie au lancement puis toutes les 6 heures et prévient en silence ;
//! l'installation ne se fait qu'à la demande (elle ferme Sietch, jamais en pleine partie sans prévenir).

use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::state::AppState;

/// Mise à jour proposée à l'interface.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
}

/// Cherche une mise à jour ; `None` si Sietch est à jour.
pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = update.map(|u| UpdateInfo { version: u.version, notes: u.body.unwrap_or_default() });
    *app.state::<AppState>().update.lock().unwrap() = info.clone();
    if let Some(i) = &info {
        let _ = app.emit("update-available", i);
    }
    Ok(info)
}

/// Télécharge, installe et relance Sietch.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Sietch est déjà à jour.")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

/// Vérification de fond : 30 s après le lancement, puis toutes les 6 heures. Pas en développement
/// (la version locale n'a rien à voir avec les releases).
pub fn spawn(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio_sleep(Duration::from_secs(30)).await;
        let mut told: Option<String> = None;
        loop {
            if let Ok(Some(info)) = check(&app).await
                && told.as_ref() != Some(&info.version)
            {
                let settings = app.state::<AppState>().settings.lock().unwrap().clone();
                crate::engine::send_alarm(
                    &app,
                    &settings,
                    crate::engine::Alarm {
                        title: format!("Sietch {} est disponible", info.version),
                        body: "Installez-la depuis Paramètres › À propos, quand vous ne jouez pas.".into(),
                    },
                );
                told = Some(info.version);
            }
            tokio_sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

async fn tokio_sleep(d: Duration) {
    // Pas de dépendance directe à tokio : une attente sur un fil à part.
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}
