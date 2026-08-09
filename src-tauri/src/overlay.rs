// overlay.rs — the transparent always-on-top strip the pet walks along,
// and the cursor watcher that makes it selectively clickable.
//
// THE CLICK-THROUGH PROBLEM
// The overlay covers the full width of the screen. If it swallowed mouse
// input you could not click your taskbar, so it is set to ignore cursor
// events. But then the webview receives no mouse events at all, which means
// JavaScript cannot tell when the pointer is over the sprite -- and §5 wants
// clicking the pet to make it hop.
//
// The fix lives here rather than in JS: the frontend reports the sprite's
// bounding box via set_hit_rect, a background thread compares the real cursor
// position against it, and toggles cursor-event-ignoring as the pointer
// enters and leaves. The webview only becomes clickable for the handful of
// pixels the creature actually occupies.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

pub const OVERLAY: &str = "overlay";

/// Height of the bottom strip, in logical pixels. Tall enough for a scaled
/// sprite plus headroom for particles and hop arcs.
const STRIP_H: f64 = 160.0;

/// Sprite bounds in CSS pixels, relative to the overlay window.
#[derive(Debug, Clone, Copy, Default)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub struct OverlayState {
    pub hit: Mutex<Option<HitRect>>,
    /// Mirrors the window's current mode so we only call into the windowing
    /// system on an actual edge, not 60 times a second.
    pub ignoring: AtomicBool,
}

impl Default for OverlayState {
    fn default() -> Self {
        OverlayState {
            hit: Mutex::new(None),
            ignoring: AtomicBool::new(true),
        }
    }
}

/// Called by the overlay each time the sprite moves appreciably.
#[tauri::command]
pub fn set_hit_rect(state: tauri::State<'_, OverlayState>, x: f64, y: f64, w: f64, h: f64) {
    let rect = if w <= 0.0 || h <= 0.0 {
        None
    } else {
        Some(HitRect { x, y, w, h })
    };
    *state.hit.lock().unwrap() = rect;
}

/// Stretch the overlay across the bottom of the primary monitor.
/// Returns the strip size in CSS pixels so the frontend can size its canvas.
pub fn position_overlay(app: &AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(OVERLAY)
        .ok_or("overlay window missing")?;

    let monitor = win
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("no primary monitor")?;

    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let size = monitor.size();
    let strip_h = (STRIP_H * scale).round() as u32;

    win.set_size(PhysicalSize::new(size.width, strip_h))
        .map_err(|e| e.to_string())?;
    win.set_position(PhysicalPosition::new(
        pos.x,
        pos.y + size.height as i32 - strip_h as i32,
    ))
    .map_err(|e| e.to_string())?;

    // Start fully click-through; the watcher opens a hole when needed.
    win.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
    win.show().map_err(|e| e.to_string())?;
    Ok(())
}

/// Polls the cursor and toggles click-through. Also feeds the overlay a
/// throttled cursor position so the pet can glance towards the pointer (§5)
/// even while it is receiving no mouse events of its own.
pub fn spawn_cursor_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut tick: u32 = 0;
        loop {
            std::thread::sleep(Duration::from_millis(16));
            tick = tick.wrapping_add(1);

            let Some(win) = app.get_webview_window(OVERLAY) else {
                continue;
            };
            let state = app.state::<OverlayState>();

            let (Ok(cursor), Ok(origin), Ok(scale)) =
                (app.cursor_position(), win.outer_position(), win.scale_factor())
            else {
                continue;
            };

            // Cursor in the overlay's own CSS pixel space.
            let cx = (cursor.x - origin.x as f64) / scale;
            let cy = (cursor.y - origin.y as f64) / scale;

            let over = match *state.hit.lock().unwrap() {
                Some(r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h,
                None => false,
            };

            // Only touch the window when the answer actually changes.
            let want_ignore = !over;
            if state.ignoring.load(Ordering::Relaxed) != want_ignore {
                if win.set_ignore_cursor_events(want_ignore).is_ok() {
                    state.ignoring.store(want_ignore, Ordering::Relaxed);
                }
            }

            // ~10Hz is plenty for a glance direction and keeps the IPC quiet.
            if tick % 6 == 0 {
                let _ = win.emit("cursor-pos", (cx, cy));
            }

            // Re-assert always-on-top every couple of seconds.
            //
            // The taskbar is itself a topmost window, and among topmost
            // windows Windows orders by whichever was raised most recently.
            // Anything that raises the taskbar -- auto-hide reappearing,
            // Win+D, a full-screen app exiting, another always-on-top tool --
            // therefore buries the pet behind it until something raises us
            // again. Setting the flag it already believes it has is enough to
            // put us back on top, and one SetWindowPos every 2s costs
            // nothing.
            if tick % 120 == 0 {
                let _ = win.set_always_on_top(true);
            }
        }
    });
}
