import { describe, it, expect } from "vitest";
import {
  buildRouteLine,
  buildTimeline,
  fitBounds,
  sampleAnimation,
  sliceAlongPolyline,
  aspectRatioToNumber,
} from "./interpolate";
import type { Id, LngLat, PathSegment, Trip, Waypoint } from "@/types";

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
    mapStyleId: "dark", aspectRatio: "16:9", createdAt: "", updatedAt: "",
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
      { id: "t", name: "T", waypointIds: ["a"], segmentIds: [], mapStyleId: "dark", aspectRatio: "16:9", createdAt: "", updatedAt: "" },
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

const TOKYO: LngLat = [139.69, 35.69];
const LA: LngLat = [-118.24, 34.05];
const NY: LngLat = [-74.0, 40.71];
const ROUTE = [TOKYO, LA, NY];

describe("fitBounds (baseline, pre-aspect-ratio)", () => {
  it("returns a zoom within the documented clamp", () => {
    const { zoom } = fitBounds(ROUTE);
    expect(zoom).toBeGreaterThanOrEqual(0.8);
    expect(zoom).toBeLessThanOrEqual(7);
  });

  it("returns a finite center", () => {
    const { center } = fitBounds(ROUTE);
    expect(Number.isFinite(center[0])).toBe(true);
    expect(Number.isFinite(center[1])).toBe(true);
  });

  it("handles a single point without throwing", () => {
    const { zoom } = fitBounds([TOKYO]);
    expect(Number.isFinite(zoom)).toBe(true);
  });
});

describe("fitBounds (aspect-ratio aware)", () => {
  it("maps aspect ratios to numbers", () => {
    expect(aspectRatioToNumber("16:9")).toBeCloseTo(16 / 9);
    expect(aspectRatioToNumber("9:16")).toBeCloseTo(9 / 16);
    expect(aspectRatioToNumber("1:1")).toBe(1);
  });

  it("zooms out MORE for a tall 9:16 frame than a wide 16:9 frame on a wide route", () => {
    const wide = fitBounds(ROUTE, { aspectRatio: 16 / 9 });
    const tall = fitBounds(ROUTE, { aspectRatio: 9 / 16 });
    // A horizontally-wide route must pull back further in a narrow viewport.
    expect(tall.zoom).toBeLessThan(wide.zoom);
  });

  it("biases the frame downward so labels below the bottom dot stay on-screen", () => {
    const noBias = fitBounds(ROUTE, { aspectRatio: 9 / 16, labelBiasLat: 0 });
    const biased = fitBounds(ROUTE, { aspectRatio: 9 / 16 });
    // Downward bias lowers the center latitude (frame shifts down to include labels).
    expect(biased.center[1]).toBeLessThan(noBias.center[1]);
  });

  it("keeps zoom within the documented clamp for all ratios", () => {
    for (const ar of [16 / 9, 9 / 16, 1]) {
      const { zoom } = fitBounds(ROUTE, { aspectRatio: ar });
      expect(zoom).toBeGreaterThanOrEqual(0.8);
      expect(zoom).toBeLessThanOrEqual(7);
    }
  });
});

function makeTripFixture(aspectRatio: "16:9" | "9:16") {
  const ids: Id[] = ["w0", "w1", "w2"];
  const segIds: Id[] = ["s0", "s1"];
  const waypoints: Record<Id, Waypoint> = {
    w0: { id: "w0", label: "Tokyo", position: TOKYO },
    w1: { id: "w1", label: "LA", position: LA },
    w2: { id: "w2", label: "New York", position: NY },
  };
  const segments: Record<Id, PathSegment> = {
    s0: { id: "s0", fromWaypointId: "w0", toWaypointId: "w1", vehicleType: "plane", mode: "flight", routeStatus: "resolved", durationMs: 3000, geometry: [TOKYO, LA] },
    s1: { id: "s1", fromWaypointId: "w1", toWaypointId: "w2", vehicleType: "plane", mode: "flight", routeStatus: "resolved", durationMs: 3000, geometry: [LA, NY] },
  };
  const trip = {
    id: "t0", name: "t", waypointIds: ids, segmentIds: segIds,
    mapStyleId: "dark", aspectRatio, createdAt: "", updatedAt: "",
  } as unknown as Trip;
  return { trip, waypoints, segments };
}

describe("sampleAnimation overview beat is aspect-aware", () => {
  it("overview zoom is lower for 9:16 than 16:9 on a wide route", () => {
    const wide = makeTripFixture("16:9");
    const tall = makeTripFixture("9:16");
    const tlW = buildTimeline(wide.trip, wide.segments);
    const tlT = buildTimeline(tall.trip, tall.segments);
    const fW = sampleAnimation(tlW.totalMs, wide.trip, wide.waypoints, wide.segments, tlW);
    const fT = sampleAnimation(tlT.totalMs, tall.trip, tall.waypoints, tall.segments, tlT);
    expect(fT.showFullRoute).toBe(true);
    expect(fT.zoom).toBeLessThan(fW.zoom);
  });
});

describe("mid-leg follow zoom respects aspect ratio", () => {
  it("never exceeds STOP_ZOOM and pulls back at least as much in 9:16 as 16:9", () => {
    const wide = makeTripFixture("16:9");
    const tall = makeTripFixture("9:16");
    const tlW = buildTimeline(wide.trip, wide.segments);
    const tlT = buildTimeline(tall.trip, tall.segments);
    const midW = tlW.phases.find((p) => p.kind === "segment")!;
    const midT = tlT.phases.find((p) => p.kind === "segment")!;
    const tW = (midW.startMs + midW.endMs) / 2;
    const tT = (midT.startMs + midT.endMs) / 2;
    const fW = sampleAnimation(tW, wide.trip, wide.waypoints, wide.segments, tlW);
    const fT = sampleAnimation(tT, tall.trip, tall.waypoints, tall.segments, tlT);
    expect(fW.zoom).toBeLessThanOrEqual(7); // STOP_ZOOM
    expect(fT.zoom).toBeLessThanOrEqual(7); // STOP_ZOOM
    // Narrow frame pulls back STRICTLY further — aspectExtra ≈ 0.389 for this
    // fixture; margin of 0.3 is comfortably inside the gap but not flaky.
    expect(fT.zoom).toBeLessThan(fW.zoom - 0.3);
  });
});
