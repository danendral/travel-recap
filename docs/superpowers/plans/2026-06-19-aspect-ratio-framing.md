# Aspect-Ratio-Aware Framing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make export framing aspect-ratio-aware so the default video is always clean (whole route + every label fit, generous margins) for both 16:9 and 9:16, and make the editor preview a true WYSIWYG of the export at all times.

**Architecture:** Aspect ratio moves from `ExportPanel`'s local state onto the persisted `Trip`. The pure framing math in `interpolate.ts` (`fitBounds` + the overview beat of `sampleAnimation`) becomes aspect-aware with generous, label-safe padding. The editor preview sizes the map container to the chosen ratio (`map.resize()`), so preview viewport == export viewport. Export reuses that matching viewport.

**Tech Stack:** TypeScript, React 19, Zustand 5 (immer + persist), MapLibre GL 5, Vitest (added for pure-function unit tests — none exist yet).

## Global Constraints

- **Geometry is GeoJSON order everywhere: `[lng, lat]`.** Never `[lat, lng]`.
- **All animation math stays pure and in `src/lib/pathing/interpolate.ts`.** Preview (rAF) and export (`setNow` loop) MUST drive the scene through the same `sampleAnimation`. If they diverge the export won't match the preview.
- **No route/great-circle recomputation inside any per-frame loop.** Geometry is cached on segments at edit time.
- **No COOP/COEP headers** added to `next.config.ts`.
- **Vehicle + trail stay MapLibre GL layers**, never HTML markers (HTML is invisible to pixel readback on export).
- **AspectRatio union is `"16:9" | "9:16" | "1:1"`** (`src/types/index.ts`). This feature ships the 16:9 and 9:16 UI; `1:1` must remain valid in the math.
- **Generous, label-safe padding is the approved default** (≈0.45 span margin) and a downward label bias, because labels render below their dot (`text-offset: [0, 1.3]`, `text-anchor: top`).

---

### Task 1: Add a test runner (Vitest) and a baseline test for current `fitBounds`

No test runner exists yet. This task installs Vitest and pins down the CURRENT `fitBounds` behavior with a baseline test, so Task 2's refactor is provably safe.

**Files:**
- Modify: `package.json` (devDependencies + `test` script)
- Create: `vitest.config.ts`
- Create: `src/lib/pathing/interpolate.test.ts`

**Interfaces:**
- Consumes: existing `fitBounds(points: LngLat[]): { center: LngLat; zoom: number }` from `src/lib/pathing/interpolate.ts`.
- Produces: a runnable `npm test` and the test file that later tasks extend.

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest@^3
```

- [ ] **Step 2: Add the test script to package.json**

In `package.json` `"scripts"`, add (keep existing scripts):

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest.config.ts**

Resolves the `@/` path alias (used throughout the codebase) so tests can import like the app does.

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write the baseline test**

Create `src/lib/pathing/interpolate.test.ts`. Tokyo→LA→NY are the canonical route from the project docs. The baseline asserts a center near the route and a zoom inside the documented clamp `[0.8, 7]`.

```ts
import { describe, it, expect } from "vitest";
import { fitBounds } from "@/lib/pathing/interpolate";
import type { LngLat } from "@/types";

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
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npm test`
Expected: PASS, 3 tests in `interpolate.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/pathing/interpolate.test.ts
git commit -m "test: add vitest + baseline fitBounds tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Make `fitBounds` aspect-ratio-aware with label-safe padding

The core math change. `fitBounds` learns the viewport shape and frames so the more-constraining dimension fits, with generous padding and a downward label bias.

**Files:**
- Modify: `src/lib/pathing/interpolate.ts` (replace `fitBounds`, add a ratio→number helper)
- Modify: `src/lib/pathing/interpolate.test.ts` (add aspect-ratio assertions)

