//! Real USB Apple-device detection and pairing, backed by the `idevice`
//! crate (a pure-Rust reimplementation of libimobiledevice's protocols).
//!
//! No mocking, no faked success: every function here either talks to a
//! physical device over `usbmuxd`/lockdown and returns what actually
//! happened, or returns a `DeviceErrorInfo` describing the real failure
//! (missing Apple Mobile Device Support, device not trusted, Developer Mode
//! off, etc.) for the frontend to display verbatim.

use std::sync::Mutex as StdMutex;
use std::time::Duration;

use idevice::lockdown::LockdownClient;
use idevice::mobile_image_mounter::ImageMounter;
use idevice::pairing_file::PairingFile;
use idevice::provider::UsbmuxdProvider;
use idevice::usbmuxd::{UsbmuxdAddr, UsbmuxdConnection, UsbmuxdDevice};
use idevice::{IdeviceError, IdeviceService};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use super::DeviceInfo;

/// Tauri event emitted whenever the background watcher notices the set of
/// attached/trusted devices has changed.
pub const DEVICES_CHANGED_EVENT: &str = "devices-changed";

const APP_LABEL: &str = "pogo-control-hub";
const PAIRING_TIMEOUT: Duration = Duration::from_secs(60);
const POLL_INTERVAL: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeviceState {
    PairingRequired,
    Connected,
    Ready,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceErrorInfo {
    pub message: String,
    pub suggested_action: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
    pub state: DeviceState,
    pub device: Option<DeviceInfo>,
    pub error: Option<DeviceErrorInfo>,
    /// `None` means "not checked yet" - checking requires an extra device
    /// round trip, so the lightweight background scan skips it and only
    /// `get_device_info` (an explicit, on-demand refresh) populates it.
    pub developer_mode_enabled: Option<bool>,
    pub developer_disk_image_mounted: Option<bool>,
}

/// Cache of the most recently observed devices, refreshed by the background
/// watcher (see `spawn_watcher`) and served instantly by `list_devices`.
#[derive(Default)]
pub struct DeviceManager {
    devices: StdMutex<Vec<DeviceStatus>>,
    last_snapshot: StdMutex<String>,
    last_watcher_error: StdMutex<Option<String>>,
}

fn no_usbmuxd_error(e: IdeviceError) -> DeviceErrorInfo {
    DeviceErrorInfo {
        message: format!("Could not reach the Apple USB device service: {e}"),
        suggested_action: Some(
            "Install \"Apple Mobile Device Support\" (bundled with iTunes for Windows, or the \
             \"Apple Devices\" app from the Microsoft Store), then confirm the \"Apple Mobile \
             Device Service\" is running in Windows Services."
                .into(),
        ),
    }
}

fn usbmuxd_addr() -> Result<UsbmuxdAddr, DeviceErrorInfo> {
    UsbmuxdAddr::from_env_var().map_err(|e| DeviceErrorInfo {
        message: format!("Invalid USBMUXD_SOCKET_ADDRESS environment variable: {e}"),
        suggested_action: Some("Unset USBMUXD_SOCKET_ADDRESS to use the default.".into()),
    })
}

/// Translates a real `idevice` protocol error into the message/action pair
/// the UI shows. Falls through to the error's own `Display` text for
/// anything not specifically handled, rather than swallowing detail.
pub(crate) fn describe_error(e: &IdeviceError) -> DeviceErrorInfo {
    use IdeviceError::*;
    match e {
        DeveloperModeNotEnabled => DeviceErrorInfo {
            message: "Developer Mode is not enabled on this device.".into(),
            suggested_action: Some(
                "On the iPad/iPhone: Settings -> Privacy & Security -> Developer Mode -> On, \
                 then let it restart and confirm."
                    .into(),
            ),
        },
        ImageNotMounted | ServiceNotFound => DeviceErrorInfo {
            message: "The Developer Disk Image is not mounted on this device.".into(),
            suggested_action: Some(
                "Location simulation requires the Developer Disk Image. See the README section \
                 \"Developer Disk Image\" for how to mount it from Windows."
                    .into(),
            ),
        },
        PasswordProtected | DeviceLocked => DeviceErrorInfo {
            message: "The device is locked.".into(),
            suggested_action: Some("Unlock the iPad/iPhone with its passcode and try again.".into()),
        },
        UserDeniedPairing => DeviceErrorInfo {
            message: "Trust was declined on the device.".into(),
            suggested_action: Some(
                "Reconnect the cable and tap \"Trust\" when the prompt appears on the device."
                    .into(),
            ),
        },
        PairingDialogResponsePending => DeviceErrorInfo {
            message: "Waiting for you to tap Trust on the device.".into(),
            suggested_action: Some("Unlock the iPad/iPhone and tap \"Trust This Computer\".".into()),
        },
        InvalidHostID | GetProhibited | SessionInactive => DeviceErrorInfo {
            message: "This computer is not trusted by the device yet.".into(),
            suggested_action: Some(
                "Unlock the iPad/iPhone, tap \"Trust This Computer\" when prompted, then try \
                 Connect again."
                    .into(),
            ),
        },
        DeviceNotFound => DeviceErrorInfo {
            message: "The device disconnected during the operation.".into(),
            suggested_action: Some("Reconnect the USB cable and try again.".into()),
        },
        Socket(io_err) => DeviceErrorInfo {
            message: format!("USB communication failed: {io_err}"),
            suggested_action: Some(
                "Check the USB cable/port, and make sure Apple Mobile Device Support is \
                 installed and running."
                    .into(),
            ),
        },
        Timeout => DeviceErrorInfo {
            message: "The device did not respond in time.".into(),
            suggested_action: Some("Unlock the device and try again.".into()),
        },
        other => DeviceErrorInfo {
            message: other.to_string(),
            suggested_action: None,
        },
    }
}

fn placeholder_device(udid: &str, name: &str) -> DeviceInfo {
    DeviceInfo {
        udid: udid.to_string(),
        name: name.to_string(),
        model: "Unknown".into(),
        os_version: "Unknown".into(),
        connection_type: "usb".into(),
        trusted: false,
    }
}

fn error_status(dev: &UsbmuxdDevice, e: &IdeviceError, fallback_state: DeviceState) -> DeviceStatus {
    DeviceStatus {
        state: fallback_state,
        device: Some(placeholder_device(&dev.udid, "Unknown Device")),
        error: Some(describe_error(e)),
        developer_mode_enabled: None,
        developer_disk_image_mounted: None,
    }
}

async fn get_string(lockdown: &mut LockdownClient, key: &str) -> Option<String> {
    lockdown
        .get_value(Some(key), None)
        .await
        .ok()
        .and_then(|v| v.as_string().map(|s| s.to_string()))
}

/// Best-effort, intentionally small mapping from Apple's internal
/// `ProductType` identifiers to the marketing names shown in Settings ->
/// General -> About. Unknown identifiers are shown as-is rather than
/// guessed at - this list is not meant to be exhaustive.
fn humanize_product_type(product_type: &str) -> String {
    let known: &[(&str, &str)] = &[
        ("iPad14,3", "iPad Pro 11-inch (4th generation)"),
        ("iPad14,4", "iPad Pro 11-inch (4th generation)"),
        ("iPad14,5", "iPad Pro 12.9-inch (6th generation)"),
        ("iPad14,6", "iPad Pro 12.9-inch (6th generation)"),
        ("iPad13,18", "iPad (10th generation)"),
        ("iPad13,19", "iPad (10th generation)"),
        ("iPad13,16", "iPad Air (5th generation)"),
        ("iPad13,17", "iPad Air (5th generation)"),
        ("iPad12,1", "iPad (9th generation)"),
        ("iPad12,2", "iPad (9th generation)"),
        ("iPhone16,1", "iPhone 15 Pro"),
        ("iPhone16,2", "iPhone 15 Pro Max"),
        ("iPhone15,4", "iPhone 15"),
        ("iPhone15,5", "iPhone 15 Plus"),
        ("iPhone14,7", "iPhone 14"),
        ("iPhone14,8", "iPhone 14 Plus"),
        ("iPhone15,2", "iPhone 14 Pro"),
        ("iPhone15,3", "iPhone 14 Pro Max"),
    ];
    known
        .iter()
        .find(|(id, _)| *id == product_type)
        .map(|(_, name)| name.to_string())
        .unwrap_or_else(|| product_type.to_string())
}

fn format_os_version(product_type: &str, version: &str) -> String {
    if product_type.starts_with("iPad") {
        format!("iPadOS {version}")
    } else {
        format!("iOS {version}")
    }
}

/// Scans every device usbmuxd currently knows about and builds a full
/// status for each: trust/pairing state plus (if trusted) name/model/OS.
/// Does not check Developer Mode/Developer Disk Image state - that's a
/// separate, heavier check performed on demand by `get_device_info`.
async fn scan_devices() -> Result<Vec<DeviceStatus>, DeviceErrorInfo> {
    let mut usbmuxd = UsbmuxdConnection::default()
        .await
        .map_err(no_usbmuxd_error)?;
    let raw_devices = usbmuxd.get_devices().await.map_err(|e| describe_error(&e))?;
    let addr = usbmuxd_addr()?;

    let mut results = Vec::with_capacity(raw_devices.len());
    for dev in raw_devices {
        results.push(build_status(&mut usbmuxd, &dev, &addr).await);
    }
    Ok(results)
}

async fn build_status(
    usbmuxd: &mut UsbmuxdConnection,
    dev: &UsbmuxdDevice,
    addr: &UsbmuxdAddr,
) -> DeviceStatus {
    let provider = dev.to_provider(addr.clone(), APP_LABEL);

    let pairing_file = match usbmuxd.get_pair_record(&dev.udid).await {
        Ok(p) => p,
        Err(_) => {
            return DeviceStatus {
                state: DeviceState::PairingRequired,
                device: Some(placeholder_device(&dev.udid, "Unpaired Device")),
                error: Some(DeviceErrorInfo {
                    message: "This computer is not trusted by the device yet.".into(),
                    suggested_action: Some(
                        "Unlock the iPad/iPhone and tap \"Trust This Computer\" when the prompt \
                         appears, or click Connect to trigger it."
                            .into(),
                    ),
                }),
                developer_mode_enabled: None,
                developer_disk_image_mounted: None,
            };
        }
    };

    let mut lockdown = match LockdownClient::connect(&provider).await {
        Ok(l) => l,
        Err(e) => return error_status(dev, &e, DeviceState::PairingRequired),
    };

    if let Err(e) = lockdown.start_session(&pairing_file).await {
        return error_status(dev, &e, DeviceState::PairingRequired);
    }

    device_status_from_session(dev, &mut lockdown).await
}

async fn device_status_from_session(dev: &UsbmuxdDevice, lockdown: &mut LockdownClient) -> DeviceStatus {
    let name = get_string(lockdown, "DeviceName")
        .await
        .unwrap_or_else(|| dev.udid.clone());
    let product_type = get_string(lockdown, "ProductType")
        .await
        .unwrap_or_else(|| "Unknown".into());
    let os_version = get_string(lockdown, "ProductVersion")
        .await
        .unwrap_or_else(|| "Unknown".into());

    DeviceStatus {
        state: DeviceState::Connected,
        device: Some(DeviceInfo {
            udid: dev.udid.clone(),
            name,
            model: humanize_product_type(&product_type),
            os_version: format_os_version(&product_type, &os_version),
            connection_type: "usb".into(),
            trusted: true,
        }),
        error: None,
        developer_mode_enabled: None,
        developer_disk_image_mounted: None,
    }
}

/// Checks whether Developer Mode is on and a Developer Disk Image is
/// mounted - the two prerequisites for location simulation. Connecting the
/// image mounter service can leave the device briefly unresponsive to
/// lockdown per `idevice`'s own docs, so a throwaway lockdown query follows
/// each check to restore normal responsiveness.
async fn check_developer_readiness(provider: &UsbmuxdProvider) -> (Option<bool>, Option<bool>) {
    let dev_mode = match ImageMounter::connect(provider).await {
        Ok(mut mounter) => mounter.query_developer_mode_status().await.ok(),
        Err(_) => None,
    };
    let _ = LockdownClient::connect(provider).await;

    let mounted = match ImageMounter::connect(provider).await {
        Ok(mut mounter) => mounter.copy_devices().await.ok().map(|list| !list.is_empty()),
        Err(_) => None,
    };
    let _ = LockdownClient::connect(provider).await;

    (dev_mode, mounted)
}

/// Looks up a currently-attached device by UDID and builds a connection
/// provider for it. Shared with the location module, which needs the same
/// usbmux device handle to reach the location-simulation service.
pub(crate) async fn provider_for(udid: &str) -> Result<UsbmuxdProvider, DeviceErrorInfo> {
    let mut usbmuxd = UsbmuxdConnection::default()
        .await
        .map_err(no_usbmuxd_error)?;
    let dev = usbmuxd.get_device(udid).await.map_err(|e| describe_error(&e))?;
    let addr = usbmuxd_addr()?;
    Ok(dev.to_provider(addr, APP_LABEL))
}

/// Cheap, cached device list - reads whatever the background watcher last
/// observed without touching the device. Use `refresh_devices` or
/// `get_device_info` to force a fresh USB round trip.
#[tauri::command]
pub fn list_devices(manager: State<DeviceManager>) -> Vec<DeviceStatus> {
    manager.devices.lock().unwrap().clone()
}

/// Forces an immediate re-scan of all attached devices (usbmuxd + lockdown),
/// updating the shared cache and returning the fresh result.
#[tauri::command]
pub async fn refresh_devices(app: AppHandle) -> Result<Vec<DeviceStatus>, DeviceErrorInfo> {
    let statuses = scan_devices().await?;
    update_cache_and_emit(&app, statuses.clone());
    Ok(statuses)
}

/// Full, on-demand refresh for a single device: re-runs the same session
/// setup as `refresh_devices`, then additionally checks Developer
/// Mode/Developer Disk Image status (which `refresh_devices` skips to stay
/// fast) and upgrades the state to `Ready` if both are satisfied.
#[tauri::command]
pub async fn get_device_info(app: AppHandle, udid: String) -> Result<DeviceStatus, DeviceErrorInfo> {
    let mut usbmuxd = UsbmuxdConnection::default()
        .await
        .map_err(no_usbmuxd_error)?;
    let dev = usbmuxd.get_device(&udid).await.map_err(|e| describe_error(&e))?;
    let addr = usbmuxd_addr()?;

    let mut status = build_status(&mut usbmuxd, &dev, &addr).await;

    if status.state == DeviceState::Connected {
        let provider = dev.to_provider(addr, APP_LABEL);
        let (dev_mode, mounted) = check_developer_readiness(&provider).await;
        status.developer_mode_enabled = dev_mode;
        status.developer_disk_image_mounted = mounted;
        if dev_mode == Some(true) && mounted == Some(true) {
            status.state = DeviceState::Ready;
        }
    }

    let mut all = list_devices(app.state());
    if let Some(existing) = all.iter_mut().find(|s| matches_udid(s, &udid)) {
        *existing = status.clone();
    } else {
        all.push(status.clone());
    }
    update_cache_and_emit(&app, all);

    Ok(status)
}

fn matches_udid(status: &DeviceStatus, udid: &str) -> bool {
    status.device.as_ref().map(|d| d.udid.as_str()) == Some(udid)
}

/// Initiates (or completes) USB pairing/trust for a device. Blocks, polling
/// the device, until the user taps Trust, the request is denied, or
/// `PAIRING_TIMEOUT` elapses - never returns success without the device
/// actually confirming the pairing.
#[tauri::command]
pub async fn pair_device(app: AppHandle, udid: String) -> Result<DeviceStatus, DeviceErrorInfo> {
    let mut usbmuxd = UsbmuxdConnection::default()
        .await
        .map_err(no_usbmuxd_error)?;
    let dev = usbmuxd.get_device(&udid).await.map_err(|e| describe_error(&e))?;
    let addr = usbmuxd_addr()?;
    let provider = dev.to_provider(addr, APP_LABEL);

    let system_buid = usbmuxd.get_buid().await.map_err(|e| describe_error(&e))?;
    let host_id = Uuid::new_v4().to_string();

    let mut lockdown = LockdownClient::connect(&provider)
        .await
        .map_err(|e| describe_error(&e))?;

    let deadline = tokio::time::Instant::now() + PAIRING_TIMEOUT;
    let pairing_file: PairingFile = loop {
        match lockdown.pair_once(&host_id, &system_buid, Some(APP_LABEL)).await {
            Ok(p) => break p,
            Err(IdeviceError::PairingDialogResponsePending) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(DeviceErrorInfo {
                        message: "Timed out waiting for you to trust this computer.".into(),
                        suggested_action: Some(
                            "Unlock the device, tap \"Trust This Computer\" when the prompt \
                             appears, then click Connect again."
                                .into(),
                        ),
                    });
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            Err(e) => return Err(describe_error(&e)),
        }
    };

    let record_bytes = pairing_file
        .clone()
        .serialize()
        .map_err(|e| describe_error(&e))?;
    usbmuxd
        .save_pair_record(&udid, record_bytes)
        .await
        .map_err(|e| describe_error(&e))?;

    lockdown
        .start_session(&pairing_file)
        .await
        .map_err(|e| describe_error(&e))?;
    let status = device_status_from_session(&dev, &mut lockdown).await;

    let mut all = list_devices(app.state());
    if let Some(existing) = all.iter_mut().find(|s| matches_udid(s, &udid)) {
        *existing = status.clone();
    } else {
        all.push(status.clone());
    }
    update_cache_and_emit(&app, all);

    Ok(status)
}

fn update_cache_and_emit(app: &AppHandle, statuses: Vec<DeviceStatus>) {
    let manager = app.state::<DeviceManager>();
    let snapshot = serde_json::to_string(&statuses).unwrap_or_default();

    let mut last = manager.last_snapshot.lock().unwrap();
    let changed = *last != snapshot;
    *last = snapshot;
    drop(last);

    *manager.devices.lock().unwrap() = statuses.clone();

    if changed {
        let _ = app.emit(DEVICES_CHANGED_EVENT, statuses);
    }
}

/// Background task started once at app startup: polls for attached devices
/// every few seconds and emits `DEVICES_CHANGED_EVENT` only when the result
/// actually differs from last time, so the frontend can stay in sync
/// without the user ever pressing "Connect" first.
pub fn spawn_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            match scan_devices().await {
                Ok(statuses) => {
                    *app.state::<DeviceManager>().last_watcher_error.lock().unwrap() = None;
                    update_cache_and_emit(&app, statuses);
                }
                Err(e) => {
                    // usbmuxd being unreachable (no Apple Mobile Device Support
                    // installed) is a persistent condition, not a one-off - log
                    // it once, not every three seconds forever.
                    let manager = app.state::<DeviceManager>();
                    let mut last_error = manager.last_watcher_error.lock().unwrap();
                    if last_error.as_deref() != Some(e.message.as_str()) {
                        log::warn!("device watcher: {} ({:?})", e.message, e.suggested_action);
                        *last_error = Some(e.message.clone());
                    }
                    drop(last_error);
                    update_cache_and_emit(&app, Vec::new());
                }
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}
