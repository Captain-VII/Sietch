//! sietch-scan : cherche la position du joueur dans la mémoire de Dune: Awakening, pour remplir
//! `pointerChain` dans `position.json`. Méthode : docs/position-en-direct.md.
//!
//! Garde-fous (les mêmes que `live.rs`) :
//! - LECTURE SEULE : le jeu est ouvert avec PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, rien d'autre ;
//! - chaque commande vérifie que BattlEye est absent avant d'ouvrir le jeu, puis toutes les 2 secondes
//!   pendant les longs balayages ; s'il apparaît, l'outil lâche le jeu et s'arrête ;
//! - liste des processus illisible = BattlEye supposé actif.
//!
//! L'état (candidats, chaînes) reste dans %TEMP%\sietch-scan entre deux commandes.

#[cfg(not(windows))]
fn main() {
    eprintln!("sietch-scan ne fonctionne que sous Windows.");
    std::process::exit(1);
}

#[cfg(windows)]
fn main() -> std::process::ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match scan::run(&args) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Erreur : {e}");
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(windows)]
mod scan {
    use std::collections::HashSet;
    use std::fs;
    use std::io::{BufReader, BufWriter, Read, Write};
    use std::path::PathBuf;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, MODULEENTRY32W, Module32FirstW, Module32NextW, PROCESSENTRY32W, Process32FirstW,
        Process32NextW, TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Memory::{
        MEM_COMMIT, MEM_IMAGE, MEM_PRIVATE, MEMORY_BASIC_INFORMATION, PAGE_EXECUTE_READ, PAGE_EXECUTE_READWRITE,
        PAGE_EXECUTE_WRITECOPY, PAGE_GUARD, PAGE_NOACCESS, PAGE_READONLY, PAGE_READWRITE, PAGE_WRITECOPY,
        VirtualQueryEx,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};

    const GAME: &str = "DuneSandbox-Win64-Shipping.exe";
    const BATTLEYE: [&str; 3] = ["BEService.exe", "BEService_x64.exe", "DuneSandbox_BE.exe"];
    const CHUNK: usize = 16 << 20;
    /// Au-delà, la liste de pointeurs sature la mémoire : on arrête d'ajouter des nœuds.
    const MAX_NODES_PER_LEVEL: usize = 2_000_000;
    const MAX_CHAINS: usize = 200_000;

    const USAGE: &str = "\
sietch-scan — position du joueur, lecture seule, jeu SANS BattlEye uniquement

  status                     jeu et BattlEye détectés ?
  first                      premier balayage : tous les triplets X, Y, Z plausibles
  filter up|down|still|moved|changed|any
                             garde les candidats dont Z a monté / baissé, qui n'ont pas bougé,
                             dont X/Y ont bougé (> 50 cm), qui ont changé, ou tous (valeurs relues)
  near <X> <Y> [rayon]       garde les candidats à moins de rayon cm de (X, Y) (500 par défaut)
  list [n]                   affiche les n premiers candidats (20 par défaut)
  watch <adresse> [s]        affiche X, Y, Z toutes les 0,5 s pendant s secondes (10 par défaut)
  pointers <adresse|cands> [profondeur] [décalage max]
                             cherche les chaînes de pointeurs vers l'adresse de X, ou vers tous les
                             candidats restants avec « cands » (5, 0x1000 par défaut)
  check [adresse]            résout les chaînes enregistrées ; avec une adresse, ne garde que celles
                             qui y mènent encore (après une relance du jeu)
  check near <X> <Y> [rayon] ne garde que les chaînes qui donnent une position à moins de rayon cm
                             de (X, Y) (300 par défaut)
  show [n]                   affiche les n premières chaînes au format de position.json

Structures d'Unreal Engine (noms et objets du jeu) :
  ue                         trouve la table des noms et la table des objets, et en affiche un extrait
  ue-find <texte> [n]        objets dont le nom ou la classe contient le texte (40 par défaut)
  ue-fields <Classe>         champs d'une classe ou structure (offset, type, nom), parents compris
  ue-dump <n|adresse>        valeurs des champs d'un objet (numéro de ue-find ou adresse)
  ue-classes [Outer] [n]     classes les plus nombreuses parmi les objets de l'Outer (PersistentLevel)
  raw <adresse> [octets]    contenu brut (hexadécimal, flottants, doubles), 128 octets par défaut";

    // ---------- Structures d'Unreal Engine ----------
    //
    // Table des noms (FNamePool) : blocs de 128 Kio ; une entrée = en-tête u16 (bit 0 : UTF-16,
    // longueur = en-tête >> 6) puis les caractères, alignée sur 2 octets. Le bloc 0 commence par
    // « None » puis « ByteProperty ». FName n → bloc n >> 16, décalage (n & 0xFFFF) * 2.
    // Table des objets (FChunkedFixedUObjectArray) : Objects**, PreAllocated*, Max, Num, MaxChunks,
    // NumChunks ; 65 536 objets par paquet. UObject : ClassPrivate +0x10, NamePrivate +0x18, Outer +0x20,
    // InternalIndex +0x0C (sert à vérifier qu'on lit bien la table).

    const OBJ_PER_CHUNK: u64 = 65_536;

    fn u32_at(b: &[u8], i: usize) -> u32 {
        u32::from_le_bytes(b[i..i + 4].try_into().unwrap())
    }

    struct Ue {
        /// Adresse de Blocks[0] dans la table des noms.
        blocks: u64,
        /// Adresse de la table des objets dans l'image du jeu (FChunkedFixedUObjectArray).
        table: u64,
        /// Tableau des paquets d'objets (champ Objects).
        objects: u64,
        num: u32,
        stride: u64,
    }

