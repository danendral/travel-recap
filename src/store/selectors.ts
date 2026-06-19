import { useMemo } from "react";
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

/** A trip reduced to what the dashboard card needs. */
export interface TripSummary {
  id: Id;
  name: string;
  stopCount: number;
  updatedAt: string;
  /** "Tokyo → Kyoto" or, when long, "Tokyo → … → Kobe". */
  routeSummary: string;
}

/** Just the slices `tripSummaries` reads — kept narrow so it's pure-testable. */
export interface SummariesState {
  trips: Record<Id, Trip>;
  waypoints: Record<Id, Waypoint>;
}

/**
 * Pure: every trip as a dashboard summary, newest-edited first. Extracted from
 * the hook so it can be unit-tested without React.
 */
export function tripSummaries(state: SummariesState): TripSummary[] {
  return Object.values(state.trips)
    .map((trip): TripSummary => {
      const labels = trip.waypointIds
        .map((id) => state.waypoints[id]?.label)
        .filter((l): l is string => !!l);
      const routeSummary =
        labels.length <= 3
          ? labels.join(" → ")
          : `${labels[0]} → … → ${labels[labels.length - 1]}`;
      return {
        id: trip.id,
        name: trip.name,
        stopCount: trip.waypointIds.length,
        updatedAt: trip.updatedAt,
        routeSummary,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Reactive trip summaries for the dashboard (sorted newest-edited first). */
export function useTripList(): TripSummary[] {
  const trips = useStore((s) => s.trips);
  const waypoints = useStore((s) => s.waypoints);
  return useMemo(() => tripSummaries({ trips, waypoints }), [trips, waypoints]);
}
