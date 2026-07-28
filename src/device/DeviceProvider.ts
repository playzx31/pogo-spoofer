import type { DeviceStatus } from "./types";

/**
 * Abstraction over "however we currently talk to a physical device".
 *
 * The UI never talks to a concrete implementation directly - it only knows
 * about this interface, so swapping `MockDeviceProvider` for a real USB
 * detection provider (planned: shelling out to libimobiledevice tooling
 * from Rust) requires no changes to any component.
 */
export interface DeviceProvider {
  /** Human-readable identifier shown in Settings, e.g. "Mock", "USB (libimobiledevice)". */
  readonly id: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  reconnect(): Promise<void>;
  getStatus(): Promise<DeviceStatus>;

  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatusChange(callback: (status: DeviceStatus) => void): () => void;
}
