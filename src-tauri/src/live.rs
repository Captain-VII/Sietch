//! Modules « sans BattlEye » : actifs seulement quand le jeu tourne SANS BattlEye,
//! c'est-à-dire en mode solo ou sur un serveur privé qui ne l'exige pas
//! (les serveurs qui l'exigent n'apparaissent pas sans lui).
//!
//! Tout est en lecture seule. Dès que BattlEye est détecté, la lecture s'arrête et la
//! poignée vers le jeu est fermée. Si l'état de BattlEye est incertain, on le considère actif.

use crate::state::AppState;
use crate::timers::now_ms;
use crate::ue;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager};

/// Réglages techniques, dans `position.json` (dossier de données de Sietch).
/// La chaîne de pointeurs change à chaque mise à jour du jeu : elle se règle à la main.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LiveConfig {
    pub game_processes: Vec<String>,
    pub battleye_processes: Vec<String>,
    /// Module dont part la chaîne ; vide = l'exécutable du jeu.
    pub module: String,
    /// Chaîne de pointeurs, façon Cheat Engine : `["0x8A1B2C0", "0x30", "0x2A0", "0x1B0"]`.
    /// adresse = module + 1er décalage ; puis pour chaque décalage suivant :
    /// adresse = valeur lue à l'adresse + décalage. L'adresse finale pointe sur X (puis Y, Z).
    pub pointer_chain: Vec<String>,
    /// "f64" (Unreal Engine 5, par défaut) ou "f32".
    pub coordinates: String,
}

impl Default for LiveConfig {
    fn default() -> Self {
        Self {
            game_processes: vec!["DuneSandbox-Win64-Shipping.exe".into()],
            battleye_processes: vec![
                "BEService.exe".into(),
                "BEService_x64.exe".into(),
                "DuneSandbox_BE.exe".into(),
            ],
            module: String::new(),
            pointer_chain: Vec::new(),
            coordinates: "f64".into(),
        }
    }
}

impl LiveConfig {
    fn chain(&self) -> Result<Vec<u64>, String> {
        self.pointer_chain
            .iter()
            .map(|s| {
                let t = s.trim().trim_start_matches("0x").trim_start_matches("0X");
                u64::from_str_radix(t, 16).map_err(|_| format!("décalage illisible : {s}"))
            })
            .collect()
    }
}

#[derive(Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    pub game_running: bool,
    pub battleye_running: bool,
    pub enabled: bool,
    pub configured: bool,
    pub active: bool,
    /// "memoire", "simulation" ou "aucune".
    pub source: String,
    pub message: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub at: i64,
}

pub fn config_path(app: &AppHandle) -> PathBuf {
    app.state::<AppState>().dir.join("position.json")
}

/// Lit `position.json`, ou le crée avec les valeurs par défaut s'il n'existe pas.
pub fn load_config(app: &AppHandle) -> (LiveConfig, Option<String>) {
    let path = config_path(app);
    match fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(cfg) => (cfg, None),
            Err(e) => (LiveConfig::default(), Some(format!("position.json illisible : {e}"))),
        },
        Err(_) => {
            let cfg = LiveConfig::default();
            if let Ok(text) = serde_json::to_string_pretty(&cfg) {
                let _ = fs::write(&path, text);
            }
            (cfg, None)
        }
    }
}

/// Mode test : `SIETCH_SIMULATION=1` simule un jeu sans BattlEye et une position qui bouge.
fn simulation() -> bool {
    std::env::var("SIETCH_SIMULATION").is_ok_and(|v| v == "1")
}

/// Noms de processus en cours, en minuscules, avec leur identifiant.
fn processes(sys: &mut System) -> Vec<(String, u32)> {
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes()
        .values()
        .map(|p| (p.name().to_string_lossy().to_lowercase(), p.pid().as_u32()))
        .collect()
}

/// Tables d'Unreal Engine du cache, si elles valent encore pour cette version du jeu.
fn cached_tables(path: &std::path::Path, r: &memory::Reader) -> Option<ue::Tables> {
    let t: ue::Tables = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    ue::Ue::open(r, t).map(|_| t)
}

