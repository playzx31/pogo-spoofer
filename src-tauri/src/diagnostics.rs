//! Standalone hardware diagnostic for the real iOS 17+/18 location path.
//!
//! Runs the *exact* code the app itself uses - `device::real`'s USB/pairing/
//! Developer Mode checks and `location::modern`'s CoreDeviceProxy -> RSD ->
//! DVT -> LocationSimulation session - against whatever physical device is
//! attached, one stage at a time, and reports a real PASS/FAIL for each.
//! Nothing here is mocked or simulated: a PASS means the device actually
//! responded correctly to that step.
//!
//! `src/bin/diagnose.rs` is the CLI entry point, so verifying the modern
//! location path against real hardware never requires opening the GUI:
//!
//! ```text
//! cargo run --bin diagnose --manifest-path src-tauri/Cargo.toml [-- <UDID>]
//! ```

use idevice::lockdown::LockdownClient;
use idevice::usbmuxd::UsbmuxdConnection;
use idevice::IdeviceService;

use crate::device::{check_developer_readiness, describe_error, usbmuxd_addr, APP_LABEL};
use crate::location::modern::{LocationStage, ModernLocationSession};

/// A harmless, obviously-a-test coordinate (Windsor, ON - the same default
/// the frontend's map view starts at) used for the "set one nearby
/// coordinate" / "clear location" stages. Nothing about the specific point
/// matters beyond being a valid, real-looking location.
pub const TEST_COORDINATE: (f64, f64) = (42.6073, -82.983);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StageOutcome {
    Pass,
    Fail,
    /// Not attempted because an earlier stage it depends on already failed -
    /// reported explicitly rather than silently omitted, so the output
    /// always accounts for all 8 stages.
    Skipped,
}

#[derive(Debug, Clone)]
pub struct StageResult {
    pub name: &'static str,
    pub outcome: StageOutcome,
    pub detail: String,
}

#[derive(Debug, Clone, Default)]
pub struct DiagnosticReport {
    pub stages: Vec<StageResult>,
}

impl DiagnosticReport {
    /// PASS only if every stage that ran actually passed - a `Skipped`
    /// stage never counts as success (it means an earlier real failure
    /// stopped the chain).
    pub fn all_passed(&self) -> bool {
        !self.stages.is_empty() && self.stages.iter().all(|s| s.outcome == StageOutcome::Pass)
    }
}

/// Every stage after a failure is recorded via `skip_rest` rather than
/// attempted - a prerequisite already failed, and guessing whether a later
/// stage might have passed anyway would misrepresent what was actually
/// verified against hardware. Callers enforce this by `return`ing
/// immediately after each `fail`/`skip_rest` pair.
struct Recorder {
    stages: Vec<StageResult>,
}

impl Recorder {
    fn new() -> Self {
        Self { stages: Vec::new() }
    }

    fn pass(&mut self, name: &'static str, detail: impl Into<String>) {
        self.stages.push(StageResult { name, outcome: StageOutcome::Pass, detail: detail.into() });
    }

    fn fail(&mut self, name: &'static str, detail: impl Into<String>) {
        self.stages.push(StageResult { name, outcome: StageOutcome::Fail, detail: detail.into() });
    }

