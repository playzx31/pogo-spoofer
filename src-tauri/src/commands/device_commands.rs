use serde::Serialize;
use tauri::State;

use crate::database::AppState;
use crate::device::{self, DeviceInfo};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEventRow {
    pub id: i64,
    pub event: String,
    pub device_name: Option<String>,
    pub device_model: Option<String>,
    pub os_version: Option<String>,
    pub trusted: Option<bool>,
    pub message: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn record_device_event(
    state: State<AppState>,
    event: String,
    device: Option<DeviceInfo>,
    message: Option<String>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    device::record_event(&conn, &event, device.as_ref(), message.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_device_events(state: State<AppState>, limit: i64) -> Result<Vec<DeviceEventRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, event, device_name, device_model, os_version, trusted, message, created_at
             FROM device_events ORDER BY id DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([limit], |row| {
            let trusted: Option<i64> = row.get(5)?;
            Ok(DeviceEventRow {
                id: row.get(0)?,
                event: row.get(1)?,
                device_name: row.get(2)?,
                device_model: row.get(3)?,
                os_version: row.get(4)?,
                trusted: trusted.map(|t| t != 0),
                message: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
