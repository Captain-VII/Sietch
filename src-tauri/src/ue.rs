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
use std::time::Instant;

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
    fields: HashMap<(u64, &'static str), Option<u64>>,
    /// Champs indispensables introuvables au dernier `find_player` : le jeu a changé (patch), lecture du personnage impossible.
    pub missing: Vec<&'static str>,
}

impl<'a> Ue<'a> {
    /// Tables connues, vérifiées (le nom 0 doit être « None »).
    pub fn open(m: &'a dyn Mem, t: Tables) -> Option<Self> {
        let (base, size) = m.module();
        if size != t.module_size {
            return None;
        }
        let mut ue = Ue { m, blocks: base + t.blocks_rva, table: base + t.table_rva, stride: t.stride, names: HashMap::new(), fields: HashMap::new(), missing: Vec::new() };
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
            let ue = Ue { m, blocks, table, stride, names: HashMap::new(), fields: HashMap::new(), missing: Vec::new() };
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

    /// Objets d'indices `from..to` (index, adresse), lus par paquets : une lecture par bloc de la table au lieu de
    /// trois par objet (en-tête, bloc, pointeur). Les relevés parcourent des centaines de milliers d'objets.
    fn objects(&self, from: u32, to: u32) -> Vec<(u32, u64)> {
        let Some(head) = read::<24>(self.m, self.table) else { return Vec::new() };
        let to = to.min(u32_at(&head, 20));
        let stride = self.stride as usize;
        let mut out = Vec::with_capacity(to.saturating_sub(from) as usize);
        let mut i = from;
        while i < to {
            let c = i as u64 / OBJ_PER_CHUNK;
            let end = ((c + 1) * OBJ_PER_CHUNK).min(to as u64) as u32;
            let chunk = ptr(self.m, u64_at(&head, 0) + c * 8);
            let mut buf = vec![0u8; (end - i) as usize * stride];
            if chunk != 0 && self.m.read_into(chunk + (i as u64 % OBJ_PER_CHUNK) * self.stride, &mut buf) == buf.len() {
                out.extend((0..end - i).map(|k| (i + k, u64_at(&buf, k as usize * stride))).filter(|&(_, o)| o != 0));
            }
            i = end;
        }
        out
    }

    /// Offset d'un champ dans une classe ou ses parents.
    fn field(&mut self, class: u64, wanted: &str) -> Option<u64> {
        let f = self.field_ptr(class, wanted)?;
        read::<4>(self.m, f + 0x4C).map(|b| u32::from_le_bytes(b) as u64)
    }

    /// Le FField d'un champ (classe et parents), pour lire son type et, pour un booléen, son masque.
    fn field_ptr(&mut self, class: u64, wanted: &str) -> Option<u64> {
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
                    return Some(f);
                }
                f = ptr(self.m, f + 0x20);
            }
            c = ptr(self.m, c + 0x40);
        }
        None
    }

    /// Premier des champs `names` de l'objet qui existe, lu comme un indicateur : booléen (FBoolProperty :
    /// ByteOffset +0x79, FieldMask +0x7B), ou pointeur d'objet (non nul = vrai).
    fn flag(&mut self, class: u64, obj: u64, names: &[&str]) -> Option<Flag> {
        names.iter().find_map(|n| {
            let f = self.field_ptr(class, n)?;
            let off = read::<4>(self.m, f + 0x4C).map(u32::from_le_bytes)? as u64;
            let kind = self.name_at(ptr(self.m, f + 0x08))?;
            let flag = match kind.as_str() {
                "BoolProperty" => {
                    let b = read::<4>(self.m, f + 0x78)?;
                    Flag::Bool { at: obj + off + b[1] as u64, mask: b[3] }
                }
                "ObjectProperty" | "WeakObjectProperty" => Flag::Ptr { at: obj + off },
                _ => return None,
            };
            if cfg!(debug_assertions) {
                eprintln!("[personnage] indicateur {n} ({kind})");
            }
            Some(flag)
        })
    }

    /// Toutes les valeurs d'attributs (GameplayAttributeData et dérivées) des jeux du personnage.
    pub fn raw_stats(&mut self, p: &Player) -> Vec<RawStat> {
        let mut out = Vec::new();
        for (set, obj) in &p.sets {
            let mut c = ptr(self.m, obj + 0x10);
            for _ in 0..32 {
                if c == 0 {
                    break;
                }
                let mut f = ptr(self.m, c + 0x50);
                for _ in 0..4000 {
                    if f == 0 {
                        break;
                    }
                    let is_attr = self.name_at(ptr(self.m, f + 0x08)).as_deref() == Some("StructProperty")
                        && self.name_at(ptr(self.m, f + 0x78) + 0x18).is_some_and(|s| s.ends_with("GameplayAttributeData"));
                    if is_attr {
                        let off = read::<4>(self.m, f + 0x4C).map(|b| u32::from_le_bytes(b) as u64).unwrap_or(0);
                        let size = read::<4>(self.m, f + 0x3C).map(u32::from_le_bytes).unwrap_or(16);
                        let at = obj + off;
                        // Variante plus grande (vie) : la valeur à jour est dans le bloc pointé à +0x10.
                        let value = if size > 16 { read::<4>(self.m, ptr(self.m, at + 0x10)) } else { read::<4>(self.m, at + 0xC) };
                        if let (Some(v), Some(name)) = (value.map(f32::from_le_bytes), self.name_at(f + 0x28)) {
                            out.push(RawStat { set: set.clone(), name, value: v });
                        }
                    }
                    f = ptr(self.m, f + 0x20);
                }
                c = ptr(self.m, c + 0x40);
            }
        }
        out
    }

    /// Nom (FName) rangé à cette adresse.
    fn name_at(&mut self, at: u64) -> Option<String> {
        read::<4>(self.m, at).map(u32::from_le_bytes).and_then(|i| self.name(i))
    }

    /// Offset d'un champ, mis en cache par classe (la carte lit des centaines d'objets de la même classe).
    fn field_cached(&mut self, class: u64, wanted: &'static str) -> Option<u64> {
        if let Some(&v) = self.fields.get(&(class, wanted)) {
            return v;
        }
        let v = self.field(class, wanted);
        self.fields.insert((class, wanted), v);
        v
    }

    /// Position (cm) d'un acteur : RootComponent → RelativeLocation.
    fn location(&mut self, actor: u64, class: u64) -> Option<[f64; 3]> {
        let root = ptr(self.m, actor + self.field_cached(class, "RootComponent")?);
        let off = self.field_cached(ptr(self.m, root + 0x10), "RelativeLocation")?;
        let b = read::<24>(self.m, root + off)?;
        Some([0, 8, 16].map(|i| f64::from_le_bytes(b[i..i + 8].try_into().unwrap())))
    }

    /// Données de la carte de la région : limites, zones et points d'intérêt. Un passage sur la table des objets.
    pub fn map_data(&mut self) -> Option<MapData> {
        let head = read::<24>(self.m, self.table)?;
        let mut class_names: HashMap<u64, String> = HashMap::new();
        let (mut bounds, mut areas, mut pois, mut places, mut layer_name) = (None, Vec::new(), Vec::new(), Vec::new(), String::new());
        for (_, o) in self.objects(0, u32_at(&head, 20)) {
            let Some(b) = read::<0x28>(self.m, o) else { continue };
            if u32_at(&b, 0x08) & TEMPLATE != 0 {
                continue;
            }
            let class = u64_at(&b, 0x10);
            let cname = match class_names.get(&class) {
                Some(n) => n.clone(),
                None => {
                    let n = self.name_at(class + 0x18).unwrap_or_default();
                    class_names.insert(class, n.clone());
                    n
                }
            };
            if cname == "CartographyMapLayerComponent" && bounds.is_none() {
                // Le calque de la région (pas le calque « Global ») ; limites en mètres.
                let layer = self.name_at(u64_at(&b, 0x20) + 0x18).unwrap_or_default();
                if layer.starts_with("BP_MapLayer_") && !layer.contains("Global") {
                    let off = self.field_cached(class, "m_MapLayerMapBounds")?;
                    let bx = read::<0x30>(self.m, o + off)?;
                    let v = |i: usize| f64::from_le_bytes(bx[i..i + 8].try_into().unwrap()) * 100.0;
                    bounds = Some(Bounds { min_x: v(0), min_y: v(8), max_x: v(0x18), max_y: v(0x20) });
                    layer_name = layer;
                }
            } else if cname == "BP_WorldMapAreasData_C" && areas.is_empty() {
                areas = self.areas(o, class);
            } else if cname.contains("TerrainBlockActor")
                && let Some(p) = self.poi(o, class)
            {
                pois.push(p);
            } else if cname == "DuneStaticMarkerActor"
                && let Some(p) = self.place(o, class)
            {
                places.push(p);
            }
        }
        Some(MapData { layer: layer_name, bounds: bounds?, areas, pois, places })
    }

    /// Zones de la carte (BP_WorldMapAreasData_C.Areas) : type et cercles (centre et rayon en cm).
    fn areas(&mut self, obj: u64, class: u64) -> Vec<Area> {
        let Some(off) = self.field_cached(class, "Areas") else { return Vec::new() };
        let Some(arr) = read::<12>(self.m, obj + off) else { return Vec::new() };
        let (data, num) = (u64_at(&arr, 0), u32_at(&arr, 8).min(2000) as u64);
        let tarray = |at: u64| read::<12>(self.m, at).map(|b| (u64_at(&b, 0), u32_at(&b, 8).min(500) as u64));
        (0..num)
            .filter_map(|i| {
                let e = data + i * 0x58;
                let kind = read::<1>(self.m, e)?[0];
                let ((centers, n), (radii, _)) = (tarray(e + 0x08)?, tarray(e + 0x18)?);
                let circles = (0..n)
                    .filter_map(|j| {
                        let c = read::<24>(self.m, centers + j * 24)?;
                        let r = read::<8>(self.m, radii + j * 8).map(f64::from_le_bytes)?;
                        let v = |k: usize| f64::from_le_bytes(c[k..k + 8].try_into().unwrap());
                        Some([v(0), v(8), r])
                    })
                    .collect();
                Some(Area { kind, circles })
            })
            .collect()
    }

    /// Point d'intérêt d'un Terrain Block, si son type nous intéresse (le relief est ignoré).
    fn poi(&mut self, obj: u64, class: u64) -> Option<Poi> {
        let asset = ptr(self.m, obj + self.field_cached(class, "m_TerrainBlockAsset")?);
        let name = self.name_at(asset + 0x18)?;
        let kind = poi_kind(&name)?;
        let [x, y, z] = self.location(obj, class)?;
        Some(Poi { kind: kind.into(), name: name.trim_start_matches("CB_").into(), x, y, z })
    }

    /// Lieu nommé de la carte du jeu (DuneStaticMarkerActor) : son nom tel que le jeu l'affiche, dans sa langue.
    fn place(&mut self, obj: u64, class: u64) -> Option<Place> {
        let mut name = None;
        for field in ["m_DisplayName", "m_ChosenDisplayName"] {
            if name.is_none()
                && let Some(off) = self.field_cached(class, field)
            {
                name = ftext(self.m, obj + off);
            }
        }
        let [x, y, _] = self.location(obj, class)?;
        Some(Place { name: name?, x, y })
    }

    /// Générateurs de ressources chargés autour du joueur (classes dérivées de `ResourceSpawner`).
    /// Le jeu ne charge que les environs : la mémoire des points déjà vus est tenue par `live.rs`.
    /// Avance le relevé jusqu'à `until` ; renvoie la liste quand la table a été parcourue en entier.
    /// Découpé en tranches de temps (la position se lit sur le même fil : elle ne doit jamais attendre).
    /// Relève aussi, au passage, les jeux d'attributs des autres personnages (`ResourceScan::foes`).
    pub fn resources_step(&mut self, scan: &mut ResourceScan, player: &Player, until: Instant) -> Option<Vec<Resource>> {
        std::mem::swap(&mut self.names, &mut scan.names);
        std::mem::swap(&mut self.fields, &mut scan.fields);
        let done = self.scan_until(scan, player, until);
        std::mem::swap(&mut self.names, &mut scan.names);
        std::mem::swap(&mut self.fields, &mut scan.fields);
        if !done? {
            return None;
        }
        scan.next = 0;
        // Liste des personnages renouvelée : on garde la vie déjà lue de ceux qui étaient là.
        let old = std::mem::take(&mut scan.foes);
        scan.foes = std::mem::take(&mut scan.foes_found);
        for f in &mut scan.foes {
            f.health = old.iter().find(|o| o.set == f.set && o.index == f.index).and_then(|o| o.health);
        }
        scan.places = std::mem::take(&mut scan.places_found);
        Some(std::mem::take(&mut scan.found))
    }

    /// Parcourt la table par paquets de 2 048 objets jusqu'à `until` ; vrai quand la fin est atteinte.
    fn scan_until(&mut self, scan: &mut ResourceScan, player: &Player, until: Instant) -> Option<bool> {
        let num = u32_at(&read::<24>(self.m, self.table)?, 20);
        loop {
            let end = scan.next.saturating_add(2048).min(num);
            for (i, o) in self.objects(scan.next, end) {
                if let Some(r) = self.resource_at(i, o, scan, player) {
                    scan.found.push(r);
                }
            }
            scan.next = end;
            if end >= num {
                return Some(true);
            }
            if Instant::now() >= until {
                return Some(false);
            }
        }
    }

    /// Générateur de ressources (objet `o`, index `i` de la table des objets), s'il y en a un.
    fn resource_at(&mut self, i: u32, o: u64, scan: &mut ResourceScan, player: &Player) -> Option<Resource> {
        let b = read::<0x28>(self.m, o)?;
        if u32_at(&b, 0x08) & TEMPLATE != 0 {
            return None;
        }
        let class = u64_at(&b, 0x10);
        let marker = match scan.markers.get(&class) {
            Some(m) => *m,
            None => {
                let m = self.name_at(class + 0x18).as_deref() == Some("DuneStaticMarkerActor");
                scan.markers.insert(class, m);
                m
            }
        };
        if marker {
            if let Some(p) = self.place(o, class) {
                scan.places_found.push(p);
            }
            return None;
        }
        if class == player.stats_class {
            let actor = u64_at(&b, 0x20);
            if actor != player.character {
                let foe = Foe { set: o, index: i, class, actor, health: None };
                // Suivi tout de suite (ennemi qui vient d'apparaître), sans attendre la fin du passage.
                if !scan.foes.iter().any(|f| f.set == o && f.index == i) {
                    scan.foes.push(foe);
                }
                scan.foes_found.push(foe);
            }
            return None;
        }
        let kind = match scan.kinds.get(&class) {
            Some(k) => k.clone(),
            None => {
                let k = self.resource_class(class);
                scan.kinds.insert(class, k.clone());
                k
            }
        };
        let (name, instanced) = kind?;
        if instanced {
            self.instances(o, class, &name, &mut scan.found);
            return None;
        }
        let [x, y, z] = self.location(o, class)?;
        // Délai de réapparition par défaut, en secondes.
        let respawn = self
            .field_cached(class, "m_DefaultRespawnTime")
            .and_then(|f| read::<4>(self.m, o + f))
            .map(f32::from_le_bytes)
            .filter(|t| t.is_finite() && *t >= 0.0)
            .unwrap_or(0.0);
        Some(Resource { name, x, y, z, respawn })
    }

    /// Gisements fixes (minerai, basalte, buissons) : un `HarvestableInstancedMeshComponent` par type et par acteur, une
    /// instance par rocher. Position = celle de l'acteur porteur + translation de l'instance (FMatrix en f64, 128 octets ;
    /// rotation de l'acteur ignorée, nulle sur ceux relevés). Pas de délai de réapparition connu.
    /// shortcut: un rocher miné reste listé (instance, échelle et `m_ReplicatedReapedState` de l'acteur inchangés, relevé du
    /// 2026-11-02) ; à reprendre si le jeu expose où il garde cet état. `m_CustomDataReapedIndex` concerne la rosée.
    fn instances(&mut self, comp: u64, class: u64, name: &str, out: &mut Vec<Resource>) -> Option<()> {
        let owner = read::<0x28>(self.m, comp).map(|b| u64_at(&b, 0x20))?;
        let owner_class = read::<0x28>(self.m, owner).map(|b| u64_at(&b, 0x10))?;
        let [ox, oy, oz] = self.location(owner, owner_class)?;
        let arr = read::<16>(self.m, comp + self.field_cached(class, "PerInstanceSMData")?)?;
        let (data, num) = (u64_at(&arr, 0), u32_at(&arr, 8).min(4096) as usize);
        let mut buf = vec![0u8; num * 128];
        if self.m.read_into(data, &mut buf) != buf.len() {
            return None;
        }
        for m in buf.as_chunks::<128>().0 {
            let f = |k: usize| f64::from_le_bytes(m[k..k + 8].try_into().unwrap());
            out.push(Resource { name: name.to_string(), x: ox + f(96), y: oy + f(104), z: oz + f(112), respawn: 0.0 });
        }
        Some(())
    }

    /// Nom de ressource d'une classe de générateur (`ResourceSpawner`) ou de gisement fixe
    /// (`HarvestableInstancedMeshComponent`, vrai en second) ; `None` pour toute autre classe.
    fn resource_class(&mut self, class: u64) -> Option<(String, bool)> {
        let name = self.name_at(class + 0x18)?;
        let mut c = ptr(self.m, class + 0x40);
        for _ in 0..8 {
            if c == 0 {
                break;
            }
            match self.name_at(c + 0x18).as_deref() {
                Some("ResourceSpawner") => return Some((resource_name(&name), false)),
                Some("HarvestableInstancedMeshComponent") => return Some((resource_name(&name), true)),
                _ => {}
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
        for (i, o) in self.objects(0, num) {
            if let Some(b) = read::<0x28>(self.m, o) {
                all.push((o, u32_at(&b, 0x08), u64_at(&b, 0x10), u32_at(&b, 0x18), u64_at(&b, 0x20), i));
            }
        }
        let class_named = |ue: &mut Self, n: &str| all.iter().find(|a| ue.name(a.3).as_deref() == Some(n)).map(|a| a.0);
        let player_class = class_named(self, "BP_DunePlayerCharacter_C")?;
        let stats_class = class_named(self, "DuneCharacterAttributeSet")?;
        let hydration_class = class_named(self, "DuneHydrationAttributeSet")?;
        // Plusieurs personnages peuvent exister (aperçu du menu, perso en cours de chargement…) : on garde
        // le premier dont la vie maximale est lue (> 0).
        self.missing.clear();
        let Some(max_health) = self.field(stats_class, "MaxHealth") else {
            self.missing.push("MaxHealth");
            return None;
        };
        let owned = |character: u64, class: u64| all.iter().find(|a| a.2 == class && a.4 == character).map(|a| a.0);
        let (character, index, stats, hydration) = all
            .iter()
            .filter(|a| a.2 == player_class && a.1 & TEMPLATE == 0)
            .find_map(|a| {
                let stats = owned(a.0, stats_class)?;
                let max = read::<4>(self.m, stats + max_health + 0xC).map(f32::from_le_bytes)?;
                (max > 0.0).then_some((a.0, a.5, stats, owned(a.0, hydration_class)?))
            })?;
        // Heure du jeu (en heures, 0 à 24) : TimeOfDayComponent de l'état de la partie. Facultative.
        let time_of_day = class_named(self, "TimeOfDayComponent").and_then(|c| {
            let a = all.iter().find(|a| a.2 == c && a.1 & TEMPLATE == 0)?;
            Some(Watched { obj: a.0, index: a.5, class: c, offset: self.field(c, "m_TimeOfDayServer")? })
        });
        // Tous les jeux d'attributs du personnage, pour l'écran « Stats brutes ».
        let sets: Vec<(String, u64)> = all
            .iter()
            .filter(|a| a.4 == character)
            .filter_map(|a| {
                let class = read::<4>(self.m, a.2 + 0x18).map(u32::from_le_bytes).and_then(|i| self.name(i))?;
                class.ends_with("AttributeSet").then_some((class, a.0))
            })
            .collect();
        if cfg!(debug_assertions) {
            eprintln!("[personnage] trouvé : 0x{character:X} (n° {index}), heure : {time_of_day:?}");
        }
        // Sac : composant → ItemInventory → InventoryVolumeTracker. Facultatif.
        let backpack = (|| {
            let comp = ptr(self.m, character + self.field(player_class, "m_BackpackInventoryComponent")?);
            let comp_class = ptr(self.m, comp + 0x10);
            let inv = ptr(self.m, comp + self.field(comp_class, "m_Inventory")?);
            let tracker = ptr(self.m, inv + self.field(ptr(self.m, inv + 0x10), "m_VolumeTracker")?);
            let max = read::<4>(self.m, comp + self.field(comp_class, "m_MaxItemVolume")?).map(f32::from_le_bytes)?;
            // Le volume courant n'a pas de nom : champ interne du suivi, juste après le maximum (+0x38).
            // On vérifie que le maximum y est bien avant de s'y fier.
            (read::<4>(self.m, tracker + 0x38).map(f32::from_le_bytes) == Some(max)).then_some(tracker)
        })();
        // Emplacements du sac : liste interne des objets (TArray d'identifiants), juste avant m_ClientMonitors.
        // On s'y fie seulement si le nombre ne dépasse pas la capacité.
        let slots = (|| {
            let comp = ptr(self.m, character + self.field(player_class, "m_BackpackInventoryComponent")?);
            let inv = ptr(self.m, comp + self.field(ptr(self.m, comp + 0x10), "m_Inventory")?);
            let inv_class = ptr(self.m, inv + 0x10);
            let items = inv + self.field(inv_class, "m_ClientMonitors")? - 0x18;
            let max = read::<4>(self.m, inv + self.field(inv_class, "m_InitialMaxItemCount")?).map(u32::from_le_bytes)?;
            let b = read::<16>(self.m, items)?;
            (max > 0 && u32_at(&b, 8) <= max && u32_at(&b, 12) >= u32_at(&b, 8)).then_some(Slots { items, max })
        })();
        // Menace du ver : composant SandwormThreatSource du personnage (valeur courante et seuil d'attaque).
        let worm = class_named(self, "SandwormThreatSourceComponent").and_then(|c| {
            let comp = all.iter().find(|a| a.2 == c && a.4 == character)?.0;
            Some(Worm { comp, value: self.field(c, "m_CurrentThreatBlobValue")?, threshold: self.field(c, "m_CurrentSandwormAttackThreshold")? })
        });
        // Arme en main, à bord d'un véhicule : pour choisir la disposition de l'overlay. Noms candidats, à confirmer
        // en jeu avec `sietch-scan ue-diff` (docs/personnage-en-direct.md) ; aucun trouvé = pas de changement automatique.
        // Nom de la zone, tel que le jeu l'affiche (donc dans sa langue) : texte du widget en haut à droite.
        let zone = class_named(self, "W_MapAreaInformationHUDWidget_C").and_then(|c| {
            let (name_at, owner_at) = (self.field(c, "m_MapAreaName")?, self.field(c, "m_PlayerCharacter")?);
            let w = all.iter().find(|a| a.2 == c && a.1 & TEMPLATE == 0 && ptr(self.m, a.0 + owner_at) == character)?.0;
            let block = ptr(self.m, w + name_at);
            Some(block + self.field(ptr(self.m, block + 0x10), "Text")?)
        });
        let armed = self.flag(player_class, character, ARMED_FIELDS);
        let attack = self.field(player_class, "m_WeaponComponent").map(|w| Attack {
            weapon_at: character + w,
            ammo: class_named(self, "WeaponActorComponent").and_then(|c| self.field(c, "m_CurrentAmmo")),
            melee_at: self.field(player_class, "m_MeleeHitActors").map(|o| character + o),
        });
        let vehicle = self.flag(player_class, character, VEHICLE_FIELDS);
        // Caméra : Pawn.Controller → Controller.ControlRotation. Facultative (sinon, la mini-carte garde le nord en haut).
        let camera = (|| {
            let controller = ptr(self.m, character + self.field(player_class, "Controller")?);
            (controller != 0).then_some(())?;
            Some(controller + self.field(ptr(self.m, controller + 0x10), "ControlRotation")?)
        })();
        if cfg!(debug_assertions) {
            eprintln!("[personnage] caméra : {}", camera.map_or("introuvable".into(), |c| format!("0x{c:X}")));
        }
        let Some(root_component) = self.field(player_class, "RootComponent") else {
            self.missing.push("RootComponent");
            return None;
        };
        let root = ptr(self.m, character + root_component);
        let root_class = ptr(self.m, root + 0x10);
        // Tous les champs manquants d'un coup (pas seulement le premier) : la liste dit ce qu'un patch a cassé.
        let mut missing = Vec::new();
        let mut f = |class: u64, n: &'static str| {
            self.field(class, n).unwrap_or_else(|| {
                missing.push(n);
                0
            })
        };
        let fields = Fields {
            location: f(root_class, "RelativeLocation"),
            attach_parent: f(root_class, "AttachParent"),
            root_component,
            rotation: f(root_class, "RelativeRotation"),
            health: f(stats_class, "CurrentHealth"),
            health_max: max_health,
            stamina: f(stats_class, "CurrentStamina"),
            stamina_max: f(stats_class, "MaxStamina"),
            power: f(stats_class, "CurrentPower"),
            power_max: f(stats_class, "MaxPower"),
            hydration: f(hydration_class, "CurrentHydration"),
            hydration_max: f(hydration_class, "MaxHydration"),
            heat: f(hydration_class, "HeatExhaustion"),
            heat_max: f(hydration_class, "HeatExhaustionMax"),
            sun: f(hydration_class, "CurrentSunExposure"),
            heatstroke: f(hydration_class, "HeatstrokeThreshold"),
        };
        if !missing.is_empty() {
            self.missing = missing;
            return None;
        }
        Some(Player { character, index, class: player_class, stats, stats_class, hydration, root, time_of_day, backpack, slots, worm, armed, vehicle, zone, camera, attack, sets, fields })
    }
}

