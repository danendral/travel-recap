"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Point } from "geojson";
import { useStore } from "@/store";
import { DEFAULT_MAP_STYLE, INITIAL_VIEW, styleUrlFor } from "@/lib/constants";
import { useTripData } from "@/store/selectors";
import { TRAIL_SOURCE, VEHICLE_SOURCE } from "@/lib/map/applyFrame";
import type { Id, VehicleType } from "@/types";

const WAYPOINT_SOURCE = "tr-waypoints";

const VEHICLE_ICONS: VehicleType[] = ["plane", "car", "train", "boat", "walk"];

const ICON_PX = 96; // raster size of the source SVG (high-res; icon-size scales)

/**
 * Loads each vehicle SVG, rasterizes it to RGBA pixels via a canvas, and
 * registers it as `veh-<type>` so the symbol layer can switch icons via a
 * data-driven `icon-image`.
 *
 * We rasterize ourselves rather than using `map.loadImage()` — MapLibre's
 * loader fails to decode SVGs reliably (it silently produced "image could not
 * be loaded", so no icon ever appeared). Drawing the SVG onto a canvas and
 * handing MapLibre the raw ImageData works across browsers. SVGs point up
 * (north); `icon-rotate = bearing` then aligns them to heading.
 */
async function registerVehicleIcons(map: MlMap) {
  await Promise.all([
    ...VEHICLE_ICONS.map(async (type) => {
      const id = `veh-${type}`;
      if (map.hasImage(id)) return;
      try {
        const data = await rasterizeSvg(`/vehicles/${type}.svg`, ICON_PX);
        if (!map.hasImage(id)) map.addImage(id, data, { pixelRatio: 2 });
      } catch {
        // Non-fatal: a missing icon just hides that vehicle, not the app.
      }
    }),
    // The trail dot, placed evenly along the route as a symbol (see addAppLayers).
    (async () => {
      if (map.hasImage("trail-dot")) return;
      try {
        const data = await rasterizeSvg("/trail-dot.svg", 96, 32); // dash: wide, short, hi-res
        if (!map.hasImage("trail-dot")) map.addImage("trail-dot", data, { pixelRatio: 2 });
      } catch {
        /* non-fatal */
      }
    })(),
  ]);
}

/** Draws an SVG URL onto an offscreen canvas and returns its RGBA ImageData. */
function rasterizeSvg(
  url: string,
  width: number,
  height: number = width,
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(ctx.getImageData(0, 0, width, height));
    };
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

/**
 * Adds all of Travel Recap's sources + layers on top of whatever basemap style
 * is loaded. Called on initial load AND after every `setStyle()` (which wipes
 * custom sources/layers/images), so re-registering icons here is required.
 */
