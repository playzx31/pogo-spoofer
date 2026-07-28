import type { LocationStatus } from "./types";

/**
 * Abstraction over "however the simulated location is currently being set".
 *
 * `MockLocationProvider` (pure in-memory, no device required) is the only
 * implementation today. See `docs/LOCATION_PROVIDERS.md` for research into
 * which Apple developer/testing interfaces could back a real provider, and
 * why none is wired up yet for unmodified App Store apps.
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
