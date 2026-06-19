import { describe, it, expect } from "vitest";
import { tripSummaries, type SummariesState } from "./selectors";
import type { Id, Trip, Waypoint } from "@/types";

function state(): SummariesState {
  const waypoints: Record<Id, Waypoint> = {
    a: { id: "a", position: [0, 0], label: "Tokyo" },
    b: { id: "b", position: [1, 0], label: "Kyoto" },
    c: { id: "c", position: [2, 0], label: "Osaka" },
    d: { id: "d", position: [3, 0], label: "Nara" },
    e: { id: "e", position: [4, 0], label: "Kobe" },
  };
  const mk = (id: string, name: string, wps: Id[], updatedAt: string): Trip => ({
    id, name, waypointIds: wps, segmentIds: [], mapStyleId: "dark",
    createdAt: "2026-01-01T00:00:00Z", updatedAt,
  });
  const trips: Record<Id, Trip> = {
    t1: mk("t1", "Old", ["a", "b"], "2026-06-01T00:00:00Z"),
    t2: mk("t2", "New", ["a", "b", "c", "d", "e"], "2026-06-18T00:00:00Z"),
  };
  return { trips, waypoints };
}

describe("tripSummaries", () => {
  it("sorts by updatedAt desc", () => {
    const out = tripSummaries(state());
    expect(out.map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  it("reports stop count", () => {
    const out = tripSummaries(state());
    expect(out.find((t) => t.id === "t1")!.stopCount).toBe(2);
    expect(out.find((t) => t.id === "t2")!.stopCount).toBe(5);
  });

  it("formats a short route summary in full", () => {
    const out = tripSummaries(state());
    expect(out.find((t) => t.id === "t1")!.routeSummary).toBe("Tokyo → Kyoto");
  });

  it("collapses a long route to first → … → last", () => {
    const out = tripSummaries(state());
    expect(out.find((t) => t.id === "t2")!.routeSummary).toBe("Tokyo → … → Kobe");
  });
});
