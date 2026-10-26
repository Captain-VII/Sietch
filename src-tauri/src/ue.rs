//! Lecture des structures d'Unreal Engine **par leurs noms** : table des noms, table des objets,
//! réflexion des classes. Sert au personnage en direct (vie, endurance, eau, position…).
//! Lecture seule, comme le reste des modules sans BattlEye. Méthode et noms : `docs/personnage-en-direct.md`.
//!
//! Table des noms (FNamePool) : entrée = en-tête u16 (bit 0 : UTF-16, longueur = en-tête >> 6) puis les
//! caractères ; FName n → bloc n >> 16, décalage (n & 0xFFFF) * 2. Le bloc 0 commence par « None »,
//! « ByteProperty ». Table des objets : Objects**, PreAllocated*, Max, Num, MaxChunks, NumChunks ;
//! 65 536 objets par paquet. UObject : Flags +0x08, InternalIndex +0x0C, Class +0x10, Name +0x18,
//! Outer +0x20. Réflexion (UE 5) : UStruct.SuperStruct +0x40, ChildProperties +0x50 ; FField.Next +0x20,
//! Name +0x28 ; FProperty.Offset_Internal +0x4C.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Accès en lecture à la mémoire du jeu (réel sous Windows, simulé dans les tests).
pub trait Mem {
    /// Lit jusqu'à `buf.len()` octets ; renvoie le nombre lu.
    fn read_into(&self, addr: u64, buf: &mut [u8]) -> usize;
    /// Base et taille de l'exécutable du jeu.
    fn module(&self) -> (u64, u64);
    /// Zones lisibles : `true` pour le tas, `false` pour l'image du jeu.
    fn regions(&self, heap: bool) -> Vec<(u64, u64)>;
}

fn read<const N: usize>(m: &dyn Mem, addr: u64) -> Option<[u8; N]> {
    let mut b = [0u8; N];
    (m.read_into(addr, &mut b) == N).then_some(b)
}

fn ptr(m: &dyn Mem, addr: u64) -> u64 {
    read::<8>(m, addr).map(u64::from_le_bytes).unwrap_or(0)
}

fn u32_at(b: &[u8], i: usize) -> u32 {
    u32::from_le_bytes(b[i..i + 4].try_into().unwrap())
}

fn u64_at(b: &[u8], i: usize) -> u64 {
    u64::from_le_bytes(b[i..i + 8].try_into().unwrap())
}

const OBJ_PER_CHUNK: u64 = 65_536;
const CHUNK: usize = 16 << 20;

/// Emplacement des tables, gardé entre deux lancements (`ue.json`) : il ne change qu'avec le jeu.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tables {
    pub module_size: u64,
    pub blocks_rva: u64,
    pub table_rva: u64,
    pub stride: u64,
}

pub struct Ue<'a> {
    m: &'a dyn Mem,
    blocks: u64,
    table: u64,
    stride: u64,
    names: HashMap<u32, String>,
}

impl<'a> Ue<'a> {
    /// Tables connues, vérifiées (le nom 0 doit être « None »).
    pub fn open(m: &'a dyn Mem, t: Tables) -> Option<Self> {
        let (base, size) = m.module();
        if size != t.module_size {
            return None;
        }
        let mut ue = Ue { m, blocks: base + t.blocks_rva, table: base + t.table_rva, stride: t.stride, names: HashMap::new() };
        (ue.name(0).as_deref() == Some("None")).then_some(ue)
    }

    /// Recherche complète (environ une minute). `stop` est appelé entre deux blocs : `true` arrête tout.
    pub fn scan(m: &'a dyn Mem, stop: &mut dyn FnMut() -> bool) -> Result<(Self, Tables), String> {
        let block0 = scan_regions(m, &m.regions(true), stop, |base, buf| {
            (0..buf.len().saturating_sub(20)).step_by(2).find_map(|i| {
                (&buf[i + 2..i + 6] == b"None"
                    && &buf[i + 8..i + 20] == b"ByteProperty"
                    && u16::from_le_bytes([buf[i], buf[i + 1]]) >> 6 == 4)
                    .then_some(base + i as u64)
            })
        })?
        .ok_or("table des noms introuvable")?;
        let blocks = scan_regions(m, &m.regions(false), stop, |base, buf| {
            (0..buf.len().saturating_sub(8)).step_by(8).find_map(|i| (u64_at(buf, i) == block0).then_some(base + i as u64))
        })?
        .ok_or("table des noms introuvable dans l'image du jeu")?;
        let table = scan_regions(m, &m.regions(false), stop, |base, buf| {
            (0..buf.len().saturating_sub(32)).step_by(8).find_map(|i| {
                let (max, num) = (u32_at(buf, i + 16), u32_at(buf, i + 20));
                (u64_at(buf, i) != 0
                    && max >= 65_536
                    && max % 65_536 == 0
                    && u32_at(buf, i + 24) == max / 65_536
                    && num > 10_000
                    && num <= max
                    && u32_at(buf, i + 28) == num.div_ceil(65_536))
                .then_some(base + i as u64)
            })
        })?
        .ok_or("table des objets introuvable")?;
        let (base, size) = m.module();
        for stride in [24u64, 16, 32] {
            let ue = Ue { m, blocks, table, stride, names: HashMap::new() };
            let ok = (1..200u32).filter(|&i| ue.object(i).is_some_and(|o| read::<4>(m, o + 0xC).map(u32::from_le_bytes) == Some(i))).count();
            if ok > 150 {
                let t = Tables { module_size: size, blocks_rva: blocks - base, table_rva: table - base, stride };
                return Ok((ue, t));
            }
        }
        Err("table des objets illisible (disposition d'UObject différente)".into())
    }

