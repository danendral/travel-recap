# Multi-Trip & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users keep, switch, and manage multiple trips via a dashboard, with a delightful first-run that drops them straight into a playable sample trip.

**Architecture:** The store is already normalized, so multi-trip is mostly lifecycle actions + UI. Move from a single page to App Router routes (`/` dashboard, `/trip/[id]` editor). Seed an iconic sample trip once on first run. Generate card thumbnails client-side behind a backend-ready interface.

**Tech Stack:** Next 16 App Router (`params` is a Promise; client pages use `use()`/`useParams()`), React 19, Zustand 5 (persist+immer), IndexedDB, Vitest.

## Global Constraints

- Geometry is GeoJSON `[lng, lat]` order everywhere.
- Store persists only `trips/waypoints/segments/activeTripId` (+ new `hasSeeded`); object URLs/blobs and transient playback/export state are never persisted.
- Wait for `persist.onFinishHydration` before creating/seeding trips (no duplicates).
- Default new-trip name: **"Untitled trip"**.
- Delete is **confirm-then-permanent**.
- **Depends on Plan A** (`buildRouteLine` is reused by the thumbnail renderer) — ship Plan A first.
- Brand stays **"Travel Recap"**; refine the logo mark.

---

### Task 1: Store lifecycle actions (rename / delete / duplicate / auto-name)

**Files:**
- Modify: `src/store/index.ts`
- Test: `src/store/store.test.ts`

**Interfaces:**
- Produces: `renameTrip(tripId, name)`, `deleteTrip(tripId)`, `duplicateTrip(tripId): Id`, and auto-name behavior inside `addWaypoint`. New persisted field `hasSeeded: boolean` + `markSeeded()`.

- [ ] **Step 1: Failing tests** (`src/store/store.test.ts`) — use `useStore.getState()` / `setState` to drive the vanilla store directly. Cover: rename updates name+updatedAt; delete removes trip+its waypoints+segments and clears/reassigns activeTripId; duplicate yields fresh ids (assert no id overlap) with same labels/geometry and "(copy)" suffix; adding the first waypoint to an "Untitled trip" sets name to `Trip to <label>`, but a renamed trip is untouched.

- [ ] **Step 2: Run → fails.** `npm test`

- [ ] **Step 3: Implement actions** in the store interface + immer body:

```ts
renameTrip(tripId, name) {
  set((s) => { const t = s.trips[tripId]; if (t) { t.name = name; t.updatedAt = now(); } });
},
deleteTrip(tripId) {
  set((s) => {
    const t = s.trips[tripId]; if (!t) return;
    for (const wid of t.waypointIds) {
      const wp = s.waypoints[wid];
      if (wp?.photo?.objectUrl) URL.revokeObjectURL(wp.photo.objectUrl);
      delete s.waypoints[wid];
    }
    for (const sid of t.segmentIds) delete s.segments[sid];
    delete s.trips[tripId];
    if (s.activeTripId === tripId) {
      s.activeTripId = Object.keys(s.trips)[0] ?? null;
    }
  });
},
duplicateTrip(tripId) {
  const newId = uid();
  set((s) => {
    const t = s.trips[tripId]; if (!t) return;
    const idMap = new Map<Id, Id>();
    const waypointIds = t.waypointIds.map((wid) => {
      const nid = uid(); idMap.set(wid, nid);
      const wp = s.waypoints[wid];
      // Drop the object URL (not clonable/persisted); keep thumbDataUrl.
      s.waypoints[nid] = { ...wp, id: nid, photo: wp.photo ? { ...wp.photo, objectUrl: "" } : undefined };
      return nid;
    });
    const segmentIds = t.segmentIds.map((sid) => {
      const nsid = uid(); const seg = s.segments[sid];
      s.segments[nsid] = { ...seg, id: nsid, fromWaypointId: idMap.get(seg.fromWaypointId)!, toWaypointId: idMap.get(seg.toWaypointId)!, geometry: seg.geometry ? [...seg.geometry] : undefined };
      return nsid;
    });
    s.trips[newId] = { ...t, id: newId, name: `${t.name} (copy)`, waypointIds, segmentIds, createdAt: now(), updatedAt: now() };
  });
  return newId;
},
markSeeded() { set((s) => { s.hasSeeded = true; }); },
```

Auto-name in `addWaypoint` (after pushing the waypoint, before rederive):
```ts
if (trip.waypointIds.length === 1 && (trip.name === "Untitled trip" || trip.name === "My trip")) {
  trip.name = `Trip to ${wp.label}`;
}
```
Change `createTrip` default to `"Untitled trip"`. Add `hasSeeded: false` to initial state and to `partialize`.

