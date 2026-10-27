//! Le jeu est-il au premier plan, et un de ses menus est-il ouvert ? Le jeu cache le curseur pendant qu'on joue
//! et l'affiche dans l'inventaire, la carte, le menu Échap… Sietch regarde seulement la fenêtre au premier plan
//! (classe `UnrealWindow`) et l'état du curseur, par Windows : rien n'est lu dans le jeu, donc compatible avec
//! BattlEye. Les widgets s'effacent hors du jeu et dans ses menus (`game-focus`, réglages `overlay_only_in_game`
//! et `overlay_hide_in_menus`).

use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameFocus {
    /// La fenêtre du jeu est au premier plan.
    pub foreground: bool,
    /// Un menu du jeu est ouvert (curseur affiché).
    pub menu: bool,
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = GameFocus::default();
        loop {
            let now = focus();
            if now != last {
                last = now;
                *app.state::<AppState>().game_focus.lock().unwrap() = now;
                let _ = app.emit("game-focus", now);
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

#[cfg(windows)]
fn focus() -> GameFocus {
    use windows_sys::Win32::UI::WindowsAndMessaging::{CURSOR_SHOWING, CURSORINFO, GetClassNameW, GetCursorInfo, GetForegroundWindow};
    // SAFETY : appels Win32 en lecture seule sur des tampons locaux de la bonne taille.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return GameFocus::default();
        }
        let mut class = [0u16; 32];
        let n = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
        if String::from_utf16_lossy(&class[..n.max(0) as usize]) != "UnrealWindow" {
            return GameFocus::default();
        }
        let mut ci: CURSORINFO = std::mem::zeroed();
        ci.cbSize = std::mem::size_of::<CURSORINFO>() as u32;
        GameFocus { foreground: true, menu: GetCursorInfo(&mut ci) != 0 && ci.flags & CURSOR_SHOWING != 0 }
    }
}

/// Ailleurs que sous Windows, le jeu ne tourne pas : rien n'est masqué.
#[cfg(not(windows))]
fn focus() -> GameFocus {
    GameFocus { foreground: true, menu: false }
}
