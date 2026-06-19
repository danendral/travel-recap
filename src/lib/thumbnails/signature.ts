import type { Id, Trip, Waypoint } from "@/types";

/**
 * A cache key for a trip's thumbnail: a cheap hash of the ordered waypoint
 * positions + the map style. The cached image is regenerated only when this
 * changes, so editing a route invalidates its (now-stale) thumbnail while an
 * unchanged route serves the cached one.
 */
export function thumbnailSignature(
  trip: Trip,
  waypoints: Record<Id, Waypoint>,
): string {
  const coords = trip.waypointIds
    .map((id) => {
      const p = waypoints[id]?.position;
      // Round to ~11m so trivial float noise doesn't bust the cache.
      return p ? `${p[0].toFixed(4)},${p[1].toFixed(4)}` : "_";
    })
    .join(";");
  return hash(`${trip.mapStyleId}|${coords}`);
}

/** djb2 — small, fast, dependency-free; good enough for a cache key. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}
