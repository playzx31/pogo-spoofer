import { describe, expect, it } from "vitest";

import { decomposeDirection, directionFromHeading, directionFromKeys, HEADING_DEGREES } from "./directions";

describe("directionFromKeys", () => {
  it("returns null when nothing is held", () => {
    expect(directionFromKeys(false, false, false, false)).toBeNull();
  });

  it("maps the four cardinal directions", () => {
    expect(directionFromKeys(true, false, false, false)).toBe("N");
    expect(directionFromKeys(false, true, false, false)).toBe("S");
    expect(directionFromKeys(false, false, true, false)).toBe("E");
    expect(directionFromKeys(false, false, false, true)).toBe("W");
  });

  it("combines W/A/S/D-style diagonals", () => {
    expect(directionFromKeys(true, false, true, false)).toBe("NE");
    expect(directionFromKeys(true, false, false, true)).toBe("NW");
    expect(directionFromKeys(false, true, true, false)).toBe("SE");
    expect(directionFromKeys(false, true, false, true)).toBe("SW");
  });

  it("cancels out opposite keys held together", () => {
    expect(directionFromKeys(true, true, false, false)).toBeNull();
    expect(directionFromKeys(false, false, true, true)).toBeNull();
    expect(directionFromKeys(true, true, true, true)).toBeNull();
  });
});

describe("directionFromHeading", () => {
  it("is the exact inverse of HEADING_DEGREES", () => {
    for (const [direction, degrees] of Object.entries(HEADING_DEGREES)) {
      expect(directionFromHeading(degrees)).toBe(direction);
    }
  });

  it("returns null for an unmapped heading or null input", () => {
    expect(directionFromHeading(null)).toBeNull();
    expect(directionFromHeading(37)).toBeNull();
  });
});

describe("decomposeDirection", () => {
  it("returns an empty list when idle", () => {
    expect(decomposeDirection(null)).toEqual([]);
  });

  it("returns a single-element list for a cardinal direction", () => {
    expect(decomposeDirection("N")).toEqual(["N"]);
    expect(decomposeDirection("W")).toEqual(["W"]);
  });

  it("splits a diagonal into its two constituent cardinals", () => {
    expect(decomposeDirection("NE")).toEqual(["N", "E"]);
    expect(decomposeDirection("NW")).toEqual(["N", "W"]);
    expect(decomposeDirection("SE")).toEqual(["S", "E"]);
    expect(decomposeDirection("SW")).toEqual(["S", "W"]);
  });
});
