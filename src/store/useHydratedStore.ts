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
 *
 * Must start `false` and flip to `true` only in an effect: the hook renders on
 * the server too, where `useStore.persist` state isn't meaningful, and starting
 * `true` would cause a server/client hydration mismatch. This is the canonical
 * zustand-persist + SSR pattern (the effect-setState the lint rule warns about
 * is correct here — synchronizing React with an external store's async load).
 */
export function useHydratedStore(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Already finished (the common case after the first mount).
    if (useStore.persist.hasHydrated()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHydrated(true);
      return;
    }
    // Otherwise wait for the async rehydrate to complete.
    return useStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  return hydrated;
}