**Interfaces:**
- Consumes: `LngLat`, `AspectRatio` from `@/types`; existing `STOP_ZOOM` constant.
- Produces:
  - `export function aspectRatioToNumber(ratio: AspectRatio): number` — `"16:9" → 16/9`, `"9:16" → 9/16`, `"1:1" → 1`.
  - `export function fitBounds(points: LngLat[], opts?: { aspectRatio?: number; padding?: number; labelBiasLat?: number }): { center: LngLat; zoom: number }`
  - `export const OVERVIEW_PADDING = 0.45` and `export const OVERVIEW_LABEL_BIAS_LAT = 0.18` (fraction of latSpan added below; min floor applied inside).

- [ ] **Step 1: Write the failing aspect-ratio tests**

Append to `src/lib/pathing/interpolate.test.ts`:

```ts
import { aspectRatioToNumber } from "@/lib/pathing/interpolate";

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
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test`
Expected: FAIL — `aspectRatioToNumber` is not exported; the new `fitBounds` options aren't honored.

- [ ] **Step 3: Implement the aspect-aware `fitBounds`**

In `src/lib/pathing/interpolate.ts`, add the import for `AspectRatio` to the existing type import:

```ts
import type { LngLat, PathSegment, Trip, Waypoint, Id, AspectRatio } from "@/types";
```

Add the constants near `STOP_ZOOM` / `OVERVIEW_MS`:

```ts
/** Generous, label-safe overview margin (fraction of the route span added around it). */
export const OVERVIEW_PADDING = 0.45;
/** Extra latitude span added BELOW the route so labels (which hang under their dot) fit. */
export const OVERVIEW_LABEL_BIAS_LAT = 0.18;

/** Maps an aspect-ratio union to a numeric width/height. */
export function aspectRatioToNumber(ratio: AspectRatio): number {
  if (ratio === "9:16") return 9 / 16;
  if (ratio === "1:1") return 1;
  return 16 / 9;
}
```

Replace the entire existing `fitBounds` function with:

