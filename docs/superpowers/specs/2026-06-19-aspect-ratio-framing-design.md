# Aspect-ratio-aware framing — clean default video, WYSIWYG preview

**Date:** 2026-06-19
**Status:** Approved, ready for implementation plan

## Problem

The animation math in `src/lib/pathing/interpolate.ts` is **viewport-blind**.
`fitBounds()` computes the final-overview zoom from a fixed heuristic
(`Math.max(lngSpan, latSpan * 1.6) * 1.5`) with uniform padding — it has no idea
whether the output frame is wide (16:9) or tall (9:16).

Meanwhile the export panel keeps the chosen aspect ratio in **local component
state** (`formatId` in `ExportPanel.tsx`), never writing it to the shared store.
So:

- The preview map renders at the editor's wide shape.
- The export canvas is resized to `720×1280` (tall) only at export time.
- Both are driven by the **same viewport-blind math**.

Consequences the user reported:

1. A route that fits the wide preview gets **clipped on the sides in a 9:16
   export** — "some location is seen on the preview but not in the video."
2. Place **labels get cut at the bottom edge.** Labels render *below* their dot
   (`text-offset: [0, 1.3]`, `text-anchor: top` in `MapCanvas.tsx`), so framing
   that fits the dot positions exactly clips the label hanging beneath the
   bottom-most waypoint.
3. The final zoomed-out overview can crop the route in portrait because
   `fitBounds` doesn't account for the tall viewport needing more zoom-out to
   fit a horizontally-wide route.

## Goal

The **default** export is clean and watchable with zero tuning, for every
aspect ratio: the whole route and every label always fit, with generous
label-safe margins. The preview is true WYSIWYG — the user watches the exact
frame that will render, **during preview**, not only after clicking Export.

## Design

### Part 1 — Aspect ratio becomes shared, persisted state

- Add `aspectRatio: AspectRatio` to the `Trip` interface (`src/types/index.ts`),
  defaulting to `"16:9"` on `createTrip`. Persisted (it's part of `trips`, which
  is already in `partialize`).
- Add a `setAspectRatio(ratio: AspectRatio)` store action that writes to the
  active trip.
- Backfill: trips loaded from older persisted schema without `aspectRatio` get
  `"16:9"` in `setActiveTrip` (alongside the existing geometry backfill).
- `ExportPanel` reads `trip.aspectRatio` and calls `setAspectRatio` instead of
  using local `formatId` state. This is the single source of truth driving the
  preview letterbox, the framing math, and the export resolution.

### Part 2 — Framing math becomes aspect-aware (the heart)

All changes stay **pure and inside `interpolate.ts`** (locked invariant: preview
and export share `sampleAnimation`).

`fitBounds` gains an options object:

```ts
fitBounds(points: LngLat[], opts?: {
  aspectRatio?: number;   // width / height of the viewport (default 16/9)
  padding?: number;       // fraction of span added as margin (default ~0.45, "generous")
  labelBiasLat?: number;  // extra latitude span added BELOW to keep labels on-screen
}): { center: LngLat; zoom: number }
```

Algorithm:

1. Compute `lngSpan` / `latSpan` from the (antimeridian-unwrapped) points, as
   today.
2. Extend `latSpan` downward by `labelBiasLat` and shift `center` lat down by
   half of it, so the label hanging below the bottom waypoint is inside the
   frame.
3. Apply `padding` as a multiplicative margin on both spans.
4. **Aspect-aware fit:** convert each span to the zoom that would make it exactly
   fill its corresponding viewport dimension, then take the **more constraining
   (smaller) zoom**:
   - horizontal constraint: `zoomForLngSpan = log2(360 / (lngSpan_padded))`
     adjusted by the viewport width fraction;
   - vertical constraint: `zoomForLatSpan` adjusted by the viewport height
     fraction (Web-Mercator: use the latitude-degree-to-world ratio).
   - A tall (9:16) viewport has a small width fraction → the horizontal
     constraint dominates for wide routes → it zooms out further. A wide (16:9)
     viewport flips it. This is exactly the fix.
