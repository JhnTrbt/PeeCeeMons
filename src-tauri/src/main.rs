// main.rs — process entry point.
//
// The windows_subsystem attribute stops a console window flashing up behind
// the app in release builds. Everything real happens in lib.rs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    peeceemons_lib::run()
}
