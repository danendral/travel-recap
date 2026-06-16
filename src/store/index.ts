import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type {
  ExportState,
  Id,
  PathSegment,
  PlaybackState,
  Trip,
  VehicleType,
  Waypoint,
} from "@/types";
import { modeForVehicle } from "@/types";
import {
  DEFAULT_SEGMENT_DURATION_MS,
  DEFAULT_STYLE_ID,
  RESOLUTION_BY_RATIO,
} from "@/lib/constants";
import { resolveSegmentGeometry, fetchDriveRoute } from "@/lib/pathing/geometry";
import { buildTimeline } from "@/lib/pathing/interpolate";

const uid = (): Id => crypto.randomUUID();
const now = () => new Date().toISOString();

interface TravelRecapStore {
  // --- Persisted domain entities (normalized) ---
  trips: Record<Id, Trip>;
  waypoints: Record<Id, Waypoint>;
  segments: Record<Id, PathSegment>;
  activeTripId: Id | null;

  // --- Transient UI state (never persisted) ---
  playback: PlaybackState;
  export: ExportState;

  // --- Trip lifecycle ---
  createTrip(name?: string): Id;
  setActiveTrip(tripId: Id): void;

  // --- Waypoints ---
  addWaypoint(tripId: Id, wp: Omit<Waypoint, "id">): Id;
  removeWaypoint(tripId: Id, waypointId: Id): void;
  reorderWaypoints(tripId: Id, orderedIds: Id[]): void;

  // --- Segments ---
  setSegmentVehicle(segmentId: Id, vehicleType: VehicleType): void;
  /** Async: upgrade drive segments to road-following routes (OSRM). */
  upgradeDriveRoutes(tripId: Id): Promise<void>;

  // --- Appearance ---
  setMapStyle(styleId: string): void;

  // --- Playback ---
  play(): void;
  pause(): void;
  seek(ms: number): void;
  setPlaybackStatus(status: PlaybackState["status"]): void;
  setPlaybackRate(rate: number): void;

  // --- Derived helpers ---
  recomputeTotalDuration(tripId: Id): void;
}

const initialPlayback: PlaybackState = {
  status: "idle",
  currentTimeMs: 0,
  totalDurationMs: 0,
  playbackRate: 1,
};

const initialExport: ExportState = {
  status: "idle",
  aspectRatio: "16:9",
  resolution: RESOLUTION_BY_RATIO["16:9"],
  fps: 30,
  codec: "h264",
  progress: 0,
  isPaidExport: false,
};

/**
 * Rebuilds the segment list for a trip from its ordered waypoints. Preserves
 * an existing segment's mode + cached geometry when the same from→to pair still
 * exists, so reordering doesn't needlessly drop resolved routes.
 */
function rederiveSegments(
  trip: Trip,
  waypoints: Record<Id, Waypoint>,
  segments: Record<Id, PathSegment>,
) {
  const prevByPair = new Map<string, PathSegment>();
  for (const sid of trip.segmentIds) {
    const seg = segments[sid];
    if (seg) prevByPair.set(`${seg.fromWaypointId}->${seg.toWaypointId}`, seg);
  }

  // Drop all old segments for this trip; we rebuild from scratch.
  for (const sid of trip.segmentIds) delete segments[sid];

  const newIds: Id[] = [];
  for (let i = 0; i < trip.waypointIds.length - 1; i++) {
    const from = trip.waypointIds[i];
    const to = trip.waypointIds[i + 1];
    const reused = prevByPair.get(`${from}->${to}`);
    if (reused) {
      segments[reused.id] = reused;
      newIds.push(reused.id);
      continue;
    }
    const seg: PathSegment = {
      id: uid(),
      fromWaypointId: from,
      toWaypointId: to,
      vehicleType: "plane",
      mode: "flight",
      routeStatus: "pending",
      durationMs: DEFAULT_SEGMENT_DURATION_MS,
    };
    segments[seg.id] = seg;
    newIds.push(seg.id);
  }
  trip.segmentIds = newIds;
  trip.updatedAt = now();
  resolvePendingGeometry(trip, waypoints, segments);
}

/**
 * Resolves geometry (great-circle arc / straight line) for any segment still
 * marked `pending`, caching it on `segment.geometry`. Synchronous — flights are
 * pure turf math. Runs at edit time so playback/export never recompute.
 */
function resolvePendingGeometry(
  trip: Trip,
  waypoints: Record<Id, Waypoint>,
  segments: Record<Id, PathSegment>,
) {
  for (const sid of trip.segmentIds) {
    const seg = segments[sid];
    if (!seg || seg.routeStatus !== "pending") continue;
    const from = waypoints[seg.fromWaypointId]?.position;
    const to = waypoints[seg.toWaypointId]?.position;
    if (!from || !to) continue;
    try {
      seg.geometry = resolveSegmentGeometry(from, to, seg.mode);
      // Flights are final. Drive segments hold a straight-line placeholder and
      // are marked "fallback" so upgradeDriveRoutes knows to fetch a road route.
      seg.routeStatus = seg.mode === "drive" ? "fallback" : "resolved";
    } catch {
      seg.geometry = [from, to];
      seg.routeStatus = "fallback";
    }
  }
}

// Single source of truth for the timeline length — includes dwells, segments,
// AND the final overview beat. Must match buildTimeline or the playback loop
// clamps `currentTime` before the overview can play.
function totalDurationFor(trip: Trip, segments: Record<Id, PathSegment>) {
  return buildTimeline(trip, segments).totalMs;
}

