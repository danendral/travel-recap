import { describe, it, expect, beforeEach, vi } from "vitest";

// The store wires zustand `persist` to localStorage; provide a minimal stub so
// the module can be imported in the node test environment.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

// crypto.randomUUID exists in node 20+, but guard just in case.
if (!globalThis.crypto?.randomUUID) {
  let n = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `id-${++n}` });
}

import { useStore } from "./index";

function reset() {
  useStore.setState({
    trips: {},
    waypoints: {},
    segments: {},
    activeTripId: null,
    hasSeeded: false,
  });
}

beforeEach(reset);

describe("renameTrip", () => {
  it("updates name and updatedAt", () => {
    const id = useStore.getState().createTrip("A");
    const before = useStore.getState().trips[id].updatedAt;
    useStore.getState().renameTrip(id, "B");
    expect(useStore.getState().trips[id].name).toBe("B");
    expect(useStore.getState().trips[id].updatedAt).not.toBe(before);
  });
});

describe("deleteTrip", () => {
  it("removes the trip, its waypoints and segments, and reassigns activeTripId", () => {
    const s = useStore.getState();
    const t1 = s.createTrip("one");
    s.addWaypoint(t1, { position: [0, 0], label: "A" });
    s.addWaypoint(t1, { position: [10, 0], label: "B" });
    const t2 = s.createTrip("two"); // becomes active
    expect(useStore.getState().activeTripId).toBe(t2);

    const wpIds = useStore.getState().trips[t1].waypointIds;
    const segIds = useStore.getState().trips[t1].segmentIds;
    useStore.getState().deleteTrip(t1);

    const after = useStore.getState();
    expect(after.trips[t1]).toBeUndefined();
    for (const w of wpIds) expect(after.waypoints[w]).toBeUndefined();
    for (const sg of segIds) expect(after.segments[sg]).toBeUndefined();
    // t1 wasn't active, so t2 stays active.
    expect(after.activeTripId).toBe(t2);
  });

  it("clears/reassigns activeTripId when the active trip is deleted", () => {
    const s = useStore.getState();
    const t1 = s.createTrip("one");
    const t2 = s.createTrip("two"); // active
    useStore.getState().deleteTrip(t2);
    expect(useStore.getState().activeTripId).toBe(t1);
    useStore.getState().deleteTrip(t1);
    expect(useStore.getState().activeTripId).toBeNull();
  });
});

describe("duplicateTrip", () => {
  it("clones with all-fresh ids, same labels, '(copy)' suffix", () => {
    const s = useStore.getState();
    const t1 = s.createTrip("Trip");
    s.addWaypoint(t1, { position: [0, 0], label: "A" });
    s.addWaypoint(t1, { position: [10, 0], label: "B" });

    const copyId = useStore.getState().duplicateTrip(t1);
    const after = useStore.getState();
    const orig = after.trips[t1];
    const copy = after.trips[copyId];

    expect(copy.name).toBe("Trip (copy)"); // created with an explicit name
    expect(copy.id).not.toBe(orig.id);
    // No id overlap between original and copy entities.
    for (const w of copy.waypointIds) expect(orig.waypointIds).not.toContain(w);
    for (const sg of copy.segmentIds) expect(orig.segmentIds).not.toContain(sg);
    // Same labels in order.
    expect(copy.waypointIds.map((w) => after.waypoints[w].label)).toEqual(["A", "B"]);
  });
});

describe("auto-name from first stop", () => {
  it("renames an Untitled trip to 'Trip to <label>' on the first stop", () => {
    const s = useStore.getState();
    const id = s.createTrip(); // "Untitled trip"
    s.addWaypoint(id, { position: [1, 2], label: "Tokyo" });
    expect(useStore.getState().trips[id].name).toBe("Trip to Tokyo");
  });
  it("does not overwrite a user-renamed trip", () => {
    const s = useStore.getState();
    const id = s.createTrip();
    s.renameTrip(id, "My Japan trip");
    s.addWaypoint(id, { position: [1, 2], label: "Tokyo" });
    expect(useStore.getState().trips[id].name).toBe("My Japan trip");
  });
});
