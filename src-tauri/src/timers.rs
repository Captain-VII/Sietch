use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn yes() -> bool {
    true
}

/// Un minuteur. Trois états possibles :
/// - en cours : `ends_at` renseigné ;
/// - en pause : `ends_at` vide et `remaining_ms` > 0 ;
/// - terminé : `fired` vrai.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timer {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub place: String,
    /// "ressources", "evenements" ou "personnels".
    pub group: String,
    pub duration_secs: i64,
    pub ends_at: Option<i64>,
    #[serde(default)]
    pub remaining_ms: i64,
    #[serde(default)]
    pub repeat: bool,
    #[serde(default = "yes")]
    pub alarm: bool,
    #[serde(default)]
    pub sound: String,
    #[serde(default = "yes")]
    pub in_overlay: bool,
    #[serde(default)]
    pub fired: bool,
}

/// Ce que l'interface envoie pour créer ou modifier un minuteur.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerInput {
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub place: String,
    pub group: String,
    pub duration_secs: i64,
    #[serde(default)]
    pub repeat: bool,
    #[serde(default = "yes")]
    pub alarm: bool,
    #[serde(default)]
    pub sound: String,
    #[serde(default = "yes")]
    pub in_overlay: bool,
}

impl Timer {
    pub fn start(input: TimerInput, id: String) -> Self {
        let duration_secs = input.duration_secs.max(1);
        Self {
            id,
            name: input.name,
            place: input.place,
            group: input.group,
            duration_secs,
            ends_at: Some(now_ms() + duration_secs * 1000),
            remaining_ms: 0,
            repeat: input.repeat,
            alarm: input.alarm,
            sound: input.sound,
            in_overlay: input.in_overlay,
            fired: false,
        }
    }

    /// Met à jour les champs descriptifs sans toucher au décompte,
    /// sauf si la durée change : le minuteur repart alors de zéro.
    pub fn apply(&mut self, input: TimerInput) {
        let restart = input.duration_secs.max(1) != self.duration_secs;
        self.name = input.name;
        self.place = input.place;
        self.group = input.group;
        self.duration_secs = input.duration_secs.max(1);
        self.repeat = input.repeat;
        self.alarm = input.alarm;
        self.sound = input.sound;
        self.in_overlay = input.in_overlay;
        if restart {
            self.restart();
        }
    }

    pub fn pause(&mut self) {
        if let Some(end) = self.ends_at.take() {
            self.remaining_ms = (end - now_ms()).max(1);
        }
    }

    pub fn resume(&mut self) {
        if self.ends_at.is_none() && !self.fired && self.remaining_ms > 0 {
            self.ends_at = Some(now_ms() + self.remaining_ms);
            self.remaining_ms = 0;
        }
    }

    pub fn restart(&mut self) {
        self.fired = false;
        self.remaining_ms = 0;
        self.ends_at = Some(now_ms() + self.duration_secs * 1000);
    }

    /// Fait avancer le minuteur ; renvoie vrai s'il vient de sonner.
    pub fn tick(&mut self, now: i64) -> bool {
        let Some(end) = self.ends_at else { return false };
        if end > now {
            return false;
        }
        if self.repeat {
            let period = self.duration_secs * 1000;
            let mut next = end + period;
            if next <= now {
                next = now + period;
            }
            self.ends_at = Some(next);
        } else {
            self.ends_at = None;
            self.remaining_ms = 0;
            self.fired = true;
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(repeat: bool) -> Timer {
        let input = TimerInput {
            id: None,
            name: "Épice".into(),
            place: String::new(),
            group: "ressources".into(),
            duration_secs: 60,
            repeat,
            alarm: true,
            sound: String::new(),
            in_overlay: true,
        };
        Timer::start(input, "t1".into())
    }

    #[test]
    fn single_timer_finishes_once() {
        let mut t = sample(false);
        let end = t.ends_at.unwrap();
        assert!(!t.tick(end - 1));
        assert!(t.tick(end));
        assert!(t.fired);
        assert!(!t.tick(end + 10_000));
    }

    #[test]
    fn repeating_timer_rearms() {
        let mut t = sample(true);
        let end = t.ends_at.unwrap();
        assert!(t.tick(end));
        assert_eq!(t.ends_at, Some(end + 60_000));
        assert!(!t.fired);
    }

    #[test]
    fn pause_keeps_remaining_time() {
        let mut t = sample(false);
        t.pause();
        assert!(t.ends_at.is_none());
        assert!(t.remaining_ms > 59_000);
        t.resume();
        assert!(t.ends_at.is_some());
    }
}
