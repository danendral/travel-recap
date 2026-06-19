"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/store";
import { useHydratedStore } from "@/store/useHydratedStore";
import EditorShell from "@/components/editor/EditorShell";

/**
 * Editor route. The trip id comes from the URL — this page makes it the active
 * trip once the store has hydrated, and redirects home if the id doesn't exist
 * (e.g. a stale bookmark to a deleted trip). `params` is a Promise in Next 16;
 * a client component reads it with React's `use`.
 */
export default function TripEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const hydrated = useHydratedStore();
  const setActiveTrip = useStore((s) => s.setActiveTrip);
  const exists = useStore((s) => !!s.trips[id]);
  const activeTripId = useStore((s) => s.activeTripId);

  useEffect(() => {
    if (!hydrated) return;
    if (!exists) {
      router.replace("/");
      return;
    }
    if (activeTripId !== id) setActiveTrip(id);
  }, [hydrated, exists, id, activeTripId, setActiveTrip, router]);

  if (!hydrated || !exists) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-slate-500">
        Loading…
      </div>
    );
  }

  return <EditorShell />;
}
