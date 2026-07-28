mod real;

// Wildcard re-export (not a named list): `#[tauri::command]` also generates
// hidden `__cmd__*` items alongside each function, and `tauri::generate_handler!`
// needs those visible at the path it's given. A named `pub use real::{foo}`
// only re-exports `foo` itself, not its hidden sibling, which breaks the
// macro; `pub use real::*` brings both.
pub use real::*;

use serde::{Deserialize, Serialize};

/// Information about a connected Apple device, as reported by the real
/// (idevice-backed) device provider or persisted to the event log.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub udid: String,
    pub name: String,
    pub model: String,
    pub os_version: String,
    pub connection_type: String,
    pub trusted: bool,
}

/// Persists a device connection lifecycle event (connect/disconnect/error)
/// for the History/Logs pages. `device` is `None` for a plain error event
/// that occurred before any device info was available (e.g. "not trusted").
pub fn record_event(
    conn: &rusqlite::Connection,
    event: &str,
    device: Option<&DeviceInfo>,
    message: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO device_events (event, udid, device_name, device_model, os_version, trusted, message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            event,
            device.map(|d| d.udid.as_str()),
            device.map(|d| d.name.as_str()),
            device.map(|d| d.model.as_str()),
            device.map(|d| d.os_version.as_str()),
            device.map(|d| d.trusted as i32),
            message,
        ],
    )?;
    Ok(())
}
