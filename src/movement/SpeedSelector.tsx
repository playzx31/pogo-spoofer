import "./SpeedSelector.css";

export type SpeedMode = "walking" | "running" | "cycling" | "custom";

const LABELS: Record<SpeedMode, string> = {
  walking: "Walking",
  running: "Running",
  cycling: "Cycling",
  custom: "Custom",
};

export function SpeedSelector({
  mode,
  onModeChange,
  customKmh,
  onCustomChange,
}: {
  mode: SpeedMode;
  onModeChange: (mode: SpeedMode) => void;
  customKmh: number;
  onCustomChange: (kmh: number) => void;
}) {
  return (
    <div className="speed-selector">
      <label className="speed-selector__label">Speed:</label>
      <select value={mode} onChange={(e) => onModeChange(e.target.value as SpeedMode)}>
        {(Object.keys(LABELS) as SpeedMode[]).map((key) => (
          <option key={key} value={key}>
            {LABELS[key]}
          </option>
        ))}
      </select>
      {mode === "custom" && (
        <input
          type="number"
          className="speed-selector__custom"
          min={0.5}
          max={120}
          step={0.5}
          value={customKmh}
          onChange={(e) => onCustomChange(Number(e.target.value))}
        />
      )}
      {mode === "custom" && <span className="speed-selector__unit">km/h</span>}
    </div>
  );
}
