"use client";

import { useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { useStore } from "@/store";
import { useTripData } from "@/store/selectors";
import { MAP_STYLES } from "@/lib/constants";
import {
  exportVideo,
  downloadBlob,
  type ExportResult,
} from "@/lib/export/exportVideo";

type Format = { id: string; label: string; sub: string; width: number; height: number };

const FORMATS: Format[] = [
  { id: "16:9", label: "16:9", sub: "Normal / YouTube", width: 1280, height: 720 },
  { id: "9:16", label: "9:16", sub: "Reels / TikTok", width: 720, height: 1280 },
];

const SPEEDS = [
  { rate: 0.5, label: "0.5×" },
  { rate: 1, label: "1×" },
  { rate: 1.5, label: "1.5×" },
  { rate: 2, label: "2×" },
];

const FPS = 30;

/**
 * Export setup: pick aspect ratio, map style, and speed — all reflected live in
 * the editor (style + speed apply to the preview; a crop frame shows the ratio)
 * — then hit Export to render. Opens from the floating Export button.
 */
export default function ExportPanel() {
  const { trip } = useTripData();
  const setMapStyle = useStore((s) => s.setMapStyle);
  const setPlaybackRate = useStore((s) => s.setPlaybackRate);
  const play = useStore((s) => s.play);
  const seek = useStore((s) => s.seek);
  const rate = useStore((s) => s.playback.playbackRate);

  const [open, setOpen] = useState(false);
  const [formatId, setFormatId] = useState("16:9");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (!trip) return null;
  const format = FORMATS.find((f) => f.id === formatId)!;

  const previewPlay = () => {
    seek(0);
    play();
  };

  const runExport = async () => {
    const map = (window as unknown as { __trMap?: MlMap }).__trMap;
    const container = map?.getContainer();
    if (!map || !container) return;

    setError(null);
    setBusy(true);
    setProgress(0);
    useStore.getState().pause();
    useStore.getState().seek(0);

    const prev = { w: container.style.width, h: container.style.height };
    container.style.width = `${format.width}px`;
    container.style.height = `${format.height}px`;
    map.resize();
    await waitIdle(map);

    const controller = new AbortController();
    abortRef.current = controller;

    let result: ExportResult | null = null;
    try {
      result = await exportVideo(map, {
        width: format.width,
        height: format.height,
        fps: FPS,
        onProgress: setProgress,
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message || "Export failed");
    } finally {
      container.style.width = prev.w;
      container.style.height = prev.h;
      map.resize();
      abortRef.current = null;
      setBusy(false);
    }

    if (result) {
      downloadBlob(result.blob, `travel-recap-${format.id.replace(":", "x")}.${result.extension}`);
    }
  };

  return (
    <>
      {/* Crop-frame overlay showing the chosen aspect ratio over the map. */}
      {open && !busy && <RatioFrame format={format} />}

      <div className="absolute right-3 top-3 z-20">
        {!open ? (
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg transition hover:bg-sky-400"
          >
            ⬇ Export video
          </button>
        ) : (
          <div className="w-72 rounded-xl bg-slate-900/95 p-4 shadow-xl ring-1 ring-slate-700 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-100">Export settings</span>
              {!busy && (
                <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-200" aria-label="Close">✕</button>
              )}
            </div>

            {busy ? (
              <div className="space-y-2 py-1">
                <p className="text-xs text-slate-400">Rendering… {Math.round(progress * 100)}%</p>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full bg-sky-400 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <button onClick={() => abortRef.current?.abort()} className="mt-1 w-full rounded bg-slate-800 py-1 text-xs text-slate-300 hover:bg-slate-700">Cancel</button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Aspect ratio */}
                <Field label="Format">
                  <div className="grid grid-cols-2 gap-1.5">
                    {FORMATS.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFormatId(f.id)}
                        className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${formatId === f.id ? "bg-sky-500/20 ring-1 ring-sky-400" : "bg-slate-800/60 hover:bg-slate-800"}`}
                      >
                        <span className="shrink-0 rounded border border-slate-500 bg-slate-700" style={{ width: f.id === "9:16" ? 11 : 18, height: f.id === "9:16" ? 18 : 11 }} />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-slate-100">{f.label}</span>
                          <span className="block text-[10px] text-slate-500">{f.sub}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </Field>

                {/* Map style */}
                <Field label="Map style">
                  <div className="flex flex-wrap gap-1">
                    {MAP_STYLES.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setMapStyle(s.id)}
                        className={`rounded px-2 py-1 text-xs transition ${trip.mapStyleId === s.id ? "bg-sky-500 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </Field>

                {/* Speed */}
                <Field label="Speed">
                  <div className="grid grid-cols-4 gap-1">
                    {SPEEDS.map((s) => (
                      <button
                        key={s.rate}
                        onClick={() => setPlaybackRate(s.rate)}
                        className={`rounded py-1 text-xs transition ${rate === s.rate ? "bg-sky-500 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </Field>

                {error && <p className="text-xs text-red-400">{error}</p>}

                <div className="flex gap-2 pt-1">
                  <button onClick={previewPlay} className="flex-1 rounded-lg bg-slate-800 py-2 text-sm text-slate-200 transition hover:bg-slate-700">▶ Preview</button>
                  <button onClick={runExport} className="flex-1 rounded-lg bg-sky-500 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400">⬇ Export</button>
                </div>
                <p className="text-[10px] text-slate-500">720p · {FPS}fps · rendered in your browser</p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      {children}
    </div>
  );
}

/**
 * Dims the area outside the chosen aspect ratio and outlines the capture region,
 * so the user sees exactly what the exported video will frame.
 */
function RatioFrame({ format }: { format: Format }) {
  const portrait = format.height > format.width;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div
        className="ring-2 ring-sky-400/80 shadow-[0_0_0_9999px_rgba(2,6,23,0.55)]"
        style={{
          aspectRatio: `${format.width} / ${format.height}`,
          height: portrait ? "90%" : "auto",
          width: portrait ? "auto" : "82%",
          maxWidth: "92%",
          maxHeight: "90%",
        }}
      />
    </div>
  );
}

function waitIdle(map: MlMap): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const f = () => { if (done) return; done = true; resolve(); };
    map.once("idle", f);
    setTimeout(f, 1500);
  });
}