    fn skip_rest(&mut self, remaining: &[&'static str]) {
        for name in remaining {
            self.stages.push(StageResult { name, outcome: StageOutcome::Skipped, detail: "skipped: a prior stage failed".into() });
        }
    }
}

const STAGE_NAMES: [&str; 8] = [
    "Apple USB service (usbmuxd)",
    "Device detected",
    "Pairing / trust",
    "Developer Mode + Developer Disk Image",
    "Modern iOS17+/18 developer connection (CoreDeviceProxy tunnel)",
    "RSD discovery + DVT LocationSimulation service",
    "Set one nearby coordinate",
    "Clear location",
];

/// Runs all 8 stages against `udid` (or, if `None`, the first device
/// usbmuxd reports) and returns every stage's real outcome - PASS, FAIL with
/// the real error, or SKIPPED once a prerequisite stage has failed.
pub async fn run(udid: Option<&str>) -> DiagnosticReport {
    let mut rec = Recorder::new();

    // Stage 1: Apple USB service.
    let mut usbmuxd = match UsbmuxdConnection::default().await {
        Ok(u) => {
            rec.pass(STAGE_NAMES[0], "connected to usbmuxd");
            u
        }
        Err(e) => {
            rec.fail(STAGE_NAMES[0], describe_error(&e).message);
            rec.skip_rest(&STAGE_NAMES[1..]);
            return DiagnosticReport { stages: rec.stages };
        }
    };

    // Stage 2: device detected.
    let addr = match usbmuxd_addr() {
        Ok(a) => a,
        Err(e) => {
            rec.fail(STAGE_NAMES[1], e.message);
            rec.skip_rest(&STAGE_NAMES[2..]);
            return DiagnosticReport { stages: rec.stages };
        }
    };
    let raw_devices = match usbmuxd.get_devices().await {
        Ok(d) => d,
        Err(e) => {
            rec.fail(STAGE_NAMES[1], describe_error(&e).message);
            rec.skip_rest(&STAGE_NAMES[2..]);
            return DiagnosticReport { stages: rec.stages };
        }
    };
    let dev = match udid {
        Some(id) => raw_devices.iter().find(|d| d.udid == id).cloned(),
        None => raw_devices.first().cloned(),
    };
    let dev = match dev {
        Some(d) => {
            let attached: Vec<&str> = raw_devices.iter().map(|d| d.udid.as_str()).collect();
            rec.pass(STAGE_NAMES[1], format!("UDID {} (attached: {:?})", d.udid, attached));
            d
        }
        None => {
            let attached: Vec<&str> = raw_devices.iter().map(|d| d.udid.as_str()).collect();
            let detail = match udid {
                Some(id) => format!("No attached device with UDID {id} (attached: {attached:?})"),
                None => "No device attached".to_string(),
            };
            rec.fail(STAGE_NAMES[1], detail);
            rec.skip_rest(&STAGE_NAMES[2..]);
            return DiagnosticReport { stages: rec.stages };
        }
    };

    // Stage 3: pairing / trust.
    let pairing_file = match usbmuxd.get_pair_record(&dev.udid).await {
        Ok(p) => p,
        Err(_) => {
            rec.fail(STAGE_NAMES[2], "This computer is not trusted by the device yet - unlock it and tap \"Trust\".");
            rec.skip_rest(&STAGE_NAMES[3..]);
            return DiagnosticReport { stages: rec.stages };
        }
    };
    let provider = dev.to_provider(addr, APP_LABEL);
    let mut lockdown = match LockdownClient::connect(&provider).await {
        Ok(l) => l,
        Err(e) => {
            rec.fail(STAGE_NAMES[2], describe_error(&e).message);
            rec.skip_rest(&STAGE_NAMES[3..]);
            return DiagnosticReport { stages: rec.stages };
        }
    };
    if let Err(e) = lockdown.start_session(&pairing_file).await {
        rec.fail(STAGE_NAMES[2], describe_error(&e).message);
        rec.skip_rest(&STAGE_NAMES[3..]);
        return DiagnosticReport { stages: rec.stages };
    }
    rec.pass(STAGE_NAMES[2], "paired and trusted");

    // Stage 4: Developer Mode + Developer Disk Image.
    let (dev_mode, mounted) = check_developer_readiness(&provider).await;
    if dev_mode != Some(true) || mounted != Some(true) {
        rec.fail(
            STAGE_NAMES[3],
            format!("developer_mode_enabled={dev_mode:?}, developer_disk_image_mounted={mounted:?}"),
        );
        rec.skip_rest(&STAGE_NAMES[4..]);
        return DiagnosticReport { stages: rec.stages };
    }
    rec.pass(STAGE_NAMES[3], "Developer Mode on, Developer Disk Image mounted");

    // Stages 5-6: modern tunnel, then RSD/DVT LocationSimulation service.
    // A single `ModernLocationSession::connect` performs both - it reports
    // exactly which of the two failed via `LocationStage`, so this maps its
    // one result onto the two stages rather than re-running any of it.
    let mut session = match ModernLocationSession::connect(&provider).await {
        Ok(s) => {
            rec.pass(STAGE_NAMES[4], "CoreDeviceProxy tunnel established");
            rec.pass(STAGE_NAMES[5], "RSD discovery + DVT RemoteServer + LocationSimulation channel ready");
            s
        }
        Err((LocationStage::CoreDeviceTunnel, e)) => {
            rec.fail(STAGE_NAMES[4], format!("[{}] {}", LocationStage::CoreDeviceTunnel.label(), describe_error(&e).message));
            rec.skip_rest(&STAGE_NAMES[5..]);
            return DiagnosticReport { stages: rec.stages };
        }
        Err((stage, e)) => {
            rec.pass(STAGE_NAMES[4], "CoreDeviceProxy tunnel established");
            rec.fail(STAGE_NAMES[5], format!("[{}] {}", stage.label(), describe_error(&e).message));
            rec.skip_rest(&STAGE_NAMES[6..]);
            return DiagnosticReport { stages: rec.stages };
        }
    };

    // Stage 7: set one nearby coordinate.
    match session.set(TEST_COORDINATE.0, TEST_COORDINATE.1).await {
        Ok(()) => rec.pass(STAGE_NAMES[6], format!("device accepted ({}, {})", TEST_COORDINATE.0, TEST_COORDINATE.1)),
        Err((stage, e)) => {
            rec.fail(STAGE_NAMES[6], format!("[{}] {}", stage.label(), describe_error(&e).message));
            rec.skip_rest(&STAGE_NAMES[7..]);
            return DiagnosticReport { stages: rec.stages };
        }
    }

    // Stage 8: clear location.
    match session.clear().await {
        Ok(()) => rec.pass(STAGE_NAMES[7], "device accepted clear-location request"),
        Err((stage, e)) => rec.fail(STAGE_NAMES[7], format!("[{}] {}", stage.label(), describe_error(&e).message)),
    }

    DiagnosticReport { stages: rec.stages }
}

/// A single coordinate write during the repeated-movement test, with its
/// real outcome and how long the device actually took to respond - the
/// per-request timing the "Apple Maps hardware test" needs to show movement
/// updates are being delivered continuously, not just once.
#[derive(Debug, Clone)]
pub struct MovementStep {
    pub label: &'static str,
    pub latitude: f64,
    pub longitude: f64,
    pub outcome: StageOutcome,
    pub detail: String,
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, Default)]
pub struct MovementTestReport {
    /// Device-detected/READY prerequisites, checked before any movement is
    /// attempted - same idea as `DiagnosticReport`'s first stages, just
    /// collapsed to two since this report's focus is the movement sequence.
    pub connection: Vec<StageResult>,
    /// Which backend handled the sequence, once a session was established.
    pub backend: Option<&'static str>,
    pub movement: Vec<MovementStep>,
}

