import { useLogStore, type LogLevel } from "../state/logStore";
import { Badge } from "../components/common/Badge";
import "./LogsPage.css";

const TONE: Record<LogLevel, "success" | "warning" | "danger"> = {
  info: "success",
  warn: "warning",
  error: "danger",
};

export function LogsPage() {
  const entries = useLogStore((s) => s.entries);

  return (
    <div className="logs-page">
      <div className="logs-page__panel panel">
        <div className="logs-page__header">
          <span className="panel-title">Application Logs</span>
          <span className="logs-page__count">{entries.length} entries this session</span>
        </div>
        <div className="logs-page__list">
          {entries.length === 0 && <p className="logs-page__empty">No events logged yet. Connect a device or move the map to generate activity.</p>}
          {entries.map((entry) => (
            <div key={entry.id} className="logs-page__row">
              <Badge tone={TONE[entry.level]}>{entry.level.toUpperCase()}</Badge>
              <div className="logs-page__row-body">
                <div className="logs-page__row-message">{entry.message}</div>
                {entry.detail && <div className="logs-page__row-detail mono">{entry.detail}</div>}
              </div>
              <span className="logs-page__row-time mono">{new Date(entry.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
