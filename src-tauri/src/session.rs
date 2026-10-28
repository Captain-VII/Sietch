//! Journal de la partie en cours (modules sans BattlEye) : distance parcourue, coups portés, éliminations.
//! Remis à zéro à chaque nouvelle partie (début de session de `playtime.rs`), gardé en mémoire seulement.

use serde::Serialize;

/// Au-delà (cm, entre deux lectures), c'est un saut (téléportation, réapparition) : pas compté dans la distance.
const JUMP: f64 = 50_000.0;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// Début de la partie (ms), celui du temps de jeu.
    pub start: Option<i64>,
    /// Distance parcourue, en mètres.
    pub distance: f64,
    pub hits: u32,
    pub kills: u32,
    pub damage: f64,
    #[serde(skip)]
    last: Option<[f64; 2]>,
}

impl Session {
    /// Nouvelle partie : tout repart de zéro. `true` si c'est le cas.
    pub fn follow(&mut self, start: Option<i64>) -> bool {
        if start.is_some() && start != self.start {
            *self = Session { start, ..Default::default() };
            return true;
        }
        false
    }

    pub fn moved(&mut self, p: [f64; 2]) {
        if let Some(l) = self.last {
            let d = (p[0] - l[0]).hypot(p[1] - l[1]);
            if d < JUMP {
                self.distance += d / 100.0;
            }
        }
        self.last = Some(p);
    }

    pub fn hit(&mut self, damage: f32, kill: bool) {
        self.hits += 1;
        self.kills += kill as u32;
        self.damage += damage as f64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_distance_and_hits_and_resets_on_a_new_game() {
        let mut s = Session::default();
        assert!(s.follow(Some(1)));
        s.moved([0.0, 0.0]);
        s.moved([300.0, 400.0]);
        s.moved([1_000_000.0, 0.0]); // réapparition : pas comptée
        s.hit(34.0, false);
        s.hit(20.0, true);
        assert_eq!((s.distance, s.hits, s.kills, s.damage), (5.0, 2, 1, 54.0));
        assert!(!s.follow(Some(1)), "même partie");
        assert!(s.follow(Some(2)));
        assert_eq!((s.distance, s.hits), (0.0, 0));
    }
}
