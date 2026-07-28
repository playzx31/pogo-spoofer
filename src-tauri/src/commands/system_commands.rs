use tauri::{AppHandle, Manager, State};

use crate::database::AppState;

/// Sanity check used by the Settings/Logs page to confirm the SQLite
/// connection is alive and report how many rows exist so far.
#[tauri::command]
pub fn db_health_check(state: State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(
            "SELECT
                (SELECT COUNT(*) FROM location_events) +
                (SELECT COUNT(*) FROM device_events) +
                (SELECT COUNT(*) FROM movement_sessions) +
                (SELECT COUNT(*) FROM iv_calculations)",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(format!("ok ({count} logged rows)"))
}

#[tauri::command]
pub fn get_db_path(app: AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join("pogo_control_hub.sqlite3").display().to_string())
}
