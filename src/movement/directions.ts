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

/** Combine independent N/S and E/W key states into one of the 8 directions, or null if idle. */
export function directionFromKeys(north: boolean, south: boolean, east: boolean, west: boolean): CompassDirection | null {
  const vertical = north && !south ? "N" : south && !north ? "S" : null;
  const horizontal = east && !west ? "E" : west && !east ? "W" : null;

  if (vertical && horizontal) return `${vertical}${horizontal}` as CompassDirection;
  if (vertical) return vertical;
  if (horizontal) return horizontal;
  return null;
}
