use serde::{Deserialize, Serialize};

/// Information about a connected Apple device.
///
/// Populated today by `MockDeviceProvider` on the frontend. Once native USB
/// detection lands (see project priority list, phase 6) it will be produced
/// here in Rust by shelling out to `libimobiledevice` tooling (`idevice_id`,
/// `ideviceinfo`) or an equivalent Rust binding, and exposed through a
/// `list_devices` / `get_device_status` command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
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
        "INSERT INTO device_events (event, device_name, device_model, os_version, trusted, message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            event,
            device.map(|d| d.name.as_str()),
            device.map(|d| d.model.as_str()),
            device.map(|d| d.os_version.as_str()),
            device.map(|d| d.trusted as i32),
            message,
        ],
    )?;
    Ok(())
}
