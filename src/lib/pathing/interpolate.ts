import { bearing as turfBearing } from "@turf/bearing";
import { distance as turfDistance } from "@turf/distance";
import { point } from "@turf/helpers";
import type { LngLat, PathSegment, Trip, Waypoint, Id } from "@/types";
import { DEFAULT_DWELL_MS } from "@/lib/constants";

/**
 * Pure animation math: full camera + vehicle state as a function of elapsed
 * time `t`.
 *
 * CRITICAL: preview (real-time rAF loop) and export (deterministic setNow loop)
 * MUST both drive the scene through `sampleAnimation`. If they diverge, the
 * exported MP4 won't match what the user previewed. Keep everything here pure.
 */

/** Cubic ease-in-out — smooth acceleration/deceleration along a leg. */
export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Linear interpolation between two [lng, lat] points. */
export function lerpLngLat(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export interface AnimationFrame {
  /** Camera target — follows the vehicle during a segment, the stop on dwell. */
  center: LngLat;
  zoom: number;
  /** Camera bearing (0 = north-up). North-up for MVP; the icon rotates anyway. */
  bearing: number;
  /** Camera pitch in degrees (0 = top-down). Tilts during flight for drama. */
  pitch: number;

  /** Vehicle marker position, or null when there's nothing to show. */
  vehiclePos: LngLat | null;
  /** Vehicle heading in degrees, turf convention (clockwise from north). */
  vehicleBearing: number;
  /** False during dwell (parked at a stop) — hides the moving icon. */
  vehicleVisible: boolean;

  /** Index of the segment being traversed, or -1 while dwelling. */
  activeSegmentIndex: number;
  /** 0..1 of the active segment's path that has been drawn (the trail). */
  segmentDrawProgress: number;

  /** Index of the waypoint we're arriving at, and its label-reveal progress. */
  arrivingIndex: number;
  arriveProgress: number;

  /** Final overview beat — draw the ENTIRE route trail, not just up to now. */
  showFullRoute: boolean;

  /**
   * 0..1 fraction of the TOTAL route distance traveled so far — drives the
   * trail reveal gradient. Monotonically non-decreasing across every phase
   * (dwell → segment → dwell → … → overview), which is the seamlessness
   * guarantee: the reveal can never jump back or skip at a phase boundary.
   */
  routeProgress: number;

  /**
   * How many waypoints (from the start) have been ARRIVED at — their labels are
   * revealed. A stop counts as visited only once the vehicle reaches it, so the
   * destination of an in-progress leg stays hidden until arrival.
   */
  visitedCount: number;
}

export interface Timeline {
  phases: Array<{
    kind: "dwell" | "segment" | "overview";
    index: number; // waypoint index (dwell) | segment index (segment)
    startMs: number;
    endMs: number;
  }>;
  totalMs: number;
}

// Camera zoom is the SAME at every waypoint (dwell endpoints and segment
// endpoints) so there's no zoom jump at phase boundaries — the flight reads as
// one continuous shot. Mid-leg the camera dollies out (distance-scaled) then
// back in to this same value. Tuned to stay zoomed-in fairly close.
const STOP_ZOOM = 7;

/** Final beat: hold, then pull out to frame the whole route. */
const OVERVIEW_MS = 2600;

/**
 * Builds the dwell/segment phase timeline for a trip:
 * dwell(wp0) → segment(0) → dwell(wp1) → segment(1) → ... → dwell(wpN).
 */
export function buildTimeline(
  trip: Trip,
  segments: Record<Id, PathSegment>,
): Timeline {
  const phases: Timeline["phases"] = [];
  let cursor = 0;
  const wpCount = trip.waypointIds.length;

  for (let i = 0; i < wpCount; i++) {
    phases.push({
      kind: "dwell",
      index: i,
      startMs: cursor,
      endMs: cursor + DEFAULT_DWELL_MS,
    });
    cursor += DEFAULT_DWELL_MS;

    if (i < wpCount - 1) {
      const seg = segments[trip.segmentIds[i]];
      const dur = seg?.durationMs ?? 0;
      phases.push({
        kind: "segment",
        index: i,
        startMs: cursor,
        endMs: cursor + dur,
      });
      cursor += dur;
    }
  }

  // Final overview beat: once every stop is visited, pull out to reveal the
  // whole route. Only meaningful with an actual route (2+ stops).
  if (wpCount >= 2) {
    phases.push({
      kind: "overview",
      index: wpCount - 1,
      startMs: cursor,
      endMs: cursor + OVERVIEW_MS,
    });
    cursor += OVERVIEW_MS;
  }

  return { phases, totalMs: cursor };
}

/**
 * The whole trip as ONE continuous polyline: every segment's cached geometry
 * concatenated, de-duping the shared vertex where one segment meets the next.
 *
 * Stable for a given trip shape — the trail layer's geometry is set from this
 * ONCE (not per frame), so MapLibre never re-lays the dash pattern. That is the
 * fix for the "different route in each playback phase" artifact: the old trail
 * grew its geometry every frame, which re-flowed the dashes.
 */
export function buildRouteLine(
  trip: Trip,
  segments: Record<Id, PathSegment>,
  waypoints: Record<Id, Waypoint>,
): LngLat[] {
  const coords: LngLat[] = [];
  const push = (pts: LngLat[]) => {
    for (const p of pts) {
      const last = coords[coords.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) coords.push(p);
    }
  };
  for (const sid of trip.segmentIds) {
    const seg = segments[sid];
    const from = waypoints[seg?.fromWaypointId ?? ""];
    const to = waypoints[seg?.toWaypointId ?? ""];
    push(segmentPath(seg, from, to));
  }
  return coords.length >= 2 ? coords : [];
}

/**
 * Planar length of each segment's drawn path + the total, used to map elapsed
 * time onto a single `routeProgress` scalar (fraction of the WHOLE route
 * distance covered). Lengths are computed from the same cached geometry the
 * trail draws, so progress lines up with what's on screen.
 */
function routeLengths(
  trip: Trip,
  segments: Record<Id, PathSegment>,
  waypoints: Record<Id, Waypoint>,
): { perSegment: number[]; total: number } {
  const perSegment = trip.segmentIds.map((sid) => {
    const seg = segments[sid];
    const pts = segmentPath(
      seg,
      waypoints[seg?.fromWaypointId ?? ""],
      waypoints[seg?.toWaypointId ?? ""],
    );
    return cumulativeLengths(pts).total;
  });
  return { perSegment, total: perSegment.reduce((a, b) => a + b, 0) };
}

/** Geometry for a segment: cached arc/route, else a straight from→to line. */
function segmentPath(
  seg: PathSegment | undefined,
  from: Waypoint | undefined,
  to: Waypoint | undefined,
): LngLat[] {
  if (seg?.geometry && seg.geometry.length > 1) return seg.geometry;
  const a = from?.position;
  const b = to?.position;
  if (!a || !b) return [];
  return [a, b];
}

/** Heading at fraction `f` along a path, with look-behind fallback at the end. */
function bearingAlong(path: LngLat[], f: number): number {
  if (path.length < 2) return 0;
  const ahead = Math.min(1, f + 0.01);
  const behind = Math.max(0, f - 0.01);
  let a = sampleAlongPolyline(path, behind);
  let b = sampleAlongPolyline(path, ahead);
  // Degenerate (identical points) → widen the window once.
  if (a[0] === b[0] && a[1] === b[1]) {
    a = sampleAlongPolyline(path, Math.max(0, f - 0.05));
    b = sampleAlongPolyline(path, Math.min(1, f + 0.05));
  }
  if (a[0] === b[0] && a[1] === b[1]) return 0;
  return turfBearing(point(a), point(b));
}

/**
 * Distance-scaled mid-leg camera pullback (longer legs pull back more). Kept
 * gentle so the camera stays zoomed-in close to the vehicle while commuting;
 * a long transoceanic leg pulls out at most ~2 zoom levels from STOP_ZOOM.
 */
function pullbackFor(from: LngLat, to: LngLat): number {
  const km = turfDistance(point(from), point(to), { units: "kilometers" });
  return Math.min(2, km / 4000);
}

/**
 * Resolves the full camera + vehicle state at time `tMs`. Pure — depends only
 * on its inputs.
 */
export function sampleAnimation(
  tMs: number,
  trip: Trip,
  waypoints: Record<Id, Waypoint>,
  segments: Record<Id, PathSegment>,
  timeline: Timeline,
): AnimationFrame {
  const wpAt = (i: number) => waypoints[trip.waypointIds[i]];

  const empty: AnimationFrame = {
    center: [0, 0],
    zoom: 1.4,
    bearing: 0,
    pitch: 0,
    vehiclePos: null,
    vehicleBearing: 0,
    vehicleVisible: false,
    activeSegmentIndex: -1,
    segmentDrawProgress: 0,
    arrivingIndex: 0,
    arriveProgress: 0,
    showFullRoute: false,
    routeProgress: 0,
    visitedCount: 0,
  };
  if (timeline.phases.length === 0) return empty;

  // Distance of each segment + the whole route, so elapsed time maps onto a
  // single fraction-of-the-whole-route scalar that's continuous across phases.
  const { perSegment, total: routeTotal } = routeLengths(
    trip,
    segments,
    waypoints,
  );
  const lengthBefore = (segIndex: number) =>
    perSegment.slice(0, Math.max(0, segIndex)).reduce((a, b) => a + b, 0);
  const fractionFor = (dist: number) =>
    routeTotal > 0 ? Math.max(0, Math.min(1, dist / routeTotal)) : 0;

  const clamped = Math.max(0, Math.min(tMs, timeline.totalMs));
  const phase =
    timeline.phases.find((p) => clamped >= p.startMs && clamped < p.endMs) ??
    timeline.phases[timeline.phases.length - 1];

  if (phase.kind === "dwell") {
    const wp = wpAt(phase.index);
    const span = phase.endMs - phase.startMs || 1;
    const local = (clamped - phase.startMs) / span;

    // Carry the heading from the segment that led into this stop (if any) so
    // the parked icon doesn't snap to north.
    let parkedBearing = 0;
    if (phase.index > 0) {
      const segIn = segments[trip.segmentIds[phase.index - 1]];
      const path = segmentPath(
        segIn,
        wpAt(phase.index - 1),
        wpAt(phase.index),
      );
      parkedBearing = bearingAlong(path, 1);
    }

    void local;
    // Dwell uses the SAME zoom/bearing/pitch the adjacent segments use at this
    // waypoint (STOP_ZOOM, north-up, pitch 0). Because segment endpoints
    // resolve to exactly these values too, the camera transitions in/out of the
    // dwell with no jump — one continuous shot, no per-stop cut.
    return {
      center: wp?.position ?? [0, 0],
      zoom: wp?.cameraHint?.zoom ?? STOP_ZOOM,
      bearing: 0,
      pitch: 0,
      vehiclePos: wp?.position ?? null,
      vehicleBearing: parkedBearing,
      vehicleVisible: false,
      activeSegmentIndex: -1,
      segmentDrawProgress: 0,
      arrivingIndex: phase.index,
      arriveProgress: Math.min(1, local * 2),
      showFullRoute: false,
      // Parked at stop phase.index → the route up to that stop is fully drawn.
      routeProgress: fractionFor(lengthBefore(phase.index)),
      // Arrived at this stop → stops 0..phase.index are visited.
      visitedCount: phase.index + 1,
    };
  }

  if (phase.kind === "overview") {
    // Pull out from the last stop to a framing that fits the whole route.
    const span = phase.endMs - phase.startMs || 1;
    const local = (clamped - phase.startMs) / span;
    const all = trip.waypointIds.map((id) => waypoints[id]?.position).filter(Boolean) as LngLat[];
    const fit = fitBounds(all);
    const last = wpAt(trip.waypointIds.length - 1)?.position ?? fit.center;

    // Hold briefly on the last stop, then ease out to the overview.
    const t = easeInOutCubic(Math.max(0, Math.min(1, (local - 0.15) / 0.85)));
    return {
      center: lerpLngLat(last, fit.center, t),
      zoom: STOP_ZOOM + (fit.zoom - STOP_ZOOM) * t,
      bearing: 0,
      pitch: 0,
      vehiclePos: last,
      vehicleBearing: 0,
      vehicleVisible: false,
      activeSegmentIndex: -1,
      segmentDrawProgress: 1,
      arrivingIndex: trip.waypointIds.length - 1,
      arriveProgress: 1,
      showFullRoute: true,
      routeProgress: 1,
      visitedCount: trip.waypointIds.length,
    };
  }

  // --- Segment traversal ---
  const from = wpAt(phase.index);
  const to = wpAt(phase.index + 1);
  const seg = segments[trip.segmentIds[phase.index]];
  const path = segmentPath(seg, from, to);

  const span = phase.endMs - phase.startMs || 1;
  const raw = (clamped - phase.startMs) / span;
  const eased = easeInOutCubic(raw);

  const pos = path.length
    ? sampleAlongPolyline(path, eased)
    : (from?.position ?? [0, 0]);
  const vehicleBearing = bearingAlong(path, eased);

  // Endpoints resolve to STOP_ZOOM (matching the dwell on either side), so zoom
  // is continuous across boundaries. Mid-leg it dollies out by a distance-scaled
  // amount, then back in. sin(raw·π) is 0 at both ends → no jump.
  const fromZoom = from?.cameraHint?.zoom ?? STOP_ZOOM;
  const toZoom = to?.cameraHint?.zoom ?? STOP_ZOOM;
  const pullback = from && to ? pullbackFor(from.position, to.position) : 0;
  const zoom =
    fromZoom + (toZoom - fromZoom) * eased - Math.sin(raw * Math.PI) * pullback;

  // Tilt rises then falls across the leg; 0 at both ends so it joins the
  // (pitch 0) dwells with no jump. Moderate so fast legs aren't disorienting.
  const pitch = 28 * Math.sin(raw * Math.PI);
  return {
    center: pos, // camera follows the vehicle — the fix for "just zoom in/out"
    zoom,
    bearing: 0,
    pitch,
    vehiclePos: pos,
    vehicleBearing,
    vehicleVisible: true,
    activeSegmentIndex: phase.index,
    segmentDrawProgress: eased,
    arrivingIndex: phase.index + 1,
    arriveProgress: 0,
    showFullRoute: false,
    routeProgress: fractionFor(
      lengthBefore(phase.index) + (perSegment[phase.index] ?? 0) * eased,
    ),
    // En route from stop phase.index → phase.index+1: the destination is NOT
    // yet visited, so only stops 0..phase.index are revealed.
    visitedCount: phase.index + 1,
  };
}

/**
 * Computes a center + zoom that frames all the given points (the whole route)
 * with padding. Approximates MapLibre's fitBounds using the longitude/latitude
 * span at the equator; good enough for the final overview beat.
 */
export function fitBounds(points: LngLat[]): { center: LngLat; zoom: number } {
  if (points.length === 0) return { center: [0, 0], zoom: 1.5 };

  // Unwrap longitudes so a route crossing the antimeridian (e.g. Tokyo→LA)
  // measures the SHORT span across the Pacific, not the long way round. Then
  // normalize the center longitude back into [-180, 180].
  const unwrapped: number[] = [points[0][0]];
  let offset = 0;
  for (let i = 1; i < points.length; i++) {
    const d = points[i][0] - points[i - 1][0];
    if (d > 180) offset -= 360;
    else if (d < -180) offset += 360;
    unwrapped.push(points[i][0] + offset);
  }

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (let i = 0; i < points.length; i++) {
    minLng = Math.min(minLng, unwrapped[i]);
    maxLng = Math.max(maxLng, unwrapped[i]);
    minLat = Math.min(minLat, points[i][1]);
    maxLat = Math.max(maxLat, points[i][1]);
  }

  let centerLng = (minLng + maxLng) / 2;
  centerLng = ((centerLng + 180) % 360 + 360) % 360 - 180; // wrap to [-180,180]
  const center: LngLat = [centerLng, (minLat + maxLat) / 2];

  const lngSpan = Math.max(maxLng - minLng, 0.01);
  const latSpan = Math.max(maxLat - minLat, 0.01);
  // World is 360° at zoom 0; halve the visible span per zoom level. Use the
  // larger span (×1.5 for padding) to ensure everything fits with margin.
  const span = Math.max(lngSpan, latSpan * 1.6) * 1.5;
  const zoom = Math.max(0.8, Math.min(STOP_ZOOM, Math.log2(360 / span)));
  return { center, zoom };
}

/** Per-point cumulative lengths of a polyline (planar; good enough for sampling). */
function cumulativeLengths(points: LngLat[]) {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(
      points[i + 1][0] - points[i][0],
      points[i + 1][1] - points[i][1],
    );
    lengths.push(d);
    total += d;
  }
  return { lengths, total };
}

