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
    /// Widgets verrouillés : les clics passent à travers, vers le jeu.
    pub overlay_click_through: bool,
    /// Action → combinaison, ex. "overlay" → "Ctrl+Shift+O".
    pub shortcuts: BTreeMap<String, String>,
    /// Modules sans BattlEye (position en direct). Désactivés par défaut.
    pub live_modules: bool,
    /// Région où se trouve le joueur : "hagga" ou "profond".
    pub live_region: String,
    /// Points de calibration par région : coordonnées du jeu ↔ position sur la carte.
    pub calibration: BTreeMap<String, Vec<CalibrationPoint>>,
    /// Dispositions de widgets de l'overlay ; il en reste toujours au moins une.
    pub layouts: Vec<Layout>,
    /// Identifiant de la disposition affichée.
    pub active_layout: String,
}

/// Éléments qu'un widget peut afficher.
pub const WIDGET_KINDS: [&str; 4] = ["clock", "coriolis", "sector", "timers"];

/// Une disposition : un ensemble de widgets placés à l'écran.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Layout {
    pub id: String,
    pub name: String,
    pub widgets: Vec<Widget>,
}

impl Default for Layout {
    fn default() -> Self {
        Self {
            id: "exploration".into(),
            name: "Exploration".into(),
            widgets: WIDGET_KINDS.iter().map(|k| Widget::new(k)).collect(),
        }
    }
}

/// Un widget de l'overlay : une petite fenêtre à part.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Widget {
    /// Un des `WIDGET_KINDS`.
    pub kind: String,
    /// Affiché ou non ; la position est gardée quand on le décoche.
    pub shown: bool,
    /// Coin haut gauche à l'écran, en pixels logiques. `None` : placé automatiquement.
    pub pos: Option<[i32; 2]>,
    /// Échelle, de 0.5 à 2.
    pub scale: f64,
    /// Opacité du widget, de 20 à 100.
    pub opacity: u8,
}

impl Widget {
    pub fn new(kind: &str) -> Self {
        Self { kind: kind.into(), ..Default::default() }
    }
}

impl Default for Widget {
    fn default() -> Self {
        Self { kind: String::new(), shown: true, pos: None, scale: 1.0, opacity: 100 }
    }
}

impl Settings {
    /// Remet les dispositions en ordre après un chargement ou une modification depuis l'interface :
    /// au moins une disposition, identifiants uniques, un widget par élément connu, valeurs bornées,
    /// disposition active existante.
    pub fn normalize(&mut self) {
        let mut seen = std::collections::BTreeSet::new();
        self.layouts.retain_mut(|l| {
            if l.id.trim().is_empty() || !seen.insert(l.id.clone()) {
                return false;
            }
            if l.name.trim().is_empty() {
                l.name = l.id.clone();
            }
            let mut widgets = Vec::new();
            for kind in WIDGET_KINDS {
                let mut w = l.widgets.iter().find(|w| w.kind == kind).cloned().unwrap_or_else(|| {
                    // Élément ajouté dans une version plus récente : décoché dans les dispositions existantes.
                    Widget { shown: false, ..Widget::new(kind) }
                });
                w.scale = if w.scale.is_finite() { w.scale.clamp(0.5, 2.0) } else { 1.0 };
                w.opacity = w.opacity.clamp(20, 100);
                widgets.push(w);
            }
            l.widgets = widgets;
            true
        });
        if self.layouts.is_empty() {
            self.layouts.push(Layout::default());
        }
        if !self.layouts.iter().any(|l| l.id == self.active_layout) {
            self.active_layout = self.layouts[0].id.clone();
        }
        // Action ajoutée dans une version plus récente : elle reçoit sa combinaison par défaut.
        // Une combinaison vidée par l'utilisateur reste vide.
        for (action, accel) in DEFAULT_SHORTCUTS {
            self.shortcuts.entry(action.into()).or_insert_with(|| accel.into());
        }
    }
}

