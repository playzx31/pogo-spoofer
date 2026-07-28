import { useEffect, useState } from "react";

import { useLocationStore } from "../state/locationStore";
import { useSettingsStore } from "../state/settingsStore";

export interface TravelWarning {
  distanceKm: number;
  suggestedSeconds: number;
}

/**
 * Purely informational travel-time advisory: when a "Set Test Location"
 * jump covers a large distance, suggest a wait before the next jump and
 * count it down. This does not delay, block, or alter anything the app
 * does - it is a visible suggestion only, and never claims to make
 * location changes safe or undetectable.
 */
export function useTravelTimer() {
  const lastChange = useLocationStore((s) => s.lastChange);
  const settings = useSettingsStore((s) => s.travelTimer);

  const [warning, setWarning] = useState<TravelWarning | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  useEffect(() => {
    if (!lastChange || lastChange.distanceKm < settings.warningDistanceKm) return;

    const suggestedSeconds = Math.min(
      settings.maximumSeconds,
      Math.max(settings.minimumSeconds, Math.round(lastChange.distanceKm * settings.secondsPerKm)),
    );
    setWarning({ distanceKm: lastChange.distanceKm, suggestedSeconds });
    setSecondsRemaining(suggestedSeconds);
    // Only re-evaluate when a new change actually arrives; changing the
    // threshold settings mid-countdown shouldn't restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastChange]);

  useEffect(() => {
    if (secondsRemaining <= 0) return;
    const id = setInterval(() => setSecondsRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsRemaining > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = () => {
    setWarning(null);
    setSecondsRemaining(0);
  };

  return {
    warning: secondsRemaining > 0 ? warning : null,
    secondsRemaining,
    dismiss,
  };
}
