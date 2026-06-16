import { useStore } from "@/store";
import type { Id, PathSegment, Waypoint, Trip } from "@/types";

interface TripData {
  trip: Trip | null;
  waypoints: Record<Id, Waypoint>;
  segments: Record<Id, PathSegment>;
  orderedWaypoints: Waypoint[];
}

/**
 * Convenience hook bundling the active trip plus its ordered waypoints. Each
 * underlying slice is selected individually so components only re-render when
 * the data they actually use changes.
 */
export function useTripData(): TripData {
  const activeTripId = useStore((s) => s.activeTripId);
  const trip = useStore((s) =>
    s.activeTripId ? (s.trips[s.activeTripId] ?? null) : null,
  );
  const waypoints = useStore((s) => s.waypoints);
  const segments = useStore((s) => s.segments);

  const orderedWaypoints = trip
    ? trip.waypointIds.map((id) => waypoints[id]).filter(Boolean)
    : [];

  void activeTripId;
  return { trip, waypoints, segments, orderedWaypoints };
}
