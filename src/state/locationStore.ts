import { create } from "zustand";

import { haversineDistanceKm, type Coordinates } from "../lib/geo";
import { MockLocationProvider } from "../location/MockLocationProvider";
import type { LocationProvider } from "../location/LocationProvider";
import { safeInvoke } from "../lib/tauri";
import { useLogStore } from "./logStore";

export type LocationSource = "map-click" | "manual-entry" | "movement" | "system";

export interface LocationChangeRecord {
  id: number;
  old: Coordinates | null;
  next: Coordinates;
  distanceKm: number;
  source: LocationSource;
  timestamp: string;
}

interface LocationState {
  provider: LocationProvider;
  connected: boolean;
  current: Coordinates;
  destination: Coordinates | null;
  /** A point the user just clicked/searched, pending confirmation as a destination or test location. */
  selectedPoint: Coordinates | null;
  lastChange: LocationChangeRecord | null;

  // Live movement telemetry, updated by the MovementEngine while a
  // direction is held.
  movementActive: boolean;
  heading: number | null;
  speedKmh: number;
  sessionDistanceKm: number;

  initialize: () => Promise<void>;
  setTestLocation: (coords: Coordinates, source: LocationSource) => Promise<void>;
  setDestination: (coords: Coordinates | null) => void;
  selectPoint: (coords: Coordinates | null) => void;
  applyMovementTick: (coords: Coordinates, heading: number, speedKmh: number, deltaKm: number) => void;
  setMovementActive: (active: boolean) => void;
  resetSessionDistance: () => void;
}

let nextRecordId = 1;

export const useLocationStore = create<LocationState>((set, get) => ({
  provider: new MockLocationProvider(),
  connected: false,
  current: { latitude: 42.6073, longitude: -82.983 },
  destination: null,
  selectedPoint: null,
  lastChange: null,

  movementActive: false,
  heading: null,
  speedKmh: 0,
  sessionDistanceKm: 0,

  initialize: async () => {
    const { provider } = get();
    await provider.connect();
    const status = await provider.getStatus();
    set({ connected: status.connected, current: { latitude: status.latitude, longitude: status.longitude } });
    useLogStore.getState().log("info", `${provider.id} connected`);
  },

  setTestLocation: async (coords, source) => {
    const { provider, current } = get();
    const old = current;
    await provider.setLocation(coords.latitude, coords.longitude);
    const distanceKm = haversineDistanceKm(old, coords);

    const record: LocationChangeRecord = {
      id: nextRecordId++,
      old,
      next: coords,
      distanceKm,
      source,
      timestamp: new Date().toISOString(),
    };

    set({ current: coords, lastChange: record, connected: true });

    useLogStore
      .getState()
      .log(
        "info",
        `Location set via ${source}`,
        `(${old.latitude.toFixed(5)}, ${old.longitude.toFixed(5)}) -> (${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}), ${distanceKm.toFixed(2)} km`,
      );

    await safeInvoke("record_location_event", {
      oldLatitude: old.latitude,
      oldLongitude: old.longitude,
      newLatitude: coords.latitude,
      newLongitude: coords.longitude,
      source,
    });
  },

  setDestination: (coords) => set({ destination: coords }),
  selectPoint: (coords) => set({ selectedPoint: coords }),

  applyMovementTick: (coords, heading, speedKmh, deltaKm) => {
    set((state) => ({
      current: coords,
      heading,
      speedKmh,
      sessionDistanceKm: state.sessionDistanceKm + deltaKm,
    }));
    // Fire-and-forget: keep the provider's internal status in sync without
    // awaiting on every animation tick.
    void get().provider.setLocation(coords.latitude, coords.longitude);
  },

  setMovementActive: (active) => set({ movementActive: active, ...(active ? {} : { heading: null, speedKmh: 0 }) }),

  resetSessionDistance: () => set({ sessionDistanceKm: 0 }),
}));
