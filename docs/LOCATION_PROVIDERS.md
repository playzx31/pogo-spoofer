# Location providers: what's implemented, and why it needs what it needs

This app talks to "the current simulated location" through the `LocationProvider`
interface (`src/location/LocationProvider.ts`), never directly. That's what let the
whole map/joystick/travel-timer UI get built and tested against a mock before any
real device code existed, and lets the real provider slot in later without
touching the UI.

## Implemented

**`MockLocationProvider`** - entirely in-memory, no device required. Used
automatically outside the Tauri app (`pnpm dev` in a browser tab) for UI work.

**`TauriLocationProvider`** (frontend) + `set_location`/`clear_location` (Rust,
`src-tauri/src/location/real.rs`) - the real one. It uses the
[`idevice`](https://github.com/jkcoxson/idevice) crate, a pure-Rust
reimplementation of libimobiledevice's protocols, to talk to the
`com.apple.dt.simulatelocation` service over USB - the same lockdown service
Xcode's own "Simulate Location" feature uses. Concretely:

- `usbmuxd` (`idevice::usbmuxd`) finds the device over USB and gets a pairing
  record.
- `lockdown` (`idevice::lockdown`) opens an authenticated session and asks the
  device to start the `com.apple.dt.simulatelocation` service on a port.
- `simulate_location` (`idevice::simulate_location::LocationSimulationService`)
  sends the actual `set(lat, lon)` / `clear()` request on that port.

This is a supported *developer/testing* interface, not a private
reverse-engineered game protocol: it's Apple's own on-device service for
simulating GPS location during development, and it changes only what
CoreLocation reports system-wide - it doesn't touch Pokémon GO, read its
memory, or intercept its network traffic.

### Real prerequisites (this is not automatic)

Two things must be true on the device before `set_location` will succeed, and
the app cannot arrange either of them for you from Windows:

1. **Developer Mode enabled** (Settings → Privacy & Security → Developer Mode,
   iOS 16+). Checked via `query_developer_mode_status` on
   `com.apple.mobile.mobile_image_mounter` and surfaced as
   `IdeviceError::DeveloperModeNotEnabled` if off.
2. **A Developer Disk Image mounted.** `com.apple.dt.simulatelocation` (like
   most `com.apple.dt.*` services) only becomes available once a Developer
   Disk Image is mounted on the device. `ImageMounter::mount_developer` (Rust
   side, `idevice::mobile_image_mounter`) can mount a classic (pre-iOS 17)
   image if you supply `DeveloperDiskImage.dmg` + its `.signature` file - the
   files Xcode itself uses, found under Xcode's
   `Platforms/iPhoneOS.platform/DeviceSupport/<version>/` on a Mac, or from any
   mirror of Apple's own images.

   **iOS 17+ uses a "Personalized" Developer Disk Image instead** - a
   cryptographically signed, per-device cryptex bundle that normally requires
   Xcode talking to Apple's TSS signing servers to produce. `idevice` has the
   low-level pieces for this (`mount_personalized`, `get_manifest_from_tss`),
   but wiring up the full flow (nonce exchange, personalization manifest,
   locating a valid image/trustcache/build-manifest triple for the device's
   exact build) is **not implemented in this pass** - it needs either a Mac
   with Xcode to do the one-time mount, or hardware to validate against, which
   this sandbox has neither of. Shipping that flow half-verified would risk
   exactly the "claims success it can't back up" failure mode this project is
   explicit about avoiding. It's tracked as follow-up work.

### What this means day to day

- On iOS 17+, until the personalized-DDI flow above is built, `set_location`
  will most likely fail with "Developer Disk Image is not mounted" even with
  Developer Mode on, unless the device has had a Developer Disk Image mounted
  by some other means (e.g. it was connected to Xcode once).
- On iOS 16 and earlier, mounting the classic Developer Disk Image (once
  someone points the app at the two image files - not yet exposed in the UI,
  only the Rust command exists) is enough, and location simulation should work
  end to end.
- None of this has been exercised against real hardware from this environment
  (no iPad, no USB passthrough here) - the Rust and TypeScript code compiles,
  type-checks, and its pure logic (coordinate math/validation) is unit-tested,
  and the "no device / no Apple services installed" path has been verified
  end-to-end (see below), but the actual USB protocol exchange with a live
  device needs verification on a real Windows machine with a real iPad.

## What this means for the UI

- `DeviceProvider` and `LocationProvider` are still plain interfaces with two
  implementations each (mock, real), chosen once at startup
  (`src/device/createDeviceProvider.ts`, `src/location/createLocationProvider.ts`)
  based on whether the app is running inside Tauri. Swapping in the eventual
  personalized-DDI flow means changing Rust internals behind `set_location`,
  not the interface or the UI.
- The Device and Settings pages always say which provider is active by name
  ("Mock Device Provider" vs. "USB Device (idevice)") - nothing pretends a
  simulated device is real, or vice versa.
- Every failure path - no Apple Mobile Device Support installed, device not
  trusted, Developer Mode off, Developer Disk Image not mounted, device locked
  - surfaces the real error and a concrete next step, never a generic "failed"
  or a silently-ignored no-op. This was verified directly: in this sandbox
  (no Apple services installed at all, matching how a fresh Windows machine
  looks before installing anything), clicking Connect produces exactly
  "Could not reach the Apple USB device service" with the install instructions
  in the UI, and the app keeps running normally.
