//! Real GPS location simulation for a paired, Developer-Mode-enabled iOS
//! device.
//!
//! Two backends, tried in order:
//! 1. **Modern** (iOS 17+): CoreDeviceProxy tunnel -> RSD -> DVT
//!    RemoteServer -> LocationSimulation channel (`modern.rs`). This is
//!    what a real iPadOS 18.7.8 device requires - the classic service
//!    below returns the device-reported error `InvalidService` on it.
//! 2. **Legacy** (pre-iOS 17): the classic `com.apple.dt.simulatelocation`
//!    lockdown service, used only when the modern tunnel bootstrap itself
//!    isn't available (i.e. an older device that predates it).
//!
//! No memory reading, no packet manipulation, no Pokémon GO involvement -
//! this only asks the OS to report a different location, exactly as
//! Apple's own developer tooling does. Every call reports the device's
//! real result; nothing is faked.

use std::collections::HashMap;

use idevice::simulate_location::LocationSimulationService;
use idevice::IdeviceError;
use idevice::IdeviceService;
use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::sync::Mutex as AsyncMutex;

use crate::device::{describe_error, provider_for, DeviceErrorInfo};

use super::modern::{LocationStage, ModernLocationSession};
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

/// Developer-facing diagnostics for the last location-delivery attempt on a
/// device, distinct from `LocationStatus`: that one is "what we last told
/// the device to show" (for the map/UI to trust), this one is "what actually
/// happened at the protocol level" (for understanding *why* something
/// upstream of this app - like an individual app on the device - might not
/// be seeing it), per the investigation into `LocationSimulationClient`'s
/// own doc comment that a connection must be *maintained* to keep a
/// location simulated, not just sent once. See `docs/LOCATION_PROVIDERS.md`.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationDiagnostics {
    /// Milliseconds since the Unix epoch, so the frontend can compute "how
    /// long ago" without this crate needing a timezone-aware date library.
    pub last_request_at_ms: Option<u64>,
    pub last_requested_latitude: Option<f64>,
    pub last_requested_longitude: Option<f64>,
    /// `"set"` or `"clear"`.
    pub last_operation: Option<&'static str>,
    /// `"modern"` (CoreDeviceProxy/RSD/DVT) or `"legacy"` (classic lockdown
    /// service) - whichever backend actually handled the last request.
    pub backend: Option<&'static str>,
    /// `"success"`, or the real error message if the last request failed.
    pub last_result: Option<String>,
    /// Whether a modern-path session is currently cached (alive) for this
    /// device. Per `LocationSimulationClient`'s own documentation, the
    /// connection must be maintained to keep a location simulated - `false`
    /// here after a successful `set` means the session was dropped (e.g. a
    /// later failure tore it down), which is worth knowing when a
    /// downstream app reports it can't get a location fix.
    pub session_active: bool,
    pub total_requests: u64,
    pub successful_requests: u64,
}

