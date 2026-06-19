import { greatCircle } from "@turf/great-circle";
import { point } from "@turf/helpers";
import type { Feature, LineString, MultiLineString } from "geojson";
import type { LngLat, TravelMode, VehicleType } from "@/types";
import { OSRM_BASE } from "@/lib/constants";

/**
 * Resolves the INITIAL drawable geometry for a segment, synchronously.
 *
 * - flight → a curved great-circle arc (the signature look).
 * - drive  → a straight line as an immediate placeholder; it's then upgraded to
 *   a road-following route asynchronously via {@link fetchDriveRoute}.
 *
 * Pure + synchronous so neither playback nor the export loop ever recomputes it.
 */
export function resolveSegmentGeometry(
  from: LngLat,
  to: LngLat,
  mode: TravelMode,
): LngLat[] {
  if (mode === "flight") {
    return greatCircleArc(from, to);
  }
  return [from, to];
}

/** OSRM routing profiles we support. Car follows roads; walk follows paths. */
export type RoutingProfile = "driving" | "foot";

/**
 * The OSRM profile for a vehicle, or `null` for modes that DON'T snap to a
 * routed network: plane (great-circle arc), train/boat (free rail/sea routing
 * is unreliable, so they keep a smooth straight/great-circle line).
 */
export function routingProfileFor(v: VehicleType): RoutingProfile | null {
  if (v === "car") return "driving";
  if (v === "walk") return "foot";
  return null;
}

const ROUTE_TIMEOUT_MS = 6000;

/**
 * Fetches a network-following route between two points from OSRM, returning the
 * path as [lng,lat] points, or `null` on failure (callers keep the straight
 * line and mark the leg "fallback"/approximate).
 *
 * Resilient: a per-attempt timeout (the public demo server can hang) and ONE
 * retry on a transient failure (network error or 5xx). A genuine "no route"
 * answer is NOT retried. Routes are fetched once at edit time and cached on the
 * segment, so playback/export make zero requests.
 */
export async function fetchRoute(
  from: LngLat,
  to: LngLat,
  profile: RoutingProfile,
  signal?: AbortSignal,
): Promise<LngLat[] | null> {
  const coords = `${from[0]},${from[1]};${to[0]},${to[1]}`;
  const url =
    `${OSRM_BASE}/route/v1/${profile}/${coords}` +
    `?overview=full&geometries=geojson`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => ctrl.abort(), ROUTE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        if (res.status >= 500 && attempt === 0) continue; // transient — retry
        return null;
      }
      const data = (await res.json()) as {
        code: string;
        routes?: Array<{ geometry: { coordinates: [number, number][] } }>;
      };
      if (data.code !== "Ok" || !data.routes?.length) return null; // no route
      const line = data.routes[0].geometry.coordinates;
      if (line.length < 2) return null;
      return line.map((c) => [c[0], c[1]]);
    } catch {
      if (signal?.aborted) return null; // genuine cancel by caller
      if (attempt === 0) continue; // transient (network/timeout) — retry once
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  return null;
}

/** @deprecated use `fetchRoute(from, to, "driving", signal)`. */
export const fetchDriveRoute = (
  from: LngLat,
  to: LngLat,
  signal?: AbortSignal,
): Promise<LngLat[] | null> => fetchRoute(from, to, "driving", signal);

/**
 * Great-circle arc between two points as a single continuous polyline.
 *
 * turf returns a MultiLineString when the arc crosses the antimeridian (180°);
 * rendering that directly makes the line streak across the whole map. We
 * instead "unwrap" longitudes into a monotonic series (adding/subtracting 360
 * whenever a step jumps more than 180°). MapLibre renders longitudes outside
 * [-180,180] correctly, so the arc stays a single clean curve and
 * sampleAlongPolyline / sliceAlongPolyline work without seam glitches.
 */
export function greatCircleArc(from: LngLat, to: LngLat, npoints = 64): LngLat[] {
  const arc = greatCircle(point(from), point(to), {
    npoints,
  }) as Feature<LineString | MultiLineString>;

  const raw: LngLat[] = [];
  if (arc.geometry.type === "LineString") {
    for (const c of arc.geometry.coordinates) raw.push([c[0], c[1]]);
  } else {
    // MultiLineString (antimeridian split) — concatenate the parts back.
    for (const line of arc.geometry.coordinates) {
      for (const c of line) raw.push([c[0], c[1]]);
    }
  }

  return unwrapLongitudes(raw);
}

/**
 * Makes a longitude series continuous by removing ±360° discontinuities, so a
 * path crossing the antimeridian reads as one smooth curve rather than wrapping
 * back across the map.
 */
export function unwrapLongitudes(points: LngLat[]): LngLat[] {
  if (points.length === 0) return points;
  const out: LngLat[] = [[points[0][0], points[0][1]]];
  let offset = 0;
  for (let i = 1; i < points.length; i++) {
    const prevLng = points[i - 1][0];
    const lng = points[i][0];
    const delta = lng - prevLng;
    if (delta > 180) offset -= 360;
    else if (delta < -180) offset += 360;
    out.push([lng + offset, points[i][1]]);
  }
  return out;
}
