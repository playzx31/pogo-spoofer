/**
 * Where the map/movement UI starts before any location has ever been set.
 * Not a claim about the device's real GPS position - a real
 * `LocationProvider` doesn't query that at all - just a reasonable default
 * center for the map.
 */
export const DEFAULT_LOCATION = { latitude: 42.6073, longitude: -82.983 };

export interface LocationStatus {
  connected: boolean;
  latitude: number;
  longitude: number;
  lastUpdated: string; // ISO timestamp
}

export interface LocationChangeEvent {
  old: { latitude: number; longitude: number } | null;
  next: { latitude: number; longitude: number };
  distanceKm: number;
  timestamp: string;
  source: "map-click" | "manual-entry" | "movement";
}
