"use client";

import { useState } from "react";
import { useStore } from "@/store";
import { useTripData } from "@/store/selectors";
import type { VehicleType } from "@/types";

const VEHICLES: { type: VehicleType; glyph: string; label: string }[] = [
  { type: "plane", glyph: "✈", label: "Flight" },
  { type: "car", glyph: "🚗", label: "Drive" },
  { type: "train", glyph: "🚆", label: "Train" },
  { type: "boat", glyph: "⛴", label: "Boat" },
  { type: "walk", glyph: "🚶", label: "Walk" },
];

/** Sidebar listing the trip's ordered stops. Drag a row to reorder; ✕ removes. */
export default function WaypointPanel() {
  const { trip, orderedWaypoints, segments } = useTripData();
  const reorder = useStore((s) => s.reorderWaypoints);
  const remove = useStore((s) => s.removeWaypoint);
  const setSegmentVehicle = useStore((s) => s.setSegmentVehicle);

  // Index being dragged, and the index it's currently hovering over.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (!trip) return null;

  const commitReorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...trip.waypointIds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    reorder(trip.id, next);
  };

  const endDrag = () => {
    if (dragIndex !== null && overIndex !== null) {
      commitReorder(dragIndex, overIndex);
    }
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-200">{trip.name}</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Search or click the map to add a stop · drag to reorder.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {orderedWaypoints.length === 0 ? (
          <div className="mt-8 text-center text-sm text-slate-500">
            No stops yet.
            <br />
            Search a place or click the map to begin.
          </div>
        ) : (
          <ol className="space-y-1">
            {orderedWaypoints.map((wp, i) => {
              const segId = trip.segmentIds[i];
              const seg = segId ? segments[segId] : undefined;
              const isDragging = dragIndex === i;
              const isOver = overIndex === i && dragIndex !== i;

              return (
                <li key={wp.id}>
                  <div
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(i);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnter={() => setOverIndex(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnd={endDrag}
                    onDrop={(e) => {
                      e.preventDefault();
                      endDrag();
                    }}
                    className={`flex items-center gap-2 rounded-lg px-2 py-2 transition ${
                      isDragging
                        ? "opacity-40"
                        : "bg-slate-800/60 hover:bg-slate-800"
                    } ${isOver ? "ring-2 ring-sky-400" : ""}`}
                  >
                    <span
                      className="cursor-grab select-none px-0.5 text-slate-500 active:cursor-grabbing"
                      aria-label="Drag to reorder"
                      title="Drag to reorder"
                    >
                      ⠿
                    </span>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-xs font-semibold text-sky-300">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-200">
                        {wp.label}
                      </p>
                      <p className="font-mono text-[10px] text-slate-500">
                        {wp.position[1].toFixed(3)}, {wp.position[0].toFixed(3)}
                      </p>
                    </div>
                    <button
                      onClick={() => remove(trip.id, wp.id)}
                      className="px-1 text-xs text-slate-500 hover:text-red-400"
                      aria-label="Remove stop"
                    >
                      ✕
                    </button>
                  </div>

                  {seg && (
                    <div className="my-1 flex items-center gap-1 pl-9">
                      <span className="mr-1 text-slate-600">↓</span>
                      {VEHICLES.map((v) => (
                        <button
                          key={v.type}
                          onClick={() => setSegmentVehicle(seg.id, v.type)}
                          title={v.label}
                          className={`flex h-6 w-6 items-center justify-center rounded text-xs transition ${
                            seg.vehicleType === v.type
                              ? "bg-sky-500/30 ring-1 ring-sky-400"
                              : "bg-slate-800 hover:bg-slate-700"
                          }`}
                        >
                          {v.glyph}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </aside>
  );
}
