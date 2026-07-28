import { useEffect, useRef } from "react";
import { Map as MapLibreMap, Marker, NavigationControl, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { OSM_RASTER_STYLE } from "./mapStyle";
import { useLocationStore } from "../state/locationStore";
import { MapSelectionPanel } from "./MapSelectionPanel";
import "./MapView.css";

function createMarkerElement(kind: "current" | "destination" | "selected"): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `map-marker map-marker--${kind}`;
  if (kind === "current") {
    el.innerHTML = '<span class="map-marker__pulse"></span><span class="map-marker__dot"></span>';
  }
  return el;
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const currentMarkerRef = useRef<Marker | null>(null);
  const destinationMarkerRef = useRef<Marker | null>(null);
  const selectedMarkerRef = useRef<Marker | null>(null);

  const current = useLocationStore((s) => s.current);
  const destination = useLocationStore((s) => s.destination);
  const selectedPoint = useLocationStore((s) => s.selectedPoint);
  const selectPoint = useLocationStore((s) => s.selectPoint);

  // Initialize the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_RASTER_STYLE,
      center: [current.longitude, current.latitude],
      zoom: 14,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    map.on("click", (e: MapMouseEvent) => {
      selectPoint({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
    });

    currentMarkerRef.current = new Marker({ element: createMarkerElement("current") })
      .setLngLat([current.longitude, current.latitude])
      .addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the current-location marker in sync, and gently follow it while
  // movement is active so the joystick/keyboard controls stay visible.
  useEffect(() => {
    currentMarkerRef.current?.setLngLat([current.longitude, current.latitude]);
    const map = mapRef.current;
    if (map && useLocationStore.getState().movementActive) {
      map.panTo([current.longitude, current.latitude], { duration: 200 });
    }
  }, [current]);

  // Destination marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!destination) {
      destinationMarkerRef.current?.remove();
      destinationMarkerRef.current = null;
      return;
    }

    if (!destinationMarkerRef.current) {
      destinationMarkerRef.current = new Marker({ element: createMarkerElement("destination") }).addTo(map);
    }
    destinationMarkerRef.current.setLngLat([destination.longitude, destination.latitude]);
  }, [destination]);

  // Selected (pending) point marker + fly-to.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!selectedPoint) {
      selectedMarkerRef.current?.remove();
      selectedMarkerRef.current = null;
      return;
    }

    if (!selectedMarkerRef.current) {
      selectedMarkerRef.current = new Marker({ element: createMarkerElement("selected") }).addTo(map);
    }
    selectedMarkerRef.current.setLngLat([selectedPoint.longitude, selectedPoint.latitude]);
    map.flyTo({ center: [selectedPoint.longitude, selectedPoint.latitude], duration: 600 });
  }, [selectedPoint]);

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-view__canvas" />
      <MapSelectionPanel />
    </div>
  );
}
