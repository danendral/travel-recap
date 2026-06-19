# Spec A — Map Visual Fidelity

_2026-06-19 · Travel Recap_

## Why

Three map-rendering defects make the product look amateur, undermining the
"better looking than Mult.dev" thesis:

1. **The route trail is not seamless.** A trip Jakarta → Bandung → Jakarta shows
   a *different-looking* trail in each phase: one dashing while a leg animates, a
   subtly different one once the vehicle arrives, and yet another once the next
   leg starts. It reads as "the route keeps changing." This is the headline bug.
2. **Place-name labels overlap** when stops are close together (Jakarta and
   Bandung are ~120 km apart, so their labels collide into an unreadable smear).
3. **Non-flight routes don't reliably follow real geography.** Drive/walk legs
   often fall back to a straight line that cuts across terrain, because the
   routing is best-effort against a flaky public server with no retry and the
   wrong profile for walking.

This spec makes the map output **seamless, legible, and geographically
truthful** — the visual quality bar for a world-class product.

## Root cause of the seamless-trail bug

The trail is drawn as a **MapLibre `symbol` layer with `symbol-placement:
line`** (dash icons spaced along a LineString). The comment in `MapCanvas.tsx`
claims this avoids dash re-flow — that reasoning is **wrong**.

`symbol-placement: line` lays its symbols out **starting from the first vertex
of the feature and stepping by `symbol-spacing`**. The trail's geometry is
**rebuilt every frame** by `trailFeature` (`applyFrame.ts`): it grows as the
vehicle advances, snaps to the full segment on arrival, and concatenates an
ever-longer polyline as legs complete. **Every time the LineString's length
changes, MapLibre re-lays the dashes from the start** — so individual dashes
land in different map positions in the moving phase vs. the settled phase vs.
after the next leg is appended. Same path, re-flowed dashes = the "different
route each phase" artifact.

The fix must remove the dependency between *animation progress* and *trail
geometry*. Geometry must be **stable**; progress must be expressed some other
way.

## Design

### A1 — Seamless trail via stable geometry + gradient reveal

**Principle: the route polyline never changes shape during playback.** Build the
full route once; reveal progress by moving a paint property, not by editing
geometry.

**Geometry (stable).** Add a pure helper `buildRouteLine(trip, segments,
waypoints)` in `interpolate.ts` that concatenates every segment's cached
geometry into **one continuous `[lng,lat][]` polyline for the whole trip**,
de-duplicating shared vertices at joins (the existing `pushSeg` logic, lifted
out of `applyFrame`). This is computed once per trip-shape change and is identical
in every animation phase.

**Reveal (per-frame, no geometry change).** The trail layer is a `line` layer
(not a symbol layer) with `lineMetrics: true` on its source so `line-gradient`
works. We express "how far along the whole route we are" as a single scalar
`routeProgress ∈ [0,1]` (fraction of total route **distance** traveled), then
set a `line-gradient` whose color/opacity steps from "traveled" to "upcoming" at
`routeProgress`:

```
line-gradient: interpolate(linear, line-progress,
  0,                 TRAVELED_COLOR,
  routeProgress,     TRAVELED_COLOR,
  routeProgress+eps, UPCOMING_COLOR,
  1,                 UPCOMING_COLOR)
```

Per frame we only call `setPaintProperty('tr-route', 'line-gradient', …)` with
the new `routeProgress`. The geometry source is set **once** (when the trip
shape changes), never per frame. No re-flow is possible.

> `line-progress` is normalized distance along the whole line, so the split
> point is geographically exact regardless of how vertices are distributed.

**Dashes (refined, seamless).** Per the product decision, dashes everywhere.
MapLibre cannot combine `line-gradient` and `line-dasharray` on **one** layer,
so the trail is a **layer stack** on the single stable source:

| Layer | Role |
| --- | --- |
| `tr-route-glow` | wide, blurred, low-opacity solid line — the soft glow underlay |
| `tr-route-upcoming` | thin dashed line, dim, full length — the "where it's going" track |
| `tr-route-traveled` | dashed line, bright, **clipped to `routeProgress`** via gradient-alpha |

The traveled vs. upcoming split is done by a `line-gradient` **alpha** ramp on a
single dashed line (dash pattern is identical along the whole line, so the
moving split never disturbs dash positions), OR by two stacked dashed layers
both using the gradient as a hard alpha mask. Implementation picks whichever
renders cleanest; both keep dashes pinned because geometry + dash array are
constant. Dash metrics: small rounded dashes, gap ≈ 1.5× dash, tuned at the
default zoom; `line-dasharray` is in line-width units so it stays proportional.

**`routeProgress` is pure math.** Add to `AnimationFrame` a single new field
`routeProgress: number` computed in `sampleAnimation` from cumulative segment
distances: completed segments contribute their full length; the active segment
contributes `segmentDrawProgress × itsLength`; divide by total route length.
During `dwell` it equals the cumulative length up to the arrived stop; during
`overview` it is `1`. This keeps the reveal continuous across every phase
boundary (no jump, because the same scalar is computed everywhere).

**Files touched:** `interpolate.ts` (add `buildRouteLine`, `routeProgress`),
`applyFrame.ts` (set route source once; per-frame set gradient only), 
`MapCanvas.tsx` (replace symbol-dash trail + `trail-dot` with the layer stack;
add `lineMetrics: true`), remove `public/trail-dot.svg` usage.

**Invariant preserved:** all per-frame writes still go through
`applyFrameToMap`; preview and export drive the identical gradient. No routing
or geometry work happens in the frame loop.