/// Modèles (RF_ClassDefaultObject 0x10, RF_ArchetypeObject 0x20) : pas des objets du monde.
const TEMPLATE: u32 = 0x10 | 0x20;

/// Type de point d'intérêt d'après le nom de son Terrain Block (`CB_<biome>_<type>_<n>`) ; `None` pour le relief.
pub fn poi_kind(asset: &str) -> Option<&'static str> {
    let n = asset.to_lowercase();
    const KINDS: [(&str, &str); 10] = [
        ("ecolab", "station"),
        ("wreckedship", "epave"),
        ("wreckage", "epave"),
        ("mininggallery", "mine"),
        ("altar", "autel"),
        ("landsraadshelter", "abri"),
        ("harvester", "moissonneuse"),
        ("story", "histoire"),
        ("infected", "evenement"),
        ("base", "base"),
    ];
    KINDS.iter().find(|(k, _)| n.contains(k)).map(|&(_, v)| v)
}

/// Nom de ressource d'après la classe du générateur : `BP_AzuriteOre_A_Spawner_C` → `AzuriteOre`,
/// `BP_Azurite_Pickup_B_Spawner_C` → `Azurite_Pickup` (ramassable au sol).
pub fn resource_name(class: &str) -> String {
    let core = class.trim_start_matches("BP_").trim_end_matches("_C").trim_end_matches("_Spawner").trim_end_matches("_Component");
    core.split('_').filter(|p| !(p.len() == 1 && p.chars().all(|c| c.is_ascii_uppercase()))).collect::<Vec<_>>().join("_")
}