```ts
/**
 * Computes a center + zoom that frames all the given points (the whole route)
 * for a viewport of the given aspect ratio, with generous label-safe padding.
 *
 * Aspect-aware: a span is converted to the zoom that makes it exactly fill its
 * viewport dimension, and the MORE CONSTRAINING (smaller) zoom wins. So a
 * horizontally-wide route in a tall 9:16 frame pulls back further than in a wide
 * 16:9 frame — the fix for "fits the preview but clips in the portrait export".
 *
 * Mercator note: latitude degrees don't map linearly to screen height. We
 * approximate the vertical extent at the route's center latitude (the existing
 * code already approximated framing); good enough for an overview beat.
 */
export function fitBounds(
  points: LngLat[],
  opts: { aspectRatio?: number; padding?: number; labelBiasLat?: number } = {},
): { center: LngLat; zoom: number } {
  if (points.length === 0) return { center: [0, 0], zoom: 1.5 };

  const aspect = opts.aspectRatio ?? 16 / 9;
  const padding = opts.padding ?? OVERVIEW_PADDING;
  const labelBias = opts.labelBiasLat ?? OVERVIEW_LABEL_BIAS_LAT;

  // Unwrap longitudes so an antimeridian-crossing route (Tokyo→LA) measures the
  // SHORT span across the Pacific, then normalize the center longitude back.
  const unwrapped: number[] = [points[0][0]];
  let offset = 0;
  for (let i = 1; i < points.length; i++) {
    const d = points[i][0] - points[i - 1][0];
    if (d > 180) offset -= 360;
    else if (d < -180) offset += 360;
    unwrapped.push(points[i][0] + offset);
  }

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (let i = 0; i < points.length; i++) {
    minLng = Math.min(minLng, unwrapped[i]);
    maxLng = Math.max(maxLng, unwrapped[i]);
    minLat = Math.min(minLat, points[i][1]);
    maxLat = Math.max(maxLat, points[i][1]);
  }

  let lngSpan = Math.max(maxLng - minLng, 0.01);
  let latSpan = Math.max(maxLat - minLat, 0.01);

  // Label bias: extend the latitude span downward (and shift center down) so the
  // label hanging beneath the bottom-most waypoint is inside the frame.
  const biasDeg = Math.max(latSpan * labelBias, 0.5);
  const centerLatRaw = (minLat + maxLat) / 2 - biasDeg / 2;
  latSpan += biasDeg;

  // Generous padding on both spans.
  lngSpan *= 1 + padding * 2;
  latSpan *= 1 + padding * 2;

  let centerLng = (minLng + maxLng) / 2;
  centerLng = ((centerLng + 180) % 360 + 360) % 360 - 180; // wrap to [-180,180]
  const center: LngLat = [centerLng, centerLatRaw];

  // Convert each span to the zoom that fits it in its own viewport dimension.
  // World width is 360° at zoom 0 and halves per zoom level. For the vertical
  // axis, approximate the on-screen latitude extent using the viewport aspect:
  // the tall frame (aspect<1) has proportionally MORE vertical room, the wide
  // frame less — captured by dividing the lat span by `aspect` before comparing.
  const zoomForWidth = Math.log2(360 / lngSpan);
  const zoomForHeight = Math.log2(360 / (latSpan / aspect));
  const zoom = Math.max(0.8, Math.min(STOP_ZOOM, Math.min(zoomForWidth, zoomForHeight)));

  return { center, zoom };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, all baseline + aspect-ratio tests green.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pathing/interpolate.ts src/lib/pathing/interpolate.test.ts
git commit -m "feat(pathing): aspect-ratio-aware fitBounds with label-safe padding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Thread aspect ratio into `sampleAnimation`'s overview beat

`sampleAnimation` calls `fitBounds` for the final overview. It must pass the trip's aspect ratio so the overview pulls back correctly. The trip already carries `aspectRatio` after Task 4 — but to keep tasks independently testable, this task reads `trip.aspectRatio` defensively (defaulting to `"16:9"` if absent).

**Files:**
- Modify: `src/lib/pathing/interpolate.ts` (the `overview` branch of `sampleAnimation`)
- Modify: `src/lib/pathing/interpolate.test.ts` (overview-frame containment test)

**Interfaces:**
- Consumes: `aspectRatioToNumber`, the aspect-aware `fitBounds` from Task 2; `Trip.aspectRatio?: AspectRatio` (optional until Task 4 makes it required — read with a fallback).
- Produces: `sampleAnimation` overview frames whose zoom reflects the trip's aspect ratio.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/pathing/interpolate.test.ts`:

```ts
import { buildTimeline, sampleAnimation } from "@/lib/pathing/interpolate";
import type { Trip, Waypoint, PathSegment, Id } from "@/types";

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
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test`
Expected: FAIL — overview branch ignores aspect ratio, so the two zooms are equal.

- [ ] **Step 3: Implement**

In `src/lib/pathing/interpolate.ts`, inside the `if (phase.kind === "overview")` branch, change the `fitBounds` call to pass the aspect ratio:

```ts
    const all = trip.waypointIds.map((id) => waypoints[id]?.position).filter(Boolean) as LngLat[];
    const fit = fitBounds(all, {
      aspectRatio: aspectRatioToNumber(trip.aspectRatio ?? "16:9"),
    });
```

