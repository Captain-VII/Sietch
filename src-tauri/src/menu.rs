//! Menu du jeu ouvert ? Le jeu cache le curseur pendant qu'on joue et l'affiche dans l'inventaire, la carte,
//! le menu Échap… Sietch regarde seulement la fenêtre au premier plan (classe `UnrealWindow`) et l'état du
//! curseur, par Windows : rien n'est lu dans le jeu, donc compatible avec BattlEye.
//! Les widgets s'effacent tant qu'un menu est ouvert (`game-menu`, réglage `overlay_hide_in_menus`).

use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = false;
        loop {
            let open = menu_open();
            if open != last {
                last = open;
                app.state::<AppState>().game_menu.store(open, Ordering::Relaxed);
                let _ = app.emit("game-menu", open);
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

#[cfg(windows)]
fn menu_open() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{CURSOR_SHOWING, CURSORINFO, GetClassNameW, GetCursorInfo, GetForegroundWindow};
    // SAFETY : appels Win32 en lecture seule sur des tampons locaux de la bonne taille.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return false;
        }
        let mut class = [0u16; 32];
        let n = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
        if String::from_utf16_lossy(&class[..n.max(0) as usize]) != "UnrealWindow" {
            return false;
        }
        let mut ci: CURSORINFO = std::mem::zeroed();
        ci.cbSize = std::mem::size_of::<CURSORINFO>() as u32;
        GetCursorInfo(&mut ci) != 0 && ci.flags & CURSOR_SHOWING != 0
    }
}

#[cfg(not(windows))]
fn menu_open() -> bool {
    false
}
