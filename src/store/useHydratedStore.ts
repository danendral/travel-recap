"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/store";

/**
 * Returns `true` once Zustand's `persist` middleware has finished rehydrating
 * from localStorage. The store loads asynchronously, so pages must wait for
 * this before creating/seeding trips or reading persisted data — otherwise they
 * race the rehydrate and can duplicate or miss saved trips.
 *
 * Shared by the dashboard and the editor route.
 */
export function useHydratedStore(): boolean {
  // Seed from the current hydration state so an already-hydrated store needs no
  // state update (avoids a synchronous setState inside the effect).
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated());

  useEffect(() => {
    if (hydrated) return;
    // onFinishHydration fires when the async rehydrate completes. If hydration
    // somehow finished between the initial render and here, defer the update to
    // a microtask so it's not a synchronous setState inside the effect body.
    if (useStore.persist.hasHydrated()) {
      queueMicrotask(() => setHydrated(true));
      return;
    }
    return useStore.persist.onFinishHydration(() => setHydrated(true));
  }, [hydrated]);

  return hydrated;
}
