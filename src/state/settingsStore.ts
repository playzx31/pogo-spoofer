import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DistanceUnit = "km" | "mi";

export interface SpeedPresets {
  walkingKmh: number;
  runningKmh: number;
  cyclingKmh: number;
  customKmh: number;
}

export interface TravelTimerSettings {
  /** Warn when a single location jump is at least this far. */
  warningDistanceKm: number;
  /** Suggested wait time is distance (km) times this many seconds. */
  secondsPerKm: number;
  /** Floor on the suggested wait, regardless of distance. */
  minimumSeconds: number;
  /** Ceiling on the suggested wait. */
  maximumSeconds: number;
}

interface SettingsState {
  units: DistanceUnit;
  speeds: SpeedPresets;
  travelTimer: TravelTimerSettings;
  setUnits: (units: DistanceUnit) => void;
  setSpeed: (key: keyof SpeedPresets, kmh: number) => void;
  setTravelTimer: (patch: Partial<TravelTimerSettings>) => void;
  resetDefaults: () => void;
}

/** Sane bounds for a configured movement speed - rejects NaN/negative values and an accidental extra digit (e.g. "1500" instead of "15") before they ever reach the movement engine. */
const MIN_SPEED_KMH = 0.1;
const MAX_SPEED_KMH = 300;

function clampSpeed(kmh: number): number {
  if (!Number.isFinite(kmh)) return MIN_SPEED_KMH;
  return Math.min(MAX_SPEED_KMH, Math.max(MIN_SPEED_KMH, kmh));
}

const DEFAULTS: Pick<SettingsState, "units" | "speeds" | "travelTimer"> = {
  units: "mi",
  speeds: {
    walkingKmh: 5,
    runningKmh: 10,
    cyclingKmh: 20,
    customKmh: 15,
  },
  travelTimer: {
    warningDistanceKm: 10,
    secondsPerKm: 6,
    minimumSeconds: 30,
    maximumSeconds: 600,
  },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setUnits: (units) => set({ units }),
      setSpeed: (key, kmh) => set((state) => ({ speeds: { ...state.speeds, [key]: clampSpeed(kmh) } })),
      setTravelTimer: (patch) => set((state) => ({ travelTimer: { ...state.travelTimer, ...patch } })),
      resetDefaults: () => set({ ...DEFAULTS }),
    }),
    { name: "pogo-control-hub-settings" },
  ),
);