    fn entry(&self, idx: u32) -> Option<String> {
        let block = ptr(self.m, self.blocks + (idx >> 16) as u64 * 8);
        if block == 0 {
            return None;
        }
        let at = block + (idx & 0xFFFF) as u64 * 2;
        let hdr = u16::from_le_bytes(read::<2>(self.m, at)?);
        let (len, wide) = ((hdr >> 6) as usize, hdr & 1 == 1);
        if len == 0 || len > 1024 {
            return None;
        }
        let mut b = vec![0u8; if wide { len * 2 } else { len }];
        (self.m.read_into(at + 2, &mut b) == b.len()).then(|| {
            if wide {
                String::from_utf16_lossy(&b.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<_>>())
            } else {
                b.iter().map(|&c| c as char).collect()
            }
        })
    }

    /// Texte d'un index de nom (mis en cache : beaucoup d'objets partagent les mêmes noms).
    fn name(&mut self, idx: u32) -> Option<String> {
        if let Some(n) = self.names.get(&idx) {
            return Some(n.clone());
        }
        let n = self.entry(idx)?;
        self.names.insert(idx, n.clone());
        Some(n)
    }

    fn object(&self, i: u32) -> Option<u64> {
        let head = read::<24>(self.m, self.table)?;
        if i >= u32_at(&head, 20) {
            return None;
        }
        let chunk = ptr(self.m, u64_at(&head, 0) + (i as u64 / OBJ_PER_CHUNK) * 8);
        let obj = ptr(self.m, chunk + (i as u64 % OBJ_PER_CHUNK) * self.stride);
        (obj != 0).then_some(obj)
    }

    /// Offset d'un champ dans une classe ou ses parents.
    fn field(&mut self, class: u64, wanted: &str) -> Option<u64> {
        let mut c = class;
        for _ in 0..32 {
            if c == 0 {
                return None;
            }
            let mut f = ptr(self.m, c + 0x50);
            for _ in 0..4000 {
                if f == 0 {
                    break;
                }
                if read::<4>(self.m, f + 0x28).map(u32::from_le_bytes).and_then(|i| self.name(i)).as_deref() == Some(wanted) {
                    return read::<4>(self.m, f + 0x4C).map(|b| u32::from_le_bytes(b) as u64);
                }
                f = ptr(self.m, f + 0x20);
            }
            c = ptr(self.m, c + 0x40);
        }
        None
    }