    impl Ue {
        fn at(g: &Game, blocks: u64, table: u64, stride: u64) -> Result<Self, String> {
            let b = g.read::<24>(table).ok_or("table des objets illisible")?;
            Ok(Ue { blocks, table, objects: u(&b, 0), num: u32_at(&b, 20), stride })
        }

        /// Tables retrouvées par `ue` (ue.txt), sinon nouvelle recherche.
        fn load(g: &mut Game) -> Result<Self, String> {
            let text = fs::read_to_string(ue_path()?).unwrap_or_default();
            let get = |k: &str| {
                text.lines().find_map(|l| l.strip_prefix(k)).and_then(|v| u64::from_str_radix(v.trim_start_matches("0x"), 16).ok())
            };
            if let (Some(b), Some(t), Some(s)) = (get("blocks_rva=0x"), get("table_rva=0x"), get("stride=0x")) {
                let ue = Ue::at(g, g.base + b, g.base + t, s)?;
                if ue.entry(g, 0).as_deref() == Some("None") {
                    return Ok(ue);
                }
            }
            let ue = find_tables(g)?;
            ue.save(g)?;
            Ok(ue)
        }

        fn save(&self, g: &Game) -> Result<(), String> {
            let text = format!(
                "blocks_rva=0x{:X}\ntable_rva=0x{:X}\nstride=0x{:X}\n",
                self.blocks - g.base,
                self.table - g.base,
                self.stride
            );
            fs::write(ue_path()?, text).map_err(|e| e.to_string())
        }

        fn entry(&self, g: &Game, idx: u32) -> Option<String> {
            let block = u(&g.read::<8>(self.blocks + (idx >> 16) as u64 * 8)?, 0);
            if block == 0 {
                return None;
            }
            let at = block + (idx & 0xFFFF) as u64 * 2;
            let hdr = u16::from_le_bytes(g.read::<2>(at)?);
            let (len, wide) = ((hdr >> 6) as usize, hdr & 1 == 1);
            if len == 0 || len > 1024 {
                return None;
            }
            let mut b = vec![0u8; if wide { len * 2 } else { len }];
            (g.read_into(at + 2, &mut b) == b.len()).then(|| {
                if wide {
                    String::from_utf16_lossy(&b.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<_>>())
                } else {
                    b.iter().map(|&c| c as char).collect()
                }
            })
        }

        /// FName (index, numéro) → texte, « Nom_3 » quand le numéro vaut 4.
        fn fname(&self, g: &Game, at: u64) -> Option<String> {
            let b = g.read::<8>(at)?;
            let (idx, number) = (u32_at(&b, 0), u32_at(&b, 4));
            let base = self.entry(g, idx)?;
            Some(if number > 0 { format!("{base}_{}", number - 1) } else { base })
        }

        fn object(&self, g: &Game, i: u32) -> Option<u64> {
            if i >= self.num {
                return None;
            }
            let chunk = u(&g.read::<8>(self.objects + (i as u64 / OBJ_PER_CHUNK) * 8)?, 0);
            let obj = u(&g.read::<8>(chunk + (i as u64 % OBJ_PER_CHUNK) * self.stride)?, 0);
            (obj != 0).then_some(obj)
        }

        fn name_of(&self, g: &Game, obj: u64) -> String {
            self.fname(g, obj + 0x18).unwrap_or_else(|| "?".into())
        }

        fn class_of(&self, g: &Game, obj: u64) -> String {
            g.read::<8>(obj + 0x10).map(|b| u(&b, 0)).filter(|&c| c != 0).map(|c| self.name_of(g, c)).unwrap_or_else(|| "?".into())
        }
    }

    /// Bloc 0 de la table des noms : « None » suivi de « ByteProperty », dans le tas du jeu.
    fn find_name_block(g: &mut Game) -> Option<u64> {
        let regions: Vec<Region> = g.regions().into_iter().filter(|r| r.private).collect();
        let mut found = None;
        g.each_chunk(&regions, |_, base, buf| {
            if found.is_some() || buf.len() < 20 {
                return;
            }
            for i in (0..buf.len() - 20).step_by(2) {
                if &buf[i + 2..i + 6] == b"None"
                    && &buf[i + 8..i + 20] == b"ByteProperty"
                    && u16::from_le_bytes([buf[i], buf[i + 1]]) >> 6 == 4
                {
                    found = Some(base + i as u64);
                    return;
                }
            }
        });
        found
    }

    /// Lit l'image du jeu (exe) par blocs alignés sur 8 octets : `visit(adresse, octets)`.
    fn each_module_chunk(g: &mut Game, mut visit: impl FnMut(u64, &[u8]) -> bool) {
        let regions: Vec<Region> = g.regions().into_iter().filter(|r| !r.private && g.in_module(r.base)).collect();
        g.each_chunk(&regions, |_, base, buf| {
            visit(base, buf);
        });
    }

    fn find_tables(g: &mut Game) -> Result<Ue, String> {
        eprintln!("Recherche de la table des noms dans le tas (une à deux minutes)…");
        let block0 = find_name_block(g).ok_or("bloc « None / ByteProperty » introuvable")?;
        eprintln!("Bloc 0 des noms : 0x{block0:X}. Recherche des tables dans l'image du jeu…");
        let mut blocks = None;
        let mut objects = None;
        each_module_chunk(g, |base, buf| {
            for i in (0..buf.len().saturating_sub(32)).step_by(8) {
                if blocks.is_none() && u(buf, i) == block0 {
                    blocks = Some(base + i as u64);
                }
                if objects.is_none() {
                    let (max, num) = (u32_at(buf, i + 16), u32_at(buf, i + 20));
                    let (max_chunks, num_chunks) = (u32_at(buf, i + 24), u32_at(buf, i + 28));
                    if u(buf, i) != 0
                        && max >= 65_536
                        && max % 65_536 == 0
                        && max_chunks == max / 65_536
                        && num > 10_000
                        && num <= max
                        && num_chunks == num.div_ceil(65_536)
                    {
                        objects = Some((base + i as u64, num));
                    }
                }
            }
            blocks.is_some() && objects.is_some()
        });
        let blocks = blocks.ok_or("pointeur vers le bloc 0 des noms introuvable dans l'image du jeu")?;
        let (table, _) = objects.ok_or("table des objets introuvable dans l'image du jeu")?;
        // Taille d'un FUObjectItem : celle pour laquelle InternalIndex correspond à la position.
        for stride in [24u64, 16, 32] {
            let ue = Ue::at(g, blocks, table, stride)?;
            let ok = (1..200u32)
                .filter(|&i| ue.object(g, i).and_then(|o| g.read::<4>(o + 0xC)).is_some_and(|b| u32_at(&b, 0) == i))
                .count();
            if ok > 150 {
                return Ok(ue);
            }
        }
        Err("table des objets trouvée mais InternalIndex ne correspond pas (disposition d'UObject différente)".into())
    }

