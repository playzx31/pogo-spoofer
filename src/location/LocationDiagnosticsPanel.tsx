import { useEffect, useState } from "react";

import { safeInvoke } from "../lib/tauri";

interface LocationDiagnostics {
  lastRequestAtMs: number | null;
  lastRequestedLatitude: number | null;
  lastRequestedLongitude: number | null;
  lastOperation: "set" | "clear" | null;
  backend: "modern" | "legacy" | null;
  lastResult: string | null;
  sessionActive: boolean;
  totalRequests: number;
  successfulRequests: number;
}

const REFRESH_MS = 1000;

function formatAgo(ms: number): string {
  if (ms < 1500) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60_000)}m ago`;
}

/**
 * Developer-only view of what the location-simulation protocol actually
 * reported for the last request - distinct from the Device tab's "Location
 * Sim." field (which just says whether the prerequisites for trying at all
 * are met). This exists to answer "did the iPad actually accept this, and
 * is the session that keeps it simulated still alive" independent of
 * whether any individual app on the device is using the result - see
 * docs/LOCATION_PROVIDERS.md's "Location delivery diagnostics" section.
 */
export function LocationDiagnosticsPanel({ udid }: { udid: string }) {
  const [diagnostics, setDiagnostics] = useState<LocationDiagnostics | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const result = await safeInvoke<LocationDiagnostics>("get_location_diagnostics", { udid });
      if (!cancelled && result) setDiagnostics(result);
    };

    void refresh();
    const interval = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [udid]);

  if (!diagnostics || diagnostics.totalRequests === 0) return null;

  const coordinate =
    diagnostics.lastRequestedLatitude !== null && diagnostics.lastRequestedLongitude !== null
      ? `${diagnostics.lastRequestedLatitude.toFixed(6)}, ${diagnostics.lastRequestedLongitude.toFixed(6)}`
      : "—";

  return (
    <details className="device-page__card panel">
      <summary className="device-page__diagnostics-summary panel-title">Location Delivery Diagnostics (developer)</summary>
      <div className="device-page__body">
        <p className="device-page__hint">
          What the protocol actually reported for the last request - whether <strong>the iPad</strong> accepted a simulated
          location, not whether any individual app (e.g. Pokémon GO) is using it. See "Location delivery diagnostics" in
          docs/LOCATION_PROVIDERS.md.
        </p>
        <dl className="device-page__fields">
          <Field label="Last operation" value={diagnostics.lastOperation ?? "—"} />
          <Field label="Last coordinate" value={coordinate} />
          <Field label="Backend" value={diagnostics.backend ?? "—"} />
          <Field label="Last request" value={diagnostics.lastRequestAtMs !== null ? formatAgo(Date.now() - diagnostics.lastRequestAtMs) : "—"} />
          <Field label="Last result" value={diagnostics.lastResult ?? "—"} />
          <Field label="Session active" value={diagnostics.sessionActive ? "Yes" : "No"} />
          <Field label="Requests (ok/total)" value={`${diagnostics.successfulRequests}/${diagnostics.totalRequests}`} />
        </dl>
      </div>
    </details>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="device-page__field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