/// Relevé des ressources en cours, d'un tick à l'autre : prochain index, trouvailles, classes déjà triées.
#[derive(Default)]
pub struct ResourceScan {
    next: u32,
    found: Vec<Resource>,
    /// Classe → nom de ressource, et si c'est un composant de rochers instanciés plutôt qu'un générateur.
    kinds: HashMap<u64, Option<(String, bool)>>,
    /// Jeux d'attributs des autres personnages (PNJ, créatures) croisés pendant le passage en cours.
    foes_found: Vec<Foe>,
    /// Ceux du dernier passage complet, avec leur dernière vie lue (coups portés).
    pub foes: Vec<Foe>,
    /// Lieux nommés chargés autour du joueur : passage en cours, puis dernier passage complet.
    places_found: Vec<Place>,
    pub places: Vec<Place>,
    /// Classes déjà vues : `DuneStaticMarkerActor` (lieu nommé) ou non.
    markers: HashMap<u64, bool>,
    /// Caches de `Ue` (noms, offsets des champs) gardés d'un morceau de relevé à l'autre : `Ue` est rouvert à chaque tick.
    names: HashMap<u32, String>,
    fields: HashMap<(u64, &'static str), Option<u64>>,
}

/// Autre personnage suivi pour les coups portés : son jeu d'attributs, son acteur et sa dernière vie lue.
#[derive(Clone, Copy, Debug)]
pub struct Foe {
    set: u64,
    index: u32,
    class: u64,
    actor: u64,
    health: Option<f32>,
}

/// Coup porté : vie retirée à un personnage proche ; `kill` quand elle tombe à 0.
/// `dist` (cm) et `off_aim` (degrés entre la visée et la cible) servent à ne garder que les coups du joueur.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Hit {
    pub damage: f32,
    pub kill: bool,
    #[serde(skip)]
    pub dist: f64,
    #[serde(skip)]
    pub off_aim: f64,
}

