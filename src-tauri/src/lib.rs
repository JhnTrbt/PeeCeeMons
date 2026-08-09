// lib.rs — the app's wiring. Everything else is in a module:
//   config.rs     settings file, validation, get/set commands
//   overlay.rs    bottom-strip window + the click-through cursor watcher
//   shortcuts.rs  the four global hotkeys
//
// Deliberately thin. All creature, animation and UI logic lives in the
// JavaScript under src/, which is far easier to iterate on.

mod config;
mod overlay;
mod shortcuts;

use config::{Config, ConfigState};
use overlay::OverlayState;
use std::sync::Mutex;
use tauri::{Listener, Manager};

/// Fire the active creature's move right now. The widget's SELECT button
/// routes through here so it takes exactly the same path as the global
/// hotkey rather than reaching into the overlay itself.
#[tauri::command]
fn trigger_move_now(app: tauri::AppHandle) {
    use tauri::Emitter;
    if let Some(w) = app.get_webview_window(overlay::OVERLAY) {
        let _ = w.emit(shortcuts::TRIGGER_MOVE, ());
    }
}

/// Launch-on-startup toggle. Done as a command rather than exposing the
/// autostart plugin to JavaScript, so the frontend gets no direct access to
/// the registry entry.
#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable().map_err(|e| e.to_string())
    } else {
        launcher.disable().map_err(|e| e.to_string())
    }
}

/// Put the widget back where the user left it — but never somewhere they
/// cannot reach it. A saved position can be stale after a monitor is
/// unplugged or the resolution changes, and a window parked off-screen looks
/// exactly like an app that failed to start.
fn restore_widget(app: &tauri::AppHandle, cfg: &Config) {
    let Some(w) = app.get_webview_window("widget") else {
        return;
    };

    let (mut x, mut y) = (cfg.widget_position.x, cfg.widget_position.y);

    // Require the title bar area to land inside some monitor.
    let size = w.outer_size().unwrap_or(tauri::PhysicalSize::new(630, 900));
    let monitors = w.available_monitors().unwrap_or_default();
    let visible = monitors.iter().any(|m| {
        let p = m.position();
        let s = m.size();
        let cx = x + (size.width as i32) / 2;
        x + 80 > p.x
            && cx < p.x + s.width as i32
            && y + 40 > p.y
            && y < p.y + s.height as i32
    });

    if !visible {
        if let Some(m) = w.primary_monitor().ok().flatten() {
            x = m.position().x + 60;
            y = m.position().y + 60;
        } else {
            x = 60;
            y = 60;
        }
        eprintln!("[peeceemons] saved widget position was off-screen; recentring");
    }

    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch should raise the widget
        // that is already running rather than start a rival copy (§10).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("widget") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::set_config,
            config::reset_config,
            overlay::set_hit_rect,
            trigger_move_now,
            set_autostart,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            let cfg = config::load(&handle);
            app.manage(ConfigState(Mutex::new(cfg.clone())));
            app.manage(OverlayState::default());

            if let Err(e) = overlay::position_overlay(&handle) {
                eprintln!("[peeceemons] could not place the overlay: {e}");
            }
            overlay::spawn_cursor_watcher(handle.clone());
            restore_widget(&handle, &cfg);
            shortcuts::apply(&handle, &cfg);

            // Keep the real startup entry in step with the saved preference,
            // in case it was changed outside the app.
            {
                use tauri_plugin_autostart::ManagerExt;
                let launcher = handle.autolaunch();
                let _ = if cfg.launch_on_startup {
                    launcher.enable()
                } else {
                    launcher.disable()
                };
            }

            // Hotkeys are configurable, so re-register whenever they change.
            let h = handle.clone();
            app.listen_any(config::CONFIG_CHANGED, move |event| {
                if let Ok(next) = serde_json::from_str::<Config>(event.payload()) {
                    shortcuts::apply(&h, &next);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Peeceemons");
}