5. Clamp to `[0.8, STOP_ZOOM]` as today.

`sampleAnimation(tMs, trip, waypoints, segments, timeline)` reads
`trip.aspectRatio`, maps it to a numeric `w/h`, and passes it into the overview
beat's `fitBounds` call. The follow/dwell shots stay centered on the vehicle and
are not reframed (they rarely clip), **except** we cap the mid-leg pull-in so a
wide leg viewed in a tall frame still shows surrounding context — verified by the
pure-pipeline test, not by eyeballing.

Mercator note: latitude degrees don't map linearly to screen at high latitudes.
For the zoom heuristic we approximate at the route's center latitude (good enough
for framing; the existing code already approximates). Document this in the
function.

### Part 3 — Preview letterboxes to the ratio, always

- A letterbox view-layer component sizes the **map container itself** to the
  inscribed box of `trip.aspectRatio` within the available editor area, and
  calls `map.resize()` whenever the ratio changes. The area outside the box is
  dimmed (reuse the existing `RatioFrame` dimming treatment), subtle when the
  export panel is closed, emphasized when open.
- Because the map's **actual viewport now matches the export shape during
  preview**, preview viewport == export viewport. Combined with Part 2's
  aspect-aware math, the preview is a pixel-faithful preview of the export.
- `map.resize()` on ratio change reuses the same resize dance `ExportPanel`
  already performs — but persistent, not just for the export window.

### Part 4 — Export reuses the matching viewport

- Since the preview already sizes the container to the export ratio, the export
  resize step in `ExportPanel.runExport` becomes a confirmation (set exact pixel
  dimensions, `resize`, `waitIdle`) rather than a reframe. Export and preview are
  guaranteed identical because they share both the math (aspect-aware
  `sampleAnimation`) and the viewport shape.
- Keep the explicit pixel-dimension set in export (the on-screen letterbox box is
  CSS-sized; export needs the exact `720×1280` backing-store size for the codec).

## What stays unchanged (invariants honored)

- All animation math remains **pure and in `interpolate.ts`**. The only new input
  is one scalar (aspect ratio) threaded through `sampleAnimation` → `fitBounds`.
- No route/great-circle recomputation inside the export loop.
- Preview and export keep driving the scene through the same
  `sampleAnimation` / `applyFrameToMap`.
- Vehicle + trail stay GL layers; no COOP/COEP headers added.

## Testing

- Extend the existing pure-pipeline test (Tokyo→LA→NY) to assert, for **both**
  `16:9` and `9:16`:
  - the overview frame's computed bounds contain every waypoint **plus** its
    label-bias margin (no point within `padding` of an edge);
  - `9:16` yields a lower (more zoomed-out) overview zoom than `16:9` for the same
    wide route (proves aspect-awareness);
  - mid-leg follow zoom never exceeds `STOP_ZOOM` and never pulls in past the cap.
- Manual: open the editor, toggle 16:9 ↔ 9:16, confirm the preview letterbox
  reshapes and the played-back overview keeps all labels on-screen in both; export
  each and confirm the MP4 matches the preview framing.

## Files touched

| File | Change |
| --- | --- |
| `src/types/index.ts` | `Trip.aspectRatio` |
| `src/store/index.ts` | default on create, backfill on activate, `setAspectRatio` |
| `src/lib/pathing/interpolate.ts` | aspect-aware `fitBounds`, thread ratio through `sampleAnimation`, label-bias + generous padding, mid-leg zoom cap |
| `src/components/export/ExportPanel.tsx` | read/write `trip.aspectRatio`; remove local `formatId` |
| Preview letterbox (new or in `MapCanvas`/editor shell) | size map container to ratio + `resize()` |
| Pure-pipeline test | aspect-ratio framing assertions |
