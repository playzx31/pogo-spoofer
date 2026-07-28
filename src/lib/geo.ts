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
  const phi2 = Math.asin(sinPhi2);

  const y = Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(phi1);
  const x = Math.cos(angularDistance) - Math.sin(phi1) * sinPhi2;
  const lambda2 = lambda1 + Math.atan2(y, x);

  return {
    latitude: toDeg(phi2),
    longitude: ((toDeg(lambda2) + 540) % 360) - 180, // normalize to [-180, 180]
  };
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
