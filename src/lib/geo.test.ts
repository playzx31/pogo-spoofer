import { describe, expect, it } from "vitest";

import { destinationPoint, haversineDistanceKm, isValidCoordinate, isValidLatitude, normalizeLongitude } from "./geo";

describe("haversineDistanceKm", () => {
  it("is zero for identical points", () => {
    const p = { latitude: 42.0, longitude: -83.0 };
    expect(haversineDistanceKm(p, p)).toBeCloseTo(0, 6);
  });

  it("matches the known Windsor-area -> NYC distance shown in the UI (~774.5 km)", () => {
    const km = haversineDistanceKm({ latitude: 42.6073, longitude: -82.983 }, { latitude: 40.758, longitude: -73.9855 });
    expect(km).toBeCloseTo(774.5, -1); // within ~a few km
  });

  it("is symmetric", () => {
    const a = { latitude: 10, longitude: 20 };
    const b = { latitude: -5, longitude: 100 };
    expect(haversineDistanceKm(a, b)).toBeCloseTo(haversineDistanceKm(b, a), 9);
  });
});

describe("destinationPoint", () => {
  it("moving north increases latitude and leaves longitude unchanged", () => {
    const start = { latitude: 0, longitude: 0 };
    const next = destinationPoint(start, 0, 1);
    expect(next.latitude).toBeGreaterThan(start.latitude);
    expect(next.longitude).toBeCloseTo(0, 6);
  });

  it("moving south decreases latitude", () => {
    const start = { latitude: 0, longitude: 0 };
    const next = destinationPoint(start, 180, 1);
    expect(next.latitude).toBeLessThan(start.latitude);
  });

  it("moving east increases longitude near the equator", () => {
    const start = { latitude: 0, longitude: 0 };
    const next = destinationPoint(start, 90, 1);
    expect(next.longitude).toBeGreaterThan(start.longitude);
    expect(next.latitude).toBeCloseTo(0, 6);
  });

  it("covers less angular distance per km of eastward travel near the poles than near the equator", () => {
    const nearPole = destinationPoint({ latitude: 89, longitude: 0 }, 90, 10);
    const nearEquator = destinationPoint({ latitude: 0, longitude: 0 }, 90, 10);
    const poleDeltaLon = Math.abs(nearPole.longitude - 0);
    const equatorDeltaLon = Math.abs(nearEquator.longitude - 0);
    // Same physical distance (10km) sweeps a much larger longitude delta near
    // the pole than the equator, because a degree of longitude is much
    // shorter there - this is exactly the "proper geographic calculation"
    // requirement (no naive fixed lat/lon increment).
    expect(poleDeltaLon).toBeGreaterThan(equatorDeltaLon * 10);
  });

  it("never produces NaN when walking directly over the north pole (asin domain edge case)", () => {
    const start = { latitude: 89.9999, longitude: 0 };
    const next = destinationPoint(start, 0, 50); // 50km north, past the pole
    expect(Number.isNaN(next.latitude)).toBe(false);
    expect(Number.isNaN(next.longitude)).toBe(false);
    expect(next.latitude).toBeLessThanOrEqual(90);
    expect(next.latitude).toBeGreaterThanOrEqual(-90);
  });

  it("keeps latitude within [-90, 90] for an arbitrary sweep of headings and distances", () => {
    for (let bearing = 0; bearing < 360; bearing += 15) {
      for (const distanceKm of [0.1, 1, 10, 100, 1000]) {
        const next = destinationPoint({ latitude: 80, longitude: 0 }, bearing, distanceKm);
        expect(next.latitude).toBeGreaterThanOrEqual(-90);
        expect(next.latitude).toBeLessThanOrEqual(90);
        expect(Number.isFinite(next.longitude)).toBe(true);
      }
    }
  });
});

describe("normalizeLongitude", () => {
  it("leaves in-range values untouched", () => {
    expect(normalizeLongitude(0)).toBeCloseTo(0);
    expect(normalizeLongitude(179.9)).toBeCloseTo(179.9);
    expect(normalizeLongitude(-179.9)).toBeCloseTo(-179.9);
  });

  it("wraps past the antimeridian", () => {
    expect(normalizeLongitude(181)).toBeCloseTo(-179);
    expect(normalizeLongitude(-181)).toBeCloseTo(179);
    expect(normalizeLongitude(360)).toBeCloseTo(0);
    expect(normalizeLongitude(-360)).toBeCloseTo(0);
  });
});

describe("isValidLatitude", () => {
  it("accepts the full valid range including the poles", () => {
    expect(isValidLatitude(0)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
  });

  it("rejects out-of-range and non-finite values", () => {
    expect(isValidLatitude(90.001)).toBe(false);
    expect(isValidLatitude(-91)).toBe(false);
    expect(isValidLatitude(NaN)).toBe(false);
    expect(isValidLatitude(Infinity)).toBe(false);
  });
});

describe("isValidCoordinate", () => {
  it("accepts a normal coordinate pair", () => {
    expect(isValidCoordinate({ latitude: 42.6073, longitude: -82.983 })).toBe(true);
  });

  it("accepts any finite longitude, since it is cyclic", () => {
    expect(isValidCoordinate({ latitude: 0, longitude: 181 })).toBe(true);
    expect(isValidCoordinate({ latitude: 0, longitude: -540 })).toBe(true);
  });

  it("rejects NaN or infinite latitude/longitude", () => {
    expect(isValidCoordinate({ latitude: NaN, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: 0, longitude: NaN })).toBe(false);
    expect(isValidCoordinate({ latitude: Infinity, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: 0, longitude: Infinity })).toBe(false);
  });

  it("rejects an out-of-range latitude", () => {
    expect(isValidCoordinate({ latitude: 90.1, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: -91, longitude: 0 })).toBe(false);
  });
});
