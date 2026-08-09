// config.rs — the single source of truth for user settings.
//
// Everything the app remembers lives in one file:
//     %APPDATA%\com.peeceemons.app\peeceemons.config.json
//
// The frontend never touches the filesystem. It calls get_config / set_config
// / reset_config, and this module is the only code that knows the path. That
// keeps a compromised or buggy web layer from being able to name an arbitrary
// file, and it keeps validation in exactly one place.
//
// Every field carries #[serde(default)], so a hand-edited, truncated or
// corrupt file degrades to defaults field-by-field instead of failing to load.
// sanitise() then clamps everything into a sane range before it is used --
// this matters most for the hotkey strings, which get handed to the OS.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub const CONFIG_FILE: &str = "peeceemons.config.json";
pub const CONFIG_CHANGED: &str = "config-changed";

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Point {
    #[serde(default)]
    pub x: i32,
    #[serde(default)]
    pub y: i32,
}

impl Default for Point {
    fn default() -> Self {
        Point { x: 40, y: 40 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub active_creature: String,
    pub roaming: bool,
    pub move_timer_seconds: u32,
    pub move_hotkey: String,
    pub widget_hotkey: String,
    pub roam_toggle_hotkey: String,
    pub quit_hotkey: String,
    pub sound_on: bool,
    pub reduced_motion: bool,
    pub launch_on_startup: bool,
    pub widget_position: Point,
    pub unlocked: Vec<String>,
    /// "primary" today. Reserved so per-display overlays can be added later
    /// without changing the config shape.
    pub overlay_monitor: String,
    /// Integer pixel zoom for the 32x32 sprites on the overlay.
    pub sprite_scale: u32,
    /// Battles won against each creature you have not caught yet, keyed by
    /// name. Reaching `wins_to_unlock` moves that name into `unlocked`.
    pub progress: HashMap<String, u32>,
    pub wins_to_unlock: u32,
    /// Average minutes between wild encounters appearing around the pet.
    /// 0 turns them off entirely.
    pub encounter_minutes: u32,
    /// Lifetime tally, just for bragging rights on the widget.
    pub battles_won: u32,
    /// Wins earned *while using* each creature, keyed by name. A starter
    /// evolves once its own tally reaches the threshold in typechart.json.
    pub wins_with: HashMap<String, u32>,
    /// Widget window size as a percentage of its design size (420x600).
    pub widget_scale: u32,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            active_creature: "Flarepup".into(),
            roaming: true,
            move_timer_seconds: 25,
            move_hotkey: "Ctrl+Alt+M".into(),
            widget_hotkey: "Ctrl+Alt+P".into(),
            roam_toggle_hotkey: "Ctrl+Alt+O".into(),
            quit_hotkey: "Ctrl+Alt+Q".into(),
            sound_on: false,
            reduced_motion: false,
            launch_on_startup: false,
            widget_position: Point::default(),
            unlocked: vec![
                "Flarepup", "Dripling", "Sproutle", "Voltnip", "Frostkit", "Pebblump",
                "Mystmind", "Shadeling", "Nibblet",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
            overlay_monitor: "primary".into(),
            sprite_scale: 3,
            progress: HashMap::new(),
            wins_to_unlock: 5,
            // Roughly one or two an hour: often enough to feel alive, rare
            // enough that it stays an event rather than an interruption.
            encounter_minutes: 40,
            battles_won: 0,
            wins_with: HashMap::new(),
            widget_scale: 100,
        }
    }
}

/// A creature name we are willing to put in a file path or compare against the
/// roster. Letters only, bounded length -- no separators, no traversal.
fn clean_name(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() || t.len() > 32 || !t.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    Some(t.to_string())
}

/// Accelerators are handed straight to the OS shortcut registrar, so keep the
/// character set tight. Anything odd falls back to the default binding.
fn clean_hotkey(s: &str, fallback: &str) -> String {
    let t = s.trim();
    let ok = !t.is_empty()
        && t.len() <= 40
        && t
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == ' ');
    if ok {
        t.to_string()
    } else {
        fallback.to_string()
    }
}

