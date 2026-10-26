//! Boucle de fond : fait avancer les minuteurs et envoie les alarmes,
//! même quand toutes les fenêtres sont masquées.

use crate::settings::{Settings, next_coriolis};
use crate::state::AppState;
use crate::timers::{Timer, now_ms};
use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Serialize)]
pub struct Alarm {
    pub title: String,
    pub body: String,
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(500));
            tick(&app);
        }
    });
}

fn tick(app: &AppHandle) {
    let state = app.state::<AppState>();
    let now = now_ms();

    let rung: Vec<Timer> = {
        let mut timers = state.timers.lock().unwrap();
        let rung: Vec<Timer> = timers.iter_mut().filter_map(|t| t.tick(now).then(|| t.clone())).collect();
        if !rung.is_empty() {
            state.save_timers(&timers);
        }
        rung
    };
    let settings = state.settings.lock().unwrap().clone();

    if !rung.is_empty() {
        let _ = app.emit("timers-changed", ());
    }
    for t in rung.iter().filter(|t| t.alarm) {
        let mut body = if t.repeat {
            format!("Le minuteur repart pour {}.", format_minutes(t.duration_secs / 60))
        } else {
            "Minuteur terminé.".to_string()
        };
        if !t.place.is_empty() {
            body = format!("{} · {body}", t.place);
        }
        send_alarm(app, &settings, Alarm { title: t.name.clone(), body });
    }

    let next = next_coriolis(now, &settings);
    let due: Vec<i64> = {
        let mut sent = state.coriolis_sent.lock().unwrap();
        settings
            .coriolis_reminders
            .iter()
            .copied()
            .filter(|&r| {
                let at = next - r * 60_000;
                now >= at && now < at + 60_000 && sent.insert((next, r))
            })
            .collect()
    };
    for r in due {
        send_alarm(
            app,
            &settings,
            Alarm {
                title: format!("Tempête de Coriolis dans {}", format_minutes(r)),
                body: "Le Désert profond va être réinitialisé. Mettez vos véhicules et vos coffres à l'abri.".into(),
            },
        );
    }
}

pub fn send_alarm(app: &AppHandle, settings: &Settings, alarm: Alarm) {
    if settings.dnd {
        return;
    }
    let _ = app.notification().builder().title(&alarm.title).body(&alarm.body).show();
    let _ = app.emit("alarm", alarm);
}

pub fn format_minutes(min: i64) -> String {
    match min {
        m if m >= 1440 && m % 1440 == 0 => format!("{} j", m / 1440),
        m if m >= 60 && m % 60 == 0 => format!("{} h", m / 60),
        m if m >= 60 => format!("{} h {:02}", m / 60, m % 60),
        m => format!("{m} min"),
    }
}
