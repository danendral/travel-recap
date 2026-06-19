# Map Visual Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the route trail render seamlessly across all playback phases, route car/walk legs along real geography, and stop place-name labels overlapping.

**Architecture:** Replace the per-frame *grown* symbol-dash trail (which re-flows dashes every frame, causing the "different route each phase" artifact) with a **stable full-route polyline** revealed by a per-frame `line-gradient` paint update. Add resilient OSRM routing with profiles, timeout, and retry. Reconfigure the label layer to use MapLibre's collision engine. Add Vitest for the pure animation/geometry math.

**Tech Stack:** TypeScript, MapLibre GL JS 5.24, @turf/turf, Zustand 5, Vitest (new), Next 16.

## Global Constraints

- Geometry is GeoJSON `[lng, lat]` order everywhere — never `[lat, lng]`.
- Preview and export MUST share `sampleAnimation()` in `interpolate.ts`; all animation math stays pure and in that file.
- Routing/geometry is computed at edit time and cached on `PathSegment.geometry`; NEVER computed inside the playback/export loop.
- All per-frame map writes go through `applyFrameToMap` (`src/lib/map/applyFrame.ts`); never set React state or layout properties per frame; use `map.jumpTo`, never `easeTo`/`flyTo`.
- The vehicle and trail are MapLibre GL layers (not HTML markers) so pixel readback captures them on export.
- NO COOP/COEP headers in `next.config.ts`.
- The map is published on `window.__trMap`.

---

### Task 1: Add Vitest for pure-math tests

**Files:**
- Modify: `package.json` (devDeps + `test` script)
- Create: `vitest.config.mts`
- Create: `src/lib/pathing/interpolate.test.ts`

**Interfaces:**
- Consumes: existing `buildTimeline`, `sampleAnimation`, `sliceAlongPolyline` from `interpolate.ts`.
- Produces: a runnable `npm test`; a test file other tasks extend.

- [ ] **Step 1: Install Vitest**

Run: `npm install -D vitest vite-tsconfig-paths`
Expected: packages added to devDependencies.

- [ ] **Step 2: Create `vitest.config.mts`**

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 3: Add the test script to `package.json`**

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write a smoke test** in `src/lib/pathing/interpolate.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { sliceAlongPolyline } from "./interpolate";

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
```

- [ ] **Step 5: Run and verify it passes**

Run: `npm test`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.mts src/lib/pathing/interpolate.test.ts
git commit -m "test: add Vitest for pure pathing math"
```

---

### Task 2: `buildRouteLine` — one stable polyline for the whole trip

**Files:**
- Modify: `src/lib/pathing/interpolate.ts` (add `buildRouteLine`)
- Test: `src/lib/pathing/interpolate.test.ts`

**Interfaces:**
- Consumes: `Trip`, `PathSegment`, `Waypoint`, `Id`, `LngLat` from `@/types`; the existing `segmentPath`-style geometry resolution.
- Produces: `export function buildRouteLine(trip: Trip, segments: Record<Id, PathSegment>, waypoints: Record<Id, Waypoint>): LngLat[]` — the full route as one de-duplicated polyline (empty array if < 2 points).

- [ ] **Step 1: Write the failing test**

```ts
import { buildRouteLine } from "./interpolate";
import type { Trip, PathSegment, Waypoint, Id } from "@/types";

function fixture() {
  const waypoints: Record<Id, Waypoint> = {
    a: { id: "a", position: [0, 0], label: "A" },
    b: { id: "b", position: [10, 0], label: "B" },
    c: { id: "c", position: [0, 0], label: "C" }, // round-trip back to start
  };
  const segments: Record<Id, PathSegment> = {
    s1: { id: "s1", fromWaypointId: "a", toWaypointId: "b", mode: "drive", vehicleType: "car", routeStatus: "resolved", durationMs: 3000, geometry: [[0,0],[5,0],[10,0]] },
    s2: { id: "s2", fromWaypointId: "b", toWaypointId: "c", mode: "drive", vehicleType: "car", routeStatus: "resolved", durationMs: 3000, geometry: [[10,0],[5,0],[0,0]] },
  };
  const trip: Trip = { id: "t", name: "T", waypointIds: ["a","b","c"], segmentIds: ["s1","s2"], mapStyleId: "dark", createdAt: "", updatedAt: "" };
  return { trip, segments, waypoints };
}