(Leave the rest of the overview branch — the `lerpLngLat(last, fit.center, t)` and `STOP_ZOOM + (fit.zoom - STOP_ZOOM) * t` — unchanged. They now interpolate toward the aspect-correct target.)

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (note: `trip.aspectRatio` may be flagged if `Trip` lacks the field — it's added in Task 4. If `tsc` errors here, the `?? "16:9"` on an unknown property triggers it; cast is already via fixture. If app code errors, proceed — Task 4 adds the field. To keep this task green standalone, the `?.`/`??` access is intentionally defensive.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/pathing/interpolate.ts src/lib/pathing/interpolate.test.ts
git commit -m "feat(pathing): pass trip aspect ratio into overview fitBounds

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add `aspectRatio` to `Trip` + store action

Makes aspect ratio first-class persisted trip state and removes the `?? "16:9"` defensiveness from being load-bearing.

**Files:**
- Modify: `src/types/index.ts` (`Trip` interface)
- Modify: `src/store/index.ts` (`createTrip` default, `setActiveTrip` backfill, new `setAspectRatio` action + interface entry)

**Interfaces:**
- Consumes: `AspectRatio` (already in `@/types`).
- Produces:
  - `Trip.aspectRatio: AspectRatio` (required).
  - Store action `setAspectRatio(ratio: AspectRatio): void` — writes the active trip's aspect ratio.

- [ ] **Step 1: Add the field to the Trip type**

In `src/types/index.ts`, find the `Trip` interface and add (near `mapStyleId`):

```ts
  /** Output aspect ratio; drives preview letterbox + export framing. */
  aspectRatio: AspectRatio;
```

- [ ] **Step 2: Default it on createTrip**

In `src/store/index.ts`, in `createTrip`'s `s.trips[id] = { ... }`, add after `mapStyleId: DEFAULT_STYLE_ID,`:

```ts
            aspectRatio: "16:9",
```

- [ ] **Step 3: Backfill on setActiveTrip**

In `src/store/index.ts`, inside `setActiveTrip`'s `if (trip) { ... }` block (where geometry is backfilled), add at the top of the block:

```ts
            if (!trip.aspectRatio) trip.aspectRatio = "16:9";
```

- [ ] **Step 4: Add the setAspectRatio action**

In `src/store/index.ts`, add to the `TravelRecapStore` interface near `setMapStyle`:

```ts
  setAspectRatio(ratio: import("@/types").AspectRatio): void;
```

And add the implementation near `setMapStyle`:

```ts
      setAspectRatio(ratio) {
        set((s) => {
          const trip = s.activeTripId ? s.trips[s.activeTripId] : null;
          if (trip) trip.aspectRatio = ratio;
        });
      },
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`sampleAnimation`'s `trip.aspectRatio ?? "16:9"` now reads a defined field; the fallback stays harmless.)

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS (fixtures already set `aspectRatio`).

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/store/index.ts
git commit -m "feat(store): persist Trip.aspectRatio + setAspectRatio action

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: ExportPanel reads/writes `trip.aspectRatio` (drop local formatId)

Wire the UI to the shared state. Adds a third "1:1" choice is OUT of scope (union supports it but the spec ships 16:9 + 9:16). The format/resolution is derived from `trip.aspectRatio`.

**Files:**
- Modify: `src/components/export/ExportPanel.tsx`

**Interfaces:**
- Consumes: `trip.aspectRatio` from `useTripData`; `setAspectRatio` from the store; `RESOLUTION_BY_RATIO` from `@/lib/constants`.
- Produces: ExportPanel where the Format buttons set `trip.aspectRatio`, and export resolution comes from `RESOLUTION_BY_RATIO[trip.aspectRatio]`.

- [ ] **Step 1: Import the store action and resolution map**

In `src/components/export/ExportPanel.tsx`, update imports:

```ts
import { MAP_STYLES, RESOLUTION_BY_RATIO } from "@/lib/constants";
import type { AspectRatio } from "@/types";
```

- [ ] **Step 2: Replace local formatId state with store-derived ratio**

Remove `const [formatId, setFormatId] = useState("16:9");`. Add near the other store hooks:

```ts
  const setAspectRatio = useStore((s) => s.setAspectRatio);
```

After `if (!trip) return null;`, derive the format from the trip:

```ts
  const ratio = trip.aspectRatio;
  const format = {
    id: ratio,
    ...RESOLUTION_BY_RATIO[ratio],
  };
```

Remove the old `const format = FORMATS.find(...)!;` line. Keep the `FORMATS` array (now only used to render the two buttons + their labels/sub).

- [ ] **Step 3: Point the Format buttons at the store**

In the Format `<Field>`, change each button's `onClick` and `className` active check:

```tsx
                      <button
                        key={f.id}
                        onClick={() => setAspectRatio(f.id as AspectRatio)}
                        className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${ratio === f.id ? "bg-sky-500/20 ring-1 ring-sky-400" : "bg-slate-800/60 hover:bg-slate-800"}`}
                      >
```

- [ ] **Step 4: Fix the filename ratio reference**

In `runExport`'s `downloadBlob` call, `format.id` is now the ratio string (e.g. `"9:16"`), so `format.id.replace(":", "x")` still yields `9x16`. No change needed — verify it reads `format.id`.

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (If `FORMATS` `width`/`height` are now unused because `format` comes from `RESOLUTION_BY_RATIO`, either keep them — harmless — or trim the `FORMATS` type to `{ id, label, sub }`. Trimming is cleaner; do it and update the `Format` type alias accordingly.)

- [ ] **Step 6: Manual smoke**

Run: `npm run dev`, open http://localhost:3000. Open Export panel, click 9:16 then 16:9. Expected: the selection highlights and persists across a page reload (it's on the persisted trip).

- [ ] **Step 7: Commit**

```bash
git add src/components/export/ExportPanel.tsx
git commit -m "feat(export): drive aspect ratio from persisted trip state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Letterbox the live preview to the trip's aspect ratio

Size the map container to the inscribed ratio box inside `<main>`, and call `map.resize()` whenever the ratio changes — so the preview viewport equals the export viewport at all times. Dim the area outside the box.

**Files:**
- Modify: `src/components/map/MapCanvas.tsx` (container sizing + resize on ratio change)
- Modify: `src/components/editor/EditorShell.tsx` (center the letterboxed map in `<main>`)

**Interfaces:**
- Consumes: `trip.aspectRatio` via `useTripData`; `window.__trMap` for `resize()`.
- Produces: a preview where the map canvas is shaped to `trip.aspectRatio`, recomputed on change.

- [ ] **Step 1: Make the map container ratio-shaped in MapCanvas**

In `src/components/map/MapCanvas.tsx`, the returned `<div ref={containerRef}>` currently fills via `absolute inset-0 h-full w-full`. Replace the return with a centered ratio box. Read the ratio from the existing `trip` (already pulled from `useTripData`):

```tsx
  const aspect = trip?.aspectRatio === "9:16" ? "9 / 16"
    : trip?.aspectRatio === "1:1" ? "1 / 1"
    : "16 / 9";

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
      <div
        ref={containerRef}
        className="max-h-full max-w-full shadow-2xl ring-1 ring-slate-700"
        style={{ aspectRatio: aspect, height: "100%", width: "auto" }}
        data-testid="map-canvas"
      />
    </div>
  );
