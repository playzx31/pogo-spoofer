import { isTauri } from "../lib/tauri";
import type { DeviceProvider } from "./DeviceProvider";
import { MockDeviceProvider } from "./MockDeviceProvider";
import { TauriDeviceProvider } from "./TauriDeviceProvider";

/**
 * Single place that decides which `DeviceProvider` implementation backs the
 * app. Real inside Tauri (talks to physical USB devices via usbmuxd/lockdown
 * in Rust), mock when running as a plain browser tab (`vite dev`) for fast
 * UI iteration without hardware.
 */
export function createDeviceProvider(): DeviceProvider {
  return isTauri() ? new TauriDeviceProvider() : new MockDeviceProvider();
}