- [ ] **Step 4: Run → passes.** `npm test`

- [ ] **Step 5: Commit.** `git commit -m "feat(store): trip rename/delete/duplicate + auto-name + hasSeeded"`

---

### Task 2: `useTripList` selector with summaries

**Files:**
- Modify: `src/store/selectors.ts`
- Test: `src/store/selectors.test.ts`

**Interfaces:**
- Produces: `useTripList(): TripSummary[]` and pure `tripSummaries(state): TripSummary[]` where `TripSummary = { id; name; stopCount; updatedAt; routeSummary }`, sorted by `updatedAt` desc. `routeSummary` = first→middle→last labels joined " → ", truncated to ~3 with "…".

- [ ] **Step 1: Failing test** for `tripSummaries`: ordering by updatedAt desc; stopCount = waypoint count; routeSummary formatting for 2 and 5 stops.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** a pure `tripSummaries(state)` (so it's testable without React) + a thin `useTripList()` hook that selects the slices and memoizes. Build `routeSummary` from `trip.waypointIds.map(id => waypoints[id]?.label)`; if >3 stops show `first → … → last`.

- [ ] **Step 4: Run → passes.**

- [ ] **Step 5: Commit.** `git commit -m "feat(store): useTripList trip summaries selector"`

---

### Task 3: `useHydratedStore` shared hydration gate

**Files:**
- Create: `src/store/useHydratedStore.ts`
- Modify: `src/components/editor/EditorShell.tsx` (use it; stop owning trip creation)

**Interfaces:**
- Produces: `useHydratedStore(): boolean` — true once `persist.onFinishHydration` fired (or already hydrated). Reused by dashboard + editor route.

- [ ] **Step 1:** Implement the hook (lift the existing `useEffect`/`onFinishHydration` logic from `EditorShell`).
- [ ] **Step 2:** Refactor `EditorShell` to accept the active trip from the route (it renders the editor for `activeTripId`; no auto-create). Remove the "Client-side · MVP" `<span>`. Add a back-to-dashboard `<Link href="/">` on the brand, and show the trip name (inline-editable via `renameTrip`).
- [ ] **Step 3:** `npx tsc --noEmit` → clean.
- [ ] **Step 4: Commit.** `git commit -m "refactor(editor): route-driven active trip; remove MVP label; hydration hook"`

---

### Task 4: Sample trip data + one-time seeding

**Files:**
- Create: `src/lib/sampleTrip.ts`
- Modify: `src/store/index.ts` (`seedSampleTrip(): Id`)
- Test: `src/store/store.test.ts` (extend)

**Interfaces:**
- Produces: `SAMPLE_TRIP: { name; stops: { label; position: LngLat }[]; vehicles: VehicleType[] }` (an iconic multi-mode route: a flight + a train + a drive across recognizable cities, e.g. Tokyo ✈ Seoul, Seoul 🚆 Busan, ... chosen so it's pretty and short). `seedSampleTrip(): Id` builds it via the normal createTrip/addWaypoint/setSegmentVehicle paths and returns the new trip id.

- [ ] **Step 1: Failing test:** `seedSampleTrip` creates one trip with N stops and the specified per-segment vehicle types; geometry resolves (segments get `geometry`); sets `hasSeeded`.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** `SAMPLE_TRIP` (pick 4 iconic stops, mixed vehicles) and `seedSampleTrip` (create trip → add each waypoint → set each segment's vehicle → `markSeeded()` → return id).
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit.** `git commit -m "feat(onboarding): iconic multi-mode sample trip + one-time seeding"`

---

### Task 5: Routing — dashboard `/` and editor `/trip/[id]`

**Files:**
- Modify: `src/app/page.tsx` (→ dashboard)
- Create: `src/app/trip/[id]/page.tsx`
- Create: `src/app/trip/[id]/loading.tsx`

**Interfaces:**
- Consumes: `useHydratedStore`, store actions, `TripsDashboard` (Task 6).
- Produces: `/` renders dashboard with first-run seeding+redirect; `/trip/[id]` sets active trip and renders `EditorShell`.

- [ ] **Step 1:** `/trip/[id]/page.tsx` — client component; read `id` via `use(params)`; gate on `useHydratedStore`; if hydrated and `trips[id]` missing → `useRouter().replace("/")`; else `setActiveTrip(id)` and render `<EditorShell />`. Add a minimal `loading.tsx` skeleton.
- [ ] **Step 2:** `/page.tsx` — client dashboard wrapper: gate on hydration; on first run (`!hasSeeded && no trips`) call `seedSampleTrip()` then `router.replace('/trip/'+id)`; otherwise render `<TripsDashboard />`.
- [ ] **Step 3:** `npx tsc --noEmit && npm run build` → success (verify `[id]` param is awaited/`use()`d correctly for Next 16).
- [ ] **Step 4: Commit.** `git commit -m "feat(routing): dashboard at / and editor at /trip/[id]"`

---

### Task 6: Trips dashboard + cards + delete confirm + empty state

**Files:**
- Create: `src/components/dashboard/TripsDashboard.tsx`
- Create: `src/components/dashboard/TripCard.tsx`
- Create: `src/components/dashboard/ConfirmDialog.tsx`

**Interfaces:**
- Consumes: `useTripList`, `createTrip`, `deleteTrip`, `duplicateTrip`, `renameTrip`, `useTripThumbnail` (Task 7), `next/link`, `useRouter`.
- Produces: the dashboard UI.

- [ ] **Step 1:** `TripsDashboard` — header (refined brand mark + "+ New trip" → `createTrip()` then route to its editor), responsive card grid from `useTripList()`, and an **empty state** (zero trips) with a big "Create your first trip" CTA.
- [ ] **Step 2:** `TripCard` — thumbnail, name (inline-edit on double-click → `renameTrip`), stop count, relative last-edited, route summary; hover actions Open/Duplicate/Delete. Delete opens `ConfirmDialog`; confirm → `deleteTrip`.
- [ ] **Step 3:** `ConfirmDialog` — accessible modal (focus trap optional), title/body/confirm/cancel.
- [ ] **Step 4:** Build + manual check: create/rename/duplicate/delete; reload persists.
- [ ] **Step 5: Commit.** `git commit -m "feat(dashboard): trips grid, cards, delete-confirm, empty state"`

---

### Task 7: Backend-ready thumbnails (IndexedDB + canvas renderer)

**Files:**
- Create: `src/lib/thumbnails/ThumbnailStore.ts` (interface + `LocalThumbnailStore`)
- Create: `src/lib/thumbnails/renderRouteThumbnail.ts`
- Create: `src/lib/thumbnails/useTripThumbnail.ts`
- Test: `src/lib/thumbnails/signature.test.ts`

**Interfaces:**
- Produces: `interface ThumbnailStore { get(tripId, signature): Promise<string|null>; set(tripId, signature, dataUrl): Promise<void> }`; `thumbnailSignature(trip, waypoints): string` (hash of positions+styleId); `renderRouteThumbnail(line: LngLat[], opts): string` (data URL via offscreen canvas, reuses `buildRouteLine`); `useTripThumbnail(trip): string | null`.

- [ ] **Step 1: Failing test** for `thumbnailSignature`: stable for unchanged route; changes when a waypoint moves or styleId changes.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** signature (cheap string hash of rounded coords + styleId), `LocalThumbnailStore` (IndexedDB with in-memory fallback if unavailable), `renderRouteThumbnail` (draw `buildRouteLine` polyline + stop dots onto a small canvas, gradient bg, `toDataURL`), and `useTripThumbnail` (look up by signature; generate+cache on miss; gradient placeholder while pending/failed).
- [ ] **Step 4: Run → passes; build.**
- [ ] **Step 5: Commit.** `git commit -m "feat(dashboard): backend-ready client thumbnails (IndexedDB + canvas)"`

---

## Self-Review

- **Spec coverage:** B1 lifecycle → Task 1; useTripList → Task 2; B2 routing → Task 5; B3 onboarding/seed → Tasks 4+5; B4 dashboard UI → Task 6; B5 thumbnails → Task 7; remove "MVP" + brand → Task 3. ✓
- **Placeholders:** UI tasks (3,6) describe structure with concrete actions/files; pure-logic tasks (1,2,4,7) carry full code/tests. The sample-trip exact coordinates are chosen during Task 4 implementation (flagged), which is acceptable as a content choice, not a logic gap. ✓
- **Type consistency:** `seedSampleTrip`, `useTripList`, `TripSummary`, `useHydratedStore`, `ThumbnailStore`, `thumbnailSignature`, `useTripThumbnail`, `renderRouteThumbnail` consistent across tasks. ✓
- **Dependency:** thumbnail renderer reuses `buildRouteLine` from Plan A — ordering respected. ✓
