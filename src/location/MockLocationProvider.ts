import type { LocationProvider } from "./LocationProvider";
import { DEFAULT_LOCATION, type LocationStatus } from "./types";

/**
 * Fully in-memory location provider. Requires no device, no network, and no
 * external tooling, so the map, movement engine, and test-location flow can
 * all be built and exercised immediately.
 */
export class MockLocationProvider implements LocationProvider {
  readonly id = "Mock Location Provider";

  private status: LocationStatus = {
    connected: false,
    latitude: DEFAULT_LOCATION.latitude,
    longitude: DEFAULT_LOCATION.longitude,
    lastUpdated: new Date().toISOString(),
  };
  private listeners = new Set<(status: LocationStatus) => void>();

  async connect(): Promise<void> {
    this.setStatus({ ...this.status, connected: true });
  }

  async disconnect(): Promise<void> {
    this.setStatus({ ...this.status, connected: false });
  }

  async setLocation(latitude: number, longitude: number): Promise<void> {
    this.setStatus({
      connected: true,
      latitude,
      longitude,
      lastUpdated: new Date().toISOString(),
    });
  }

  async stop(): Promise<void> {
    // No continuous simulated motion happens inside the provider itself -
    // the MovementEngine drives repeated setLocation() calls - so "stop" is
    // a no-op at this layer. Kept as a distinct method because a real
    // device-testing provider may need to explicitly cancel an in-flight
    // location simulation session.
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