    fn ue_path() -> Result<PathBuf, String> {
        Ok(state_dir()?.join("ue.txt"))
    }

    fn ue_find_tables() -> Result<(), String> {
        let mut g = Game::open()?;
        let ue = find_tables(&mut g)?;
        println!("Table des noms : Blocks[0] à 0x{:X} (image + 0x{:X})", ue.blocks, ue.blocks - g.base);
        let names: Vec<String> = (0..12u32)
            .scan(0u32, |idx, _| {
                let name = ue.entry(&g, *idx)?;
                *idx += (2 + name.len() as u32).div_ceil(2);
                Some(name)
            })
            .collect();
        println!("  premiers noms : {}", names.join(", "));
        println!("Table des objets : {} objets, FUObjectItem de {} octets", ue.num, ue.stride);
        for i in 0..12 {
            if let Some(o) = ue.object(&g, i) {
                println!("  {i:>6}  {:<28} {}", ue.class_of(&g, o), ue.name_of(&g, o));
            }
        }
        ue.save(&g)?;
        println!("Enregistré dans {}", ue_path()?.display());
        Ok(())
    }

    /// Objets dont le nom ou la classe contient le texte (sans tenir compte de la casse).
    fn ue_find(text: &str, n: usize) -> Result<(), String> {
        let mut g = Game::open()?;
        let ue = Ue::load(&mut g)?;
        let needle = text.to_lowercase();
        let mut shown = 0;
        for i in 0..ue.num {
            g.guard();
            let Some(o) = ue.object(&g, i) else { continue };
            let (name, class) = (ue.name_of(&g, o), ue.class_of(&g, o));
            if name.to_lowercase().contains(&needle) || class.to_lowercase().contains(&needle) {
                let outer = g.read::<8>(o + 0x20).map(|b| u(&b, 0)).filter(|&p| p != 0).map(|p| ue.name_of(&g, p));
                println!("{i:>7}  0x{o:X}  {class:<32} {name}  ← {}", outer.unwrap_or_default());
                shown += 1;
                if shown >= n {
                    println!("… (limite de {n} atteinte)");
                    break;
                }
            }
        }
        Ok(())
    }

    // Réflexion (UE 5) : UStruct.SuperStruct +0x40, ChildProperties +0x50 ; FField.ClassPrivate +0x08,
    // Next +0x20, NamePrivate +0x28 ; FProperty.Offset_Internal +0x4C ; FStructProperty.Struct et
    // FObjectProperty.PropertyClass +0x78 ; FBoolProperty : ByteOffset +0x79, FieldMask +0x7B ;
    // FFieldClass.Name +0x00.
    struct Field {
        name: String,
        kind: String,
        offset: u32,
        at: u64,
    }

    impl Ue {
        /// Champs d'une classe ou d'une structure, ceux des parents compris (les parents d'abord).
        fn fields(&self, g: &Game, class: u64) -> Vec<(String, Vec<Field>)> {
            let mut out = Vec::new();
            let mut c = class;
            for _ in 0..32 {
                if c == 0 {
                    break;
                }
                let mut list = Vec::new();
                let mut f = g.read::<8>(c + 0x50).map(|b| u(&b, 0)).unwrap_or(0);
                while f != 0 && list.len() < 2000 {
                    let kind = g.read::<8>(f + 0x08).map(|b| u(&b, 0)).and_then(|k| self.fname(g, k)).unwrap_or_default();
                    let name = self.fname(g, f + 0x28).unwrap_or_default();
                    let offset = g.read::<4>(f + 0x4C).map(|b| u32_at(&b, 0)).unwrap_or(0);
                    list.push(Field { name, kind, offset, at: f });
                    f = g.read::<8>(f + 0x20).map(|b| u(&b, 0)).unwrap_or(0);
                }
                out.push((self.name_of(g, c), list));
                c = g.read::<8>(c + 0x40).map(|b| u(&b, 0)).unwrap_or(0);
            }
            out.reverse();
            out
        }

        /// Classe ou structure (Class, ScriptStruct, BlueprintGeneratedClass…) portant exactement ce nom.
        fn find_type(&self, g: &mut Game, name: &str) -> Option<u64> {
            (0..self.num).find_map(|i| {
                g.guard();
                let o = self.object(g, i)?;
                (self.name_of(g, o) == name && matches!(self.class_of(g, o).as_str(), "Class" | "ScriptStruct" | "BlueprintGeneratedClass" | "UserDefinedStruct"))
                    .then_some(o)
            })
        }

        fn ptr(&self, g: &Game, at: u64) -> u64 {
            g.read::<8>(at).map(|b| u(&b, 0)).unwrap_or(0)
        }

