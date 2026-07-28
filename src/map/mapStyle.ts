import type { StyleSpecification } from "maplibre-gl";

/**
 * Free, key-free raster basemap using OpenStreetMap tiles. Fine for
 * development and light personal use. If this app sees heavier use, swap
 * this for a vector style from a provider like MapTiler or Stadia Maps
 * (both offer free tiers with an API key) - the rest of the app only
 * depends on this module exporting a valid MapLibre style, so that's a
 * one-file change.
 */
export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: "osm-tiles",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};
