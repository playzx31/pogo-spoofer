import { formatDuration } from "../lib/format";
import { formatDistance } from "../lib/geo";
import { useSettingsStore } from "../state/settingsStore";
import { useTravelTimer } from "./useTravelTimer";
import "./TravelTimer.css";

export function TravelTimer() {
  const { warning, secondsRemaining, dismiss } = useTravelTimer();
  const units = useSettingsStore((s) => s.units);

  return (
    <div className="travel-timer">
      {warning && (
        <div className="travel-timer__warning">
          <div className="travel-timer__warning-header">
            <span>TRAVEL WARNING</span>
            <button onClick={dismiss} aria-label="Dismiss travel warning">
              ×
            </button>
          </div>
          <div className="travel-timer__warning-row">
            <span>Distance:</span>
            <span className="mono">{formatDistance(warning.distanceKm, units)}</span>
          </div>
          <div className="travel-timer__warning-row">
            <span>Suggested waiting period:</span>
            <span className="mono">{formatDuration(warning.suggestedSeconds)}</span>
          </div>
          <div className="travel-timer__warning-row">
            <span>Countdown:</span>
            <span className="mono travel-timer__countdown">{formatDuration(secondsRemaining)}</span>
          </div>
          <p className="travel-timer__note">Advisory only - this timer does not block, delay, or hide anything.</p>
        </div>
      )}
      <div className="travel-timer__compact">
        <span className="panel-title">Travel Timer</span>
        <span className={`mono${warning ? " travel-timer__countdown" : ""}`}>{formatDuration(secondsRemaining)}</span>
      </div>
    </div>
  );
}