describe("buildRouteLine", () => {
  it("concatenates segments into one polyline, de-duping shared join vertices", () => {
    const { trip, segments, waypoints } = fixture();
    const line = buildRouteLine(trip, segments, waypoints);
    // s1: (0,0)(5,0)(10,0) + s2: (10,0)(5,0)(0,0) — the join (10,0) appears once
    expect(line).toEqual([[0,0],[5,0],[10,0],[5,0],[0,0]]);
  });
  it("returns [] for a trip with fewer than 2 points", () => {
    const line = buildRouteLine({ id:"t", name:"T", waypointIds:["a"], segmentIds:[], mapStyleId:"dark", createdAt:"", updatedAt:"" }, {}, { a:{id:"a",position:[0,0],label:"A"} });
    expect(line).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `buildRouteLine is not a function`.

- [ ] **Step 3: Implement `buildRouteLine`** in `interpolate.ts`

```ts
/**
 * The whole trip as ONE continuous polyline: every segment's cached geometry
 * concatenated, de-duping the shared vertex where one segment meets the next.
 * Stable for a given trip shape — the trail layer's geometry is set from this
 * ONCE and never per frame, so dashes never re-flow (the seamlessness fix).
 */
export function buildRouteLine(
  trip: Trip,
  segments: Record<Id, PathSegment>,
  waypoints: Record<Id, Waypoint>,
): LngLat[] {
  const coords: LngLat[] = [];
  const push = (pts: LngLat[]) => {
    for (const p of pts) {
      const last = coords[coords.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) coords.push(p);
    }
  };
  for (const sid of trip.segmentIds) {
    const seg = segments[sid];
    const from = waypoints[seg?.fromWaypointId ?? ""];
    const to = waypoints[seg?.toWaypointId ?? ""];
    push(segmentPath(seg, from, to));
  }
  return coords.length >= 2 ? coords : [];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pathing/interpolate.ts src/lib/pathing/interpolate.test.ts
git commit -m "feat(pathing): buildRouteLine — stable full-route polyline"
```

---

### Task 3: `routeProgress` — monotonic distance-fraction in every frame

**Files:**
- Modify: `src/lib/pathing/interpolate.ts` (add `routeProgress` to `AnimationFrame`; compute in `sampleAnimation`; add a `segmentLengthsFor` helper)
- Test: `src/lib/pathing/interpolate.test.ts`

**Interfaces:**
- Consumes: `buildTimeline`, `sampleAnimation`, segment geometry.
- Produces: `AnimationFrame.routeProgress: number` (0..1 fraction of total route distance traveled); helper `routeLengths(trip, segments, waypoints): { perSegment: number[]; total: number }`.

- [ ] **Step 1: Write the failing test** (monotonicity is the seamlessness guarantee)

```ts
import { buildTimeline, sampleAnimation } from "./interpolate";

describe("routeProgress", () => {
  it("is monotonically non-decreasing and bounded 0..1 across the whole timeline", () => {
    const { trip, segments, waypoints } = fixture(); // reuse Task 2 fixture
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
    expect(sampleAnimation(timeline.totalMs, trip, waypoints, segments, timeline).routeProgress).toBeCloseTo(1, 6);
  });
});
```

(Move `fixture()` to a shared `const fixture = () => {…}` at the top of the test file so Tasks 2 and 3 reuse it.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `routeProgress` undefined.

- [ ] **Step 3: Add the field + helper + computation**

In `AnimationFrame`, add:
```ts
  /** 0..1 fraction of the TOTAL route distance traveled — drives the trail
   *  reveal gradient. Monotonic across all phases (seamlessness guarantee). */
  routeProgress: number;
```

Add the helper (uses planar segment lengths, consistent with `cumulativeLengths`):
```ts
function routeLengths(
  trip: Trip,
  segments: Record<Id, PathSegment>,
  waypoints: Record<Id, Waypoint>,
): { perSegment: number[]; total: number } {
  const perSegment = trip.segmentIds.map((sid) => {
    const seg = segments[sid];
    const pts = segmentPath(seg, waypoints[seg?.fromWaypointId ?? ""], waypoints[seg?.toWaypointId ?? ""]);
    return cumulativeLengths(pts).total;
  });
  return { perSegment, total: perSegment.reduce((a, b) => a + b, 0) };
}
```

Set `routeProgress` in EACH return of `sampleAnimation`:
- `empty`: `routeProgress: 0`.
- `dwell`: cumulative length of segments `[0..phase.index-1]` ÷ total (i.e. distance up to the arrived stop). For `phase.index === 0` → 0.
- `overview`: `routeProgress: 1`.
- `segment`: `(lengthBefore + perSegment[phase.index] * eased) / total`, where `lengthBefore` is the sum of `perSegment[0..phase.index-1]`. Guard `total === 0 → 0`.

Compute `const { perSegment, total } = routeLengths(...)` once near the top of `sampleAnimation`, after the empty guard.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pathing/interpolate.ts src/lib/pathing/interpolate.test.ts
git commit -m "feat(pathing): routeProgress — monotonic reveal scalar for the trail"
```

---

### Task 4: Stable route source + gradient reveal in `applyFrame`

**Files:**
- Modify: `src/lib/map/applyFrame.ts`
- Modify: `src/components/map/MapCanvas.tsx` (layer stack + `lineMetrics`)

**Interfaces:**
- Consumes: `buildRouteLine`, `AnimationFrame.routeProgress`.
- Produces: `export const ROUTE_SOURCE = "tr-route"`; `export function setRouteGeometry(map, line: LngLat[]): void` (sets the source once); `applyFrameToMap` now sets only the gradient per frame and removes the per-frame trail-geometry rebuild.

- [ ] **Step 1: Replace the trail source/layers in `MapCanvas.tsx`**

In `addAppLayers`, remove the `tr-trail-line` symbol layer and the `trail-dot` registration. Add a single GeoJSON source with line metrics and three line layers:

```ts
if (!map.getSource(ROUTE_SOURCE)) {
  map.addSource(ROUTE_SOURCE, { type: "geojson", lineMetrics: true, data: emptyCollection() });
}
// Soft glow underlay (no gradient — constant dim glow along the whole route).
map.addLayer({
  id: "tr-route-glow", type: "line", source: ROUTE_SOURCE,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": "#38bdf8", "line-width": 9, "line-opacity": 0.18, "line-blur": 6 },
});
// Upcoming track: dim dashed full-length line.
map.addLayer({
  id: "tr-route-upcoming", type: "line", source: ROUTE_SOURCE,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": "#64748b", "line-width": 2.5, "line-opacity": 0.45, "line-dasharray": [1.6, 1.8] },
});
// Traveled: bright dashed line, clipped to routeProgress via a gradient ALPHA ramp.
map.addLayer({
  id: "tr-route-traveled", type: "line", source: ROUTE_SOURCE,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-width": 3.5,
    "line-dasharray": [1.6, 1.8],
    "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "#7dd3fc", 1, "#7dd3fc"],
  },
});
```

> `line-gradient` requires `lineMetrics: true` and cannot be combined with a paint-expression `line-opacity` that uses `line-progress`; we encode the reveal in the gradient's **color stops** by switching the upcoming portion to a transparent color. See Step 3.

- [ ] **Step 2: Add `ROUTE_SOURCE` + `setRouteGeometry` to `applyFrame.ts`**

```ts
export const ROUTE_SOURCE = "tr-route";

/** Sets the whole-route polyline ONCE per trip-shape change (never per frame). */
export function setRouteGeometry(map: MlMap, line: LngLat[]): void {
  const src = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(
    line.length >= 2
      ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: {} }] }
      : emptyCollection(),
  );
}
```

- [ ] **Step 3: Rewrite the trail half of `applyFrameToMap` to set only the gradient**

Replace `trailSrc.setData(trailFeature(...))` with a gradient update. The gradient makes everything up to `routeProgress` bright `#7dd3fc` and everything after transparent (so only the `tr-route-upcoming` dim layer shows ahead):

```ts
const p = Math.max(0.0001, Math.min(0.9999, frame.routeProgress));
map.setPaintProperty("tr-route-traveled", "line-gradient", [
  "interpolate", ["linear"], ["line-progress"],
  0, "#7dd3fc",
  p, "#7dd3fc",
  Math.min(1, p + 0.001), "rgba(125,211,252,0)",
  1, "rgba(125,211,252,0)",
]);
```

Remove `TRAIL_SOURCE`, `trailFeature`, and the `pathFor` helper from `applyFrame.ts` (now unused — `buildRouteLine` replaces them). Keep `vehicleFeature` and `waypointFeatures` unchanged. `applyFrameToMap` keeps setting the vehicle + waypoint sources as before.

- [ ] **Step 4: Drive `setRouteGeometry` from `MapCanvas` when the trip shape changes**

In the store→sources sync effect (deps already include `trip?.segmentIds`, `segments`), after setting waypoint data, compute and set the route line:

```ts
import { buildRouteLine } from "@/lib/pathing/interpolate";
import { setRouteGeometry } from "@/lib/map/applyFrame";
// inside apply():
if (trip) setRouteGeometry(map, buildRouteLine(trip, segments, waypoints));
```

Also call it in the `reapply` style-swap path so the route survives a basemap change.

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual verification**

Run `npm run dev`; plot Jakarta → Bandung → Jakarta with car legs; play. Confirm: the dashed trail is **identical** while moving, on arrival, and when the next leg starts (no re-flow); the upcoming route shows dim ahead of the vehicle; the traveled portion lights up behind it.

- [ ] **Step 7: Commit**

```bash
git add src/lib/map/applyFrame.ts src/components/map/MapCanvas.tsx
git commit -m "fix(map): seamless trail via stable route line + gradient reveal

Replaces the per-frame grown symbol-dash trail (dashes re-flowed every
frame -> 'different route each phase') with one stable full-route polyline
revealed by a per-frame line-gradient. Geometry never changes during
playback, so dashes are pinned and the trail is identical in every phase."
```

---

### Task 5: Resilient routing with profiles, timeout, and retry

**Files:**
- Modify: `src/lib/pathing/geometry.ts` (rename/extend `fetchDriveRoute` → `fetchRoute`)
- Modify: `src/store/index.ts` (`upgradeDriveRoutes` uses the profile)
- Modify: `src/lib/constants.ts` (`OSRM_BASE`)
- Test: `src/lib/pathing/geometry.test.ts`

**Interfaces:**
- Consumes: `LngLat`, `VehicleType`.
- Produces: `export type RoutingProfile = "driving" | "foot"`; `export function routingProfileFor(v: VehicleType): RoutingProfile | null` (car→driving, walk→foot, else null); `export async function fetchRoute(from, to, profile, signal?): Promise<LngLat[] | null>`. `OSRM_BASE` constant.

- [ ] **Step 1: Add `OSRM_BASE`** to `constants.ts`

```ts
/** Routing server base. Public OSRM demo for now; swap for a self-hosted /
 *  backend router later without touching call sites. */
export const OSRM_BASE = "https://router.project-osrm.org";
```

- [ ] **Step 2: Write the failing test** in `geometry.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchRoute, routingProfileFor } from "./geometry";

afterEach(() => vi.restoreAllMocks());

describe("routingProfileFor", () => {
  it("maps car->driving, walk->foot, others->null", () => {
    expect(routingProfileFor("car")).toBe("driving");
    expect(routingProfileFor("walk")).toBe("foot");
    expect(routingProfileFor("plane")).toBeNull();
    expect(routingProfileFor("train")).toBeNull();
  });
});

describe("fetchRoute", () => {
  it("requests the chosen profile and returns the line", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: "Ok", routes: [{ geometry: { coordinates: [[0,0],[1,1]] } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchRoute([0,0],[1,1],"foot");
    expect(out).toEqual([[0,0],[1,1]]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/route/v1/foot/");
  });

  it("retries once on transient failure then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: "Ok", routes: [{ geometry: { coordinates: [[0,0],[2,2]] } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchRoute([0,0],[2,2],"driving");
    expect(out).toEqual([[0,0],[2,2]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null after exhausting retries", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchRoute([0,0],[1,1],"driving")).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `fetchRoute`/`routingProfileFor` not exported.

- [ ] **Step 4: Implement** in `geometry.ts`

```ts
import { OSRM_BASE } from "@/lib/constants";
import type { VehicleType } from "@/types";

export type RoutingProfile = "driving" | "foot";

export function routingProfileFor(v: VehicleType): RoutingProfile | null {
  if (v === "car") return "driving";
  if (v === "walk") return "foot";
  return null; // plane/train/boat keep great-circle/straight geometry
}

const ROUTE_TIMEOUT_MS = 6000;

export async function fetchRoute(
  from: LngLat,
  to: LngLat,
  profile: RoutingProfile,
  signal?: AbortSignal,
): Promise<LngLat[] | null> {
  const coords = `${from[0]},${from[1]};${to[0]},${to[1]}`;
  const url = `${OSRM_BASE}/route/v1/${profile}/${coords}?overview=full&geometries=geojson`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => ctrl.abort(), ROUTE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) { if (res.status >= 500 && attempt === 0) continue; return null; }
      const data = (await res.json()) as { code: string; routes?: Array<{ geometry: { coordinates: [number, number][] } }> };
      if (data.code !== "Ok" || !data.routes?.length) return null;
      const line = data.routes[0].geometry.coordinates;
      return line.length >= 2 ? line.map((c) => [c[0], c[1]]) : null;
    } catch (err) {
      if (signal?.aborted) return null;        // genuine cancel
      if (attempt === 0) continue;             // transient — retry once
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  return null;
}

