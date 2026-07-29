import { useState } from "react";

import { Joystick } from "./Joystick";
import { SpeedSelector, type SpeedMode } from "./SpeedSelector";
import { useMovementEngine } from "./useMovementEngine";
import { useKeyboardMovement } from "./useKeyboardMovement";
import type { CompassDirection } from "./directions";
import { useLocationStore } from "../state/locationStore";
import { useSettingsStore } from "../state/settingsStore";
import { formatCoordinate, formatDistance, isValidLatitude, normalizeLongitude } from "../lib/geo";
import { TravelTimer } from "../cooldown/TravelTimer";
import "./MovementPanel.css";

export function MovementPanel() {
  const [mode, setMode] = useState<SpeedMode>("walking");
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const speeds = useSettingsStore((s) => s.speeds);
  const setSpeed = useSettingsStore((s) => s.setSpeed);
  const units = useSettingsStore((s) => s.units);

  const current = useLocationStore((s) => s.current);
  const heading = useLocationStore((s) => s.heading);
  const speedKmh = useLocationStore((s) => s.speedKmh);
  const sessionDistanceKm = useLocationStore((s) => s.sessionDistanceKm);
  const movementActive = useLocationStore((s) => s.movementActive);
  const setTestLocation = useLocationStore((s) => s.setTestLocation);
  const lastError = useLocationStore((s) => s.lastError);

  const resolvedSpeedKmh =
    mode === "walking" ? speeds.walkingKmh : mode === "running" ? speeds.runningKmh : mode === "cycling" ? speeds.cyclingKmh : speeds.customKmh;

  const engine = useMovementEngine(resolvedSpeedKmh);

  const start = (direction: CompassDirection) => engine.start(direction);
  const stop = () => engine.stop();

  const { heldDirections } = useKeyboardMovement({ start, stop, enabled: true });

  const handleManualSet = () => {
    const lat = parseFloat(manualLat);
    const lon = parseFloat(manualLon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      setManualError("Enter numeric latitude and longitude.");
      return;
    }
    if (!isValidLatitude(lat)) {
      setManualError("Latitude must be between -90 and 90.");
      return;
    }
    setManualError(null);
    void setTestLocation({ latitude: lat, longitude: normalizeLongitude(lon) }, "manual-entry").catch(() => {
      // Failure is already recorded in useLocationStore.lastError and the Logs tab.
    });
  };

  return (
    <div className="movement-panel panel">
      <div className="movement-panel__body">
        <Joystick activeDirections={heldDirections} onStart={start} onStop={stop} />

        <div className="movement-panel__stats">
          <div className="movement-panel__stats-grid">
            <Stat label="Heading" value={heading !== null ? `${heading}°` : "—"} />
            <Stat label="Speed" value={movementActive ? `${speedKmh.toFixed(1)} km/h` : "0 km/h"} />
            <Stat label="Distance Traveled" value={formatDistance(sessionDistanceKm, units)} />
            <Stat label="Status" value={movementActive ? "Moving" : "Idle"} />
          </div>
          <p className="movement-panel__hint">Hold a direction, or use W A S D (and diagonals like W+D).</p>
        </div>
      </div>

      <div className="movement-panel__controls">
        <SpeedSelector mode={mode} onModeChange={setMode} customKmh={speeds.customKmh} onCustomChange={(v) => setSpeed("customKmh", v)} />
        <button className="btn btn-danger" onClick={stop} disabled={!movementActive}>
          STOP
        </button>
      </div>

      <div className="movement-panel__coords">
        <label>
          Lat:
          <input
            type="text"
            inputMode="decimal"
            placeholder={formatCoordinate(current.latitude)}
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
          />
        </label>
        <label>
          Long:
          <input
            type="text"
            inputMode="decimal"
            placeholder={formatCoordinate(current.longitude)}
            value={manualLon}
            onChange={(e) => setManualLon(e.target.value)}
          />
        </label>
      </div>

      {(manualError ?? lastError) && <p className="movement-panel__error">{manualError ?? lastError?.message}</p>}

      <div className="movement-panel__footer">
        <button className="btn btn-primary" onClick={handleManualSet}>
          Set Test Location
        </button>
        <TravelTimer />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="movement-panel__stat">
      <span className="movement-panel__stat-label">{label}</span>
      <span className="movement-panel__stat-value mono">{value}</span>
    </div>
  );
}
