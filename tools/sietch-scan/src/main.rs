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
    const MAX_CHAINS: usize = 20_000;

    const USAGE: &str = "\
sietch-scan — position du joueur, lecture seule, jeu SANS BattlEye uniquement

  status                     jeu et BattlEye détectés ?
  first                      premier balayage : tous les triplets X, Y, Z plausibles
  filter up|down|still|moved|changed
                             garde les candidats dont Z a monté / baissé, qui n'ont pas bougé,
                             dont X/Y ont bougé (> 50 cm), ou qui ont changé
  list [n]                   affiche les n premiers candidats (20 par défaut)
  watch <adresse> [s]        affiche X, Y, Z toutes les 0,5 s pendant s secondes (10 par défaut)
  pointers <adresse> [profondeur] [décalage max]
                             cherche les chaînes de pointeurs vers l'adresse de X (5, 0x1000 par défaut)
  check [adresse]            résout les chaînes enregistrées ; avec une adresse, ne garde que celles
                             qui y mènent encore (après une relance du jeu)
  show [n]                   affiche les n premières chaînes au format de position.json";

    pub fn run(args: &[String]) -> Result<(), String> {
        let cmd = args.first().map(String::as_str).unwrap_or("");
        let arg = |i: usize| args.get(i).map(String::as_str);
        match cmd {
            "status" => status(),
            "first" => first(),
            "filter" => filter(arg(1).ok_or("mode manquant (up, down, still, moved, changed)")?),
            "list" => list(arg(1).map(parse_num).transpose()?.unwrap_or(20) as usize),
            "watch" => watch(
                parse_num(arg(1).ok_or("adresse manquante")?)?,
                arg(2).map(parse_num).transpose()?.unwrap_or(10),
            ),
            "pointers" => pointers(
                parse_num(arg(1).ok_or("adresse manquante")?)?,
                arg(2).map(parse_num).transpose()?.unwrap_or(5) as usize,
                arg(3).map(parse_num).transpose()?.unwrap_or(0x1000),
            ),
            "check" => check(arg(1).map(parse_num).transpose()?),
            "show" => show(arg(1).map(parse_num).transpose()?.unwrap_or(20) as usize),
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

    fn pointers(target: u64, depth: usize, max_off: u64) -> Result<(), String> {
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
        eprintln!("{} pointeurs. Remontée depuis 0x{target:X} (profondeur {depth}, décalage max 0x{max_off:X})…", map.len());

        // Remontée en largeur : qui pointe un peu avant `loc` ? On s'arrête aux emplacements dans l'exe du jeu.
        let mut nodes = vec![Node { loc: target, off: 0, parent: u32::MAX }];
        let mut level: Vec<u32> = vec![0];
        let mut seen: HashSet<u64> = HashSet::from([target]);
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

        let mut chains: Vec<Vec<u64>> = found
            .iter()
            .map(|&i| {
                let mut n = &nodes[i as usize];
                let mut ch = vec![n.loc - g.base];
                while n.parent != u32::MAX {
                    ch.push(n.off);
                    n = &nodes[n.parent as usize];
                }
                ch
            })
            .collect();
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

    fn check(target: Option<u64>) -> Result<(), String> {
        let chains = load_chains()?;
        let mut g = Game::open()?;
        let mut kept = Vec::new();
        for ch in &chains {
            g.guard();
            let Some(addr) = resolve(&g, ch) else { continue };
            let ok = match target {
                Some(t) => addr == t,
                None => g.triple(addr).is_some_and(|(x, y, z)| plausible(x, y, z)),
            };
            if ok {
                kept.push(ch.clone());
            }
        }
        if target.is_some() {
            save_chains(&kept)?;
            println!("{} → {} chaînes mènent encore à l'adresse.", chains.len(), kept.len());
        } else {
            println!("{} chaînes sur {} donnent une position plausible.", kept.len(), chains.len());
        }
        Ok(())
    }

    fn show(n: usize) -> Result<(), String> {
        let chains = load_chains()?;
        for ch in chains.iter().take(n) {
            let s: Vec<String> = ch.iter().map(|o| format!("\"0x{o:X}\"")).collect();
            println!("[{}]", s.join(", "));
        }
        if chains.len() > n {
            println!("… et {} autres.", chains.len() - n);
        }
        Ok(())
    }
}
