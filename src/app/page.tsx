"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/store";
import { useHydratedStore } from "@/store/useHydratedStore";
import TripsDashboard from "@/components/dashboard/TripsDashboard";

/**
 * Home route. On a brand-new visit (nothing seeded, no trips), seed the iconic
 * sample trip and drop the user straight into its editor so they can hit Play
 * immediately. Returning users (or anyone who's already been seeded) see the
 * dashboard. Gated on store hydration so we never race the localStorage load.
 */
export default function HomePage() {
  const router = useRouter();
  const hydrated = useHydratedStore();
  const hasSeeded = useStore((s) => s.hasSeeded);
  const tripCount = useStore((s) => Object.keys(s.trips).length);
  const seedSampleTrip = useStore((s) => s.seedSampleTrip);
  const seededOnce = useRef(false);

  useEffect(() => {
    if (!hydrated || seededOnce.current) return;
    if (!hasSeeded && tripCount === 0) {
      seededOnce.current = true;
      const id = seedSampleTrip();
      router.replace(`/trip/${id}`);
    }
  }, [hydrated, hasSeeded, tripCount, seedSampleTrip, router]);

  if (!hydrated) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-slate-500">
        Loading…
      </div>
    );
  }

  // Mid-seed redirect for first-time users — avoid a flash of the empty state.
  if (!hasSeeded && tripCount === 0) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-slate-500">
        Setting up your first trip…
      </div>
    );
  }

  return <TripsDashboard />;
}
