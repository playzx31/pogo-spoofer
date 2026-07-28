//! Real GPS location simulation for a paired, Developer-Mode-enabled iOS
//! device, via the `com.apple.dt.simulatelocation` lockdown service (the
//! same one Xcode's "Simulate Location" feature uses). No memory reading,
//! no packet manipulation, no Pokémon GO involvement - this only asks the
//! OS to report a different location, exactly as Apple's own developer
//! tooling does.

use idevice::simulate_location::LocationSimulationService;
use idevice::IdeviceService;
use serde::Serialize;
use tauri::State;

use crate::device::{describe_error, provider_for, DeviceErrorInfo};

use super::validate::validate_coordinates;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocationState {
    Idle,
    Set,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationStatus {
    pub state: LocationState,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

/// Per-device "what did we last tell the device" cache, since the
/// simulate-location service itself is set/clear only - it has no "what is
/// the current simulated location" query to ask the device.
#[derive(Default)]
pub struct LocationManager {
    last: std::sync::Mutex<std::collections::HashMap<String, LocationStatus>>,
}

/// Sends a real location-simulation request to the device. Never reports
/// success unless the device actually accepted it - Developer Mode being
/// off, the Developer Disk Image not being mounted, or the device being
/// locked all surface as the real error here, not a generic failure.
#[tauri::command]
pub async fn set_location(
    manager: State<'_, LocationManager>,
    udid: String,
    latitude: f64,
    longitude: f64,
) -> Result<LocationStatus, DeviceErrorInfo> {
    let (latitude, longitude) = validate_coordinates(latitude, longitude).map_err(|message| DeviceErrorInfo {
        message,
        suggested_action: None,
    })?;

    let provider = provider_for(&udid).await?;
    let mut service = LocationSimulationService::connect(&provider)
        .await
        .map_err(|e| describe_error(&e))?;
    service
        .set(&latitude.to_string(), &longitude.to_string())
        .await
        .map_err(|e| describe_error(&e))?;

    let status = LocationStatus {
        state: LocationState::Set,
        latitude: Some(latitude),
        longitude: Some(longitude),
    };
    manager.last.lock().unwrap().insert(udid, status.clone());
    Ok(status)
}

/// Clears any simulated location, returning the device to reporting its
/// real GPS position.
#[tauri::command]
pub async fn clear_location(
    manager: State<'_, LocationManager>,
    udid: String,
) -> Result<LocationStatus, DeviceErrorInfo> {
    let provider = provider_for(&udid).await?;
    let mut service = LocationSimulationService::connect(&provider)
        .await
        .map_err(|e| describe_error(&e))?;
    service.clear().await.map_err(|e| describe_error(&e))?;

    let status = LocationStatus {
        state: LocationState::Idle,
        latitude: None,
        longitude: None,
    };
    manager.last.lock().unwrap().insert(udid, status.clone());
    Ok(status)
}

/// Returns the last location this app told the device to simulate. This is
/// locally tracked, not queried from the device (the protocol has no way to
/// ask); it reflects "what we last successfully sent", not necessarily
/// "what CoreLocation is reporting right now" if something else changed it.
#[tauri::command]
pub fn get_location_status(manager: State<'_, LocationManager>, udid: String) -> LocationStatus {
    manager
        .last
        .lock()
        .unwrap()
        .get(&udid)
        .cloned()
        .unwrap_or(LocationStatus {
            state: LocationState::Idle,
            latitude: None,
            longitude: None,
        })
}
