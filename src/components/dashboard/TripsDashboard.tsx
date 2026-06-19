"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/store";
import { useTripList } from "@/store/selectors";
import BrandMark from "@/components/common/BrandMark";
import TripCard from "@/components/dashboard/TripCard";
import ConfirmDialog from "@/components/dashboard/ConfirmDialog";

/**
 * The trips home screen: every saved trip as a card, plus "New trip". Shown at
 * `/`. Assumes the store is hydrated (the route gates on it).
 */
export default function TripsDashboard() {
  const router = useRouter();
  const trips = useTripList();
  const createTrip = useStore((s) => s.createTrip);
  const deleteTrip = useStore((s) => s.deleteTrip);

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const pendingName = trips.find((t) => t.id === pendingDelete)?.name ?? "";

  const newTrip = () => router.push(`/trip/${createTrip()}`);

  return (
    <div className="min-h-dvh bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <BrandMark />
        <button
          onClick={newTrip}
          className="rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-400"
        >
          + New trip
        </button>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {trips.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <div className="text-5xl">🗺️</div>
            <h1 className="mt-4 text-xl font-semibold text-slate-100">
              Create your first trip
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Plot a route, animate the camera flying it over the map, and export
              a clip for Reels, TikTok, or Shorts.
            </p>
            <button
              onClick={newTrip}
              className="mt-6 rounded-lg bg-sky-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-sky-400"
            >
              + New trip
            </button>
          </div>
        ) : (
          <>
            <h1 className="mb-4 text-lg font-semibold text-slate-200">
              Your trips
            </h1>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {trips.map((t) => (
                <TripCard
                  key={t.id}
                  summary={t}
                  onRequestDelete={setPendingDelete}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this trip?"
          body={`"${pendingName}" will be permanently deleted. This can't be undone.`}
          onConfirm={() => {
            deleteTrip(pendingDelete);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
