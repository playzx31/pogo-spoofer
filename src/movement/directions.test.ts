import { describe, expect, it } from "vitest";

import { directionFromHeading, directionFromKeys, HEADING_DEGREES } from "./directions";

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
