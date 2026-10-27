//! Temps de jeu : sessions déduites du processus du jeu (aucune lecture du jeu, marche avec BattlEye).
//! Gardées 60 jours dans `temps-de-jeu.json` ; l'interface fait les totaux (session, jour, semaine).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Sessions de plus de 60 jours oubliées.
const KEEP_MS: i64 = 60 * 86_400_000;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Playtime {
    /// Sessions terminées : (début, fin) en ms depuis l'epoch.
    pub sessions: Vec<[i64; 2]>,
    /// Début de la session en cours.
    pub current: Option<i64>,
    #[serde(skip)]
    path: PathBuf,
    #[serde(skip)]
    saved_at: i64,
}

impl Playtime {
    pub fn load(path: PathBuf) -> Self {
        let mut p: Playtime =
            std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        // Sietch fermé pendant une session : elle s'arrête à la dernière sauvegarde (déjà dans `sessions`).
        p.current = None;
        p.path = path;
        p
    }

    /// Nouvel état du jeu ; `true` si la liste a changé (début ou fin de session).
    pub fn update(&mut self, running: bool, now: i64) -> bool {
        let changed = match (running, self.current) {
            (true, None) => {
                self.current = Some(now);
                true
            }
            (false, Some(start)) => {
                self.current = None;
                self.close(start, now);
                true
            }
            _ => false,
        };
        // Une sauvegarde par minute pendant la session : un plantage ne perd pas plus.
        if changed || (self.current.is_some() && now - self.saved_at > 60_000) {
            self.save(now);
        }
        changed
    }

    fn close(&mut self, start: i64, end: i64) {
        // La sauvegarde de la minute a pu déjà ajouter cette session : on la remplace.
        self.sessions.retain(|s| s[0] != start);
        if end - start >= 60_000 {
            self.sessions.push([start, end]);
        }
        self.sessions.retain(|s| end - s[1] < KEEP_MS);
    }

    fn save(&mut self, now: i64) {
        self.saved_at = now;
        let mut copy = self.clone();
        if let Some(start) = copy.current.take() {
            copy.close(start, now);
        }
        if let Ok(json) = serde_json::to_string(&copy) {
            let _ = write_atomic(&self.path, &json);
        }
    }
}

fn write_atomic(path: &Path, data: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_sessions_and_drops_short_ones() {
        let dir = std::env::temp_dir().join(format!("sietch-playtime-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut p = Playtime::load(dir.join("t.json"));
        assert!(p.update(true, 0));
        assert!(!p.update(true, 30_000));
        assert!(p.update(false, 30_000), "fin de session");
        assert!(p.sessions.is_empty(), "moins d'une minute : oubliée");
        p.update(true, 100_000);
        p.update(true, 200_000); // sauvegarde de la minute
        p.update(false, 400_000);
        assert_eq!(p.sessions, [[100_000, 400_000]]);
        // Relue après un redémarrage de Sietch.
        assert_eq!(Playtime::load(dir.join("t.json")).sessions, [[100_000, 400_000]]);
        let _ = std::fs::remove_dir_all(dir);
    }
}
