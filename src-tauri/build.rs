// build.rs — runs before compilation. Generates the Tauri context: bundles
// tauri.conf.json, the capability files, and the icons into the binary.
// Nothing to configure here; Tauri owns this step.
fn main() {
    tauri_build::build()
}
