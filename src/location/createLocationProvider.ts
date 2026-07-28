import { isTauri } from "../lib/tauri";
import type { LocationProvider } from "./LocationProvider";
import { MockLocationProvider } from "./MockLocationProvider";
import { TauriLocationProvider } from "./TauriLocationProvider";

/**
 * Single place that decides which `LocationProvider` implementation backs
 * the app. Real inside Tauri (talks to a physical device over USB), mock
 * when running as a plain browser tab (`vite dev`) for fast UI iteration
 * without hardware.
 */
export function createLocationProvider(): LocationProvider {
  return isTauri() ? new TauriLocationProvider() : new MockLocationProvider();
}
