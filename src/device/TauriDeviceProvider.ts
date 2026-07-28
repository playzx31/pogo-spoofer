import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { DeviceProvider } from "./DeviceProvider";
import { DISCONNECTED_STATUS, type DeviceError, type DeviceInfo, type DeviceStatus } from "./types";
import { toFriendlyError } from "../lib/errors";

const DEVICES_CHANGED_EVENT = "devices-changed";

/** Mirrors `src-tauri/src/device/real.rs::DeviceState`. */
type RustDeviceState = "pairing-required" | "connected" | "ready";

interface RustDeviceStatus {
  state: RustDeviceState;
  device: DeviceInfo | null;
  error: DeviceError | null;
  developerModeEnabled: boolean | null;
  developerDiskImageMounted: boolean | null;
}

function mapRustStatus(status: RustDeviceStatus | null): DeviceStatus {
  if (!status) return DISCONNECTED_STATUS;
  return {
    state: status.state,
    device: status.device,
    error: status.error,
    developerModeEnabled: status.developerModeEnabled,
    developerDiskImageMounted: status.developerDiskImageMounted,
  };
}

/**
 * Real device provider: talks to the Rust backend, which talks to the
 * physical device over USB via `usbmuxd`/lockdown (see
 * `src-tauri/src/device/real.rs`). Detection is push-based - a background
 * watcher on the Rust side emits `devices-changed` whenever the attached
 * device set changes, so the header/Device page update without the user
 * ever needing to click Connect first. Connect/Reconnect remain meaningful
 * as the way to (re)trigger the USB trust/pairing prompt.
 */
export class TauriDeviceProvider implements DeviceProvider {
  readonly id = "USB Device (idevice)";

  private status: DeviceStatus = DISCONNECTED_STATUS;
  private devices: RustDeviceStatus[] = [];
  private selectedUdid: string | null = null;
  private listeners = new Set<(status: DeviceStatus) => void>();
  private unlisten: Promise<UnlistenFn>;

  constructor() {
    this.unlisten = listen<RustDeviceStatus[]>(DEVICES_CHANGED_EVENT, (event) => {
      this.applyDeviceList(event.payload);
    });
    invoke<RustDeviceStatus[]>("list_devices")
      .then((list) => this.applyDeviceList(list))
      .catch(() => {
        // No devices cached yet on first launch - not an error, just empty.
      });
  }

  /** All currently known devices, for a device picker if more than one is ever attached. */
  listDevices(): RustDeviceStatus[] {
    return this.devices;
  }

  selectDevice(udid: string) {
    this.selectedUdid = udid;
    this.applyDeviceList(this.devices);
  }

  private applyDeviceList(list: RustDeviceStatus[]) {
    this.devices = list;
    const selected =
      list.find((d) => d.device?.udid === this.selectedUdid) ?? list[0] ?? null;
    this.selectedUdid = selected?.device?.udid ?? null;
    this.status = mapRustStatus(selected);
    this.emit();
  }

  async connect(): Promise<void> {
    if (!this.selectedUdid) {
      try {
        const list = await invoke<RustDeviceStatus[]>("refresh_devices");
        this.applyDeviceList(list);
      } catch (error) {
        this.status = { state: "error", device: null, error: toFriendlyError(error) };
        this.emit();
        return;
      }
      if (!this.selectedUdid) return; // genuinely nothing plugged in
    }

    const current = this.devices.find((d) => d.device?.udid === this.selectedUdid);
    this.status = { ...this.status, state: "connecting", error: null };
    this.emit();

    try {
      const result =
        current?.state === "pairing-required"
          ? await invoke<RustDeviceStatus>("pair_device", { udid: this.selectedUdid })
          : await invoke<RustDeviceStatus>("get_device_info", { udid: this.selectedUdid });
      this.status = mapRustStatus(result);
      this.devices = this.devices.map((d) => (d.device?.udid === this.selectedUdid ? result : d));
    } catch (error) {
      this.status = { state: "error", device: this.status.device, error: toFriendlyError(error) };
    }
    this.emit();
  }

  async disconnect(): Promise<void> {
    // Physical USB devices can't be software-disconnected; this clears the
    // app's active selection. The background watcher will immediately
    // re-populate it as still attached on the next poll, same as unplugging
    // and replugging would.
    this.status = DISCONNECTED_STATUS;
    this.emit();
  }

  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  async getStatus(): Promise<DeviceStatus> {
    return this.status;
  }

  onStatusChange(callback: (status: DeviceStatus) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  dispose() {
    void this.unlisten.then((fn) => fn());
  }

  private emit() {
    for (const listener of this.listeners) listener(this.status);
  }
}
