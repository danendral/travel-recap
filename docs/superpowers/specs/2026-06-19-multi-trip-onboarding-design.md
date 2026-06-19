# Spec B — Multi-Trip & Onboarding

_2026-06-19 · Travel Recap_

## Why

Today the app behaves as a single-trip tool: `EditorShell` auto-creates or
adopts exactly one trip, and there is no way to keep several trips, switch
between them, or start a fresh one without destroying the current one. Real
travel creators make many recaps. We need **multiple saved trips with seamless,
delightful onboarding** — without sacrificing the "start creating in 2 seconds"
feel for first-timers. We also remove the placeholder "Client-side · MVP" header
text, which looks unfinished.

The store is already **normalized** (`trips`/`waypoints`/`segments` maps +
`activeTripId`), so the data layer mostly supports many trips already — the gaps
are lifecycle actions (rename/delete/duplicate), a dashboard UI, routing, and a
first-run experience.

## Design

### B1 — Trip lifecycle in the store

Add to the Zustand store (`src/store/index.ts`):

- `renameTrip(tripId, name)` — also stamps `updatedAt`.
- `deleteTrip(tripId)` — removes the trip, its waypoints (revoking any photo
  object URLs), and its segments; if it was active, pick another trip or `null`.
- `duplicateTrip(tripId)` — deep-clone a trip with fresh ids (waypoints +
  segments + cached geometry preserved so the copy is instantly playable);
  appends "(copy)" to the name. Useful and cheap given the normalized model.
- **Auto-name from first stop**: when the first waypoint is added to a trip
  still named the default ("Untitled trip"), set the name to `Trip to <label>`
  (editable anytime). Implemented in `addWaypoint`.
- Default new-trip name becomes **"Untitled trip"** (was "My trip").
- Selectors: `useTripList()` returning trips sorted by `updatedAt` desc with a
  derived summary per trip: `{ id, name, stopCount, updatedAt, routeSummary }`
  where `routeSummary` is the first→…→last labels joined with "→" (truncated).

Persistence (`partialize`) is unchanged in shape — it already persists all
trips/waypoints/segments — so multi-trip "just works" across reloads.

### B2 — Routing: dashboard at `/`, editor at `/trip/[id]`

Move from the single-page app to App Router pages (Next 16; `params` is a
Promise, client pages read it via `use()` / `useParams()`):

- `src/app/page.tsx` → **Trips dashboard** (`<TripsDashboard/>`). Server shell +
  client grid (store is client-only/`localStorage`, so the grid is a client
  component gated on hydration, mirroring `EditorShell`'s existing hydration
  guard).
- `src/app/trip/[id]/page.tsx` → **Editor** for that trip. Reads `id`, calls
  `setActiveTrip(id)` once hydrated; if the id doesn't exist after hydration,
  redirect to `/` (e.g. a stale/bookmarked deleted trip). Renders the existing
  `EditorShell` (refactored to take the active id from the route instead of
  auto-creating).
- Navigation via `next/link` `<Link>` for instant client transitions; a
  `loading.tsx` under `/trip/[id]` for the partial-prefetch skeleton.

`EditorShell` is refactored: it no longer owns trip creation/adoption. It
becomes "render the editor for the active trip"; the **route** owns which trip
is active. The hydration-wait logic moves to a small shared hook
(`useHydratedStore`) reused by both the dashboard and the editor page.

### B3 — Onboarding: straight into the editor, with a sample trip

First-run flow (the "wow in 2 seconds" requirement):

- On **first ever visit** (no trips in storage), seed an **iconic multi-mode
  sample trip** (a short, pretty route mixing a flight + a train + a drive
  across recognizable cities) and **navigate the user straight into its
  editor** (`/trip/<sampleId>`), pre-plotted and immediately playable — they can
  hit Play and see the magic at once. A small, dismissible "This is a sample —
  start your own" affordance links to "+ New trip".
- Seeding is **idempotent and one-time**: a persisted `hasSeeded` flag (added to
  the persisted slice) prevents re-seeding after the user deletes the sample.
- A returning user with trips lands on `/` (dashboard). A user who navigates to
  `/` with zero trips and `hasSeeded` already true sees the **empty-state CTA**
  ("Create your first trip"), not another auto-seed.
- The sample trip lives in `src/lib/sampleTrip.ts` as pure data (waypoints +
  per-segment vehicle types), converted into store entities by a
  `seedSampleTrip()` store action that reuses the normal add/createTrip paths so
  geometry resolves exactly like a user-made trip.

### B4 — Trips dashboard UI

`src/components/dashboard/TripsDashboard.tsx` + `TripCard.tsx`:

