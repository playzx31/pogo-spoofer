/**
 * Geographic calculations shared by the map, movement engine, and travel
 * timer. All calculations use proper spherical geometry (haversine /
 * great-circle destination point) rather than naively adding raw numbers to
 * latitude/longitude, so movement speed stays consistent regardless of
 * latitude.
 */

const EARTH_RADIUS_KM = 6371.0088;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance between two points, in kilometers. */
export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const phi1 = toRad(a.latitude);
  const phi2 = toRad(b.latitude);
  const dPhi = toRad(b.latitude - a.latitude);
  const dLambda = toRad(b.longitude - a.longitude);

  const sinDPhi = Math.sin(dPhi / 2);
  const sinDLambda = Math.sin(dLambda / 2);

  const h = sinDPhi * sinDPhi + Math.cos(phi1) * Math.cos(phi2) * sinDLambda * sinDLambda;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/**
 * Given a starting point, a compass bearing (degrees, 0 = north), and a
 * distance in kilometers, returns the resulting point along the great
 * circle. This is the standard spherical-earth "destination point" formula.
 */
export function destinationPoint(start: Coordinates, bearingDeg: number, distanceKm: number): Coordinates {
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const bearing = toRad(bearingDeg);

  const phi1 = toRad(start.latitude);
  const lambda1 = toRad(start.longitude);

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(angularDistance) +
    Math.cos(phi1) * Math.sin(angularDistance) * Math.cos(bearing);
  // Floating-point rounding can push this a hair past +/-1 right at the
  // poles, which would make asin() return NaN - clamp to the valid domain.
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)));

  const y = Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(phi1);
  const x = Math.cos(angularDistance) - Math.sin(phi1) * sinPhi2;
  const lambda2 = lambda1 + Math.atan2(y, x);

  return {
    latitude: toDeg(phi2),
    longitude: normalizeLongitude(toDeg(lambda2)),
  };
}

/** Wraps any finite longitude into [-180, 180), so crossing the antimeridian during movement stays a valid coordinate. */
export function normalizeLongitude(longitude: number): number {
  return ((longitude + 540) % 360) - 180;
}

/** `-90 <= latitude <= 90`; used to validate manual coordinate entry before it ever reaches a LocationProvider. */
export function isValidLatitude(latitude: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
}

/**
 * True only for a coordinate pair safe to send to a `LocationProvider` or
 * use as a movement anchor: both fields finite (rules out `NaN`/`Infinity`
 * from an uninitialized store, a bad parse, or a stale/corrupted value), and
 * latitude in range. Longitude is cyclic (see `normalizeLongitude`), so any
 * finite value is acceptable here rather than range-checked.
 */
export function isValidCoordinate(coords: Coordinates): boolean {
  return isValidLatitude(coords.latitude) && Number.isFinite(coords.longitude);
}

export function kmToMiles(km: number): number {
  return km * 0.621371;
}

export function milesToKm(miles: number): number {
  return miles / 0.621371;
}

export function formatDistance(km: number, unit: "km" | "mi"): string {
  const value = unit === "km" ? km : kmToMiles(km);
  const precision = value < 10 ? 2 : 1;
  return `${value.toFixed(precision)} ${unit}`;
}

export function formatCoordinate(value: number): string {
  return value.toFixed(6);
}
