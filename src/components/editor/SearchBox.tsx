"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { useStore } from "@/store";
import { geocode, type GeocodeResult } from "@/lib/geocode";

/**
 * Floating location search over the map. Debounced autocomplete via Photon;
 * selecting a result appends a waypoint and flies the map there.
 */
export default function SearchBox() {
  const activeTripId = useStore((s) => s.activeTripId);
  const addWaypoint = useStore((s) => s.addWaypoint);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Debounced search; aborts the previous request on each keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const map = (window as unknown as { __trMap?: MlMap }).__trMap;
        const c = map?.getCenter();
        const bias = c ? ([c.lng, c.lat] as [number, number]) : undefined;
        const r = await geocode(q, { bias, signal: controller.signal });
        setResults(r);
        setOpen(true);
      } catch {
        // aborted or failed — leave prior results
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const select = (r: GeocodeResult) => {
    if (!activeTripId) return;
    addWaypoint(activeTripId, { position: r.position, label: r.label });
    const map = (window as unknown as { __trMap?: MlMap }).__trMap;
    map?.flyTo({ center: r.position, zoom: 6, duration: 1200 });
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="absolute left-3 top-3 z-10 w-80">
      <div className="flex items-center gap-2 rounded-lg bg-slate-900/90 px-3 py-2 shadow-lg ring-1 ring-slate-700 backdrop-blur">
        <span className="text-slate-500">🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search a city or place…"
          className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
        />
        {loading && <span className="text-xs text-slate-500">…</span>}
      </div>

      {open && results.length > 0 && (
        <ul className="mt-1 overflow-hidden rounded-lg bg-slate-900/95 shadow-xl ring-1 ring-slate-700 backdrop-blur">
          {results.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => select(r)}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition hover:bg-slate-800"
              >
                <span className="text-sm text-slate-100">{r.label}</span>
                {r.context && (
                  <span className="text-xs text-slate-500">{r.context}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