/** Samples a point at fraction `t` (0..1) along a polyline by segment length. */
export function sampleAlongPolyline(points: LngLat[], t: number): LngLat {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];
  const { lengths, total } = cumulativeLengths(points);
  if (total === 0) return points[0];

  const target = Math.max(0, Math.min(1, t)) * total;
  let acc = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (acc + lengths[i] >= target) {
      const local = lengths[i] === 0 ? 0 : (target - acc) / lengths[i];
      return lerpLngLat(points[i], points[i + 1], local);
    }
    acc += lengths[i];
  }
  return points[points.length - 1];
}

/**
 * Returns the prefix of a polyline drawn up to fraction `t` (0..1): all whole
 * points before the cut, plus the interpolated cut point. Used for the trail
 * that draws behind the moving vehicle.
 */
export function sliceAlongPolyline(points: LngLat[], t: number): LngLat[] {
  if (points.length <= 1) return points.slice();
  const clampedT = Math.max(0, Math.min(1, t));
  if (clampedT <= 0) return [points[0]];
  if (clampedT >= 1) return points.slice();

  const { lengths, total } = cumulativeLengths(points);
  if (total === 0) return [points[0]];

  const target = clampedT * total;
  const out: LngLat[] = [points[0]];
  let acc = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (acc + lengths[i] >= target) {
      const local = lengths[i] === 0 ? 0 : (target - acc) / lengths[i];
      out.push(lerpLngLat(points[i], points[i + 1], local));
      return out;
    }
    out.push(points[i + 1]);
    acc += lengths[i];
  }
  return out;
}
