use crate::state::AppState;
use crate::{set_dnd_inner, shortcuts, windows};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let dnd = app.state::<AppState>().settings.lock().unwrap().dnd;
    let open = MenuItem::with_id(app, "open", "Ouvrir Sietch", true, None::<&str>)?;
    let overlay = MenuItem::with_id(
        app,
        "overlay",
        "Afficher / masquer l'overlay",
        true,
        None::<&str>,
    )?;
    let wiki = MenuItem::with_id(app, "wiki", "Ouvrir le wiki", true, None::<&str>)?;
    let timer = MenuItem::with_id(app, "timer", "Nouveau minuteur", true, None::<&str>)?;
    let dnd_item = CheckMenuItem::with_id(app, "dnd", "Ne pas déranger", true, dnd, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Paramètres", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open, &overlay, &wiki, &timer, &sep1, &dnd_item, &settings, &sep2, &quit,
        ],
    )?;
    *app.state::<AppState>().dnd_item.lock().unwrap() = Some(dnd_item);

    let mut builder = TrayIconBuilder::with_id("sietch")
        .tooltip("Sietch")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => windows::show_main(app, None, None),
            "overlay" => windows::toggle_overlay(app),
            "wiki" => windows::show_wiki(app),
            "timer" => shortcuts::run_action(app, "timer"),
            "settings" => windows::show_main(app, Some("parametres"), None),
            "dnd" => {
                let on = !app.state::<AppState>().settings.lock().unwrap().dnd;
                set_dnd_inner(app, on);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                windows::show_main(tray.app_handle(), None, None);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
