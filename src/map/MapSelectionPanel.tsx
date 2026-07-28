import { haversineDistanceKm, formatCoordinate, formatDistance } from "../lib/geo";
import { useLocationStore } from "../state/locationStore";
import { useSettingsStore } from "../state/settingsStore";
import "./MapSelectionPanel.css";

export function MapSelectionPanel() {
  const current = useLocationStore((s) => s.current);
  const selectedPoint = useLocationStore((s) => s.selectedPoint);
  const selectPoint = useLocationStore((s) => s.selectPoint);
  const setDestination = useLocationStore((s) => s.setDestination);
  const setTestLocation = useLocationStore((s) => s.setTestLocation);
  const units = useSettingsStore((s) => s.units);

  if (!selectedPoint) return null;

  const distanceKm = haversineDistanceKm(current, selectedPoint);

  return (
    <div className="map-selection-panel panel">
      <button className="map-selection-panel__close" onClick={() => selectPoint(null)} aria-label="Dismiss">
        ×
      </button>

      <div className="map-selection-panel__row">
        <span className="panel-title">Current</span>
        <span className="mono">
          {formatCoordinate(current.latitude)}, {formatCoordinate(current.longitude)}
        </span>
      </div>
      <div className="map-selection-panel__row">
        <span className="panel-title">Selected</span>
        <span className="mono">
          {formatCoordinate(selectedPoint.latitude)}, {formatCoordinate(selectedPoint.longitude)}
        </span>
      </div>
      <div className="map-selection-panel__row">
        <span className="panel-title">Distance</span>
        <span className="mono">{formatDistance(distanceKm, units)}</span>
      </div>

      <div className="map-selection-panel__actions">
        <button
          className="btn"
          onClick={() => {
            setDestination(selectedPoint);
            selectPoint(null);
          }}
        >
          Set Destination
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            void setTestLocation(selectedPoint, "map-click");
            selectPoint(null);
          }}
        >
          Set Test Location
        </button>
      </div>
    </div>
  );
}