### A2 — Robust road routing for car & walk

Today drive routing hits the public OSRM demo server once, sequentially, with no
timeout/retry, always with the `driving` profile, and silently keeps a straight
line on failure (which looks broken on a city route).

**Changes in `geometry.ts`:**

- `fetchRoute(from, to, profile, signal)` where `profile ∈ {"driving","foot"}`.
  Car → `driving`, walk → `foot`. (Train/boat keep great-circle/straight; free
  rail/sea routing is unreliable and out of scope.)
- **Timeout** (e.g. 6 s via `AbortController`) and **one retry** on transient
  failure before giving up.
- A configurable **routing base URL** constant (`OSRM_BASE`) so a self-hosted /
  backend router can replace the demo server later without code changes — aligns
  with the "this becomes full-stack eventually" direction.
- On failure, keep the straight-line geometry **but mark `routeStatus:
  "fallback"`** so the UI can show the leg as *approximate* rather than implying
  it's a real road. (Currently `fallback` is silent.)

**Walk support in the store:** `modeForVehicle` keeps walk → `"drive"` mode for
geometry purposes today; introduce the routing *profile* derived from
`vehicleType` (`car→driving`, `walk→foot`) inside `upgradeDriveRoutes` so walk
legs fetch the foot network. Keep sequential fetching (rate limit) but make it
resilient: a failed leg doesn't abort the rest.

**Invariant preserved:** routing still runs at edit time, caches on
`segment.geometry`, never in the export loop.

### A3 — Smart label collision avoidance

The waypoint label layer currently forces `text-allow-overlap: true` +
`text-ignore-placement: true`, which is exactly why close stops smear together.

**Changes in `MapCanvas.tsx` (label layer):**

- Drop the forced-overlap flags so MapLibre's collision engine hides/declutters
  labels that would overlap.
- `text-variable-anchor: ["top","bottom","left","right"]` +
  `text-radial-offset` so a crowded label flips to whichever side is clear
  instead of stacking.
- Slightly smaller text, refined halo (and a subtle dark pill via a text
  background isn't natively supported on symbol layers without a sprite, so we
  use a strong halo for the premium-but-cheap look).
- Keep the **reveal-on-arrival** behavior (`label` filled only for visited
  stops) — that logic in `applyFrame.waypointFeatures` is unchanged; only the
  layer's placement config changes.

Trade-off accepted: when two stops are extremely close, one label may be hidden
at low zoom and reappear when zoomed in. That is correct, premium behavior
(Google/Apple maps do the same) and far better than an unreadable smear.

## Components / interfaces

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `buildRouteLine()` (`interpolate.ts`) | Pure: trip+segments → one stable polyline for the whole route | segment geometry |
| `routeProgress` field (`AnimationFrame`) | Pure: scalar 0..1 distance-fraction traveled | cumulative segment lengths |
| `applyFrameToMap()` (`applyFrame.ts`) | Set route source once; per-frame set `line-gradient` only | map, frame |
| route layer stack (`MapCanvas.tsx`) | glow + upcoming + traveled dashed lines on one source | stable source, `lineMetrics` |
| `fetchRoute()` (`geometry.ts`) | Resilient OSRM fetch w/ profile, timeout, retry | OSRM_BASE |
| label layer (`MapCanvas.tsx`) | Decluttered, variable-anchor place names | waypoint source |

## Testing

No test runner exists today (the "pure-pipeline test" in CLAUDE.md is aspirational).
This spec **adds Vitest** (per Next 16's testing guide) scoped to the pure math —
the highest-value regression net, since the trail bug lives there.

- `vitest` + `vite-tsconfig-paths` (for the `@/` alias); environment `node` for
  the pure-math suite (no jsdom needed).
- `npm test` script.

**Tests (all pure, deterministic):**

1. `buildRouteLine` concatenates segments into one polyline, de-dupes shared
   join vertices, preserves order, handles a single-segment and a 3-stop
   round-trip (Jakarta→Bandung→Jakarta).
2. `routeProgress` is **monotonically non-decreasing** across a full timeline
   sweep (the property that guarantees seamlessness — it can never jump back or
   discontinuously forward at a phase boundary). Sample the timeline at fine
   steps and assert `prog[i+1] >= prog[i]` and `0..1` bounds.
3. `routeProgress` endpoints: `0` at t=0, exactly `1` during overview, equals
   cumulative-length-fraction at each arrival.
4. `fetchRoute` profile selection + fallback shape (mock `fetch`): driving vs.
   foot URL, retry on transient failure, returns `null`/keeps straight line on
   hard failure.

Manual verification: run dev, plot Jakarta→Bandung→Jakarta, play through, and
confirm the trail is identical in moving/arrived/next-leg phases; labels don't
overlap; a car leg follows roads.

## Out of scope

- Train/boat real routing (rail/sea networks).
- Pill/leader-line labels (the heavier option) — variable-anchor declutter is
  enough; revisit only if collisions still read poorly.
- Camera/zoom retuning — unchanged here.

## Risk & mitigation

- **`line-gradient` + dashes incompatibility**: mitigated by the layer-stack
  composition (gradient does alpha masking; dashes live on the same stable
  source). If alpha-masking a dashed line proves visually weak, fall back to a
  bright dashed "traveled" layer whose **opacity** is gradient-driven over a dim
  full-length dashed "upcoming" layer — both on identical geometry, so still
  seamless.
- **OSRM demo flakiness**: timeout+retry+labeled fallback; `OSRM_BASE` constant
  lets us swap to a reliable router without touching call sites.
