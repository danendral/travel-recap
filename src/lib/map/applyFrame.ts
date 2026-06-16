import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection, LineString, Point } from "geojson";
import type { Id, LngLat, PathSegment, Trip, Waypoint } from "@/types";
import {
  type AnimationFrame,
  sliceAlongPolyline,
} from "@/lib/pathing/interpolate";

export const VEHICLE_SOURCE = "tr-vehicle";
export const TRAIL_SOURCE = "tr-trail";
export const WAYPOINT_SOURCE = "tr-waypoints";

/**
 * Single source of truth for pushing one animation frame onto the map: the
 * moving vehicle marker (a one-feature symbol source) and the progressive trail
 * (the drawn-so-far portion of completed + active segments).
 *
 * Called by BOTH the real-time playback rAF loop AND the scrubber AND (later)
 * the deterministic export loop — so all three render identically. It only
 * reads the store-provided trip/segments and writes to GeoJSON sources; it
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
  const trailSrc = map.getSource(TRAIL_SOURCE) as GeoJSONSource | undefined;
  if (!vehicleSrc || !trailSrc) return;

  vehicleSrc.setData(vehicleFeature(frame, segments, trip));
  trailSrc.setData(trailFeature(frame, trip, segments, waypoints));

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

function pathFor(
  seg: PathSegment | undefined,
  waypoints: Record<Id, Waypoint>,
): LngLat[] {
  if (!seg) return [];
  if (seg.geometry && seg.geometry.length > 1) return seg.geometry;
  const a = waypoints[seg.fromWaypointId]?.position;
  const b = waypoints[seg.toWaypointId]?.position;
  return a && b ? [a, b] : [];
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

/**
 * The drawn trail as ONE continuous polyline: every fully-completed segment
 * concatenated with the active segment cut at `segmentDrawProgress`.
 *
 * Concatenating into a single LineString (rather than one feature per segment)
 * is what keeps the dotted pattern uniform — MapLibre restarts a dash pattern
 * at the start of every feature, so multiple features would show inconsistent
 * dotting at segment joins (the "two different versions" the trail had between
 * the moving and arrived phases).
 */
function trailFeature(
  frame: AnimationFrame,
  trip: Trip,
  segments: Record<Id, PathSegment>,
  waypoints: Record<Id, Waypoint>,
): FeatureCollection<LineString> {
  const activeIdx = frame.activeSegmentIndex;
  // Segments fully behind us: during a segment that's its index; during a dwell
  // it's all segments up to the stop we're arriving at.
  const completedCount =
    activeIdx >= 0 ? activeIdx : Math.max(0, frame.arrivingIndex);

  const coords: LngLat[] = [];
  const pushSeg = (pts: LngLat[]) => {
    for (const p of pts) {
      // Avoid duplicating the shared vertex where one segment meets the next.
      const last = coords[coords.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) coords.push(p);
    }
  };

  for (let i = 0; i < completedCount; i++) {
    pushSeg(pathFor(segments[trip.segmentIds[i]], waypoints));
  }
  if (activeIdx >= 0) {
    const pts = pathFor(segments[trip.segmentIds[activeIdx]], waypoints);
    pushSeg(sliceAlongPolyline(pts, frame.segmentDrawProgress));
  }

  const features =
    coords.length >= 2
      ? [
          {
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates: coords },
            properties: {},
          },
        ]
      : [];

  return { type: "FeatureCollection", features };
}