impl MovementTestReport {
    /// PASS only if every connection prerequisite AND every movement step
    /// (including the final clear) actually succeeded.
    pub fn all_passed(&self) -> bool {
        !self.connection.is_empty()
            && self.connection.iter().all(|s| s.outcome == StageOutcome::Pass)
            && !self.movement.is_empty()
            && self.movement.iter().all(|s| s.outcome == StageOutcome::Pass)
    }
}

/// One "step" of latitude north of `TEST_COORDINATE` per movement update -
/// about 100m, a plausible walking-speed step, not a teleport-sized jump.
const MOVEMENT_STEP_DEGREES: f64 = 0.0009;
const MOVEMENT_STEP_LABELS: [&str; 5] = ["A", "B", "C", "D", "E"];

/// The "Apple Maps hardware test": proves *repeated* real-device location
/// updates work independently of the GUI - set A, wait, set B a short
/// distance north, wait, set C, and so on, then clear - printing PASS/FAIL,
/// the requested coordinate, elapsed time, and backend for every write. This
/// is what distinguishes "one location update reached the device" (which
/// `run` above already proves) from "a continuous stream of updates
/// reaches the device", which is what real movement (and, on the device
/// side, whether a location fix stays fresh) actually needs.
pub async fn run_movement_test(udid: Option<&str>) -> MovementTestReport {
    let mut connection = Vec::new();

    let mut usbmuxd = match UsbmuxdConnection::default().await {
        Ok(u) => u,
        Err(e) => {
            connection.push(StageResult { name: "Device detected", outcome: StageOutcome::Fail, detail: describe_error(&e).message });
            return MovementTestReport { connection, ..Default::default() };
        }
    };
    let addr = match usbmuxd_addr() {
        Ok(a) => a,
        Err(e) => {
            connection.push(StageResult { name: "Device detected", outcome: StageOutcome::Fail, detail: e.message });
            return MovementTestReport { connection, ..Default::default() };
        }
    };
    let raw_devices = match usbmuxd.get_devices().await {
        Ok(d) => d,
        Err(e) => {
            connection.push(StageResult { name: "Device detected", outcome: StageOutcome::Fail, detail: describe_error(&e).message });
            return MovementTestReport { connection, ..Default::default() };
        }
    };
    let dev = match udid {
        Some(id) => raw_devices.iter().find(|d| d.udid == id).cloned(),
        None => raw_devices.first().cloned(),
    };
    let dev = match dev {
        Some(d) => d,
        None => {
            connection.push(StageResult { name: "Device detected", outcome: StageOutcome::Fail, detail: "No device attached".into() });
            return MovementTestReport { connection, ..Default::default() };
        }
    };
    connection.push(StageResult { name: "Device detected", outcome: StageOutcome::Pass, detail: format!("UDID {}", dev.udid) });

    let pairing_file = match usbmuxd.get_pair_record(&dev.udid).await {
        Ok(p) => p,
        Err(_) => {
            connection.push(StageResult { name: "READY", outcome: StageOutcome::Fail, detail: "not paired/trusted".into() });
            return MovementTestReport { connection, ..Default::default() };
        }
    };
    let provider = dev.to_provider(addr, APP_LABEL);
    let mut lockdown = match LockdownClient::connect(&provider).await {
        Ok(l) => l,
        Err(e) => {
            connection.push(StageResult { name: "READY", outcome: StageOutcome::Fail, detail: describe_error(&e).message });
            return MovementTestReport { connection, ..Default::default() };
        }
    };
    if let Err(e) = lockdown.start_session(&pairing_file).await {
        connection.push(StageResult { name: "READY", outcome: StageOutcome::Fail, detail: describe_error(&e).message });
        return MovementTestReport { connection, ..Default::default() };
    }

    let (dev_mode, mounted) = check_developer_readiness(&provider).await;
    if dev_mode != Some(true) || mounted != Some(true) {
        connection.push(StageResult {
            name: "READY",
            outcome: StageOutcome::Fail,
            detail: format!("developer_mode_enabled={dev_mode:?}, developer_disk_image_mounted={mounted:?}"),
        });
        return MovementTestReport { connection, ..Default::default() };
    }

    let mut session = match ModernLocationSession::connect(&provider).await {
        Ok(s) => s,
        Err((stage, e)) => {
            connection.push(StageResult {
                name: "READY",
                outcome: StageOutcome::Fail,
                detail: format!("[{}] {}", stage.label(), describe_error(&e).message),
            });
            return MovementTestReport { connection, ..Default::default() };
        }
    };
    connection.push(StageResult { name: "READY", outcome: StageOutcome::Pass, detail: "Developer Mode + Developer Disk Image + modern tunnel all confirmed".into() });

    let mut movement = Vec::new();
    let mut latitude = TEST_COORDINATE.0;
    let longitude = TEST_COORDINATE.1;
    for label in MOVEMENT_STEP_LABELS {
        let started = std::time::Instant::now();
        let result = session.set(latitude, longitude).await;
        let elapsed_ms = started.elapsed().as_millis();
        match result {
            Ok(()) => movement.push(MovementStep {
                label,
                latitude,
                longitude,
                outcome: StageOutcome::Pass,
                detail: "device accepted".into(),
                elapsed_ms,
            }),
            Err((stage, e)) => {
                movement.push(MovementStep {
                    label,
                    latitude,
                    longitude,
                    outcome: StageOutcome::Fail,
                    detail: format!("[{}] {}", stage.label(), describe_error(&e).message),
                    elapsed_ms,
                });
                return MovementTestReport { connection, backend: Some("modern"), movement };
            }
        }
        latitude += MOVEMENT_STEP_DEGREES;
    }

    let started = std::time::Instant::now();
    match session.clear().await {
        Ok(()) => movement.push(MovementStep {
            label: "clear",
            latitude: 0.0,
            longitude: 0.0,
            outcome: StageOutcome::Pass,
            detail: "device accepted clear-location request".into(),
            elapsed_ms: started.elapsed().as_millis(),
        }),
        Err((stage, e)) => movement.push(MovementStep {
            label: "clear",
            latitude: 0.0,
            longitude: 0.0,
            outcome: StageOutcome::Fail,
            detail: format!("[{}] {}", stage.label(), describe_error(&e).message),
            elapsed_ms: started.elapsed().as_millis(),
        }),
    }

    MovementTestReport { connection, backend: Some("modern"), movement }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stage(name: &'static str, outcome: StageOutcome) -> StageResult {
        StageResult { name, outcome, detail: String::new() }
    }

    #[test]
    fn all_passed_is_true_only_when_every_stage_passed() {
        let report = DiagnosticReport {
            stages: vec![stage("a", StageOutcome::Pass), stage("b", StageOutcome::Pass)],
        };
        assert!(report.all_passed());
    }

    #[test]
    fn all_passed_is_false_if_any_stage_failed() {
        let report = DiagnosticReport {
            stages: vec![stage("a", StageOutcome::Pass), stage("b", StageOutcome::Fail)],
        };
        assert!(!report.all_passed());
    }

    #[test]
    fn all_passed_is_false_if_any_stage_was_skipped() {
        // A skipped stage was never actually verified against hardware, so
        // it must never silently count as a PASS.
        let report = DiagnosticReport {
            stages: vec![stage("a", StageOutcome::Pass), stage("b", StageOutcome::Skipped)],
        };
        assert!(!report.all_passed());
    }

    #[test]
    fn all_passed_is_false_for_an_empty_report() {
        // An empty report means nothing actually ran - never treat "we
        // checked nothing" the same as "everything checked out fine".
        assert!(!DiagnosticReport::default().all_passed());
    }

    fn movement_step(label: &'static str, outcome: StageOutcome) -> MovementStep {
        MovementStep { label, latitude: 0.0, longitude: 0.0, outcome, detail: String::new(), elapsed_ms: 0 }
    }

    #[test]
    fn movement_test_all_passed_requires_connection_and_movement_to_both_succeed() {
        let report = MovementTestReport {
            connection: vec![stage("Device detected", StageOutcome::Pass), stage("READY", StageOutcome::Pass)],
            backend: Some("modern"),
            movement: vec![movement_step("A", StageOutcome::Pass), movement_step("clear", StageOutcome::Pass)],
        };
        assert!(report.all_passed());
    }

    #[test]
    fn movement_test_fails_if_a_connection_stage_failed() {
        let report = MovementTestReport {
            connection: vec![stage("Device detected", StageOutcome::Pass), stage("READY", StageOutcome::Fail)],
            backend: None,
            movement: vec![],
        };
        assert!(!report.all_passed());
    }

    #[test]
    fn movement_test_fails_if_any_movement_step_failed() {
        let report = MovementTestReport {
            connection: vec![stage("Device detected", StageOutcome::Pass), stage("READY", StageOutcome::Pass)],
            backend: Some("modern"),
            movement: vec![movement_step("A", StageOutcome::Pass), movement_step("B", StageOutcome::Fail)],
        };
        assert!(!report.all_passed());
    }

    #[test]
    fn movement_test_fails_if_movement_never_ran() {
        // Connection succeeding alone isn't the point of this test - it
        // exists to prove *repeated* updates work.
        let report = MovementTestReport {
            connection: vec![stage("Device detected", StageOutcome::Pass), stage("READY", StageOutcome::Pass)],
            backend: None,
            movement: vec![],
        };
        assert!(!report.all_passed());
    }

    #[test]
    fn skip_rest_fills_every_remaining_named_stage() {
        let mut rec = Recorder::new();
        rec.fail(STAGE_NAMES[0], "boom");
        rec.skip_rest(&STAGE_NAMES[1..]);

        assert_eq!(rec.stages.len(), STAGE_NAMES.len());
        assert_eq!(rec.stages[0].outcome, StageOutcome::Fail);
        assert!(rec.stages[1..].iter().all(|s| s.outcome == StageOutcome::Skipped));
    }
}
