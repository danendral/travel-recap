import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  CanvasSource,
  QUALITY_HIGH,
  canEncodeVideo,
} from "mediabunny";
import type { Map as MlMap } from "maplibre-gl";
import { useStore } from "@/store";
import { buildTimeline, sampleAnimation } from "@/lib/pathing/interpolate";
import { applyFrameToMap } from "@/lib/map/applyFrame";

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  /** Called with 0..1 progress. */
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  extension: string;
  mimeType: string;
}

/**
 * Renders the active trip's animation to a video file entirely in the browser.
 *
 * Deterministic capture: we freeze the map clock with `setNow`, drive the
 * camera + vehicle + trail through the SAME `sampleAnimation` / `applyFrameToMap`
 * used for preview (so the export matches what the user saw), wait for the map
 * to finish rendering each frame, then hand the canvas to Mediabunny's
 * CanvasSource which encodes it via WebCodecs and muxes to MP4 (H.264) — or WebM
 * (VP9) if H.264 isn't encodable in this browser.
 */
export async function exportVideo(
  map: MlMap,
  opts: ExportOptions,
): Promise<ExportResult> {
  const { width, height, fps, onProgress, signal } = opts;

  const state = useStore.getState();
  const { activeTripId, trips, waypoints, segments } = state;
  if (!activeTripId) throw new Error("No active trip to export");
  const trip = trips[activeTripId];
  if (!trip || trip.waypointIds.length < 1) {
    throw new Error("Add at least one stop before exporting");
  }

  // Pick the best encodable codec/format for this browser.
  const useH264 = await canEncodeVideo("avc");
  const codec = useH264 ? "avc" : "vp9";
  const format = useH264 ? new Mp4OutputFormat() : new WebMOutputFormat();
  const extension = useH264 ? "mp4" : "webm";
  const mimeType = useH264 ? "video/mp4" : "video/webm";
  if (!useH264 && !(await canEncodeVideo("vp9"))) {
    throw new Error(
      "Your browser can't encode video (no WebCodecs H.264/VP9). Try a recent Chrome, Edge, or Safari.",
    );
  }

  const canvas = map.getCanvas();
  const output = new Output({ format, target: new BufferTarget() });
  const source = new CanvasSource(canvas, {
    codec,
    bitrate: QUALITY_HIGH,
    keyFrameInterval: 2,
    // The map canvas is fixed to the export size for the duration, but guard
    // against any transient size change.
    sizeChangeBehavior: "contain",
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  const timeline = buildTimeline(trip, segments);
  // Speed: a higher playbackRate shortens the video. Output duration =
  // timeline / rate; each output second maps to `rate` seconds of virtual time.
  const rate = state.playback.playbackRate || 1;
  const outputMs = timeline.totalMs / rate;
  const totalFrames = Math.max(1, Math.ceil((outputMs / 1000) * fps));
  const frameDur = 1 / fps;

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) throw new DOMException("Export canceled", "AbortError");

      const tMs = (i / fps) * 1000 * rate; // virtual time at this output frame
      const frame = sampleAnimation(tMs, trip, waypoints, segments, timeline);

      // Drive the map deterministically to this frame's camera + scene.
      map.jumpTo({
        center: frame.center,
        zoom: frame.zoom,
        bearing: frame.bearing,
        pitch: frame.pitch,
      });
      applyFrameToMap(map, frame, trip, segments, waypoints);

      // Wait until the map has actually painted this frame (tiles, symbols).
      await renderOnce(map);

      await source.add(i * frameDur, frameDur);
      onProgress?.((i + 1) / totalFrames);
    }

    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("Export produced no data");
    return { blob: new Blob([buffer], { type: mimeType }), extension, mimeType };
  } catch (err) {
    try {
      await output.cancel();
    } catch {
      /* already canceling */
    }
    throw err;
  }
}

/**
 * Forces the map to render and resolves after the paint for the current camera
 * settles. We trigger a repaint and wait for the next `idle` (tiles + labels
 * done) with a timeout so a slow/missing tile can't hang the export.
 */
function renderOnce(map: MlMap): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.off("idle", finish);
      resolve();
    };
    // Resolve as soon as the map is idle (tiles+labels painted). Cap the wait
    // short — after the first frames tiles are cached, so most frames settle
    // immediately; the cap stops a slow/missing tile from stalling the export.
    map.once("idle", finish);
    map.triggerRepaint();
    setTimeout(finish, 60);
  });
}

/** Triggers a browser download of an exported blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
