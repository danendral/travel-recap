import type {
  Map as MlMap,
  GeoJSONSource,
  ExpressionSpecification,
} from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import type { Id, LngLat, PathSegment, Trip, Waypoint } from "@/types";
import type { AnimationFrame } from "@/lib/pathing/interpolate";

export const VEHICLE_SOURCE = "tr-vehicle";
export const ROUTE_SOURCE = "tr-route";
export const WAYPOINT_SOURCE = "tr-waypoints";

// The two revealed layers: a bright solid core + a soft glow underlay. Each is
// drawn only up to the vehicle (the not-yet-traveled route is NOT shown), via a
// per-frame line-gradient that's opaque to `routeProgress` then transparent.
const ROUTE_LAYERS: { id: string; color: string; clear: string }[] = [
  { id: "tr-route-glow", color: "rgba(56,189,248,0.45)", clear: "rgba(56,189,248,0)" },
  { id: "tr-route-traveled", color: "#7dd3fc", clear: "rgba(125,211,252,0)" },
];

/**
 * The reveal gradient for one layer: solid `color` up to `progress`, a short
 * fade, then transparent. Stops are kept strictly ascending — MapLibre rejects
 * the whole gradient otherwise (which would hide the trail entirely).
 */
function revealGradient(
  color: string,
  clear: string,
  progress: number,
  full: boolean,
): ExpressionSpecification {
  if (full) {
    return ["interpolate", ["linear"], ["line-progress"], 0, color, 1, color];
  }
  const FADE = 0.012;
  const p = Math.max(FADE, Math.min(1 - 2 * FADE, progress));
  return [
    "interpolate",
    ["linear"],
    ["line-progress"],
    0,
    color,
    p,
    color,
    p + FADE,
    clear,
    1,
    clear,
  ];
}

/**
 * Sets the WHOLE-route polyline as the trail source's geometry. Called ONCE per
 * trip-shape change (add/remove/reorder/reroute) — never per animation frame.
 * Keeping the geometry constant during playback is what makes the dashed trail
 * seamless: MapLibre only re-lays a dash pattern when the feature changes, so a
 * fixed line keeps every dash pinned in the moving, arrived, and next-leg
 * phases alike.
 */
export function setRouteGeometry(map: MlMap, line: LngLat[]): void {
  const src = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(
    line.length >= 2
      ? {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "LineString", coordinates: line },
              properties: {},
            },
          ],
        }
      : emptyCollection(),
  );
}

/**
 * Single source of truth for pushing one animation frame onto the map: the
 * moving vehicle marker, the trail REVEAL (a line-gradient on the stable route
 * line), and the arrived-stop labels.
 *
 * Called by the playback rAF loop, the scrubber, AND (later) the deterministic
 * export loop — so all three render identically. It only sets the vehicle/
 * waypoint GeoJSON and one paint property; it never rebuilds route geometry and
 * never triggers React renders.
 */
export function applyFrameToMap(
  map: MlMap,
  frame: AnimationFrame,
  trip: Trip,
  segments: Record<Id, PathSegment>,
  waypoints: Record<Id, Waypoint>,
) {
  const vehicleSrc = map.getSource(VEHICLE_SOURCE) as GeoJSONSource | undefined;
  if (!vehicleSrc) return;

  vehicleSrc.setData(vehicleFeature(frame, segments, trip));

  // Reveal each route layer up to the vehicle by moving its gradient — NO
  // geometry change, so the line never re-flows. The not-yet-traveled route
  // stays transparent; the final overview beat draws the whole route solid.
  for (const layer of ROUTE_LAYERS) {
    if (!map.getLayer(layer.id)) continue;
    map.setPaintProperty(
      layer.id,
      "line-gradient",
      revealGradient(layer.color, layer.clear, frame.routeProgress, frame.showFullRoute),
    );
  }

  // Reveal labels only for stops that have been arrived at.
  const wpSrc = map.getSource(WAYPOINT_SOURCE) as GeoJSONSource | undefined;
  wpSrc?.setData(waypointFeatures(trip, waypoints, frame.visitedCount));
}

/**
 * Waypoint dots + labels. Dots show for every stop; the `label` is only filled
 * in for stops whose index is below `visitedCount` (i.e. already arrived at) —
 * the empty-string layers stay invisible until then.
 */
export function waypointFeatures(
  trip: Trip,
  waypoints: Record<Id, Waypoint>,
  visitedCount: number,
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: trip.waypointIds
      .map((id, i) => {
        const wp = waypoints[id];
        if (!wp) return null;
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: wp.position },
          properties: {
            id: wp.id,
            label: i < visitedCount ? wp.label : "",
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null),
  };
}

function vehicleFeature(
  frame: AnimationFrame,
  segments: Record<Id, PathSegment>,
  trip: Trip,
): FeatureCollection<Point> {
  if (!frame.vehicleVisible || !frame.vehiclePos) {
    return { type: "FeatureCollection", features: [] };
  }
  const seg =
    frame.activeSegmentIndex >= 0
      ? segments[trip.segmentIds[frame.activeSegmentIndex]]
      : undefined;
  const icon = `veh-${seg?.vehicleType ?? "plane"}`;

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: frame.vehiclePos },
        properties: { icon, bearing: frame.vehicleBearing },
      },
    ],
  };
}

function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
