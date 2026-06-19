"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Point } from "geojson";
import { useStore } from "@/store";
import { DEFAULT_MAP_STYLE, INITIAL_VIEW, styleUrlFor } from "@/lib/constants";
import { useTripData } from "@/store/selectors";
import { ROUTE_SOURCE, VEHICLE_SOURCE, setRouteGeometry } from "@/lib/map/applyFrame";
import { buildRouteLine } from "@/lib/pathing/interpolate";
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
  await Promise.all(
    VEHICLE_ICONS.map(async (type) => {
      const id = `veh-${type}`;
      if (map.hasImage(id)) return;
      try {
        const data = await rasterizeSvg(`/vehicles/${type}.svg`, ICON_PX);
        if (!map.hasImage(id)) map.addImage(id, data, { pixelRatio: 2 });
      } catch {
        // Non-fatal: a missing icon just hides that vehicle, not the app.
      }
    }),
  );
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

  // The route trail is ONE stable polyline (the whole trip), set once per
  // trip-shape change — never grown per frame. Progress is revealed by moving a
  // `line-gradient` stop (see applyFrameToMap), so dashes never re-flow. This
  // is the fix for the "different route in each playback phase" artifact.
  //
  // `lineMetrics: true` is REQUIRED for the `line-progress` expression the
  // reveal gradient uses.
  if (!map.getSource(ROUTE_SOURCE)) {
    map.addSource(ROUTE_SOURCE, {
      type: "geojson",
      lineMetrics: true,
      data: emptyCollection(),
    });
  }
  // 1) Soft glow underlay — a wide, blurred, dim solid line along the whole
  //    route. Gives the trail a premium "lit" feel.
  map.addLayer({
    id: "tr-route-glow",
    type: "line",
    source: ROUTE_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#38bdf8",
      "line-width": 9,
      "line-opacity": 0.16,
      "line-blur": 6,
    },
  });
  // 2) Upcoming track — dim dashed line over the FULL route, so viewers see
  //    where the trip is heading. Constant; never animated.
  map.addLayer({
    id: "tr-route-upcoming",
    type: "line",
    source: ROUTE_SOURCE,
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: {
      "line-color": "#64748b",
      "line-width": 2.5,
      "line-opacity": 0.45,
      "line-dasharray": [1.6, 1.8],
    },
  });
  // 3) Traveled — bright dashed line on the SAME stable geometry, clipped to
  //    the vehicle via a `line-gradient` alpha ramp (set per frame). Identical
  //    dash array to the upcoming layer so the two read as one continuous
  //    dashed route, just brighter behind the vehicle.
  map.addLayer({
    id: "tr-route-traveled",
    type: "line",
    source: ROUTE_SOURCE,
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: {
      "line-width": 3.5,
      "line-dasharray": [1.6, 1.8],
      // Initial gradient (nothing revealed yet); applyFrameToMap updates it.
      "line-gradient": [
        "interpolate",
        ["linear"],
        ["line-progress"],
        0,
        "rgba(125,211,252,0)",
        1,
        "rgba(125,211,252,0)",
      ],
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
  const removeWaypoint = useStore((s) => s.removeWaypoint);
  const { waypoints, orderedWaypoints, segments, trip } = useTripData();

  // Keep the latest values available to the (stable) click handler.
  const clickCtx = useRef({ activeTripId, addWaypoint, removeWaypoint, count: 0 });
  clickCtx.current = {
    activeTripId,
    addWaypoint,
    removeWaypoint,
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

    // The two circle layers that make up a waypoint marker; hovering/clicking
    // either should target the underlying waypoint.
    const WAYPOINT_LAYERS = ["tr-waypoint-dot", "tr-waypoint-glow"];

    // A tiny "click to remove" tooltip shown while hovering a waypoint. It's a
    // DOM popup (not a GL layer) — fine here because it's a transient UI hint
    // that never needs to appear in the exported video.
    const removeHint = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 16,
      className: "tr-remove-hint",
    });

    const onEnter = (e: maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = "pointer";
      const feature = e.features?.[0];
      const id = feature?.properties?.id as Id | undefined;
      if (!id) return;
      // Anchor the hint to the WAYPOINT's own coordinates, not the cursor, so it
      // sits steadily above the dot and doesn't drift as the pointer moves around
      // inside the (fairly large) hit area.
      const geom = feature?.geometry;
      const at: [number, number] =
        geom?.type === "Point"
          ? (geom.coordinates as [number, number])
          : [e.lngLat.lng, e.lngLat.lat];
      removeHint
        .setLngLat(at)
        .setHTML("<span>Click to remove</span>")
        .addTo(map);
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
      removeHint.remove();
    };
    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const { activeTripId, removeWaypoint } = clickCtx.current;
      const id = e.features?.[0]?.properties?.id as Id | undefined;
      if (!activeTripId || !id) return;
      removeWaypoint(activeTripId, id);
      removeHint.remove();
      map.getCanvas().style.cursor = "";
    };

    // Register the waypoint hover/click handlers ONCE per map. Pass BOTH circle
    // layers as a single array so MapLibre treats them as one combined hit area
    // and fires each handler once — binding per-layer in a loop would double-fire
    // `onClick` (removing twice) and flicker the hint as the cursor crosses from
    // the dot to its surrounding glow. No `mousemove` handler: the hint is pinned
    // to the dot in `onEnter` and intentionally stays put as the cursor moves.
    //
    // These are MapLibre *delegated* listeners (bound to layer ids), stored on
    // the Map instance — NOT on the style — so they survive `setStyle()` and keep
    // working after a basemap swap. Re-registering them in the style-swap reapply
    // path would double-fire every handler, so deliberately don't.
    map.on("mouseenter", WAYPOINT_LAYERS, onEnter);
    map.on("mouseleave", WAYPOINT_LAYERS, onLeave);
    map.on("click", WAYPOINT_LAYERS, onClick);

    map.on("load", () => addAppLayers(map));

    map.on("click", (e) => {
      // A click that landed on a waypoint is a "remove" (handled by onClick on
      // the layer) — don't also drop a new waypoint on top of it. Detect that by
      // querying the rendered waypoint layers at the click point, which is
      // order-independent (no reliance on which click handler fires first).
      // Only query layers that currently exist: queryRenderedFeatures throws on
      // an unknown layer id, and the waypoint layers are briefly absent mid
      // `setStyle()`.
      const presentLayers = WAYPOINT_LAYERS.filter((l) => map.getLayer(l));
      if (presentLayers.length > 0) {
        const onWaypoint = map.queryRenderedFeatures(e.point, {
          layers: presentLayers,
        });
        if (onWaypoint.length > 0) return;
      }

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
      // Set the whole-route polyline ONCE per trip-shape change (this effect's
      // deps). Never per frame — that's what keeps the dashed trail seamless.
      if (trip) setRouteGeometry(map, buildRouteLine(trip, segments, waypoints));
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [orderedWaypoints, segments, waypoints, trip, trip?.segmentIds]);

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
      // Re-set the route line — setStyle() wiped the source.
      if (trip) setRouteGeometry(map, buildRouteLine(trip, segments, waypoints));
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