/// Ce qui trahit une attaque du joueur : munitions de l'arme en main, frappes au corps à corps.
#[derive(Clone, Copy, Debug)]
struct Attack {
    /// Emplacement du pointeur `m_WeaponComponent` du personnage, et offset de `m_CurrentAmmo` dans le composant.
    weapon_at: u64,
    ammo: Option<u64>,
    /// `m_MeleeHitActors` (TSet) : nombre d'éléments de son tableau à +8.
    melee_at: Option<u64>,
}

/// Distance (cm) au-delà de laquelle une baisse de vie n'est pas comptée comme un coup du joueur.
const HIT_RANGE: f64 = 15_000.0;

/// Générateur de ressources : nom (voir `resource_name`), position (cm) et délai de réapparition (s).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Resource {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub respawn: f32,
}

/// Limites de la carte de la région, en cm.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

/// Zone de la carte : type (valeur brute du jeu) et cercles [x, y, rayon] en cm.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Area {
    pub kind: u8,
    pub circles: Vec<[f64; 3]>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Poi {
    pub kind: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// Lieu nommé (« Communications du sud ») et sa position, en cm.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Place {
    pub name: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MapData {
    /// Calque de carte de la région, ex. « BP_MapLayer_Survival_1_C_… » (Bassin de Hagga).
    pub layer: String,
    pub bounds: Bounds,
    pub areas: Vec<Area>,
    pub pois: Vec<Poi>,
    pub places: Vec<Place>,
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
    rotation: u64,
    attach_parent: u64,
    /// RootComponent d'un acteur (même offset pour le personnage et les PNJ).
    root_component: u64,
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
    heatstroke: u64,
}

#[derive(Clone, Debug)]
pub struct Player {
    character: u64,
    index: u32,
    class: u64,
    stats: u64,
    /// Classe des jeux d'attributs (DuneCharacterAttributeSet), partagée par les PNJ.
    stats_class: u64,
    hydration: u64,
    root: u64,
    /// TimeOfDayComponent et offset de m_TimeOfDayServer.
    time_of_day: Option<Watched>,
    /// InventoryVolumeTracker du sac : maximum à +0x38, volume courant à +0x3C (champs internes).
    backpack: Option<u64>,
    /// Liste interne des objets du sac et nombre d'emplacements.
    slots: Option<Slots>,
    /// Menace du ver.
    worm: Option<Worm>,
    /// Arme en main, à bord d'un véhicule.
    armed: Option<Flag>,
    vehicle: Option<Flag>,
    /// FText du nom de la zone (widget du HUD).
    zone: Option<u64>,
    /// Orientation de la caméra (souris) : ControlRotation du contrôleur du joueur (FRotator).
    camera: Option<u64>,
    /// Munitions et frappes au corps à corps, pour attribuer les coups portés.
    attack: Option<Attack>,
    /// Jeux d'attributs du personnage : (classe, objet).
    sets: Vec<(String, u64)>,
    fields: Fields,
}

#[derive(Clone, Copy, Debug)]
struct Slots {
    /// TArray des objets du sac : nombre à +8.
    items: u64,
    max: u32,
}

/// Champs du personnage (`BP_DunePlayerCharacter_C`), confirmés en jeu le 2026-10-28 avec `sietch-scan ue-diff`.
/// Arme : booléen. Véhicule : siège occupé (pointeur faible, toutes les places), sinon conducteur seul.
pub const ARMED_FIELDS: &[&str] = &["m_bHasWeaponInHand"];
pub const VEHICLE_FIELDS: &[&str] = &["m_CurrentSeat", "m_bIsDriving"];

/// Chaîne affichée d'un `FText` : données du texte → historique (+0x10) → chaîne affichée (+0x40, `FString`).
/// Relevé sur le widget du nom de zone (2026-10-28) : c'est la chaîne localisée, pas le texte source anglais.
fn ftext(m: &dyn Mem, at: u64) -> Option<String> {
    let history = ptr(m, ptr(m, at) + 0x10);
    let s = ptr(m, history + 0x40);
    let b = read::<12>(m, s)?;
    let (data, len) = (u64_at(&b, 0), u32_at(&b, 8) as usize);
    if data == 0 || !(2..=128).contains(&len) {
        return None;
    }
    let mut buf = vec![0u8; (len - 1) * 2];
    (m.read_into(data, &mut buf) == buf.len())
        .then(|| String::from_utf16_lossy(&buf.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<_>>()))
        // Offsets internes (+0x10, +0x40) : une chaîne illisible (caractères de contrôle, UTF-16 invalide) veut dire
        // qu'un patch les a déplacés ; mieux vaut rien qu'un nom de zone en charabia.
        .filter(|s| !s.trim().is_empty() && !s.chars().any(|c| c.is_control() || c == char::REPLACEMENT_CHARACTER))
}

/// Indicateur lu dans un objet : booléen (octet et masque) ou pointeur (non nul = vrai).
#[derive(Clone, Copy, Debug)]
enum Flag {
    Bool { at: u64, mask: u8 },
    Ptr { at: u64 },
}

impl Flag {
    fn read(self, m: &dyn Mem) -> Option<bool> {
        match self {
            Flag::Bool { at, mask } => read::<1>(m, at).map(|b| b[0] & mask != 0),
            Flag::Ptr { at } => read::<8>(m, at).map(|b| u64::from_le_bytes(b) != 0),
        }
    }
}

/// Composant de menace du ver et offsets de la valeur courante et du seuil d'attaque (f32).
#[derive(Clone, Copy, Debug)]
struct Worm {
    comp: u64,
    value: u64,
    threshold: u64,
}

/// Une valeur de l'écran « Stats brutes ».
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RawStat {
    pub set: String,
    pub name: String,
    pub value: f32,
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
    /// Chaleur à partir de laquelle survient le coup de chaleur.
    pub heatstroke: f32,
    /// Heure du jeu, en heures (7.5 = 07:30) ; `None` si elle n'a pas été trouvée.
    pub time_of_day: Option<f32>,
    /// Volume du sac et son maximum ; `None` s'il n'a pas été trouvé.
    pub volume: Option<f32>,
    pub volume_max: Option<f32>,
    /// Emplacements occupés du sac et leur nombre ; `None` s'ils n'ont pas été trouvés.
    pub slots: Option<u32>,
    pub slots_max: Option<u32>,
    /// Menace du ver en % du seuil d'attaque (100 = le ver attaque) ; `None` si elle n'a pas été trouvée.
    pub worm_threat: Option<f32>,
    /// Arme en main, à bord d'un véhicule ; `None` tant que le champ n'est pas connu.
    pub armed: Option<bool>,
    pub in_vehicle: Option<bool>,
    /// Nom de la zone affiché par le jeu (« Sud du Bassin de Hagga ») ; None s'il n'a pas été trouvé.
    pub zone: Option<String>,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    /// Orientation (degrés, 0 = +x soit l'est sur la carte, 90 = +y soit le sud).
    pub yaw: f64,
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
            heatstroke: r(self.heatstroke),
            // À la minute du jeu près.
            time_of_day: self.time_of_day.map(|t| (t * 60.0).floor() / 60.0),
            volume: self.volume.map(r),
            volume_max: self.volume_max.map(r),
            slots: self.slots,
            slots_max: self.slots_max,
            // Au pour cent près.
            worm_threat: self.worm_threat.map(|v| v.round()),
            armed: self.armed,
            in_vehicle: self.in_vehicle,
            zone: self.zone.clone(),
            x: m(self.x),
            y: m(self.y),
            z: m(self.z),
            // Au degré près.
            yaw: self.yaw.round(),
        }
    }
}