- Header: refined "Travel Recap" brand mark (polished type + a cleaner logo
  treatment than the raw emoji), and a primary **"+ New trip"** button that
  creates a trip and routes to its editor.
- Responsive **card grid**. Each `TripCard` shows: **name** (inline-editable),
  **stop count**, **last-edited** (relative time), **route summary**
  (Tokyo → Kyoto → Osaka, truncated), and a **mini map thumbnail**.
- Card actions (on hover / overflow menu): Open, Rename, Duplicate, Delete.
  **Delete uses a confirmation dialog**, then permanently removes.
- **Empty state** (zero trips, already seeded): centered illustration + copy +
  big "Create your first trip" CTA.

### B5 — Mini map thumbnails (client-side now, backend-ready)

Thumbnails are generated client-side and cached locally, behind an interface
that a backend can later implement:

- `ThumbnailStore` interface: `get(tripId, signature): Promise<string|null>` /
  `set(tripId, signature, dataUrl)`. `signature` is a hash of the trip's
  waypoint positions + styleId so a stale thumbnail is invalidated when the
  route changes.
- Implementation now: `LocalThumbnailStore` backed by **IndexedDB** (data URLs
  can exceed localStorage quota; IndexedDB is the right local store and maps
  cleanly to a future server blob store).
- Generation: a lightweight **static route render** — draw the route polyline
  (reusing `buildRouteLine` from Spec A) onto a small offscreen `<canvas>` with
  a styled background and the stop dots. This avoids spinning up a second
  MapLibre/GL context per card (cheap, fast, deterministic) and is good enough
  for a card-sized preview. A real map snapshot can replace the renderer later
  behind the same interface without touching cards.
- Cards consume thumbnails via a `useTripThumbnail(trip)` hook that returns the
  cached data URL or triggers generation; a tasteful gradient placeholder shows
  while generating or if generation fails.

> Spec B depends on Spec A's `buildRouteLine` for the thumbnail renderer, so
> **Spec A ships first.**

## Components / interfaces

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| store lifecycle actions | rename/delete/duplicate/seed, auto-name | normalized store |
| `useTripList()` (selectors) | sorted trip summaries for the dashboard | store |
| `useHydratedStore()` | shared "wait for persist hydration" gate | zustand persist |
| `app/page.tsx` | dashboard route | TripsDashboard |
| `app/trip/[id]/page.tsx` | editor route, sets active trip from URL | EditorShell, store |
| `TripsDashboard` / `TripCard` | grid, card, actions, empty state | useTripList, thumbnails |
| `sampleTrip.ts` + `seedSampleTrip()` | one-time iconic demo seed | store add paths |
| `ThumbnailStore` + `LocalThumbnailStore` | cache abstraction (backend-ready) | IndexedDB |
| `useTripThumbnail()` | generate/cache/serve a card preview | buildRouteLine, store |

## Data model changes

- `Trip`: no shape change required (name/updatedAt/createdAt already present).
- Persisted slice gains a `hasSeeded: boolean` flag (top-level store field, in
  `partialize`).
- New `vehicleProfile` mapping (`car→driving`, `walk→foot`) is owned by Spec A;
  Spec B only consumes existing entities.

## Testing

Extend the Vitest suite added in Spec A:

1. `duplicateTrip` produces all-fresh ids (no id collisions with the original),
   identical geometry/labels, name suffixed.
2. `deleteTrip` removes the trip + its waypoints + its segments, revokes object
   URLs, and reassigns/clears `activeTripId` correctly.
3. Auto-name: first stop added to an "Untitled trip" renames to `Trip to
   <label>`; a user-renamed trip is **not** overwritten.
4. `useTripList` ordering (updatedAt desc) and `routeSummary` formatting.
5. Thumbnail `signature` changes iff route geometry/style changes (cache
   invalidation correctness).

Component smoke tests (jsdom) for `TripCard` (renders name/stops/summary, fires
delete-confirm) are nice-to-have; pure-logic tests above are the priority.

Manual verification: fresh load seeds + opens the sample trip; create/rename/
duplicate/delete from the dashboard; reload persists everything; deleting the
sample and reloading does **not** re-seed.

## Out of scope

- Auth / real backend / server persistence (designed-for, not built).
- Real GL map-snapshot thumbnails (interface ready; static renderer ships now).
- Sharing / public trip URLs (routes are structured to allow it later).

## Risk & mitigation

- **Hydration races** (store is `localStorage`, pages are RSC by default):
  centralize the hydration gate in `useHydratedStore`; render a loading state
  until hydrated; never create/seed before hydration (existing pattern).
- **Stale bookmarked trip id**: editor route redirects to `/` if the id is
  absent post-hydration.
- **IndexedDB unavailability** (private mode): thumbnail store degrades to the
  gradient placeholder; never blocks the dashboard.
