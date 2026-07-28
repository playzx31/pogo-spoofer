mod commands;
mod database;
mod device;
mod location;

use std::sync::Mutex;

use database::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let conn = database::init(app.handle())?;
            app.manage(AppState { db: Mutex::new(conn) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_health_check,
            commands::get_db_path,
            commands::record_device_event,
            commands::list_device_events,
            commands::record_location_event,
            commands::list_location_events,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
