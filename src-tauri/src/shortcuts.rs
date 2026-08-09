// shortcuts.rs — the four global hotkeys from §10.
//
// These are system-wide, so they can collide with whatever else is running.
// A collision is reported back to the widget as a `hotkey-status` event
// rather than silently doing nothing, because a hotkey that quietly refuses
// to work is close to impossible for a user to diagnose.

use crate::config::{Config, ConfigState};
use crate::overlay::OVERLAY;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const TRIGGER_MOVE: &str = "trigger-move";
pub const HOTKEY_STATUS: &str = "hotkey-status";

#[derive(Serialize, Clone)]
pub struct HotkeyStatus {
    pub failed: Vec<FailedHotkey>,
}

#[derive(Serialize, Clone)]
pub struct FailedHotkey {
    pub action: String,
    pub accelerator: String,
    pub reason: String,
}

/// Which of the four bindings fired.
#[derive(Clone, Copy, PartialEq)]
enum Action {
    ToggleWidget,
    ToggleRoaming,
    TriggerMove,
    Quit,
}

fn run(app: &AppHandle, action: Action) {
    match action {
        Action::ToggleWidget => {
            if let Some(w) = app.get_webview_window("widget") {
                let visible = w.is_visible().unwrap_or(false);
                if visible {
                    let _ = w.hide();
                } else {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        }
        Action::ToggleRoaming => {
            // Flip the stored value and let the normal config broadcast tell
            // the overlay about it, so hotkey and widget share one path.
            let state = app.state::<ConfigState>();
            let next = {
                let cfg = state.0.lock().unwrap();
                !cfg.roaming
            };
            let patch = serde_json::json!({ "roaming": next });
            let _ = crate::config::set_config(app.clone(), state, patch);
        }
        Action::TriggerMove => {
            if let Some(w) = app.get_webview_window(OVERLAY) {
                let _ = w.emit(TRIGGER_MOVE, ());
            }
        }
        Action::Quit => {
            // Do NOT unregister here. This runs inside the hotkey manager's
            // own dispatch, and calling back into it to unregister deadlocks
            // before exit() is ever reached. Shutting the process down
            // releases the hotkeys anyway.
            app.exit(0);
        }
    }
}

/// Register the current bindings, replacing whatever was registered before.
/// Safe to call again whenever the config changes.
pub fn apply(app: &AppHandle, cfg: &Config) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    let bindings = [
        ("widgetHotkey", cfg.widget_hotkey.as_str(), Action::ToggleWidget),
        ("roamToggleHotkey", cfg.roam_toggle_hotkey.as_str(), Action::ToggleRoaming),
        ("moveHotkey", cfg.move_hotkey.as_str(), Action::TriggerMove),
        ("quitHotkey", cfg.quit_hotkey.as_str(), Action::Quit),
    ];

    let mut failed = Vec::new();

    for (name, accel, action) in bindings {
        let result = gs.on_shortcut(accel, move |app, _shortcut, event| {
            // Fire once, on key-down. Without this the action repeats on release.
            if event.state() == ShortcutState::Pressed {
                run(app, action);
            }
        });

        if let Err(e) = result {
            eprintln!("[peeceemons] hotkey {name} ({accel}) could not be registered: {e}");
            failed.push(FailedHotkey {
                action: name.to_string(),
                accelerator: accel.to_string(),
                reason: e.to_string(),
            });
        }
    }

    // Tell the widget either way; an empty list clears any previous warning.
    let _ = app.emit(HOTKEY_STATUS, HotkeyStatus { failed });
}
