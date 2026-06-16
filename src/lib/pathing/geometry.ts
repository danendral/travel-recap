import { greatCircle } from "@turf/great-circle";
import { point } from "@turf/helpers";
import type { Feature, LineString, MultiLineString } from "geojson";
import type { LngLat, TravelMode } from "@/types";

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

/**
 * Fetches a road-following route between two points from the public OSRM demo
 * server, returning the path as [lng,lat] points. Resolves to `null` on any
 * failure so callers keep the straight-line fallback.
 *
 * The public OSRM server is fine for dev/low volume (1 req/s, non-commercial);
 * production should self-host. Routes are fetched once at edit time and cached
 * on the segment, so playback/export make zero requests.
 */
export async function fetchDriveRoute(
  from: LngLat,
  to: LngLat,
  signal?: AbortSignal,
): Promise<LngLat[] | null> {
  const coords = `${from[0]},${from[1]};${to[0]},${to[1]}`;
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    `?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code: string;
      routes?: Array<{ geometry: { coordinates: [number, number][] } }>;
    };
    if (data.code !== "Ok" || !data.routes?.length) return null;
    const line = data.routes[0].geometry.coordinates;
    if (line.length < 2) return null;
    return line.map((c) => [c[0], c[1]]);
  } catch {
    return null; // network error / abort → caller keeps the straight line
  }
}

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