impl Settings {
    /// Identifiant de la disposition qui suit l'active (on revient à la première après la dernière).
    pub fn next_layout(&self) -> String {
        let i = self.layouts.iter().position(|l| l.id == self.active_layout).unwrap_or(0);
        self.layouts[(i + 1) % self.layouts.len()].id.clone()
    }
}

/// Raccourcis globaux par défaut : action → combinaison.
pub const DEFAULT_SHORTCUTS: [(&str, &str); 7] = [
    ("marker", "Ctrl+Shift+M"),
    ("timer", "Ctrl+Shift+T"),
    ("overlay", "Ctrl+Shift+O"),
    ("overlay-edit", "Ctrl+Shift+L"),
    ("overlay-next", "Ctrl+Shift+N"),
    ("wiki", "Ctrl+Shift+W"),
    ("map", "Ctrl+Shift+C"),
];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationPoint {
    pub wx: f64,
    pub wy: f64,
    pub mx: f64,
    pub my: f64,
}

impl Default for Settings {
    fn default() -> Self {
        let shortcuts = DEFAULT_SHORTCUTS
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
            overlay_click_through: false,
            shortcuts,
            live_modules: false,
            live_region: "hagga".into(),
            calibration: BTreeMap::new(),
            layouts: vec![Layout::default()],
            active_layout: "exploration".into(),
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

    #[test]
    fn old_settings_get_a_default_layout() {
        // settings.json d'avant les dispositions : aucun champ `layouts`.
        let mut s: Settings = serde_json::from_str(r#"{"serverLabel":"Europe"}"#).unwrap();
        s.normalize();
        assert_eq!(s.layouts, vec![Layout::default()]);
        assert_eq!(s.active_layout, "exploration");
    }

    #[test]
    fn normalize_repairs_layouts() {
        let mut s = Settings {
            layouts: vec![
                Layout {
                    id: "combat".into(),
                    name: " ".into(),
                    widgets: vec![
                        Widget { scale: 9.0, opacity: 0, pos: Some([10, 20]), ..Widget::new("timers") },
                        Widget::new("timers"),
                        Widget::new("inconnu"),
                    ],
                },
                Layout { id: "combat".into(), ..Layout::default() },
                Layout { id: "".into(), ..Layout::default() },
            ],
            active_layout: "disparue".into(),
            ..Default::default()
        };
        s.normalize();
        assert_eq!(s.layouts.len(), 1, "doublon et identifiant vide retirés");
        let l = &s.layouts[0];
        assert_eq!(l.name, "combat");
        let kinds: Vec<_> = l.widgets.iter().map(|w| w.kind.as_str()).collect();
        assert_eq!(kinds, WIDGET_KINDS);
        let timers = &l.widgets[3];
        assert_eq!((timers.scale, timers.opacity, timers.pos), (2.0, 20, Some([10, 20])));
        assert!(!l.widgets[0].shown, "élément absent : ajouté décoché");
        assert_eq!(s.active_layout, "combat");

        s.layouts.clear();
        s.normalize();
        assert_eq!(s.layouts, vec![Layout::default()]);
    }

    #[test]
    fn normalize_adds_new_shortcuts_only() {
        let mut s: Settings =
            serde_json::from_str(r#"{"shortcuts":{"overlay":"Ctrl+Alt+O","wiki":""}}"#).unwrap();
        s.normalize();
        assert_eq!(s.shortcuts["overlay"], "Ctrl+Alt+O");
        assert_eq!(s.shortcuts["wiki"], "", "combinaison vidée gardée vide");
        assert_eq!(s.shortcuts["overlay-edit"], "Ctrl+Shift+L");
    }

    #[test]
    fn next_layout_cycles() {
        let mut s = Settings {
            layouts: vec![Layout::default(), Layout { id: "combat".into(), ..Layout::default() }],
            ..Default::default()
        };
        assert_eq!(s.next_layout(), "combat");
        s.active_layout = "combat".into();
        assert_eq!(s.next_layout(), "exploration");
    }
}
