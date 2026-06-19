"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/store";
import { buildRouteLine } from "@/lib/pathing/interpolate";
import { thumbnailSignature } from "./signature";
import { renderRouteThumbnail } from "./renderRouteThumbnail";
import { thumbnailStore } from "./ThumbnailStore";
import type { Id } from "@/types";

/**
 * Returns a data-URL thumbnail for a trip, or `null` while generating / on
 * failure (cards show a gradient placeholder in that case). Serves a cached
 * image when the route is unchanged; regenerates + caches when the route's
 * signature changes. Generation is client-side canvas rendering, off the main
 * data path.
 */
export function useTripThumbnail(tripId: Id): string | null {
  const trip = useStore((s) => s.trips[tripId]);
  const waypoints = useStore((s) => s.waypoints);
  const segments = useStore((s) => s.segments);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  const signature = trip ? thumbnailSignature(trip, waypoints) : "";

  useEffect(() => {
    if (!trip) return;
    let cancelled = false;
    (async () => {
      const cached = await thumbnailStore.get(trip.id, signature);
      if (cancelled) return;
      if (cached) {
        setDataUrl(cached);
        return;
      }
      try {
        const line = buildRouteLine(trip, segments, waypoints);
        const url = renderRouteThumbnail(line);
        if (cancelled) return;
        setDataUrl(url || null);
        if (url) void thumbnailStore.set(trip.id, signature, url);
      } catch {
        if (!cancelled) setDataUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Regenerate only when the route signature changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, signature]);

  // No trip → no thumbnail (handled in render, not via setState in an effect).
  return trip ? dataUrl : null;
}
