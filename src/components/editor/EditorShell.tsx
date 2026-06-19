"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/store";
import { useTripData } from "@/store/selectors";
import { usePlayback } from "@/lib/map/usePlayback";
import MapCanvas from "@/components/map/MapCanvas";
import WaypointPanel from "@/components/editor/WaypointPanel";
import SearchBox from "@/components/editor/SearchBox";
import ExportPanel from "@/components/export/ExportPanel";
import PlaybackBar from "@/components/timeline/PlaybackBar";
import BrandMark from "@/components/common/BrandMark";

/**
 * The editor layout for the CURRENTLY ACTIVE trip. The trip is chosen by the
 * route (`/trip/[id]`), not here — this component just renders the map, sidebar,
 * transport, and runs the preview playback loop. It assumes the store is
 * hydrated and an active trip exists (the route guarantees both).
 */
export default function EditorShell() {
  const { trip } = useTripData();
  const renameTrip = useStore((s) => s.renameTrip);
  usePlayback();

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");

  const commitName = () => {
    const name = draftName.trim();
    if (trip && name) renameTrip(trip.id, name);
    setEditingName(false);
  };

  return (
    <div className="flex h-dvh flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md px-1 py-0.5 transition hover:opacity-80"
            aria-label="Back to all trips"
          >
            <BrandMark />
          </Link>
          {trip && (
            <>
              <span className="text-slate-600">/</span>
              {editingName ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="w-56 rounded bg-slate-800 px-2 py-0.5 text-sm text-slate-100 outline-none ring-1 ring-sky-500"
                />
              ) : (
                <button
                  onClick={() => {
                    setDraftName(trip.name);
                    setEditingName(true);
                  }}
                  className="rounded px-1 py-0.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
                  title="Rename trip"
                >
                  {trip.name}
                </button>
              )}
            </>
          )}
        </div>
        <Link
          href="/"
          className="rounded-md border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
        >
          All trips
        </Link>
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
