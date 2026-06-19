@AGENTS.md

# Travel Recap

A zero-config map-animation tool for travel creators: plot a trip, animate the
camera flying the route over a map, and export an MP4 for Reels/TikTok/Shorts.
Competes with Mult.dev on being **cheaper to run, easier to use, and better
looking**.

## Core strategy (why the architecture is what it is)

- **100% client-side rendering.** Export happens in the user's browser, not on a
  server. Near-$0 to run, infinite scale, and structurally immune to the "server
  overloaded" export errors that plague Mult.dev. This is the whole economic
  thesis — don't add a render farm.
- **Monetization gates output, not compute:** free tier gets a watermark + 720p;
  paid removes the watermark and unlocks 1080p/4K + 60fps. The only server we run
  is a tiny Stripe checkout/entitlement endpoint.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript — see `AGENTS.md`: this Next
  version may differ from training data; check `node_modules/next/dist/docs/`.
- Tailwind CSS v4 (`@import "tailwindcss"` in `globals.css`).
- Zustand 5 (`persist` + `immer` middleware) for state.
- MapLibre GL JS 5 for the map (open-source; free tiles → the "cheaper" lever).
- Mediabunny for client-side WebCodecs encode + MP4/WebM mux (replaces the
  deprecated `mp4-muxer`/`webm-muxer`). ffmpeg.wasm is a lazy last-resort
  fallback only.
- `@turf/turf` (great-circle flight arcs), `exifr` (EXIF GPS auto-import).

## Architecture map

| Concern | File |
| --- | --- |
| Domain types | `src/types/index.ts` |
| Store (normalized: entity maps + ordered id arrays) | `src/store/index.ts` |
| Store selectors | `src/store/selectors.ts` |
| **Shared animation math `f(t)`** | `src/lib/pathing/interpolate.ts` |
| Map component (owns the MapLibre instance) | `src/components/map/MapCanvas.tsx` |
| Preview playback loop (rAF) | `src/lib/map/usePlayback.ts` |
| Editor shell / sidebar / transport | `src/components/editor/`, `src/components/timeline/` |
| Constants (map style, durations, resolutions) | `src/lib/constants.ts` |
| Cross-origin isolation headers | `next.config.ts` |

## Non-obvious conventions & gotchas

- **Geometry is GeoJSON order everywhere: `[lng, lat]`.** Not `[lat, lng]`.
- **Preview and export MUST share `sampleAnimation()` in `interpolate.ts`.** The
  rAF preview loop and the (future) deterministic `setNow()` export loop both
  drive the camera through the same pure functions. If they diverge, the
  exported video won't match the preview. Keep all animation math pure and in
  that one file.
- **Routing/great-circle geometry is computed at edit time and cached on the
  segment (`PathSegment.geometry`).** Never compute routes inside the export
  loop (it runs ~1800× for a 30s/60fps clip).
- **The map is published on `window.__trMap`** so the playback hook and export
  pipeline can drive the camera imperatively without prop-drilling a ref.
- **`canvasContextAttributes: { preserveDrawingBuffer: true }`** is set on the
  map — required to read pixels back off the WebGL canvas during export.
- **NO COOP/COEP headers** (`next.config.ts` is intentionally empty). COEP
  `require-corp` blocks the OSM tiles / glyph fonts / Photon (none send
  `Cross-Origin-Resource-Policy`) → blank map. The primary export path
  (WebCodecs + Mediabunny) does NOT need cross-origin isolation; only the
  threaded ffmpeg.wasm *fallback* does, and we'll proxy assets same-origin if/
  when we wire it up. Don't re-add these headers without same-origin-proxying
  every remote map asset first.