        /// Valeur lisible d'un champ d'un objet, pour les types simples.
        fn value(&self, g: &Game, obj: u64, fld: &Field) -> Option<String> {
            let at = obj + fld.offset as u64;
            Some(match fld.kind.as_str() {
                "FloatProperty" => format!("{:.3}", f32::from_le_bytes(g.read::<4>(at)?)),
                "DoubleProperty" => format!("{:.3}", f(&g.read::<8>(at)?, 0)),
                "IntProperty" => i32::from_le_bytes(g.read::<4>(at)?).to_string(),
                "UInt32Property" => u32_at(&g.read::<4>(at)?, 0).to_string(),
                "Int64Property" => i64::from_le_bytes(g.read::<8>(at)?).to_string(),
                "ByteProperty" | "EnumProperty" => g.read::<1>(at)?[0].to_string(),
                "BoolProperty" => {
                    let b = g.read::<4>(fld.at + 0x78)?;
                    let byte = g.read::<1>(at + b[1] as u64)?[0];
                    (byte & b[3] != 0).to_string()
                }
                "NameProperty" => self.fname(g, at)?,
                "ObjectProperty" | "WeakObjectProperty" => {
                    let p = self.ptr(g, at);
                    if p == 0 { "nul".into() } else { format!("0x{p:X} {} {}", self.class_of(g, p), self.name_of(g, p)) }
                }
                "StructProperty" => {
                    let s = self.name_of(g, self.ptr(g, fld.at + 0x78));
                    let size = g.read::<4>(fld.at + 0x3C).map(|b| u32_at(&b, 0)).unwrap_or(0);
                    if s.ends_with("GameplayAttributeData") && size > 16 {
                        // FglGameplayAttributeData (vie) : la valeur à jour n'est pas dans la structure, mais
                        // dans un petit bloc pointé à +0x10 (premier flottant). CurrentValue (+0xC) reste figée.
                        let cur = g.read::<4>(self.ptr(g, at + 0x10)).map(f32::from_le_bytes)?;
                        format!("{cur:.2} (bloc pointé, {s})")
                    } else if s.ends_with("GameplayAttributeData") {
                        // FGameplayAttributeData (et ses dérivées, comme FglGameplayAttributeData) : vtable, BaseValue, CurrentValue.
                        let b = g.read::<16>(at)?;
                        format!("{:.2} (base {:.2})", f32::from_le_bytes(b[12..16].try_into().unwrap()), f32::from_le_bytes(b[8..12].try_into().unwrap()))
                    } else {
                        format!("[{s}]")
                    }
                }
                _ => return None,
            })
        }
    }

    fn ue_fields(name: &str) -> Result<(), String> {
        let mut g = Game::open()?;
        let ue = Ue::load(&mut g)?;
        let class = ue.find_type(&mut g, name).ok_or("classe ou structure introuvable (nom exact attendu)")?;
        for (owner, list) in ue.fields(&g, class) {
            println!("— {owner}");
            for f in list {
                let detail = if f.kind == "StructProperty" || f.kind == "ObjectProperty" {
                    ue.name_of(&g, ue.ptr(&g, f.at + 0x78))
                } else {
                    String::new()
                };
                println!("  +0x{:04X}  {:<20} {} {detail}", f.offset, f.kind, f.name);
            }
        }
        Ok(())
    }

    /// Nombre d'objets par classe parmi ceux dont l'Outer porte ce nom (ex. PersistentLevel).
    fn ue_classes(outer: &str, n: usize) -> Result<(), String> {
        let mut g = Game::open()?;
        let ue = Ue::load(&mut g)?;
        let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for i in 0..ue.num {
            g.guard();
            let Some(o) = ue.object(&g, i) else { continue };
            let parent = ue.ptr(&g, o + 0x20);
            if parent != 0 && ue.name_of(&g, parent) == outer {
                *counts.entry(ue.class_of(&g, o)).or_default() += 1;
            }
        }
        let mut list: Vec<_> = counts.into_iter().collect();
        list.sort_by(|a, b| b.1.cmp(&a.1));
        for (class, count) in list.into_iter().take(n) {
            println!("{count:>6}  {class}");
        }
        Ok(())
    }

    /// Octets bruts à une adresse, par mots de 4 : hexadécimal, flottant, et pointeur sur 8 octets.
    fn raw(addr: u64, len: usize) -> Result<(), String> {
        let g = Game::open()?;
        let mut b = vec![0u8; len.div_ceil(8) * 8];
        let n = g.read_into(addr, &mut b);
        for i in (0..n.saturating_sub(7)).step_by(8) {
            let (lo, hi) = (u32_at(&b, i), u32_at(&b, i + 4));
            println!(
                "+0x{i:03X}  {lo:08X} {hi:08X}   {:>12.3} {:>12.3}   {:.3}",
                f32::from_bits(lo),
                f32::from_bits(hi),
                f(&b, i)
            );
        }
        Ok(())
    }

    /// Valeurs d'un objet (numéro de la table ou adresse), champ par champ.
    fn ue_dump(target: &str) -> Result<(), String> {
        let mut g = Game::open()?;
        let ue = Ue::load(&mut g)?;
        let n = parse_num(target)?;
        let obj = if n < ue.num as u64 { ue.object(&g, n as u32).ok_or("emplacement vide")? } else { n };
        let class = ue.ptr(&g, obj + 0x10);
        println!("0x{obj:X}  {} {}", ue.class_of(&g, obj), ue.name_of(&g, obj));
        for (owner, list) in ue.fields(&g, class) {
            println!("— {owner}");
            for f in &list {
                if let Some(v) = ue.value(&g, obj, f) {
                    println!("  +0x{:04X}  {:<32} {v}", f.offset, f.name);
                }
            }
        }
        Ok(())
    }

