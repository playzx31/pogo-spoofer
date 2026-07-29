//! Standalone hardware diagnostic CLI for the real iOS 17+/18 location path.
//!
//! Runs `pogo_control_hub_lib::diagnostics::run` - the exact device/location
//! code the app itself uses - against a real attached iPhone/iPad, one stage
//! at a time, and prints a real PASS/FAIL/SKIP for each. Never fakes a
//! result: every PASS reflects a real, successful device round trip.
//!
//! Usage:
//!   cargo run --bin diagnose --manifest-path src-tauri/Cargo.toml
//!   cargo run --bin diagnose --manifest-path src-tauri/Cargo.toml -- <UDID>
//!
//! Exit code is 0 only if every stage passed; nonzero otherwise, so this can
//! be wired into a script/CI check without parsing its text output.

use pogo_control_hub_lib::diagnostics::{run, StageOutcome};

#[tokio::main]
async fn main() {
    let udid = std::env::args().nth(1);

    println!("PoGo Control Hub - hardware location diagnostic");
    if let Some(u) = &udid {
        println!("Target device: {u}");
    } else {
        println!("Target device: (first device usbmuxd reports)");
    }
    println!();

    let report = run(udid.as_deref()).await;

    for (i, stage) in report.stages.iter().enumerate() {
        let label = match stage.outcome {
            StageOutcome::Pass => "PASS",
            StageOutcome::Fail => "FAIL",
            StageOutcome::Skipped => "SKIP",
        };
        println!("[{label}] {}. {} - {}", i + 1, stage.name, stage.detail);
    }

    println!();
    if report.all_passed() {
        println!("All stages passed.");
        std::process::exit(0);
    } else {
        println!("One or more stages failed - see FAIL/SKIP lines above.");
        std::process::exit(1);
    }
}