export const useStore = create<TravelRecapStore>()(
  persist(
    immer((set, get) => ({
      trips: {},
      waypoints: {},
      segments: {},
      activeTripId: null,
      playback: initialPlayback,
      export: initialExport,

      createTrip(name = "Untitled trip") {
        const id = uid();
        set((s) => {
          s.trips[id] = {
            id,
            name,
            waypointIds: [],
            segmentIds: [],
            mapStyleId: DEFAULT_STYLE_ID,
            createdAt: now(),
            updatedAt: now(),
          };
          s.activeTripId = id;
        });
        return id;
      },

      setActiveTrip(tripId) {
        set((s) => {
          s.activeTripId = tripId;
          s.playback = { ...initialPlayback };
          const trip = s.trips[tripId];
          if (trip) {
            // Trips loaded from storage (older schema) may lack vehicleType or
            // cached geometry — backfill so playback has arcs to follow.
            for (const sid of trip.segmentIds) {
              const seg = s.segments[sid];
              if (seg && !seg.vehicleType) {
                seg.vehicleType = seg.mode === "drive" ? "car" : "plane";
              }
              if (seg && (!seg.geometry || seg.geometry.length < 2)) {
                seg.routeStatus = "pending";
              }
            }
            resolvePendingGeometry(trip, s.waypoints, s.segments);
          }
        });
        get().recomputeTotalDuration(tripId);
        void get().upgradeDriveRoutes(tripId);
      },

      addWaypoint(tripId, wp) {
        const id = uid();
        set((s) => {
          const trip = s.trips[tripId];
          if (!trip) return;
          s.waypoints[id] = { ...wp, id };
          trip.waypointIds.push(id);
          rederiveSegments(trip, s.waypoints, s.segments);
          s.playback.totalDurationMs = totalDurationFor(trip, s.segments);
        });
        void get().upgradeDriveRoutes(tripId);
        return id;
      },

      removeWaypoint(tripId, waypointId) {
        set((s) => {
          const trip = s.trips[tripId];
          if (!trip) return;
          const wp = s.waypoints[waypointId];
          if (wp?.photo?.objectUrl) URL.revokeObjectURL(wp.photo.objectUrl);
          delete s.waypoints[waypointId];
          trip.waypointIds = trip.waypointIds.filter((w) => w !== waypointId);
          rederiveSegments(trip, s.waypoints, s.segments);
          s.playback.totalDurationMs = totalDurationFor(trip, s.segments);
        });
      },

      reorderWaypoints(tripId, orderedIds) {
        set((s) => {
          const trip = s.trips[tripId];
          if (!trip) return;
          trip.waypointIds = orderedIds;
          rederiveSegments(trip, s.waypoints, s.segments);
          s.playback.totalDurationMs = totalDurationFor(trip, s.segments);
        });
        void get().upgradeDriveRoutes(tripId);
      },

      setSegmentVehicle(segmentId, vehicleType) {
        set((s) => {
          const seg = s.segments[segmentId];
          if (!seg) return;
          const trip = s.activeTripId ? s.trips[s.activeTripId] : null;
          seg.vehicleType = vehicleType;
          seg.mode = modeForVehicle(vehicleType);
          // Re-curve / un-curve: drop cached geometry and re-resolve.
          seg.geometry = undefined;
          seg.routeStatus = "pending";
          if (trip) resolvePendingGeometry(trip, s.waypoints, s.segments);
        });
        void get().upgradeDriveRoutes(get().activeTripId ?? "");
      },

      async upgradeDriveRoutes(tripId) {
        const trip = get().trips[tripId];
        if (!trip) return;
        // Find drive segments still on the straight-line fallback.
        const todo = trip.segmentIds
          .map((sid) => get().segments[sid])
          .filter(
            (seg): seg is PathSegment =>
              !!seg && seg.mode === "drive" && seg.routeStatus === "fallback",
          );

        // Fetch sequentially to respect the public OSRM server's ~1 req/s limit.
        for (const seg of todo) {
          const from = get().waypoints[seg.fromWaypointId]?.position;
          const to = get().waypoints[seg.toWaypointId]?.position;
          if (!from || !to) continue;
          const road = await fetchDriveRoute(from, to);
          if (!road) continue; // keep the straight-line fallback on failure
          set((s) => {
            const live = s.segments[seg.id];
            // Guard: segment may have changed mode/been removed while awaiting.
            if (live && live.mode === "drive") {
              live.geometry = road;
              live.routeStatus = "resolved";
            }
          });
        }
      },

      setMapStyle(styleId) {
        set((s) => {
          const trip = s.activeTripId ? s.trips[s.activeTripId] : null;
          if (trip) trip.mapStyleId = styleId;
        });
      },

      play() {
        set((s) => {
          s.playback.status = "playing";
        });
      },
      pause() {
        set((s) => {
          s.playback.status = "paused";
        });
      },
      seek(ms) {
        set((s) => {
          s.playback.currentTimeMs = Math.max(
            0,
            Math.min(ms, s.playback.totalDurationMs),
          );
        });
      },
      setPlaybackRate(rate) {
        set((s) => {
          s.playback.playbackRate = rate;
        });
      },
      setPlaybackStatus(status) {
        set((s) => {
          s.playback.status = status;
        });
      },

      recomputeTotalDuration(tripId) {
        set((s) => {
          const trip = s.trips[tripId];
          if (!trip) return;
          s.playback.totalDurationMs = totalDurationFor(trip, s.segments);
        });
      },
    })),
    {
      name: "travel-recap-store",
      storage: createJSONStorage(() => localStorage),
      // Persist only serializable domain data. Object URLs / blobs and all
      // transient playback+export state are intentionally excluded.
      partialize: (s) => ({
        trips: s.trips,
        waypoints: s.waypoints,
        segments: s.segments,
        activeTripId: s.activeTripId,
      }),
    },
  ),
);
