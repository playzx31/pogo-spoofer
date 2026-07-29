//! Standalone hardware diagnostic CLI for the real iOS 17+/18 location path.
//!
//! Runs `pogo_control_hub_lib::diagnostics` - the exact device/location code
//! the app itself uses - against a real attached iPhone/iPad, one stage at a
//! time, and prints a real PASS/FAIL/SKIP for each. Never fakes a result:
//! every PASS reflects a real, successful device round trip.
//!
//! Usage:
//!   cargo run --bin diagnose --manifest-path src-tauri/Cargo.toml
//!   cargo run --bin diagnose --manifest-path src-tauri/Cargo.toml -- <UDID>
//!   cargo run --bin diagnose --manifest-path src-tauri/Cargo.toml -- --movement-test [UDID]
//!
//! The default mode runs the 8-stage connectivity check (`diagnostics::run`).
//! `--movement-test` instead runs the "Apple Maps hardware test"
//! (`diagnostics::run_movement_test`): a repeated sequence of real
//! set-location calls stepping north, proving continuous updates reach the
//! device independently of the GUI - not just a single one-shot write.
//!
//! Exit code is 0 only if every stage/step passed; nonzero otherwise, so
//! this can be wired into a script/CI check without parsing its text output.

use pogo_control_hub_lib::diagnostics::{run, run_movement_test, StageOutcome};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let movement_test = args.iter().any(|a| a == "--movement-test");
    let udid = args.into_iter().find(|a| a != "--movement-test");

    println!("PoGo Control Hub - hardware location diagnostic");
    if let Some(u) = &udid {
        println!("Target device: {u}");
    } else {
        println!("Target device: (first device usbmuxd reports)");
    }
    println!();

    let all_passed = if movement_test {
        println!("Mode: Apple Maps hardware test (repeated real-device location updates)\n");
        let report = run_movement_test(udid.as_deref()).await;

        for (i, stage) in report.connection.iter().enumerate() {
            print_stage(i + 1, stage.name, &stage.outcome, &stage.detail);
        }
        if let Some(backend) = report.backend {
            println!("Backend: {backend}");
        }
        for step in &report.movement {
            println!(
                "[{}] {} - ({:.6}, {:.6}) in {}ms - {}",
                outcome_label(&step.outcome),
                step.label,
                step.latitude,
                step.longitude,
                step.elapsed_ms,
                step.detail
            );
        }
        println!();
        report.all_passed()
    } else {
        let report = run(udid.as_deref()).await;
        for (i, stage) in report.stages.iter().enumerate() {
            print_stage(i + 1, stage.name, &stage.outcome, &stage.detail);
        }
        println!();
        report.all_passed()
    };

    if all_passed {
        println!("All stages passed.");
        std::process::exit(0);
    } else {
        println!("One or more stages failed - see FAIL/SKIP lines above.");
        std::process::exit(1);
    }
}

fn outcome_label(outcome: &StageOutcome) -> &'static str {
    match outcome {
        StageOutcome::Pass => "PASS",
        StageOutcome::Fail => "FAIL",
        StageOutcome::Skipped => "SKIP",
    }
}

fn print_stage(index: usize, name: &str, outcome: &StageOutcome, detail: &str) {
    println!("[{}] {}. {} - {}", outcome_label(outcome), index, name, detail);
}