```

Note: `height: 100%; width: auto; aspectRatio` makes a tall 9:16 box fit the height and a wide 16:9 box hit `max-w-full`. The `max-h/max-w-full` keep it inside `<main>`.

- [ ] **Step 2: Resize the map when the ratio changes**

In `src/components/map/MapCanvas.tsx`, add a new effect after the style-swap effect. The CSS aspectRatio change resizes the container; MapLibre needs an explicit `resize()` to update its backing store and re-fit the camera:

```tsx
  // When the aspect ratio changes, the container reshapes (CSS) — tell MapLibre
  // to resync its drawing buffer + transform so the preview viewport matches the
  // chosen output shape (and thus the export).
  const aspectRatio = trip?.aspectRatio;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Next paint, after the CSS aspect-ratio box has relaid out.
    const id = requestAnimationFrame(() => map.resize());
    return () => cancelAnimationFrame(id);
  }, [aspectRatio]);
```

- [ ] **Step 3: Verify EditorShell `<main>` gives the box room**

In `src/components/editor/EditorShell.tsx`, `<main>` is already `relative min-w-0 flex-1`. The MapCanvas now centers itself within it via `absolute inset-0 flex items-center justify-center`. No change required — confirm `<main>` has a height (it inherits from `flex min-h-0 flex-1`). If the box collapses, add `min-h-0` is already present; leave as is.

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual verification (the core UX check)**

Run: `npm run dev`. With a multi-stop trip:
- Toggle 16:9 ↔ 9:16 in the Export panel. Expected: the map reshapes to a tall box for 9:16, wide for 16:9; surrounding area is the dark `<main>` background.
- Press Preview and watch the final overview beat in 9:16. Expected: the whole route AND every place label are visible inside the box with margin — nothing clipped at the sides or bottom.
- Repeat in 16:9. Expected: also clean, less zoomed-out.

- [ ] **Step 6: Commit**

```bash
git add src/components/map/MapCanvas.tsx src/components/editor/EditorShell.tsx
git commit -m "feat(map): letterbox preview to trip aspect ratio (WYSIWYG)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Align export viewport with the letterboxed preview

