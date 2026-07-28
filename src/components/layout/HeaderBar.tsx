import { useEffect, useRef, useState } from "react";

import { Badge } from "../common/Badge";
import { useDeviceStore } from "../../state/deviceStore";
import { useLocationStore } from "../../state/locationStore";
import { searchPlaces, type GeocodeResult } from "../../map/geocode";
import { useLogStore } from "../../state/logStore";
import "./HeaderBar.css";

export function HeaderBar() {
  const status = useDeviceStore((s) => s.status);
  const selectPoint = useLocationStore((s) => s.selectPoint);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      try {
        const found = await searchPlaces(query, controller.signal);
        setResults(found);
        setOpen(true);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          useLogStore.getState().log("warn", "Location search failed", String(error));
        }
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [query]);

  const deviceLabel = status.device?.name ?? "No Device";
  const deviceTone = status.state === "connected" ? "success" : status.state === "connecting" ? "warning" : status.state === "error" ? "danger" : "neutral";
  const deviceMark = status.state === "connected" ? "✓" : status.state === "error" ? "✕" : "–";

  return (
    <header className="header-bar">
      <div className="header-bar__device">
        <span className="header-bar__label">DEVICE:</span>
        <Badge tone={deviceTone}>
          {deviceLabel} {deviceMark}
        </Badge>
      </div>

      <div className="header-bar__search">
        <input
          type="text"
          placeholder="Search location..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {searching && <span className="header-bar__spinner">…</span>}
        {open && results.length > 0 && (
          <ul className="header-bar__results">
            {results.map((r, i) => (
              <li
                key={i}
                onMouseDown={() => {
                  selectPoint({ latitude: r.latitude, longitude: r.longitude });
                  setQuery(r.label);
                  setOpen(false);
                }}
              >
                {r.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </header>
  );
}