- **The trail is ONE stable full-route polyline; progress is a `line-gradient`,
  NOT growing geometry.** `buildRouteLine()` concatenates the whole route once;
  `setRouteGeometry` sets the `tr-route` source (needs `lineMetrics: true`) only
  when the trip *shape* changes. Per frame, `applyFrameToMap` moves a single
  gradient stop using `AnimationFrame.routeProgress` (a pure, monotonic 0..1
  distance-fraction). NEVER rebuild trail geometry per frame — that re-flows the
  dashes and brings back the "different route in each playback phase" bug. The
  monotonicity of `routeProgress` is guarded by a Vitest property test.
- **The vehicle is a MapLibre `symbol` layer, NOT an HTML `Marker`.** HTML
  markers are CSS siblings of the canvas and are invisible to pixel readback —
  they would not appear in the exported video. Keep the vehicle (and trail) as
  GL layers so export captures them.
- **Per-frame map writes go through `applyFrameToMap` (`src/lib/map/applyFrame.ts`)**,
  shared by the playback rAF loop, the scrubber, and (later) the export loop —
  so all three render identically. It only `setData`s tiny GeoJSON collections;
  never set React state or layout properties per frame. Use `map.jumpTo` in the
  loop, never `easeTo`/`flyTo` (those double-animate and stutter).
- **Vehicle SVGs (`public/vehicles/*.svg`) are drawn pointing UP (north)** so
  `icon-rotate = vehicleBearing` (turf bearing, CW from north) aligns them to
  heading directly.
- **`DEFAULT_MAP_STYLE` is a `StyleSpecification` object** (not a URL): OSM
  raster + `fonts.openmaptiles.org` glyphs. `Trip.mapStyleId` holds a style id
  (currently unused until the style picker lands).
- **Store persistence:** only `trips/waypoints/segments/activeTripId` are
  persisted (see `partialize`). Object URLs, File blobs, and all
  playback/export transient state are intentionally excluded. `EditorShell`
  waits for `persist.onFinishHydration` before creating a trip to avoid
  duplicating a saved one.

## Build sequence (status)

- [x] Slice 0 — Skeleton: MapLibre map, pan/zoom.
- [x] Slice 1 — Plot waypoints (click OR location search) + **real animation**:
      vehicle icon travels great-circle arcs, rotates to heading, trail draws,
      camera follows; per-segment vehicle type (plane/car/train/boat/walk);
      scrubber. Verified via the pure-pipeline test (Tokyo→LA→NY).
- [ ] Slice 2 — Export MVP: deterministic capture → WebCodecs H.264 →
      Mediabunny → MP4 download. **Riskiest piece — do next.** The vehicle is
      already a GL symbol layer (captures on readback) and `applyFrameToMap` is
      reusable by the export loop, so this should slot in cleanly.
- [x] Slice 3 (partial) — Pathing: turf great-circle flight arcs (done) + OSRM
      car/walk routing with profiles, timeout, retry (done). Train/boat stay
      smooth lines. **Seamless trail reworked**: one stable full-route polyline
      revealed by a `line-gradient` (`buildRouteLine` + `routeProgress`) — see
      `docs/superpowers/specs/2026-06-19-map-visual-fidelity-design.md`.
- [x] Multi-trip + onboarding — dashboard at `/`, editor at `/trip/[id]`, trip
      rename/delete/duplicate, first-run sample-trip seeding, backend-ready
      thumbnails — see `docs/superpowers/specs/2026-06-19-multi-trip-onboarding-design.md`.
- [ ] Slice 4 — EXIF photo drop → auto-plot route.
- [ ] Slice 5 — Timeline polish + 9:16 / 1:1 aspect ratios.
- [ ] Slice 6 — Monetize (watermark, caps, Stripe) + PWA + harden.

Full plan: `C:\Users\ASUS\.claude\plans\toasty-soaring-torvalds.md`.
Recent specs/plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`.

## Commands

- `npm run dev` — dev server (Turbopack) at http://localhost:3000
- `npm run build` — production build (also runs typecheck + lint)
- `npx tsc --noEmit` — fast type-check
- `npm test` — Vitest (pure pathing / store / selector / thumbnail math)
