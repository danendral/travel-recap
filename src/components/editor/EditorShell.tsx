"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/store";
import { usePlayback } from "@/lib/map/usePlayback";
import MapCanvas from "@/components/map/MapCanvas";
import WaypointPanel from "@/components/editor/WaypointPanel";
import SearchBox from "@/components/editor/SearchBox";
import ExportPanel from "@/components/export/ExportPanel";
import PlaybackBar from "@/components/timeline/PlaybackBar";

/**
 * Top-level editor layout. Ensures a trip exists (the persisted store may
 * already have one), mounts the map + sidebar + transport, and runs the preview
 * playback loop.
 */
export default function EditorShell() {
  const [hydrated, setHydrated] = useState(false);
  const activeTripId = useStore((s) => s.activeTripId);
  const createTrip = useStore((s) => s.createTrip);
  const setActiveTrip = useStore((s) => s.setActiveTrip);
  const trips = useStore((s) => s.trips);

  usePlayback();

  // The persist middleware rehydrates from localStorage asynchronously; wait
  // for it so we don't create a duplicate trip on top of a saved one.
  useEffect(() => {
    const unsub = useStore.persist.onFinishHydration(() => setHydrated(true));
    if (useStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (activeTripId && trips[activeTripId]) {
      setActiveTrip(activeTripId);
      return;
    }
    const existing = Object.keys(trips)[0];
    if (existing) setActiveTrip(existing);
    else createTrip("My trip");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  if (!hydrated) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-lg">🌍</span>
          <span className="text-sm font-semibold tracking-tight text-slate-100">
            Travel Recap
          </span>
        </div>
        <span className="text-xs text-slate-500">Client-side · MVP</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <WaypointPanel />
        <main className="relative min-w-0 flex-1">
          <MapCanvas />
          <SearchBox />
          <ExportPanel />
        </main>
      </div>

      <PlaybackBar />
    </div>
  );
}
