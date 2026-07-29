# Location providers: what's implemented, and why it needs what it needs

This app talks to "the current simulated location" through the `LocationProvider`
interface (`src/location/LocationProvider.ts`), never directly. That's what let the
whole map/joystick/travel-timer UI get built and tested against a mock before any
real device code existed, and lets the real provider slot in later without
touching the UI.

## Implemented

**`MockLocationProvider`** - entirely in-memory, no device required. Used
automatically outside the Tauri app (`pnpm dev` in a browser tab) for UI work.

**`TauriLocationProvider`** (frontend) + `set_location`/`clear_location`/
`get_location_status` (Rust, `src-tauri/src/location/real.rs`) - the real one,
backed by the [`idevice`](https://github.com/jkcoxson/idevice) crate (a
pure-Rust reimplementation of libimobiledevice's protocols). It tries two
backends, in order, per device:

1. **Modern (iOS 17+, `src-tauri/src/location/modern.rs`)** - the real path a
   physical iPadOS 18.7.8 device requires. Confirmed against actual device
   behavior: the classic service below responds to `StartService` with the
   device-reported error `InvalidService` on iOS 17+, because Apple moved
   developer services (including location simulation) behind a new tunneled
   transport starting with iOS 17. The working sequence, exactly mirroring
   the `idevice` crate's own reference CLI
   (`tools/src/location_simulation.rs`) rather than an improvised one:

   | Stage | What it does |
   |---|---|
   | `CoreDeviceTunnel` | Classic lockdown bootstraps `com.apple.internal.devicecompute.CoreDeviceProxy`, which hands back a `TunnelInfo` (client/server addresses, MTU, RSD port) for a raw IPv6-over-USB tunnel. |
   | `SoftwareTcpStack` | A software TCP/IP stack (`idevice`'s `jktcp`-backed adapter, `Adapter::to_async_handle()`) runs the tunnel without needing an OS-level TUN adapter - important since this app is an unprivileged desktop app, not a kernel-level tool. |
   | `RsdDiscovery` | Remote Service Discovery (`RsdHandshake`) connects to the tunnel's RSD port and returns the live map of service name -> port for this session. |
   | `DvtRemoteServer` | Connects to `com.apple.instruments.dtservicehub` (found via RSD) and opens the DVT/Instruments `RemoteServer` channel Xcode itself uses. |
   | `LocationSimulationChannel` | Opens the `com.apple.instruments.server.services.LocationSimulation` DVT sub-channel on that RemoteServer. |
   | `SetLocation` / `ClearLocation` | Sends the actual `set(lat, lon)` / `clear()` request on that channel. |

   Each stage is a distinct `LocationStage` enum value
   (`src-tauri/src/location/modern.rs`) - every failure the UI shows is
   labeled with exactly which of these six stages broke, never a generic
   "failed to set location".

2. **Legacy (pre-iOS 17, `LegacyLockdownService` stage)** - the classic
   `com.apple.dt.simulatelocation` lockdown service directly, for devices old
   enough to predate the tunnel requirement above. `set_location`/
   `clear_location` only fall back to this when the modern tunnel bootstrap
   itself isn't reachable (`CoreDeviceTunnel` fails) - once a device gets
   *past* that stage, any later failure is treated as a real error on the
   modern path, not a reason to guess at the legacy one instead.

A modern session is expensive to establish (five network round trips through
a freshly built tunnel), so `LocationManager` (`real.rs`) caches one per
device UDID and reuses it across every `set_location`/`clear_location` call -
including every tick of joystick/keyboard movement - rather than rebuilding
the tunnel on every call.

This is a supported *developer/testing* interface, not a private
reverse-engineered game protocol: it's Apple's own on-device mechanism for
simulating GPS location during development (the same one Xcode's "Simulate
Location" feature and `devicectl`/DVT-based tools use), and it changes only
what CoreLocation reports system-wide - it doesn't touch Pokémon GO, read its
memory, or intercept its network traffic. No IP/VPN manipulation, sensor
spoofing, or detection-bypass logic is involved anywhere in this path.

### Real prerequisites (this is not automatic)

Two things must be true on the device before either backend will succeed,
and the app cannot arrange either of them for you from Windows:

1. **Developer Mode enabled** (Settings → Privacy & Security → Developer
   Mode, iOS 16+). Checked via `query_developer_mode_status` on
   `com.apple.mobile.mobile_image_mounter` and surfaced as
   `IdeviceError::DeveloperModeNotEnabled` if off.
2. **A Developer Disk Image mounted.** Checked via
   `ImageMounter::copy_devices` (any image reported as mounted is sufficient
   - both the classic and personalized flows satisfy this). If a device has
   never had a Developer Disk Image mounted by any means (Xcode, or this
   app's classic-image mount command), both the modern and legacy location
   paths fail at this prerequisite.

The Device tab's "Location Sim." field and `get_device_info` reflect both of
these directly; the background watcher's lightweight poll does not re-check
them every tick (see "READY status stability" below), but a real
set/clear-location failure that indicates one of these regressed
(`DeveloperModeNotEnabled` / `ImageNotMounted` / `ServiceNotFound`)
immediately downgrades the cached status via `device::downgrade_readiness`
rather than leaving a stale `Ready`.

### READY status stability

The background watcher polls every few seconds using a lightweight scan
(`scan_devices`) that only checks USB/pairing state, not Developer
Mode/Developer Disk Image - that heavier check only runs on an explicit
`get_device_info` call. Early on, this caused `Ready` to flicker back to
`Connected` ("Not Checked") on literally the next poll tick, because the
lightweight scan's result fully replaced the cache including fields it never
actually re-checked.

Fixed via `carry_forward_readiness` (`device/real.rs`): a lightweight scan
result for a device the cache already knows to be `Ready` keeps that state
(and the last-known Developer Mode/Developer Disk Image booleans) instead of
resetting them to "unknown". This is deliberately narrow - it only carries
`Ready` forward for a device still at least `Connected`; a device that drops
to `PairingRequired` or disappears entirely still loses it immediately, and
only three things can legitimately end a carried-forward `Ready`: the device
disconnecting, an explicit `get_device_info` refresh actually finding a
problem, or a real location-simulation call failing with a prerequisite
error as described above.

### What this means day to day

- On a real iPadOS 18.7.8 device (this project's reference hardware) with
  Developer Mode on and a Developer Disk Image mounted, `set_location`/
  `clear_location` should succeed via the modern path end to end - confirmed
  on that hardware for a single teleport, with Apple Maps visibly showing
  the injected location. Continuous updates (held-key/joystick movement)
  repeat that same call on a timer (see [Movement
  architecture](#movement-architecture)); whether an individual app like
  Pokémon GO accepts the result is a separate question from whether the
  device does - see [Location delivery
  diagnostics](#location-delivery-diagnostics).
- On iOS 16 and earlier, mounting the classic Developer Disk Image (once
  someone points the app at the two image files - not yet exposed in the UI,
  only the Rust command exists) is enough, and the legacy path handles it.
- **Verifying this against real hardware from this development environment
  is not possible** - there is no USB passthrough here, only source code,
  compilation, clippy, and unit tests. What *has* been verified in this
  sandbox: the full modern/legacy code compiles and passes `cargo clippy
  --all-targets -- -D warnings` with zero warnings, every pure-logic unit
  test passes (`cargo test`), and the "no Apple services installed" failure
  path is confirmed end-to-end exactly as before. The actual USB protocol
  exchange - CoreDeviceProxy tunnel bootstrap, RSD discovery, the DVT
  LocationSimulation channel, and whether `InvalidService` is actually
  resolved - needs to be confirmed on the real device. See
  [Hardware diagnostic](#hardware-diagnostic) below for how to do that
  without needing to click through the GUI at all.

## Movement architecture

Teleport ("Set Test Location"), the on-screen joystick, and W/A/S/D all
drive the *same* engine and the *same* `set_location` backend - there is no
separate "fake" movement path:

- **`useMovementInput`** (`src/movement/useMovementInput.ts`) owns every
  "is a movement input currently held" source - keyboard keys and the
  joystick pointer - in one place. Its window-level keydown/keyup/blur/
  visibilitychange listeners are attached exactly once (via a stable `[enabled]`
  effect dependency) and read the current `start`/`stop` callbacks through
  refs rather than closing over them directly.

  This matters: `MovementPanel` re-renders on every successful movement tick
  (it reads the live position/heading from the store), which recreates
  `start`/`stop` as new function identities every time. An earlier version
  of this hook depended on those identities directly, so React tore the
  listeners down and rebuilt them - running the old cleanup, which
  unconditionally called `stop()` and reset all held-key state - on every
  single tick. That is why continuous movement used to die after about one
  tick for both keyboard and joystick input, and why W/A/S/D never reliably
  showed as held: the act of moving successfully once immediately stopped
  itself. Reading `start`/`stop` through refs fixed both symptoms with one
  change, since they shared the same root cause.
- **`MovementEngine`** (`src/movement/MovementEngine.ts`) self-paces ticks
  (never overlapping - it waits for one `set_location` round trip to settle
  before scheduling the next) and computes each tick's distance from the
  *real* elapsed time since the previous tick (`Date.now()` deltas), not an
  assumed fixed interval - a slow USB round trip no longer distorts the
  effective speed. It refuses to compute a tick at all (calling
  `onSafetyStop` instead of `onTick`) when the current position, configured
  speed, elapsed time, or computed destination doesn't check out, rather
  than sending a real device a guess.
- **STOP** (`useMovementInput`'s `stopAll`) clears held keyboard keys, the
  held pointer direction, and the engine's pending tick together - a key or
  the joystick button still being physically held at the moment STOP is
  clicked can never resume movement afterward. It stops the engine only; it
  never teleports elsewhere and never clears the simulated location.

## Location delivery diagnostics

The iPad's system location (and Apple Maps) can accept a simulated location
successfully while an *individual app* on the device still fails to get a
location fix from it - those are different questions, and this app answers
them separately rather than inferring one from the other.

**`get_location_diagnostics`** (Rust, `location/real.rs`) tracks, per
device, what the location-simulation *protocol* actually reported for the
last request: the requested coordinate, which backend handled it (modern vs.
legacy), a timestamp, whether the request succeeded, and whether a modern
session is still cached (alive) for that device. This is distinct from
`get_location_status` (\"what we last told the device to show\") - it is
"what actually happened at the protocol level", surfaced in a collapsible
developer panel on the Device tab. It only shows whether **the iPad**
accepted the request; it says nothing about whether any specific app is
using the result, and the UI copy is written to keep that distinction
explicit rather than imply Pokémon GO compatibility from an Apple Maps
success.

### Investigating "Failed to detect location" in an individual app

`idevice`'s own `LocationSimulationClient` documentation states plainly:
*"a connection must be maintained to keep location simulated"* - the DVT
channel is not a one-shot fire-and-forget request, it is a live session that
has to stay open for the simulated location to keep being reported. Mapped
onto the app's own investigation categories:

- **(A) persistent after the initial set request?** Only as long as the
  session (the `RemoteServerClient`/tunnel) stays alive - not indefinitely
  on its own.
- **(B) one-shot?** No - per the crate's own documentation, one `set()` call
  does not guarantee a location stays simulated once the connection that
  sent it closes.
- **(C) dependent on a persistent developer-service session staying alive?**
  **Yes** - this is the crate's own stated model, and it's why
  `LocationManager` (`real.rs`) caches a `ModernLocationSession` per device
  UDID and reuses it across every `set_location`/`clear_location` call
  (including every movement tick) instead of reconnecting each time; a
  prerequisite-related failure drops the cached session so the next attempt
  starts clean rather than repeatedly hitting a broken one.
- **(D) cleared/replaced unexpectedly after the call returns?** Not by this
  app's own code once (C) is implemented correctly - but it is exactly what
  a genuine session drop (device sleep, a transient USB hiccup, an error on
  a later call that tears the cached session down) would look like from an
  app on the device that expects a continuously live fix.

**A concrete, previously-real contributor to this symptom**: until the
`useMovementInput` fix described above, held-key/joystick movement only
produced a single tick before silently stopping - meaning the simulated
location was set *once* and then never refreshed again, even while the UI
still showed "Moving". A real GPS fix's timestamp updates continuously, even
while stationary; a location that was set once and never touched again is
exactly the kind of stale, non-updating fix an app's own location-freshness
check could plausibly reject even while Apple Maps (which may not enforce
the same freshness check, or may cache the last displayed point) continues
to show it correctly. With continuous movement now actually continuous, the
device receives a steady stream of fresh updates while held-key movement is
active; whether that alone resolves an individual app's "failed to detect
location" report is exactly the kind of thing the diagnostics above and the
hardware movement test below are for confirming on real hardware, not
something to claim resolved from this environment. No stationary
"keep-alive while idle" refresh has been added speculatively - that would
be indistinguishable in intent from working around an individual app's own
checks, which is explicitly out of scope; see [Scope and
limits](../README.md#scope-and-limits).

## Hardware diagnostic

`src-tauri/src/diagnostics.rs` runs the exact same device/location code the
app itself uses against a real attached device and reports a real PASS/FAIL
for each step - never a faked result. `src/bin/diagnose.rs` is its CLI entry
point, with two modes:

```powershell
cd src-tauri
cargo run --bin diagnose                              # 8-stage connectivity check
cargo run --bin diagnose -- <UDID>                    # ...against a specific device
cargo run --bin diagnose -- --movement-test           # Apple Maps hardware test
cargo run --bin diagnose -- --movement-test <UDID>
```

**Default mode** (`diagnostics::run`) checks, in order (stopping and marking
the rest `SKIP` the moment one fails, since each stage depends on the one
before it):

1. Apple USB service (usbmuxd) reachable
2. Device detected
3. Pairing / trust
4. Developer Mode + Developer Disk Image
5. Modern iOS 17+/18 developer connection (CoreDeviceProxy tunnel)
6. RSD discovery + DVT LocationSimulation service
7. Set one nearby coordinate (Windsor, ON - the same default the map starts
   at; harmless, obviously a test point)
8. Clear location

**`--movement-test`** (`diagnostics::run_movement_test`) - the "Apple Maps
hardware test" - proves *repeated* updates work, which the default mode
alone can't: after confirming the device is detected and READY, it sets
five sequential coordinates stepping north by about 100m each (a plausible
walking-speed step, not a teleport), waiting for each to succeed before
sending the next, then clears. Every write prints PASS/FAIL, the requested
coordinate, the elapsed time for that specific request, and the backend
used - so a real, continuous stream of location updates can be proven
against hardware independently of the GUI, exactly what held-key/joystick
movement does over USB in practice.

Exit code is `0` only if every stage/step passed, so either mode can be
scripted/CI-gated without parsing its text output.

## What this means for the UI

- `DeviceProvider` and `LocationProvider` are still plain interfaces with two
  implementations each (mock, real), chosen once at startup
  (`src/device/createDeviceProvider.ts`, `src/location/createLocationProvider.ts`)
  based on whether the app is running inside Tauri. The modern/legacy split
  above lives entirely behind `set_location`/`clear_location` in the real
  provider - neither the interface nor the UI needed to change for it.
- The Device and Settings pages always say which provider is active by name
  ("Mock Device Provider" vs. "USB Device (idevice)") - nothing pretends a
  simulated device is real, or vice versa.
- Every failure path - no Apple Mobile Device Support installed, device not
  trusted, Developer Mode off, Developer Disk Image not mounted, device
  locked, or a failure at any specific modern-path stage - surfaces the real
  error, which stage it happened at, and a concrete next step where one
  exists. The frontend never marks a teleport/movement step as succeeded
  based on anything other than the device's own confirmed response; a failed
  step stops movement rather than continuing to advance the map locally.
