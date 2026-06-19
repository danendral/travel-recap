import { describe, it, expect } from "vitest";
import {
  buildRouteLine,
  buildTimeline,
  sampleAnimation,
  sliceAlongPolyline,
} from "./interpolate";
import type { Id, PathSegment, Trip, Waypoint } from "@/types";

/** Jakarta→Bandung→Jakarta-shaped round trip (the reported bug case). */
function fixture() {
  const waypoints: Record<Id, Waypoint> = {
    a: { id: "a", position: [0, 0], label: "A" },
    b: { id: "b", position: [10, 0], label: "B" },
    c: { id: "c", position: [0, 0], label: "C" }, // round-trip back to start
  };
  const segments: Record<Id, PathSegment> = {
    s1: {
      id: "s1", fromWaypointId: "a", toWaypointId: "b", mode: "drive",
      vehicleType: "car", routeStatus: "resolved", durationMs: 3000,
      geometry: [[0, 0], [5, 0], [10, 0]],
    },
    s2: {
      id: "s2", fromWaypointId: "b", toWaypointId: "c", mode: "drive",
      vehicleType: "car", routeStatus: "resolved", durationMs: 3000,
      geometry: [[10, 0], [5, 0], [0, 0]],
    },
  };
  const trip: Trip = {
    id: "t", name: "T", waypointIds: ["a", "b", "c"], segmentIds: ["s1", "s2"],
    mapStyleId: "dark", createdAt: "", updatedAt: "",
  };
  return { trip, segments, waypoints };
}

describe("sliceAlongPolyline", () => {
  it("returns the whole line at t=1", () => {
    const line: [number, number][] = [[0, 0], [10, 0]];
    expect(sliceAlongPolyline(line, 1)).toEqual(line);
  });
  it("cuts at the midpoint at t=0.5", () => {
    const line: [number, number][] = [[0, 0], [10, 0]];
    const out = sliceAlongPolyline(line, 0.5);
    expect(out[out.length - 1][0]).toBeCloseTo(5, 6);
  });
});

describe("buildRouteLine", () => {
  it("concatenates segments into one polyline, de-duping shared join vertices", () => {
    const { trip, segments, waypoints } = fixture();
    const line = buildRouteLine(trip, segments, waypoints);
    expect(line).toEqual([[0, 0], [5, 0], [10, 0], [5, 0], [0, 0]]);
  });
  it("returns [] for a trip with fewer than 2 points", () => {
    const line = buildRouteLine(
      { id: "t", name: "T", waypointIds: ["a"], segmentIds: [], mapStyleId: "dark", createdAt: "", updatedAt: "" },
      {},
      { a: { id: "a", position: [0, 0], label: "A" } },
    );
    expect(line).toEqual([]);
  });
});

describe("routeProgress", () => {
  it("is monotonically non-decreasing and bounded 0..1 across the whole timeline", () => {
    const { trip, segments, waypoints } = fixture();
    const timeline = buildTimeline(trip, segments);
    let prev = -1;
    for (let t = 0; t <= timeline.totalMs; t += timeline.totalMs / 500) {
      const { routeProgress } = sampleAnimation(t, trip, waypoints, segments, timeline);
      expect(routeProgress).toBeGreaterThanOrEqual(0);
      expect(routeProgress).toBeLessThanOrEqual(1 + 1e-9);
      expect(routeProgress).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = routeProgress;
    }
  });
  it("is 0 at t=0 and 1 at the end", () => {
    const { trip, segments, waypoints } = fixture();
    const timeline = buildTimeline(trip, segments);
    expect(sampleAnimation(0, trip, waypoints, segments, timeline).routeProgress).toBeCloseTo(0, 6);
    expect(
      sampleAnimation(timeline.totalMs, trip, waypoints, segments, timeline).routeProgress,
    ).toBeCloseTo(1, 6);
  });
});
