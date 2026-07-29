//! iOS 17+ location simulation via the "modern" developer-service stack.
//!
//! On iOS 17+, `com.apple.dt.simulatelocation` (the classic lockdown
//! service `legacy.rs`/`simulate_location` uses) is no longer reachable via
//! plain `StartService` - it returns the device-reported error
//! `InvalidService` (confirmed against a physical iPadOS 18.7.8 device).
//! The real path Xcode itself uses now is:
//!
//!   CoreDeviceProxy (classic lockdown bootstrap)
//!   -> CDTunnel handshake (raw IPv6-over-USB tunnel)
//!   -> software TCP/IP stack (no OS-level TUN adapter needed/possible from
//!      an unprivileged Windows app)
//!   -> RSD (Remote Service Discovery) over that tunnel
//!   -> DVT RemoteServer (`com.apple.instruments.dtservicehub`)
//!   -> the `LocationSimulation` DVT channel
//!
//! This mirrors the `idevice` crate's own reference CLI implementation
//! (`tools/src/location_simulation.rs` in jkcoxson/idevice) as closely as
//! possible - composing these primitives slightly wrong is easy to get
//! subtly broken in ways that are hard to diagnose without hardware, so the
//! proven reference sequence is followed exactly rather than improvised.

use idevice::core_device_proxy::CoreDeviceProxy;
use idevice::dvt::location_simulation::LocationSimulationClient;
use idevice::dvt::remote_server::RemoteServerClient;
use idevice::provider::{RsdProvider, UsbmuxdProvider};
use idevice::rsd::RsdHandshake;
use idevice::{IdeviceError, IdeviceService, ReadWrite, RsdService};

/// The concrete `RemoteServerClient` instantiation `idevice` implements
/// `RsdService` for. Named so the DVT connection below can call the trait's
/// methods with an explicit, fully-concrete `as RsdService` qualification
/// instead of going through `RsdHandshake::connect::<T>()`'s generic
/// dispatch - that generic path triggers a "implementation of `RsdService`
/// is not general enough" error once this code is nested inside a
/// `#[tauri::command]` async fn (a higher-ranked-trait-bound inference
/// limitation with `impl Future` in traits), even though the exact same
/// sequence works fine in the idevice crate's own reference CLI.
type DvtClient = RemoteServerClient<Box<dyn ReadWrite>>;

/// Which stage of the modern connection sequence failed, so the UI can say
/// exactly what broke instead of a generic "failed to set location".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocationStage {
    UsbConnection,
    CoreDeviceTunnel,
    SoftwareTcpStack,
    RsdDiscovery,
    DvtRemoteServer,
    LocationSimulationChannel,
    SetLocation,
    ClearLocation,
    LegacyLockdownService,
}

impl LocationStage {
    pub fn label(self) -> &'static str {
        match self {
            LocationStage::UsbConnection => "Apple USB/usbmuxd connection",
            LocationStage::CoreDeviceTunnel => {
                "CoreDevice tunnel (com.apple.internal.devicecompute.CoreDeviceProxy)"
            }
            LocationStage::SoftwareTcpStack => "software TCP/IP tunnel",
            LocationStage::RsdDiscovery => "RSD service discovery",
            LocationStage::DvtRemoteServer => "DVT RemoteServer (com.apple.instruments.dtservicehub)",
            LocationStage::LocationSimulationChannel => "DVT LocationSimulation channel",
            LocationStage::SetLocation => "set-location request",
            LocationStage::ClearLocation => "clear-location request",
            LocationStage::LegacyLockdownService => {
                "legacy simulate_location service (com.apple.dt.simulatelocation)"
            }
        }
    }
}

pub type StageError = (LocationStage, IdeviceError);

/// A live modern location-simulation session. Establishing one is
/// expensive (five network round trips through a freshly built tunnel), so
/// callers should keep it around and reuse it across multiple
/// `set`/`clear` calls rather than reconnecting every time - see
/// `LocationManager` in `real.rs`.
pub struct ModernLocationSession {
    remote_server: DvtClient,
}

impl ModernLocationSession {
    /// Runs the full CoreDeviceProxy -> tunnel -> RSD -> DVT sequence.
    pub async fn connect(provider: &UsbmuxdProvider) -> Result<Self, StageError> {
        let proxy = CoreDeviceProxy::connect(provider)
            .await
            .map_err(|e| (LocationStage::CoreDeviceTunnel, e))?;

        let rsd_port = proxy.tunnel_info().server_rsd_port;

        let adapter = proxy
            .create_software_tunnel()
            .map_err(|e| (LocationStage::SoftwareTcpStack, e))?;
        let mut handle = adapter.to_async_handle();

        let stream = handle
            .connect(rsd_port)
            .await
            .map_err(|e| (LocationStage::SoftwareTcpStack, IdeviceError::Socket(e)))?;

        let handshake = RsdHandshake::new(stream)
            .await
            .map_err(|e| (LocationStage::RsdDiscovery, e))?;

        // Equivalent to `DvtClient::connect_rsd(&mut handle, &mut handshake)`,
        // but resolved manually against the fully concrete `DvtClient` type
        // instead of through `RsdHandshake::connect::<T>()`'s generic
        // dispatch - see the `DvtClient` type alias doc comment for why.
        let service_name = <DvtClient as RsdService>::rsd_service_name();
        let service_port = handshake
            .services
            .get(service_name.as_ref())
            .ok_or((LocationStage::DvtRemoteServer, IdeviceError::ServiceNotFound))?
            .port;
        let dvt_stream = handle
            .connect_to_service_port(service_port)
            .await
            .map_err(|e| (LocationStage::DvtRemoteServer, e))?;
        let mut remote_server = <DvtClient as RsdService>::from_stream(dvt_stream)
            .await
            .map_err(|e| (LocationStage::DvtRemoteServer, e))?;

        // The reference implementation performs one root-channel read right
        // after connecting, before opening any sub-channel - without it the
        // LocationSimulation channel handshake hangs.
        remote_server
            .read_message(0)
            .await
            .map_err(|e| (LocationStage::DvtRemoteServer, e))?;

        Ok(Self { remote_server })
    }

    pub async fn set(&mut self, latitude: f64, longitude: f64) -> Result<(), StageError> {
        let mut client = LocationSimulationClient::new(&mut self.remote_server)
            .await
            .map_err(|e| (LocationStage::LocationSimulationChannel, e))?;
        client
            .set(latitude, longitude)
            .await
            .map_err(|e| (LocationStage::SetLocation, e))
    }

    pub async fn clear(&mut self) -> Result<(), StageError> {
        let mut client = LocationSimulationClient::new(&mut self.remote_server)
            .await
            .map_err(|e| (LocationStage::LocationSimulationChannel, e))?;
        client
            .clear()
            .await
            .map_err(|e| (LocationStage::ClearLocation, e))
    }
}
