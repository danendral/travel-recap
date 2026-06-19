import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import type { Id, LngLat, PathSegment, Trip, Waypoint } from "@/types";
import type { AnimationFrame } from "@/lib/pathing/interpolate";

export const VEHICLE_SOURCE = "tr-vehicle";
export const ROUTE_SOURCE = "tr-route";
export const WAYPOINT_SOURCE = "tr-waypoints";

// Trail palette. Traveled = bright cyan; the reveal gradient fades to fully
// transparent past the vehicle so only the dim "upcoming" layer shows ahead.
const TRAVELED_COLOR = "#7dd3fc";
const TRAVELED_CLEAR = "rgba(125,211,252,0)";

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

  // Reveal the traveled portion by moving a single gradient stop — NO geometry
  // change. Everything up to routeProgress is bright; past it is transparent
  // (the dim full-length "upcoming" layer shows through). Clamp off the exact
  // 0/1 ends so the interpolation stays well-formed.
  if (map.getLayer("tr-route-traveled")) {
    const p = Math.max(0.0001, Math.min(0.9999, frame.routeProgress));
    map.setPaintProperty("tr-route-traveled", "line-gradient", [
      "interpolate",
      ["linear"],
      ["line-progress"],
      0,
      TRAVELED_COLOR,
      p,
      TRAVELED_COLOR,
      Math.min(1, p + 0.001),
      TRAVELED_CLEAR,
      1,
      TRAVELED_CLEAR,
    ]);
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