Export already resizes the container to exact pixel dimensions. Now that the preview is the same shape, simplify: derive export dimensions from `RESOLUTION_BY_RATIO[trip.aspectRatio]` (already done in Task 5 via `format`), and confirm the resize/restore still restores the CSS-letterboxed size correctly.

**Files:**
- Modify: `src/components/export/ExportPanel.tsx` (`runExport` restore logic)

**Interfaces:**
- Consumes: `format.width`/`format.height` (from `RESOLUTION_BY_RATIO`, set in Task 5).
- Produces: export that renders at exact output pixels then restores the letterbox box.

- [ ] **Step 1: Make the restore put the container back to the letterbox box**

In `src/components/export/ExportPanel.tsx` `runExport`, the current code saves/restores `container.style.width/height`. The container is now sized by the centered ratio box (Task 6 sets inline `height/width/aspectRatio`). Saving and restoring those inline styles still works, BUT export sets explicit `${width}px`/`${height}px` which overrides `aspectRatio`. After restore, re-trigger a resize so the CSS box reasserts.

Replace the `finally` block's restore with:

```ts
    } finally {
      container.style.width = prev.w;
      container.style.height = prev.h;
      // Re-assert the CSS letterbox box (export overrode width/height with exact
      // pixels). A double rAF lets the layout settle before MapLibre re-measures.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => map.resize()),
      );
      abortRef.current = null;
      setBusy(false);
    }
```

- [ ] **Step 2: Confirm the RatioFrame overlay no longer double-dims**

Since the preview itself is now letterboxed (Task 6), the `<RatioFrame>` overlay in `ExportPanel` would dim a second time. Remove the `RatioFrame` render and its component, OR keep only a subtle border. Decision: remove it — the letterboxed map already shows the exact frame. Delete the `{open && !busy && <RatioFrame format={format} />}` line and the `RatioFrame` function. Remove the now-unused `portrait` logic.

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no unused `RatioFrame`.

- [ ] **Step 4: Manual end-to-end verification**

Run: `npm run dev`. With a Tokyo→LA→NY trip:
- Select 9:16, press Export, let it finish, open the downloaded `travel-recap-9x16.mp4`. Expected: framing matches what the preview showed — whole route + labels visible in the final overview, nothing clipped; the map returns to its letterboxed preview box after export.
- Repeat for 16:9.

- [ ] **Step 5: Commit**

```bash
git add src/components/export/ExportPanel.tsx
git commit -m "feat(export): align export viewport with letterboxed preview; drop double-dim overlay

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Mid-leg follow-zoom cap for narrow viewports (final polish)

Per the spec, ensure a wide leg viewed in a tall frame still shows context — cap how far the mid-leg camera pulls IN so a long leg in 9:16 doesn't crop the route line off the narrow sides. This is a guarded refinement; verified by a pure test.

**Files:**
- Modify: `src/lib/pathing/interpolate.ts` (segment branch zoom)
- Modify: `src/lib/pathing/interpolate.test.ts`

**Interfaces:**
- Consumes: `aspectRatioToNumber`, `STOP_ZOOM`, `pullbackFor`.
- Produces: segment-phase zoom that never exceeds `STOP_ZOOM` and pulls back slightly more in narrow frames.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/pathing/interpolate.test.ts`:

