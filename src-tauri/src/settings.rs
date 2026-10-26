use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Réglages de l'application, enregistrés dans `settings.json`.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Décalage de l'heure serveur par rapport à UTC, en minutes.
    pub server_offset_min: i32,
    pub server_label: String,
    /// Jour de la tempête de Coriolis, 0 = lundi … 6 = dimanche (heure serveur).
    pub coriolis_weekday: u8,
    pub coriolis_hour: u8,
    pub coriolis_minute: u8,
    /// Rappels avant la tempête, en minutes.
    pub coriolis_reminders: Vec<i64>,
    pub dnd: bool,
    pub close_to_tray: bool,
    pub start_minimized: bool,
    pub overlay_opacity: u8,
    pub overlay_click_through: bool,
    /// "top-right", "top-left", "bottom-right", "bottom-left" ou "free".
    pub overlay_position: String,
    /// Action → combinaison, ex. "overlay" → "Ctrl+Shift+O".
    pub shortcuts: BTreeMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        let shortcuts = [
            ("marker", "Ctrl+Shift+M"),
            ("timer", "Ctrl+Shift+T"),
            ("overlay", "Ctrl+Shift+O"),
            ("wiki", "Ctrl+Shift+W"),
            ("map", "Ctrl+Shift+C"),
        ]
        .into_iter()
        .map(|(a, k)| (a.to_string(), k.to_string()))
        .collect();
        Self {
            server_offset_min: 60,
            server_label: "Europe".into(),
            coriolis_weekday: 1,
            coriolis_hour: 3,
            coriolis_minute: 0,
            coriolis_reminders: vec![1440, 60, 10],
            dnd: false,
            close_to_tray: true,
            start_minimized: false,
            overlay_opacity: 85,
            overlay_click_through: false,
            overlay_position: "top-right".into(),
            shortcuts,
        }
    }
}

const DAY_MS: i64 = 86_400_000;

/// Prochaine tempête de Coriolis (ms depuis l'epoch, UTC) strictement après `now`.
pub fn next_coriolis(now: i64, s: &Settings) -> i64 {
    let offset = s.server_offset_min as i64 * 60_000;
    let local = now + offset;
    let day = local.div_euclid(DAY_MS);
    // Le 1er janvier 1970 était un jeudi : lundi = 0 donne jeudi = 3.
    let weekday = (day + 3).rem_euclid(7);
    let ahead = (s.coriolis_weekday as i64 - weekday).rem_euclid(7);
    let mut target =
        (day + ahead) * DAY_MS + (s.coriolis_hour as i64 * 60 + s.coriolis_minute as i64) * 60_000;
    if target <= local {
        target += 7 * DAY_MS;
    }
    target - offset
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coriolis_is_next_tuesday() {
        let s = Settings {
            server_offset_min: 0,
            coriolis_weekday: 1,
            coriolis_hour: 3,
            ..Default::default()
        };
        // Lundi 26 octobre 2026, 12:00 UTC.
        let monday_noon = 1_793_016_000_000;
        let next = next_coriolis(monday_noon, &s);
        assert_eq!(next - monday_noon, 15 * 3_600_000);
        // Juste après la tempête, la suivante est une semaine plus tard.
        assert_eq!(next_coriolis(next, &s) - next, 7 * DAY_MS);
    }
}
