import { useEffect, useState, type ReactNode } from "react";

import { useSettingsStore } from "../state/settingsStore";
import { useDeviceStore } from "../state/deviceStore";
import { useLocationStore } from "../state/locationStore";
import { safeInvoke, isTauri } from "../lib/tauri";
import "./SettingsPage.css";

export function SettingsPage() {
  const deviceProviderId = useDeviceStore((s) => s.provider.id);
  const locationProviderId = useLocationStore((s) => s.provider.id);
  const units = useSettingsStore((s) => s.units);
  const setUnits = useSettingsStore((s) => s.setUnits);
  const speeds = useSettingsStore((s) => s.speeds);
  const setSpeed = useSettingsStore((s) => s.setSpeed);
  const travelTimer = useSettingsStore((s) => s.travelTimer);
  const setTravelTimer = useSettingsStore((s) => s.setTravelTimer);
  const resetDefaults = useSettingsStore((s) => s.resetDefaults);

  const [dbStatus, setDbStatus] = useState<string>("Not checked yet.");
  const [dbPath, setDbPath] = useState<string>("");

  useEffect(() => {
    void safeInvoke<string>("get_db_path").then((p) => p && setDbPath(p));
  }, []);

  const checkDb = async () => {
    setDbStatus("Checking…");
    const result = await safeInvoke<string>("db_health_check");
    setDbStatus(result ?? (isTauri() ? "Failed - see console." : "Unavailable outside the Tauri app."));
  };

  return (
    <div className="settings-page">
      <Section title="Units">
        <div className="settings-page__row">
          <label>Distance unit</label>
          <select value={units} onChange={(e) => setUnits(e.target.value as "km" | "mi")}>
            <option value="mi">Miles</option>
            <option value="km">Kilometers</option>
          </select>
        </div>
      </Section>

      <Section title="Movement Speeds (km/h)">
        <div className="settings-page__row">
          <label>Walking</label>
          <input type="number" min={0.5} step={0.5} value={speeds.walkingKmh} onChange={(e) => setSpeed("walkingKmh", Number(e.target.value))} />
        </div>
        <div className="settings-page__row">
          <label>Running</label>
          <input type="number" min={0.5} step={0.5} value={speeds.runningKmh} onChange={(e) => setSpeed("runningKmh", Number(e.target.value))} />
        </div>
        <div className="settings-page__row">
          <label>Cycling</label>
          <input type="number" min={0.5} step={0.5} value={speeds.cyclingKmh} onChange={(e) => setSpeed("cyclingKmh", Number(e.target.value))} />
        </div>
        <div className="settings-page__row">
          <label>Custom default</label>
          <input type="number" min={0.5} step={0.5} value={speeds.customKmh} onChange={(e) => setSpeed("customKmh", Number(e.target.value))} />
        </div>
      </Section>

      <Section title="Travel Timer Rules (advisory only)">
        <div className="settings-page__row">
          <label>Warn above distance (km)</label>
          <input
            type="number"
            min={0}
            value={travelTimer.warningDistanceKm}
            onChange={(e) => setTravelTimer({ warningDistanceKm: Number(e.target.value) })}
          />
        </div>
        <div className="settings-page__row">
          <label>Seconds suggested per km</label>
          <input type="number" min={0} value={travelTimer.secondsPerKm} onChange={(e) => setTravelTimer({ secondsPerKm: Number(e.target.value) })} />
        </div>
        <div className="settings-page__row">
          <label>Minimum suggested wait (s)</label>
          <input
            type="number"
            min={0}
            value={travelTimer.minimumSeconds}
            onChange={(e) => setTravelTimer({ minimumSeconds: Number(e.target.value) })}
          />
        </div>
        <div className="settings-page__row">
          <label>Maximum suggested wait (s)</label>
          <input
            type="number"
            min={0}
            value={travelTimer.maximumSeconds}
            onChange={(e) => setTravelTimer({ maximumSeconds: Number(e.target.value) })}
          />
        </div>
        <p className="settings-page__hint">
          This timer only displays a suggestion and countdown. It does not delay actions, hide activity, or claim to make anything
          undetectable.
        </p>
      </Section>

      <Section title="Providers">
        <div className="settings-page__row">
          <label>Device provider</label>
          <span className="mono">{deviceProviderId}</span>
        </div>
        <div className="settings-page__row">
          <label>Location provider</label>
          <span className="mono">{locationProviderId}</span>
        </div>
        <p className="settings-page__hint">
          {isTauri()
            ? "Real USB device detection and location simulation via usbmuxd/lockdown (see the README's \"Developer Disk Image\" section for prerequisites)."
            : "Running outside the Tauri app (e.g. `pnpm dev` in a browser), so the mock providers are active - the built app always uses the real ones above."}
        </p>
      </Section>

      <Section title="Database &amp; Logging">
        <div className="settings-page__row">
          <label>SQLite database path</label>
          <span className="mono settings-page__path">{dbPath || "—"}</span>
        </div>
        <div className="settings-page__row">
          <label>Connection status</label>
          <span className="mono">{dbStatus}</span>
        </div>
        <button className="btn" onClick={() => void checkDb()}>
          Run Health Check
        </button>
        <p className="settings-page__hint">Technical logs (device/location errors) are on the Logs tab, and mirrored to the Rust log file for support/debugging.</p>
      </Section>

      <button className="btn btn-danger settings-page__reset" onClick={resetDefaults}>
        Reset to Defaults
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="settings-page__section panel">
      <div className="settings-page__section-header">
        <span className="panel-title">{title}</span>
      </div>
      <div className="settings-page__section-body">{children}</div>
    </div>
  );
}
