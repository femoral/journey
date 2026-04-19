// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // WSLg doesn't propagate Windows' DPI scale; let the user override
            // via JOURNEY_ZOOM (e.g. 1.0, 1.5, 2.0) without rebuilding.
            let zoom: f64 = std::env::var("JOURNEY_ZOOM")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1.5);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_zoom(zoom);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
