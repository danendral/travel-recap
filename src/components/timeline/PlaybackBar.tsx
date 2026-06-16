"use client";

import type { Map as MlMap } from "maplibre-gl";
import { useStore } from "@/store";
import { buildTimeline, sampleAnimation } from "@/lib/pathing/interpolate";
import { applyFrameToMap } from "@/lib/map/applyFrame";

/** Transport controls + scrubber for previewing the animation. */
export default function PlaybackBar() {
  const playback = useStore((s) => s.playback);
  const play = useStore((s) => s.play);
  const pause = useStore((s) => s.pause);
  const seek = useStore((s) => s.seek);
  const setStatus = useStore((s) => s.setPlaybackStatus);

  const isPlaying = playback.status === "playing";
  const total = playback.totalDurationMs;
  const disabled = total <= 0;

  const onScrub = (ms: number) => {
    seek(ms);
    // Reflect the scrubbed position on the map immediately.
    const state = useStore.getState();
    const { activeTripId, trips, waypoints, segments } = state;
    const map = (window as unknown as { __trMap?: MlMap }).__trMap;
    if (!activeTripId || !map) return;
    const trip = trips[activeTripId];
    if (!trip || trip.waypointIds.length === 0) return;
    const timeline = buildTimeline(trip, segments);
    const frame = sampleAnimation(ms, trip, waypoints, segments, timeline);
    map.jumpTo({
      center: frame.center,
      zoom: frame.zoom,
      bearing: frame.bearing,
      pitch: frame.pitch,
    });
    applyFrameToMap(map, frame, trip, segments, waypoints);
  };

  return (
    <div className="flex items-center gap-3 border-t border-slate-800 bg-slate-900/90 px-4 py-3 backdrop-blur">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (isPlaying) {
            pause();
          } else {
            if (playback.currentTimeMs >= total) seek(0);
            play();
          }
        }}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500 text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? "❚❚" : "▶"}
      </button>

      <span className="w-14 shrink-0 text-right font-mono text-xs text-slate-400 tabular-nums">
        {fmt(playback.currentTimeMs)}
      </span>

      <input
        type="range"
        min={0}
        max={Math.max(total, 1)}
        step={16}
        value={Math.min(playback.currentTimeMs, total)}
        disabled={disabled}
        onMouseDown={() => setStatus("scrubbing")}
        onMouseUp={() => setStatus("paused")}
        onChange={(e) => onScrub(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-700 accent-sky-400 disabled:opacity-40"
      />

      <span className="w-14 shrink-0 font-mono text-xs text-slate-400 tabular-nums">
        {fmt(total)}
      </span>
    </div>
  );
}

function fmt(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
