import { describe, it, expect } from "vitest";
import { thumbnailSignature } from "./signature";
import type { Id, Trip, Waypoint } from "@/types";

function setup(positions: [number, number][], styleId = "dark") {
  const waypoints: Record<Id, Waypoint> = {};
  const waypointIds: Id[] = [];
  positions.forEach((p, i) => {
    const id = `w${i}`;
    waypoints[id] = { id, position: p, label: `S${i}` };
    waypointIds.push(id);
  });
  const trip: Trip = {
    id: "t", name: "T", waypointIds, segmentIds: [], mapStyleId: styleId,
    createdAt: "", updatedAt: "",
  };
  return { trip, waypoints };
}

describe("thumbnailSignature", () => {
  it("is stable for an unchanged route", () => {
    const { trip, waypoints } = setup([[0, 0], [1, 1]]);
    expect(thumbnailSignature(trip, waypoints)).toBe(
      thumbnailSignature(trip, waypoints),
    );
  });

  it("changes when a waypoint moves", () => {
    const a = setup([[0, 0], [1, 1]]);
    const b = setup([[0, 0], [2, 2]]);
    expect(thumbnailSignature(a.trip, a.waypoints)).not.toBe(
      thumbnailSignature(b.trip, b.waypoints),
    );
  });

  it("changes when the map style changes", () => {
    const a = setup([[0, 0], [1, 1]], "dark");
    const b = setup([[0, 0], [1, 1]], "satellite");
    expect(thumbnailSignature(a.trip, a.waypoints)).not.toBe(
      thumbnailSignature(b.trip, b.waypoints),
    );
  });
});
