export type CompassDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export const HEADING_DEGREES: Record<CompassDirection, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

export const HEADING_ARROWS: Record<CompassDirection, string> = {
  N: "↑",
  NE: "↗",
  E: "→",
  SE: "↘",
  S: "↓",
  SW: "↙",
  W: "←",
  NW: "↖",
};

const DEGREES_TO_DIRECTION = new Map<number, CompassDirection>(
  (Object.entries(HEADING_DEGREES) as [CompassDirection, number][]).map(([dir, deg]) => [deg, dir]),
);

/** Reverse lookup of `HEADING_DEGREES`, used to derive which joystick arrow to highlight from a live heading. */
export function directionFromHeading(headingDeg: number | null): CompassDirection | null {
  if (headingDeg === null) return null;
  return DEGREES_TO_DIRECTION.get(headingDeg) ?? null;
}

/** Combine independent N/S and E/W key states into one of the 8 directions, or null if idle. */
export function directionFromKeys(north: boolean, south: boolean, east: boolean, west: boolean): CompassDirection | null {
  const vertical = north && !south ? "N" : south && !north ? "S" : null;
  const horizontal = east && !west ? "E" : west && !east ? "W" : null;

  if (vertical && horizontal) return `${vertical}${horizontal}` as CompassDirection;
  if (vertical) return vertical;
  if (horizontal) return horizontal;
  return null;
}

/**
 * Split a (possibly diagonal) direction into its constituent cardinal
 * directions - "NE" -> ["N", "E"], "N" -> ["N"], null -> []. Used to decide
 * which individual joystick/keyboard buttons should show as held, so a
 * button's visual state is driven by the same key combination logic as the
 * movement direction itself rather than a separate, divergent computation.
 */
export function decomposeDirection(direction: CompassDirection | null): CompassDirection[] {
  if (!direction) return [];
  return (direction.match(/[NSEW]/g) ?? []) as CompassDirection[];
}
