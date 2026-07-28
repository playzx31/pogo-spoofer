export interface GeocodeResult {
  label: string;
  latitude: number;
  longitude: number;
}

/**
 * Free-text location search via OpenStreetMap's Nominatim service. No API
 * key required. Requests are only made on-demand (debounced by the caller),
 * consistent with Nominatim's usage policy for light, interactive use.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(trimmed)}`;
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Search failed: HTTP ${response.status}`);

  const data: Array<{ display_name: string; lat: string; lon: string }> = await response.json();
  return data.map((item) => ({
    label: item.display_name,
    latitude: parseFloat(item.lat),
    longitude: parseFloat(item.lon),
  }));
}