/// Per-device state: the last location this app told the device to
/// simulate (the protocol has no "what's the current simulated location"
/// query, so this is locally tracked), a cached modern session so repeated
/// `set_location` calls (teleport, every movement tick) reuse the same
/// tunnel instead of paying its five-round-trip setup cost every time, and
/// developer diagnostics about the last delivery attempt.
#[derive(Default)]
pub struct LocationManager {
    last: std::sync::Mutex<HashMap<String, LocationStatus>>,
    sessions: AsyncMutex<HashMap<String, ModernLocationSession>>,
    diagnostics: std::sync::Mutex<HashMap<String, LocationDiagnostics>>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Records what actually happened for the most recent `set`/`clear` attempt
/// on `udid`, regardless of whether it succeeded - a failed attempt is just
/// as important to see here as a successful one.
#[allow(clippy::too_many_arguments)]
fn record_diagnostics(
    manager: &LocationManager,
    udid: &str,
    operation: &'static str,
    backend: &'static str,
    latitude: Option<f64>,
    longitude: Option<f64>,
    result: &Result<(), DeviceErrorInfo>,
    session_active: bool,
) {
    let mut diagnostics = manager.diagnostics.lock().unwrap();
    let entry = diagnostics.entry(udid.to_string()).or_default();
    entry.last_request_at_ms = Some(now_ms());
    entry.last_requested_latitude = latitude;
    entry.last_requested_longitude = longitude;
    entry.last_operation = Some(operation);
    entry.backend = Some(backend);
    entry.session_active = session_active;
    entry.total_requests += 1;
    match result {
        Ok(()) => {
            entry.successful_requests += 1;
            entry.last_result = Some("success".to_string());
        }
        Err(e) => entry.last_result = Some(e.message.clone()),
    }
}

fn stage_error(stage: LocationStage, e: &IdeviceError) -> DeviceErrorInfo {
    let base = describe_error(e);
    DeviceErrorInfo {
        message: format!("[{}] {}", stage.label(), base.message),
        suggested_action: base.suggested_action,
    }
}

/// Whether `e` indicates a Developer Mode/Developer Disk Image prerequisite
/// stopped the operation, as opposed to a transient/unrelated failure - the
/// signal the device-readiness cache uses to downgrade a stale `Ready`
/// rather than leaving it claiming readiness the device just disproved.
fn is_prerequisite_error(e: &IdeviceError) -> bool {
    matches!(
        e,
        IdeviceError::DeveloperModeNotEnabled | IdeviceError::ImageNotMounted | IdeviceError::ServiceNotFound
    )
}

fn validation_error(message: String) -> DeviceErrorInfo {
    DeviceErrorInfo {
        message,
        suggested_action: None,
    }
}

/// `provider_for`, with its error staged like every other failure here.
async fn staged_provider_for(udid: &str) -> Result<idevice::provider::UsbmuxdProvider, DeviceErrorInfo> {
    provider_for(udid).await.map_err(|e| DeviceErrorInfo {
        message: format!("[{}] {}", LocationStage::UsbConnection.label(), e.message),
        suggested_action: e.suggested_action,
    })
}

/// Whether the modern tunnel bootstrap is available for this device at all.
enum ModernAvailability {
    /// Not available (e.g. an older device) - use the legacy backend.
    Unavailable,
    /// Available, and a session is now cached for `udid` (freshly
    /// established or already there from a previous call).
    Ready,
}

/// Ensures a modern session is cached for `udid`, establishing one if
/// needed. Returns `Unavailable` (rather than an error) only when the
/// modern tunnel bootstrap itself isn't reachable on this device, so the
/// caller can fall back to the legacy backend; any failure *after* that
/// point is returned as a real error, not treated as "try legacy instead" -
/// a device that got this far clearly supports the modern path, so a later
/// failure is a real problem, not a version mismatch.
async fn ensure_modern_session(
    manager: &LocationManager,
    provider: &idevice::provider::UsbmuxdProvider,
    udid: &str,
) -> Result<ModernAvailability, DeviceErrorInfo> {
    let mut sessions = manager.sessions.lock().await;
    if sessions.contains_key(udid) {
        return Ok(ModernAvailability::Ready);
    }

    match ModernLocationSession::connect(provider).await {
        Ok(session) => {
            sessions.insert(udid.to_string(), session);
            Ok(ModernAvailability::Ready)
        }
        Err((LocationStage::CoreDeviceTunnel, _)) => Ok(ModernAvailability::Unavailable),
        Err((stage, e)) => Err(stage_error(stage, &e)),
    }
}

/// Runs `set`/`clear` (whichever `op` performs) against the cached modern
/// session for `udid`. On failure the session is dropped - it may be dead
/// (e.g. the device disconnected mid-session) - so the next call starts
/// clean rather than repeatedly hitting a broken connection. A
/// prerequisite-related failure also downgrades the cached device-readiness
/// status, so `Ready` never keeps claiming readiness the device just
/// disproved.
async fn modern_set(app: &AppHandle, manager: &LocationManager, udid: &str, latitude: f64, longitude: f64) -> Result<(), DeviceErrorInfo> {
    let mut sessions = manager.sessions.lock().await;
    let session = sessions.get_mut(udid).expect("ensure_modern_session must be called first");
    match session.set(latitude, longitude).await {
        Ok(()) => Ok(()),
        Err((stage, e)) => {
            sessions.remove(udid);
            if is_prerequisite_error(&e) {
                crate::device::downgrade_readiness(app, udid);
            }
            Err(stage_error(stage, &e))
        }
    }
}

async fn modern_clear(app: &AppHandle, manager: &LocationManager, udid: &str) -> Result<(), DeviceErrorInfo> {
    let mut sessions = manager.sessions.lock().await;
    let session = sessions.get_mut(udid).expect("ensure_modern_session must be called first");
    match session.clear().await {
        Ok(()) => Ok(()),
        Err((stage, e)) => {
            sessions.remove(udid);
            if is_prerequisite_error(&e) {
                crate::device::downgrade_readiness(app, udid);
            }
            Err(stage_error(stage, &e))
        }
    }
}

async fn legacy_set(
    app: &AppHandle,
    provider: &idevice::provider::UsbmuxdProvider,
    udid: &str,
    latitude: f64,
    longitude: f64,
) -> Result<(), DeviceErrorInfo> {
    let mut service = LocationSimulationService::connect(provider).await.map_err(|e| {
        if is_prerequisite_error(&e) {
            crate::device::downgrade_readiness(app, udid);
        }
        stage_error(LocationStage::LegacyLockdownService, &e)
    })?;
    service
        .set(&latitude.to_string(), &longitude.to_string())
        .await
        .map_err(|e| stage_error(LocationStage::SetLocation, &e))
}

async fn legacy_clear(app: &AppHandle, provider: &idevice::provider::UsbmuxdProvider, udid: &str) -> Result<(), DeviceErrorInfo> {
    let mut service = LocationSimulationService::connect(provider).await.map_err(|e| {
        if is_prerequisite_error(&e) {
            crate::device::downgrade_readiness(app, udid);
        }
        stage_error(LocationStage::LegacyLockdownService, &e)
    })?;
    service
        .clear()
        .await
        .map_err(|e| stage_error(LocationStage::ClearLocation, &e))
}

/// Sends a real location-simulation request to the device. Never reports
/// success unless the device actually accepted it - Developer Mode being
/// off, the Developer Disk Image not being mounted, or the device being
/// locked all surface as the real error here, not a generic failure.
#[tauri::command]
pub async fn set_location(
    app: AppHandle,
    manager: State<'_, LocationManager>,
    udid: String,
    latitude: f64,
    longitude: f64,
) -> Result<LocationStatus, DeviceErrorInfo> {
    let (latitude, longitude) = validate_coordinates(latitude, longitude).map_err(validation_error)?;
    let provider = staged_provider_for(&udid).await?;

    let availability = ensure_modern_session(&manager, &provider, &udid).await?;
    let backend = backend_label(&availability);
    let result = match availability {
        ModernAvailability::Ready => modern_set(&app, &manager, &udid, latitude, longitude).await,
        ModernAvailability::Unavailable => legacy_set(&app, &provider, &udid, latitude, longitude).await,
    };
    let session_active = manager.sessions.lock().await.contains_key(&udid);
    record_diagnostics(&manager, &udid, "set", backend, Some(latitude), Some(longitude), &result, session_active);
    result?;

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
pub async fn clear_location(app: AppHandle, manager: State<'_, LocationManager>, udid: String) -> Result<LocationStatus, DeviceErrorInfo> {
    let provider = staged_provider_for(&udid).await?;

    let availability = ensure_modern_session(&manager, &provider, &udid).await?;
    let backend = backend_label(&availability);
    let result = match availability {
        ModernAvailability::Ready => modern_clear(&app, &manager, &udid).await,
        ModernAvailability::Unavailable => legacy_clear(&app, &provider, &udid).await,
    };
    let session_active = manager.sessions.lock().await.contains_key(&udid);
    record_diagnostics(&manager, &udid, "clear", backend, None, None, &result, session_active);
    result?;

    let status = LocationStatus {
        state: LocationState::Idle,
        latitude: None,
        longitude: None,
    };
    manager.last.lock().unwrap().insert(udid, status.clone());
    Ok(status)
}

fn backend_label(availability: &ModernAvailability) -> &'static str {
    match availability {
        ModernAvailability::Ready => "modern",
        ModernAvailability::Unavailable => "legacy",
    }
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

/// Developer diagnostics for the last location-delivery attempt on `udid` -
/// see `LocationDiagnostics` for what this distinguishes from
/// `get_location_status`. Never faked: reflects only what an actual
/// `set_location`/`clear_location` call actually did.
#[tauri::command]
pub fn get_location_diagnostics(manager: State<'_, LocationManager>, udid: String) -> LocationDiagnostics {
    manager.diagnostics.lock().unwrap().get(&udid).cloned().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_a_successful_set_and_increments_both_counters() {
        let manager = LocationManager::default();
        record_diagnostics(&manager, "udid-1", "set", "modern", Some(42.0), Some(-83.0), &Ok(()), true);

        let diag = manager.diagnostics.lock().unwrap().get("udid-1").cloned().unwrap();
        assert_eq!(diag.total_requests, 1);
        assert_eq!(diag.successful_requests, 1);
        assert_eq!(diag.last_result.as_deref(), Some("success"));
        assert_eq!(diag.last_operation, Some("set"));
        assert_eq!(diag.backend, Some("modern"));
        assert_eq!(diag.last_requested_latitude, Some(42.0));
        assert!(diag.session_active);
        assert!(diag.last_request_at_ms.is_some());
    }

    #[test]
    fn records_a_failure_without_incrementing_successful_requests() {
        let manager = LocationManager::default();
        let err = DeviceErrorInfo {
            message: "device rejected the request".into(),
            suggested_action: None,
        };
        record_diagnostics(&manager, "udid-1", "set", "legacy", Some(1.0), Some(2.0), &Err(err), false);

        let diag = manager.diagnostics.lock().unwrap().get("udid-1").cloned().unwrap();
        assert_eq!(diag.total_requests, 1);
        assert_eq!(diag.successful_requests, 0);
        assert_eq!(diag.last_result.as_deref(), Some("device rejected the request"));
        assert!(!diag.session_active);
    }

    #[test]
    fn accumulates_totals_across_multiple_calls_for_the_same_device() {
        let manager = LocationManager::default();
        record_diagnostics(&manager, "udid-1", "set", "modern", Some(1.0), Some(1.0), &Ok(()), true);
        record_diagnostics(&manager, "udid-1", "set", "modern", Some(2.0), Some(2.0), &Ok(()), true);
        let err = DeviceErrorInfo {
            message: "boom".into(),
            suggested_action: None,
        };
        record_diagnostics(&manager, "udid-1", "set", "modern", Some(3.0), Some(3.0), &Err(err), false);

        let diag = manager.diagnostics.lock().unwrap().get("udid-1").cloned().unwrap();
        assert_eq!(diag.total_requests, 3);
        assert_eq!(diag.successful_requests, 2);
        // Reflects the most recent attempt, not the first.
        assert_eq!(diag.last_requested_latitude, Some(3.0));
        assert_eq!(diag.last_result.as_deref(), Some("boom"));
    }

    #[test]
    fn keeps_diagnostics_separate_per_device() {
        let manager = LocationManager::default();
        record_diagnostics(&manager, "udid-1", "set", "modern", Some(1.0), Some(1.0), &Ok(()), true);
        record_diagnostics(&manager, "udid-2", "clear", "legacy", None, None, &Ok(()), false);

        let diagnostics = manager.diagnostics.lock().unwrap();
        assert_eq!(diagnostics.get("udid-1").unwrap().last_operation, Some("set"));
        assert_eq!(diagnostics.get("udid-2").unwrap().last_operation, Some("clear"));
    }

    #[test]
    fn get_location_diagnostics_defaults_for_an_unknown_device() {
        let manager = LocationManager::default();
        let diag = manager.diagnostics.lock().unwrap().get("never-seen").cloned().unwrap_or_default();
        assert_eq!(diag.total_requests, 0);
        assert_eq!(diag.last_result, None);
    }

    #[test]
    fn backend_label_matches_availability() {
        assert_eq!(backend_label(&ModernAvailability::Ready), "modern");
        assert_eq!(backend_label(&ModernAvailability::Unavailable), "legacy");
    }
}
