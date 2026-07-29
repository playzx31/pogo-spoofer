# PoGo Control Hub

A Windows desktop control hub for a USB-connected iPad/iPhone: an interactive
map, a teleport-style test-location control, and an 8-direction joystick for
walking/running/cycling movement, all driving a real device's simulated GPS
location over USB via Apple's own developer/testing interfaces. No Pokémon GO
code injection, memory reading, packet manipulation, or anti-cheat/jailbreak
bypassing - see [Scope and limits](#scope-and-limits) below.

Built with Tauri + React + TypeScript on the frontend, Rust on the backend,
SQLite for local history/logging.

## Contents

- [Setup](#setup)
- [Windows requirements](#windows-requirements)
- [Apple driver requirements](#apple-driver-requirements)
- [How to connect your iPad](#how-to-connect-your-ipad)
- [Trust / pairing](#trust--pairing)
- [Developer requirements (Developer Mode + Developer Disk Image)](#developer-requirements-developer-mode--developer-disk-image)
- [How to run](#how-to-run)
- [Movement architecture](#movement-architecture)
- [Hardware diagnostic](#hardware-diagnostic)
- [How to build a Windows .exe](#how-to-build-a-windows-exe)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [Scope and limits](#scope-and-limits)

## Setup

Clone the repo, then see [How to run](#how-to-run). You'll need the
[Windows requirements](#windows-requirements) installed first, and the
[Apple driver requirements](#apple-driver-requirements) for real device
detection to work - the app runs and is fully usable without a device
attached (Mock providers cover the whole UI), but USB detection needs Apple's
own driver stack present.

## Windows requirements

Install these once, in order:

1. **Node.js** (LTS) - <https://nodejs.org>
2. **pnpm** - `npm install -g pnpm`
3. **Rust** - <https://rustup.rs> (run `rustup-init.exe`, accept defaults)
4. **Microsoft C++ Build Tools** - install the "Desktop development with C++"
   workload from the
   [Visual Studio Build Tools installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   (Tauri needs a native linker/toolchain to compile the Rust backend)
5. **WebView2 Runtime** - already present on any up-to-date Windows 10/11;
   if missing, get it from
   [Microsoft's WebView2 page](https://developer.microsoft.com/microsoft-edge/webview2/)

## Apple driver requirements

Real USB device detection and location simulation need **Apple Mobile Device
Support** - the Windows service that exposes the classic `usbmux` protocol on
`127.0.0.1:27015`, which this app connects to directly (no extra bridge
software needed, on either Windows or Linux/macOS).

Get it any of these ways:

- Install **iTunes for Windows** from
  [apple.com](https://www.apple.com/itunes/) (bundles Apple Mobile Device
  Support) - **use the installer from Apple's site, not the Microsoft Store
  version**, which has historically lagged behind on some USB communication
  features.
- Or install **Apple Devices** from the Microsoft Store, which also installs
  the same service.

After installing, confirm it's running: open `services.msc` and check that
**Apple Mobile Device Service** shows as "Running". If the app reports
"Could not reach the Apple USB device service", this is almost always why -
see [Troubleshooting](#troubleshooting).

## How to connect your iPad

1. Install the Apple driver requirements above.
2. Plug the iPad/iPhone into the PC with a USB or USB-C cable.
3. Unlock the device.
4. Open the app - the **Device** tab (and the header badge) will pick it up
   automatically within a few seconds; you don't need to click anything for
   detection itself.
5. If this is the first time this PC has connected to the device, see
   [Trust / pairing](#trust--pairing) next.

The header badge and Device tab show **"No Device"** whenever nothing
supported is attached - the app never fabricates a fake connected state.

## Trust / pairing

The first time a PC talks to an iPad/iPhone, iOS requires you to explicitly
trust it:

1. On the Device tab, click **Connect**.
2. Unlock the iPad/iPhone if it's locked.
3. A **"Trust This Computer?"** prompt appears on the device - tap **Trust**
   and enter the passcode if asked.
4. The app polls for up to 60 seconds for that response. Once trusted, the
   pairing is saved (by Apple's own usbmuxd, the same store iTunes uses) so
   you won't need to repeat this for that device.

If you tap **Don't Trust**, or the device stays locked, or you don't respond
within 60 seconds, the app reports the real reason (declined / locked /
timed out) rather than a generic failure.

## Developer requirements (Developer Mode + Developer Disk Image)

Location simulation uses the same on-device developer mechanism Xcode's
"Simulate Location" feature uses. On iOS 17+ (including this project's
reference device, an iPad8,9 on iPadOS 18.7.8) that means a CoreDeviceProxy
tunnel -> RSD -> DVT `LocationSimulation` channel, not the classic
`com.apple.dt.simulatelocation` lockdown service directly (which now returns
`InvalidService`) - see
[`docs/LOCATION_PROVIDERS.md`](docs/LOCATION_PROVIDERS.md) for the full
stage-by-stage breakdown. Older devices use the classic service directly.
Either way, it requires:

1. **Developer Mode** enabled on the device: Settings → Privacy & Security →
   Developer Mode → On (device restarts and asks you to confirm). Available
   on iOS 16+.
2. **A Developer Disk Image mounted.** The Device tab's "Location Sim." field
   tells you the current state (Ready / Developer Mode required / Developer
   Disk Image not mounted). See
   [`docs/LOCATION_PROVIDERS.md`](docs/LOCATION_PROVIDERS.md) for exactly what
   this means, why iOS 17+ makes it harder (a per-device "personalized" image
   that isn't yet auto-mounted by this app), and what your options are today.

This is a real, documented technical limitation, not a bug the app is hiding
- the Device tab and Settings page both say so plainly rather than pretending
location simulation "just works" everywhere.

## How to run

```powershell
git clone https://github.com/playzx31/pogo-spoofer.git
cd pogo-spoofer
git checkout claude/windows-ipad-control-hub-crozi5
pnpm install
pnpm tauri dev
```

The first run compiles the Rust backend from scratch (a few minutes); later
runs are fast. A window titled **"PoGo Control Hub"** opens. No device is
required to explore the map, joystick, and settings - those run entirely on
the mock providers when nothing is confirmed connected... except once running
inside the built app, the real USB provider is always what's active; it just
reports "No Device" honestly until one is attached and trusted.

Run the automated tests any time with:

```powershell
pnpm test          # TypeScript: coordinate math, headings, movement engine pacing,
                   # movement safety guards, WASD/joystick held-key visual state
cd src-tauri
cargo test         # Rust: coordinate validation, distance calculations, READY-status
                   # carry-forward, diagnostic report logic
cargo clippy --all-targets -- -D warnings
```

## Movement architecture

Teleport, the on-screen joystick, and W/A/S/D all drive the same
`MovementEngine` and the same `set_location` backend - never separate/fake
movement paths. Ticks are self-paced (never overlapping a real device round
trip) and compute each step's distance from real elapsed time rather than
assuming a fixed interval, so a slow USB round trip never distorts the
configured speed. Held-key and joystick-pointer state live in one hook
(`useMovementInput`) so STOP can clear both together, and so a key or button
still physically held at the moment STOP is clicked can never resume
movement afterward. See [`docs/LOCATION_PROVIDERS.md`](docs/LOCATION_PROVIDERS.md#movement-architecture)
for the full breakdown, including a past bug (unstable callback identities
tearing down the input listeners on every successful tick) that used to make
continuous movement die after about one step - fixed, with a regression test
locking in the fix.

## Hardware diagnostic

Verifying the real iOS 17+/18 location path (CoreDeviceProxy tunnel -> RSD ->
DVT -> LocationSimulation) needs a physical device - unit tests alone can't
prove a live USB protocol exchange works. `cargo run --bin diagnose` runs the
exact same device/location code the app uses against whatever's attached and
prints a real PASS/FAIL for each step - no GUI required:

```powershell
cd src-tauri
cargo run --bin diagnose                              # 8-stage connectivity check
cargo run --bin diagnose -- <UDID>                    # a specific device, if more than one
cargo run --bin diagnose -- --movement-test           # Apple Maps hardware test: repeated updates
cargo run --bin diagnose -- --movement-test <UDID>
```

The default mode checks Apple USB service reachability, device detection,
pairing/trust, Developer Mode + Developer Disk Image, the modern tunnel,
RSD/DVT service discovery, setting one nearby test coordinate, and clearing
it - stopping and marking the remaining stages `SKIP` the moment one fails.
`--movement-test` proves *repeated* updates work (what continuous movement
actually needs): five sequential coordinates stepping north, each waited on
before the next is sent, then a clear - printing PASS/FAIL, the coordinate,
and elapsed time for every write. Exit code is `0` only if every
stage/step passed. See
[`docs/LOCATION_PROVIDERS.md`](docs/LOCATION_PROVIDERS.md#hardware-diagnostic)
for what each stage/step actually does.

## How to build a Windows .exe

```powershell
pnpm tauri build
```

This produces an installer (`.msi` and/or `.exe`, via WiX/NSIS depending on
your Tauri config) under `src-tauri/target/release/bundle/`. Run that
installer once and the app appears as a normal Start Menu entry - no more
opening a terminal to launch it.

> This must be run **on Windows** to produce a Windows build. Cross-compiling
> Tauri apps for Windows from Linux/macOS is possible with extra toolchains
> (`cargo-xwin`, NSIS/WiX) but isn't set up in this repo, and building
> natively on the target OS is both simpler and what Tauri's own docs
> recommend.

## Troubleshooting

**"Could not reach the Apple USB device service"**
Apple Mobile Device Support isn't installed or its service isn't running.
Install iTunes for Windows (see [Apple driver requirements](#apple-driver-requirements)),
then check `services.msc` for "Apple Mobile Device Service" = Running.

**"This computer is not trusted by the device yet." / stuck on "Pairing Required"**
Unlock the device and look for the "Trust This Computer?" prompt, then click
Connect again. If the prompt never appears, unplug and replug the cable.

**"The device is locked."**
Unlock the device with its passcode; some operations (including the initial
trust handshake) refuse to proceed on a locked screen.

**"Developer Mode is not enabled on this device."**
Settings → Privacy & Security → Developer Mode → On, then let the device
restart and confirm.

**"The Developer Disk Image is not mounted on this device."**
See [Developer requirements](#developer-requirements-developer-mode--developer-disk-image)
and [`docs/LOCATION_PROVIDERS.md`](docs/LOCATION_PROVIDERS.md) - this is a
real Apple-imposed prerequisite, not an app bug.

**The map is blank / shows no tiles**
The map uses free OpenStreetMap raster tiles and needs normal internet
access to `tile.openstreetmap.org`. If you're behind a restrictive proxy or
firewall, tiles won't load; everything else in the app still works.

**Movement stops unexpectedly**
The joystick/keyboard movement engine calls the real device on every step and
stops immediately if a call fails, rather than continuing to move the map
locally while the device silently rejects the updates - check the Logs tab
for the specific error (usually one of the above).

**Apple Maps shows the injected location, but an individual app doesn't**
This app can only confirm and control what the iPad's location-simulation
service reports at the OS level - a specific app (including, but not
limited to, Pokémon GO) accepting or rejecting that simulated location is a
separate question this app doesn't control, and this README makes no claim
either way about compatibility with any specific app. The Device tab's
"Location Delivery Diagnostics" (developer) panel shows exactly what the
protocol reported for the last request - backend used, whether the session
is still active, success/failure - which is the place to look when Apple
Maps and another app disagree. See [`docs/LOCATION_PROVIDERS.md`](docs/LOCATION_PROVIDERS.md#location-delivery-diagnostics)
for the full investigation into what can cause this and why.

**Build fails with a linker error on Windows**
The C++ Build Tools workload (see [Windows requirements](#windows-requirements))
is almost always the missing piece - Rust needs `link.exe` from it to produce
a Windows binary.

## Project structure

```
src/                        React + TypeScript frontend
  device/                    DeviceProvider interface, Mock + real (Tauri) implementations
  location/                  LocationProvider interface, Mock + real (Tauri) implementations
  movement/                  Joystick, keyboard input, MovementEngine (geo calculations)
  map/                       MapLibre map, search, click-to-select
  pokemon/                   Pokédex/IV/shiny panel (placeholder - later phase)
  cooldown/                  Advisory travel timer
  components/                Shared layout/UI
  pages/                     One file per bottom-tab page
  state/                     Zustand stores
  lib/                       Geo math, error helpers, Tauri glue

src-tauri/src/               Rust backend
  device/                    Real USB device detection/pairing (idevice crate)
  location/                  Real location simulation (modern iOS17+ tunnel/RSD/DVT
                               + legacy fallback) + coordinate validation
  database/                  SQLite schema + connection
  commands/                  Tauri commands for DB-backed history/logging
  diagnostics.rs             Staged hardware diagnostic (device + location, PASS/FAIL)
  bin/diagnose.rs            CLI entry point for the diagnostic above

docs/LOCATION_PROVIDERS.md    Deep dive on the real location provider and its
                               real prerequisites/limitations
```

## Scope and limits

This application intentionally does **not**:

- Modify Pokémon GO or inject code into it
- Read or write Pokémon GO's process memory
- Reverse-engineer or intercept Pokémon GO's private network protocols
- Bypass jailbreak detection, device integrity checks, or anti-cheat systems
- Attempt to make location simulation "undetectable"
- Automate any gameplay (catches, spins, battles, raids)

It only asks iOS's own developer/testing location-simulation service to
report a different location - the same capability Xcode exposes to any
developer, gated by the same Apple-imposed prerequisites (Developer Mode, a
mounted Developer Disk Image, device trust). What any given app does with
that simulated location, and whether that's consistent with that app's terms
of service, is outside this tool's control and responsibility.