    /// Le personnage du joueur et ses jeux d'attributs, en un seul passage sur la table des objets.
    pub fn find_player(&mut self) -> Option<Player> {
        let head = read::<24>(self.m, self.table)?;
        let num = u32_at(&head, 20);
        // (objet, classe, nom, outer) de chaque objet : une lecture de 0x28 octets par objet.
        let mut all = Vec::with_capacity(num as usize);
        for i in 0..num {
            let Some(o) = self.object(i) else { continue };
            if let Some(b) = read::<0x28>(self.m, o) {
                all.push((o, u32_at(&b, 0x08), u64_at(&b, 0x10), u32_at(&b, 0x18), u64_at(&b, 0x20), i));
            }
        }
        let class_named = |ue: &mut Self, n: &str| all.iter().find(|a| ue.name(a.3).as_deref() == Some(n)).map(|a| a.0);
        let player_class = class_named(self, "BP_DunePlayerCharacter_C")?;
        let stats_class = class_named(self, "DuneCharacterAttributeSet")?;
        let hydration_class = class_named(self, "DuneHydrationAttributeSet")?;
        // Modèles (RF_ClassDefaultObject 0x10, RF_ArchetypeObject 0x20) : pas des objets du monde.
        const TEMPLATE: u32 = 0x10 | 0x20;
        let &(character, _, _, _, _, index) = all.iter().find(|a| a.2 == player_class && a.1 & TEMPLATE == 0)?;
        let owned = |class: u64| all.iter().find(|a| a.2 == class && a.4 == character).map(|a| a.0);
        let (stats, hydration) = (owned(stats_class)?, owned(hydration_class)?);
        // Heure du jeu (en heures, 0 à 24) : TimeOfDayComponent de l'état de la partie. Facultative.
        let time_of_day = class_named(self, "TimeOfDayComponent").and_then(|c| {
            let a = all.iter().find(|a| a.2 == c && a.1 & TEMPLATE == 0)?;
            Some(Watched { obj: a.0, index: a.5, class: c, offset: self.field(c, "m_TimeOfDayServer")? })
        });
        if cfg!(debug_assertions) {
            eprintln!("[personnage] trouvé : 0x{character:X} (n° {index}), heure : {time_of_day:?}");
        }
        let root = ptr(self.m, character + self.field(player_class, "RootComponent")?);
        let root_class = ptr(self.m, root + 0x10);
        let mut f = |class: u64, n: &str| self.field(class, n);
        let fields = Fields {
            location: f(root_class, "RelativeLocation")?,
            health: f(stats_class, "CurrentHealth")?,
            health_max: f(stats_class, "MaxHealth")?,
            stamina: f(stats_class, "CurrentStamina")?,
            stamina_max: f(stats_class, "MaxStamina")?,
            power: f(stats_class, "CurrentPower")?,
            power_max: f(stats_class, "MaxPower")?,
            hydration: f(hydration_class, "CurrentHydration")?,
            hydration_max: f(hydration_class, "MaxHydration")?,
            heat: f(hydration_class, "HeatExhaustion")?,
            heat_max: f(hydration_class, "HeatExhaustionMax")?,
            sun: f(hydration_class, "CurrentSunExposure")?,
        };
        Some(Player { character, index, class: player_class, stats, hydration, root, time_of_day, fields })
    }
}

/// Parcourt des zones par blocs de 16 Mio (qui se chevauchent de 32 octets) jusqu'au premier résultat.
fn scan_regions<T>(
    m: &dyn Mem,
    regions: &[(u64, u64)],
    stop: &mut dyn FnMut() -> bool,
    mut find: impl FnMut(u64, &[u8]) -> Option<T>,
) -> Result<Option<T>, String> {
    let mut buf = vec![0u8; CHUNK + 32];
    for &(base, size) in regions {
        let mut off = 0u64;
        while off < size {
            if stop() {
                return Err("recherche interrompue".into());
            }
            let len = ((size - off) as usize).min(CHUNK + 32);
            let n = m.read_into(base + off, &mut buf[..len]);
            if let Some(found) = find(base + off, &buf[..n]) {
                return Ok(Some(found));
            }
            off += CHUNK as u64;
        }
    }
    Ok(None)
}

/// Offsets des champs utiles, trouvés par réflexion.
#[derive(Clone, Copy, Debug)]
pub struct Fields {
    location: u64,
    health: u64,
    health_max: u64,
    stamina: u64,
    stamina_max: u64,
    power: u64,
    power_max: u64,
    hydration: u64,
    hydration_max: u64,
    heat: u64,
    heat_max: u64,
    sun: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct Player {
    character: u64,
    index: u32,
    class: u64,
    stats: u64,
    hydration: u64,
    root: u64,
    /// TimeOfDayComponent et offset de m_TimeOfDayServer.
    time_of_day: Option<Watched>,
    fields: Fields,
}

/// Objet suivi : il est encore valide tant que son emplacement et sa classe n'ont pas changé.
#[derive(Clone, Copy, Debug)]
pub struct Watched {
    obj: u64,
    index: u32,
    class: u64,
    offset: u64,
}

fn still_there(m: &dyn Mem, obj: u64, index: u32, class: u64) -> bool {
    read::<12>(m, obj + 0x0C).is_some_and(|b| u32_at(&b, 0) == index && u64_at(&b, 4) == class)
}

/// État du personnage envoyé aux widgets (`player-state`).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub health: f32,
    pub health_max: f32,
    pub stamina: f32,
    pub stamina_max: f32,
    pub power: f32,
    pub power_max: f32,
    pub hydration: f32,
    pub hydration_max: f32,
    pub heat: f32,
    pub heat_max: f32,
    pub sun_exposure: f32,
    /// Heure du jeu, en heures (7.5 = 07:30) ; `None` si elle n'a pas été trouvée.
    pub time_of_day: Option<f32>,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl PlayerState {
    /// Valeurs arrondies au dixième (position au mètre) : un événement seulement quand ça change vraiment.
    pub fn rounded(&self) -> Self {
        let r = |v: f32| (v * 10.0).round() / 10.0;
        let m = |v: f64| (v / 100.0).round() * 100.0;
        PlayerState {
            health: r(self.health),
            health_max: r(self.health_max),
            stamina: r(self.stamina),
            stamina_max: r(self.stamina_max),
            power: r(self.power),
            power_max: r(self.power_max),
            hydration: r(self.hydration),
            hydration_max: r(self.hydration_max),
            heat: r(self.heat),
            heat_max: r(self.heat_max),
            sun_exposure: r(self.sun_exposure),
            // À la minute du jeu près.
            time_of_day: self.time_of_day.map(|t| (t * 60.0).floor() / 60.0),
            x: m(self.x),
            y: m(self.y),
            z: m(self.z),
        }
    }
}

impl Player {
    /// Le personnage (et le composant de l'heure) sont-ils toujours là ? Sinon, tout est à retrouver.
    fn alive(&self, m: &dyn Mem) -> bool {
        still_there(m, self.character, self.index, self.class)
            && self.time_of_day.is_none_or(|w| still_there(m, w.obj, w.index, w.class))
    }

