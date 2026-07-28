import type { LocationStatus } from "./types";

/**
 * Abstraction over "however the simulated location is currently being set".
 *
 * Two implementations: `MockLocationProvider` (pure in-memory, no device
 * required - used outside Tauri) and `TauriLocationProvider` (talks to a
 * real USB-connected device via the Rust backend's `set_location`/
 * `clear_location` commands). See `docs/LOCATION_PROVIDERS.md` for how the
 * real one works and its real prerequisites (Developer Mode, Developer Disk
 * Image).
 */
export interface LocationProvider {
  readonly id: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  setLocation(latitude: number, longitude: number): Promise<void>;
  stop(): Promise<void>;

  getStatus(): Promise<LocationStatus>;

  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatusChange(callback: (status: LocationStatus) => void): () => void;
}