impl Config {
    pub fn sanitise(&mut self) {
        let d = Config::default();

        self.active_creature = clean_name(&self.active_creature).unwrap_or(d.active_creature);
        self.move_timer_seconds = self.move_timer_seconds.clamp(5, 3600);
        self.sprite_scale = self.sprite_scale.clamp(1, 8);

        self.move_hotkey = clean_hotkey(&self.move_hotkey, &d.move_hotkey);
        self.widget_hotkey = clean_hotkey(&self.widget_hotkey, &d.widget_hotkey);
        self.roam_toggle_hotkey = clean_hotkey(&self.roam_toggle_hotkey, &d.roam_toggle_hotkey);
        self.quit_hotkey = clean_hotkey(&self.quit_hotkey, &d.quit_hotkey);

        // Keep the widget somewhere a person could plausibly reach it.
        self.widget_position.x = self.widget_position.x.clamp(-20_000, 20_000);
        self.widget_position.y = self.widget_position.y.clamp(-20_000, 20_000);

        if self.overlay_monitor != "primary" {
            self.overlay_monitor = d.overlay_monitor;
        }

        self.unlocked = self
            .unlocked
            .iter()
            .filter_map(|n| clean_name(n))
            .take(64)
            .collect();
        if self.unlocked.is_empty() {
            self.unlocked = d.unlocked;
        }
        if !self.unlocked.contains(&self.active_creature) {
            self.unlocked.push(self.active_creature.clone());
        }

        self.wins_to_unlock = self.wins_to_unlock.clamp(1, 20);
        if self.encounter_minutes != 0 {
            self.encounter_minutes = self.encounter_minutes.clamp(5, 240);
        }
        self.battles_won = self.battles_won.min(1_000_000);

        // Drop junk keys, cap the tally, and forget progress for anything
        // already earned so the map cannot grow without bound. The cap is a
        // flat ceiling rather than wins_to_unlock, because how many wins a
        // creature costs is now per-creature (rarity + its seed, see
        // typechart.json) and legendaries run to ten.
        let cap = 20u32;
        let unlocked = self.unlocked.clone();
        self.progress = self
            .progress
            .iter()
            .filter_map(|(k, v)| clean_name(k).map(|n| (n, (*v).min(cap))))
            .filter(|(n, _)| !unlocked.contains(n))
            .take(64)
            .collect();

        self.wins_with = self
            .wins_with
            .iter()
            .filter_map(|(k, v)| clean_name(k).map(|n| (n, (*v).min(9999))))
            .take(64)
            .collect();

        // 50%..200% of the design size, in steps the widget offers.
        self.widget_scale = self.widget_scale.clamp(50, 200);
    }
}

/// In-memory copy so reads never hit the disk.
pub struct ConfigState(pub Mutex<Config>);

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create config dir: {e}"))?;
    Ok(dir.join(CONFIG_FILE))
}

/// Read at launch. Any failure -- missing, unreadable, malformed -- yields
/// defaults rather than stopping the app.
pub fn load(app: &AppHandle) -> Config {
    let path = config_path(app);
    let existed = path.as_ref().map(|p| p.exists()).unwrap_or(false);

    let mut cfg = path
        .as_ref()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Config>(&s).ok())
        .unwrap_or_default();
    cfg.sanitise();

    // Write the defaults out on a first run, so the file is there to be found
    // and hand-edited rather than only appearing after the first setting is
    // changed in the widget.
    if !existed {
        let _ = save(app, &cfg);
    }
    cfg
}

fn save(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let path = config_path(app)?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("cannot write config: {e}"))
}

#[tauri::command]
pub fn get_config(state: State<'_, ConfigState>) -> Config {
    state.0.lock().unwrap().clone()
}

/// Apply a partial update. Unknown keys are dropped, every known key is
/// re-validated, and the result is broadcast so both windows stay in step
/// without anyone polling the file.
#[tauri::command]
pub fn set_config(
    app: AppHandle,
    state: State<'_, ConfigState>,
    patch: serde_json::Value,
) -> Result<Config, String> {
    let patch = patch.as_object().ok_or("patch must be an object")?;

    let mut merged = {
        let current = state.0.lock().unwrap();
        serde_json::to_value(&*current).map_err(|e| e.to_string())?
    };

    {
        let target = merged.as_object_mut().ok_or("config is not an object")?;
        for (k, v) in patch {
            // Only keys the struct already defines -- junk never reaches serde.
            if target.contains_key(k) {
                target.insert(k.clone(), v.clone());
            }
        }
    }

    let mut next: Config = serde_json::from_value(merged).map_err(|e| e.to_string())?;
    next.sanitise();

    save(&app, &next)?;
    *state.0.lock().unwrap() = next.clone();
    let _ = app.emit(CONFIG_CHANGED, &next);
    Ok(next)
}

#[tauri::command]
pub fn reset_config(app: AppHandle, state: State<'_, ConfigState>) -> Result<Config, String> {
    let next = Config::default();
    save(&app, &next)?;
    *state.0.lock().unwrap() = next.clone();
    let _ = app.emit(CONFIG_CHANGED, &next);
    Ok(next)
}
