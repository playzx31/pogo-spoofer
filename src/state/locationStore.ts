import { create } from "zustand";

import { haversineDistanceKm, isValidCoordinate, type Coordinates } from "../lib/geo";
import { createLocationProvider } from "../location/createLocationProvider";
import type { LocationProvider } from "../location/LocationProvider";
import { DEFAULT_LOCATION } from "../location/types";
import { safeInvoke } from "../lib/tauri";
import { toFriendlyError, type FriendlyError } from "../lib/errors";
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
  /** The most recent real failure from the active LocationProvider, if any - cleared on the next successful call. */
  lastError: FriendlyError | null;

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
  applyMovementTick: (coords: Coordinates, heading: number, speedKmh: number, deltaKm: number) => Promise<void>;
  setMovementActive: (active: boolean) => void;
  resetSessionDistance: () => void;
  clearLastError: () => void;
}

let nextRecordId = 1;

export const useLocationStore = create<LocationState>((set, get) => ({
  provider: createLocationProvider(),
  connected: false,
  current: { ...DEFAULT_LOCATION },
  destination: null,
  selectedPoint: null,
  lastChange: null,
  lastError: null,

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

    if (!isValidCoordinate(coords)) {
      const friendly = toFriendlyError(new Error(`Invalid destination (${coords.latitude}, ${coords.longitude})`));
      set({ lastError: friendly });
      useLogStore.getState().log("error", "Set Test Location rejected", friendly.message);
      throw new Error(friendly.message);
    }

    try {
      await provider.setLocation(coords.latitude, coords.longitude);
    } catch (error) {
      const friendly = toFriendlyError(error);
      set({ lastError: friendly });
      useLogStore.getState().log("error", "Set Test Location failed", friendly.message);
      throw error;
    }

    const distanceKm = haversineDistanceKm(old, coords);
    const record: LocationChangeRecord = {
      id: nextRecordId++,
      old,
      next: coords,
      distanceKm,
      source,
      timestamp: new Date().toISOString(),
    };

    set({ current: coords, lastChange: record, connected: true, lastError: null });

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

  applyMovementTick: async (coords, heading, speedKmh, deltaKm) => {
    // Defense in depth: `MovementEngine` already refuses to compute a tick
    // from an invalid position/speed/destination (see its `onSafetyStop`
    // path), but this store method is the single choke point every tick
    // actually flows through before reaching a device, so it re-checks
    // rather than trusting every possible caller to have done so.
    if (!isValidCoordinate(coords) || !Number.isFinite(heading) || !Number.isFinite(speedKmh) || !Number.isFinite(deltaKm)) {
      throw new Error(`Invalid movement tick (${coords.latitude}, ${coords.longitude}), heading=${heading}, speed=${speedKmh}, delta=${deltaKm}`);
    }

    // Awaited (not fire-and-forget): the real provider does a USB round
    // trip per call, and the map/store must only reflect a position the
    // device actually confirmed - never one that merely looks correct
    // locally while the device rejected it.
    await get().provider.setLocation(coords.latitude, coords.longitude);
    set((state) => ({
      current: coords,
      heading,
      speedKmh,
      sessionDistanceKm: state.sessionDistanceKm + deltaKm,
      lastError: null,
    }));
  },

  setMovementActive: (active) => set({ movementActive: active, ...(active ? {} : { heading: null, speedKmh: 0 }) }),

  resetSessionDistance: () => set({ sessionDistanceKm: 0 }),

  clearLastError: () => set({ lastError: null }),
}));