    pub fn run(args: &[String]) -> Result<(), String> {
        let cmd = args.first().map(String::as_str).unwrap_or("");
        let arg = |i: usize| args.get(i).map(String::as_str);
        match cmd {
            "status" => status(),
            "first" => first(),
            "filter" => filter(arg(1).ok_or("mode manquant (up, down, still, moved, changed)")?),
            "near" => near(
                parse_f(arg(1).ok_or("X manquant")?)?,
                parse_f(arg(2).ok_or("Y manquant")?)?,
                arg(3).map(parse_f).transpose()?.unwrap_or(500.0),
            ),
            "list" => list(arg(1).map(parse_num).transpose()?.unwrap_or(20) as usize),
            "watch" => watch(
                parse_num(arg(1).ok_or("adresse manquante")?)?,
                arg(2).map(parse_num).transpose()?.unwrap_or(10),
            ),
            "pointers" => pointers(
                match arg(1).ok_or("adresse manquante")? {
                    "cands" => load_cands()?.iter().map(|c| c.addr).collect(),
                    a => vec![parse_num(a)?],
                },
                arg(2).map(parse_num).transpose()?.unwrap_or(5) as usize,
                arg(3).map(parse_num).transpose()?.unwrap_or(0x1000),
            ),
            "check" if arg(1) == Some("near") => check(Target::Near(
                parse_f(arg(2).ok_or("X manquant")?)?,
                parse_f(arg(3).ok_or("Y manquant")?)?,
                arg(4).map(parse_f).transpose()?.unwrap_or(300.0),
            )),
            "check" => check(match arg(1) {
                Some(a) => Target::Addr(parse_num(a)?),
                None => Target::Any,
            }),
            "show" => show(arg(1).map(parse_num).transpose()?.unwrap_or(20) as usize),
            "ue" => ue_find_tables(),
            "ue-find" => ue_find(arg(1).ok_or("texte manquant")?, arg(2).map(parse_num).transpose()?.unwrap_or(40) as usize),
            "ue-fields" => ue_fields(arg(1).ok_or("nom de classe manquant")?),
            "ue-dump" => ue_dump(arg(1).ok_or("numéro ou adresse manquant")?),
            "ue-classes" => ue_classes(arg(1).unwrap_or("PersistentLevel"), arg(2).map(parse_num).transpose()?.unwrap_or(80) as usize),
            "raw" => raw(parse_num(arg(1).ok_or("adresse manquante")?)?, arg(2).map(parse_num).transpose()?.unwrap_or(128) as usize),
            _ => {
                println!("{USAGE}");
                Ok(())
            }
        }
    }