/// Pour les longues recherches : vrai (= arrêter) dès que BattlEye apparaît, vérifié toutes les 2 secondes.
fn battleye_watch<'a>(sys: &'a mut System, names: &'a [String]) -> impl FnMut() -> bool + 'a {
    let names: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
    let mut last = Instant::now();
    move || {
        if last.elapsed() < Duration::from_secs(2) {
            return false;
        }
        last = Instant::now();
        let list = processes(sys);
        list.is_empty() || list.iter().any(|(n, _)| names.contains(n))
    }
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut sys = System::new();
        let (mut cfg, mut cfg_error) = load_config(&app);
        let mut status = LiveStatus::default();
        let mut reader: Option<memory::Reader> = None;
        let mut tick: u64 = 0;
        let mut game_pid: Option<u32> = None;
        let ue_cache = app.state::<AppState>().dir.join("ue.json");
        let mut tables: Option<ue::Tables> = None;
        let mut player: Option<ue::Player> = None;
        let mut last_state: Option<ue::PlayerState> = None;
        let mut alerts = crate::alerts::Alerts::default();
        let (mut last_tables_try, mut last_player_try): (Option<Instant>, Option<Instant>) = (None, None);
        loop {
            let state = app.state::<AppState>();
            if state.live_reload.swap(false, std::sync::atomic::Ordering::Relaxed) {
                (cfg, cfg_error) = load_config(&app);
                reader = None;
            }
            let enabled = state.settings.lock().unwrap().live_modules;

            // Processus : toutes les 2 secondes suffisent.
            if tick.is_multiple_of(8) {
                let sim = simulation();
                let (game, battleye) = if sim {
                    (Some(0), false)
                } else {
                    let list = processes(&mut sys);
                    let wanted = |names: &[String]| {
                        let names: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
                        list.iter().find(|(n, _)| names.contains(n)).map(|(_, pid)| *pid)
                    };
                    // Liste vide = impossible de lister les processus : on suppose BattlEye actif.
                    let battleye = list.is_empty() || wanted(&cfg.battleye_processes).is_some();
                    (wanted(&cfg.game_processes), battleye)
                };
                if battleye || game.is_none() || game != game_pid {
                    reader = None; // on lâche immédiatement le jeu
                }
                game_pid = game;
                // Le personnage se retrouve par les noms d'Unreal Engine : plus besoin de chaîne de pointeurs.
                let configured = sim || cfg!(windows);
                let active = enabled && game.is_some() && !battleye && configured && (sim || cfg!(windows));
                let message = if let Some(e) = &cfg_error {
                    Some(e.clone())
                } else if battleye && game.is_some() {
                    Some("BattlEye est actif : les modules sont coupés.".into())
                } else if !sim && !cfg!(windows) && enabled {
                    Some("La lecture de position ne fonctionne que sous Windows.".into())
                } else {
                    None
                };
                let next = LiveStatus {
                    game_running: game.is_some(),
                    battleye_running: battleye,
                    enabled,
                    configured,
                    active,
                    source: if !active {
                        "aucune".into()
                    } else if sim {
                        "simulation".into()
                    } else {
                        "memoire".into()
                    },
                    message,
                };
                if next != status {
                    status = next;
                    *state.live_status.lock().unwrap() = status.clone();
                    let _ = app.emit("live-status", status.clone());
                }
            }

            if reader.is_none() {
                // Poignée lâchée (BattlEye, jeu fermé ou relancé) : le personnage est à retrouver.
                player = None;
            }
            if status.active {
                let pos = if status.source == "simulation" {
                    let t = now_ms() as f64 / 1000.0;
                    // Un tour complet toutes les ~40 s.
                    Some(((t * 0.15).cos() * 40_000.0 + 10_000.0, (t * 0.15).sin() * 40_000.0 - 5_000.0, 1_200.0))
                } else {
                    if reader.is_none()
                        && let Some(pid) = game_pid
                    {
                        let module = if cfg.module.is_empty() { cfg.game_processes[0].clone() } else { cfg.module.clone() };
                        reader = memory::Reader::open(pid, &module).ok();
                    }
                    let mut pos = None;
                    if let Some(r) = reader.as_ref() {
                        // Tables d'Unreal Engine : depuis le cache, sinon une recherche (une fois par version du jeu).
                        if tables.is_none() && last_tables_try.is_none_or(|t| t.elapsed() > Duration::from_secs(60)) {
                            last_tables_try = Some(Instant::now());
                            tables = cached_tables(&ue_cache, r).or_else(|| {
                                status.message = Some("Recherche des structures du jeu (environ une minute)…".into());
                                let _ = app.emit("live-status", status.clone());
                                let mut stop = battleye_watch(&mut sys, &cfg.battleye_processes);
                                let found = ue::Ue::scan(r, &mut stop).ok().map(|(_, t)| t);
                                if let Some(t) = found.as_ref().and_then(|t| serde_json::to_string(t).ok()) {
                                    let _ = fs::write(&ue_cache, t);
                                }
                                found
                            });
                        }
                        if player.is_none()
                            && let Some(t) = tables
                            && last_player_try.is_none_or(|i| i.elapsed() > Duration::from_secs(3))
                        {
                            last_player_try = Some(Instant::now());
                            player = ue::Ue::open(r, t).and_then(|mut u| u.find_player());
                        }
                        match player.as_ref().map(|p| p.read(r)) {
                            Some(Some(s)) => {
                                pos = Some((s.x, s.y, s.z));
                                let s = s.rounded();
                                if last_state.as_ref() != Some(&s) {
                                    if cfg!(debug_assertions) {
                                        eprintln!("[personnage] {s:?}");
                                    }
                                    let _ = app.emit("player-state", &s);
                                    *state.player_state.lock().unwrap() = Some(s.clone());
                                    let settings = state.settings.lock().unwrap().clone();
                                    for alarm in alerts.check(&s, &settings.player_alerts) {
                                        if cfg!(debug_assertions) {
                                            eprintln!("[alerte] {} — {}", alarm.title, alarm.body);
                                        }
                                        crate::engine::send_alarm(&app, &settings, alarm);
                                    }
                                    last_state = Some(s);
                                }
                            }
                            Some(None) => player = None,
                            None => {}
                        }
                        // Écran « Stats brutes » ouvert : toutes les valeurs d'attributs, à la demande.
                        if state.raw_wanted.swap(false, std::sync::atomic::Ordering::Relaxed)
                            && let (Some(p), Some(t)) = (player.as_ref(), tables)
                            && let Some(mut u) = ue::Ue::open(r, t)
                        {
                            *state.raw_stats.lock().unwrap() = u.raw_stats(p);
                        }
                        // Sans personnage trouvé : l'ancienne chaîne de pointeurs, si elle est renseignée.
                        if pos.is_none()
                            && let Ok(chain) = cfg.chain()
                            && !chain.is_empty()
                        {
                            pos = r.position(&chain, cfg.coordinates == "f32");
                        }
                    }
                    pos
                };
                if let Some((x, y, z)) = pos {
                    let _ = app.emit("player-position", Position { x, y, z, at: now_ms() });
                }
            }

            tick += 1;
            std::thread::sleep(Duration::from_millis(250));
        }
    });
}

