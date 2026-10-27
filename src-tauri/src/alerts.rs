//! Alertes du personnage (modules sans BattlEye) : eau ou vie basses, power pack presque vide,
//! sac presque plein. Silencieuses, comme les autres : notification du système et toast.
//! Une alerte ne se répète pas tant que la valeur n'est pas repassée nettement de l'autre côté du seuil.

use crate::engine::Alarm;
use crate::ue::PlayerState;
use serde::{Deserialize, Serialize};

/// Seuils en pourcentage ; 0 désactive l'alerte.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AlertSettings {
    /// Eau sous ce pourcentage.
    pub water: u8,
    /// Vie sous ce pourcentage.
    pub health: u8,
    /// Power pack sous ce pourcentage.
    pub power: u8,
    /// Sac rempli au-delà de ce pourcentage.
    pub volume: u8,
    /// Menace du ver au-delà de ce pourcentage du seuil d'attaque.
    pub worm: u8,
    /// Chaleur au-delà de ce pourcentage du seuil du coup de chaleur.
    pub heat: u8,
}

impl Default for AlertSettings {
    fn default() -> Self {
        Self { water: 25, health: 30, power: 15, volume: 90, worm: 75, heat: 70 }
    }
}

/// Écart (en points de pourcentage) à franchir pour réarmer une alerte.
const MARGIN: f32 = 5.0;

/// Alertes déjà envoyées, dans l'ordre eau, vie, power pack, sac, ver, chaleur.
#[derive(Default)]
pub struct Alerts {
    sent: [bool; 6],
}

impl Alerts {
    /// Alertes à envoyer pour ce nouvel état.
    pub fn check(&mut self, s: &PlayerState, cfg: &AlertSettings) -> Vec<Alarm> {
        let pct = |cur: f32, max: f32| (max > 0.0).then(|| cur / max * 100.0);
        // (pourcentage, seuil, alerte quand on passe au-dessus, titre, texte)
        let checks = [
            (pct(s.hydration, s.hydration_max), cfg.water, false, "Eau basse", "Buvez ou remplissez votre distille."),
            (pct(s.health, s.health_max), cfg.health, false, "Vie basse", "Mettez-vous à l'abri et soignez-vous."),
            (pct(s.power, s.power_max), cfg.power, false, "Power pack presque vide", "Le bouclier et le suspenseur vont s'éteindre."),
            (
                s.volume.zip(s.volume_max).and_then(|(v, m)| pct(v, m)),
                cfg.volume,
                true,
                "Sac presque plein",
                "Videz-le avant de récolter davantage.",
            ),
            (s.worm_threat, cfg.worm, true, "Le ver approche", "Arrêtez de bouger sur le sable ou gagnez la roche."),
            (
                pct(s.heat, if s.heatstroke > 0.0 { s.heatstroke } else { s.heat_max }),
                cfg.heat,
                true,
                "Coup de chaleur proche",
                if s.sun_exposure > 0.0 { "Vous êtes en plein soleil : gagnez l'ombre." } else { "Mettez-vous à l'abri et reposez-vous." },
            ),
        ];
        let mut out = Vec::new();
        for (i, (value, threshold, above, title, body)) in checks.into_iter().enumerate() {
            let Some(v) = value else { continue };
            if threshold == 0 {
                self.sent[i] = false;
                continue;
            }
            let t = threshold as f32;
            let (crossed, cleared) = if above { (v >= t, v < t - MARGIN) } else { (v <= t, v > t + MARGIN) };
            if crossed && !self.sent[i] {
                self.sent[i] = true;
                out.push(Alarm { title: title.into(), body: format!("{body} ({} %)", v.round()) });
            } else if cleared {
                self.sent[i] = false;
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(hydration: f32, volume: f32) -> PlayerState {
        PlayerState {
            health: 150.0,
            health_max: 150.0,
            stamina: 100.0,
            stamina_max: 100.0,
            // Power pack absent (mission sans équipement) : aucune alerte.
            power: 0.0,
            power_max: 0.0,
            hydration,
            hydration_max: 100.0,
            volume: Some(volume),
            volume_max: Some(1750.0),
            ..Default::default()
        }
    }

    #[test]
    fn alerts_once_then_rearms() {
        let (mut a, cfg) = (Alerts::default(), AlertSettings::default());
        assert!(a.check(&state(50.0, 100.0), &cfg).is_empty());
        let first = a.check(&state(24.0, 100.0), &cfg);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].title, "Eau basse");
        assert!(a.check(&state(20.0, 100.0), &cfg).is_empty(), "pas de répétition");
        assert!(a.check(&state(28.0, 100.0), &cfg).is_empty(), "pas réarmée sous seuil + marge");
        a.check(&state(40.0, 100.0), &cfg);
        assert_eq!(a.check(&state(25.0, 100.0), &cfg).len(), 1, "réarmée après être remontée");
    }

    #[test]
    fn sandworm_alert() {
        let mut a = Alerts::default();
        let cfg = AlertSettings::default();
        let calm = PlayerState { worm_threat: Some(20.0), ..state(80.0, 100.0) };
        assert!(a.check(&calm, &cfg).is_empty());
        let near = PlayerState { worm_threat: Some(80.0), ..state(80.0, 100.0) };
        assert_eq!(a.check(&near, &cfg).iter().map(|x| x.title.as_str()).collect::<Vec<_>>(), ["Le ver approche"]);
        assert!(a.check(&near, &cfg).is_empty(), "pas de répétition");
    }

    #[test]
    fn heat_alert_mentions_the_sun() {
        let mut a = Alerts::default();
        let cfg = AlertSettings::default();
        let hot = PlayerState { heat: 40.0, heat_max: 100.0, heatstroke: 50.0, sun_exposure: 1.0, ..state(80.0, 100.0) };
        let out = a.check(&hot, &cfg);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "Coup de chaleur proche");
        assert!(out[0].body.contains("soleil"));
    }

    #[test]
    fn full_backpack_and_disabled_threshold() {
        let mut a = Alerts::default();
        let cfg = AlertSettings::default();
        let full = a.check(&state(80.0, 1600.0), &cfg);
        assert_eq!(full.iter().map(|x| x.title.as_str()).collect::<Vec<_>>(), ["Sac presque plein"]);
        let off = AlertSettings { water: 0, ..cfg };
        assert!(Alerts::default().check(&state(5.0, 100.0), &off).is_empty());
    }
}