function addAppLayers(map: MlMap) {
  void registerVehicleIcons(map);

  // NOTE: no full-route preview line. The route is revealed progressively by
  // the trail below (start → current stop), and only the final overview beat
  // shows the whole route. This matches the requested reveal behavior.

  // Bright trail — the portion drawn so far behind the moving vehicle.
  if (!map.getSource(TRAIL_SOURCE)) {
    map.addSource(TRAIL_SOURCE, { type: "geojson", data: emptyCollection() });
  }
  // Dotted trail as evenly-spaced SYMBOL dashes along the line — NOT a
  // line-dasharray (which re-flows as the line grows, making the moving head
  // look different from the settled part).
  //
  // Both the dash LENGTH (icon-size) and the dash SPACING scale ×2 per zoom
  // level, so the dashes are pinned to a fixed MAP distance and their
  // length:gap ratio is constant — the trail looks identical at any zoom and in
  // both the moving and settled phases. (Anchored at zoom 6: ~16px dash, ~40px
  // period → "medium" dashes with gap ≈ 1.5× dash.)
  map.addLayer({
    id: "tr-trail-line",
    type: "symbol",
    source: TRAIL_SOURCE,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        3, 5,
        6, 40,
        11, 1280,
      ],
      "icon-image": "trail-dot",
      "icon-size": [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        3, 0.33 / 8,
        6, 0.33,
        11, 0.33 * 32,
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      // Orient each dash ALONG the route (symbol-placement:line auto-rotates to
      // the line direction); keep-upright off so it doesn't flip mid-curve.
      "icon-rotation-alignment": "map",
      "icon-keep-upright": false,
    },
  });

  if (!map.getSource(WAYPOINT_SOURCE)) {
    map.addSource(WAYPOINT_SOURCE, { type: "geojson", data: emptyCollection() });
  }
  map.addLayer({
    id: "tr-waypoint-glow",
    type: "circle",
    source: WAYPOINT_SOURCE,
    paint: { "circle-radius": 13, "circle-color": "#38bdf8", "circle-opacity": 0.2 },
  });
  map.addLayer({
    id: "tr-waypoint-dot",
    type: "circle",
    source: WAYPOINT_SOURCE,
    paint: {
      "circle-radius": 5,
      "circle-color": "#0ea5e9",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "tr-waypoint-label",
    type: "symbol",
    source: WAYPOINT_SOURCE,
    layout: {
      "text-field": ["get", "label"],
      // Large + bold so the place name stands out above all other map text.
      "text-size": 20,
      "text-offset": [0, 1.3],
      "text-anchor": "top",
      "text-font": ["Open Sans Bold", "Noto Sans Bold", "Open Sans Regular"],
      // Always show our place names, even over dense basemap labels.
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#0b1120",
      "text-halo-width": 2.4,
      "text-halo-blur": 0.4,
    },
  });

  // The moving vehicle — a single-feature symbol layer (NOT an HTML marker, so
  // it's painted into the WebGL buffer and captured on export).
  if (!map.getSource(VEHICLE_SOURCE)) {
    map.addSource(VEHICLE_SOURCE, { type: "geojson", data: emptyCollection() });
  }
  map.addLayer({
    id: "tr-vehicle-icon",
    type: "symbol",
    source: VEHICLE_SOURCE,
    layout: {
      "icon-image": ["get", "icon"],
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-size": 1.6,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
}

/**
 * Owns the MapLibre instance. Clicking the map appends a waypoint to the active
 * trip. Waypoints and path segments are mirrored into GeoJSON sources that this
 * component keeps in sync with the store.
 *
 * The map instance is published on `window.__trMap` so the playback hook and
 * (later) the export pipeline can drive the camera imperatively without prop
 * drilling a ref through the tree.
 */
export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);

  const activeTripId = useStore((s) => s.activeTripId);
  const addWaypoint = useStore((s) => s.addWaypoint);
  const { waypoints, orderedWaypoints, segments, trip } = useTripData();

  // Keep the latest values available to the (stable) click handler.
  const clickCtx = useRef({ activeTripId, addWaypoint, count: 0 });
  clickCtx.current = {
    activeTripId,
    addWaypoint,
    count: orderedWaypoints.length,
  };

  // --- Initialize the map once ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: trip ? styleUrlFor(trip.mapStyleId) : DEFAULT_MAP_STYLE,
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      pitch: INITIAL_VIEW.pitch,
      bearing: INITIAL_VIEW.bearing,
      // Required so the export pipeline can read pixels back off the canvas.
      canvasContextAttributes: { preserveDrawingBuffer: true },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    (window as unknown as { __trMap?: MlMap }).__trMap = map;

    // Bottom-right so it doesn't collide with the Export button (top-right).
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    map.on("load", () => addAppLayers(map));

    map.on("click", (e) => {
      const { activeTripId, addWaypoint, count } = clickCtx.current;
      if (!activeTripId) return;
      addWaypoint(activeTripId, {
        position: [e.lngLat.lng, e.lngLat.lat],
        label: `Stop ${count + 1}`,
      });
    });

    const onResize = () => map.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      map.remove();
      mapRef.current = null;
      delete (window as unknown as { __trMap?: MlMap }).__trMap;
    };
    // Intentionally run once; live data syncs in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Sync store -> GeoJSON sources whenever the trip changes ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const wpSource = map.getSource(WAYPOINT_SOURCE) as GeoJSONSource | undefined;
      if (!wpSource) return;
      wpSource.setData(waypointFeatures(orderedWaypoints));
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [orderedWaypoints, segments, waypoints, trip?.segmentIds]);

  // --- Swap basemap style when the trip's style id changes ---
  const styleId = trip?.mapStyleId;
  const appliedStyleRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleId) return;
    if (appliedStyleRef.current === undefined) {
      // First run: record the style the map was constructed with; don't reload.
      appliedStyleRef.current = styleId;
      return;
    }
    if (appliedStyleRef.current === styleId) return;
    appliedStyleRef.current = styleId;

    // setStyle wipes our custom sources/layers/images — re-add them once the new
    // basemap finishes loading, then re-sync the current data. diff:false forces
    // a full reload (the styles differ in kind: vector URL vs inline raster).
    const reapply = () => {
      if (!map.getLayer("tr-vehicle-icon")) addAppLayers(map);
      const wpSource = map.getSource(WAYPOINT_SOURCE) as GeoJSONSource | undefined;
      wpSource?.setData(waypointFeatures(orderedWaypoints));
    };
    // `style.load` fires once when the new style (and its sprite/glyphs) is
    // ready — the correct hook to re-add our wiped sources/layers/images.
    map.once("style.load", reapply);
    map.setStyle(styleUrlFor(styleId), { diff: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleId]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 h-full w-full"
      data-testid="map-canvas"
    />
  );
}

function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function waypointFeatures(
  ordered: ReturnType<typeof useTripData>["orderedWaypoints"],
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: ordered.map(
      (wp): Feature<Point> => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: wp.position },
        properties: { id: wp.id, label: wp.label },
      }),
    ),
  };
}

