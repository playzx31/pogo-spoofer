# Location providers: what's implemented, and what supported interfaces exist

This app talks to "the current simulated location" through the `LocationProvider`
interface (`src/location/LocationProvider.ts`), never directly. That's what lets us
ship a fully working app today on `MockLocationProvider`, and swap in a real
device-testing provider later without touching the UI, map, or movement engine.

## Implemented today

**`MockLocationProvider`** - entirely in-memory, no device or network required.
This is what every other feature (map, joystick, travel timer, history logging) is
built and tested against.

## Researched: supported Apple developer/testing location interfaces

The goal was to find a way to set a real iPad/iPhone's reported location that is
(a) Apple-sanctioned or at least built on public, documented APIs, (b) not a
jailbreak or private-API hook, and (c) doesn't require reverse-engineering or
touching Pokémon GO itself. Three options exist, and none of them is a drop-in
"control any installed app's GPS from a Windows app over USB" button:

1. **Xcode's built-in location simulation** (Debug ▸ Simulate Location, or a `.gpx`
   route). This only affects an app that Xcode itself launched in a debug session
   on a device Xcode is attached to. It cannot be pointed at an already-installed
   App Store app like Pokémon GO, and it requires a Mac running Xcode - not
   applicable to a Windows-hosted controller at all.

2. **Jailbreak location-spoofing tweaks** (e.g. the classic "LocationFaker"-style
   tools). Explicitly out of scope: this project must not bypass device integrity
   or jailbreak-detection systems, per the project constraints.

3. **WebDriverAgent / XCTest-based simulated location.** This is the one real
   candidate. `WebDriverAgent` (the open-source project Appium's XCUITest driver
   uses) is a normal, development-signed app you install on the device once via
   Xcode. It exposes an HTTP API (the same one UI-testing tools use) that can set
   a simulated GPS location for the whole device while a WDA test session is
   running. Because it's plain HTTP, a Windows app can talk to it over USB by
   forwarding WDA's port through `usbmuxd`/`iproxy` - no Mac needed at *runtime*,
   only for the one-time WDA install/signing step.

   Important caveats that keep this out of "just works, ship it":
   - It requires a one-time Mac + free Apple ID (for a 7-day dev signature) or a
     paid Apple Developer account (for a 1-year signature) to build and install
     WebDriverAgent on the target device. That's a real setup cost for the user,
     not something this app can do for them from Windows.
   - The simulated location it sets is **system-wide CoreLocation output** for as
     long as the WDA session is active - it doesn't know or care which app reads
     it. That means it would affect Pokémon GO the same way it affects any app,
     which is exactly the capability this project is allowed to expose (a
     supported, non-jailbreak GPS override) - but it does **not** do anything to
     help evade Niantic's own client-side or server-side spoofing detection, and
     this app will not add anything that tries to. That risk (and Pokémon GO's
     Terms of Service) is on the user, same as it would be with any GPS-spoofing
     method, and the UI must say so plainly if/when this provider ships.

**Conclusion:** a WDA-backed `LocationProvider` is technically buildable in a later
phase (it's priority #7 on the project's own list, after USB device detection) and
is the plan for "the legitimate supported device-testing provider" called for in
the project brief. It is not implemented yet. Nothing in the app currently claims
otherwise - the Device and Settings pages label the active provider as "Mock" and
say so.

## What this means for the UI today

- `DeviceProvider` and `LocationProvider` are both plain interfaces with exactly
  one implementation each (`MockDeviceProvider`, `MockLocationProvider`), wired up
  behind a single factory point (`src/state/deviceStore.ts`,
  `src/state/locationStore.ts`). Adding a `WebDriverAgentLocationProvider` later
  means writing that one class and swapping the constructor call - no UI changes.
- Every place a provider is named in the UI (header badge, Device page, Settings)
  says "Mock" explicitly, so nothing implies a real device is being controlled
  when it isn't.