impl Player {
    /// Lectures facultatives, trouvées ou non (Paramètres › À propos) : une absence après un patch se voit ici.
    pub fn checks(&self) -> Vec<(&'static str, bool)> {
        vec![
            ("Heure du jeu", self.time_of_day.is_some()),
            ("Volume du sac", self.backpack.is_some()),
            ("Emplacements du sac", self.slots.is_some()),
            ("Menace du ver", self.worm.is_some()),
            ("Arme en main", self.armed.is_some()),
            ("Véhicule", self.vehicle.is_some()),
            ("Nom de la zone", self.zone.is_some()),
            ("Caméra", self.camera.is_some()),
            ("Munitions", self.attack.as_ref().is_some_and(|a| a.ammo.is_some())),
        ]
    }

    /// Le personnage (et le composant de l'heure) sont-ils toujours là ? Sinon, tout est à retrouver.
    fn alive(&self, m: &dyn Mem) -> bool {
        still_there(m, self.character, self.index, self.class)
            && self.time_of_day.is_none_or(|w| still_there(m, w.obj, w.index, w.class))
    }

    /// Munitions de l'arme en main et nombre de personnages dans la frappe au corps à corps en cours.
    pub fn attack(&self, m: &dyn Mem) -> (Option<i32>, Option<u32>) {
        let Some(a) = self.attack else { return (None, None) };
        let ammo = a.ammo.and_then(|off| {
            let w = ptr(m, a.weapon_at);
            (w != 0).then(|| read::<4>(m, w + off).map(i32::from_le_bytes)).flatten()
        });
        (ammo, a.melee_at.and_then(|at| read::<4>(m, at + 8).map(u32::from_le_bytes)))
    }

