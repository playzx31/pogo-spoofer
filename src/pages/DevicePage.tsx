import { Badge } from "../components/common/Badge";
import { useDeviceStore } from "../state/deviceStore";
import type { MockScenario } from "../device/MockDeviceProvider";
import "./DevicePage.css";

const SCENARIOS: { value: MockScenario; label: string }[] = [
  { value: "trusted-ipad", label: "iPad — Trusted (success)" },
  { value: "untrusted-ipad", label: "iPad — Not Trusted (error)" },
  { value: "no-device", label: "No Device Found (error)" },
  { value: "connection-error", label: "USB Communication Failure (error)" },
];

export function DevicePage() {
  const status = useDeviceStore((s) => s.status);
  const busy = useDeviceStore((s) => s.busy);
  const connect = useDeviceStore((s) => s.connect);
  const disconnect = useDeviceStore((s) => s.disconnect);
  const reconnect = useDeviceStore((s) => s.reconnect);
  const setMockScenario = useDeviceStore((s) => s.setMockScenario);

  const tone = status.state === "connected" ? "success" : status.state === "connecting" ? "warning" : status.state === "error" ? "danger" : "neutral";

  return (
    <div className="device-page">
      <div className="device-page__card panel">
        <div className="device-page__header">
          <span className="panel-title">Device</span>
          <Badge tone={tone}>{status.state.toUpperCase()}</Badge>
        </div>

        <div className="device-page__body">
          {status.device ? (
            <dl className="device-page__fields">
              <Field label="Name" value={status.device.name} />
              <Field label="Model" value={status.device.model} />
              <Field label="OS Version" value={status.device.osVersion} />
              <Field label="Connection" value={status.state === "connected" ? "Connected ✓" : "Disconnected"} />
              <Field label="Trusted" value={status.device.trusted ? "Trusted ✓" : "Not Trusted ✕"} />
            </dl>
          ) : (
            <p className="device-page__empty">No device connected.</p>
          )}

          {status.error && (
            <div className="device-page__error">
              <strong>DEVICE CONNECTION FAILED</strong>
              <div>
                <span className="device-page__error-label">Reason:</span> {status.error.message}
              </div>
              {status.error.suggestedAction && (
                <div>
                  <span className="device-page__error-label">Suggested action:</span> {status.error.suggestedAction}
                </div>
              )}
            </div>
          )}

          <div className="device-page__actions">
            <button className="btn btn-primary" onClick={() => void connect()} disabled={busy || status.state === "connected"}>
              Connect
            </button>
            <button className="btn" onClick={() => void disconnect()} disabled={busy || status.state === "disconnected"}>
              Disconnect
            </button>
            <button className="btn" onClick={() => void reconnect()} disabled={busy}>
              Reconnect
            </button>
          </div>
        </div>
      </div>

      <div className="device-page__card panel">
        <div className="device-page__header">
          <span className="panel-title">Mock Device Provider (Development)</span>
        </div>
        <div className="device-page__body">
          <p className="device-page__hint">
            No physical iPad/iPhone is required. Choose a scenario, then click Connect above to simulate it. Real USB device detection
            (libimobiledevice) is planned for a later phase - see Settings → Device Provider.
          </p>
          <select defaultValue="trusted-ipad" onChange={(e) => setMockScenario(e.target.value as MockScenario)}>
            {SCENARIOS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
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