/** @deprecated use fetchRoute(..., "driving") */
export const fetchDriveRoute = (from: LngLat, to: LngLat, signal?: AbortSignal) =>
  fetchRoute(from, to, "driving", signal);
```

- [ ] **Step 5: Update `upgradeDriveRoutes`** in `store/index.ts` to pick the profile per segment vehicle

```ts
import { resolveSegmentGeometry, fetchRoute, routingProfileFor } from "@/lib/pathing/geometry";
// inside the loop, replace fetchDriveRoute(from,to):
const profile = routingProfileFor(seg.vehicleType);
if (!profile) continue;
const road = await fetchRoute(from, to, profile);
```

(The `todo` filter already selects `mode === "drive" && routeStatus === "fallback"`, which covers both car and walk since `modeForVehicle(walk) === "drive"`.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pathing/geometry.ts src/lib/pathing/geometry.test.ts src/store/index.ts src/lib/constants.ts
git commit -m "feat(pathing): resilient OSRM routing — profiles (car/walk), timeout, retry"
```

---

### Task 6: Smart label collision avoidance

**Files:**
- Modify: `src/components/map/MapCanvas.tsx` (the `tr-waypoint-label` layer config)

**Interfaces:**
- Consumes: existing `WAYPOINT_SOURCE` features (unchanged), `applyFrame.waypointFeatures` reveal-on-arrival (unchanged).
- Produces: a decluttered label layer.

