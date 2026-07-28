import { invoke } from "@tauri-apps/api/core";

import type { LocationProvider } from "./LocationProvider";
import { DEFAULT_LOCATION, type LocationStatus } from "./types";
import { useDeviceStore } from "../state/deviceStore";

interface RustLocationStatus {
  state: "idle" | "set";
  latitude: number | null;
  longitude: number | null;
}

/**
 * Real location provider: asks the currently selected device (over USB, via
 * the Rust backend's `com.apple.dt.simulatelocation` client) to report a
 * different GPS location. There is no persistent "session" the way the mock
 * has - every `setLocation`/`stop` call independently opens, uses, and
 * closes its own connection to the device, so `connect`/`disconnect` here
 * just track whether a target device is currently selected.
 *
 * Every call can genuinely fail (device not trusted, Developer Mode off,
 * Developer Disk Image not mounted, device locked, etc.) and does - it
 * throws the real backend error rather than swallowing it, so movement
 * stops and the failure is visible instead of silently no-opping.
 */
export class TauriLocationProvider implements LocationProvider {
  readonly id = "USB Device (idevice)";

  private status: LocationStatus = {
    connected: false,
    latitude: DEFAULT_LOCATION.latitude,
    longitude: DEFAULT_LOCATION.longitude,
    lastUpdated: new Date().toISOString(),
  };
  private listeners = new Set<(status: LocationStatus) => void>();

  private currentUdid(): string | null {
    return useDeviceStore.getState().status.device?.udid ?? null;
  }

  private requireUdid(): string {
    const udid = this.currentUdid();
    if (!udid) {
      throw new Error("No connected device selected. Connect a device on the Device tab first.");
    }
    return udid;
  }

  async connect(): Promise<void> {
    this.setStatus({ ...this.status, connected: this.currentUdid() !== null });
  }

  async disconnect(): Promise<void> {
    this.setStatus({ ...this.status, connected: false });
  }

  async setLocation(latitude: number, longitude: number): Promise<void> {
    const udid = this.requireUdid();
    const result = await invoke<RustLocationStatus>("set_location", { udid, latitude, longitude });
    this.setStatus({
      connected: true,
      latitude: result.latitude ?? latitude,
      longitude: result.longitude ?? longitude,
      lastUpdated: new Date().toISOString(),
    });
  }

  async stop(): Promise<void> {
    const udid = this.currentUdid();
    if (!udid) return;
    await invoke<RustLocationStatus>("clear_location", { udid });
    this.setStatus({ ...this.status, connected: true });
  }

  async getStatus(): Promise<LocationStatus> {
    return this.status;
  }

  onStatusChange(callback: (status: LocationStatus) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private setStatus(status: LocationStatus) {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}