    /// Coups portés depuis la dernière lecture : baisse de la vie des personnages à moins de `HIT_RANGE`.
    /// La première lecture d'un personnage ne compte pas (vie de départ).
    pub fn hits(&self, m: &dyn Mem, foes: &mut [Foe], at: [f64; 3], yaw: f64) -> Vec<Hit> {
        let f = &self.fields;
        let mut hits = Vec::new();
        for foe in foes.iter_mut() {
            if !still_there(m, foe.set, foe.index, foe.class) {
                foe.health = None;
                continue;
            }
            let Some(now) = read::<4>(m, ptr(m, foe.set + f.health + 0x10)).map(f32::from_le_bytes).filter(|v| v.is_finite())
            else {
                continue;
            };
            let before = foe.health.replace(now);
            let Some(before) = before.filter(|b| now < *b - 0.5) else { continue };
            let Some(loc) = read::<24>(m, ptr(m, foe.actor + f.root_component) + f.location) else { continue };
            let v = |i: usize| f64::from_le_bytes(loc[i..i + 8].try_into().unwrap());
            let (dx, dy, dz) = (v(0) - at[0], v(8) - at[1], v(16) - at[2]);
            let dist = (dx * dx + dy * dy + dz * dz).sqrt();
            if dist <= HIT_RANGE {
                let off_aim = ((dy.atan2(dx).to_degrees() - yaw + 540.0) % 360.0 - 180.0).abs();
                hits.push(Hit { damage: before - now, kill: now <= 0.0 && before > 0.0, dist, off_aim });
            }
        }
        hits
    }

