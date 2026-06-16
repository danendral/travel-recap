"use client";

import { useEffect, useRef } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { useStore } from "@/store";
import { buildTimeline, sampleAnimation } from "@/lib/pathing/interpolate";
import { applyFrameToMap } from "@/lib/map/applyFrame";

/**
 * Real-time preview playback. Runs a requestAnimationFrame loop while
 * `playback.status === "playing"`, advancing virtual time by wall-clock delta
 * and driving the camera through the SAME `sampleAnimation` function the
 * deterministic export loop uses (so preview == export).
 *
 * Reads the map off `window.__trMap` (published by MapCanvas).
 */
export function usePlayback() {
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    const getMap = () =>
      (window as unknown as { __trMap?: MlMap }).__trMap ?? null;

    const tick = (ts: number) => {
      const state = useStore.getState();
      const { playback, activeTripId, trips, waypoints, segments } = state;
      const map = getMap();

      if (playback.status !== "playing" || !activeTripId || !map) {
        lastTsRef.current = null;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const trip = trips[activeTripId];
      if (!trip || trip.waypointIds.length === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (lastTsRef.current == null) lastTsRef.current = ts;
      const delta = (ts - lastTsRef.current) * playback.playbackRate;
      lastTsRef.current = ts;

      const next = playback.currentTimeMs + delta;
      const timeline = buildTimeline(trip, segments);

      if (next >= timeline.totalMs) {
        // Settle on the final frame and stop.
        const frame = sampleAnimation(
          timeline.totalMs,
          trip,
          waypoints,
          segments,
          timeline,
        );
        map.jumpTo({
          center: frame.center,
          zoom: frame.zoom,
          bearing: frame.bearing,
          pitch: frame.pitch,
        });
        applyFrameToMap(map, frame, trip, segments, waypoints);
        state.seek(timeline.totalMs);
        state.pause();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const frame = sampleAnimation(next, trip, waypoints, segments, timeline);
      map.jumpTo({
        center: frame.center,
        zoom: frame.zoom,
        bearing: frame.bearing,
      });
      applyFrameToMap(map, frame, trip, segments, waypoints);
      state.seek(next);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);
}