#[cfg(windows)]
mod memory {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, MODULEENTRY32W, Module32FirstW, Module32NextW, TH32CS_SNAPMODULE,
        TH32CS_SNAPMODULE32,
    };
    use windows_sys::Win32::System::Memory::{
        MEM_COMMIT, MEM_IMAGE, MEM_PRIVATE, MEMORY_BASIC_INFORMATION, PAGE_GUARD, PAGE_NOACCESS, VirtualQueryEx,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};

    /// Accès en LECTURE SEULE à la mémoire du jeu (aucun droit d'écriture demandé).
    pub struct Reader {
        handle: HANDLE,
        base: u64,
        size: u64,
    }

    // La poignée n'est utilisée que depuis le fil des modules.
    unsafe impl Send for Reader {}

    impl Reader {
        pub fn open(pid: u32, module: &str) -> Result<Self, String> {
            let (base, size) = module_base(pid, module).ok_or("module du jeu introuvable")?;
            // PROCESS_QUERY_INFORMATION : nécessaire pour lister les zones (VirtualQueryEx).
            let handle = unsafe { OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, 0, pid) };
            if handle.is_null() {
                return Err("accès au jeu refusé".into());
            }
            Ok(Self { handle, base, size })
        }

        fn read<const N: usize>(&self, addr: u64) -> Option<[u8; N]> {
            let mut buf = [0u8; N];
            (crate::ue::Mem::read_into(self, addr, &mut buf) == N).then_some(buf)
        }

        pub fn position(&self, chain: &[u64], f32_coords: bool) -> Option<(f64, f64, f64)> {
            let (first, rest) = chain.split_first()?;
            let mut addr = self.base.checked_add(*first)?;
            for off in rest {
                addr = u64::from_le_bytes(self.read::<8>(addr)?).checked_add(*off)?;
            }
            let v = if f32_coords {
                let b = self.read::<12>(addr)?;
                let f = |i: usize| f32::from_le_bytes(b[i..i + 4].try_into().unwrap()) as f64;
                (f(0), f(4), f(8))
            } else {
                let b = self.read::<24>(addr)?;
                let f = |i: usize| f64::from_le_bytes(b[i..i + 8].try_into().unwrap());
                (f(0), f(8), f(16))
            };
            // Une valeur absurde veut dire que la chaîne ne pointe plus au bon endroit.
            let sane = |c: f64| c.is_finite() && c.abs() < 1.0e8;
            (sane(v.0) && sane(v.1) && sane(v.2)).then_some(v)
        }
    }

    impl crate::ue::Mem for Reader {
        fn read_into(&self, addr: u64, buf: &mut [u8]) -> usize {
            let mut read = 0usize;
            let ok = unsafe {
                ReadProcessMemory(self.handle, addr as *const _, buf.as_mut_ptr() as *mut _, buf.len(), &mut read)
            };
            if ok != 0 { buf.len() } else { read }
        }

        fn module(&self) -> (u64, u64) {
            (self.base, self.size)
        }

        fn regions(&self, heap: bool) -> Vec<(u64, u64)> {
            let mut out = Vec::new();
            let mut addr: u64 = 0;
            while addr < 0x7FFF_FFFF_0000 {
                let mut mbi: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
                let n = unsafe {
                    VirtualQueryEx(self.handle, addr as *const _, &mut mbi, std::mem::size_of::<MEMORY_BASIC_INFORMATION>())
                };
                if n == 0 {
                    break;
                }
                let (base, size) = (mbi.BaseAddress as u64, mbi.RegionSize as u64);
                let readable = mbi.State == MEM_COMMIT && mbi.Protect != 0 && mbi.Protect & (PAGE_NOACCESS | PAGE_GUARD) == 0;
                let wanted = if heap {
                    mbi.Type == MEM_PRIVATE
                } else {
                    mbi.Type == MEM_IMAGE && base >= self.base && base < self.base + self.size
                };
                if readable && wanted {
                    out.push((base, size));
                }
                addr = base.saturating_add(size.max(0x1000));
            }
            out
        }
    }

    impl Drop for Reader {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.handle) };
        }
    }

    fn module_base(pid: u32, module: &str) -> Option<(u64, u64)> {
        let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) };
        if snap == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry = MODULEENTRY32W { dwSize: std::mem::size_of::<MODULEENTRY32W>() as u32, ..Default::default() };
        let mut found = None;
        let mut ok = unsafe { Module32FirstW(snap, &mut entry) };
        while ok != 0 {
            let len = entry.szModule.iter().position(|&c| c == 0).unwrap_or(entry.szModule.len());
            let name = String::from_utf16_lossy(&entry.szModule[..len]);
            if name.eq_ignore_ascii_case(module) {
                found = Some((entry.modBaseAddr as u64, entry.modBaseSize as u64));
                break;
            }
            ok = unsafe { Module32NextW(snap, &mut entry) };
        }
        unsafe { CloseHandle(snap) };
        found
    }
}

#[cfg(not(windows))]
mod memory {
    /// Hors Windows, pas de lecture mémoire : seule la simulation fonctionne.
    pub struct Reader;

    impl Reader {
        pub fn open(_pid: u32, _module: &str) -> Result<Self, String> {
            Err("lecture mémoire disponible seulement sous Windows".into())
        }

        pub fn position(&self, _chain: &[u64], _f32: bool) -> Option<(f64, f64, f64)> {
            None
        }
    }

    impl crate::ue::Mem for Reader {
        fn read_into(&self, _addr: u64, _buf: &mut [u8]) -> usize {
            0
        }
        fn module(&self) -> (u64, u64) {
            (0, 0)
        }
        fn regions(&self, _heap: bool) -> Vec<(u64, u64)> {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pointer_chain_parses_hex() {
        let cfg = LiveConfig { pointer_chain: vec!["0x8A1B2C0".into(), "30".into()], ..Default::default() };
        assert_eq!(cfg.chain().unwrap(), vec![0x8A1B2C0, 0x30]);
        let bad = LiveConfig { pointer_chain: vec!["zz".into()], ..Default::default() };
        assert!(bad.chain().is_err());
    }
}