    /// Orientation de la caméra (la souris), en degrés : la mini-carte tourne avec elle.
    pub fn camera_yaw(&self, m: &dyn Mem) -> Option<f64> {
        read::<24>(m, self.camera?).map(|b| f64::from_le_bytes(b[8..16].try_into().unwrap())).filter(|y| y.is_finite())
    }

    /// Position (x, y, z) et orientation du corps seules : quelques lectures, pour le suivi rapide de la carte.
    pub fn pose(&self, m: &dyn Mem) -> Option<[f64; 4]> {
        if !self.alive(m) {
            return None;
        }
        let f = &self.fields;
        // À bord d'un véhicule, le personnage est attaché à un siège : sa position devient relative au siège.
        // On remonte les attaches jusqu'au composant racine (le véhicule), dont la position est celle du monde.
        let mut top = self.root;
        for _ in 0..8 {
            match ptr(m, top + f.attach_parent) {
                0 => break,
                p => top = p,
            }
        }
        let loc = read::<24>(m, top + f.location)?;
        let v = |i: usize| f64::from_le_bytes(loc[i..i + 8].try_into().unwrap());
        // FRotator : Pitch, Yaw, Roll (f64).
        let yaw = read::<24>(m, top + f.rotation).map(|b| f64::from_le_bytes(b[8..16].try_into().unwrap()))?;
        [v(0), v(8), v(16), yaw].iter().all(|n| n.is_finite()).then_some([v(0), v(8), v(16), yaw])
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
        let [x, y, z, yaw] = self.pose(m)?;
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
            heatstroke: attr(self.hydration, f.heatstroke)?,
            time_of_day: self
                .time_of_day
                .and_then(|w| read::<4>(m, w.obj + w.offset).map(f32::from_le_bytes))
                .filter(|t| (0.0..=24.0).contains(t)),
            // Champs internes du suivi : on ne les garde que vraisemblables (maximum positif, volume entre 0 et deux fois
            // le maximum, la surcharge comprise), sinon un patch afficherait n'importe quoi.
            volume_max: self.backpack.and_then(|t| read::<4>(m, t + 0x38).map(f32::from_le_bytes)).filter(|v| v.is_finite() && *v > 0.0),
            volume: self.backpack.and_then(|t| {
                let [max, v] = [0x38, 0x3C].map(|o| read::<4>(m, t + o).map(f32::from_le_bytes));
                v.zip(max).filter(|(v, max)| v.is_finite() && (0.0..=max * 2.0).contains(v)).map(|(v, _)| v)
            }),
            slots: self.slots.and_then(|s| read::<4>(m, s.items + 8).map(u32::from_le_bytes).filter(|n| *n <= s.max)),
            slots_max: self.slots.map(|s| s.max),
            worm_threat: self.worm.and_then(|w| {
                let f = |off: u64| read::<4>(m, w.comp + off).map(f32::from_le_bytes).filter(|v| v.is_finite());
                let (v, t) = (f(w.value)?, f(w.threshold)?);
                (t > 0.0).then(|| (v / t * 100.0).max(0.0))
            }),
            armed: self.armed.and_then(|f| f.read(m)),
            in_vehicle: self.vehicle.and_then(|f| f.read(m)),
            zone: self.zone.and_then(|t| ftext(m, t)),
            x,
            y,
            z,
            yaw,
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
    fn classifies_terrain_blocks() {
        assert_eq!(poi_kind("CB_Arrakis_Ecolab_Bronze_03"), Some("station"));
        assert_eq!(poi_kind("CB_SB_SandFliesBase_05"), Some("base"));
        assert_eq!(poi_kind("CB_Arrakis_WreckedShip_02"), Some("epave"));
        assert_eq!(poi_kind("CB_Arrakis_Generic_12"), None, "relief ignoré");
        assert_eq!(poi_kind("CB_ShieldW_CliffFormation_1"), None);
        assert_eq!(resource_name("BP_AzuriteOre_A_Spawner_C"), "AzuriteOre");
        assert_eq!(resource_name("BP_Azurite_Pickup_B_Spawner_C"), "Azurite_Pickup");
        assert_eq!(resource_name("BP_ImpureFuel_Spawner_C"), "ImpureFuel");
        assert_eq!(resource_name("BP_Bauxite_Static_D_Component_C"), "Bauxite_Static");
        assert_eq!(resource_name("BP_BurroBush_Component_C"), "BurroBush");
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
    #[test]
    fn reads_objects_in_bulk() {
        // Table à 0x1100 : blocs à 0x1200 (un seul, à 0x1300), 3 objets ; le n° 1 est vide.
        let mut mem = vec![0u8; 0x400];
        put(&mut mem, 0x1100, &0x1200u64.to_le_bytes());
        put(&mut mem, 0x1114, &3u32.to_le_bytes());
        put(&mut mem, 0x1200, &0x1300u64.to_le_bytes());
        put(&mut mem, 0x1300, &0x1400u64.to_le_bytes());
        put(&mut mem, 0x1300 + 48, &0x1500u64.to_le_bytes());
        let m = Fake(mem);
        let ue = Ue { m: &m, blocks: 0, table: 0x1100, stride: 24, names: HashMap::new(), fields: HashMap::new(), missing: Vec::new() };
        assert_eq!(ue.objects(0, u32::MAX), vec![(0, 0x1400), (2, 0x1500)]);
        assert_eq!(ue.objects(1, 3), vec![(2, 0x1500)]);
        assert_eq!(ue.objects(0, 1), ue.objects(0, 1).iter().map(|&(i, _)| (i, ue.object(i).unwrap())).collect::<Vec<_>>());
    }

    #[test]
    fn ftext_rejects_garbage() {
        // FText à 0x1000 → données 0x1100 → historique 0x1200 (+0x40 → FString 0x1280) → caractères à 0x1300.
        let text = |chars: &[u16]| {
            let mut mem = vec![0u8; 0x400];
            put(&mut mem, 0x1000, &0x1100u64.to_le_bytes());
            put(&mut mem, 0x1110, &0x1200u64.to_le_bytes());
            put(&mut mem, 0x1240, &0x1280u64.to_le_bytes());
            put(&mut mem, 0x1280, &0x1300u64.to_le_bytes());
            put(&mut mem, 0x1288, &(chars.len() as u32 + 1).to_le_bytes());
            put(&mut mem, 0x1300, &chars.iter().flat_map(|c| c.to_le_bytes()).collect::<Vec<_>>());
            ftext(&Fake(mem), 0x1000)
        };
        assert_eq!(text(&"Le Bouclier".encode_utf16().collect::<Vec<_>>()).as_deref(), Some("Le Bouclier"));
        assert_eq!(text(&[0x41, 0x01, 0x42]), None, "caractère de contrôle");
        assert_eq!(text(&[0x41, 0xD800, 0x42]), None, "UTF-16 invalide");
    }
}
