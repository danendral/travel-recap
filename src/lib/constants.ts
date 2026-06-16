import type { AspectRatio } from "@/types";

import type { StyleSpecification } from "maplibre-gl";

type StyleDef = { id: string; label: string; style: string | StyleSpecification };

/** Esri World Imagery satellite + a place-label overlay. Key-less, CORS-ok. */
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    "esri-imagery": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    "esri-labels": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#000" } },
    { id: "esri-imagery", type: "raster", source: "esri-imagery" },
    { id: "esri-labels", type: "raster", source: "esri-labels" },
  ],
};

/**
 * Selectable basemaps, mirroring the variety competitors offer (satellite,
 * dark, light/B&W, colorful, terrain) — all key-less & CORS-friendly, $0.
 * `id` is what we persist on `Trip.mapStyleId`.
 */
export const MAP_STYLES: StyleDef[] = [
  { id: "dark", label: "Dark", style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json" },
  { id: "satellite", label: "Satellite", style: SATELLITE_STYLE },
  { id: "light", label: "Light", style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json" },
  { id: "voyager", label: "Voyager", style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json" },
  { id: "terrain", label: "Terrain", style: "https://tiles.openfreemap.org/styles/liberty" },
];

export const DEFAULT_STYLE_ID = "dark";

/** Resolves a style id to a URL string or inline StyleSpecification. */
export function styleUrlFor(id: string): string | StyleSpecification {
  return (MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES[0]).style;
}

/** Premium dark vector basemap — the default look. */
export const DEFAULT_MAP_STYLE = styleUrlFor(DEFAULT_STYLE_ID);

/** Initial globe framing on a fresh trip. */
export const INITIAL_VIEW = {
  center: [10, 30] as [number, number],
  zoom: 1.4,
  pitch: 0,
  bearing: 0,
};

/** Default animation time spent traversing a single leg. */
export const DEFAULT_SEGMENT_DURATION_MS = 3000;

/** Default time the camera lingers on each waypoint before moving on. */
export const DEFAULT_DWELL_MS = 1500;

/** Export pixel dimensions per aspect ratio, at the free-tier 720p tier. */
export const RESOLUTION_BY_RATIO: Record<
  AspectRatio,
  { width: number; height: number }
> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 720, height: 720 },
};
