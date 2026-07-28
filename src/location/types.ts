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