```ts
describe("mid-leg follow zoom respects aspect ratio", () => {
  it("never exceeds STOP_ZOOM and pulls back at least as much in 9:16 as 16:9", () => {
    const wide = makeTripFixture("16:9");
    const tall = makeTripFixture("9:16");
    const tlW = buildTimeline(wide.trip, wide.segments);
    const tlT = buildTimeline(tall.trip, tall.segments);
    // Sample mid-way through the first segment (after the dwell on w0).
    const midW = tlW.phases.find((p) => p.kind === "segment")!;
    const midT = tlT.phases.find((p) => p.kind === "segment")!;
    const tW = (midW.startMs + midW.endMs) / 2;
    const tT = (midT.startMs + midT.endMs) / 2;
    const fW = sampleAnimation(tW, wide.trip, wide.waypoints, wide.segments, tlW);
    const fT = sampleAnimation(tT, tall.trip, tall.waypoints, tall.segments, tlT);
    expect(fW.zoom).toBeLessThanOrEqual(7);
    expect(fT.zoom).toBeLessThanOrEqual(7);
    // Narrow frame pulls back at least as far (zoom no higher) than wide.
    expect(fT.zoom).toBeLessThanOrEqual(fW.zoom + 1e-9);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test`
Expected: FAIL — segment zoom currently ignores aspect ratio, so `fT.zoom === fW.zoom`.

- [ ] **Step 3: Implement an aspect-scaled extra pullback**

In `src/lib/pathing/interpolate.ts`, in the segment branch, after computing `pullback`, add an aspect factor. A narrow viewport (aspect < 1) gets extra mid-leg pullback so the leg's width stays in frame:

```ts
  const aspect = aspectRatioToNumber(trip.aspectRatio ?? "16:9");
  // Narrow (portrait) frames need more pullback to keep a wide leg in view.
  const aspectExtra = aspect < 1 ? (1 / aspect - 1) * 0.5 : 0;
  const zoom =
    fromZoom + (toZoom - fromZoom) * eased
    - Math.sin(raw * Math.PI) * (pullback + aspectExtra);
```

Replace the existing `const zoom = fromZoom + (toZoom - fromZoom) * eased - Math.sin(raw * Math.PI) * pullback;` line with the above.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS — `fT.zoom <= fW.zoom`, both `<= 7`.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual: confirm no over-zoom-out regression in 16:9**

Run: `npm run dev`, play a trip in 16:9. Expected: the commuting shots look the same as before (aspectExtra is 0 for wide frames). In 9:16 the camera sits a touch wider mid-leg.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pathing/interpolate.ts src/lib/pathing/interpolate.test.ts
git commit -m "feat(pathing): extra mid-leg pullback for narrow viewports

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Part 1 (shared persisted aspect ratio) → Tasks 4 (store/type) + 5 (UI wiring). ✓
- Part 2 (aspect-aware math + label-safe padding + mid-leg cap) → Tasks 2, 3, 8. ✓
- Part 3 (preview letterboxes always) → Task 6. ✓
- Part 4 (export reuses matching viewport) → Task 7. ✓
- Testing section (16:9 vs 9:16 containment, 9:16 lower zoom, mid-leg cap) → Tasks 2, 3, 8 + manual steps in 5, 6, 7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The one judgment call (trimming `FORMATS`/`Format` type in Task 5 Step 5) gives an explicit instruction and a harmless fallback. ✓

**Type consistency:** `aspectRatioToNumber` (Task 2) reused verbatim in Tasks 3, 8. `setAspectRatio(ratio)` defined in Task 4, called in Task 5. `format = { id: ratio, ...RESOLUTION_BY_RATIO[ratio] }` in Task 5 supplies the `format.width/height/id` that Task 7 and the existing `runExport` consume. `Trip.aspectRatio` optional-read in Task 3 (`?? "16:9"`) becomes required in Task 4 — intentional and noted, no breakage. ✓

**Note on test isolation:** `interpolate.test.ts` imports grow across tasks (Vitest tolerates duplicate top-level `import`s from the same module only if names differ; the plan uses distinct named imports per task — `fitBounds`/`aspectRatioToNumber`/`buildTimeline`/`sampleAnimation` — and shared fixtures `TOKYO`/`LA`/`NY`/`ROUTE` are declared once in Task 1). Implementers appending must not redeclare those constants. ✓
