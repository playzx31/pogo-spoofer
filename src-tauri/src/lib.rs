mod commands;
mod database;
mod device;
/// Public so `src/bin/diagnose.rs` (a separate binary crate) can drive the
/// real hardware diagnostic without going through Tauri/the GUI at all.
pub mod diagnostics;
mod location;

use std::sync::Mutex;

use database::AppState;
use device::DeviceManager;
use location::LocationManager;
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
            app.manage(DeviceManager::default());
            app.manage(LocationManager::default());

            device::spawn_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_health_check,
            commands::get_db_path,
            commands::record_device_event,
            commands::list_device_events,
            commands::record_location_event,
            commands::list_location_events,
            device::list_devices,
            device::refresh_devices,
            device::get_device_info,
            device::pair_device,
            location::set_location,
            location::clear_location,
            location::get_location_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