    /// Lit l'instantané ; `None` si le personnage a disparu (mort, changement de carte…).
    pub fn read(&self, m: &dyn Mem) -> Option<PlayerState> {
        if !self.alive(m) {
            return None;
        }
        let f = &self.fields;
        // FGameplayAttributeData : CurrentValue (f32) à +0xC.
        let attr = |obj: u64, off: u64| read::<4>(m, obj + off + 0xC).map(f32::from_le_bytes);
        // La vie (FglGameplayAttributeData) : valeur à jour dans le bloc pointé à +0x10.
        let health = read::<4>(m, ptr(m, self.stats + f.health + 0x10)).map(f32::from_le_bytes)?;
        let loc = read::<24>(m, self.root + f.location)?;
        let v = |i: usize| f64::from_le_bytes(loc[i..i + 8].try_into().unwrap());
        Some(PlayerState {
            health,
            health_max: attr(self.stats, f.health_max)?,
            stamina: attr(self.stats, f.stamina)?,
            stamina_max: attr(self.stats, f.stamina_max)?,
            power: attr(self.stats, f.power)?,
            power_max: attr(self.stats, f.power_max)?,
            hydration: attr(self.hydration, f.hydration)?,
            hydration_max: attr(self.hydration, f.hydration_max)?,
            heat: attr(self.hydration, f.heat)?,
            heat_max: attr(self.hydration, f.heat_max)?,
            sun_exposure: attr(self.hydration, f.sun)?,
            time_of_day: self
                .time_of_day
                .and_then(|w| read::<4>(m, w.obj + w.offset).map(f32::from_le_bytes))
                .filter(|t| (0.0..=24.0).contains(t)),
            x: v(0),
            y: v(8),
            z: v(16),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mémoire simulée : une seule zone, à l'adresse 0x1000.
    struct Fake(Vec<u8>);

    impl Mem for Fake {
        fn read_into(&self, addr: u64, buf: &mut [u8]) -> usize {
            let start = (addr as usize).saturating_sub(0x1000);
            if addr < 0x1000 || start >= self.0.len() {
                return 0;
            }
            let n = buf.len().min(self.0.len() - start);
            buf[..n].copy_from_slice(&self.0[start..start + n]);
            n
        }
        fn module(&self) -> (u64, u64) {
            (0x1000, 0x100)
        }
        fn regions(&self, _heap: bool) -> Vec<(u64, u64)> {
            vec![(0x1000, self.0.len() as u64)]
        }
    }

    fn put(mem: &mut [u8], at: usize, bytes: &[u8]) {
        mem[at - 0x1000..at - 0x1000 + bytes.len()].copy_from_slice(bytes);
    }

    #[test]
    fn reads_names_from_the_pool() {
        let mut mem = vec![0u8; 0x400];
        // Blocks[0] (dans l'« image » à 0x1000) → bloc 0 à 0x1200.
        put(&mut mem, 0x1000, &0x1200u64.to_le_bytes());
        // « None » (index 0) puis « ByteProperty » (index 3 : 6 octets plus loin).
        put(&mut mem, 0x1200, &(4u16 << 6).to_le_bytes());
        put(&mut mem, 0x1202, b"None");
        put(&mut mem, 0x1206, &(12u16 << 6).to_le_bytes());
        put(&mut mem, 0x1208, b"ByteProperty");
        let m = Fake(mem);
        let t = Tables { module_size: 0x100, blocks_rva: 0, table_rva: 0x100, stride: 24 };
        let mut ue = Ue::open(&m, t).expect("le nom 0 vaut None");
        assert_eq!(ue.name(3).as_deref(), Some("ByteProperty"));
        assert_eq!(ue.name(100), None, "entrée vide");
        // Taille d'image différente (patch du jeu) : le cache n'est plus bon.
        assert!(Ue::open(&m, Tables { module_size: 0x200, ..t }).is_none());
    }
}