    /// Nombre décimal, ou hexadécimal s'il commence par 0x.
    fn parse_num(s: &str) -> Result<u64, String> {
        let r = match s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
            Some(h) => u64::from_str_radix(h, 16),
            None => s.parse(),
        };
        r.map_err(|_| format!("nombre illisible : {s}"))
    }

    fn parse_f(s: &str) -> Result<f64, String> {
        s.parse().map_err(|_| format!("nombre illisible : {s}"))
    }

    fn state_dir() -> Result<PathBuf, String> {
        let dir = std::env::temp_dir().join("sietch-scan");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir)
    }

    // ---------- Processus et garde-fou BattlEye ----------

    /// Noms (minuscules) et identifiants des processus. Vide = liste illisible.
    fn processes() -> Vec<(String, u32)> {
        let mut out = Vec::new();
        let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = unsafe { Process32FirstW(snap, &mut e) };
        while ok != 0 {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            out.push((String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase(), e.th32ProcessID));
            ok = unsafe { Process32NextW(snap, &mut e) };
        }
        unsafe { CloseHandle(snap) };
        out
    }

    /// Identifiant du jeu si, et seulement si, BattlEye est certainement absent.
    fn safe_game_pid() -> Result<u32, String> {
        let list = processes();
        if list.is_empty() {
            return Err("liste des processus illisible : BattlEye supposé actif, rien n'est lu.".into());
        }
        let be: Vec<String> = BATTLEYE.iter().map(|n| n.to_lowercase()).collect();
        if let Some((name, _)) = list.iter().find(|(n, _)| be.contains(n)) {
            return Err(format!("BattlEye est actif ({name}) : rien n'est lu. Relance le jeu en solo sans BattlEye."));
        }
        list.iter()
            .find(|(n, _)| *n == GAME.to_lowercase())
            .map(|(_, pid)| *pid)
            .ok_or_else(|| format!("{GAME} introuvable : le jeu n'est pas lancé."))
    }

    fn status() -> Result<(), String> {
        let pid = safe_game_pid()?;
        let g = Game::open()?;
        println!("Jeu : {GAME} (PID {pid}), BattlEye : absent.");
        println!("Module : base 0x{:X}, taille 0x{:X}.", g.base, g.size);
        Ok(())
    }

    // ---------- Accès en lecture seule ----------

    struct Region {
        base: u64,
        size: u64,
        private: bool,
    }

    struct Game {
        handle: HANDLE,
        base: u64,
        size: u64,
        last_check: Instant,
    }

    impl Drop for Game {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.handle) };
        }
    }

    impl Game {
        fn open() -> Result<Self, String> {
            let pid = safe_game_pid()?;
            let (base, size) = module(pid, GAME).ok_or("module du jeu introuvable")?;
            let handle = unsafe { OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, 0, pid) };
            if handle.is_null() {
                return Err("accès au jeu refusé".into());
            }
            Ok(Self { handle, base, size, last_check: Instant::now() })
        }

        /// À appeler souvent pendant les longs balayages : s'arrête net si BattlEye apparaît.
        fn guard(&mut self) {
            if self.last_check.elapsed() < Duration::from_secs(2) {
                return;
            }
            self.last_check = Instant::now();
            if let Err(e) = safe_game_pid() {
                unsafe { CloseHandle(self.handle) };
                eprintln!("Arrêt : {e}");
                std::process::exit(2);
            }
        }

        fn in_module(&self, addr: u64) -> bool {
            addr >= self.base && addr < self.base + self.size
        }

        /// Lit jusqu'à `buf.len()` octets ; renvoie le nombre d'octets lus.
        fn read_into(&self, addr: u64, buf: &mut [u8]) -> usize {
            let mut read = 0usize;
            let ok = unsafe {
                ReadProcessMemory(self.handle, addr as *const _, buf.as_mut_ptr() as *mut _, buf.len(), &mut read)
            };
            if ok != 0 { buf.len() } else { read }
        }

        fn read<const N: usize>(&self, addr: u64) -> Option<[u8; N]> {
            let mut b = [0u8; N];
            (self.read_into(addr, &mut b) == N).then_some(b)
        }

        fn triple(&self, addr: u64) -> Option<(f64, f64, f64)> {
            let b = self.read::<24>(addr)?;
            Some((f(&b, 0), f(&b, 8), f(&b, 16)))
        }

        /// Zones lisibles du jeu : tas (privées) et images (exe, dll). Les fichiers mappés sont ignorés.
        fn regions(&self) -> Vec<Region> {
            let mut out = Vec::new();
            let mut addr: u64 = 0;
            let readable = PAGE_READONLY
                | PAGE_READWRITE
                | PAGE_WRITECOPY
                | PAGE_EXECUTE_READ
                | PAGE_EXECUTE_READWRITE
                | PAGE_EXECUTE_WRITECOPY;
            while addr < 0x7FFF_FFFF_0000 {
                let mut mbi: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
                let n = unsafe {
                    VirtualQueryEx(self.handle, addr as *const _, &mut mbi, size_of::<MEMORY_BASIC_INFORMATION>())
                };
                if n == 0 {
                    break;
                }
                let base = mbi.BaseAddress as u64;
                let size = mbi.RegionSize as u64;
                let ok = mbi.State == MEM_COMMIT
                    && mbi.Protect & (PAGE_NOACCESS | PAGE_GUARD) == 0
                    && mbi.Protect & readable != 0
                    && (mbi.Type == MEM_PRIVATE || mbi.Type == MEM_IMAGE);
                if ok {
                    out.push(Region { base, size, private: mbi.Type == MEM_PRIVATE });
                }
                addr = base.saturating_add(size.max(0x1000));
            }
            out
        }

        /// Parcourt toutes les zones par blocs ; `visit(adresse du bloc, octets)`.
        /// Les blocs se chevauchent de 16 octets pour ne pas couper un triplet.
        fn each_chunk(&mut self, regions: &[Region], mut visit: impl FnMut(&Game, u64, &[u8])) {
            let total: u64 = regions.iter().map(|r| r.size).sum();
            let mut done = 0u64;
            let mut buf = vec![0u8; CHUNK + 16];
            let mut last = Instant::now();
            for r in regions {
                let mut off = 0u64;
                while off < r.size {
                    self.guard();
                    let len = ((r.size - off) as usize).min(CHUNK + 16);
                    let n = self.read_into(r.base + off, &mut buf[..len]);
                    if n >= 8 {
                        visit(self, r.base + off, &buf[..n]);
                    }
                    off += CHUNK as u64;
                }
                done += r.size;
                if last.elapsed() > Duration::from_secs(5) {
                    last = Instant::now();
                    eprintln!("  … {} %", done * 100 / total.max(1));
                }
            }
        }
    }

    fn f(b: &[u8], i: usize) -> f64 {
        f64::from_le_bytes(b[i..i + 8].try_into().unwrap())
    }

    fn u(b: &[u8], i: usize) -> u64 {
        u64::from_le_bytes(b[i..i + 8].try_into().unwrap())
    }

    fn module(pid: u32, name: &str) -> Option<(u64, u64)> {
        let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) };
        if snap == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut e = MODULEENTRY32W { dwSize: size_of::<MODULEENTRY32W>() as u32, ..Default::default() };
        let mut found = None;
        let mut ok = unsafe { Module32FirstW(snap, &mut e) };
        while ok != 0 {
            let len = e.szModule.iter().position(|&c| c == 0).unwrap_or(e.szModule.len());
            if String::from_utf16_lossy(&e.szModule[..len]).eq_ignore_ascii_case(name) {
                found = Some((e.modBaseAddr as u64, e.modBaseSize as u64));
                break;
            }
            ok = unsafe { Module32NextW(snap, &mut e) };
        }
        unsafe { CloseHandle(snap) };
        found
    }

    // ---------- Candidats (adresse de X, puis X, Y, Z) ----------

    #[derive(Clone, Copy)]
    struct Cand {
        addr: u64,
        x: f64,
        y: f64,
        z: f64,
    }

    /// Coordonnées Unreal en centimètres : la carte tient largement dans ±10 km, l'altitude dans ±10 km.
    fn plausible(x: f64, y: f64, z: f64) -> bool {
        let c = |v: f64, max: f64| v.is_finite() && v.abs() < max;
        c(x, 1.0e7) && c(y, 1.0e7) && c(z, 1.0e6) && x.abs() > 10.0 && y.abs() > 10.0 && z != 0.0
    }

    fn cands_path() -> Result<PathBuf, String> {
        Ok(state_dir()?.join("candidats.bin"))
    }

    fn save_cands(c: &[Cand]) -> Result<(), String> {
        let mut w = BufWriter::new(fs::File::create(cands_path()?).map_err(|e| e.to_string())?);
        for k in c {
            for v in [k.addr.to_le_bytes(), k.x.to_le_bytes(), k.y.to_le_bytes(), k.z.to_le_bytes()] {
                w.write_all(&v).map_err(|e| e.to_string())?;
            }
        }
        w.flush().map_err(|e| e.to_string())
    }

    fn load_cands() -> Result<Vec<Cand>, String> {
        let file = fs::File::open(cands_path()?).map_err(|_| "aucun candidat : lance d'abord « first »")?;
        let mut bytes = Vec::new();
        BufReader::new(file).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        Ok(bytes
            .as_chunks::<32>()
            .0
            .iter()
            .map(|b| Cand { addr: u(b, 0), x: f(b, 8), y: f(b, 16), z: f(b, 24) })
            .collect())
    }

    fn first() -> Result<(), String> {
        let mut g = Game::open()?;
        let regions: Vec<Region> = g.regions().into_iter().filter(|r| r.private).collect();
        let total: u64 = regions.iter().map(|r| r.size).sum();
        eprintln!("Balayage de {} zones ({} Mo)…", regions.len(), total >> 20);
        let mut out = Vec::new();
        g.each_chunk(&regions, |_, at, b| {
            let mut i = 0;
            while i + 24 <= b.len() && i < CHUNK {
                let (x, y, z) = (f(b, i), f(b, i + 8), f(b, i + 16));
                if plausible(x, y, z) {
                    out.push(Cand { addr: at + i as u64, x, y, z });
                }
                i += 8;
            }
        });
        save_cands(&out)?;
        println!("{} candidats. Bouge en jeu, puis « filter up », « filter down », « filter still »…", out.len());
        Ok(())
    }

    fn filter(mode: &str) -> Result<(), String> {
        let keep: fn(&Cand, &Cand) -> bool = match mode {
            "up" => |o, n| n.z > o.z + 1.0,
            "down" => |o, n| n.z < o.z - 1.0,
            "still" => |o, n| o.x == n.x && o.y == n.y && o.z == n.z,
            "moved" => |o, n| (n.x - o.x).hypot(n.y - o.y) > 50.0,
            "changed" => |o, n| o.x != n.x || o.y != n.y || o.z != n.z,
            "any" => |_, _| true,
            _ => return Err(format!("mode inconnu : {mode}")),
        };
        let old = load_cands()?;
        let mut g = Game::open()?;
        let mut out = Vec::new();
        // Les candidats sont triés par adresse : on lit des pages de 64 Ko plutôt qu'un candidat à la fois.
        let mut page = vec![0u8; 0x10000 + 24];
        let mut page_at = u64::MAX;
        let mut page_len = 0;
        for o in &old {
            g.guard();
            let start = o.addr & !0xFFFF;
            if start != page_at {
                page_at = start;
                page_len = g.read_into(start, &mut page);
            }
            let i = (o.addr - start) as usize;
            let now = if i + 24 <= page_len {
                Some((f(&page, i), f(&page, i + 8), f(&page, i + 16)))
            } else {
                g.triple(o.addr)
            };
            if let Some((x, y, z)) = now {
                let n = Cand { addr: o.addr, x, y, z };
                if plausible(x, y, z) && keep(o, &n) {
                    out.push(n);
                }
            }
        }
        save_cands(&out)?;
        println!("{} → {} candidats.", old.len(), out.len());
        if out.len() <= 20 {
            print_cands(&out, 20);
        }
        Ok(())
    }

    /// Filtre sur les valeurs déjà enregistrées : ne lit pas le jeu.
    fn near(x: f64, y: f64, radius: f64) -> Result<(), String> {
        let old = load_cands()?;
        let out: Vec<Cand> = old.iter().copied().filter(|c| (c.x - x).hypot(c.y - y) <= radius).collect();
        save_cands(&out)?;
        println!("{} → {} candidats.", old.len(), out.len());
        print_cands(&out, 40);
        Ok(())
    }

    fn print_cands(c: &[Cand], n: usize) {
        for k in c.iter().take(n) {
            println!("0x{:X}  X {:>12.1}  Y {:>12.1}  Z {:>10.1}", k.addr, k.x, k.y, k.z);
        }
        if c.len() > n {
            println!("… et {} autres.", c.len() - n);
        }
    }

    fn list(n: usize) -> Result<(), String> {
        print_cands(&load_cands()?, n);
        Ok(())
    }

    fn watch(addr: u64, secs: u64) -> Result<(), String> {
        let mut g = Game::open()?;
        let end = Instant::now() + Duration::from_secs(secs);
        while Instant::now() < end {
            g.guard();
            match g.triple(addr) {
                Some((x, y, z)) => println!("X {x:>12.1}  Y {y:>12.1}  Z {z:>10.1}"),
                None => println!("illisible"),
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        Ok(())
    }

    // ---------- Chaînes de pointeurs ----------

    struct Node {
        loc: u64,
        off: u64,
        parent: u32,
    }

    fn chains_path() -> Result<PathBuf, String> {
        Ok(state_dir()?.join("chaines.txt"))
    }

    /// Une chaîne par ligne, décalages hexadécimaux séparés par des espaces.
    fn save_chains(c: &[Vec<u64>]) -> Result<(), String> {
        let text: String = c
            .iter()
            .map(|ch| ch.iter().map(|o| format!("0x{o:X}")).collect::<Vec<_>>().join(" ") + "\n")
            .collect();
        fs::write(chains_path()?, text).map_err(|e| e.to_string())
    }

    fn load_chains() -> Result<Vec<Vec<u64>>, String> {
        let text = fs::read_to_string(chains_path()?).map_err(|_| "aucune chaîne : lance d'abord « pointers »")?;
        text.lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| l.split_whitespace().map(parse_num).collect())
            .collect()
    }

    fn pointers(targets: Vec<u64>, depth: usize, max_off: u64) -> Result<(), String> {
        let mut g = Game::open()?;
        let regions = g.regions();
        let heap: Vec<(u64, u64)> = regions.iter().filter(|r| r.private).map(|r| (r.base, r.base + r.size)).collect();
        let (lo, hi) = (heap.first().map_or(0, |r| r.0), heap.last().map_or(0, |r| r.1));
        let in_heap = |v: u64| {
            if v < lo || v >= hi || !v.is_multiple_of(8) {
                return false;
            }
            let i = heap.partition_point(|r| r.0 <= v);
            i > 0 && v < heap[i - 1].1
        };

        // Carte (valeur, emplacement) de tous les pointeurs vers le tas, triée par valeur.
        eprintln!("Relevé des pointeurs…");
        let mut map: Vec<(u64, u64)> = Vec::new();
        g.each_chunk(&regions, |_, at, b| {
            let mut i = 0;
            while i + 8 <= b.len() && i < CHUNK {
                let v = u(b, i);
                if in_heap(v) {
                    map.push((v, at + i as u64));
                }
                i += 8;
            }
        });
        map.sort_unstable();
        eprintln!(
            "{} pointeurs. Remontée depuis {} adresse(s) (profondeur {depth}, décalage max 0x{max_off:X})…",
            map.len(),
            targets.len()
        );

        // Remontée en largeur : qui pointe un peu avant `loc` ? On s'arrête aux emplacements dans l'exe du jeu.
        let mut nodes: Vec<Node> = targets.iter().map(|&t| Node { loc: t, off: 0, parent: u32::MAX }).collect();
        let mut level: Vec<u32> = (0..nodes.len() as u32).collect();
        let mut seen: HashSet<u64> = targets.iter().copied().collect();
        let mut found: Vec<u32> = Vec::new();
        for d in 0..depth {
            let mut next = Vec::new();
            for &ni in &level {
                g.guard();
                let loc = nodes[ni as usize].loc;
                let from = map.partition_point(|p| p.0 < loc.saturating_sub(max_off));
                for &(v, ploc) in map[from..].iter().take_while(|p| p.0 <= loc) {
                    if found.len() >= MAX_CHAINS {
                        break;
                    }
                    let idx = nodes.len() as u32;
                    if g.in_module(ploc) {
                        nodes.push(Node { loc: ploc, off: loc - v, parent: ni });
                        found.push(idx);
                    } else if next.len() < MAX_NODES_PER_LEVEL && seen.insert(ploc) {
                        nodes.push(Node { loc: ploc, off: loc - v, parent: ni });
                        next.push(idx);
                    }
                }
            }
            eprintln!("  niveau {} : {} nœuds, {} chaînes.", d + 1, next.len(), found.len());
            level = next;
            if level.is_empty() || found.len() >= MAX_CHAINS {
                break;
            }
        }

        let mut per_target: std::collections::BTreeMap<u64, usize> = Default::default();
        let mut chains: Vec<Vec<u64>> = found
            .iter()
            .map(|&i| {
                let mut n = &nodes[i as usize];
                let mut ch = vec![n.loc - g.base];
                while n.parent != u32::MAX {
                    ch.push(n.off);
                    n = &nodes[n.parent as usize];
                }
                *per_target.entry(n.loc).or_default() += 1;
                ch
            })
            .collect();
        for (t, n) in &per_target {
            let pos = g.triple(*t).map_or("illisible".into(), |(x, y, z)| format!("X {x:.1}  Y {y:.1}  Z {z:.1}"));
            println!("0x{t:X} : {n} chaîne(s)  ({pos})");
        }
        // Les plus courtes et aux plus petits décalages d'abord : ce sont souvent les plus stables.
        chains.sort_by_key(|c| (c.len(), c[1..].iter().sum::<u64>()));
        save_chains(&chains)?;
        println!("{} chaînes. Relance le jeu, retrouve X, puis « check <nouvelle adresse> ».", chains.len());
        Ok(())
    }

    fn resolve(g: &Game, chain: &[u64]) -> Option<u64> {
        let (first, rest) = chain.split_first()?;
        let mut addr = g.base.checked_add(*first)?;
        for off in rest {
            addr = u64::from_le_bytes(g.read::<8>(addr)?).checked_add(*off)?;
        }
        Some(addr)
    }

    enum Target {
        Any,
        Addr(u64),
        Near(f64, f64, f64),
    }

    fn check(target: Target) -> Result<(), String> {
        let chains = load_chains()?;
        let mut g = Game::open()?;
        let mut kept = Vec::new();
        for ch in &chains {
            g.guard();
            let Some(addr) = resolve(&g, ch) else { continue };
            let pos = g.triple(addr).filter(|&(x, y, z)| plausible(x, y, z));
            let ok = match target {
                Target::Any => pos.is_some(),
                Target::Addr(t) => addr == t,
                Target::Near(x, y, r) => pos.is_some_and(|p| (p.0 - x).hypot(p.1 - y) <= r),
            };
            if ok {
                kept.push(ch.clone());
            }
        }
        if let Target::Any = target {
            println!("{} chaînes sur {} donnent une position plausible.", kept.len(), chains.len());
        } else {
            save_chains(&kept)?;
            println!("{} → {} chaînes gardées.", chains.len(), kept.len());
        }
        Ok(())
    }

    fn show(n: usize) -> Result<(), String> {
        let chains = load_chains()?;
        // Position donnée par chaque chaîne, si le jeu tourne sans BattlEye.
        let g = Game::open().ok();
        for ch in chains.iter().take(n) {
            let s: Vec<String> = ch.iter().map(|o| format!("\"0x{o:X}\"")).collect();
            let pos = g
                .as_ref()
                .and_then(|g| g.triple(resolve(g, ch)?))
                .map_or(String::new(), |(x, y, z)| format!("   X {x:.1}  Y {y:.1}  Z {z:.1}"));
            println!("[{}]{pos}", s.join(", "));
        }
        if chains.len() > n {
            println!("… et {} autres.", chains.len() - n);
        }
        Ok(())
    }
}