- [ ] **Step 1: Replace the label layer config**

```ts
map.addLayer({
  id: "tr-waypoint-label",
  type: "symbol",
  source: WAYPOINT_SOURCE,
  layout: {
    "text-field": ["get", "label"],
    "text-size": 15,
    "text-font": ["Open Sans Bold", "Noto Sans Bold", "Open Sans Regular"],
    "text-variable-anchor": ["top", "bottom", "left", "right"],
    "text-radial-offset": 0.9,
    "text-justify": "auto",
    // Let MapLibre's collision engine declutter: NO forced overlap.
    "text-allow-overlap": false,
    "text-ignore-placement": false,
    "text-optional": true,
  },
  paint: {
    "text-color": "#ffffff",
    "text-halo-color": "#0b1120",
    "text-halo-width": 2.2,
    "text-halo-blur": 0.4,
  },
});
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: success.

- [ ] **Step 3: Manual verification**

`npm run dev`; plot Jakarta + Bandung (close together). Confirm labels no longer overlap into a smear — one flips to a clear side, or declutters at low zoom and reappears when zoomed in.

- [ ] **Step 4: Commit**

```bash
git add src/components/map/MapCanvas.tsx
git commit -m "fix(map): declutter waypoint labels (collision engine + variable anchor)"
```

---

## Self-Review

- **Spec coverage:** A1 seamless trail → Tasks 2,3,4. A2 routing → Task 5. A3 labels → Task 6. Vitest → Task 1. ✓
- **Placeholder scan:** none — all steps carry concrete code/commands. ✓
- **Type consistency:** `buildRouteLine`, `routeProgress`, `ROUTE_SOURCE`, `setRouteGeometry`, `fetchRoute`, `routingProfileFor` used consistently across tasks. ✓
- **Cleanup:** Task 4 removes now-dead `TRAIL_SOURCE`/`trailFeature`/`pathFor` and the `trail-dot` sprite; `fetchDriveRoute` kept as a thin deprecated alias to avoid breaking other callers (only `store` uses it, updated in Task 5 — alias can be deleted later).
